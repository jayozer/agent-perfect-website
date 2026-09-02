# Agent-readiness graders: isitagentready.com (Cloudflare) and is-agentic.com (Vercel)

Both tools answer "can an AI agent discover, read, and act on this site?" but
they check different things and score them differently, so a site can read
100 on one and 60 on the other with identical code. Run both, fix by check,
report both.

## Contents
1. isitagentready.com — checks, scoring, API, fixes
2. is-agentic.com — checks, scoring, how to run, fixes
3. Shared fixes that move both (and Lighthouse SEO / Agentic Browsing)
4. What a small content site can realistically reach

---

## 1. isitagentready.com (Cloudflare, launched 2026-04)

`scripts/isitagentready.mjs <url> [--profile all|content|apiApp]` runs the
official scan through the site's public API and prints the same percentage
the UI shows. Methodology is published at
`https://isitagentready.com/llms-full.txt` and every check has a fix guide at
`https://isitagentready.com/.well-known/agent-skills/<check>/SKILL.md`.

**Two numbers.** A readiness *level* 0-5 (Not Ready → Basic Web Presence →
Bot-Aware → Agent-Readable → Agent-Integrated → Agent-Native) computed by the
API, and a *score* 0-100 computed client-side as
`round(passed / (total − neutral) × 100)` across four categories
(discoverability, contentAccessibility, botAccessControl, discovery).
Commerce checks never count. `unableToCheck` counts as a fail (the scanner's
headless browser was unavailable), so rerun before believing a low number.

**Profiles decide the denominator.** "All checks" scores ~15 checks (each
worth ~6.7 points); "Content site" scores 7 (each ~14.3 points). A content
or marketing site should be judged, and reported, on the Content profile,
but say which profile a number came from. The UI default is All checks with
`a2aAgentCard` unticked; the API's `profile: all` may include it, so pass
`--checks` with the UI's list when you need to match the screenshot exactly.

