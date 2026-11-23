import fs from "node:fs";
import path from "node:path";
import { parsePattern, TAG_SEPARATOR, type Pattern } from "./patternParser.js";
import { buildPrefilter, type Prefilter } from "./selectorPrefilter.js";

export interface DomRule {
  selector: string;
  prefilter: Prefilter;
  exists?: Pattern;
  text?: Pattern;
  attributes?: Record<string, Pattern>;
  properties?: Record<string, Pattern>;
}

export interface Tech {
  name: string;
  cats: number[];
  website?: string;
  headers: [string, Pattern][];
  cookies: [string, Pattern, RegExp | null][];
  meta: [string, Pattern][];
  js: [string, Pattern][];
  dns: [string, Pattern][];
  html: Pattern[];
  scripts: Pattern[];
  scriptSrc: Pattern[];
  url: Pattern[];
  xhr: Pattern[];
  text: Pattern[];
  css: Pattern[];
  robots: string[];
  certIssuer: string | null;
  dom: DomRule[];
  implies: Pattern[];
  excludes: string[];
  requires: string[];
  requiresCategory: number[];
}

export interface FingerprintDb {
  techs: Map<string, Tech>;
  categories: Map<number, string>;
  jsChains: string[];
}

const toArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

const toPairs = (v: unknown): [string, Pattern][] => {
  if (!v || typeof v !== "object") return [];
  const out: [string, Pattern][] = [];
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    for (const item of toArray(val)) out.push([k, parsePattern(item)]);
  }
  return out;
};

function cookieNameRegex(name: string): RegExp | null {
  if (!/[^\w.\- ]/.test(name)) return null;
  const src = name.replace(/^\(\?i\)/, "").replace(/\*$/, ".*");
  try {
    return new RegExp(`^${src}$`, "i");
  } catch {
    return null;
  }
}

function parseDom(v: unknown): DomRule[] {
  if (!v) return [];
  if (typeof v === "string" || Array.isArray(v)) {
    return toArray(v).map((s) => ({ selector: String(s), prefilter: buildPrefilter(String(s)), exists: parsePattern("") }));
  }
  const rules: DomRule[] = [];
  for (const [selector, spec] of Object.entries(v as Record<string, any>)) {
    const rule: DomRule = { selector, prefilter: buildPrefilter(selector) };
    if (spec && "exists" in spec) rule.exists = parsePattern(spec.exists);
    if (spec && "text" in spec) rule.text = parsePattern(spec.text);
    if (spec?.attributes) rule.attributes = Object.fromEntries(toPairs(spec.attributes));
    if (spec?.properties) rule.properties = Object.fromEntries(toPairs(spec.properties));
    rules.push(rule);
  }
  return rules;
}

function buildTech(name: string, t: any): Tech {
  return {
    name,
    cats: t.cats ?? [],
    website: t.website,
    headers: toPairs(t.headers).map(([k, p]) => [k.toLowerCase(), p]),
    cookies: toPairs(t.cookies).map(([k, p]) => [k, p, cookieNameRegex(k)]),
    meta: toPairs(t.meta).map(([k, p]) => [k.toLowerCase(), p]),
    js: toPairs(t.js),
    dns: toPairs(t.dns).map(([k, p]) => [k.toUpperCase(), p]),
    html: toArray(t.html).map(parsePattern),
    scripts: toArray(t.scripts).map(parsePattern),
    scriptSrc: toArray(t.scriptSrc).map(parsePattern),
    url: toArray(t.url).map(parsePattern),
    xhr: toArray(t.xhr).map(parsePattern),
    text: toArray(t.text).map(parsePattern),
    css: toArray(t.css).map(parsePattern),
    robots: toArray(t.robots).map(String),
    certIssuer: t.certIssuer ? String(t.certIssuer) : null,
    dom: parseDom(t.dom),
    implies: toArray(t.implies).map(parsePattern),
    excludes: toArray(t.excludes).map((s) => String(s).split(TAG_SEPARATOR)[0]!),
    requires: toArray(t.requires).map((s) => String(s).split(TAG_SEPARATOR)[0]!),
    requiresCategory: toArray(t.requiresCategory).map(Number),
  };
}

export function loadFingerprints(dir: string, customFile?: string): FingerprintDb {
  const raw: Record<string, any> = {};
  const techDir = path.join(dir, "technologies");
  for (const f of fs.readdirSync(techDir).filter((f) => f.endsWith(".json")).sort()) {
    Object.assign(raw, JSON.parse(fs.readFileSync(path.join(techDir, f), "utf8")));
  }
  if (customFile && fs.existsSync(customFile)) {
    const custom = JSON.parse(fs.readFileSync(customFile, "utf8"));
    for (const [name, def] of Object.entries(custom)) {
      if (name.startsWith("$")) continue;
      raw[name] = raw[name] ? mergeDefs(raw[name], def) : def;
    }
  }
  const techs = new Map<string, Tech>();
  for (const [name, def] of Object.entries(raw)) techs.set(name, buildTech(name, def));
  const catsRaw = JSON.parse(fs.readFileSync(path.join(dir, "categories.json"), "utf8"));
  const categories = new Map<number, string>(
    Object.entries(catsRaw).map(([id, c]: [string, any]) => [Number(id), c.name as string]),
  );
  const chains = new Set<string>();
  for (const t of techs.values()) for (const [k] of t.js) chains.add(k);
  return { techs, categories, jsChains: [...chains] };
}

function mergeDefs(a: any, b: any): any {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (Array.isArray(out[k]) || Array.isArray(v)) out[k] = [...toArray(out[k]), ...toArray(v)];
    else if (out[k] && typeof out[k] === "object" && v && typeof v === "object") out[k] = { ...out[k], ...v };
    else out[k] = v;
  }
  return out;
}
