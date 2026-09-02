---
name: agent-perfect-website
description: Measure and maximize a website's scores on Google PageSpeed Insights (Performance, Accessibility, Best Practices, SEO, and the new Agentic Browsing category), Cloudflare's isitagentready.com, and Vercel's is-agentic.com, then make the code changes that push every category toward 100. Use this whenever the user mentions PageSpeed, Lighthouse, Core Web Vitals, LCP/CLS/TBT/INP, site speed, web vitals, accessibility or SEO scores, agent readiness, agentic browsing, llms.txt, AI crawlers (GPTBot, ClaudeBot, PerplexityBot), serving markdown to agents, WebMCP, or wants a site audited, scored, or "checked" for quality, even if they name only one of the three tools or none of them.
---

# Agent-Perfect Website: measure, fix, verify, report

Three public graders, one goal: every category as close to 100 as the
platform allows.

| Grader | What it scores | Reached on a real site |
|---|---|---|
| pagespeed.web.dev (Lighthouse 13) | Performance, Accessibility, Best Practices, SEO (0-100 each) and Agentic Browsing (passed/applicable) | 100 / 100 / 100 / 100 / 3 of 3 |
| isitagentready.com (Cloudflare) | Protocol presence: robots.txt with AI-bot rules and Content-Signal, sitemap, `Link` header, DNS-AID records, markdown negotiation, `.well-known` discovery files (MCP card, agent skills, api-catalog, OAuth, ARD), WebMCP. Level 0-5 plus a 0-100 that depends on the profile | 71 (Content profile, Level 5); 100 needs DNSSEC + DNS-AID |
| is-agentic.com (Vercel, scored by Ora) | 125 checks in Essential (80 pts) / Recommended (20) / Bonus (+5): no-JS content and headings, bot reachability, markdown negotiation, 404s, JSON-LD completeness, trust pages, llms.txt, discovery files | 79 → 100 after the recipes in `references/nextjs-vercel-recipes.md` |

Scripts in `scripts/` do the measuring; references hold the playbooks. Read
only the reference the scorecard points you to.

## 0. Establish the inputs (do not ask what you can infer)

- **Target URL(s).** Production URL from the repo (`metadataBase`, `sitemap`,
  README, `vercel.json`) or the user. Score the homepage plus the main
  templates (a content page, a listing, a post, contact/forms, 404). Graders
  are per-URL; a 100 on the homepage with a 90 on every post is not done.
- **The code.** Framework (Next.js, Astro, plain HTML, Webflow export...),
  hosting (Vercel, Cloudflare, Netlify), CSS pipeline, where third-party tags
  load, existing tests. Check git history and any TODO/audit notes for what has
  already been fixed or deliberately declined so you do not re-propose it.
- **PageSpeed API key.** Look for `PAGESPEED_API_KEY` (or `PSI_API_KEY`,
  `GOOGLE_API_KEY`) in the environment or `.env*`. The keyless quota is gone
  (HTTP 429 on the first call), so without a key use local Lighthouse for the
  numbers and the browser for the official report. Tell the user a free key
  (Google Cloud Console → enable "PageSpeed Insights API" → API key) makes
  the loop scriptable; do not block on it.
- **Browser automation.** Both agent-readiness graders have public APIs
  (scripts below), so only pagespeed.web.dev needs a browser when there is
  no API key. If Claude-in-Chrome or Playwright tools are available, run it
  yourself; otherwise ask the user to paste the PageSpeed result at the
  checkpoints below.
- **`<skill>`** in the commands below is this skill's directory (the base
  directory shown when the skill loaded).

## 1. Measure the baseline

Save everything under a scratch directory (never inside the repo unless it is
gitignored), e.g. `--out /tmp/agent-perfect-website/<date>`.

```
# Official Lighthouse numbers (needs key). Mobile is the one people quote.
node <skill>/scripts/psi.mjs https://example.com/ --strategy both --runs 2 --out <dir>

# Local Lighthouse, all five categories, WebMCP enabled. Median of 3 is the stable truth check.
node <skill>/scripts/lighthouse.mjs https://example.com/ --runs 3 --out <dir>

# Official Cloudflare agent-readiness score (public API, no key, no browser). Content profile for content sites.
node <skill>/scripts/isitagentready.mjs https://example.com/ --profile content --out <dir>
node <skill>/scripts/isitagentready.mjs https://example.com/ --profile all --out <dir>

# Official Vercel/Ora score (public API). --rescan after a deploy; --full shows passes, partials and bonus signals.
# Reports are keyed by exact host: scan the host the site canonicalizes to (www or apex).
node <skill>/scripts/is-agentic.mjs example.com --full --out <dir>

# Offline agent-readiness checks (robots/llms.txt/negotiation/Link header/JSON-LD/headers/bot access/404).
# Works on localhost and previews, which the official graders cannot reach.
node <skill>/scripts/agent-checks.mjs https://example.com
```

