# BRAIN.md

## Current status

- Full scan is done. 459 confident technologies, 470 including low confidence matches, 3,058 confident domain technology pairs (463 before the precision fixes).
- Extra same-site pages add 2 technologies and 50 domain technology pairs.
- Manual precision check on 10 sites: 94.9% (14 wrong out of 275). 11 of the 14 fixed with overrides in `data/custom/technologies.json`. Details in `output/precision-check.json`.
- Added ranked discoveryCandidates and richer Shopify lead fields for themes, apps and payments.
- HTTP, browser, DNS, TLS and pages results are all cached under `output/raw/`.
- The README is written and now includes the honest results, implementation choices, problems and the three debate topics.
- TypeScript typecheck passes and 7 unit tests pass.
- Final documentation is pushed to GitHub in commit cc46a79.

## Next steps

1. Review the README once more and change wording where needed.
2. Check suspicious detections in `output/results.json` or `output/summary.json`.
3. Confirm there are no personal or temporary paths in final files.
4. Perform one last review for the interview and submission.

## Decisions

- 2026-11-23: Custom rules can override upstream fields with `"$replace"`. Excludes are applied before implies, so an excluded technology cannot imply others. Both came from the precision check (Wix detected as WordPress, Onsen UI matching "consent", Bootstrap matching "cart-bootstrap").
- 2026-11-23: Extra pages are fetched over plain HTTP, not in the browser, to keep the scan cheap.
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

- HTTP only: 288 technologies
- browser: 403
- browser and DNS: 457
- browser, DNS and TLS: 461
- all layers including extra pages: 463 confident, 474 with low confidence
- after precision fixes: HTTP 284, browser 399, DNS 453, TLS 457, extra pages 459 confident, 470 with low confidence

## Known issues

- Generic HTML and script patterns can create false positives.
- The `probe` rules are not implemented.
- DOM `properties` are read as HTML attributes because Cheerio has no live DOM properties.
- External script and stylesheet bodies are not downloaded separately anymore. Browser responses do contain them.
- Extra pages are limited to three same-site links selected from useful routes, fetched without the browser.
- Shopify apps that load as sandboxed web pixels are only visible as numeric ids.
- Remaining known false positives: AccessiWay (shares accessiBe's object), Amazon S3 from CSP headers, Cloudflare implied by cdnjs.
- DNS TXT verification tokens and Shopify app signatures can be improved further.
