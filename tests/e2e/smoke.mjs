// Live smoke test: loads the unpacked extension into a throwaway Chrome profile
// (never the user's browser profile) and checks real popups opened by real,
// trusted input events.
//
//   CHROME=<chrome.exe> EXT_DIR=<unpacked extension dir> node tests/e2e/smoke.mjs
//
// Branded Chrome 137+ ignores --load-extension, so the extension is installed
// over the DevTools pipe (Extensions.loadUnpacked) with puppeteer-core.
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startServer } from "./server.mjs";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const extensionDir = path.resolve(process.env.EXT_DIR ?? root);
const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const artifacts = path.resolve(process.env.ARTIFACTS ?? path.join(root, "tests/e2e/output"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

const server = await startServer();
const port = server.address().port;
const at = (host, p = "/") => `http://${host}:${port}${p}`;
const profile = await mkdtemp(path.join(tmpdir(), "popup-guard-e2e-"));
await mkdir(artifacts, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  pipe: true,
  enableExtensions: true,
  userDataDir: profile,
  args: [`--host-resolver-rules=MAP *.test 127.0.0.1`, "--no-first-run", "--no-default-browser-check"],
});

try {
  const extensionId = await browser.installExtension(extensionDir);
  await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith(`chrome-extension://${extensionId}/`));
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/src/ui/options.html`);
  const ext = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const badge = (tabId) => control.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  // Without the "tabs" permission tab URLs are hidden, so find the tab through the extension's own state.
  const tabIdOf = () =>
    control.evaluate(async () => {
      for (const tab of await chrome.tabs.query({})) {
        const state = await chrome.runtime.sendMessage({ type: "getState", tabId: tab.id });
        if (state.ok && state.tab?.site === "site-one.test" && state.tab.blocked.length) return tab.id;
      }
      return null;
    });

  const opener = await browser.newPage();
  await opener.goto(at("site-one.test"));
  await sleep(300);

  async function openedPaths(action) {
    const before = new Set((await browser.pages()).map((p) => p.url()));
    await action();
    await sleep(1800);
    const after = (await browser.pages()).map((p) => p.url()).filter((u) => !before.has(u));
    return after;
  }

  async function check(name, action, expectedPath, expectOpen) {
    const opened = await openedPaths(action);
    const present = opened.some((u) => u.includes(expectedPath));
    const pass = present === expectOpen;
    results.push({ name, pass, expected: expectOpen ? "open" : "blocked", openedUrls: opened.map((u) => u.replace(`:${port}`, ":PORT")) });
    for (const p of await browser.pages()) if (p !== opener && p !== control && !p.url().startsWith("chrome-extension:")) await p.close().catch(() => {});
    await opener.bringToFront();
  }

  const click = (selector, options) => () => opener.click(selector, options);
  const withKey = (key, selector) => async () => {
    await opener.keyboard.down(key);
    await opener.click(selector);
    await opener.keyboard.up(key);
  };

  // Default mode.
  await check("default: cross-site window.open is blocked", click("#open-cross"), "/ad.html", false);
  await check("default: cross-site window.open with noopener is blocked", click("#open-cross-noopener"), "/noopener.html", false);
  await check("default: same-site window.open stays open", click("#open-same"), "/same.html", true);
  await check("default: blank window sent to another site is blocked", click("#open-blank"), "/late.html", false);
  await check("default: same-site redirector to another site is blocked", click("#open-redirector"), "/redirected.html", false);
  await check("default: user click on a target=_blank cross-site link stays open", click("#link-cross"), "/partner.html", true);
  await check("default: user form submit to a new tab stays open", click("#form-submit"), "/find", true);
  const frame = opener.frames().find((f) => f.url().includes("frame.other.test"));
  await check("default: popup from a cross-site ad iframe is blocked", () => frame.click("#frame-open"), "/frame-ad.html", false);

  const openerTabId = await tabIdOf();
  results.push({ name: "badge counts blocked popups on the opener tab", pass: Number(await badge(openerTabId)) === 5, badge: await badge(openerTabId) });
  const state = await ext({ type: "getState", tabId: openerTabId });
  results.push({
    name: "state lists the blocked popups with origins only",
    pass: state.ok && state.tab.site === "site-one.test" && state.tab.blocked.length === 5 && state.recent.every((r) => !/\/ad\.html|\?/.test(r.destination)),
    tabBlocked: state.tab?.blocked.length,
    sample: state.recent[0],
  });

  // Click-jacking overlay link.
  const overlay = await browser.newPage();
  await overlay.goto(at("site-one.test", "/overlay"));
  await sleep(300);
  const overlayOpened = await openedPaths(() => overlay.mouse.click(200, 200));
  results.push({ name: "default: invisible full-page overlay link is blocked", pass: !overlayOpened.some((u) => u.includes("/overlay-ad.html")), openedUrls: overlayOpened });
  await overlay.close();
  await opener.bringToFront();

  // Block all popups on this site.
  let response = await ext({ type: "setRule", site: "www.site-one.test", mode: "block" });
  results.push({ name: "setRule normalizes www.site-one.test to site-one.test", pass: response.ok && response.site === "site-one.test" && response.rules["site-one.test"] === "block" });
  await check("block-all: same-site window.open is blocked", click("#open-same"), "/same.html", false);
  await check("block-all: plain click on a same-site new-tab link is blocked", click("#link-same"), "/same-link.html", false);
  await check("block-all: Ctrl-click on a link still opens it", withKey("Control", "#link-cross"), "/partner.html", true);
  await check("block-all: middle-click on a link still opens it", click("#link-cross", { button: "middle" }), "/partner.html", true);

  // Allow popups (whitelist).
  await ext({ type: "setRule", site: "site-one.test", mode: "allow" });
  await check("allow: cross-site window.open stays open", click("#open-cross"), "/ad.html", true);

  // Back to default, then the global switch.
  await ext({ type: "setRule", site: "site-one.test", mode: "default" });
  await check("default again after removing the rule", click("#open-cross"), "/ad.html", false);
  await ext({ type: "setEnabled", enabled: false });
  await check("disabled: cross-site window.open stays open", click("#open-cross"), "/ad.html", true);
  await ext({ type: "setEnabled", enabled: true });

  // Reopen a blocked popup from the log.
  const latest = (await ext({ type: "getState", tabId: openerTabId })).tab.blocked[0];
  const reopened = await openedPaths(() => ext({ type: "openBlocked", id: latest.id, tabId: openerTabId }));
  results.push({ name: "Open on a blocked popup opens it once without being blocked", pass: reopened.some((u) => u.includes("/ad.html")), openedUrls: reopened });

  // Untrusted message sources.
  const forged = await opener.evaluate(() => typeof chrome === "undefined" || typeof chrome.runtime?.sendMessage !== "function");
  results.push({ name: "page main world has no extension messaging API", pass: forged });
  const bad = await ext({ type: "setRule", site: "not a site", mode: "allow" });
  results.push({ name: "invalid rule input is rejected", pass: bad.ok === false && /web site/.test(bad.error) });

  // UI renders: popup for the opener tab and the options page.
  await ext({ type: "setRule", site: "example.co.uk", mode: "allow" });
  const popup = await browser.newPage();
  await popup.setViewport({ width: 340, height: 560 });
  await popup.goto(`chrome-extension://${extensionId}/src/ui/popup.html?tabId=${openerTabId}`);
  await sleep(500);
  const popupInfo = await popup.evaluate(() => ({
    site: document.getElementById("site-name").textContent,
    checked: document.querySelector("input[name=mode]:checked")?.value,
    blockedItems: document.querySelectorAll("#blocked li").length,
    unlabeled: [...document.querySelectorAll("input,select,button")].filter((e) => !(e.labels?.length || e.getAttribute("aria-label") || e.textContent.trim())).length,
  }));
  results.push({ name: "popup UI shows the site, its mode and blocked list", pass: popupInfo.site === "site-one.test" && popupInfo.checked === "default" && popupInfo.blockedItems > 0 && popupInfo.unlabeled === 0, popupInfo });
  await popup.screenshot({ path: path.join(artifacts, "popup.png"), fullPage: true });
  await popup.click("#mode-allow");
  await sleep(300);
  const afterUi = await ext({ type: "getState" });
  results.push({ name: "popup UI radio saves the site rule", pass: afterUi.rules["site-one.test"] === "allow" });
  await control.bringToFront();
  await control.setViewport({ width: 900, height: 900 });
  await control.reload();
  await sleep(500);
  const optionsInfo = await control.evaluate(() => ({ rules: document.querySelectorAll("#rules tr").length, recent: document.querySelectorAll("#recent tr").length }));
  results.push({ name: "options UI lists rules and recent blocks", pass: optionsInfo.rules === 2 && optionsInfo.recent > 0, optionsInfo });
  await control.screenshot({ path: path.join(artifacts, "options.png"), fullPage: true });
} catch (error) {
  results.push({ name: "harness", pass: false, error: String(error?.stack ?? error) });
} finally {
  await browser.close();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  ${JSON.stringify(r)}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await writeFile(path.join(artifacts, "smoke-report.json"), JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
process.exit(failed.length ? 1 : 0);
