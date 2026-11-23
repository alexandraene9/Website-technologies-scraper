# BRAIN.md

## Current status

- Full scan is done. I have 451 confident technologies, 462 including low confidence matches, and 2,994 confident domain technology pairs.
- HTTP, browser, DNS and TLS results are all cached under `output/raw/`.
- The README is written and now includes the honest results, implementation choices, problems and the three debate topics.
- TypeScript typecheck passes and 6 unit tests pass.
- The repo still needs final review and a GitHub push.

## Next steps

1. Review the README once more and change wording where needed.
2. Check suspicious detections in `output/results.json` or `output/summary.json`.
3. Confirm there are no personal or temporary paths in final files.
4. Git init, first commit and push to GitHub.

## Decisions

- 2026-11-23: Node and TypeScript fit the project. I dislike Python, the company mentioned Node, Python or Scala, and Playwright is native in Node.
- 2026-11-23: I use enthec/webappanalyzer fingerprints and wrote my own matching engine. Hand written rules would give much lower recall.
- 2026-11-23: Collectors are separate from detection. Raw data is cached per domain, so I can rerun detection offline.
- 2026-11-23: External JavaScript and CSS matches use confidence 25 and are placed in `lowConfidence`. Shared library code caused too many false positives.
- 2026-11-23: DNS uses DNS over HTTPS first, Cloudflare then Google, with public UDP resolvers as fallback.
- 2026-11-23: Invalid HTTPS certificates are accepted in the HTTP collector because a real page can still contain useful signals.
- 2026-11-23: The browser blocks images, media and fonts to stay fast, but it records their request hosts before aborting them.
- 2026-11-23: The browser does not add every request URL to URL patterns. It would create too many false positives.
- 2026-11-23: The repo is GPL-3.0 because of the vendored fingerprint data.
- 2026-11-23: Added short English comments only where a bit of context helps.

## Results log

| Date | Run | Domains | Confident technologies | Pairs | Notes |
|---|---|---|---:|---:|---|
| 2026-11-23 | run 3, browser rescan | 190 ok, 10 partial | 450 | 2,992 | External bodies raised the count but also caused false positives |
| 2026-11-23 | run 2, cache scan | 190 ok, 8 partial, 2 unreachable | 445 | 2,978 | DNS now works and adds 43 technologies |
| 2026-11-23 | run 1, static and browser | 188 ok, 11 partial, 1 hung | 400 | 2,765 | Windows DNS resolver returned nothing |

Final split:

- HTTP only: 286 technologies
- browser: 400
- browser and DNS: 447
- all four layers: 451 confident, 462 with low confidence

## Known issues

- Generic HTML and script patterns can create false positives.
- The `probe` rules are not implemented.
- DOM `properties` are read as HTML attributes because Cheerio has no live DOM properties.
- External script and stylesheet bodies are not downloaded separately anymore. Browser responses do contain them.
- Only the homepage is checked.
- DNS TXT verification tokens and Shopify app signatures can be improved further.
