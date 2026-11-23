export type Prefilter = string[][];

function splitTopLevel(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of selector) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function tokensOf(alt: string): string[] {
  const tokens: string[] = [];
  const noNot = alt.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, "");
  for (const m of noNot.matchAll(/\[\s*([\w:-]+)\s*(?:([~|^$*]?=)\s*(['"]?)(.*?)\3\s*(?:\s[is])?)?\s*\]/g)) {
    tokens.push(m[1]!.toLowerCase());
    if (m[4] && m[2] !== "|=") tokens.push(m[4].toLowerCase());
  }
  const stripped = noNot.replace(/\[[^\]]*\]/g, " ").replace(/:[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, " ");
  for (const m of stripped.matchAll(/[#.]([\w-]+)/g)) tokens.push(m[1]!.toLowerCase());
  return [...new Set(tokens.filter((t) => t.length >= 3))].sort((a, b) => b.length - a.length);
}

export function buildPrefilter(selector: string): Prefilter {
  return splitTopLevel(selector).map(tokensOf);
}

export class HtmlIndex {
  private memo = new Map<string, boolean>();
  private grams: Set<string> | null = null;

  constructor(private readonly lower: string) {
    if (lower.length > 50_000) {
      this.grams = new Set();
      for (let i = 0; i + 4 <= lower.length; i++) this.grams.add(lower.slice(i, i + 4));
    }
  }

  has(token: string): boolean {
    let v = this.memo.get(token);
    if (v !== undefined) return v;
    v = true;
    if (this.grams && token.length >= 4) {
      for (let i = 0; i + 4 <= token.length; i += 2) {
        if (!this.grams.has(token.slice(i, i + 4))) {
          v = false;
          break;
        }
      }
      if (v && !this.grams.has(token.slice(token.length - 4))) v = false;
    }
    if (v) v = this.lower.includes(token);
    this.memo.set(token, v);
    return v;
  }
}

export function mayMatch(pf: Prefilter, index: HtmlIndex): boolean {
  return pf.some((tokens) => tokens.every((t) => index.has(t)));
}
