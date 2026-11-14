import { test } from "node:test";
import assert from "node:assert/strict";
import { siteForHost, classifyUrl, siteForPageUrl, siteFromUserInput, isSite, displayOrigin } from "../../src/lib/site.js";

test("registrable domains from the Public Suffix List", () => {
  assert.equal(siteForHost("www.example.com"), "example.com");
  assert.equal(siteForHost("a.b.c.example.com"), "example.com");
  assert.equal(siteForHost("shop.example.co.uk"), "example.co.uk");
  assert.equal(siteForHost("Example.COM."), "example.com");
});

test("private suffixes keep tenants apart", () => {
  assert.equal(siteForHost("alice.github.io"), "alice.github.io");
  assert.equal(siteForHost("x.alice.github.io"), "alice.github.io");
  assert.notEqual(siteForHost("alice.github.io"), siteForHost("bob.github.io"));
  assert.equal(siteForHost("github.io"), "github.io");
});

test("wildcard and exception rules", () => {
  // *.kawasaki.jp with !city.kawasaki.jp
  assert.equal(siteForHost("www.city.kawasaki.jp"), "city.kawasaki.jp");
  assert.equal(siteForHost("a.b.kawasaki.jp"), "a.b.kawasaki.jp");
  // *.ck with !www.ck
  assert.equal(siteForHost("a.www.ck"), "www.ck");
});

test("IP addresses, IPv6 and single-label hosts are their own site", () => {
  assert.equal(siteForHost("192.168.1.20"), "192.168.1.20");
  assert.equal(siteForHost("[2001:db8::1]"), "[2001:db8::1]");
  assert.equal(siteForHost("localhost"), "localhost");
  assert.equal(siteForHost("intranet"), "intranet");
});

test("unknown TLDs fall back to the last label", () => {
  assert.equal(siteForHost("a.site-one.test"), "site-one.test");
});

test("internationalized domains arrive as punycode from URL", () => {
  const host = new URL("https://www.例え.jp/").hostname;
  assert.equal(siteForHost(host), host.replace(/^www\./, ""));
  assert.equal(siteForPageUrl("https://shop.xn--fiqs8s/"), "shop.xn--fiqs8s");
});

test("scheme and port do not change the site", () => {
  assert.equal(siteForPageUrl("http://example.com:8080/a"), siteForPageUrl("https://www.example.com/b"));
});

test("invalid hosts are rejected", () => {
  assert.equal(siteForHost(""), null);
  assert.equal(siteForHost("bad host"), null);
  assert.equal(siteForHost("a".repeat(300)), null);
  assert.equal(siteForHost(undefined), null);
});

test("URL classification", () => {
  assert.deepEqual(classifyUrl("https://ads.example.net/x?y"), { kind: "web", site: "example.net" });
  assert.deepEqual(classifyUrl("about:blank"), { kind: "blank" });
  assert.deepEqual(classifyUrl(""), { kind: "blank" });
  assert.deepEqual(classifyUrl("javascript:void(0)"), { kind: "blank" });
  assert.deepEqual(classifyUrl("blob:https://cdn.example.org/1234"), { kind: "web", site: "example.org" });
  assert.deepEqual(classifyUrl("data:text/html,hi"), { kind: "other" });
  assert.deepEqual(classifyUrl("chrome-extension://abc/page.html"), { kind: "extension" });
  assert.deepEqual(classifyUrl("not a url"), { kind: "other" });
  assert.equal(siteForPageUrl("file:///C:/x.html"), null);
});

test("user input normalization", () => {
  assert.equal(siteFromUserInput(" news.example.co.uk "), "example.co.uk");
  assert.equal(siteFromUserInput("https://Example.com/path?q=1"), "example.com");
  assert.equal(siteFromUserInput("192.168.1.10:8080"), "192.168.1.10");
  assert.equal(siteFromUserInput("localhost:3000"), "localhost");
  assert.equal(siteFromUserInput("two words"), null);
  assert.equal(siteFromUserInput("ftp://example.com"), null);
  assert.equal(siteFromUserInput(""), null);
  assert.ok(isSite("example.com"));
  assert.ok(!isSite("www.example.com"));
});

test("display origins never include path or query", () => {
  assert.equal(displayOrigin("https://ads.example.net:8443/track?id=secret#x"), "https://ads.example.net:8443");
  assert.equal(displayOrigin("about:blank"), "about:blank");
  assert.equal(displayOrigin("data:text/html,secret"), "data:…");
});
