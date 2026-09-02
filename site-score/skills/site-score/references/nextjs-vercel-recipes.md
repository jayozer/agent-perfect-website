# Next.js + Vercel recipes that reached 100 / 100 / 100 / 100 / 3-of-3

Field-tested on a Next 16 App Router site migrated from Webflow (mobile PSI
Performance 67 → 100, Accessibility 90 → 100, Best Practices 92 → 100,
Agentic Browsing 1/2 → 3/3, Is Agentic 79 → mid-90s). Each recipe names the
audit it moves so you can pick only what the scorecard needs. Adapt the
ideas to other frameworks; the mechanisms (what blocks paint, what the graders
fetch) are the same everywhere.

## Contents
1. Render path: CSS bundling, purging, inlining, fonts
2. LCP: hero poster/video pattern, image priority
3. Third-party scripts: defer GTM/analytics past the scored window
4. Below-the-fold work: IntersectionObserver mounts, lazy backgrounds
5. Layout shift and image hygiene
6. Accessibility tokens, dialogs, carousels, touch targets
7. Best Practices: favicon, console errors, security headers
8. SEO: metadata, canonical, sitemap, robots.txt, JSON-LD graph
9. Agent readiness: llms.txt, markdown content negotiation, 404s, WebMCP
10. Verification loop and tests

---

## 1. Render path (FCP, LCP, SI · `render-blocking-insight`, `font-display-insight`, `network-dependency-tree-insight`)

**Symptom:** several `<link rel=stylesheet>` in `<head>`, fonts imported via
`@fontsource/*` (or `next/font` emitting a blocking chunk), 500 ms+ discovery
chain HTML → CSS → woff2.

**Recipe:** a prebuild script (`scripts/build-css.mjs`) concatenates the
source CSS in cascade order, purges it against the route group's `.tsx`
sources (PurgeCSS with a safelist for runtime classes such as carousel
states), minifies with esbuild, and writes one bundle per route group:
`site.min.css` for the (site) group, `site-home.min.css` for the (home)
group. The homepage layout reads its bundle with `readFileSync` at module
scope and inlines it in a `<style>`; other pages link theirs. Fonts: a second
prebuild script copies only the latin/latin-ext woff2 faces you use into
`public/fonts/` and emits their `@font-face` rules (`font-display: swap`) into
the bundle, so the browser discovers fonts while parsing HTML instead of after
a CSS round trip. Gotchas: glob patterns silently miss `(group)` folders
(parentheses are glob syntax), so read those files yourself; in `next dev`
the inlined CSS is cached at module scope, restart after rebuilding; wire it
as `"prebuild": "node scripts/build-fonts-css.mjs && node scripts/build-css.mjs"`.

Add a `browserslist` (`chrome >= 100, edge >= 100, firefox >= 104, safari >= 15.6`)
to drop ~14 KB of polyfills (`legacy-javascript-insight`).

## 2. LCP (`lcp-discovery-insight`, `lcp-breakdown-insight`, `prioritize-lcp-image`)

Hero video pattern: SSR a `<video preload="none" poster="/hero-poster-sm.webp" muted playsInline loop autoPlay aria-hidden>`
with the *mobile-sized* poster (it is the LCP on phones), `<link rel=preload as=image fetchpriority=high>`
for that poster in the layout, then in a client effect: swap to the large
poster when `matchMedia('(min-width: 768px)')` matches, and attach `video.src`
only ~2.5 s after `window.load` so the mp4 never competes with the poster.
Remove `rel=prerender`/`prefetch` links to third parties (one such link was
pulling 1.15 MB during load).

Static hero images: `next/image` with `priority`, explicit `sizes`, and the
right intrinsic size; never `loading="lazy"` above the fold; WebP/AVIF sources;
`fetchpriority="high"` on the LCP `<img>` if not using `next/image`.

## 3. Third-party scripts (TBT, SI · `third-parties-insight`, `bootup-time`)

