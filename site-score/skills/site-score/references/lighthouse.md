# Lighthouse / PageSpeed Insights: how the five categories score, and how to reach 100

Verified against Lighthouse 13.4 (the version pagespeed.web.dev runs in 2026).
Category scores are a weighted average of the audits listed here; anything not
listed is informative and moves no points directly (but performance
diagnostics move the metrics that do).

## Contents
1. Performance (5 metrics)
2. Accessibility (58 weighted audits)
3. Best Practices (13 weighted audits)
4. SEO (10 weighted audits)
5. Agentic Browsing (6 audits, experimental)
6. Reading a report quickly

---

## 1. Performance

| Metric | Weight | Green (mobile) | Notes |
|---|---|---|---|
| Total Blocking Time | 30 | ≤ 200 ms | Main-thread long tasks between FCP and TTI. Biggest lever. |
| Largest Contentful Paint | 25 | ≤ 2.5 s | Usually the hero image/poster/heading. |
| Cumulative Layout Shift | 25 | ≤ 0.1 | Also counted in Agentic Browsing. |
| First Contentful Paint | 10 | ≤ 1.8 s | Driven by render-blocking CSS/fonts and server TTFB. |
| Speed Index | 10 | ≤ 3.4 s | Visual completeness over time. |

Scores are log-normal, so 100 needs every metric well inside green
(roughly FCP ≤ 1.0 s, LCP ≤ 1.2 s, TBT ≤ 50 ms, CLS ≤ 0.02, SI ≤ 1.3 s on the
throttled mobile profile). A site can be "all green" and still read 94.

**Variance is real.** The same deploy has scored 74 and 100 on PSI within
minutes. Before chasing a number: run 2-3 times, take the median, and confirm
with local Lighthouse against the production URL (the local profile is far
more stable). A run right after a deploy hits a cold CDN edge and reads
10-15 points low. Evenings on Google's runners are noisier.

### What usually costs points, in order of payoff

1. **Render-blocking CSS and fonts (FCP, LCP, SI).** Every stylesheet in
   `<head>` and every font chain (CSS → @font-face → woff2) delays first paint.
   Fixes: inline the critical/purged CSS for the landing template; bundle the
   rest into one purged file per route group; self-host fonts as woff2 with
   `font-display: swap` and put the @font-face rules in the inlined CSS so
   fonts are discovered at HTML parse time; `<link rel=preload as=font crossorigin>`
   only for the 1-2 faces above the fold. Insight audits: `render-blocking-insight`,
   `font-display-insight`, `network-dependency-tree-insight`.
2. **LCP resource discovery (LCP).** The LCP image must be in the initial
   HTML (not injected by JS, not a CSS background on a lazy element), with
   `fetchpriority="high"`, no `loading="lazy"`, a right-sized responsive
   source (`srcset`/`sizes`), modern format (WebP/AVIF), and a preload if it
   is a poster or background. A hero `<video>` should show a poster image as
   the LCP and load its source after `load`. Insights: `lcp-discovery-insight`,
   `lcp-breakdown-insight`, `image-delivery-insight`, `prioritize-lcp-image`.
3. **Third-party scripts (TBT, SI).** Tag managers, chat widgets, embeds,
   analytics. Load them after `load` (a timeout of 2-4 s after the load event
   moves them outside every scored window), use `@next/third-parties` or
   `strategy="lazyOnload"`, and facade heavy embeds (YouTube, maps) behind a
   click. Insights: `third-parties-insight`, `bootup-time`, `mainthread-work-breakdown`.
4. **Hydration and DOM size (TBT).** Big lists, carousels, and archives
   rendered up front. Server-render the first N items, mount the rest (and any
   carousel library) from an IntersectionObserver a few hundred px before
   visibility, or after `load`. Watch `dom-size-insight`, `forced-reflow-insight`,
   `long-tasks`, `duplicated-javascript-insight`, `legacy-javascript-insight`
   (set a modern `browserslist` to drop polyfills).
5. **Layout shift (CLS).** Every `<img>`/`<video>`/iframe needs width+height or
   `aspect-ratio`; fonts need `font-display: swap` with size-adjusted
   fallbacks or preload; late-injected banners (cookie consent, promo bars)
   must reserve space or overlay; carousels must not resize after mount.
   Insights: `cls-culprits-insight`, `unsized-images`, `layout-shifts`.
6. **Unused code and caching.** `unused-css-rules`, `unused-javascript`,
   `cache-insight`, `modern-http-insight` (HTTP/2+), `uses-text-compression`.
   Purge CSS at build time; split by route; let the CDN serve immutable assets
   with long max-age.
