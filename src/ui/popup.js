import { request, MODE_TEXT, reasonText, formatTime, el, announce } from "./common.js";

const $ = (id) => document.getElementById(id);
const status = $("status");
let tabId = null;
let current = null;

async function activeTabId() {
  // A test harness can open this page in a tab with ?tabId=N; normally it is the action popup.
  const param = Number(new URLSearchParams(location.search).get("tabId"));
  if (Number.isInteger(param) && param >= 0) return param;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function renderModes(site, mode) {
  const fieldset = $("modes");
  fieldset.replaceChildren(el("legend", { class: "visually-hidden", text: `Popups from ${site}` }));
  for (const value of ["default", "block", "allow"]) {
    const id = `mode-${value}`;
    const input = el("input", { type: "radio", name: "mode", id, value, "aria-describedby": `${id}-hint` });
    input.checked = value === mode;
    input.addEventListener("change", () => setMode(site, value));
    fieldset.append(
      el(
        "label",
        { class: `mode mode-${value}`, for: id },
        input,
        el("span", { class: "mode-text" }, el("span", { class: "mode-label", text: MODE_TEXT[value].label }), el("span", { class: "mode-hint", id: `${id}-hint`, text: MODE_TEXT[value].hint })),
      ),
    );
  }
}

function renderBlocked(tab) {
  const list = $("blocked");
  list.replaceChildren();
  for (const item of tab.blocked) {
    const actions = item.reopenable
      ? el("button", { type: "button", class: "small", "aria-label": `Open blocked popup to ${item.destination}`, text: "Open", onclick: () => openBlocked(item.id) })
      : el("span", { class: "muted small-text", text: "—" });
    list.append(
      el(
        "li",
        {},
        el("span", { class: "blocked-main" }, el("span", { class: "origin", text: item.destination, title: item.destination }), el("span", { class: "muted small-text", text: `${reasonText(item.reason)} · ${formatTime(item.time)}` })),
        actions,
      ),
    );
  }
  $("blocked-empty").hidden = tab.blocked.length > 0;
  $("tab-count").textContent = tab.count ? String(tab.count) : "";
}

function render(state) {
  current = state;
  $("enabled").checked = state.enabled;
  $("enabled-text").textContent = state.enabled ? "On" : "Off";
  $("disabled-note").hidden = state.enabled;
  document.body.classList.toggle("is-off", !state.enabled);
  $("total").textContent = state.blockedTotal ? `${state.blockedTotal} blocked in total` : "";
  const tab = state.tab;
  const supported = Boolean(tab?.site);
  $("site-section").hidden = !supported;
  $("unsupported").hidden = supported;
  if (supported) {
    $("site-name").textContent = tab.site;
    renderModes(tab.site, tab.mode);
  }
  renderBlocked(tab ?? { blocked: [], count: 0 });
}

async function refresh() {
  render(await request({ type: "getState", tabId: tabId ?? undefined }));
}

async function setMode(site, mode) {
  try {
    await request({ type: "setRule", site, mode });
    await refresh();
    announce(status, `${MODE_TEXT[mode].label} on ${site}.`);
  } catch (error) {
    announce(status, error.message);
    await refresh();
  }
}

async function openBlocked(id) {
  try {
    await request({ type: "openBlocked", id, tabId });
    window.close();
  } catch (error) {
    announce(status, error.message);
  }
}

$("enabled").addEventListener("change", async (event) => {
  await request({ type: "setEnabled", enabled: event.target.checked });
  await refresh();
  announce(status, event.target.checked ? "Popup Guard is on." : "Popup Guard is off.");
});

$("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener(() => {
  if (current) refresh().catch(() => {});
});

tabId = await activeTabId();
await refresh();
