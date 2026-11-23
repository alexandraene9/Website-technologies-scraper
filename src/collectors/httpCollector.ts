import { Agent, fetch } from "undici";
import { config } from "../config.js";
import type { PageSignals } from "../types.js";
import { extractFromHtml } from "./extractHtml.js";

export interface HttpResult {
  signals: PageSignals;
  finalUrl: string;
  status: number;
  tried: string[];
}

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false }, connectTimeout: config.httpTimeoutMs });

export async function collectHttp(domain: string): Promise<HttpResult> {
  const candidates = [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`, `http://www.${domain}/`];
  const errors: string[] = [];
  for (const start of candidates) {
    try {
      return await fetchPage(start, candidates.slice(0, candidates.indexOf(start) + 1));
    } catch (e) {
      errors.push(`${start}: ${errMsg(e)}`);
    }
  }
  throw new Error(errors.join(" | "));
}

export async function fetchPage(startUrl: string, tried: string[], withRobots = true): Promise<HttpResult> {
  const headers: Record<string, string[]> = {};
  const cookies: Record<string, string> = {};
  const urls: string[] = [];
  let url = startUrl;
  let res: Awaited<ReturnType<typeof fetch>> | null = null;
  for (let hop = 0; hop < 10; hop++) {
    urls.push(url);
    res = await fetch(url, {
      dispatcher: insecureAgent,
      redirect: "manual",
      signal: AbortSignal.timeout(config.httpTimeoutMs),
      headers: {
        "user-agent": config.userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": config.acceptLanguage,
        cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    res.headers.forEach((v, k) => {
      if (k !== "set-cookie") (headers[k] ??= []).push(v);
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const eq = pair!.indexOf("=");
      if (eq > 0) cookies[pair!.slice(0, eq).trim()] = pair!.slice(eq + 1).trim();
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel();
      url = new URL(loc, url).href;
      continue;
    }
    break;
  }
  if (!res) throw new Error("no response");
  const buf = Buffer.from(await res.arrayBuffer());
  const html = buf.subarray(0, config.maxHtmlBytes).toString("utf8");
  const extracted = extractFromHtml(html, url);
  const robots = withRobots ? await fetchRobots(url) : undefined;
  return {
    finalUrl: url,
    status: res.status,
    tried,
    signals: { layer: "http", url, urls, headers, cookies, html, robots, ...extracted },
  };
}

async function fetchRobots(pageUrl: string): Promise<string | undefined> {
  try {
    // robots.txt is optional, so a failed request should not fail the whole HTTP layer
    const u = new URL("/robots.txt", pageUrl).href;
    const r = await fetch(u, {
      dispatcher: insecureAgent,
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": config.userAgent },
    });
    if (!r.ok) return undefined;
    const t = await r.text();
    return /user-agent|disallow|sitemap/i.test(t) ? t.slice(0, 50_000) : undefined;
  } catch {
    return undefined;
  }
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as any).cause;
    return cause?.code ? `${e.message} (${cause.code})` : e.message;
  }
  return String(e);
}
