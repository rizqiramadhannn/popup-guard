// Popup Guard service worker.
//
// Detection: chrome.webNavigation.onCreatedNavigationTarget fires when a page
// (any frame) makes the browser create a new tab or window for a navigation:
// window.open, target=_blank links and forms, and popunders. The extension
// judges the new tab against the opener tab's top-level site and closes it when
// the rules say so. It never injects into the page's main world and does not
// patch window.open, so pages cannot tamper with the decision.
import { classifyUrl, displayOrigin, siteForPageUrl, siteFromUserInput } from "./lib/site.js";
import { decide, matchIntent, MODES } from "./lib/decision.js";
import { isFromContentScript, isFromExtensionPage, parseIntent, parseUiRequest } from "./lib/messages.js";
import { Store, DEFAULTS } from "./lib/store.js";
import { PSL_VERSION } from "./lib/psl-data.js";

const EXTENSION_ID = chrome.runtime.id;
const EXTENSION_ORIGIN = chrome.runtime.getURL("");
const INTENT_GRACE_MS = 300; // wait for a click report that may arrive just after the popup event
const INTENT_TTL_MS = { link: 3000, explicit: 10000 };
const WATCH_MS = 10000; // judge a new popup's first navigations and redirects for this long
const BLOCKED_URL_LIMIT = 50;

const store = new Store(chrome.storage.local);
let cachedState = null;
const intents = new Map(); // tabId -> [{kind, href, form, expires}]
const intentWaiters = new Map(); // tabId -> Set<() => void>
const watching = new Map(); // popup tabId -> {sourceTabId, sourceSite, phase, expires}
const topUrls = new Map(); // tabId -> last committed top-level URL (fallback for getFrame)

// ---------- state ----------

async function state() {
  if (!cachedState) cachedState = await store.read();
  return cachedState;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(changes).some((key) => key in DEFAULTS)) cachedState = null;
});

// Session data stays in memory and is cleared when the browser closes. Content
// scripts cannot read it (default TRUSTED_CONTEXTS access level).
let sessionQueue = Promise.resolve();
function updateSession(change) {
  const run = sessionQueue.then(async () => {
    const data = await chrome.storage.session.get(["blockedUrls", "tabCounts"]);
    const current = { blockedUrls: data.blockedUrls ?? {}, tabCounts: data.tabCounts ?? {} };
    const patch = change(current);
    if (patch) await chrome.storage.session.set(patch);
    return patch;
  });
  sessionQueue = run.catch(() => {});
  return run;
}

// ---------- popup handling ----------

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  handlePopup(details).catch((error) => console.warn("Popup Guard could not judge a popup", error));
});

async function sourceSiteOf(tabId) {
  let url = null;
  try {
    url = (await chrome.webNavigation.getFrame({ tabId, frameId: 0 }))?.url ?? null;
  } catch {
    // The opener tab may already be gone.
  }
  return siteForPageUrl(url ?? topUrls.get(tabId) ?? null);
}

async function handlePopup({ tabId: popupTabId, sourceTabId, url }) {
  if (!Number.isInteger(sourceTabId) || sourceTabId < 0 || sourceTabId === popupTabId) return;
  const settings = await state();
  if (!settings.enabled) return;
  const sourceSite = await sourceSiteOf(sourceTabId);
  if (!sourceSite) return; // file:, chrome:// and other non-web openers are left alone
  const mode = settings.rules[sourceSite] ?? MODES.DEFAULT;
  const destination = classifyUrl(url);
  const judge = () =>
    decide({ enabled: true, mode, sourceSite, destination, intent: matchIntent(intents.get(sourceTabId) ?? [], url, Date.now()) });

  let verdict = judge();
  if (verdict.action === "block") {
    // The click report and the popup event travel separately; give the report a moment.
    await waitForIntent(sourceTabId, INTENT_GRACE_MS);
    verdict = judge();
  }
  await apply(verdict, { popupTabId, sourceTabId, sourceSite, url });
}

async function apply(verdict, { popupTabId, sourceTabId, sourceSite, url }) {
  if (verdict.action === "block") {
    await closeTab(popupTabId);
    watching.delete(popupTabId);
    await recordBlock({ url, sourceTabId, sourceSite, reason: verdict.reason });
  } else if (verdict.action === "watch") {
    watching.set(popupTabId, { sourceTabId, sourceSite, phase: "blank", expires: Date.now() + WATCH_MS });
  } else if (verdict.reason === "same-site") {
    // Catch same-site redirectors that bounce the popup to another site.
    watching.set(popupTabId, { sourceTabId, sourceSite, phase: "redirect", expires: Date.now() + WATCH_MS });
  }
}

function waitForIntent(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let waiters = intentWaiters.get(tabId);
    if (!waiters) intentWaiters.set(tabId, (waiters = new Set()));
    const done = () => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    waiters.add(done);
  });
}

async function judgeWatched(tabId, url, isRedirect) {
  const watch = watching.get(tabId);
  if (!watch) return;
  if (watch.expires < Date.now()) {
    watching.delete(tabId);
    return;
  }
  const destination = classifyUrl(url);
  if (destination.kind === "blank") return;
  if (watch.phase === "redirect" && !isRedirect) return;
  const settings = await state();
  const mode = settings.rules[watch.sourceSite] ?? MODES.DEFAULT;
  const verdict = decide({ enabled: settings.enabled, mode, sourceSite: watch.sourceSite, destination, intent: null });
  if (verdict.action === "block") {
    await apply(verdict, { popupTabId: tabId, sourceTabId: watch.sourceTabId, sourceSite: watch.sourceSite, url });
  } else if (watch.phase === "blank") {
    watch.phase = "redirect";
  }
}

chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0 && watching.get(tabId)?.phase === "blank") judgeWatched(tabId, url, false).catch(() => {});
});

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url, transitionQualifiers }) => {
  if (frameId !== 0) return;
  topUrls.set(tabId, url);
  const redirected = transitionQualifiers.includes("server_redirect") || transitionQualifiers.includes("client_redirect");
  if (watching.has(tabId)) judgeWatched(tabId, url, redirected).catch(() => {});
  if (!redirected) resetTabCount(tabId).catch(() => {});
});

chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0) topUrls.set(tabId, url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  intents.delete(tabId);
  intentWaiters.delete(tabId);
  watching.delete(tabId);
  topUrls.delete(tabId);
  updateSession(({ tabCounts }) => {
    if (!(tabId in tabCounts)) return null;
    const next = { ...tabCounts };
    delete next[tabId];
    return { tabCounts: next };
  }).catch(() => {});
});

async function closeTab(tabId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await chrome.tabs.remove(tabId);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  return false;
}

async function recordBlock({ url, sourceTabId, sourceSite, reason }) {
  const id = crypto.randomUUID();
  const reopenable = /^https?:/i.test(url ?? "");
  await store.recordBlock({ id, time: Date.now(), sourceSite, destination: displayOrigin(url), reason });
  const patch = await updateSession(({ blockedUrls, tabCounts }) => {
    const urls = { ...blockedUrls };
    urls[id] = { url: reopenable ? url : null, sourceTabId, sourceSite, destination: displayOrigin(url), reason, time: Date.now() };
    const ids = Object.keys(urls);
    for (const old of ids.slice(0, Math.max(0, ids.length - BLOCKED_URL_LIMIT))) delete urls[old];
    return { blockedUrls: urls, tabCounts: { ...tabCounts, [sourceTabId]: (tabCounts[sourceTabId] ?? 0) + 1 } };
  });
  await setBadge(sourceTabId, patch.tabCounts[sourceTabId]);
}

async function resetTabCount(tabId) {
  const patch = await updateSession(({ tabCounts }) => {
    if (!tabCounts[tabId]) return null;
    return { tabCounts: { ...tabCounts, [tabId]: 0 } };
  });
  if (patch) await setBadge(tabId, 0);
}

async function setBadge(tabId, count) {
  try {
    await chrome.action.setBadgeText({ tabId, text: count ? String(Math.min(count, 999)) : "" });
  } catch {
    // The tab closed.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: "#b3261e" }).catch(() => {});
});

// ---------- messages ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isFromContentScript(sender, EXTENSION_ID, EXTENSION_ORIGIN)) {
    const intent = parseIntent(message);
    if (intent) rememberIntent(sender.tab.id, intent);
    return false;
  }
  if (!isFromExtensionPage(sender, EXTENSION_ID, EXTENSION_ORIGIN)) return false;
  const request = parseUiRequest(message);
  if (!request) {
    sendResponse({ ok: false, error: "Invalid request." });
    return false;
  }
  handleUiRequest(request)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message ?? "Request failed." }));
  return true;
});

function rememberIntent(tabId, intent) {
  const now = Date.now();
  const list = (intents.get(tabId) ?? []).filter((item) => item.expires >= now).slice(-9);
  list.push({ ...intent, expires: now + INTENT_TTL_MS[intent.kind] });
  intents.set(tabId, list);
  for (const wake of [...(intentWaiters.get(tabId) ?? [])]) wake();
}

async function handleUiRequest(request) {
  switch (request.type) {
    case "getState":
      return snapshot(request.tabId);
    case "setEnabled":
      await store.setEnabled(request.enabled);
      return snapshot(null);
    case "setRule": {
      const site = siteFromUserInput(request.site);
      if (!site) throw new Error("Enter a web site such as example.com.");
      await store.setRule(site, request.mode);
      return { site, ...(await snapshot(null)) };
    }
    case "clearRecent":
      await store.clearRecent();
      await chrome.storage.session.set({ blockedUrls: {} });
      return snapshot(null);
    case "openBlocked": {
      const { blockedUrls = {} } = await chrome.storage.session.get("blockedUrls");
      const entry = blockedUrls[request.id];
      if (!entry?.url) throw new Error("This popup can no longer be opened.");
      const create = { url: entry.url, active: true };
      const opener = request.tabId ?? entry.sourceTabId;
      try {
        const openerTab = await chrome.tabs.get(opener);
        create.openerTabId = openerTab.id;
        create.windowId = openerTab.windowId;
        create.index = openerTab.index + 1;
      } catch {
        // Opener closed: open in the current window.
      }
      await chrome.tabs.create(create);
      return {};
    }
    default:
      throw new Error("Unknown request.");
  }
}

async function snapshot(tabId) {
  const settings = await state();
  const result = {
    enabled: settings.enabled,
    rules: settings.rules,
    recent: settings.recent,
    blockedTotal: settings.blockedTotal,
    pslVersion: PSL_VERSION,
    tab: null,
  };
  if (tabId !== null) {
    const site = await sourceSiteOf(tabId);
    const { blockedUrls = {}, tabCounts = {} } = await chrome.storage.session.get(["blockedUrls", "tabCounts"]);
    const blocked = Object.entries(blockedUrls)
      .filter(([, entry]) => entry.sourceTabId === tabId)
      .map(([id, entry]) => ({
        id,
        destination: entry.destination,
        reason: entry.reason,
        time: entry.time,
        reopenable: Boolean(entry.url),
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 10);
    result.tab = { tabId, site, mode: site ? (settings.rules[site] ?? MODES.DEFAULT) : null, count: tabCounts[tabId] ?? 0, blocked };
  }
  return result;
}
