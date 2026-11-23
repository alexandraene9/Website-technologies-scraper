# Website Technologies Scraper

## Task

This is my solution for the SW Engineer Intern take home challenge. The sales team needs to find Shopify stores that use competing analytics or marketing products, so the tool finds technologies used by a website and keeps evidence for every detection.

The challenge gives a list of 200 domains and mentions 477 technologies as a reference. I use `data/domains.parquet` as the input and try to detect as many technologies as possible.

For each match, I keep the actual evidence: a header, cookie, script URL, DOM element, JavaScript variable or DNS record.

## Results

The data is based on `output/summary.json`.

- 459 distinct technologies with confidence at least 50
- 3,058 domain and technology pairs
- 470 distinct technologies if the low confidence matches are included
- 791 detections include a detected version
- 94.9% precision on a sample of 10 sites checked by hand in a real browser (details below), measured before the fixes that came out of that check

The count was 463 before the precision check. The check found false positives caused by overly broad upstream rules, and fixing them removed 4 technologies and about 50 wrong pairs.

The task mentions 477 different technologies. I report 459 confident matches and 470 matches if low confidence detections are included. I keep the two numbers separate because they mean different things.

### Layer contributions

I collect the site in separate layers, then run detection on growing combinations. This gives a fairly clear picture of what each source adds.

| Layers used | Distinct technologies | Domain and technology pairs |
|---|---|---|
| HTTP | 284 | 2,037 |
| HTTP and browser | 399 | 2,609 |
| HTTP, browser and DNS | 453 | 2,877 |
| HTTP, browser, DNS and TLS | 457 | 3,008 |
| HTTP, browser, DNS, TLS and extra pages | 459 | 3,058 |

The browser made the biggest difference. It detects tools that appear only after JavaScript runs, such as Shopify globals, jQuery versions, tag manager scripts and third party request hosts.

DNS found 54 technologies that are not visible in the page source. MX records identified Microsoft 365 and Google Workspace. SPF records showed Mailjet, SendGrid, Amazon SES and similar services. TXT records exposed verification tokens for SaaS tools. NS and SOA records helped identify DNS providers and hosting companies.

The TLS certificate issuer added another small part. Let's Encrypt was detected on 115 domains.

The extra-pages layer added 2 technologies and 50 domain and technology pairs. It checks up to three same-site pages selected from likely shop, cart, blog and contact links. Contact pages bring Google Maps and reCAPTCHA, blog pages bring WordPress plugins that the homepage does not load. For a sales list the pairs matter more than the distinct count, because every pair is one more fact about one company.

### Sites that could not be analysed

Not all 200 entries point to a working website.

- 8 domains no longer resolve
- 2 domains return connection errors or time out
- 24 domains return error pages or bot challenges

The error pages include Cloudflare challenges, old Weebly and booked.net pages, Cloudflare DNS errors and suspended hosting pages. I can still detect infrastructure in these cases, but I cannot see the site's real stack.

This may explain part of the gap to 477, because the input list probably contained sites that were more active when it was collected.

### Shopify leads

The client sells an analytics plugin for Shopify stores. For this reason, `output/summary.json` contains a `shopifyLeads` section with Shopify domains and tools already found on them.

Only 2 domains in this dataset were Shopify stores. For each one the report also gives the theme (read from the theme schema Shopify prints into every store), the Shopify apps and the payment methods:

| Store | Theme | Analytics | Shopify apps and marketing | Payments |
|---|---|---|---|---|
| herbalwise.ie | Unicorn 3.1.0 | Google Analytics, TikTok Pixel | Google & YouTube app, Follow on Shop, Zotabox | Shop Pay, PayPal, Klarna, Apple Pay, Google Pay, cards |
| unnames.com | Dawn 15.4.0 | Google Analytics, Facebook Pixel | Google & YouTube app | Shop Pay, PayPal, Apple Pay |

The theme, Google & YouTube app and Follow on Shop rules are my own (`data/custom/technologies.json`), written after looking at these two stores in the browser and in the raw data. Trident AB was in this table before, but the precision check showed it was a false positive.