Then cover the templates, not the whole sitemap: the homepage plus four or
five representative URLs (a content page, a listing, a post, a page with
forms, the 404), one Lighthouse run each. Non-performance categories are
deterministic, so one run is enough there, and Performance outliers show up
on the first pass anyway (a 10 MB gallery page reads 51 every time). Only if
a template scores oddly go to three runs. For a true whole-site sweep use
`npx unlighthouse --site <url>`, which crawls the sitemap and shows every
page's four scores without 30 MB of JSON.

The two agent-readiness numbers above are the official ones (same APIs the
sites use). PageSpeed is official only through the API key or the browser:
without a key, open `https://pagespeed.web.dev/analysis?url=<encoded url>&form_factor=mobile`
(browser tools or the user), wait for the run, and capture the five scores
and the failed audits. Record shareable report URLs: PageSpeed's
`/analysis/<slug>/<id>` links and `https://is-agentic.com/scan/<host>` are the
evidence the user will want later.

Write the baseline as one table (page × grader × category) plus the raw
failing-audit list from `lh-summary.mjs`. That table is the "before" column
of the final report, so keep it.

## 2. Triage: turn failures into a ranked fix list

`lh-summary.mjs` prints each failing weighted audit with the points it costs
and the offending elements. Combine that with the agent-checks output and the
official graders' failed items, then rank by:

1. **Points per change.** One root-cause fix often clears several audits on
   every page (a cookie banner without a name, a carousel putting
   `role=group` on `<li>`, a brand color token below AA contrast, a missing
   favicon that 404s on every page). Prefer those over per-element patches.
2. **Which grader it moves.** Performance is the noisiest and most expensive
   to move; Accessibility/Best Practices/SEO failures are deterministic and
   cheap; agent-readiness items are mostly new files and headers.
3. **Risk to the design.** Contrast, spacing, and heading changes touch
   visuals. Make the minimal change (darken a token a few percent, enlarge a
   hit area with padding instead of the visual, add `sr-only` headings) and
   say so in the report. Never restructure a page the owner has settled.

State the plan in a few lines before editing: what you will change, which
audits it targets, and what will look different. If the user is not present,
proceed with the plan and put those lines in the report.

Things that look like fixes but are not: hiding content from Lighthouse or
serving different HTML to graders (cloaking), disabling analytics or consent
scripts instead of deferring them, `noindex`ing pages to dodge SEO audits,
deleting alt text to silence "redundant alt", removing the third-party
widget the business relies on without asking. If a score can only reach 100
by doing one of these, report the ceiling instead.

Two more rules for anything agents will read (llms.txt, JSON-LD, markdown
twins, SKILL.md files, `.well-known` catalogs):

- **Only facts the site already states.** Hours, prices, policies, "how
  orders are confirmed", credentials: take them from the pages or the data
  files, never infer them. Where a fact is missing, leave a clearly marked
  placeholder for the owner rather than a plausible sentence. An agent will
  repeat whatever you write as if the business said it.
- **Only capabilities the site really has.** An api-catalog, MCP server
  card, OAuth metadata, or A2A card on a site with no API, MCP server, or
  auth server misleads agents and, at is-agentic.com, switches on a surface
  of Essential checks the site then fails. Add those only when the thing
  they describe exists. The agent-skills index, ai-catalog, llms.txt, and
  markdown twins are safe for any site.

## 3. Fix, by category

Open the reference that matches the failing category and apply its recipe.
Each reference explains why the audit fails and the change that generalizes.

- Lighthouse categories, weights, and per-audit fixes: `references/lighthouse.md`
- Agent-readiness graders (what isitagentready.com and is-agentic.com check, how they weigh it, and the fix for each item): `references/agent-readiness.md`
- Concrete Next.js/Vercel implementations of every fix above (CSS bundling and inlining, fonts, LCP hero pattern, deferred GTM, IntersectionObserver mounts, contrast tokens, favicon, security headers, robots/llms.txt/sitemap route handlers, markdown content negotiation, WebMCP tools, tests): `references/nextjs-vercel-recipes.md`

