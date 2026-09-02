#!/usr/bin/env node
// Local agent-readiness check: an offline approximation of what
// isitagentready.com (Cloudflare) and is-agentic.com (Vercel) look at, so
// you can iterate against localhost or a preview deploy before asking the
// official graders. It only uses plain HTTP (no browser), so anything that
// needs JavaScript to appear is reported as "not in initial HTML", which is
// exactly how most agents see it.
//
//   node agent-checks.mjs <origin-or-url> [--pages N] [--json] [--ua "..."]
//
//   --pages N   how many sitemap URLs to sample in addition to the start URL (default 4)
//   --json      machine-readable output
//
// Each check prints PASS / WARN / FAIL with the evidence and the fix. Treat
// WARN as "the official graders may or may not score this"; FAIL as "they do".
import { URL } from "node:url";

const AI_AGENTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot",
  "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Googlebot",
  "Applebot-Extended", "meta-externalagent", "Bytespider", "CCBot", "Amazonbot",
  "DuckAssistBot", "MistralAI-User", "cohere-ai", "YouBot", "Bingbot",
];
// Discovery files the official graders probe (isitagentready.com check keys
// in brackets). All are optional for a content site; report as info.
const WELL_KNOWN = [
  ["/llms-full.txt", "llms-full.txt (full-content companion to llms.txt)"],
  ["/.well-known/agent-skills/index.json", "Agent Skills index [agentSkills]"],
  ["/.well-known/api-catalog", "API catalog linkset [apiCatalog]"],
  ["/.well-known/mcp/server-card.json", "MCP server card [mcpServerCard]"],
  ["/.well-known/ai-catalog.json", "Agentic Resource Discovery catalog [ard]"],
  ["/.well-known/agent-card.json", "A2A agent card [a2aAgentCard]"],
  ["/.well-known/openid-configuration", "OAuth/OIDC discovery [oauthDiscovery]"],
  ["/.well-known/oauth-protected-resource", "OAuth protected resource [oauthProtectedResource]"],
  ["/auth.md", "auth.md [authMd]"],
  ["/.well-known/http-message-signatures-directory", "Web Bot Auth directory [webBotAuth]"],
  ["/.well-known/security.txt", "security.txt"],
];

const args = process.argv.slice(2);
const start = args.find((a) => /^https?:\/\//.test(a));
if (!start) {
  console.error("usage: node agent-checks.mjs <origin-or-url> [--pages N] [--json] [--ua UA]");
  process.exit(1);
}
const argv = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const PAGES = Number(argv("--pages", "4")) || 4;
const UA = argv("--ua", "Mozilla/5.0 (compatible; site-score-agent-checks/1.0; +https://github.com/)");
const origin = new URL(start).origin;
const results = [];
const add = (area, name, status, evidence, fix = "") => results.push({ area, name, status, evidence, fix });

async function get(path, headers = {}, opts = {}) {
  const url = path.startsWith("http") ? path : origin + path;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, redirect: opts.redirect ?? "follow", signal: AbortSignal.timeout(20000) });
    const body = opts.head ? "" : await res.text();
    return { ok: true, status: res.status, headers: res.headers, body, url: res.url, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, headers: new Headers(), body: "", url, ms: Date.now() - t0, error: e.message };
  }
}
const ct = (r) => (r.headers.get("content-type") || "").toLowerCase();
const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
const meta = (html, name) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "" : null;
};
const attr = (tag, name) => tag?.match(new RegExp(`${name}=["']([^"']*)["']`, "i"))?.[1] ?? null;

