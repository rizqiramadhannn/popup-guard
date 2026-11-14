// Site identity for rules and the cross-site test.
//
// A "site" is the registrable domain (eTLD+1) from the Public Suffix List,
// including its private section, so `alice.github.io` and `bob.github.io` are
// different sites while `www.example.co.uk` and `shop.example.co.uk` are the
// same site. Scheme and port are ignored: http://example.com:8080 and
// https://example.com share one site. IP addresses and single-label hosts such
// as `localhost` are their own site.
import { PSL_RULES } from "./psl-data.js";

let tables = null;
function rules() {
  if (tables) return tables;
  const exact = new Set();
  const wildcard = new Set();
  const exception = new Set();
  for (const rule of PSL_RULES.split("\n")) {
    if (rule.startsWith("!")) exception.add(rule.slice(1));
    else if (rule.startsWith("*.")) wildcard.add(rule.slice(2));
    else exact.add(rule);
  }
  tables = { exact, wildcard, exception };
  return tables;
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/;

/** The site of an ASCII hostname, as given by `URL.hostname`, or null. */
export function siteForHost(hostname) {
  if (typeof hostname !== "string") return null;
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  if (host.startsWith("[") && host.endsWith("]")) return host; // IPv6 literal
  if (IPV4.test(host)) return host;
  if (!HOST.test(host)) return null;
  const labels = host.split(".");
  if (labels.length === 1) return host;
  const { exact, wildcard, exception } = rules();
  let suffixLength = 1; // the implicit "*" rule
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join(".");
    if (exception.has(candidate)) {
      suffixLength = labels.length - i - 1;
      break;
    }
    if (exact.has(candidate) || (i + 1 < labels.length && wildcard.has(labels.slice(i + 1).join(".")))) {
      suffixLength = labels.length - i;
      break;
    }
  }
  // A host that is itself a public suffix (for example `github.io`) is its own site.
  if (suffixLength >= labels.length) return host;
  return labels.slice(labels.length - suffixLength - 1).join(".");
}

/**
 * Classifies a URL for popup decisions.
 * - { kind: "web", site }       http(s) URL with a site
 * - { kind: "blank" }           about:blank, about:srcdoc, javascript: or empty: content may follow later
 * - { kind: "extension" }       a chrome-extension:// page, left to that extension
 * - { kind: "other" }           data:, file:, other schemes, or unparsable input
 */
export function classifyUrl(input) {
  if (typeof input !== "string" || input === "") return { kind: "blank" };
  let url;
  try {
    url = new URL(input);
  } catch {
    return { kind: "other" };
  }
  switch (url.protocol) {
    case "http:":
    case "https:": {
      const site = siteForHost(url.hostname);
      return site ? { kind: "web", site } : { kind: "other" };
    }
    case "blob:": {
      // A blob URL belongs to the origin that created it.
      const inner = classifyUrl(url.pathname);
      return inner.kind === "web" ? inner : { kind: "other" };
    }
    case "about:":
    case "javascript:":
      return { kind: "blank" };
    case "chrome-extension:":
    case "extension:":
      return { kind: "extension" };
    default:
      return { kind: "other" };
  }
}

/** The site of an http(s) page URL, or null for anything else. */
export function siteForPageUrl(input) {
  const result = classifyUrl(input);
  return result.kind === "web" ? result.site : null;
}

/**
 * Turns user input such as "news.example.co.uk", "https://example.com/path" or
 * "192.168.1.10:8080" into a site, or null when it is not a web site.
 */
export function siteFromUserInput(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  return siteForPageUrl(withScheme);
}

/** True when `site` is already a normalized site value. */
export function isSite(value) {
  return typeof value === "string" && siteForHost(value) === value;
}

/** Origin for display and logs: scheme, host and port only, never path or query. */
export function displayOrigin(input) {
  try {
    const url = new URL(input);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    if (url.protocol === "about:") return "about:blank";
    return `${url.protocol}…`;
  } catch {
    return "(unknown)";
  }
}
