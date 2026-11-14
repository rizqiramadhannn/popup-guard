// Shared helpers for the popup and options pages.

export async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? "Popup Guard did not respond.");
  return response;
}

export const MODE_TEXT = {
  default: {
    label: "Block cross-site popups",
    hint: "Default. Windows to the same site and links you click stay allowed.",
  },
  block: {
    label: "Block all popups",
    hint: "Also blocks same-site windows, plain new-tab links and “Open link in new tab” from the menu. Ctrl/⌘-click and middle-click still work.",
  },
  allow: {
    label: "Allow popups",
    hint: "Whitelist. Popup Guard never blocks popups opened by this site.",
  },
};

export const REASON_TEXT = {
  "cross-site": "Opened another site",
  "site-blocks-all": "Site set to block all",
  "pending-destination": "Blank window redirected",
};

export function reasonText(reason) {
  return REASON_TEXT[reason] ?? reason;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function formatTime(ms, withDate = false) {
  return (withDate ? dateFormat : timeFormat).format(new Date(ms));
}

/** Creates an element with text content only (never HTML from data). */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function announce(target, message) {
  target.textContent = "";
  // A fresh text node makes screen readers announce repeated messages.
  requestAnimationFrame(() => (target.textContent = message));
}