GTM/analytics: inject the tag from an inline script that waits for
`window.load` and then `setTimeout(..., 3500)`. Keep Consent Mode defaults in
a `beforeInteractive` inline script so consent state exists before the tag.
`@vercel/analytics` and `@vercel/speed-insights` are tiny but still mount them
after load. Cookie-consent UI mounts after load too, and must reserve no layout
(overlay), or CLS pays. Accept that analytics undercounts sub-4 s bounces; the
scored windows end before the tag loads.

## 4. Below-the-fold work (TBT, `dom-size-insight`, `forced-reflow-insight`, `long-tasks`)

Carousel/archive pattern: server-render the first ~12 items as plain markup;
mount the carousel library and append the remaining items from an
`IntersectionObserver` with `rootMargin: "600px 0px"` (idle DOM went 2,585 →
607 nodes; 3 s of long tasks disappeared). Use the same pattern for Instagram
feeds, maps, chat widgets, and review walls.

`LazyBg`: a client div that applies `background-image` (or removes a
`bg-defer` class) when within 400 px of the viewport, because the browser
eagerly fetches every inline background URL in the render tree. Combine with
`content-visibility: auto` on long sections.

## 5. Layout shift and image hygiene (CLS, `unsized-images`, `image-aspect-ratio`)

Width/height (or CSS `aspect-ratio`) on every `<img>`, including logos in
navbars and review avatars; `object-fit: contain` on square icons the template
stretches; `srcset` variants for small logos (a 100 px navbar logo does not
need the 400 px file). Fonts with `font-display: swap` plus `size-adjust`
fallbacks if the swap shifts text. Late elements (cookie bar, sticky CTA)
positioned fixed/overlaid.

## 6. Accessibility (`color-contrast`, `aria-dialog-name`, `aria-allowed-role`, `target-size`, `heading-order`)

- Contrast: darken brand tokens minimally to AA and write the ratio next to
  the value (`--poppy-orange: #c74a0a; /* 4.6:1 on white */`). Do it at the
  token; per-selector patches leave the next component failing again.
- Dialogs: cookie consent needs an accessible name; if its title is an image,
  give the image alt text or add `aria-label`.
- Carousels: Splide adds `role="group"` to slides; that role is not allowed on
  `<li>`, so render slides as `<div>`s (Splide is class-based). This clears both
  `aria-allowed-role` and the Agentic `agent-accessibility-tree` audit.
- Touch targets: 24 px minimum hit areas (dots: 24 px target, 7 px visual);
  footer link rows and inline city lists are the usual failures, add padding.
- Headings: make card titles/pillars real `<h3>`s and add `sr-only` `<h2>`s
  where a section has none; pin their styles so the page stays pixel-identical.
- Remove redundant `aria-label`s that mismatch visible link text.

## 7. Best Practices (`errors-in-console`, `inspector-issues`, `image-aspect-ratio`)

- Favicon: `app/favicon.ico` + `app/icon.png` (every page 404ing the icon
  costs ~8 points via console error + inspector issue).
- Zero console errors: check 404s for fonts/manifest, CORS on third-party
  fetches, hydration warnings (they count!), CSP reports.
- Security headers via `next.config.ts` `headers()` or `vercel.json`:
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (deny geolocation/camera/microphone unless used),
  `Content-Security-Policy` at minimum `frame-ancestors 'self'` (satisfies
  clickjacking checks without breaking inline scripts; a full CSP with nonces
  is a separate project).
- Third-party cookies: anything setting cookies during load (embeds, chat)
  moves to after consent/after load.

## 8. SEO (`is-crawlable`, `canonical`, `robots-txt`, `structured-data`)

- `metadataBase` + `alternates.canonical` on every static page; per-post
  metadata from frontmatter; unique titles and descriptions.
- `app/sitemap.ts` generated from the content collections so new posts appear
  on deploy; exclude `noindex` pages (search, twins).
- `app/robots.txt/route.ts` serving a literal so nonstandard lines survive:
  `User-agent: *` with only real disallows (`/api/`, `/search/`), explicit
  `Allow: /` blocks for named AI crawlers, a `Content-Signal: search=yes, ai-input=yes, ai-train=no`
  line if the owner wants that policy, and `Sitemap:`. If the DNS is on
  Cloudflare, keep the records grey-cloud or disable "block AI bots"/managed
  robots.txt, which silently prepends `Disallow: /` blocks for AI agents.
