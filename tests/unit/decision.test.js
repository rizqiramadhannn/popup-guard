import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, matchIntent, MODES } from "../../src/lib/decision.js";

const web = (site) => ({ kind: "web", site });
const base = { enabled: true, mode: MODES.DEFAULT, sourceSite: "news.test", intent: null };

test("default mode blocks cross-site popups and allows same-site ones", () => {
  assert.deepEqual(decide({ ...base, destination: web("ads.test") }), { action: "block", reason: "cross-site" });
  assert.deepEqual(decide({ ...base, destination: web("news.test") }), { action: "allow", reason: "same-site" });
  assert.equal(decide({ ...base, destination: { kind: "other" } }).action, "block");
});

test("blank popups are watched until they navigate", () => {
  assert.deepEqual(decide({ ...base, destination: { kind: "blank" } }), { action: "watch", reason: "pending-destination" });
});

test("user link clicks are allowed in default mode", () => {
  assert.equal(decide({ ...base, destination: web("other.test"), intent: "link" }).action, "allow");
  assert.equal(decide({ ...base, destination: web("other.test"), intent: "explicit" }).action, "allow");
});

test("block-all mode blocks same-site and plain links but not explicit new-tab gestures", () => {
  const mode = MODES.BLOCK;
  assert.deepEqual(decide({ ...base, mode, destination: web("news.test") }), { action: "block", reason: "site-blocks-all" });
  assert.equal(decide({ ...base, mode, destination: web("other.test"), intent: "link" }).action, "block");
  assert.equal(decide({ ...base, mode, destination: { kind: "blank" } }).action, "block");
  assert.equal(decide({ ...base, mode, destination: web("other.test"), intent: "explicit" }).action, "allow");
});

test("allow mode and the global switch allow everything", () => {
  assert.deepEqual(decide({ ...base, mode: MODES.ALLOW, destination: web("ads.test") }), { action: "allow", reason: "site-allowed" });
  assert.deepEqual(decide({ ...base, enabled: false, mode: MODES.BLOCK, destination: web("ads.test") }), { action: "allow", reason: "disabled" });
});

test("non-web openers and extension pages are left alone", () => {
  assert.equal(decide({ ...base, sourceSite: null, destination: web("ads.test") }).action, "allow");
  assert.equal(decide({ ...base, destination: { kind: "extension" } }).action, "allow");
});

test("intent matching ignores fragments and expired gestures", () => {
  const now = 1000;
  const intents = [
    { kind: "link", href: "https://other.test/a#top", expires: 2000 },
    { kind: "explicit", href: "https://old.test/", expires: 500 },
  ];
  assert.equal(matchIntent(intents, "https://other.test/a", now), "link");
  assert.equal(matchIntent(intents, "https://other.test/b", now), null);
  assert.equal(matchIntent(intents, "https://old.test/", now), null);
  assert.equal(matchIntent(intents, "about:blank", now), null);
});

test("explicit intent outranks a plain link for the same URL", () => {
  const intents = [
    { kind: "link", href: "https://x.test/", expires: 9e9 },
    { kind: "explicit", href: "https://x.test/", expires: 9e9 },
  ];
  assert.equal(matchIntent(intents, "https://x.test/", 0), "explicit");
});

test("a right-click (menu) intent counts as a plain link, never as explicit", () => {
  const intents = [{ kind: "menu", href: "https://ads.test/x", expires: 9e9 }];
  assert.equal(matchIntent(intents, "https://ads.test/x", 0), "link");
  assert.equal(decide({ ...base, mode: MODES.BLOCK, destination: web("ads.test"), intent: "link" }).action, "block");
});

test("form intents match origin and path, since the browser adds the query", () => {
  const intents = [{ kind: "link", href: "https://search.test/find", form: true, expires: 9e9 }];
  assert.equal(matchIntent(intents, "https://search.test/find?q=shoes", 0), "link");
  assert.equal(matchIntent(intents, "https://search.test/other?q=shoes", 0), null);
});