// ---------- 1. Discovery files ----------
async function checkRobots() {
  const r = await get("/robots.txt");
  if (r.status !== 200) return add("discovery", "robots.txt", "FAIL", `HTTP ${r.status}`, "Serve /robots.txt with a User-agent: * block and a Sitemap: line.");
  const text = r.body;
  const blocks = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    const key = k.trim().toLowerCase();
    if (key === "user-agent") {
      if (cur && cur.agents.length && (cur.allow.length || cur.disallow.length)) blocks.push(cur), (cur = null);
      cur ??= { agents: [], allow: [], disallow: [] };
      cur.agents.push(v);
    } else if (cur && key === "disallow") cur.disallow.push(v);
    else if (cur && key === "allow") cur.allow.push(v);
  }
  if (cur) blocks.push(cur);
  const star = blocks.find((b) => b.agents.some((a) => a === "*"));
  const blanket = blocks.filter((b) => b.disallow.some((d) => d === "/"));
  const sitemap = /^sitemap:\s*\S+/im.test(text);
  const signal = text.match(/^content-signal:.*$/im)?.[0];
  const blockedAI = AI_AGENTS.filter((ua) => blanket.some((b) => b.agents.some((a) => a.toLowerCase() === ua.toLowerCase())));
  if (star?.disallow.includes("/")) add("discovery", "robots.txt allows crawling", "FAIL", "User-agent: * has Disallow: /", "Remove the blanket disallow; list only private paths.");
  else add("discovery", "robots.txt allows crawling", "PASS", `${blocks.length} agent block(s); * disallows: ${star?.disallow.join(" ") || "none"}`);
  if (blockedAI.length) add("discovery", "AI agents not blocked in robots.txt", "FAIL", `Disallow: / for ${blockedAI.join(", ")}`, "If the owner wants AI answer engines to cite the site, replace those blocks with Allow: / (train-vs-input policy can go in a Content-Signal line).");
  else add("discovery", "AI agents not blocked in robots.txt", "PASS", `no blanket disallow for ${AI_AGENTS.length} known AI user agents`);
  const namedAI = blocks.filter((b) => b.agents.some((a) => AI_AGENTS.some((ua) => ua.toLowerCase() === a.toLowerCase()))).length;
  add("discovery", "robots.txt has AI-bot rules [robotsTxtAiRules]", namedAI || star ? "PASS" : "FAIL", namedAI ? `${namedAI} named AI-bot block(s)` : "wildcard block only (passes, but explicit blocks read better)", "Add User-agent blocks (Allow: /) for GPTBot, ChatGPT-User, ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, Applebot-Extended, meta-externalagent, CCBot.");
  add("discovery", "robots.txt Sitemap line", sitemap ? "PASS" : "WARN", sitemap ? "present" : "missing", "Add `Sitemap: <absolute sitemap URL>`.");
  add("discovery", "Content-Signal policy", signal ? "PASS" : "WARN", signal ?? "absent", "Optional Cloudflare Content Signals line, e.g. `Content-Signal: search=yes, ai-input=yes, ai-train=no`.");
  if (/cloudflare/i.test(text) && blanket.length) add("discovery", "Cloudflare managed robots block", "WARN", "managed AI-bot block text detected", "Disable Cloudflare → Security → Bots → block AI bots / managed robots.txt, or the file contradicts your own policy.");
}

