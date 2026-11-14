// Validation of runtime messages. Pages are untrusted: a content script runs in
// the isolated world, but anything it reports describes page-controlled DOM.
import { RULE_MODES, MODES } from "./decision.js";

const MAX_URL = 4096;
const INTENT_KINDS = new Set(["explicit", "link", "menu"]);

function isWebUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** True when the message came from one of this extension's own pages (popup or options). */
export function isFromExtensionPage(sender, extensionId, extensionOrigin) {
  if (!sender || sender.id !== extensionId) return false;
  const url = typeof sender.url === "string" ? sender.url : "";
  return url.startsWith(extensionOrigin);
}

/** True when the message came from this extension's content script in a web page frame. */
export function isFromContentScript(sender, extensionId, extensionOrigin) {
  if (!sender || sender.id !== extensionId) return false;
  if (!sender.tab || !Number.isInteger(sender.tab.id) || sender.tab.id < 0) return false;
  if (!Number.isInteger(sender.frameId) || sender.frameId < 0) return false;
  return !(typeof sender.url === "string" && sender.url.startsWith(extensionOrigin));
}

/** A link gesture reported by the content script, or null if malformed. */
export function parseIntent(message) {
  if (!message || typeof message !== "object" || message.type !== "intent") return null;
  if (!INTENT_KINDS.has(message.kind) || !isWebUrl(message.href)) return null;
  return { kind: message.kind, href: message.href, form: message.form === true };
}

/** UI requests. Returns a normalized request or null. Site normalization happens in the caller. */
export function parseUiRequest(message) {
  if (!message || typeof message !== "object" || typeof message.type !== "string") return null;
  switch (message.type) {
    case "getState":
      if (message.tabId !== undefined && !(Number.isInteger(message.tabId) && message.tabId >= 0)) return null;
      return { type: "getState", tabId: message.tabId ?? null };
    case "setEnabled":
      return typeof message.enabled === "boolean" ? { type: "setEnabled", enabled: message.enabled } : null;
    case "setRule": {
      const mode = message.mode;
      if (typeof message.site !== "string" || message.site.length > 2048) return null;
      if (mode !== MODES.DEFAULT && !RULE_MODES.has(mode)) return null;
      return { type: "setRule", site: message.site, mode };
    }
    case "clearRecent":
      return { type: "clearRecent" };
    case "openBlocked":
      return typeof message.id === "string" && /^[a-z0-9-]{1,64}$/.test(message.id)
        ? { type: "openBlocked", id: message.id, tabId: Number.isInteger(message.tabId) ? message.tabId : null }
        : null;
    default:
      return null;
  }
}
