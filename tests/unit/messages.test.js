import { test } from "node:test";
import assert from "node:assert/strict";
import { isFromContentScript, isFromExtensionPage, parseIntent, parseUiRequest } from "../../src/lib/messages.js";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${ID}/`;

test("sender checks separate extension pages from content scripts", () => {
  const page = { id: ID, url: `${ORIGIN}src/ui/popup.html` };
  const content = { id: ID, url: "https://news.test/", tab: { id: 4 }, frameId: 0 };
  assert.ok(isFromExtensionPage(page, ID, ORIGIN));
  assert.ok(!isFromContentScript(page, ID, ORIGIN));
  assert.ok(isFromContentScript(content, ID, ORIGIN));
  assert.ok(!isFromExtensionPage(content, ID, ORIGIN));
  assert.ok(!isFromExtensionPage({ ...page, id: "other" }, ID, ORIGIN));
  assert.ok(!isFromContentScript({ ...content, tab: undefined }, ID, ORIGIN));
  assert.ok(!isFromContentScript({ ...content, frameId: -1 }, ID, ORIGIN));
  // A web page pretending to be the extension through its URL text.
  assert.ok(!isFromExtensionPage({ id: ID, url: `https://evil.test/?${ORIGIN}` }, ID, ORIGIN));
});

test("intent messages are validated", () => {
  assert.deepEqual(parseIntent({ type: "intent", kind: "link", href: "https://a.test/x" }), { kind: "link", href: "https://a.test/x", form: false });
  assert.equal(parseIntent({ type: "intent", kind: "link", href: "javascript:alert(1)" }), null);
  assert.equal(parseIntent({ type: "intent", kind: "admin", href: "https://a.test/" }), null);
  assert.equal(parseIntent({ type: "intent", kind: "link", href: `https://a.test/${"x".repeat(5000)}` }), null);
  assert.equal(parseIntent({ type: "setRule", site: "a.test", mode: "allow" }), null);
  assert.equal(parseIntent(null), null);
});

test("UI requests are validated", () => {
  assert.deepEqual(parseUiRequest({ type: "getState", tabId: 3 }), { type: "getState", tabId: 3 });
  assert.deepEqual(parseUiRequest({ type: "getState" }), { type: "getState", tabId: null });
  assert.equal(parseUiRequest({ type: "getState", tabId: -1 }), null);
  assert.equal(parseUiRequest({ type: "getState", tabId: "3" }), null);
  assert.deepEqual(parseUiRequest({ type: "setRule", site: "a.test", mode: "allow" }), { type: "setRule", site: "a.test", mode: "allow" });
  assert.equal(parseUiRequest({ type: "setRule", site: "a.test", mode: "nuke" }), null);
  assert.equal(parseUiRequest({ type: "setEnabled", enabled: "yes" }), null);
  assert.equal(parseUiRequest({ type: "openBlocked", id: "../../x" }), null);
  assert.equal(parseUiRequest({ type: "eval" }), null);
});
