import { Resolver } from "node:dns/promises";
import { config } from "../config.js";
import type { PageSignals } from "../types.js";

type RecordType = "MX" | "TXT" | "NS" | "SOA" | "CNAME";

const DOH_ENDPOINTS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];
const DOH_TYPE: Record<RecordType, number> = { CNAME: 5, SOA: 6, MX: 15, TXT: 16, NS: 2 };

const udp = new Resolver({ timeout: config.dnsTimeoutMs, tries: 2 });
udp.setServers(["1.1.1.1", "8.8.8.8"]);

const safe = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

async function viaDoh(name: string, type: RecordType): Promise<string[] | null> {
  for (const endpoint of DOH_ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(config.dnsTimeoutMs),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { Status: number; Answer?: { type: number; data: string }[] };
      if (body.Status !== 0 && body.Status !== 3) continue;
      return (body.Answer ?? [])
        .filter((a) => a.type === DOH_TYPE[type])
        .map((a) => normalize(type, a.data));
    } catch {}
  }
  return null;
}

function normalize(type: RecordType, data: string): string {
  let v = data.trim();
  if (type === "TXT") v = v.replace(/^"|"$/g, "").replace(/"\s*"/g, "");
  if (type === "MX") v = v.replace(/^\d+\s+/, "");
  if (type === "SOA") v = v.split(/\s+/).slice(0, 2).join(" ");
  return v.replace(/\.$/, "").replace(/\. /g, " ");
}

async function viaUdp(name: string, type: RecordType): Promise<string[] | null> {
  switch (type) {
    case "MX": {
      const r = await safe(udp.resolveMx(name));
      return r && r.sort((a, b) => a.priority - b.priority).map((x) => x.exchange);
    }
    case "TXT": {
      const r = await safe(udp.resolveTxt(name));
      return r && r.map((chunks) => chunks.join(""));
    }
    case "NS":
      return safe(udp.resolveNs(name));
    case "CNAME":
      return safe(udp.resolveCname(name));
    case "SOA": {
      const r = await safe(udp.resolveSoa(name));
      return r && [`${r.nsname} ${r.hostmaster}`];
    }
  }
}

async function lookup(name: string, type: RecordType, used: Set<string>): Promise<string[]> {
  // try DNS over HTTPS first since it is more reliable on Windows
  const doh = await viaDoh(name, type);
  if (doh !== null) {
    used.add("doh");
    return doh;
  }
  const u = await viaUdp(name, type);
  if (u !== null) used.add("udp");
  return u ?? [];
}

export async function collectDns(domain: string): Promise<PageSignals> {
  const used = new Set<string>();
  const [mx, txt, ns, soa, cnameWww, cnameRoot] = await Promise.all([
    lookup(domain, "MX", used),
    lookup(domain, "TXT", used),
    lookup(domain, "NS", used),
    lookup(domain, "SOA", used),
    lookup(`www.${domain}`, "CNAME", used),
    lookup(domain, "CNAME", used),
  ]);
  if (!used.size) throw new Error("DNS lookups failed over DoH and UDP");
  const dns: Record<string, string[]> = {};
  if (mx.length) dns.MX = mx;
  if (txt.length) dns.TXT = txt;
  if (ns.length) dns.NS = ns;
  if (soa.length) dns.SOA = soa;
  const cnames = [...cnameWww, ...cnameRoot];
  if (cnames.length) dns.CNAME = cnames;
  return { layer: "dns", dns };
}
