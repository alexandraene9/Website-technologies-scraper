import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFingerprints } from "../src/engine/loadFingerprints.js";
import { detect } from "../src/engine/matcher.js";
import { extractFromHtml } from "../src/collectors/extractHtml.js";
import { resolveVersion } from "../src/engine/patternParser.js";

const db = loadFingerprints("data/fingerprints");

const html = `<!doctype html><html><head>
<meta name="generator" content="WordPress 6.4.2">
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
<link rel="stylesheet" href="/wp-content/themes/x/style.css">
</head><body><p>Hello</p></body></html>`;

const page = {
  layer: "http" as const,
  url: "https://example.com/",
  headers: { server: ["cloudflare"], "cf-ray": ["8abc-OTP"] },
  cookies: {},
  html,
  ...extractFromHtml(html, "https://example.com/"),
};

test("detects WordPress with version from meta generator", () => {
  const d = detect(db, [page]);
  const wp = d.find((t) => t.name === "WordPress");
  assert.ok(wp, "WordPress missing");
  assert.equal(wp.version, "6.4.2");
  assert.ok(wp.evidence.some((e) => e.type === "meta" && e.key === "generator"));
});

test("detects jQuery with version from scriptSrc", () => {
  const jq = detect(db, [page]).find((t) => t.name === "jQuery");
  assert.ok(jq);
  assert.equal(jq.version, "3.7.1");
});

test("detects Cloudflare from headers and implied PHP from WordPress", () => {
  const d = detect(db, [page]);
  assert.ok(d.find((t) => t.name === "Cloudflare"));
  const php = d.find((t) => t.name === "PHP");
  assert.ok(php);
  assert.ok(php.impliedBy?.includes("WordPress") || php.evidence.length > 0);
});

test("detects Google Workspace from MX and Shopify from js + headers", () => {
  const d = detect(db, [
    { layer: "dns", dns: { MX: ["aspmx.l.google.com"] } },
    { layer: "browser", js: { ShopifyAnalytics: "" }, headers: { "x-shopify-stage": ["production"] } },
  ]);
  assert.ok(d.find((t) => t.name === "Google Workspace"));
  const s = d.find((t) => t.name === "Shopify");
  assert.ok(s);
  assert.equal(s.confidence, 100);
});

test("version template ternary", () => {
  const m = /v(\d+)?/.exec("v")!;
  assert.equal(resolveVersion("\\1?yes:no", m), "no");
  const m2 = /v(\d+)?/.exec("v12")!;
  assert.equal(resolveVersion("\\1?yes:no", m2), "yes");
  assert.equal(resolveVersion("\\1", m2), "12");
});

test("selector prefilter keeps possible matches and skips impossible ones", async () => {
  const { buildPrefilter, mayMatch, HtmlIndex } = await import("../src/engine/selectorPrefilter.js");
  const idx = new HtmlIndex('<link href="https://cdn.shopify.com/x.css"><div id="main-wrap" class="elementor-widget"></div>'.toLowerCase());
  assert.equal(mayMatch(buildPrefilter("link[href*='shopify.com']"), idx), true);
  assert.equal(mayMatch(buildPrefilter("div[class*='elementor']"), idx), true);
  assert.equal(mayMatch(buildPrefilter("#main-wrap, iframe[src*='hubspot']"), idx), true);
  assert.equal(mayMatch(buildPrefilter("iframe[src*='hubspot.com']"), idx), false);
  assert.equal(mayMatch(buildPrefilter("body > div"), idx), true);
});

test("extra pages prefer shop, cart, blog and contact links on the same site", async () => {
  const { pickInternalPages } = await import("../src/collectors/pagesCollector.js");
  const html = `<a href="/">Home</a><a href="/about-us">About</a><a href="https://other.com/products/x">Ext</a>
    <a href="/collections/all">Shop</a><a href="/files/brochure.pdf">PDF</a><a href="https://www.example.com/cart">Cart</a>
    <a href="mailto:a@example.com">Mail</a><a href="/blog/post-1">Blog</a>`;
  const picked = pickInternalPages(html, "https://example.com/", 3);
  assert.deepEqual(picked, ["https://example.com/collections/all", "https://www.example.com/cart", "https://example.com/blog/post-1"]);
});
