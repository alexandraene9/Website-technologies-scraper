import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import pLimit from "p-limit";
import { config } from "./config.js";
import { readDomains } from "./input/readDomains.js";
import { loadFingerprints, type FingerprintDb } from "./engine/loadFingerprints.js";
import { stats as patternStats } from "./engine/patternParser.js";
import { MIN_CONFIDENCE, matchSignals, resolveDetections, type Hit } from "./engine/matcher.js";
import { collectHttp, errMsg } from "./collectors/httpCollector.js";
import { collectDns } from "./collectors/dnsCollector.js";
import { collectTls } from "./collectors/tlsCollector.js";
import { closeBrowser, collectBrowser } from "./collectors/browserCollector.js";
import { extractFromHtml } from "./collectors/extractHtml.js";
import { collectPages } from "./collectors/pagesCollector.js";
import { writeCsv, writeJson } from "./output/writers.js";
import { buildSummary } from "./output/summary.js";
import type { DomainRaw, DomainResult, Layer, PageSignals } from "./types.js";

interface Options {
  command: "scan" | "detect";
  browser: boolean;
  pages: boolean;
  fresh: boolean;
  refresh: Layer[];
  limit?: number;
  only?: string[];
  input: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { command: (argv[0] as Options["command"]) ?? "scan", browser: true, pages: true, fresh: false, refresh: [], input: config.paths.input };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--no-browser") opts.browser = false;
    else if (a === "--no-pages") opts.pages = false;
    else if (a === "--fresh") opts.fresh = true;
    else if (a === "--refresh") opts.refresh = argv[++i]!.split(",").map((s) => s.trim() as Layer);
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--only") opts.only = argv[++i]!.split(",").map((s) => s.trim().toLowerCase());
    else if (a === "--input") opts.input = argv[++i]!;
  }
  if (opts.command !== "scan" && opts.command !== "detect") throw new Error(`unknown command ${opts.command}`);
  return opts;
}

const rawPath = (domain: string) => path.join(config.paths.raw, `${domain}.json.gz`);

function loadRaw(domain: string): DomainRaw | null {
  const p = rawPath(domain);
  if (!fs.existsSync(p)) return null;
  const raw: DomainRaw = JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8"));
  for (const l of raw.layers) splitLegacyBodies(l);
  return raw;
}

function splitLegacyBodies(l: PageSignals): void {
  if (l.layer !== "browser" || l.externalScripts || !l.html) return;
  const inline = extractFromHtml(l.html, l.url ?? "https://localhost/");
  const inlineScripts = new Set(inline.scripts ?? []);
  const inlineCss = new Set(inline.css ?? []);
  l.externalScripts = (l.scripts ?? []).filter((x) => !inlineScripts.has(x));
  l.externalCss = (l.css ?? []).filter((x) => !inlineCss.has(x));
  l.scripts = (l.scripts ?? []).filter((x) => inlineScripts.has(x));
  l.css = (l.css ?? []).filter((x) => inlineCss.has(x));
}

