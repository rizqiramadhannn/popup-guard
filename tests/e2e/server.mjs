// Fixture server for the live smoke test. Chrome maps every *.test host to
// 127.0.0.1 (--host-resolver-rules), and pages are chosen by Host header.
import http from "node:http";

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body>${body}</body>`;

export function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const host = url.hostname;
    const port = url.port;
    const at = (name) => `http://${name}:${port}`;
    const send = (html) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
    };
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: url.searchParams.get("to") });
      return res.end();
    }
    if (host.endsWith("site-one.test") && url.pathname === "/") {
      return send(
        page(
          "Opener",
          `<h1>Opener</h1>
          <button id="open-cross" onclick="window.open('${at("ads.other.test")}/ad.html')">cross</button>
          <button id="open-cross-noopener" onclick="window.open('${at("ads.other.test")}/noopener.html','_blank','noopener')">noopener</button>
          <button id="open-same" onclick="window.open('${at("www.site-one.test")}/same.html')">same</button>
          <button id="open-blank" onclick="const w = window.open(''); w.location.href = '${at("ads.other.test")}/late.html'">blank</button>
          <button id="open-redirector" onclick="window.open('/redirect?to=${encodeURIComponent(at("ads.other.test") + "/redirected.html")}')">redirector</button>
          <p><a id="link-cross" target="_blank" href="${at("partner.other.test")}/partner.html">Partner link</a></p>
          <p><a id="link-menu-abuse" href="${at("ads.other.test")}/menu-abuse.html" oncontextmenu="window.open(this.href)">Right-click me</a></p>
          <p><a id="link-same" target="_blank" href="${at("www.site-one.test")}/same-link.html">Same-site link</a></p>
          <form id="form" target="_blank" action="${at("search.other.test")}/find"><input name="q" value="x"><button id="form-submit">Search</button></form>
          <form id="form-named" target="results" action="${at("search.other.test")}/named"><input name="q" value="x"><button id="form-named-submit">Named</button></form>
          <iframe id="ad-frame" src="${at("frame.other.test")}/frame.html" width="300" height="80"></iframe>`,
        ),
      );
    }
    if (host.endsWith("site-one.test") && url.pathname === "/overlay") {
      return send(
        page(
          "Overlay",
          `<p>Article text</p><a id="overlay" target="_blank" href="${at("ads.other.test")}/overlay-ad.html" style="position:fixed;inset:0;opacity:0">ad</a>`,
        ),
      );
    }
    if (host === "frame.other.test") {
      return send(page("Ad frame", `<button id="frame-open" onclick="window.open('${at("ads.other.test")}/frame-ad.html')">frame</button>`));
    }
    send(page(url.pathname, `<p>${host}${url.pathname}</p>`));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
