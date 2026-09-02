# site-score

A Claude Code skill that measures a website on the three public graders and
drives the code changes that push every category toward 100:

| Grader | What it scores |
|---|---|
| [pagespeed.web.dev](https://pagespeed.web.dev/) (Lighthouse 13) | Performance, Accessibility, Best Practices, SEO, and the new Agentic Browsing category |
| [isitagentready.com](https://isitagentready.com/) (Cloudflare) | Protocol-level agent readiness: robots.txt AI rules and Content-Signal, sitemap, `Link` header, markdown negotiation, `.well-known` discovery files, WebMCP, DNS-AID |
| [is-agentic.com](https://is-agentic.com/) (Vercel, scored by Ora) | 125 checks across Essential / Recommended / Bonus: no-JS content, bot reachability, markdown negotiation, 404s, JSON-LD completeness, llms.txt, discovery files |

The skill runs the graders from the command line (all three have public
APIs or a local engine), prints the failing audits with the points they
cost, applies fixes from reference playbooks, verifies locally on a
production build, and reports before/after with shareable report links.

## Install

```
claude plugin marketplace add jayozer/site_score
claude plugin install site-score@site-score
```

Then, in any project:

```
/site-score https://example.com
```

or just ask for a PageSpeed, Lighthouse, Core Web Vitals, accessibility,
SEO, llms.txt, or agent-readiness check; the skill triggers on those.

## What is inside

```
site-score/
├── .claude-plugin/plugin.json
└── skills/site-score/
    ├── SKILL.md                      the workflow: inputs → measure → triage → fix → verify → report
    ├── scripts/
    │   ├── psi.mjs                   PageSpeed Insights API (needs a free PAGESPEED_API_KEY)
    │   ├── lighthouse.mjs            local Lighthouse, all five categories, WebMCP enabled, median of N
    │   ├── lh-summary.mjs            any Lighthouse/PSI JSON → failing-audit scorecard with point costs
    │   ├── isitagentready.mjs        official Cloudflare scan via its public API, UI-identical score
    │   ├── is-agentic.mjs            official Vercel/Ora report via its public API, forced rescan
    │   └── agent-checks.mjs          offline agent-readiness checks for localhost and previews
    ├── references/
    │   ├── lighthouse.md             audit weights per category and the fix for each common failure
    │   ├── agent-readiness.md        what both agent graders check, how they score, the fix per check
    │   └── nextjs-vercel-recipes.md  concrete implementations that reached 100/100/100/100 and 3 of 3
    └── evals/                        skill-creator test prompts, assertions, and a broken demo site
```

## Requirements

- Node 22+ and Chrome (or Chromium) for local Lighthouse; `npx -y lighthouse` fetches the CLI on first use.
- A free PageSpeed Insights API key for `psi.mjs` (Google Cloud Console → enable "PageSpeed Insights API" → create key → `export PAGESPEED_API_KEY=...`). The keyless quota is exhausted at all hours. Without a key the skill measures with local Lighthouse and points you at the pagespeed.web.dev page for the official report.
- No keys for isitagentready.com or is-agentic.com.

## Scripts, standalone

Every script works outside Claude Code too:

```
node skills/site-score/scripts/lighthouse.mjs https://example.com/ --runs 3 --out /tmp/scores
node skills/site-score/scripts/isitagentready.mjs https://example.com/ --profile content
node skills/site-score/scripts/is-agentic.mjs example.com --full
node skills/site-score/scripts/agent-checks.mjs http://localhost:3000
node skills/site-score/scripts/lh-summary.mjs /tmp/scores/lh-example-com-mobile-1.json
```

## Known ceilings

- PSI Performance varies 20+ points between runs on identical code; the skill reports medians and local runs.
- The three WebMCP audits are "not applicable" on pagespeed.web.dev (Google's Chrome lacks the flag); they score locally.
- isitagentready's DNS-AID check needs DNSSEC plus SVCB records at the registrar, which is a DNS change, not code.
- is-agentic activates extra Essential checks when a site publishes API, MCP, or OAuth discovery files, so the skill only adds those when the capability really exists.