I also found Wix eCommerce on 8 domains, Squarespace Commerce on 6, WooCommerce on 6, and Magento, Shopware, Salesforce Commerce Cloud and Square Online on 1 domain each.

Google Analytics was the most common analytics tool, found on 51 domains. Facebook Pixel appeared on 12, Site Kit on 10, LinkedIn Insight Tag on 5, Microsoft Clarity on 4 and Snowplow on 4.

## Output

All output is written inside `output/`.

- `results.json` contains one object per domain, with status, errors, confident technologies and low confidence technologies
- `results.csv` contains one flattened row per domain and technology
- `summary.json` contains layer results, top technologies, categories, errors, Shopify leads and `discoveryCandidates` (signals that no rule explains yet)
- `precision-check.json` contains the manual check of 10 sites, with every false positive and its cause
- `raw/` contains cached responses and signals for each domain (not committed, regenerated by `npm run scan`)

Each detection includes a category, version, confidence and evidence. If the technology was inferred from another one, `impliedBy` is used instead of direct evidence.

Example:

```json
{
  "name": "Google Workspace",
  "categories": ["Email", "Webmail"],
  "version": null,
  "confidence": 100,
  "evidence": [
    {
      "layer": "dns",
      "type": "dns",
      "key": "MX",
      "pattern": "aspmx\\.l\\.google\\.com",
      "value": "aspmx.l.google.com",
      "confidence": 100
    }
  ]
}
```

## How the project works

```text
domains.parquet
      |
      v
collectors collect raw signals
  HTTP: headers, cookies, HTML, meta tags, scripts, robots.txt
  Browser: rendered DOM, JavaScript globals, cookies, request hosts, JS and CSS bodies
  DNS: MX, TXT, NS, SOA and CNAME records
  TLS: certificate issuer
  Pages: up to three selected same-site product, shop, cart, blog or contact pages
      |
      v
raw data is cached in output/raw/<domain>.json.gz
      |
      v
engine matches cached signals against fingerprints
  pattern matching
  version extraction
  confidence
  implies, requires and excludes
      |
      v
results.json, results.csv, summary.json
```

The collectors only gather data. The engine only reads signals and does not make network requests. This separation made it possible to test the matching logic and to rerun detection offline.

### Main decisions

**Using upstream fingerprints**

