import type { DomainRaw, DomainResult, Layer } from "../types.js";
import type { FingerprintDb } from "../engine/loadFingerprints.js";
import { MIN_CONFIDENCE, resolveDetections, type Hit } from "../engine/matcher.js";

const LAYER_STEPS: Layer[][] = [
  ["http"],
  ["http", "browser"],
  ["http", "browser", "dns"],
  ["http", "browser", "dns", "tls"],
  ["http", "browser", "dns", "tls", "pages"],
];

export function buildSummary(db: FingerprintDb, hitsByDomain: Map<string, Hit[]>, results: DomainResult[], raws: DomainRaw[]) {
  const status = { ok: 0, partial: 0, unreachable: 0 };
  for (const r of results) status[r.status]++;

  const distinct = new Set<string>();
  let pairs = 0;
  const techCount = new Map<string, number>();
  const catCount = new Map<string, number>();
  for (const r of results) {
    for (const t of r.technologies) {
      distinct.add(t.name);
      pairs++;
      techCount.set(t.name, (techCount.get(t.name) ?? 0) + 1);
      for (const c of t.categories) catCount.set(c, (catCount.get(c) ?? 0) + 1);
    }
  }

  const cumulative = LAYER_STEPS.map((step) => {
    const names = new Set<string>();
    let p = 0;
    for (const hits of hitsByDomain.values()) {
      const d = resolveDetections(db, hits.filter((h) => step.includes(h.evidence.layer))).filter((t) => t.confidence >= MIN_CONFIDENCE);
      p += d.length;
      for (const t of d) names.add(t.name);
    }
    return { layers: step.join(" + "), distinctTechnologies: names.size, domainTechnologyPairs: p };
  });

  const errorKinds = new Map<string, number>();
  for (const r of results) {
    for (const e of r.errors) {
      const kind = `${e.layer}: ${classify(e.message)}`;
      errorKinds.set(kind, (errorKinds.get(kind) ?? 0) + 1);
    }
  }

  const shopifyLeads = results
    .filter((r) => r.technologies.some((t) => t.name === "Shopify"))
    .map((r) => ({
      domain: r.domain,
      analytics: r.technologies.filter((t) => t.categories.includes("Analytics")).map((t) => t.name),
      theme: r.technologies.find((t) => t.name === "Shopify theme")?.version ?? null,
      shopifyApps: r.technologies.filter((t) => t.categories.includes("Shopify apps")).map((t) => t.name),
      marketing: r.technologies
        .filter((t) => t.categories.some((c) => /marketing|personalisation|reviews|loyalty|a\/b testing|heatmap/i.test(c)))
        .map((t) => t.name),
      payments: r.technologies.filter((t) => t.categories.includes("Payment processors")).map((t) => t.name),
    }));

  const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

  return {
    generatedAt: new Date().toISOString(),
    domains: results.length,
    status,
    distinctTechnologies: distinct.size,
    domainTechnologyPairs: pairs,
    minConfidence: MIN_CONFIDENCE,
    lowConfidence: {
      distinctTechnologies: new Set(results.flatMap((r) => r.lowConfidence.map((t) => t.name))).size,
      pairs: results.reduce((a, r) => a + r.lowConfidence.length, 0),
      distinctIncludingLowConfidence: new Set(results.flatMap((r) => [...r.technologies, ...r.lowConfidence].map((t) => t.name))).size,
    },
    cumulativeByLayer: cumulative,
    topTechnologies: sortDesc(techCount).slice(0, 40),
    topCategories: sortDesc(catCount).slice(0, 25),
    errors: sortDesc(errorKinds),
    shopifyLeads,
    discoveryCandidates: buildDiscovery(db, raws, results),
  };
}

function classify(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("enotfound") || m.includes("getaddrinfo")) return "DNS not found";
  if (m.includes("timeout") || m.includes("timed out") || m.includes("aborted")) return "timeout";
  if (m.includes("cert") || m.includes("ssl") || m.includes("tls")) return "TLS/certificate";
  if (m.includes("econnrefused")) return "connection refused";
  if (m.includes("econnreset")) return "connection reset";
  if (m.includes("net::err")) return msg.match(/net::ERR_[A-Z_]+/)?.[0] ?? "browser network error";
  return msg.slice(0, 60);
}

const MULTI_PART_SUFFIXES = new Set(["co.uk", "org.uk", "com.au", "com.br", "co.jp", "ed.jp", "co.za", "org.za", "co.nz", "com.ar", "com.tr", "edu.hu", "info.pl"]);

export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  const lastTwo = parts.slice(-2).join(".");
  return MULTI_PART_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

function knownByAnyRule(db: FingerprintDb) {
  const hostPatterns = [...db.techs.values()].flatMap((t) => [...t.xhr, ...t.scriptSrc]).filter((p) => p.regex);
  const txtPatterns = [...db.techs.values()].flatMap((t) => t.dns.filter(([type]) => type === "TXT").map(([, p]) => p)).filter((p) => p.regex);
  const hostMemo = new Map<string, boolean>();
  return {
    host: (h: string) => {
      let v = hostMemo.get(h);
      if (v === undefined) {
        v = hostPatterns.some((p) => p.regex!.test(h) || p.regex!.test(`https://${h}/`));
        hostMemo.set(h, v);
      }
      return v;
    },
    txt: (t: string) => txtPatterns.some((p) => p.regex!.test(t)),
  };
}

function buildDiscovery(db: FingerprintDb, raws: DomainRaw[], results: DomainResult[]) {
  const known = knownByAnyRule(db);
  const byDomain = new Map(results.map((r) => [r.domain, r]));
  const hosts = new Map<string, Set<string>>();
  const tokens = new Map<string, Set<string>>();
  for (const raw of raws) {
    const r = byDomain.get(raw.domain);
    const explained = JSON.stringify(
      [...(r?.technologies ?? []), ...(r?.lowConfidence ?? [])].flatMap((t) => t.evidence.map((e) => e.value)),
    ).toLowerCase();
    const own = new Set([registrableDomain(raw.domain)]);
    if (raw.finalUrl) {
      try {
        own.add(registrableDomain(new URL(raw.finalUrl).hostname));
      } catch {}
    }
    for (const l of raw.layers) {
      for (const h of l.xhr ?? []) {
        const rd = registrableDomain(h);
        if (own.has(rd) || explained.includes(rd) || known.host(h)) continue;
        (hosts.get(rd) ?? hosts.set(rd, new Set()).get(rd)!).add(raw.domain);
      }
      for (const txt of l.dns?.TXT ?? []) {
        const m = txt.match(/^([a-z0-9][a-z0-9_.-]*?)[-_](?:domain|site)[-_]?verification[=:]/i) ?? txt.match(/^([a-z0-9-]+)-verify[=:]/i);
        if (!m || explained.includes(txt.toLowerCase().slice(0, 40)) || known.txt(txt)) continue;
        const key = m[1]!.toLowerCase();
        (tokens.get(key) ?? tokens.set(key, new Set()).get(key)!).add(raw.domain);
      }
    }
  }
  const rank = (m: Map<string, Set<string>>) =>
    [...m.entries()].map(([name, ds]) => ({ name, domains: ds.size, examples: [...ds].slice(0, 3) })).sort((a, b) => b.domains - a.domains);
  return {
    note: "Signals seen on these domains that no fingerprint explains yet. Candidates for new rules, ranked by number of domains.",
    thirdPartyHosts: rank(hosts).slice(0, 30),
    dnsVerificationTokens: rank(tokens).slice(0, 30),
  };
}
