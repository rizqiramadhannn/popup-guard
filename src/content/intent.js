// Popup Guard content script (isolated world, every frame).
//
// It only reports trusted user gestures on links and forms, so the service
// worker can tell "the user opened this link in a new tab" apart from a script
// opening a window. Page scripts cannot fire trusted events, cannot call
// extension APIs, and cannot see this world's variables. Nothing is read from
// or written to the page beyond the clicked element's URL and geometry.
(() => {
  const VIEWPORT_SHARE_LIMIT = 0.4; // a "link" covering more of the screen looks like a click-jacking overlay
  const MIN_OPACITY = 0.05;

  function report(kind, href, form) {
    try {
      chrome.runtime.sendMessage({ type: "intent", kind, href, form: Boolean(form) }).catch(() => {});
    } catch {
      // The extension was reloaded; this frame's script is orphaned.
    }
  }

  function webUrl(value, base) {
    try {
      const url = new URL(value, base);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function linkIn(event) {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      const name = node.localName;
      if ((name === "a" || name === "area") && node.hasAttribute("href")) return node;
    }
    return null;
  }

  function hrefOf(link) {
    const href = link.href;
    if (typeof href === "string") return webUrl(href, document.baseURI);
    if (href && typeof href.baseVal === "string") return webUrl(href.baseVal, document.baseURI); // SVG <a>
    return null;
  }

  function looksIntended(link) {
    const rect = link.getBoundingClientRect();
    const viewport = Math.max(1, window.innerWidth * window.innerHeight);
    if (rect.width * rect.height > VIEWPORT_SHARE_LIMIT * viewport) return false;
    let node = link;
    for (let depth = 0; node instanceof Element && depth < 8; depth++, node = node.parentElement) {
      const style = getComputedStyle(node);
      if (Number(style.opacity) < MIN_OPACITY || style.visibility === "hidden") return false;
    }
    return true;
  }

  window.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted || event.button !== 0) return;
      const link = linkIn(event);
      const href = link && hrefOf(link);
      if (!href) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey) report("explicit", href);
      else if (looksIntended(link)) report("link", href);
    },
    true,
  );

  // Middle-click opens a link in a new tab.
  window.addEventListener(
    "auxclick",
    (event) => {
      if (!event.isTrusted || event.button !== 1) return;
      const link = linkIn(event);
      const href = link && hrefOf(link);
      if (href) report("explicit", href);
    },
    true,
  );

  // The context menu offers "Open link in new tab/window", but the extension cannot
  // see which menu item was chosen, and the page's own contextmenu handler could
  // open the link instead. So a right-click counts like a plain click ("menu"):
  // allowed in default mode, still blocked when the site is set to block all.
  window.addEventListener(
    "contextmenu",
    (event) => {
      if (!event.isTrusted) return;
      const link = linkIn(event);
      const href = link && hrefOf(link);
      if (href && looksIntended(link)) report("menu", href);
    },
    true,
  );

  // A form whose submission targets a new tab, submitted by the user.
  window.addEventListener(
    "submit",
    (event) => {
      if (!event.isTrusted) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const submitter = event.submitter;
      const target = submitter?.getAttribute("formtarget") ?? form.getAttribute("target") ?? "";
      // Only "_blank" always opens a new tab. A named target may reuse an existing
      // window, and a report for it would linger and could excuse a script popup.
      if (target.trim().toLowerCase() !== "_blank") return;
      const action = webUrl(submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? "", document.baseURI);
      if (action) report("link", action, true);
    },
    true,
  );
})();