Order of operations that has worked: (1) deterministic categories first
(Accessibility, Best Practices, SEO) because each fix is verifiable in one
local run; (2) agent-readiness files and headers (robots.txt, llms.txt,
JSON-LD, markdown negotiation, 404s, security headers) because they also
lift Agentic Browsing and SEO; (3) Performance last, biggest lever first
(render-blocking CSS/fonts → LCP resource → third-party timing →
hydration/DOM size → CLS), re-measuring after each step so you know which
change moved which metric.

Work on a branch; one commit per root cause with the audit ids in the
message; keep the CSS/asset pipeline's build steps runnable (`npm run build`
must pass before you measure).

## 4. Verify: local, preview, production, official

1. **Local.** Production build served by the production server
   (`npm run build && npx next start -p 4123`, or the framework equivalent;
   never the dev server, it is unminified and unrepresentative). Run
   `lighthouse.mjs` (3 runs) and `agent-checks.mjs` against `http://localhost:4123`.
   Localhost is a floor for Performance (no CDN, no brotli/h2) and exact for
   everything else. Run the project's tests.
2. **Preview deploy.** Push the branch, measure the preview URL the same way.
   Preview deployments on Vercel may sit behind deployment protection; use a
   bypass token or measure production after merge instead.
3. **Production.** After merge/deploy, wait for the CDN edge to warm (open the
   page once, wait a minute), then `psi.mjs --runs 3` or three local runs,
   `isitagentready.mjs`, and `is-agentic.mjs --rescan` (stored reports go
   stale). A run right after deploy can read 10-15 points low on Performance;
   the median of three is the number.
4. **Confirm the failures are gone by audit id**, not just by score. A score
   can drift up while the audit you targeted still fails.

If an official grader still flags something the local checks pass, read its
exact wording, reproduce with `curl` using that grader's headers/user agent
(bot management and WAF challenges look like code bugs but are firewall
rules), and only then change code.

## 5. Report

```
# Site scores: <site> — <date>

| Page | Perf | A11y | BP | SEO | Agentic | isitagentready | is-agentic |
|---|---|---|---|---|---|---|---|
| / | 74 → 100 | 90 → 100 | 92 → 100 | 100 | 1/2 → 3/3 | 62 → 91 | 79 → 95 |
| /contact | ... |

Official reports: <pagespeed.web.dev links>, <grader screenshots or pasted results>

## What changed (by root cause, with audit ids)
- ...

## What could not reach 100 and why
- e.g. WebMCP audits are "not applicable" on PSI (Google's Chrome lacks the flag); verified locally 6/6.
- e.g. Vary: Accept on HTML variants is overwritten by the framework; harmless, documented.

## Maintenance
- commands to re-measure; where the key lives; what to watch after content changes
```

Keep score claims tied to a saved JSON or a report URL. If a number came from
one run, say so.

## Known ceilings (report them, do not fight them)

- PSI Performance varies 20+ points on identical code; compare medians and
  local runs before declaring a regression or a win.
- Agentic Browsing on PSI counts only the audits Google's runner can execute;
  the three WebMCP audits stay "not applicable" there. Score them locally.
- Some frameworks strip or overwrite `Vary` on page responses; the
  negotiated markdown responses can still be correct and cacheable.
- Third-party scripts the business needs (tag manager, chat, booking widget)
  can be deferred past the scored window but not removed by you.
- The two agent-readiness graders weigh checks differently and change over
  time; a 100 on one can be a 90 on the other with identical code. Report both.
- Grader runs can be blocked by the host's bot protection (Vercel challenge
  mode, Cloudflare bot fight mode). That is a firewall setting, not code.

## Files

- `scripts/psi.mjs` — PageSpeed Insights API runner (key via env/flag; mobile/desktop; N runs; median; saves JSON; prints scorecard).
- `scripts/lighthouse.mjs` — local Lighthouse runner with WebMCP flags, all five categories, N runs, median.
- `scripts/lh-summary.mjs` — turns any Lighthouse or PSI JSON into the failing-audit scorecard (`--top N`, `--all`, `--json`).
- `scripts/isitagentready.mjs` — official Cloudflare scan via the public API, UI-identical score, per-check fixes (`--profile`, `--checks`, `--agent`, `--list`, `--json`).
- `scripts/is-agentic.mjs` — official Vercel/Ora report via the public API, forced rescan, full per-check view (`--rescan`, `--full`, `--json`).
- `scripts/agent-checks.mjs` — no-browser agent-readiness checks with pass/warn/fail and fixes (`--pages N`, `--json`).
- `references/lighthouse.md`, `references/agent-readiness.md`, `references/nextjs-vercel-recipes.md` — the playbooks.
