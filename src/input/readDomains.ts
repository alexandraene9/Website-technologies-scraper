import fs from "node:fs";
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";

export async function readDomains(file: string): Promise<string[]> {
  let rows: string[];
  if (file.endsWith(".parquet")) {
    const buf = await asyncBufferFromFile(file);
    const objs = (await parquetReadObjects({ file: buf })) as Record<string, unknown>[];
    rows = objs.map((o) => String(o.root_domain ?? Object.values(o)[0] ?? ""));
  } else {
    rows = fs.readFileSync(file, "utf8").split(/\r?\n/);
  }
  // normalize and remove duplicates before starting the scan
  const clean = rows
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((d) => d && !d.startsWith("#"));
  return [...new Set(clean)];
}
