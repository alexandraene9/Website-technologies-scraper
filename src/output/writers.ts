import fs from "node:fs";
import path from "node:path";
import type { DomainResult } from "../types.js";

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function writeCsv(file: string, results: DomainResult[]): void {
  const lines = [["domain", "status", "technology", "categories", "version", "confidence", "detected_by", "evidence"].join(",")];
  for (const r of results) {
    if (!r.technologies.length) {
      lines.push([r.domain, r.status, "", "", "", "", "", r.errors.map((e) => `${e.layer}: ${e.message}`).join(" | ")].map(csvCell).join(","));
      continue;
    }
    for (const t of r.technologies) {
      const layers = [...new Set(t.evidence.map((e) => e.layer))];
      const detectedBy = layers.length ? layers.join("+") : "implied";
      const ev = t.evidence.length
        ? t.evidence
            .slice(0, 3)
            .map((e) => `${e.layer}:${e.type}${e.key ? `[${e.key}]` : ""}=${e.value.slice(0, 120)}`)
            .join(" | ")
        : `implied by ${t.impliedBy?.join(", ")}`;
      lines.push([r.domain, r.status, t.name, t.categories.join("; "), t.version, t.confidence, detectedBy, ev].map(csvCell).join(","));
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n");
}