7. **Prerender/prefetch waste.** `<link rel=prerender>`/`prefetch` to third
   parties and eager `<video preload>` compete with the hero for bandwidth on
   the throttled mobile profile. Remove or defer.

Localhost is pessimistic (http/1.1 + gzip vs h2/h3 + brotli on a CDN): use it
to confirm a fix moved a metric, not to predict the production number.

## 2. Accessibility

All audits are pass/fail per page; weights 10 (critical), 7 (serious), 3
(moderate), 1 (minor). One failing weight-7 audit ≈ -3 to -4 points; a
weight-10 ≈ -5. Reaching 100 means zero failing axe rules on every page tested.

Most common failures and the fix that generalizes:

| Audit | Weight | Fix |
|---|---|---|
| `color-contrast` | 7 | Fix the **token**, not the selector: darken brand colors at their CSS variable to ≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI; document the ratio next to the value so the next component inherits it. Per-selector overrides rot as soon as a new component uses the raw brand color. |
| `target-size` | 7 | Every tappable element ≥ 24×24 CSS px (WCAG 2.2) with spacing; carousel dots and footer/legal links are the usual culprits. Enlarge padding or hit area, keep the visual dot small if design needs it. |
| `link-name`, `button-name`, `image-alt`, `input-image-alt`, `aria-command-name` | 7-10 | Text or `aria-label` on every control; alt on every image (empty `alt=""` for decorative); icon-only buttons get labels. |
| `aria-dialog-name` | 7 | Dialogs/modals (cookie consent!) need `aria-labelledby` pointing at real text, or `aria-label`. An image-only title needs alt text. |
| `aria-allowed-role`, `aria-required-children/parent`, `list`, `listitem` | 7-10 | Widgets that put `role="group"`/`role="presentation"` on `<li>` or `<ul>` break list semantics. Render carousel slides as `<div>` or fix the roles. |
| `heading-order` | 3 | Headings descend one level at a time. Use `sr-only` headings to fill gaps rather than restyling. |
| `label`, `select-name`, `form-field-multiple-labels` | 10 | One visible or `aria-label` label per field; no duplicate `for` targets. |
| `html-has-lang`, `document-title`, `meta-viewport` | 7-10 | `<html lang>`, unique titles, no `maximum-scale=1`/`user-scalable=no`. |
| `bypass`, `landmark-one-main`, `skip-link` | 3-7 | One `<main>`, a skip link as first focusable element, `<nav>`/`<header>`/`<footer>` landmarks. |
| `tabindex`, `aria-hidden-focus` | 7 | No `tabindex > 0`; nothing focusable inside `aria-hidden` (closed menus/carousel clones need `inert` or `tabindex=-1`). |
| `link-in-text-block` | 7 | Links inside paragraphs need underline or 3:1 contrast vs surrounding text. |
| `video-caption` | 10 | `<track kind="captions">` on any video with speech; decorative background video without audio should have `muted` and no controls. |

Test the templates, not just the homepage: contact, forms, blog post, listing,
404, and any page with a modal or carousel. Cookie banners and chat widgets
fail on every page at once, so they are the highest-value fix.

## 3. Best Practices

| Audit | Weight | Fix |
|---|---|---|
| `is-on-https`, `redirects-http` | 5, 1 | Everything over TLS; HTTP → HTTPS 301. Mixed content counts. |
| `deprecations` | 5 | Chrome deprecation warnings (often from third-party scripts or an old carousel/analytics library). Update or remove the library. |
| `third-party-cookies` | 5 | Any third-party setting cookies during load (ads, embeds, chat, some analytics). Defer after consent or after load, or replace with a first-party/cookieless integration. |
| `errors-in-console` | 1 | Zero console errors on load: 404s for favicon/manifest/fonts, CORS, CSP violations, JS exceptions. A missing favicon is a classic -8 (this audit + `inspector-issues`). |
| `inspector-issues` | 1 | DevTools Issues panel: mixed content, cookie SameSite, CORS, quirks mode, CSP reports. |
| `image-aspect-ratio`, `image-size-responsive` | 1, 1 | Rendered ratio must match natural ratio (`object-fit: contain/cover` on stretched icons/logos); serve images ≥ rendered size × DPR. |
| `paste-preventing-inputs` | 3 | Never block paste on inputs. |
| `geolocation-on-start`, `notification-on-start` | 1 | Only request permissions on user gesture. |
| `doctype`, `charset` | 1 | `<!doctype html>`, `<meta charset>` in the first 1024 bytes. |

