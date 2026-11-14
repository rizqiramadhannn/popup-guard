// Pure popup decision. No browser APIs here, so it is unit tested directly.

/** Per-site modes. A site without a rule uses DEFAULT. */
export const MODES = Object.freeze({
  DEFAULT: "default", // block cross-site popups that were not a user's link click
  ALLOW: "allow", // allow every popup from this site (whitelist)
  BLOCK: "block", // block every popup from this site except explicit new-tab link gestures
});

export const RULE_MODES = new Set([MODES.ALLOW, MODES.BLOCK]);

/**
 * User intent recorded by the isolated content script from a trusted event:
 * - "explicit": Ctrl/Cmd/Shift-click, middle-click, or the link context menu
 * - "link":     a plain click on a visible link (or form submit) to this URL
 * - null:       no matching user gesture on a link
 */

/**
 * @param {object} input
 * @param {boolean} input.enabled       global switch
 * @param {string} input.mode           MODES value for the source site
 * @param {string|null} input.sourceSite site of the opener tab's top-level page
 * @param {{kind:string, site?:string}} input.destination from classifyUrl()
 * @param {"explicit"|"link"|null} input.intent
 * @returns {{action:"allow"|"block"|"watch", reason:string}}
 *   "watch" means: the popup has no destination yet (about:blank); judge its next navigation.
 */
export function decide({ enabled, mode, sourceSite, destination, intent }) {
  if (!enabled) return { action: "allow", reason: "disabled" };
  if (!sourceSite) return { action: "allow", reason: "unsupported-source" };
  if (mode === MODES.ALLOW) return { action: "allow", reason: "site-allowed" };
  if (destination.kind === "extension") return { action: "allow", reason: "extension-page" };
  if (intent === "explicit") return { action: "allow", reason: "user-new-tab" };
  if (mode === MODES.BLOCK) return { action: "block", reason: "site-blocks-all" };
  if (intent === "link") return { action: "allow", reason: "user-link" };
  if (destination.kind === "blank") return { action: "watch", reason: "pending-destination" };
  if (destination.kind === "web" && destination.site === sourceSite) return { action: "allow", reason: "same-site" };
  return { action: "block", reason: "cross-site" };
}

/** Normalizes a URL for comparing a recorded link click with the opened URL. */
export function comparableUrl(input) {
  try {
    const url = new URL(input);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Origin and path only, for form submissions whose query is added by the browser. */
export function comparableFormTarget(input) {
  try {
    const url = new URL(input);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Finds the strongest recorded intent that matches `url`.
 * @param {Array<{kind:string, href:string, at:number, form?:boolean}>} intents
 */
export function matchIntent(intents, url, now) {
  const exact = comparableUrl(url);
  const formTarget = comparableFormTarget(url);
  let best = null;
  for (const intent of intents) {
    if (intent.expires < now) continue;
    const matches = intent.form ? comparableFormTarget(intent.href) === formTarget : comparableUrl(intent.href) === exact;
    if (!matches || exact === null) continue;
    if (intent.kind === "explicit") return "explicit";
    if (intent.kind === "link") best = "link";
  }
  return best;
}
