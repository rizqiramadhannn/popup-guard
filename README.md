# Popup Guard

A Chrome and Microsoft Edge extension (Manifest V3) that closes popups and new
windows that a page opens to **another site**. Windows to the same site and
links you click yourself keep working. Per site you can **allow** popups
(whitelist) or **block all** popups.

No account, no analytics, no network requests. Everything stays in your browser.

## Install (Load unpacked)

1. Download `popup-guard-1.0.0.zip` and extract it to a folder you will keep,
   for example `Documents\popup-guard`. The browser loads the extension from
   that folder, so do not delete it afterwards.
2. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode** (top right in Chrome, left sidebar in Edge).
4. Click **Load unpacked** and select the extracted folder, the one that
   contains `manifest.json`.
5. Optional: pin **Popup Guard** from the puzzle-piece (Extensions) menu so its
   icon and blocked-popup count stay visible.

To update, replace the folder's contents with the new version and click the
reload button on the extension's card. Settings are kept.

Chrome may show a reminder about developer-mode extensions. That is expected for
extensions that are not installed from a store.

## Use it

Click the toolbar icon on any web page:

| Choice | What happens on this site |
| --- | --- |
| **Block cross-site popups** (default) | New tabs or windows that the page opens to another site are closed. Same-site windows and links you click stay allowed. |
| **Block all popups** | Every new tab or window the page opens is closed, including same-site ones and plain clicks on new-tab links. Ctrl/⌘-click, Shift-click, middle-click and the “Open link in new tab” menu still work. |
| **Allow popups** | Whitelist: nothing is blocked on this site. Use it for sign-in, payment, chat or video windows a site needs. |

The badge on the icon counts popups blocked on the current tab. The panel lists
them; **Open** opens a blocked popup once, without changing your rules.

**Settings & site rules** (or the extension's Options) lists every rule, lets
you add, change and remove rules, turns Popup Guard off globally, and shows the
recent blocked log.

### What counts as the same site

Rules and the cross-site test use the *site*, the registrable domain from the
[Public Suffix List](https://publicsuffix.org/):

- `www.example.co.uk` and `shop.example.co.uk` are the same site, `example.co.uk`.
- `alice.github.io` and `bob.github.io` are different sites (private suffixes are included).
- Scheme and port are ignored: `http://example.com:8080` and `https://example.com` are one site.
- IP addresses (`192.168.1.10`, `[::1]`) and single-label hosts (`localhost`) are their own site.
- A rule is about the page that opens the popup, and covers its subdomains.

## How it works

Manifest V3 has no blocking `webRequest`, and `declarativeNetRequest` cannot tell
a popup apart from a normal navigation. Patching `window.open` in the page is
easy for pages to undo and misses `target=_blank` links, forms and popups from
cross-origin iframes. Popup Guard therefore works at the browser level:

1. `chrome.webNavigation.onCreatedNavigationTarget` reports every new tab or
   window that a page's frame creates for a navigation, including `window.open`
   (with or without `noopener`), `target=_blank` links and forms, and popups
   from cross-origin ad iframes, together with the opener tab.
2. The service worker reads the opener tab's top-level URL with
   `webNavigation.getFrame`, applies the site's rule, and closes the new tab
   with `chrome.tabs.remove` when it should be blocked.
3. A small content script in the **isolated world** reports only *trusted* user
   gestures on links and forms (the browser marks them `isTrusted`; page scripts
   cannot fake them or reach the extension's messaging). This is how a link you
   click is told apart from a script opening a window. Links that cover most of
   the screen or are invisible are not treated as intended clicks
   (click-jacking overlays).
4. A popup that starts as `about:blank` is judged by its first real destination.
   A same-site popup that is server- or client-redirected to another site within
   10 seconds is closed.

`window.open` is never patched and nothing runs in the page's main world.

### Permissions

| Permission | Why | Chrome's warning |
| --- | --- | --- |
| `webNavigation` | See which tab opened a new tab and where it navigates. | Read your browsing history |
| `storage` | Save rules, the on/off switch and the blocked log. | none |
| Content script on `http://*/*`, `https://*/*` | Report trusted link clicks and form submits so they are not mistaken for popups. | Read and change all your data on all websites |

There are no `tabs` or `host_permissions` entries, no remote code, and no network access.

### Privacy

- Stored on this device (`chrome.storage.local`): rules, the on/off switch, a
  total count, and the last 30 blocks as *time, opener site, blocked origin
  (scheme, host, port), reason*. Paths and query strings are not stored.
- Kept in memory only (`chrome.storage.session`, cleared when the browser
  closes): the full address of recent blocked popups, so **Open** can reopen
  them, and per-tab counts.
- Nothing is sent anywhere.

## Limits

- A blocked window exists for a moment before it is closed. The other site may
  already have received the request (for example an ad impression).
- In-page overlays, modal dialogs, notification prompts and “tab-unders” (the
  current tab redirected to an ad while your page opens in a new tab) are not
  popups and are not handled.
- Browser pages (`chrome://`, `edge://`, the web stores) and `file://` pages are
  out of reach. Popups that the browser's built-in popup blocker already stopped
  never reach the extension.
- Cross-site sign-in popups (“Sign in with Google”, payment windows) are blocked
  by default. Choose **Allow popups** for that site, or use **Open** in the panel.
- In the default mode, a visible `target=_blank` link that you click is allowed
  even if it leads to an ad. Use **Block all popups** on sites that do this.
- The click report and the popup event are separate. Popup Guard waits up to
  300 ms for the click report before closing a window; on a very slow machine a
  clicked link could rarely be closed. Ctrl/middle-click are unaffected in practice.
- Popups opened by other extensions' pages, or created by the browser itself,
  are not judged. If the opener's site cannot be read, the popup is allowed
  (fail open).
- Tested in Chrome 157. Edge uses the same Chromium extension APIs but was not
  tested separately in this release.

## Development

Requirements: Node.js 22+, Chrome or Edge for the live test.

```sh
npm install            # dev dependency for tests only
npm test               # unit tests (site matching, decisions, validation, storage queue)
npm run check          # manifest, permissions, no remote/dynamic code
npm run test:e2e       # live smoke test in a throwaway Chrome profile
npm run package        # dist/popup-guard-<version>.zip and .sha256
npm run update-psl     # refresh the Public Suffix List data
```

`npm run test:e2e` starts a local fixture server, maps every `*.test` host to it
with `--host-resolver-rules`, loads the extension into a temporary profile over
the DevTools pipe (branded Chrome 137+ ignores `--load-extension`), and clicks
real buttons, links, forms and an ad iframe. It never touches your normal
browser profile. Set `CHROME` to another Chromium browser, or `EXT_DIR` to test
an extracted package. Screenshots and a JSON report go to `tests/e2e/output/`.

Layout:

```
manifest.json
src/background.js        service worker: detection, decisions, closing, log
src/content/intent.js    isolated-world gesture reporter
src/lib/site.js          Public Suffix List site matching
src/lib/decision.js      pure decision rules
src/lib/messages.js      sender and message validation
src/lib/store.js         serialized storage updates
src/ui/                  toolbar popup and options page
tests/unit/              node:test unit tests
tests/e2e/               live smoke test and fixture server
```

## License

MIT. The bundled Public Suffix List data is MPL-2.0; see [THIRD_PARTY.md](THIRD_PARTY.md).
