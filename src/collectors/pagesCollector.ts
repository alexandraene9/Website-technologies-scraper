import * as cheerio from "cheerio";
import { config } from "../config.js";
import type { PageSignals } from "../types.js";
import { fetchPage } from "./httpCollector.js";

const INTERESTING = [
  /\/(?:products?|produkt[e]?|produits?|prodotti|productos|shop|store|boutique|tienda|negozio|collections?)(?:\/|$)/i,
  /\/(?:cart|basket|checkout|warenkorb|panier|carrello|carrito)(?:\/|$)/i,
  /\/(?:blog|news|aktuelles|actualites|noticias|articles?)(?:\/|$)/i,
  /\/(?:contact|kontakt|contatti|contacto|about|uber-uns|ueber-uns|a-propos|chi-siamo)(?:[\/.-]|$)/i,
];

const SKIP = /\.(?:pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)(?:$|\?)|\/(?:wp-admin|wp-login\.php|wp-login|login|account|my-account|feed)(?:[\/?]|$)|^mailto:|^tel:|^javascript:/i;

export function pickInternalPages(html: string, baseUrl: string, max = config.extraPages): string[] {
  const base = new URL(baseUrl);
  const host = base.hostname.replace(/^www\./, "");
  const $ = cheerio.load(html);
  const candidates: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href")!.trim();
    if (!href || href.startsWith("#") || SKIP.test(href)) return;
    try {
      const u = new URL(href, base);
      if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) return;
      u.hash = "";
      if (u.pathname === "/" || u.pathname === base.pathname) return;
      candidates.push(u.href);
    } catch {}
  });
  const unique = [...new Set(candidates)];
  const picked: string[] = [];
  for (const re of INTERESTING) {
    const hit = unique.find((u) => re.test(new URL(u).pathname) && !picked.includes(u));
    if (hit && picked.length < max) picked.push(hit);
  }
  for (const u of unique) {
    if (picked.length >= max) break;
    if (!picked.includes(u) && new URL(u).pathname.split("/").filter(Boolean).length <= 2) picked.push(u);
  }
  return picked;
}

export async function collectPages(homeUrl: string, homeHtml: string): Promise<PageSignals[]> {
  const urls = pickInternalPages(homeHtml, homeUrl);
  const out: PageSignals[] = [];
  for (const u of urls) {
    try {
      const r = await fetchPage(u, [u], false);
      if (r.status < 400) out.push({ ...r.signals, layer: "pages" });
    } catch {}
  }
  if (!out.length) out.push({ layer: "pages" });
  return out;
}
