# AGENTS.md

Instructions for any AI coding agent working in this repository (Claude, Codex, Copilot, Cline and others). Read this file and `BRAIN.md` before doing anything.

## What this project is

An internship take-home task: given 200 domains (`data/domains.parquet`, column `root_domain`), detect as many technologies per website as possible and provide proof for each detection. The reference count from the task is 477 different technologies. Deliverables: output file per domain, code, README with explanation and answers to three debate topics, pushed to GitHub.

Business context: the client sells an analytics plugin for Shopify stores and wants to find stores that use competing tools.

## Commands

```bash
npm install
npx playwright install chromium
npm run scan:static        # http + dns + tls
npm run scan               # + headless browser, reuses cached layers
npm run detect             # detection only, from output/raw cache, no network
npm test                   # node:test via tsx
npm run typecheck          # tsc --noEmit
```

On Windows PowerShell, `npm run x -- --flag` drops the `--`; use `npx tsx src/index.ts scan --flag` or a dedicated npm script (`npm run rescan:browser`).

Flags: `--limit N`, `--only a.com,b.com`, `--fresh`, `--refresh browser,dns,pages` (re-collect only those layers), `--no-pages`, `--input file.txt`.

## Architecture (keep it this way)

- `src/collectors/*` only gather raw signals into a `PageSignals` object tagged with a `layer`. No detection logic here.
- `src/engine/*` only turns signals into detections. No network here.
- Raw data is cached per domain in `output/raw/<domain>.json.gz`. A scan only collects layers missing from the cache unless `--fresh` is passed.
- `src/output/summary.ts` measures each layer's contribution by re-running detection on layer subsets.
- Fingerprints in `data/fingerprints/` are vendored upstream data. Never edit them by hand. Put own rules in `data/custom/technologies.json` (same schema, merged at load; `"$replace": [fields]` replaces those upstream fields instead of merging).

## Conventions

- TypeScript, ESM, strict mode. Run `npm run typecheck` and `npm test` after every change.
- No code comments, except requirement numbers if ever needed. No diacritics in code.
- No em dashes or en dashes in any written text (README, BRAIN, commit messages). Use commas, colons, parentheses or "to".
- Documentation in English (it is the submission). The human owner (Alexandra) talks in Romanian and English mixed.
- Prefer honest numbers over impressive ones. Every claim in the README must be backed by `output/summary.json`.

## Known pitfalls

- Wappalyzer tag separator is a backslash followed by `;` inside the parsed pattern string. Some shell and tool layers collapse a double backslash before `;`. In code it is built as `String.fromCharCode(92) + ";"` (`TAG_SEPARATOR` in `patternParser.ts`). Do not replace it with a string literal.
- The `url` patterns upstream sometimes use `https?//` without the colon. The matcher tests both forms.
- `html`, `scripts` and `text` patterns match against large strings: generic patterns cause false positives (example seen: daisyUI matched inside inline JSON on github.com).
- The cloud sandbox used by Claude cannot reach arbitrary websites. Real scans run on the owner's Windows machine.

## Memory

`BRAIN.md` is the shared working memory. After any meaningful change or run, update it: status, decisions with reasons, results log, open issues. Keep it short and current, move finished items to the log.
