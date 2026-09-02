# site-score

**One command that audits your site on the three graders that matter in 2026, then fixes what is failing until every score is as close to 100 as the platform allows.**

```
/site-score https://your-site.com
```

| Grader | What it scores | Where a real site landed after this skill |
|---|---|---|
| [PageSpeed Insights](https://pagespeed.web.dev/) (Lighthouse 13) | Performance · Accessibility · Best Practices · SEO · **Agentic Browsing** | 67 → **100** · 90 → **100** · 92 → **100** · **100** · 1/2 → **3/3** |
| [Is It Agent Ready?](https://isitagentready.com/) (Cloudflare) | Can agents discover and read the site: robots AI rules, Content-Signal, sitemap, `Link` header, markdown negotiation, `.well-known` discovery, WebMCP, DNS-AID | Level 3 → **Level 5**, 71/100 on the Content profile |
| [Is Agentic](https://is-agentic.com/) (Vercel, scored by Ora) | 125 checks: content without JS, bot reachability, markdown negotiation, real 404s, JSON-LD completeness, llms.txt, trust pages | 79 → **100** |

Numbers are from [poppykidsdental.com](https://www.poppykidsdental.com), a Next.js 16 site on Vercel, the site this skill was built on.

## Why this exists

Every deploy nudges your scores. Checking them means opening three sites, pasting a URL three times, reading three different report formats, working out which audit actually lost the points, guessing at a fix, redeploying, and doing it all again. After a few weeks of that I stopped checking, which is how a footer link quietly cost the homepage three accessibility points.

This skill turns that chore into a loop Claude runs end to end:

1. **Measure** all three graders from the command line. Two of them have public APIs; the third is Lighthouse, which runs locally with the same engine PageSpeed uses.
2. **Rank** every failing audit by the points it costs, with the offending element or URL next to it.
3. **Fix** from playbooks that explain why each audit fails and which change generalizes, not per-element patches.
4. **Verify** on a production build locally, then on the deploy, by audit id, with the median of three runs so PageSpeed's run-to-run swing does not fool anyone.
5. **Report** before and after, with the shareable report URLs, and an honest list of what cannot reach 100 and why.

## Install

```
claude plugin marketplace add jayozer/site_score
claude plugin install site-score@site-score
```

Restart Claude Code, then in any project:

```
/site-score https://your-site.com
```

You do not have to remember the command. The skill triggers on ordinary requests like these:

- "Why did my accessibility score drop to 97?"
- "Check this site on pagespeed and tell me what to fix"
- "Make ./my-static-site agent-ready and get it to 100"
- "Is my robots.txt blocking ChatGPT and Claude?"
- "Add an llms.txt and markdown for agents"

## What it does, in order

**Establish inputs.** Finds the production URL from the repo, works out the framework and host, checks for a PageSpeed API key, and reads the project's own notes so it does not re-propose things you already declined.

**Measure the baseline.** Homepage plus the main templates (a content page, a listing, a post, a page with forms, the 404). Five categories from local Lighthouse with WebMCP enabled, both agent graders through their APIs, and an offline agent-readiness pass that also works on localhost and preview deploys.

**Triage.** One root-cause change often clears several audits on every page at once: a cookie banner without an accessible name, a carousel that puts `role=group` on `<li>`, a brand color a few percent short of AA contrast, a favicon that 404s everywhere. Those come first. Contrast, spacing, and heading changes touch the design, so the change is minimal and called out in the report.

**Fix.** Playbooks for each category, plus concrete Next.js and Vercel implementations for every recipe (CSS bundling and inlining, self-hosted fonts, the LCP hero pattern, deferred tag managers, IntersectionObserver mounts for below-the-fold widgets, contrast tokens, security headers, robots.txt and llms.txt route handlers, markdown content negotiation, WebMCP tools, tests).

**Verify.** `npm run build` served by the production server, never the dev server. Local numbers are a floor for Performance and exact for everything else. Then the deploy, then the official graders again.

**Report.** A table per page and grader, what changed by root cause with audit ids, what could not reach 100, and the commands to re-measure next time.

## What it will not do

- Hide content from graders or serve them different HTML.
- Disable analytics or consent scripts. It defers them past the scored window instead.
- `noindex` pages to dodge SEO audits, or delete alt text to silence warnings.
- Publish API, MCP, or OAuth discovery files on a site that has no API, MCP server, or auth server. Those mislead agents and, on is-agentic, switch on Essential checks the site then fails.
- Invent business facts for llms.txt or JSON-LD. Hours, prices, and policies come from the site; anything missing becomes a marked placeholder for the owner.

If a score can only reach 100 by doing one of these, the report says so.

## Scripts

Each script also works on its own, outside Claude Code (Node 22+):

| Script | What it does |
|---|---|
| `psi.mjs <url>` | PageSpeed Insights API, all five categories, mobile and desktop, N runs, median. Needs `PAGESPEED_API_KEY`. |
| `lighthouse.mjs <url>` | Local Lighthouse 13 with WebMCP enabled, N runs, median. The stable truth check. |
| `lh-summary.mjs <json>` | Any Lighthouse or PSI JSON in, a scorecard out: failing audits, points lost, offending elements. |
| `isitagentready.mjs <url>` | Cloudflare's official scan through its public API, scored exactly as the UI does, per profile, with the fix for each failing check. |
| `is-agentic.mjs <host>` | Vercel's official report through its public API, forced rescan after a deploy, Ora's full per-check list. |
| `agent-checks.mjs <url>` | Offline agent-readiness checks for localhost and previews: robots, llms.txt, negotiation, `Link` header, JSON-LD, headers, bot access, 404s. |

```
node site-score/skills/site-score/scripts/lighthouse.mjs https://example.com/ --runs 3 --out /tmp/scores
node site-score/skills/site-score/scripts/isitagentready.mjs https://example.com/ --profile content
node site-score/skills/site-score/scripts/is-agentic.mjs example.com --full
```

## The graders, decoded

The reference files inside the skill hold the details; the short version:

- **PageSpeed Performance** is five metrics (TBT 30%, LCP 25%, CLS 25%, FCP 10%, SI 10%) on a log-normal curve, so "all green" can still read 94. The same deploy has scored 74 and 100 within minutes. Compare medians and local runs before calling anything a regression.
- **Agentic Browsing** is Lighthouse's new category: a well-formed accessibility tree, layout stability, a valid `llms.txt`, and three WebMCP audits. The WebMCP audits are "not applicable" on pagespeed.web.dev because Google's Chrome lacks the flag, so the skill scores them locally.
- **Is It Agent Ready** scores protocol presence, not content quality. Its percentage depends on the profile: a content site is judged on 7 checks, an app on 16. It does not look at llms.txt or JSON-LD at all, and its DNS-AID check needs DNSSEC at the registrar, which is a DNS change, not code.
- **Is Agentic** is 80 points of Essential checks, 20 of Recommended, up to 5 bonus. Publishing a discovery file for a capability you do not have activates a whole surface of Essential checks. Its reports are keyed by exact host, so `www` and apex are different reports.

## Requirements

- Node 22 or newer and Chrome or Chromium. `npx -y lighthouse` fetches the CLI on first use.
- A PageSpeed Insights API key for `psi.mjs`. It is free (Google Cloud Console → enable "PageSpeed Insights API" → create a key → `export PAGESPEED_API_KEY=...`). The keyless quota is exhausted at all hours. Without a key the skill measures with local Lighthouse and points you at the pagespeed.web.dev page for the official report.
- No keys for isitagentready.com or is-agentic.com.

## How it was tested

Built with Claude Code's skill-creator: three realistic tasks, each run with and without the skill in isolated worktrees, graded by independent agents against written assertions.

| Task | With skill | Without |
|---|---|---|
| Audit a live Next.js site and rank the fixes | 8/8 | 6/8 |
| Find and fix an Accessibility 97 regression | 6/6 in 12 min | 6/6 in 18 min |
| Take a deliberately broken static site to 100 everywhere | 8/8 | 8/8 |

The baseline audit missed the security headers and claimed Cloudflare gives no percentage. The eval fixture, prompts, and assertions ship in `evals/` so the next iteration can be measured the same way.

## Layout

```
site-score/                       the plugin
├── .claude-plugin/plugin.json
└── skills/site-score/
    ├── SKILL.md                  the workflow
    ├── scripts/                  the six scripts above
    ├── references/
    │   ├── lighthouse.md         audit weights per category and the fix for each common failure
    │   ├── agent-readiness.md    what both agent graders check, how they score, the fix per check
    │   └── nextjs-vercel-recipes.md
    └── evals/                    test prompts, assertions, and a broken demo site
.claude-plugin/marketplace.json   this repo is its own one-plugin marketplace
```

## Credits

Grader methodologies are published by Google (Lighthouse), Cloudflare (`isitagentready.com/llms-full.txt`), and Vercel with Ora (`is-agentic.com/methodology`). Markdown content negotiation follows [acceptmarkdown.com](https://acceptmarkdown.com); `llms.txt` follows [llmstxt.org](https://llmstxt.org). Built by Jay Ozer with Claude Code.