- JSON-LD: one `@graph` per page built by `lib/schema.ts` from a single facts
  module (`lib/practice.ts`: name, address, phone, hours, booking URL,
  founder). Nodes: Organization/LocalBusiness (+ `sameAs`, `openingHoursSpecification`,
  `aggregateRating` only on entity pages), WebSite (+ SearchAction), WebPage,
  BreadcrumbList, Person for the founder (with `description`, `url`, `image`,
  credentials), FAQPage / Article / Service / MedicalProcedure as the page
  warrants. Never hand-write review bodies; feed them verbatim from data.

## 9. Agent readiness (`llms-txt`, Is Agentic / Is It Agent Ready checks)

- `app/llms.txt/route.ts` (`export const dynamic = "force-static"`): H1 with
  the site name, a `>` one-line summary, key facts, a "When to use this site"
  section (one line per task an agent might be doing, with the URL and the
  action: book, call, read), then `## Pages`, `## Areas`, `## Blog` lists of
  `- [Title](absolute URL): description`. Serve `text/markdown; charset=utf-8`.
  Mention that every page negotiates markdown.
- Markdown content negotiation (acceptmarkdown.com): `proxy.ts` (Next 16
  middleware) parses `Accept` per RFC 9110 (q-values, `*/*`, `q=0` rejection,
  markdown wins ties), rewrites to `/md/<path>` when markdown is preferred,
  returns a spec-correct `406` listing both representations when nothing
  matches, and bypasses RSC (`rsc` header), static files, `/api`, `/_next`.
  `app/md/[[...path]]/route.ts` renders markdown for every canonical URL from
  the content sources (posts verbatim, pages from structured data), with
  `Vary: Accept`, `X-Robots-Tag: noindex` (the twin must not compete with the
  canonical HTML), and `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`.
  `outputFileTracingIncludes` must include `content/**` so the route can read
  it on Vercel. Unknown paths get a markdown 404 with recovery links.
- Platform limit: Next 16 replaces the `Vary` key set from middleware and
  config on page responses (both `next start` and Vercel), so the plain HTML
  variant cannot carry `Vary: Accept`. Cache correctness does not depend on
  it (markdown requests rewrite before any cache); leave the aspirational
  header in `next.config.ts` with a comment and do not retry.
- HTML 404 (`not-found.tsx`): real 404 status, links to key pages,
  `/sitemap.xml`, `/llms.txt`. Inject its stylesheet at runtime so Next does
  not preload the not-found CSS on every page.
- WebMCP: `components/WebMcpTools.tsx` (client, mounted in the root layout,
  no-op when `navigator.modelContext` is absent) registers `search-site`,
  `get-practice-info`, `get-faqs` with JSON-Schema `inputSchema`,
  `annotations: { readOnlyHint: true }`, and lazy data loading inside
  `execute()`. Forms get declarative attributes (`toolname`, `tooldescription`,
  `toolparamdescription` per field); omit `toolautosubmit` on anything that
  emails or pays. Types in `types/webmcp.d.ts`.
- WAF: Vercel's challenge mode can 403 sustained polling from one client
  (`x-vercel-mitigated: challenge`); if a grader reports intermittent 403s,
  check the firewall log before touching code.

## 10. Verification loop and tests

```
npm run build && npx next start -p 4123 &
node <skill>/scripts/lighthouse.mjs http://localhost:4123/ --runs 3 --out /tmp/site-score
node <skill>/scripts/agent-checks.mjs http://localhost:4123
```

Then deploy (preview URL first), run the same two commands against it, then
production, then the official graders in the browser. Keep a
`tests/agent-readiness.test.mjs` (`node --test`, boots `next start` on a
scratch port) asserting: markdown negotiation and q-values, 406, RSC bypass,
static assets untouched, noindex on markdown, llms.txt shape, 404 status and
links, JSON-LD parses, heading outline. `npm test` = build + tests, so a
regression fails CI before a grader sees it.