There are far too many technologies to write all the fingerprints by hand. I use the community maintained [enthec/webappanalyzer](https://github.com/enthec/webappanalyzer) rules from `data/fingerprints/`. They are in the Wappalyzer format and are merged with my own rules from `data/custom/technologies.json`.

The matching engine is custom: it does not copy or wrap the Wappalyzer package.

**Separating collection and detection**

Collection depends on the network and takes much longer than detection. Once the raw data is cached, I can change the matching engine and run `npm run detect` over all domains in about one minute.

The cache also means that a failed layer can be collected again without recrawling everything. A scan only collects missing or explicitly refreshed layers.

**Keeping the evidence**

A name alone is not very useful for this task. I store the matched pattern and signal, for example an MX value or a JavaScript global. The version and confidence are also kept.

Matches found only inside downloaded JavaScript or CSS files use a confidence of 25. They are shown under `lowConfidence` because library code often mentions unrelated tools.

**Using more than one layer**

No single source is enough. HTTP gives headers and page source, the browser catches rendered content and JavaScript, DNS gives email and verification records, and TLS gives certificate issuers.

## Problems and fixes

- One domain hung during the first run and no outputs were written. I added a hard timeout for every layer and force close the browser context after 75 seconds.
- The Node resolver returned empty DNS answers on Windows. I added DNS over HTTPS with Cloudflare and Google, then UDP with 1.1.1.1 and 8.8.8.8 as fallback.
- Some websites use expired or mismatched certificates. The HTTP request accepts invalid certificates because I am only collecting the page.
- Chromium sometimes fails with `ERR_HTTP2_PROTOCOL_ERROR`. I retry with HTTP/2 disabled.
- Some pages are only partly loaded when navigation times out. I keep the partial page and retry reading the page content.
- DOM matching was slow. I added a selector prefilter that compares common literal parts against an indexed HTML string. It skips about 96 percent of impossible selector checks without losing matches in the test set. Detection went from more than 10 minutes to about 1 minute.

## Checking precision by hand

I had no reference list, so I could only count detections, not prove they were right. I picked 10 sites on different platforms and checked every detection against the live site in a real browser: was the script, request, JavaScript global, DOM element or header really there, and does that evidence really mean the technology is used.

| Site | Platform | Detections | Wrong |
|---|---|---:|---:|
| herbalwise.ie | Shopify | 27 | 1 |
| gapconstructionwi.com | Wix | 26 | 7 |
| cultivateventures.co.nz | Squarespace | 16 | 3 |
| 11thhourracing.org | Webflow | 32 | 1 |
| insieme.stanford.edu | Drupal on Acquia | 18 | 1 |
| footasylum.com | Next.js | 37 | 1 |
| empresasori.com | WordPress and WooCommerce | 30 | 0 |
| a3sec.com | HubSpot CMS | 30 | 0 |
| 959marine.com | Weebly | 19 | 0 |
| ecolab.com | Sitecore and Next.js on Vercel | 40 | 0 |
| **Total** | | **275** | **14** |

That is 94.9% precision. The mistakes were not random, most came from upstream patterns that are too broad:

- The Wix site was also detected as WordPress.com, WordPress, PHP and MySQL, because a Wix config flag is called `ImportFromWordPressInsideMenu`. Wix's own `svSession` cookie triggered two other products, and Onsen UI matched because "c**onsen**t" contains "onsen".
- On Squarespace, Bootstrap came from a file called `cart-bootstrap`, parallax.js from Squarespace's own parallax effect and Stimulus from any `data-controller` attribute.
- Trident AB matched the word "trident" in Internet Explorer detection code.

I fixed 11 of the 14 with overrides in `data/custom/technologies.json` (an entry with `"$replace"` swaps an upstream field for a stricter pattern) and by applying `excludes` before `implies`, so an excluded technology can no longer imply others. On the full dataset this removed about 50 wrong domain and technology pairs. The 3 I left are harder: AccessiWay shares its JavaScript object with accessiBe, and two detections come from indirect evidence (a CSP header and a CDN that implies Cloudflare). A sample of 10 sites is small and the fixes were made on the same sample, so the 94.9% is a rough measure, not a final one. Every case is listed in `output/precision-check.json`.

## Things I decided not to use

I tried counting matches from external JavaScript bodies at full confidence. It raised the count to 461, but it also produced obvious false positives. Google Tag Manager library code found DoubleClick Floodlight on 45 sites. Generic text strings found PHP and Strava. I kept these matches in a separate low confidence section instead.

I did not wrap an existing Wappalyzer library. It would have been faster, but this project needed visible implementation work and I wanted to understand the pattern rules.

I keep the extra page crawl small. The tool samples up to three same-site pages, prioritizing shop, cart, product, blog and contact routes. This keeps the scan practical without crawling the whole website.

## Running the project

Requirements: Node.js 20 or newer.

```bash
npm install
npx playwright install chromium

npm run scan:static
npm run scan
npm run rescan:browser
npm run rescan:pages
npm run detect
npm test
npm run typecheck
npm run fingerprints:update
```

`scan:static` uses HTTP, DNS and TLS. `scan` also adds the browser and extra pages. `detect` only uses cached raw data.

Useful flags:

```text
--limit 10
--only a.com,b.com
--fresh
--refresh browser,dns,pages
--no-pages
--input other.txt
```

On Windows PowerShell, `npm run scan -- --flag` can drop the `--`. In that case I use `npx tsx src/index.ts scan --flag`.

## Project structure

```text
src/
  index.ts                 CLI and scan pipeline
  config.ts                timeouts, concurrency and paths
  types.ts                 shared data types
  input/readDomains.ts     reads parquet or text input
  collectors/              HTTP, browser, DNS, TLS, extra pages and HTML extraction
  engine/                  fingerprints, pattern parsing and matching
  output/                  JSON, CSV and summary writers

data/
  domains.parquet
  fingerprints/            vendored upstream rules
  custom/technologies.json my own rules and overrides for false positives

tests/
  matcher.test.ts

output/
  results.json
  results.csv
  summary.json
  precision-check.json
  raw/
```

## Debate topics

### 1. Main issues and fixes

There is no ground truth. I checked 10 sites by hand (94.9% precision), but that sample is small and says nothing about recall, the technologies I miss. Next I would label 30 to 50 sites across platforms, keep half of them only for testing, and measure precision and recall per category after every rule change.

Some upstream rules are too generic. Short HTML and script regexes can match unrelated text. I would require independent evidence for selected categories or lower the confidence for matches inside JSON blobs and minified library code.

Only the homepage runs in the browser. The extra pages are fetched over plain HTTP, so tools that load only after JavaScript runs on those pages are missed. For Shopify stores, most apps now load as sandboxed "web pixels" in separate frames, so their identity is hidden behind numeric ids. Mapping those ids to apps would need the browser to follow those frames.

Some sites are dead or protected. I would retry later, mark bot challenges clearly and consider a more realistic browser profile or a residential IP.

### 2. Scaling to millions of domains

One million domains in 30 days is about 0.4 new domains per second. Ten million is about 4 per second. The browser is the expensive part, so I would use it selectively.

The cheap tier would run DNS, TLS and one HTTP request for every domain. Only likely browser cases would go to the second tier: JavaScript-heavy sites, tag manager users and e-commerce domains.

The system would use a queue and stateless workers. Domains could be stored in SQS, Kafka or Redis Streams. Cheap workers and browser workers would scale separately. Raw signals would go to object storage such as S3.

Detection should remain separate. Collected signals could be processed in batch jobs in Node, or in Spark if the volume grows. Updating fingerprints would not require recrawling existing domains.

I would add rate limits per IP and hosting provider, local DNS caching, a clear user agent and robots.txt handling for extra pages. Popular and e-commerce domains could be recrawled more often, while unchanged domains could be skipped.

Monitoring should cover success rate per layer, TLD and worker. This would make DNS or certificate problems visible quickly.

### 3. Finding new technologies

The browser and DNS collectors already expose useful candidates: third party hosts, script URLs, JavaScript globals, cookie names, response headers and verification tokens.

I built a first version of this. `summary.json` has a `discoveryCandidates` section: third party hosts and DNS verification tokens that no rule explains, ranked by how many domains have them. On this dataset it found Google Search Console (`google-site-verification` on 46 domains), KnowBe4, Sophos, Validity, PeopleXD, MailerLite, Pinterest, Sitecore and Canva tokens, plus Canva embeds and Font Awesome kits in the browser requests. I turned them into rules in `data/custom/technologies.json`. The host list is still noisy: big platforms like Google and Facebook have many hosts that are infrastructure, not products. A list of known infrastructure hosts would clean it up.

TXT verification patterns such as domain and site verification names are another good source. X response headers and generator meta tags can reveal CMS and builder products.

For this client, the Shopify App Store is especially useful. Shopify app scripts often appear under predictable CDN or app domains, so new competitor apps can be added as soon as they are observed.

New rules should be checked against several domains before they are added. The strongest fixes can then be sent upstream.

## How I worked

I chose Node and TypeScript, built the collector and detection flow, ran the scans on my own machine and checked the results after each run. I used an AI assistant for parts of the implementation and for repetitive browser work, but I reviewed the code, chose the architecture and validated the changes and results myself. `BRAIN.md` contains the project log with runs, decisions and open issues.

## License

GPL-3.0, because the fingerprint data in `data/fingerprints/` is GPL-3.0.
