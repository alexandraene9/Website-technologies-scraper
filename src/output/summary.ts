import type { DomainResult, Layer } from "../types.js";
import type { FingerprintDb } from "../engine/loadFingerprints.js";
import { MIN_CONFIDENCE, resolveDetections, type Hit } from "../engine/matcher.js";

const LAYER_STEPS: Layer[][] = [["http"], ["http", "browser"], ["http", "browser", "dns"], ["http", "browser", "dns", "tls"]];

export function buildSummary(db: FingerprintDb, hitsByDomain: Map<string, Hit[]>, results: DomainResult[]) {
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
      marketing: r.technologies
        .filter((t) => t.categories.some((c) => /marketing|personalisation|reviews|loyalty|a\/b testing|heatmap/i.test(c)))
        .map((t) => t.name),
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
