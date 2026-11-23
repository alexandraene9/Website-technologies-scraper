import * as cheerio from "cheerio";
import type { Detection, Evidence, PageSignals } from "../types.js";
import type { FingerprintDb, Tech } from "./loadFingerprints.js";
import { testPattern, type Pattern } from "./patternParser.js";
import { HtmlIndex, mayMatch } from "./selectorPrefilter.js";

export const EXTERNAL_BODY_CONFIDENCE = 25;
export const MIN_CONFIDENCE = 50;

export interface Hit {
  tech: Tech;
  evidence: Evidence;
  version: string | null;
}

export function matchSignals(db: FingerprintDb, s: PageSignals): Hit[] {
  const hits: Hit[] = [];
  const $ = s.html ? cheerio.load(s.html) : null;
  // lowercasing once makes the selector prefilter much faster
  const htmlIndex = new HtmlIndex(s.html ? s.html.toLowerCase() : "");
  const add = (tech: Tech, p: Pattern, type: string, value: string, key?: string, maxConfidence = 100) => {
    const r = testPattern(p, value);
    if (!r.matched) return false;
    hits.push({
      tech,
      version: r.version,
      evidence: { layer: s.layer, type, key, pattern: p.raw || "(exists)", value: r.value, confidence: Math.min(p.confidence, maxConfidence) },
    });
    return true;
  };

  const urls = [s.url, ...(s.urls ?? [])].filter((u): u is string => !!u);

  for (const tech of db.techs.values()) {
    // check each fingerprint against the kind of signal we collected
    for (const p of tech.url) for (const u of urls) if (add(tech, p, "url", u) || add(tech, p, "url", u.replace("://", "//"))) break;

    if (s.headers) {
      for (const [name, p] of tech.headers) {
        for (const v of s.headers[name] ?? []) if (add(tech, p, "header", v, name)) break;
      }
    }

    if (s.cookies) {
      for (const [name, p, re] of tech.cookies) {
        for (const [cn, cv] of Object.entries(s.cookies)) {
          const nameOk = re ? re.test(cn) : cn.toLowerCase() === name.toLowerCase();
          if (nameOk && add(tech, p, "cookie", cv, cn)) break;
        }
      }
    }

    if (s.meta) {
      for (const [name, p] of tech.meta) {
        for (const v of s.meta[name] ?? []) if (add(tech, p, "meta", v, name)) break;
      }
    }

    if (s.scriptSrc) {
      for (const p of tech.scriptSrc) for (const src of s.scriptSrc) if (add(tech, p, "scriptSrc", src)) break;
    }

    if (s.scripts) {
      for (const p of tech.scripts) for (const code of s.scripts) if (add(tech, p, "scripts", code)) break;
    }

    if (s.html) for (const p of tech.html) add(tech, p, "html", s.html);
    if (s.text) for (const p of tech.text) add(tech, p, "text", s.text);
    if (s.css) for (const p of tech.css) for (const c of s.css) if (add(tech, p, "css", c)) break;

    if (s.externalScripts) {
      // library code can mention other tools, so keep these matches less confident
      for (const p of tech.scripts) for (const code of s.externalScripts) if (add(tech, p, "externalScripts", code, undefined, EXTERNAL_BODY_CONFIDENCE)) break;
    }
    if (s.externalCss) {
      for (const p of tech.css) for (const c of s.externalCss) if (add(tech, p, "externalCss", c, undefined, EXTERNAL_BODY_CONFIDENCE)) break;
    }

    if (s.xhr) {
      for (const p of tech.xhr) for (const h of s.xhr) if (add(tech, p, "xhr", h)) break;
    }

    if (s.js) {
      for (const [chain, p] of tech.js) {
        const v = s.js[chain];
        if (v !== undefined) add(tech, p, "js", v, chain);
      }
    }

    if (s.dns) {
      for (const [type, p] of tech.dns) {
        for (const v of s.dns[type] ?? []) if (add(tech, p, "dns", v, type)) break;
      }
    }

    if (s.certIssuer && tech.certIssuer && s.certIssuer.toLowerCase().includes(tech.certIssuer.toLowerCase())) {
      hits.push({
        tech,
        version: null,
        evidence: { layer: s.layer, type: "certIssuer", pattern: tech.certIssuer, value: s.certIssuer, confidence: 100 },
      });
    }

    if (s.robots) {
      for (const r of tech.robots) {
        if (s.robots.includes(r)) {
          hits.push({ tech, version: null, evidence: { layer: s.layer, type: "robots", pattern: r, value: r, confidence: 100 } });
        }
      }
    }

    if ($) for (const rule of tech.dom) if (mayMatch(rule.prefilter, htmlIndex)) matchDom($, tech, rule, s, hits);
  }
  return hits;
}