| Category | Check | Pass rule (verified) | Fix |
|---|---|---|---|
| discoverability | `robotsTxt` | `/robots.txt` 200, `text/plain`, ≥ 1 `User-agent` line | Serve it literally from a route handler. |
| | `sitemap` | `/sitemap.xml`, `/sitemap-index.xml`, `/sitemap_index.xml` or `/sitemap.xml.gz`, valid XML, or `Sitemap:` in robots.txt | Generate from content sources. |
| | `linkHeaders` | An HTTP `Link` **response header** on the scanned URL with rel ∈ {alternate, describedby, service-desc, service-doc, api-catalog, service-meta, status} | `Link: </llms.txt>; rel="describedby"; type="text/markdown"` is enough; add `</.well-known/api-catalog>; rel="api-catalog"` and `</.well-known/mcp/server-card.json>; rel="service-desc"` when those exist. Next.js: `headers()` in `next.config.ts` for `source: "/"` (custom header keys survive on Vercel). Cloudflare: Response Header Transform rule. |
| | `dnsAid` | DNSSEC-validated SVCB/HTTPS at `_index._agents.<apex>`, `_mcp._agents.<apex>`, `_a2a._agents.<apex>` (+ TXT) | Needs DNSSEC on the zone and DS at the registrar, then `_mcp._agents SVCB 1 example.com. alpn="h2" port=443`. Usually the last check standing; it is a DNS change, not code. |
| contentAccessibility | `markdownNegotiation` | `GET <url>` with exactly `Accept: text/markdown` → `Content-Type` starts with `text/markdown` (sent from HeadlessChrome with a cache-busting query string) | Negotiate on the Accept header only (never UA), tolerate query strings, send `Vary: Accept`. See `nextjs-vercel-recipes.md` §9 or Cloudflare's "Markdown for Agents" zone setting (Pro+). |
| botAccessControl | `robotsTxtAiRules` | A `User-agent` block for a known AI bot (gptbot, chatgpt-user, google-extended, ccbot, anthropic-ai, claude-web, bytespider, perplexitybot, cohere-ai, applebot-extended, amazonbot, meta-externalagent, facebookbot, omgilibot, diffbot) or a `User-agent: *` block | Explicit `Allow: /` blocks per bot read best to humans and other graders. |
| | `contentSignals` | ≥ 1 `Content-Signal:` line in robots.txt | `Content-Signal: search=yes, ai-input=yes, ai-train=no` (owner's policy; omitted = no preference). |
| | `webBotAuth` | `/.well-known/http-message-signatures-directory` JWKS | Informational: neutral when absent, a bonus when present. |
| discovery | `mcpServerCard` | `/.well-known/mcp/server-card.json` with `serverInfo.name` (or `name`) | Only honest if you run an MCP endpoint; a card pointing at nothing is noise. |
| | `agentSkills` | `/.well-known/agent-skills/index.json` with `$schema` `https://schemas.agentskills.io/discovery/0.2.0/schema.json` and `skills[]` (`name`, `type`, `description`, `url`, `digest`) plus the SKILL.md files | Cheap and useful for a content site: one SKILL.md that explains how to use the site (book, call, find hours) and its markdown/llms.txt endpoints. |
| | `webMcp` | Headless Chrome finds tools registered via `navigator.modelContext.registerTool()` / `provideContext()` | Same WebMCP component that scores Lighthouse Agentic Browsing. Firewall must not challenge HeadlessChrome. |
| | `apiCatalog` | `/.well-known/api-catalog` JSON with non-empty `linkset[]` (`anchor` + `service-desc`/`service-doc`/`status`) | Only for sites with a real API: on is-agentic this file activates the "api" surface and adds Essential checks (OpenAPI, JSON errors, auth) a content site cannot pass, so a Cloudflare point here can cost 10-20 points there. |
| | `oauthDiscovery` | `/.well-known/openid-configuration` or `oauth-authorization-server` with issuer/authorization/token endpoints | Only if the site really has an authorization server. Static stubs pass the check but mislead agents; report the ceiling instead. |
| | `oauthProtectedResource` | `/.well-known/oauth-protected-resource` with `resource`, `authorization_servers` | Same caveat. |
| | `authMd` | `/auth.md` with an H1 containing `auth.md` plus `agent_auth` metadata | Same caveat. |
| | `ard` | `/.well-known/ai-catalog.json` (or `Agentmap:` in robots.txt / `<link rel=ai-catalog>`) with `specVersion`, `host`, `entries[]` | Agentic Resource Discovery catalog listing the MCP card, skills index, llms.txt. Also feeds Lighthouse's upcoming `ard-schema` audit. |
| commerce | `x402`, `mpp`, `ucp`, `acp`, `ap2` | Only evaluated when the scanner thinks the site sells things | Never in the score; ignore unless it is a shop. |

Not checked here, despite what people assume: llms.txt itself, JSON-LD,
semantic HTML, page speed, meta tags, security.txt. (llms.txt still matters
for Lighthouse and is-agentic.)

**Level ladder.** L1 = 2 of {robotsTxt, sitemap, linkHeaders}; L2 = + AI
rules + Content-Signal; L3 = + markdown negotiation; L4 = + one of {MCP
card, A2A card, agent skills, api-catalog}; L5 = + two of {Web Bot Auth, all
four integration files, auth metadata}. Disabled checks count as satisfied,
so a Content-profile scan can show Level 5 with 5/7.

**Scanner identity.** HTTP checks come as `AgentReadinessScanner/1.0` from
Cloudflare IPs; browser checks come as HeadlessChrome via Cloudflare Browser
Rendering, signed with Web Bot Auth. A WAF that challenges them fails every
check. There is also an MCP endpoint at `https://isitagentready.com/mcp`
(`tools/list` gives the current check keys; do not hardcode them). The UI
posts the same `{url, enabledChecks}` to `/api/scan`; there is no
server-rendered results page, so drive the API, not the page.

**Typical path for a content site (Content profile):** robots.txt with AI
blocks + Content-Signal + Sitemap line (3 checks), sitemap.xml, markdown
negotiation, a `Link` header on `/` → 6/7 = 86; DNS-AID is the seventh and
needs DNSSEC. Under All checks the same site sits near 40 until the
`.well-known` discovery files exist. The honest ones for a business site are
the agent-skills index and the ai-catalog (neither activates a surface at
is-agentic); add api-catalog, the MCP card, or OAuth metadata only when the
site really runs an API, MCP server, or authorization server, because each
of those switches on a surface of Essential checks at is-agentic.

## 2. is-agentic.com (Vercel, scored by Ora; launched 2026-08)

`scripts/is-agentic.mjs <host> [--rescan] [--full]` reads the stored report
through the public API (`GET /api/v1/report?url=`), triggers a fresh scan
when asked (`/api/scan/stream?force=1`, ~20-60 s), and with `--full` pulls
Ora's per-check list so you can see passes, partial fractions, and bonus
signals, not just the issues. There is also `npx is-agentic <host> --json`,
an MCP endpoint at `https://is-agentic.com/mcp`, and the report page itself
serves markdown for `Accept: text/markdown`. Methodology:
`https://is-agentic.com/methodology`; check catalog (125 checks with
descriptions, recommendations, spec links): `https://ora.ai/api/checks`.

**Identity is exact.** `example.com` and `www.example.com` are different
reports; scan the host the site canonicalizes to. Stored reports refresh
only on a visit older than 6 h, so after a deploy compare `scanned_at` or
force a rescan (10 scans/min, 30/day, 6 forced/day per IP).

**Score (reproduced from the page's JavaScript).** Each Ora check yields a
fraction (score/maxScore, or pass = 1, warning = 0.5); not-applicable checks
are dropped. Then

```
Essential   = 80 × mean(fraction over Essential checks)
Recommended = 20 × mean(fraction over Recommended checks)
Bonus       = min(5, Σ 0.25 × fraction over bonus checks)
score       = round(min(100, Essential + Recommended + Bonus))
```

Labels: ≥ 85 "Strong technical baseline", ≥ 70 "Ready with a few material
gaps", ≥ 50 "Important blockers remain". robots.txt checks
(`robots-ai-policy-quality`, `robots-agent-user-policy`) never count here
(they do at Cloudflare). Checks belong to *surfaces* (web always; api, auth,
mcp, graphql, commerce activate when a trigger check passes), and checks of
inactive surfaces are excluded. That is the trap: publishing an OpenAPI
file, MCP card, or OAuth metadata on a content site activates that surface
and adds 5-10 new Essential checks that must all pass. Never add those for
points on a site without a real API.

For a content site (web surface only) that leaves **7 Essential checks at
~11.4 points each**, **9 Recommended at ~2.2 each**, and bonus files worth
+0.25 each up to +5. A partial Essential (e.g. "flat heading structure")
costs more than every bonus file combined.

| Check (tier) | Pass rule (verified) | Fix |
|---|---|---|
| `content-no-js` (E) | Raw HTML without JS: ≥ 500 chars of text, an H1 that comes first, sequential heading levels (evidence strings: "skips H1 to H3", "first content heading is H3", "flat heading structure"), content ratio ≥ ~5% after stripping script/style | Server-render; one H1 first; give sections H2s and cards H3s (sr-only if the design has no visible heading) |
| `bot-detection` (E) | Homepage 200 for GPTBot, ClaudeBot, ChatGPT-User, PerplexityBot, Google-Extended, Applebot-Extended (spoofed UAs from Ora's IPs, unsigned) | Bot protection off or a WAF bypass rule for those UAs; AI-bots ruleset on Allow |
| `agent-crawler-reachability` (E) | Same idea with ChatGPT-User, ClaudeBot, Google-Extended, `ora-agent`, DeepSeekBot; a challenge page = "undetermined" | Same |
| `redirect-hygiene` (E) | Sampled pages use real 301/302, no meta-refresh/JS redirects/cross-domain hops | |
| `docs-auth-gate` (E) | Sampled pages are publicly readable with substantive content | No login walls on content |
| `markdown-negotiation-vary` (E) | Canonical URL returns `text/markdown` for `Accept: text/markdown`, `text/html` for `Accept: text/html`, and the **markdown** response carries `Vary: Accept` (the HTML variant's Vary is not checked) | Middleware rewrite + markdown route (`nextjs-vercel-recipes.md` §9) or `@vercel/agent-readability` |
| `agent-friendly-404` (E) | Unknown path → real 404/410; full credit when the markdown 404 is short and links sitemap/llms.txt | `not-found.tsx` + markdown 404 |
| `ax-document-structure`, `ax-native-controls`, `ax-accessible-names`, `ax-form-labeling` (bonus, "controls" access signal) | `<main>` + landmarks, one H1, heading skips ≤ 1; ≥ 97% of controls native; every control has a name; every field has a `<label>` (placeholder does not count) | Semantic HTML |
| `sitemap` (R) / `sitemap-lastmod` (bonus) | Valid sitemap; ≥ 50% entries with `<lastmod>`, newest ≤ 1 year | Emit lastmod from content dates |
| `json-ld` (R) | Homepage identity node (Organization/LocalBusiness/Person) with name, description, url, sameAs/logo/address | |
| `org-schema-completeness` (R) | Organization/LocalBusiness has **both** `contactPoint` (telephone/email + contactType) and `address` (PostalAddress) | Add `contactPoint` |
| `metadata-completeness` (R) | canonical, `<html lang>`, `og:image`, `og:type` | |
| `trust-anchors` (R) | `/about`, `/contact`, `/privacy` exist with ≥ 500 chars each | |
| `agent-instruction` (R) | llms.txt (or agent file) has an explicit "when to use this" section | |
| `page-token-budget` (R) | Extracted text per page ≤ ~100K chars | Paginate archives |
| `code-fence-validity` (R) | Balanced ``` fences in served markdown | |
| `brand-search-accuracy` (R) | Web search for the brand returns the domain near the top | Not code; NAP consistency, citations |
| `llms-txt-exists/-formatting/-links-resolve` (bonus) | `/llms.txt` ≥ 100 chars, starts with a heading, markdown links, < 30K chars; sampled links resolve to real content | |
| `markdown-url-fallback` (bonus) | `/index.md` serves markdown; `.md` twins for content pages | Add `.md` twin routes |
| `markdown-link-alternate` (bonus) | `<link rel="alternate" type="text/markdown" href>` (or Link header) whose target serves markdown | |
| `markdown-frontmatter` (bonus) | Served markdown opens with `---` title/description/canonical/last-updated | Prepend front matter in the markdown route |
| `link-headers-discovery` (bonus) | Homepage `Link:` header such as `</sitemap.xml>; rel="sitemap", </index.md>; rel="alternate"; type="text/markdown"` | Same header satisfies Cloudflare's `linkHeaders` if it includes a `describedby`/`alternate` rel |
| `agent-ua-markdown` (bonus) | Bot UAs get markdown even with `Accept: text/html` | Optional; keep Accept as the primary key |
| `agent-discovery-file` / `agent-skills-index-v2` (bonus) | `/.well-known/agent-skills/index.json` with `$schema` …/discovery/0.2.0/schema.json, entries with type, url, `digest: sha256:<64 hex>` | Same file as Cloudflare's `agentSkills` |
| `ard-catalog` / `ai-catalog-published` (bonus) | `/.well-known/ard.json` and/or `/.well-known/ai-catalog.json` | Same as Cloudflare's `ard` |
| `json-ld-entity-linking`, `schema-type-breadth` (bonus) | `sameAs` to Wikipedia/Wikidata/LinkedIn/GitHub; extra types (FAQPage, Service, AggregateRating, BreadcrumbList) on the homepage | |
| `web-bot-auth-directory`, `a2a-agent-card`, `mcp-server-card`, `pricing-md`, `agent-mode-view`, `modular-llms-txt`, `nlweb-*` (bonus) | As named | +0.25 each; the MCP ones activate the mcp surface |

The page's "Prompt to improve" button copies a fix prompt (evidence +
recommendation per failing check). `is-agentic.mjs` prints the same evidence
and recommendation fields, so you rarely need the browser.

## 3. Shared fixes that move both graders (and Lighthouse SEO / Agentic Browsing)

1. **robots.txt**: `User-agent: *` with only real disallows; explicit
   `Allow: /` blocks for AI crawlers; `Content-Signal:`; `Sitemap:`. If DNS is
   on Cloudflare with the proxy on, disable managed robots.txt / "block AI
   bots" or it prepends `Disallow: /` blocks that contradict yours.
2. **llms.txt**: H1, `>` summary, facts, "When to use this site", link lists;
   `text/markdown`. Add `llms-full.txt` if the site is small enough to inline.
3. **Markdown content negotiation** on every canonical URL, keyed on
   `Accept`, with `Vary: Accept` and `X-Robots-Tag: noindex` on the twin.
4. **`Link` header** on the homepage (and ideally every page) pointing at
   llms.txt (`describedby`), the api-catalog and the MCP card if present.
5. **Structured data**: one JSON-LD `@graph` per page.
6. **Real 404s** with recovery links, in HTML and markdown.
7. **Server-rendered content** with landmarks, one H1, no heading skips,
   `<a href>`/`<button>` instead of click handlers on divs, labeled fields.
8. **Security headers** (HSTS, CSP `frame-ancestors`, nosniff,
   Referrer-Policy, Permissions-Policy).
9. **WebMCP tools + form annotations** for the browser-based checks.
10. **Firewall allowlist** for the graders' user agents and for verified AI
    crawlers; a challenge page scores as a failure everywhere.

## 4. What a small content site can realistically reach

| Grader | Realistic | What blocks the rest |
|---|---|---|
| isitagentready, Content profile | 86 (6/7), 100 with DNSSEC + DNS-AID | DNS-AID needs DNSSEC at the registrar |
| isitagentready, All checks | 60-75 | OAuth/auth.md checks presume an API with auth; stubbing them is dishonest |
| is-agentic | 95-100 (a real site reached 100 with the recipes here) | A partial Essential check (heading outline, bot challenge); bonus files stop at +5 |
| Lighthouse Agentic Browsing | 3/3 on PSI, 6/6 locally | WebMCP audits N/A on PSI |
