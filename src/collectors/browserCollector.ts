import { chromium, type Browser, type BrowserContext } from "playwright";
import { config } from "../config.js";
import type { PageSignals } from "../types.js";
import { extractFromHtml } from "./extractHtml.js";

const browsers = new Map<string, Promise<Browser>>();

function getBrowser(variant: "default" | "no-http2"): Promise<Browser> {
  let b = browsers.get(variant);
  if (!b) {
    const args = variant === "no-http2" ? ["--disable-http2"] : [];
    b = chromium.launch({ headless: true, args });
    browsers.set(variant, b);
  }
  return b;
}

export async function openBrowser(): Promise<void> {
  await getBrowser("default");
}

export async function closeBrowser(): Promise<void> {
  for (const b of browsers.values()) await (await b).close().catch(() => {});
  browsers.clear();
}

export type BrowserResult = PageSignals & { finalUrl: string; notes: string[] };

export async function collectBrowser(url: string, jsChains: string[]): Promise<BrowserResult> {
  try {
    return await visit(url, jsChains, "default");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ERR_HTTP2_PROTOCOL_ERROR|ERR_SPDY|ERR_QUIC/i.test(msg)) {
      const r = await visit(url, jsChains, "no-http2");
      r.notes.push("retried with HTTP/2 disabled");
      return r;
    }
    throw e;
  }
}

async function visit(url: string, jsChains: string[], variant: "default" | "no-http2"): Promise<BrowserResult> {
  const browser = await getBrowser(variant);
  const context: BrowserContext = await browser.newContext({
    userAgent: config.userAgent,
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const guard = setTimeout(() => context.close().catch(() => {}), config.browserHardTimeoutMs);
  const notes: string[] = [];
  try {
    const page = await context.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    const hosts = new Set<string>();
    const scriptUrls = new Set<string>();
    const scriptBodies: string[] = [];
    const cssBodies: string[] = [];
    let captured = 0;
    page.on("request", (req) => {
      try {
        const u = new URL(req.url());
        if (u.protocol.startsWith("http")) {
          hosts.add(u.hostname);
          if (req.resourceType() === "script") scriptUrls.add(req.url());
        }
      } catch {}
    });
    page.on("response", async (res) => {
      const t = res.request().resourceType();
      if ((t !== "script" && t !== "stylesheet") || captured > config.maxCapturedBodyBytes) return;
      try {
        const body = await res.text();
        const slice = body.slice(0, config.maxInlineScriptBytes);
        captured += slice.length;
        (t === "script" ? scriptBodies : cssBodies).push(slice);
      } catch {}
    });
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      return t === "image" || t === "media" || t === "font" ? route.abort() : route.continue();
    });

    let response = null;
    try {
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.browserTimeoutMs });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/Timeout/i.test(msg)) throw e;
      notes.push("navigation timed out, used partially loaded page");
    }
    await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(config.browserSettleMs);

    const headers: Record<string, string[]> = {};
    if (response) {
      for (const [k, v] of Object.entries(await response.allHeaders().catch(() => ({})))) {
        if (k !== "set-cookie") headers[k.toLowerCase()] = [v];
      }
    }
    const cookies: Record<string, string> = {};
    for (const c of await context.cookies()) cookies[c.name] = c.value;

    let html = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        html = await page.content();
        break;
      } catch {
        await page.waitForTimeout(1500);
      }
    }
    html = html.slice(0, config.maxHtmlBytes);

    const js = await page
      .evaluate((chains: string[]) => {
        const out: Record<string, string> = {};
        for (const chain of chains) {
          try {
            let cur: any = window;
            let ok = true;
            for (const part of chain.split(".")) {
              if (cur === null || cur === undefined || !(part in Object(cur))) {
                ok = false;
                break;
              }
              cur = cur[part];
            }
            if (!ok || cur === undefined || cur === null) continue;
            const t = typeof cur;
            out[chain] = t === "string" || t === "number" || t === "boolean" ? String(cur) : "";
          } catch {}
        }
        return out;
      }, jsChains)
      .catch(() => ({}) as Record<string, string>);

    const finalUrl = page.url();
    const extracted = extractFromHtml(html, finalUrl);
    return {
      layer: "browser",
      finalUrl,
      notes,
      url: finalUrl,
      headers,
      cookies,
      html,
      js,
      xhr: [...hosts],
      ...extracted,
      externalScripts: scriptBodies,
      externalCss: cssBodies,
      scriptSrc: [...new Set([...(extracted.scriptSrc ?? []), ...scriptUrls])],
    };
  } finally {
    clearTimeout(guard);
    await context.close().catch(() => {});
  }
}