function matchDom($: cheerio.CheerioAPI, tech: Tech, rule: Tech["dom"][number], s: PageSignals, hits: Hit[]) {
  let nodes;
  try {
    nodes = $(rule.selector);
  } catch {
    // skip broken selectors instead of failing the whole page
    return;
  }
  if (nodes.length === 0) return;
  const push = (p: Pattern, type: string, value: string, key?: string) => {
    const r = testPattern(p, value);
    if (!r.matched) return false;
    hits.push({
      tech,
      version: r.version,
      evidence: { layer: s.layer, type, key: key ? `${rule.selector} @${key}` : rule.selector, pattern: p.raw || "(exists)", value: r.value, confidence: p.confidence },
    });
    return true;
  };
  const first = nodes.first();
  if (rule.exists) push(rule.exists, "dom", ($.html(first) ?? "").slice(0, 200));
  if (rule.text) {
    nodes.each((_i, el) => {
      if (push(rule.text!, "dom:text", $(el).text().trim())) return false;
    });
  }
  if (rule.attributes) {
    for (const [attr, p] of Object.entries(rule.attributes)) {
      nodes.each((_i, el) => {
        const v = $(el).attr(attr);
        if (v !== undefined && push(p, "dom:attribute", v, attr)) return false;
      });
    }
  }
  if (rule.properties) {
    for (const [prop, p] of Object.entries(rule.properties)) {
      nodes.each((_i, el) => {
        const v = $(el).attr(prop);
        if (v !== undefined && push(p, "dom:property", v, prop)) return false;
      });
    }
  }
}

export function resolveDetections(db: FingerprintDb, hits: Hit[]): Detection[] {
  const byName = new Map<string, { tech: Tech; evidence: Evidence[]; versions: string[] }>();
  for (const h of hits) {
    const e = byName.get(h.tech.name) ?? { tech: h.tech, evidence: [], versions: [] };
    // do not count the same evidence twice
    const dup = e.evidence.some(
      (x) => x.layer === h.evidence.layer && x.type === h.evidence.type && x.key === h.evidence.key && x.pattern === h.evidence.pattern,
    );
    if (!dup) e.evidence.push(h.evidence);
    if (h.version) e.versions.push(h.version);
    byName.set(h.tech.name, e);
  }

  const confidenceOf = (ev: Evidence[]) => {
    const total = Math.min(100, ev.reduce((a, x) => a + x.confidence, 0));
    const onlyExternal = ev.length > 0 && ev.every((x) => x.type === "externalScripts" || x.type === "externalCss");
    return onlyExternal ? Math.min(total, EXTERNAL_BODY_CONFIDENCE) : total;
  };

  const detected = new Map<string, Detection>();
  for (const [name, e] of byName) {
    detected.set(name, {
      name,
      categories: e.tech.cats.map((c) => db.categories.get(c) ?? String(c)),
      version: pickVersion(e.versions),
      confidence: confidenceOf(e.evidence),
      website: e.tech.website,
      evidence: e.evidence,
    });
  }

  let changed = true;
  while (changed) {
    changed = false;
    // keep adding implied technologies until there is nothing left
    for (const d of [...detected.values()]) {
      const tech = db.techs.get(d.name);
      if (!tech) continue;
      for (const imp of tech.implies) {
        const target = imp.source;
        const t = db.techs.get(target);
        if (!t) continue;
        const existing = detected.get(target);
        if (existing) {
          if (!existing.impliedBy?.includes(d.name)) {
            existing.impliedBy = [...(existing.impliedBy ?? []), d.name];
          }
          continue;
        }
        detected.set(target, {
          name: target,
          categories: t.cats.map((c) => db.categories.get(c) ?? String(c)),
          version: null,
          confidence: Math.min(d.confidence, imp.confidence),
          website: t.website,
          evidence: [],
          impliedBy: [d.name],
        });
        changed = true;
      }
    }
  }

  for (const d of [...detected.values()]) {
    const tech = db.techs.get(d.name);
    if (!tech) continue;
    if (tech.requires.length && !tech.requires.some((r) => detected.has(r))) detected.delete(d.name);
  }
  for (const d of [...detected.values()]) {
    const tech = db.techs.get(d.name);
    if (!tech || !tech.requiresCategory.length) continue;
    const ok = [...detected.values()].some((o) => {
      const ot = db.techs.get(o.name);
      return o.name !== d.name && ot?.cats.some((c) => tech.requiresCategory.includes(c));
    });
    if (!ok) detected.delete(d.name);
  }
  for (const d of [...detected.values()]) {
    const tech = db.techs.get(d.name);
    if (!tech) continue;
    for (const ex of tech.excludes) detected.delete(ex);
  }

  return [...detected.values()].sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

function pickVersion(vs: string[]): string | null {
  if (!vs.length) return null;
  const counts = new Map<string, number>();
  for (const v of vs) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]![0];
}

export function detect(db: FingerprintDb, layers: PageSignals[]): Detection[] {
  const hits = layers.flatMap((l) => matchSignals(db, l));
  return resolveDetections(db, hits);
}