function saveRaw(raw: DomainRaw): void {
  fs.mkdirSync(config.paths.raw, { recursive: true });
  fs.writeFileSync(rawPath(raw.domain), zlib.gzipSync(JSON.stringify(raw)));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  // a single stuck domain should never block the rest of the pipeline
  const t = new Promise<never>((_r, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} hard timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

async function timed<T>(raw: DomainRaw, layer: Layer, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  try {
    return await withTimeout(fn(), config.layerHardTimeoutMs[layer], layer);
  } catch (e) {
    raw.errors.push({ layer, message: errMsg(e) });
    return null;
  } finally {
    raw.timingsMs[layer] = Date.now() - t0;
  }
}

async function collectDomain(domain: string, db: FingerprintDb, opts: Options, browserLimit: ReturnType<typeof pLimit>): Promise<DomainRaw> {
  const prev = opts.fresh ? null : loadRaw(domain);
  if (prev) {
    prev.layers = prev.layers.filter(
      (l) => !opts.refresh.includes(l.layer) && !(l.layer === "dns" && Object.keys(l.dns ?? {}).length === 0),
    );
    if (opts.refresh.includes("browser")) prev.notes = (prev.notes ?? []).filter((n) => !n.startsWith("browser:"));
  }
  const have = new Set(prev?.layers.map((l) => l.layer) ?? []);
  const raw: DomainRaw = {
    domain,
    fetchedAt: new Date().toISOString(),
    status: "unreachable",
    errors: [],
    notes: prev?.notes ?? [],
    finalUrl: prev?.finalUrl,
    layers: prev ? [...prev.layers] : [],
    timingsMs: prev?.timingsMs ?? {},
  };
  const keepErrors = (layer: Layer) => prev?.errors.filter((e) => e.layer === layer && have.has(layer)) ?? [];
  const push = (s: PageSignals | null) => s && raw.layers.push(s);

  const tasks: Promise<unknown>[] = [];
  if (!have.has("dns")) tasks.push(timed(raw, "dns", () => collectDns(domain)).then(push));
  if (!have.has("tls")) tasks.push(timed(raw, "tls", () => collectTls(domain).catch(() => collectTls(`www.${domain}`))).then(push));
  if (!have.has("http")) {
    tasks.push(
      timed(raw, "http", () => collectHttp(domain)).then((r) => {
        if (r) {
          raw.finalUrl = r.finalUrl;
          push(r.signals);
          if (r.status >= 400) raw.errors.push({ layer: "http", message: `HTTP ${r.status} at ${r.finalUrl}` });
        }
      }),
    );
  }
  await Promise.all(tasks);

  if (opts.browser && !have.has("browser")) {
    const target = raw.finalUrl ?? `https://${domain}/`;
    const b = await browserLimit(() => timed(raw, "browser", () => collectBrowser(target, db.jsChains)));
    if (b) {
      const { finalUrl, notes, ...signals } = b;
      raw.finalUrl = finalUrl || raw.finalUrl;
      raw.notes!.push(...notes.map((n) => `browser: ${n}`));
      push(signals);
    }
  }

  if (opts.pages && !have.has("pages")) {
    const home = raw.layers.find((l) => l.layer === "http");
    if (home?.html && raw.finalUrl) {
      const pages = await timed(raw, "pages", () => collectPages(raw.finalUrl!, home.html!));
      if (pages) raw.layers.push(...pages);
    }
  }

  for (const l of ["http", "browser", "dns", "tls", "pages"] as Layer[]) raw.errors.push(...keepErrors(l));
  const webLayers = raw.layers.filter((l) => l.layer === "http" || l.layer === "browser");
  raw.status = webLayers.length ? "ok" : raw.layers.length ? "partial" : "unreachable";
  saveRaw(raw);
  return raw;
}

const hitCache = new Map<string, Hit[]>();

function hitsFor(db: FingerprintDb, raw: DomainRaw): Hit[] {
  let h = hitCache.get(raw.domain);
  if (!h) {
    h = raw.layers.flatMap((l) => matchSignals(db, l));
    hitCache.set(raw.domain, h);
  }
  return h;
}

function toResult(db: FingerprintDb, raw: DomainRaw): DomainResult {
  const all = resolveDetections(db, hitsFor(db, raw));
  const technologies = all.filter((t) => t.confidence >= MIN_CONFIDENCE);
  const lowConfidence = all.filter((t) => t.confidence < MIN_CONFIDENCE);
  return {
    domain: raw.domain,
    status: raw.status,
    finalUrl: raw.finalUrl,
    errors: raw.errors,
    technologyCount: technologies.length,
    technologies,
    lowConfidence,
  };
}

function writeOutputs(db: FingerprintDb, raws: DomainRaw[]) {
  const t0 = Date.now();
  const results = raws.map((r) => toResult(db, r)).sort((a, b) => a.domain.localeCompare(b.domain));
  const hitsByDomain = new Map(raws.map((r) => [r.domain, hitsFor(db, r)] as const));
  const summary = buildSummary(db, hitsByDomain, results, raws);
  console.log(`detection took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  writeJson(path.join(config.paths.out, "results.json"), results);
  writeCsv(path.join(config.paths.out, "results.csv"), results);
  writeJson(path.join(config.paths.out, "summary.json"), summary);
  console.log("\n=== Summary ===");
  console.log(`domains: ${summary.domains}  status: ${JSON.stringify(summary.status)}`);
  console.log(`distinct technologies: ${summary.distinctTechnologies}  domain-technology pairs: ${summary.domainTechnologyPairs}`);
  for (const c of summary.cumulativeByLayer) console.log(`  ${c.layers.padEnd(32)} -> ${c.distinctTechnologies} distinct, ${c.domainTechnologyPairs} pairs`);
  console.log(`low confidence (< ${summary.minConfidence}), reported separately: ${summary.lowConfidence.distinctTechnologies} distinct, ${summary.lowConfidence.pairs} pairs`);
  console.log(`shopify stores: ${summary.shopifyLeads.length}`);
  console.log(`outputs written to ${config.paths.out}/ (results.json, results.csv, summary.json)`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = loadFingerprints(config.paths.fingerprints, config.paths.custom);
  console.log(`fingerprints: ${db.techs.size} technologies, ${patternStats.compiled} patterns compiled, ${patternStats.failed} failed`);

  let domains = await readDomains(opts.input);
  if (opts.only) domains = domains.filter((d) => opts.only!.includes(d));
  if (opts.limit) domains = domains.slice(0, opts.limit);
  console.log(`domains: ${domains.length}`);

  if (opts.command === "detect") {
    const raws = domains.map(loadRaw).filter((r): r is DomainRaw => !!r);
    console.log(`loaded ${raws.length} cached raw files`);
    writeOutputs(db, raws);
    return;
  }

  const limit = pLimit(config.httpConcurrency);
  const browserLimit = pLimit(config.browserConcurrency);
  let done = 0;
  const started = Date.now();
  try {
    const raws = await Promise.all(
      domains.map((d) =>
        limit(async () => {
          const raw = await collectDomain(d, db, opts, browserLimit);
          done++;
          const n = resolveDetections(db, hitsFor(db, raw)).filter((t) => t.confidence >= MIN_CONFIDENCE).length;
          console.log(`[${String(done).padStart(3)}/${domains.length}] ${raw.status.padEnd(11)} ${String(n).padStart(3)} techs  ${d}${raw.errors.length ? `  (${raw.errors.map((e) => e.layer).join(",")} errors)` : ""}`);
          return raw;
        }),
      ),
    );
    console.log(`collection took ${((Date.now() - started) / 1000).toFixed(0)}s`);
    writeOutputs(db, raws);
  } finally {
    await closeBrowser();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