async function checkLlmsTxt() {
  const r = await get("/llms.txt");
  if (r.status !== 200) return add("discovery", "llms.txt", "FAIL", `HTTP ${r.status}`, "Serve /llms.txt (llmstxt.org): `# Site`, `> summary`, key facts, then `## Section` lists of `- [Title](url): description`.");
  const body = r.body;
  const h1 = /^# .+/m.test(body);
  const links = (body.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  const summary = /^> .+/m.test(body);
  const whenToUse = /when to use|how to use|for agents|agent/i.test(body);
  const type = ct(r);
  const problems = [];
  if (!h1) problems.push("no H1");
  if (body.length < 300) problems.push(`only ${body.length} chars`);
  if (links < 5) problems.push(`only ${links} absolute links`);
  if (!/text\/(markdown|plain)/.test(type)) problems.push(`content-type ${type || "missing"}`);
  add("discovery", "llms.txt well-formed (Lighthouse llms-txt audit)", problems.length ? "FAIL" : "PASS", problems.length ? problems.join("; ") : `${body.length} chars, ${links} links, H1 present`, "Lighthouse requires an H1, non-trivial length, and links; serve text/markdown.");
  add("discovery", "llms.txt summary blockquote", summary ? "PASS" : "WARN", summary ? "present" : "missing `> summary` line", "Add a one-line `> ...` description under the H1 (llmstxt.org).");
  add("discovery", "llms.txt tells agents when/how to use the site", whenToUse ? "PASS" : "WARN", whenToUse ? "guidance section found" : "no task-oriented guidance", "Add a 'When to use this site' section: one line per task with the URL and the action (book, call, read).");
}

async function checkSitemap() {
  const r = await get("/sitemap.xml");
  if (r.status !== 200) {
    add("discovery", "sitemap.xml", "FAIL", `HTTP ${r.status}`, "Generate a sitemap from the content sources.");
    return [];
  }
  const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const isIndex = /<sitemapindex/i.test(r.body);
  add("discovery", "sitemap.xml", locs.length ? "PASS" : "FAIL", `${locs.length} <loc> entries${isIndex ? " (sitemap index)" : ""}`, "The sitemap must list the canonical URLs.");
  return isIndex ? [] : locs;
}

async function checkWellKnown() {
  for (const [path, label] of WELL_KNOWN) {
    const r = await get(path, {}, { redirect: "manual" });
    const looksReal = r.status === 200 && !/text\/html/.test(ct(r));
    add("discovery", label, looksReal ? "PASS" : "INFO", looksReal ? `${path} ${ct(r)}` : `${path} → ${r.status}${/text\/html/.test(ct(r)) && r.status === 200 ? " (HTML, probably a soft 404)" : ""}`, "");
  }
}

// ---------- 2. Content negotiation ----------
async function checkNegotiation() {
  const md = await get("/", { accept: "text/markdown" });
  const isMd = /text\/markdown/.test(ct(md));
  add("negotiation", "Accept: text/markdown returns markdown", isMd ? "PASS" : "FAIL", `HTTP ${md.status} ${ct(md) || "no content-type"}${isMd ? `, ${md.body.length} chars` : ""}`, "Serve a markdown representation of every page at its canonical URL when the Accept header prefers text/markdown (acceptmarkdown.com).");
  if (isMd) {
    const vary = (md.headers.get("vary") || "").toLowerCase();
    add("negotiation", "markdown response sends Vary: Accept", vary.includes("accept") ? "PASS" : "FAIL", `Vary: ${vary || "(none)"}`, "Add Vary: Accept so shared caches keep the variants apart.");
    add("negotiation", "markdown response is noindex", /noindex/i.test(md.headers.get("x-robots-tag") || "") ? "PASS" : "WARN", `X-Robots-Tag: ${md.headers.get("x-robots-tag") || "(none)"}`, "Mark the markdown twin noindex so it never competes with the canonical HTML.");
    add("negotiation", "markdown starts with an H1", /^# /.test(md.body.trimStart()) ? "PASS" : "WARN", md.body.slice(0, 60).replace(/\n/g, "\\n"), "Lead with `# Title`.");
    const q = await get("/", { accept: "text/markdown;q=0, text/html" });
    add("negotiation", "q=0 markdown falls back to HTML", /text\/html/.test(ct(q)) ? "PASS" : "FAIL", ct(q), "Honor RFC 9110 q-values.");
  }
  const html = await get("/", { accept: "text/html" });
  const htmlVary = (html.headers.get("vary") || "").toLowerCase();
  add("negotiation", "HTML variant sends Vary: Accept", htmlVary.includes("accept") ? "PASS" : "WARN", `Vary: ${htmlVary || "(none)"}`, "Best effort: some frameworks (Next 16 page responses) overwrite Vary; harmless if markdown requests rewrite before the cache.");
  const bad = await get("/", { accept: "application/x-unknown-type" });
  add("negotiation", "unsatisfiable Accept → 406 listing representations", bad.status === 406 ? "PASS" : "INFO", `HTTP ${bad.status}`, "Optional but spec-correct: return 406 with the list of representations.");
  const mdDot = await get("/index.md", {}, { redirect: "manual" });
  const mdDotOk = mdDot.status === 200 && /text\/(markdown|plain)/.test(ct(mdDot));
  add("negotiation", ".md URL twin (/index.md)", mdDotOk ? "PASS" : "INFO", `HTTP ${mdDot.status} ${ct(mdDot)}`, "Some graders also probe <path>.md; optional if Accept negotiation works.");
}

// ---------- 3. Page quality (no JS) ----------
async function checkPage(path, isStart) {
  const r = await get(path, { accept: "text/html,application/xhtml+xml,*/*;q=0.8" });
  const label = new URL(r.url).pathname || "/";
  if (r.status !== 200) return add("pages", `${label} loads`, "FAIL", `HTTP ${r.status}`, "");
  const html = r.body;
  const text = strip(html);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const desc = meta(html, "description");
  const canonical = attr(html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0], "href");
  const lang = attr(html.match(/<html[^>]*>/i)?.[0], "lang");
  const robots = meta(html, "robots") ?? "";
  const h1s = (html.match(/<h1[\s>]/gi) || []).length;
  const headings = [...html.matchAll(/<h([1-6])[\s>]/gi)].map((m) => Number(m[1]));
  let skips = 0;
  for (let i = 1; i < headings.length; i++) if (headings[i] > headings[i - 1] + 1) skips++;
  const jsonld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const types = [];
  let badJson = 0;
  for (const block of jsonld) {
    try {
      const j = JSON.parse(block);
      const nodes = Array.isArray(j) ? j : j["@graph"] ? j["@graph"] : [j];
      for (const n of nodes) types.push(...[].concat(n["@type"] || "?"));
    } catch {
      badJson++;
    }
  }
  const landmarks = ["main", "nav", "header", "footer"].filter((t) => new RegExp(`<${t}[\\s>]`, "i").test(html));
  const anchors = (html.match(/<a\s[^>]*href=["'][^"'#][^"']*["']/gi) || []).length;
  const buttons = (html.match(/<button[\s>]/gi) || []).length;
  const clickDivs = (html.match(/<(div|span)[^>]+onclick=/gi) || []).length;
  const imgs = html.match(/<img\s[^>]*>/gi) || [];
  const noAlt = imgs.filter((t) => !/\salt=/i.test(t)).length;
  const inputs = html.match(/<(input|select|textarea)\s[^>]*>/gi) || [];
  const og = meta(html, "og:title");
  const forms = (html.match(/<form[\s>]/gi) || []).length;
  const webmcpForms = (html.match(/<form[^>]+toolname=/gi) || []).length;

  const words = text.split(" ").filter(Boolean).length;
  add("pages", `${label}: readable content without JavaScript`, words > 150 ? "PASS" : words > 40 ? "WARN" : "FAIL", `${words} words in initial HTML`, "Server-render the content; agents and graders read the initial HTML.");
  add("pages", `${label}: title + meta description`, title && desc ? "PASS" : "FAIL", `title="${title.slice(0, 60)}" description=${desc === null ? "missing" : `${desc.length} chars`}`, "Unique title and description per page.");
  add("pages", `${label}: canonical`, canonical ? "PASS" : "WARN", canonical ?? "missing", "Absolute rel=canonical on every page.");
  add("pages", `${label}: html lang`, lang ? "PASS" : "FAIL", lang ?? "missing", "Set <html lang>.");
  add("pages", `${label}: indexable`, /noindex/i.test(robots) || /noindex/i.test(r.headers.get("x-robots-tag") || "") ? "FAIL" : "PASS", robots || r.headers.get("x-robots-tag") || "no robots directive", "Remove noindex from canonical pages.");
  add("pages", `${label}: exactly one H1`, h1s === 1 ? "PASS" : "WARN", `${h1s} h1`, "One H1 per page.");
  add("pages", `${label}: heading levels do not skip`, skips === 0 ? "PASS" : "WARN", `${headings.length} headings, ${skips} skip(s)`, "Descend one level at a time; use sr-only headings to fill gaps.");
  add("pages", `${label}: JSON-LD structured data`, jsonld.length && !badJson ? "PASS" : jsonld.length ? "FAIL" : "FAIL", jsonld.length ? `${jsonld.length} block(s): ${[...new Set(types)].join(", ")}${badJson ? `, ${badJson} unparsable` : ""}` : "none", "Add one JSON-LD @graph per page (Organization/LocalBusiness, WebSite, WebPage, BreadcrumbList, plus page-specific types).");
  add("pages", `${label}: landmarks`, landmarks.length >= 3 ? "PASS" : "WARN", landmarks.join(", ") || "none", "Use <header>, <nav>, <main>, <footer>.");
  add("pages", `${label}: real links and buttons`, clickDivs === 0 && anchors > 5 ? "PASS" : "WARN", `${anchors} href links, ${buttons} buttons, ${clickDivs} onclick div/span`, "Use <a href> for navigation and <button> for actions.");
  add("pages", `${label}: images have alt`, noAlt === 0 ? "PASS" : "FAIL", `${imgs.length} img, ${noAlt} without alt`, "alt on every image (alt=\"\" for decorative).");
  if (isStart) add("pages", `${label}: Open Graph`, og ? "PASS" : "WARN", og ? `og:title="${og.slice(0, 50)}"` : "missing", "og:title/description/image help agents summarize links.");
  if (forms) add("pages", `${label}: forms carry WebMCP annotations`, webmcpForms === forms ? "PASS" : "WARN", `${webmcpForms}/${forms} forms with toolname`, "Add toolname/tooldescription (and toolparamdescription per field) to forms; omit toolautosubmit on anything that sends email or money.");
  if (inputs.length) {
    const unlabeled = inputs.filter((t) => !/(aria-label|aria-labelledby|placeholder|title)=/i.test(t) && !/type=["'](hidden|submit|button)/i.test(t)).length;
    add("pages", `${label}: form fields described`, unlabeled === 0 ? "PASS" : "WARN", `${inputs.length} fields, ${unlabeled} without inline name/label attributes`, "Each field needs a <label for>, aria-label, or descriptive attributes so agents can fill it.");
  }
  return r;
}

// ---------- 4. 404 behavior ----------
async function check404() {
  const path = "/this-page-does-not-exist-" + Date.now().toString(36);
  const r = await get(path, { accept: "text/html" });
  add("errors", "unknown URL returns 404 (not soft 404)", r.status === 404 ? "PASS" : "FAIL", `HTTP ${r.status}`, "Return a real 404 status.");
  const links = (r.body.match(/<a\s[^>]*href=["']\/[^"']*["']/gi) || []).length;
  add("errors", "404 page offers recovery links", links >= 3 ? "PASS" : "WARN", `${links} internal links${/llms\.txt|sitemap/.test(r.body) ? " incl. sitemap/llms.txt" : ""}`, "Link key pages, /sitemap.xml and /llms.txt from the 404.");
  const md = await get(path, { accept: "text/markdown" });
  add("errors", "markdown 404 for agents", md.status === 404 && /text\/markdown/.test(ct(md)) ? "PASS" : "INFO", `HTTP ${md.status} ${ct(md)}`, "Serve the 404 as markdown too when the client prefers it.");
}

// ---------- 5. Headers, transport, bot access ----------
async function checkHeaders(home) {
  const h = home.headers;
  const want = [
    ["strict-transport-security", "HSTS", "WARN", "Strict-Transport-Security: max-age=63072000; includeSubDomains; preload"],
    ["content-security-policy", "Content-Security-Policy", "WARN", "at least `frame-ancestors 'self'`; a full policy is a separate project"],
    ["x-content-type-options", "X-Content-Type-Options", "WARN", "nosniff"],
    ["referrer-policy", "Referrer-Policy", "INFO", "strict-origin-when-cross-origin"],
    ["permissions-policy", "Permissions-Policy", "INFO", "deny geolocation/camera/microphone unless used"],
  ];
  for (const [key, label, sev, fix] of want) {
    const v = h.get(key);
    add("headers", label, v ? "PASS" : sev, v ? v.slice(0, 80) : "missing", fix);
  }
  const xfo = h.get("x-frame-options");
  const csp = h.get("content-security-policy") || "";
  add("headers", "clickjacking protection", xfo || /frame-ancestors/i.test(csp) ? "PASS" : "WARN", xfo ? `X-Frame-Options: ${xfo}` : /frame-ancestors/i.test(csp) ? "CSP frame-ancestors" : "none", "X-Frame-Options: SAMEORIGIN or CSP frame-ancestors.");
  add("headers", "compression", h.get("content-encoding") ? "PASS" : "WARN", h.get("content-encoding") ?? "none advertised", "Enable brotli/gzip.");
  const link = h.get("link") || "";
  const agentRels = ["alternate", "describedby", "service-desc", "service-doc", "api-catalog", "service-meta", "status"];
  const hasAgentRel = agentRels.some((rel) => new RegExp(`rel=["']?[^"';,]*\\b${rel}\\b`, "i").test(link));
  add("headers", "Link header advertises agent resources [linkHeaders]", hasAgentRel ? "PASS" : "FAIL", link ? link.slice(0, 120) : "no Link header", 'Send e.g. Link: </llms.txt>; rel="describedby"; type="text/markdown" on page responses (counted rels: alternate, describedby, service-desc, service-doc, api-catalog, service-meta, status).');
  add("headers", "TTFB (uncached, this client)", home.ms < 800 ? "PASS" : home.ms < 1800 ? "WARN" : "FAIL", `${home.ms} ms`, "Cache HTML at the edge; avoid per-request work on static pages.");
  if (origin.startsWith("https://")) {
    const httpOrigin = origin.replace("https://", "http://");
    const r = await get(httpOrigin + "/", {}, { redirect: "manual", head: true });
    add("headers", "HTTP redirects to HTTPS", r.status >= 300 && r.status < 400 && /^https:/.test(r.headers.get("location") || "") ? "PASS" : r.status === 0 ? "INFO" : "FAIL", `HTTP ${r.status} → ${r.headers.get("location") ?? ""}`, "301 http → https.");
  }
}

async function checkBotAccess() {
  const bots = ["GPTBot/1.2 (+https://openai.com/gptbot)", "ClaudeBot/1.0 (+claudebot@anthropic.com)", "PerplexityBot/1.0 (+https://perplexity.ai/perplexitybot)", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"];
  const blocked = [];
  for (const ua of bots) {
    const r = await get("/", { "user-agent": ua, accept: "text/html" });
    const challenged = r.status === 403 || r.status === 429 || r.status === 503 || /x-vercel-mitigated|cf-mitigated/i.test([...r.headers.keys()].join(" "));
    if (challenged) blocked.push(`${ua.split("/")[0]} → ${r.status}${r.headers.get("x-vercel-mitigated") ? " (" + r.headers.get("x-vercel-mitigated") + ")" : ""}`);
  }
  add("access", "AI crawlers get 200 at the edge (WAF / bot management)", blocked.length ? "FAIL" : "PASS", blocked.length ? blocked.join("; ") : "GPTBot, ClaudeBot, PerplexityBot, Googlebot all 200", "Allow verified AI crawlers in the firewall / bot management rules (or accept that graders and answer engines cannot read the site).");
}

// ---------- run ----------
const home = await get("/", { accept: "text/html,application/xhtml+xml,*/*;q=0.8" });
if (!home.ok) {
  console.error(`cannot fetch ${origin}: ${home.error}`);
  process.exit(2);
}
await checkRobots();
await checkLlmsTxt();
const locs = await checkSitemap();
await checkWellKnown();
await checkNegotiation();
await checkPage(new URL(start).pathname || "/", true);
const startPath = new URL(start).pathname || "/";
const sample = locs.filter((u) => u.startsWith(origin) && new URL(u).pathname !== startPath);
// spread the sample across the sitemap instead of taking the first N neighbours
const step = Math.max(1, Math.floor(sample.length / PAGES));
for (let i = 0, n = 0; i < sample.length && n < PAGES; i += step, n++) await checkPage(new URL(sample[i]).pathname, false);
await check404();
await checkHeaders(home);
await checkBotAccess();

const counts = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 };
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
const scored = counts.PASS + counts.WARN + counts.FAIL;
const score = scored ? Math.round(((counts.PASS + counts.WARN * 0.5) / scored) * 100) : 0;

if (args.includes("--json")) {
  console.log(JSON.stringify({ origin, score, counts, results }, null, 2));
} else {
  console.log(`# Agent-readiness checks · ${origin}\n`);
  console.log(`Local estimate: **${score}/100** (${counts.PASS} pass, ${counts.WARN} warn, ${counts.FAIL} fail, ${counts.INFO} info). The official graders weigh things differently; use this to find what to fix, then confirm on isitagentready.com and is-agentic.com.\n`);
  let area = "";
  for (const r of results) {
    if (r.area !== area) {
      area = r.area;
      console.log(`\n## ${area}`);
    }
    const mark = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL", INFO: "info" }[r.status];
    console.log(`- ${mark} · ${r.name} — ${r.evidence}${r.status !== "PASS" && r.status !== "INFO" && r.fix ? `\n    fix: ${r.fix}` : ""}`);
  }
}
