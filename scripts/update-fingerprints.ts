import fs from "node:fs";
import path from "node:path";

const BASE = "https://raw.githubusercontent.com/enthec/webappanalyzer/main/src";
const OUT = "data/fingerprints";
const files = ["categories.json", "groups.json", ...["_", ..."abcdefghijklmnopqrstuvwxyz"].map((c) => `technologies/${c}.json`)];

for (const f of files) {
  const res = await fetch(`${BASE}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  // these files are vendored data, they should not be edited by hand
  const target = path.join(OUT, f);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, await res.text());
  console.log(`updated ${f}`);
}
