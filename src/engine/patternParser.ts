export interface Pattern {
  raw: string;
  source: string;
  regex: RegExp | null;
  confidence: number;
  version: string | null;
}

export const stats = { compiled: 0, failed: 0 };

export const TAG_SEPARATOR = String.fromCharCode(92) + ";";

export function parsePattern(input: unknown): Pattern {
  const raw = typeof input === "string" ? input : String(input ?? "");
  const parts = raw.split(TAG_SEPARATOR);
  let source = parts[0] ?? "";
  let confidence = 100;
  let version: string | null = null;
  for (const tag of parts.slice(1)) {
    const idx = tag.indexOf(":");
    const key = idx === -1 ? tag : tag.slice(0, idx);
    const val = idx === -1 ? "" : tag.slice(idx + 1);
    if (key === "confidence") confidence = Number.parseInt(val, 10) || 0;
    else if (key === "version") version = val;
  }
  source = source.replace(/^\(\?i\)/, "");
  let regex: RegExp | null = null;
  if (source !== "") {
    try {
      regex = new RegExp(source, "i");
      stats.compiled++;
    } catch {
      stats.failed++;
      regex = /(?!)/;
    }
  }
  return { raw, source, regex, confidence, version };
}

export interface MatchResult {
  matched: boolean;
  value: string;
  version: string | null;
}

export function testPattern(p: Pattern, value: string): MatchResult {
  if (!p.regex) return { matched: true, value: value.slice(0, 200), version: null };
  const m = p.regex.exec(value);
  if (!m) return { matched: false, value: "", version: null };
  return {
    matched: true,
    value: excerpt(value, m.index, m[0].length),
    version: p.version ? resolveVersion(p.version, m) : null,
  };
}

function excerpt(value: string, index: number, length: number): string {
  if (value.length <= 200) return value;
  const start = Math.max(0, index - 60);
  const end = Math.min(value.length, index + Math.max(length, 1) + 60);
  return (start > 0 ? "..." : "") + value.slice(start, end) + (end < value.length ? "..." : "");
}

export function resolveVersion(template: string, m: RegExpExecArray): string | null {
  let out = template;
  for (let i = 1; i <= 9; i++) {
    const g = m[i] ?? "";
    out = out.replace(new RegExp(`\\\\${i}\\?([^:]*):(.*)$`), (_s, a: string, b: string) => (g ? a : b));
    out = out.split(`\\${i}`).join(g);
  }
  out = out.trim();
  if (!out || out.length > 40) return null;
  return out;
}
