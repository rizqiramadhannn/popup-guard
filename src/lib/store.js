// Persistent settings in chrome.storage.local. Every write runs through one
// promise queue in the service worker, so concurrent popup/options/blocking
// updates cannot overwrite each other with stale reads.
import { MODES, RULE_MODES } from "./decision.js";

export const RECENT_LIMIT = 30;
export const DEFAULTS = Object.freeze({ enabled: true, rules: {}, recent: [], blockedTotal: 0 });

export class Store {
  /** @param {chrome.storage.StorageArea} area */
  constructor(area) {
    this.area = area;
    this.queue = Promise.resolve();
  }

  async read() {
    const data = await this.area.get(Object.keys(DEFAULTS));
    return {
      enabled: typeof data.enabled === "boolean" ? data.enabled : DEFAULTS.enabled,
      rules: sanitizeRules(data.rules),
      recent: Array.isArray(data.recent) ? data.recent.slice(0, RECENT_LIMIT) : [],
      blockedTotal: Number.isSafeInteger(data.blockedTotal) && data.blockedTotal >= 0 ? data.blockedTotal : 0,
    };
  }

  /** Runs `change(state)` after every earlier update; persists the keys it returns. */
  update(change) {
    const run = this.queue.then(async () => {
      const state = await this.read();
      const patch = await change(state);
      if (patch && Object.keys(patch).length) await this.area.set(patch);
      return patch;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  setEnabled(enabled) {
    return this.update(() => ({ enabled }));
  }

  setRule(site, mode) {
    return this.update(({ rules }) => {
      const next = { ...rules };
      if (mode === MODES.DEFAULT) delete next[site];
      else next[site] = mode;
      return { rules: next };
    });
  }

  recordBlock(entry) {
    return this.update(({ recent, blockedTotal }) => ({
      recent: [entry, ...recent].slice(0, RECENT_LIMIT),
      blockedTotal: blockedTotal + 1,
    }));
  }

  clearRecent() {
    return this.update(() => ({ recent: [] }));
  }
}

function sanitizeRules(value) {
  const rules = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [site, mode] of Object.entries(value)) if (RULE_MODES.has(mode)) rules[site] = mode;
  }
  return rules;
}
