import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, RECENT_LIMIT } from "../../src/lib/store.js";

/** In-memory StorageArea with an awaitable delay, to expose lost updates. */
function memoryArea() {
  const data = {};
  const pause = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
  return {
    data,
    async get(keys) {
      await pause();
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
    },
    async set(patch) {
      await pause();
      Object.assign(data, structuredClone(patch));
    },
  };
}

test("defaults when storage is empty or corrupt", async () => {
  const area = memoryArea();
  Object.assign(area.data, { enabled: "yes", rules: { "a.test": "allow", "b.test": "evil" }, blockedTotal: -4 });
  const state = await new Store(area).read();
  assert.equal(state.enabled, true);
  assert.deepEqual(state.rules, { "a.test": "allow" });
  assert.equal(state.blockedTotal, 0);
});

test("concurrent updates are serialized without lost writes", async () => {
  const area = memoryArea();
  const store = new Store(area);
  await Promise.all([
    store.setRule("a.test", "allow"),
    store.setRule("b.test", "block"),
    ...Array.from({ length: 20 }, (_, i) => store.recordBlock({ id: String(i) })),
    store.setRule("c.test", "allow"),
    store.setRule("a.test", "default"),
  ]);
  const state = await store.read();
  assert.deepEqual(state.rules, { "b.test": "block", "c.test": "allow" });
  assert.equal(state.blockedTotal, 20);
  assert.equal(state.recent.length, 20);
});

test("recent log is capped, newest first", async () => {
  const store = new Store(memoryArea());
  for (let i = 0; i < RECENT_LIMIT + 5; i++) await store.recordBlock({ id: String(i) });
  const state = await store.read();
  assert.equal(state.recent.length, RECENT_LIMIT);
  assert.equal(state.recent[0].id, String(RECENT_LIMIT + 4));
  await store.clearRecent();
  assert.equal((await store.read()).recent.length, 0);
  assert.equal((await store.read()).blockedTotal, RECENT_LIMIT + 5);
});

test("a failed update does not stall the queue", async () => {
  const store = new Store(memoryArea());
  await assert.rejects(store.update(() => { throw new Error("boom"); }));
  await store.setEnabled(false);
  assert.equal((await store.read()).enabled, false);
});
