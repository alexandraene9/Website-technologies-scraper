import * as cheerio from "cheerio";
import { config } from "../config.js";
import type { PageSignals } from "../types.js";

export function extractFromHtml(html: string, baseUrl: string): Partial<PageSignals> {
  const $ = cheerio.load(html);
  const meta: Record<string, string[]> = {};
  $("meta").each((_i, el) => {
    const key = ($(el).attr("name") ?? $(el).attr("property") ?? $(el).attr("http-equiv") ?? $(el).attr("itemprop"))?.toLowerCase();
    const content = $(el).attr("content");
    if (key && content !== undefined) (meta[key] ??= []).push(content);
  });
  const scriptSrc: string[] = [];
  const scripts: string[] = [];
  $("script").each((_i, el) => {
    const src = $(el).attr("src");
    if (src) scriptSrc.push(absolutize(src, baseUrl));
    else {
      const code = $(el).html() ?? "";
      if (code.trim()) scripts.push(code.slice(0, config.maxInlineScriptBytes));
    }
  });
  const css: string[] = [];
  $("style").each((_i, el) => {
    const c = $(el).html();
    if (c) css.push(c.slice(0, config.maxInlineScriptBytes));
  });
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 200_000);
  return { meta, scriptSrc: [...new Set(scriptSrc)], scripts, css, text };
}

function absolutize(src: string, base: string): string {
  try {
    return new URL(src, base).href;
  } catch {
    return src;
  }
}
