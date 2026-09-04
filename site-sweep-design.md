# site-sweep.mjs — design

**Status:** approved direction, not yet built · **Date:** 2026-09-03 · **Target version:** 1.1.0

## Why

Two gaps found while pointing the skill at a real site (dataacrobat.com):

1. **Only the homepage gets scored.** `psi.mjs` and `lighthouse.mjs` accept exactly one URL. SKILL.md §1 tells the agent to "cover the templates, not the whole sitemap" and delegates a true sweep to `npx unlighthouse`. The user wants every page scored, in one command, in the skill's own output format.
2. **Nothing resolves the canonical host.** Graders are keyed by exact host (`is-agentic.com` especially). Scanning `dataacrobat.com` when the site canonicalizes to `www.dataacrobat.com` produces a report for a redirect. Today the only mention is a one-line aside next to `is-agentic.mjs`.

A third gap surfaced on the same site: **no `sitemap.xml`, no `robots.txt`** (both return the Next.js 404 page). Sitemap-only discovery would find zero pages, so link-crawl fallback is required, not optional.

## Decision already made

Depth: **full 5-category Lighthouse on every discovered page**, with a concurrency limit and a `--max` cap. (Alternatives considered and rejected: tiered cheap-on-all/deep-on-sample; shallow-only with `unlighthouse` for depth.)

## The script

`scripts/site-sweep.mjs <host-or-url> [flags]` — three stages.

### 1. Resolve the canonical host

Input can be `dataacrobat.com`, `www.dataacrobat.com`, or a full URL.

- Follow redirects from `https://<host>/`; record the final host.
- Fetch the homepage and read `<link rel="canonical">`.
- **Agree** → proceed on that host, print one line saying which and why.
- **Disagree** → print a WARN and proceed on the redirect target. A redirect/canonical mismatch is itself an SEO finding and goes in the report.
- Every discovered URL is normalized to the resolved host before scoring.

`--host <h>` overrides resolution when the user knows better.

### 2. Discover pages

First source that yields ≥1 URL wins:

1. `/sitemap.xml` — recurse one level into `<sitemapindex>` (fixes the existing `agent-checks.mjs` bug where an index returns `[]`).
2. `Sitemap:` lines in `/robots.txt` (may point at a non-default path).
3. Same-origin link crawl from the homepage: BFS, `--depth` (default 3), follows `<a href>` only.
4. `--urls <file>` — explicit list, one per line, skips discovery entirely.

Filters applied to every candidate: same resolved host only; strip `#fragment` and `?query`; drop non-HTML extensions (`.pdf .xml .txt .jpg .png .webp .svg .css .js .json`); dedupe; `--exclude <regex>`; respect `--max`.

Print: `discovered N pages (source: sitemap | robots | crawl | --urls)`.

### 3. Score every page

- `--engine psi|local` (default `psi` when a key is present, else `local`).
  - `psi` — official numbers, remote only, needs `PAGESPEED_API_KEY`.
  - `local` — works on localhost/previews, scores the WebMCP audits PSI cannot.
- `--strategy mobile|desktop|both` (default `mobile`).
- `--runs N` per page (default 1; deterministic categories don't need more).
- `--concurrency` default **3 for psi, 1 for local**. Local Lighthouse is CPU-bound; parallel local runs corrupt each other's Performance numbers.
- `--max` default **50**. Before starting, print `N pages × ~Ts ≈ M min` and stop at the cap with a clear message rather than silently truncating.

**Reuse, don't duplicate.** Extract `runOne(url, opts)` from `psi.mjs` and `lighthouse.mjs` (each keeps its CLI byte-identical) and have the sweep call it. Median-of-runs logic stays where it is.

### Output

- **Streaming:** one score line per page as it finishes, so a 30-minute run is never silent.
- **Table:** page × `perf a11y bp seo agentic` markdown, sorted by path. This is the "before" column SKILL.md §5 wants.
- **Worst page per category.**
- **Failing audits grouped across pages:** `audit-id — N pages — [paths]`. A site-wide root cause (favicon 404, global contrast token) shows once, not fourteen times.
- **Files:** every LHR/PSI JSON under `--out` (default `./agent-perfect-website-out`), plus `sweep.json` (host resolution, discovery source, per-page scores, audit index) so `lh-summary.mjs` and the report step can be rerun without re-scoring.

## SKILL.md edits

- **§0 inputs** — add: *Resolve the canonical host first (`site-sweep.mjs --dry-run` prints it). Score and scan the host the site canonicalizes to; a report on the redirecting host is a report on a redirect.*
- **§1 measure** — the sweep becomes the default baseline command. The "homepage plus four or five templates" paragraph is kept as the **fast path while iterating on fixes**, not the baseline. Keep the `unlighthouse` pointer as an alternative.
- **§5 report** — the table is every page, not a sample. Add the cross-page audit roll-up as a required section.
- Keep the two rules for agent-readable content and the "known ceilings" list unchanged.

## Other changes

- `agent-checks.mjs` — recurse sitemap indexes instead of returning `[]`.
- `plugin.json` — `1.0.1` → `1.1.0`.
- `README.md` — one paragraph + the command.

## Testing

- **Discovery:** serve `evals/files/demo-site/` (4 static pages, no sitemap) on localhost → crawl must find all 4. Add a sitemap-index fixture → must recurse.
- **Canonical resolution:** `dataacrobat.com` → resolves to `www` with agreement; a non-redirecting host → passes through unchanged; a synthetic mismatch → WARN path.
- **Scoring:** `--engine local --max 4` against the demo site → 4 rows, `sweep.json` written, existing `psi.mjs`/`lighthouse.mjs` CLIs unchanged (diff their output before/after the `runOne` extraction).
- **Skill wording:** fresh agent reading the new §1 sweeps all pages instead of sampling — verified by the eval in `evals/evals.json`.

## Not in scope

- Scoring the two agent-readiness graders per page — they are per-host and run once already.
- Persisting history across runs or diffing against a previous sweep.
- Anything that changes the site's HTML to influence graders (cloaking rules in SKILL.md still apply).

## Deployment note

This repo is the source. The installed plugin runs from `~/.claude/plugins/cache/agent-perfect-website/…`. Changes here reach `acrobat_website` only after push + plugin update.