Also shown (informative, not scored yet but flagged): `csp-xss`, `has-hsts`,
`origin-isolation`, `clickjacking-mitigation`, `trusted-types-xss`,
`valid-source-maps`. Send `Strict-Transport-Security`, a CSP (at least
frame-ancestors / a reporting policy), `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, and `Permissions-Policy` from the platform config; these
also help the agent-readiness graders that check security headers.

## 4. SEO

| Audit | Weight | Fix |
|---|---|---|
| `is-crawlable` | ~4 | No `noindex` meta/`X-Robots-Tag` on indexable pages; robots.txt must not block the page. (Deliberately-noindexed twins like markdown variants are fine as long as the canonical HTML is indexable.) |
| `document-title`, `meta-description` | 1 | Unique, non-empty, per page. |
| `http-status-code` | 1 | 200 on the audited URL (no soft-404 chains). |
| `link-text` | 1 | No "click here"/"read more"-only anchors; describe the destination. |
| `crawlable-anchors` | 1 | Links are real `<a href>`, not `onclick` divs or `href="#"`. |
| `robots-txt` | 1 | Valid syntax; nonstandard lines (e.g. `Content-Signal:`) are tolerated, but a stray `Disallow: /` under `*` fails crawlability. |
| `image-alt` | 1 | Same as accessibility. |
| `hreflang`, `canonical` | 1 | Valid absolute canonical on every page; hreflang only if multi-language and then complete + self-referencing. |

`structured-data` is manual (not scored) but the agent graders and rich
results depend on it: one JSON-LD `@graph` per page with Organization /
LocalBusiness (or the specific type), WebSite, WebPage, BreadcrumbList, and
page-specific nodes (Article, FAQPage, Product, Service, Person). Validate with
the Rich Results test or `npx schema-dts`-style linting.

## 5. Agentic Browsing (experimental, Lighthouse 13+)

Six equally weighted audits (a seventh, `ard-schema`, validating an optional
`/.well-known/ai-catalog.json` per agenticresourcediscovery.org, is landing in
newer builds; it is not applicable unless the catalog exists). The category is
displayed as a fraction (passed / applicable), not 0-100: a site with no
llms.txt and no WebMCP is scored out of 2, adding a valid llms.txt makes it
out of 3. On PSI only the first four below can score;
the three WebMCP audits are "Not applicable" on Google's runners because
their Chrome ships without the WebMCP flag, so the category reads N/N of the
applicable audits there (e.g. 3/3). Locally, `lighthouse.mjs` enables the flag
so all six score.

| Audit | What it checks | Fix |
|---|---|---|
| `llms-txt` | `GET /llms.txt`: a 404 makes the audit *not applicable* (category is then out of 2); a 5xx or fetch error fails it; a 200 must contain an H1 (`# Title`), at least one markdown link `[text](url)`, and be ≥ 50 characters. | Serve a build-generated `/llms.txt` per llmstxt.org: `# Site name`, a `>` summary, key facts, then `## Sections` of `- [Title](absolute URL): description` lines. Include every important page and post; add a "When to use this site" section that tells an agent what the site is for and how to act (book, call, read). Serve as `text/markdown; charset=utf-8`. |
| `agent-accessibility-tree` | Runs a subset of axe rules that break the accessibility tree agents navigate: `document-title`, `aria-allowed-role`, `aria-roles`, `aria-required-children/parent`, `presentation-role-conflict`, name rules for dialogs/commands. | Same fixes as Accessibility; carousel `role=group` on `<li>` and unnamed dialogs are the usual failures. |
| `cumulative-layout-shift` | Same CLS as Performance. | See CLS above. |
| `webmcp-registered-tools` | Informative list of imperative tools registered through `navigator.modelContext.registerTool`. | Register site-level tools (search, get-contact-info, get-faqs, get-hours) from a client component mounted in the root layout; load data lazily inside `execute()` so registration costs no page weight. Type the draft API in a `.d.ts`. |
| `webmcp-schema-validity` | Every registered tool's `inputSchema` is valid JSON Schema and the browser reported no warnings. | Use `type: "object"` with `properties` and `required`; no `$ref`s; keep descriptions non-empty. |
| `webmcp-form-coverage` | Forms on the page carry declarative WebMCP annotations (`toolname`, `tooldescription`, `toolparamdescription` on inputs); N/A when the page has no forms. | Annotate every form; describe every field; deliberately omit `toolautosubmit` on anything that sends email or money so a human clicks Submit. |

Verify locally with:

```
npx -y lighthouse <url> --only-categories=agentic-browsing \
  --chrome-flags="--headless=new --enable-features=WebMCP,DevToolsWebMCPSupport"
```

## 6. Reading a report quickly

`node scripts/lh-summary.mjs result.json` prints, per category, the weighted
audits that fail with their point cost and the first offending
selectors/URLs. Fix in point order, but batch by root cause: one token change
(contrast), one component change (carousel slides), one layout change (footer
links) usually clears several audits at once across every page.
