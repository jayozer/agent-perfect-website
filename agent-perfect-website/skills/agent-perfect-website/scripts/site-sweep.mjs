#!/usr/bin/env node
// Score every page of a site, not just the homepage.
//
//   node site-sweep.mjs <host-or-url> [--engine psi|local] [--strategy mobile|desktop|both]
//        [--runs N] [--concurrency N] [--max N] [--depth N] [--urls FILE] [--exclude REGEX]
//        [--host HOST] [--out DIR] [--key KEY] [--dry-run] [--top N] [--json]
//
// Three stages:
//  1. Resolve the canonical host. `dataacrobat.com` and `www.dataacrobat.com`
//     are different hosts to every grader; follow the redirect from the apex
//     and cross-check the homepage's <link rel="canonical">. Disagreement is
//     itself an SEO finding and is reported, not silently resolved.
//  2. Discover pages: sitemap.xml (recursing one level into a sitemap index)
//     → Sitemap: lines in robots.txt → same-origin link crawl from the
//     homepage → --urls FILE. First source that yields a URL wins.
//  3. Score every page with the full five categories via psi.mjs (official
//     numbers, needs PAGESPEED_API_KEY) or lighthouse.mjs (local Chrome,
//     works on localhost/previews, scores the WebMCP audits).
//
// Output: one line per page as it finishes, then a page × category table,
// the worst page per category, and failing audits grouped across pages so a
// site-wide root cause shows once. Everything is saved under --out, plus
// sweep.json so the report can be rebuilt without re-scoring.
import fs from "node:fs";
import path from "node:path";
import { normalize } from "./lh-summary.mjs";
import { runPsi, envKey, CATEGORIES as PSI_CATEGORIES, explain429 } from "./psi.mjs";
import { runLighthouse } from "./lighthouse.mjs";

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const flag = (name) => args.includes(name);
const VALUE_FLAGS = new Set(["--engine", "--strategy", "--runs", "--concurrency", "--max", "--depth", "--urls", "--exclude", "--host", "--out", "--key", "--top"]);
const input = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));

if (!input || flag("--help")) {
  console.error("usage: node site-sweep.mjs <host-or-url> [--engine psi|local] [--strategy mobile|desktop|both] [--runs N] [--concurrency N] [--max N] [--depth N] [--urls FILE] [--exclude REGEX] [--host HOST] [--out DIR] [--key KEY] [--dry-run] [--top N] [--json]");
  process.exit(1);
}

const key = arg("--key", envKey());
const engine = arg("--engine", key ? "psi" : "local");
const strategyArg = arg("--strategy", "mobile");
const strategies = strategyArg === "both" ? ["mobile", "desktop"] : [strategyArg];
const runs = Number(arg("--runs", "1")) || 1;
const concurrency = Number(arg("--concurrency", engine === "psi" ? "3" : "1")) || 1;
const max = Number(arg("--max", "50")) || 50;
const depth = Number(arg("--depth", "3")) || 3;
const exclude = arg("--exclude", "") ? new RegExp(arg("--exclude", "")) : null;
const outDir = arg("--out", "./agent-perfect-website-out");
const top = Number(arg("--top", "3")) || 3;
const dryRun = flag("--dry-run");
const asJson = flag("--json");
const UA = "Mozilla/5.0 (compatible; agent-perfect-website-site-sweep/1.1; +https://github.com/jayozer/agent-perfect-website)";
const SKIP_EXT = /\.(pdf|xml|txt|json|css|js|mjs|map|jpe?g|png|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|zip|gz)$/i;

async function get(url, opts = {}) {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8" }, redirect: opts.redirect ?? "follow", signal: AbortSignal.timeout(20000) });
    return { status: res.status, url: res.url, body: await res.text(), type: (res.headers.get("content-type") || "").toLowerCase() };
  } catch (e) {
    return { status: 0, url, body: "", type: "", error: e.message };
  }
}

// ---------- 1. Canonical host ----------
export async function resolveHost(raw, override) {
  const start = /^https?:\/\//.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
  const home = await get(start.origin + "/");
  if (!home.status) throw new Error(`cannot reach ${start.origin}/: ${home.error}`);
  const redirectHost = new URL(home.url).host;
  const canonicalHref = home.body.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? home.body.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1];
  let canonicalHost = null;
  try {
    canonicalHost = canonicalHref ? new URL(canonicalHref, home.url).host : null;
  } catch {
    /* unparsable canonical */
  }
  const notes = [];
  let host = override || redirectHost;
  if (start.host !== redirectHost) notes.push(`${start.host} redirects to ${redirectHost}`);
  if (canonicalHost && canonicalHost !== redirectHost) {
    notes.push(`WARN: homepage canonical says ${canonicalHost} but the redirect lands on ${redirectHost}; graders will treat these as two sites. Fix the redirect or the canonical.`);
    if (!override) host = redirectHost;
  } else if (canonicalHost) notes.push(`canonical agrees: ${canonicalHost}`);
  else notes.push("no <link rel=canonical> on the homepage");
  if (override) notes.push(`--host override: scoring ${override}`);
  const origin = `${new URL(home.url).protocol}//${host}`;
  return { origin, host, redirectHost, canonicalHost, notes, homepageHtml: home.body };
}

// ---------- 2. Discovery ----------
const normalizeUrl = (u, origin) => {
  try {
    const p = new URL(u, origin);
    if (p.origin !== origin) return null;
    if (SKIP_EXT.test(p.pathname)) return null;
    p.hash = "";
    p.search = "";
    return p.origin + p.pathname;
  } catch {
    return null;
  }
};

async function fromSitemap(url, origin, seenIndexes = new Set()) {
  const r = await get(url, { accept: "application/xml,text/xml,*/*" });
  if (r.status !== 200 || /text\/html/.test(r.type)) return [];
  const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (!/<sitemapindex/i.test(r.body)) return locs;
  const out = [];
  for (const child of locs.slice(0, 20)) {
    if (seenIndexes.has(child)) continue;
    seenIndexes.add(child);
    out.push(...(await fromSitemap(child, origin, seenIndexes)));
  }
  return out;
}

async function fromRobots(origin) {
  const r = await get(origin + "/robots.txt", { accept: "text/plain,*/*" });
  if (r.status !== 200 || /text\/html/.test(r.type)) return [];
  const maps = [...r.body.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const out = [];
  for (const m of maps) out.push(...(await fromSitemap(m, origin)));
  return out;
}

let fragmentLinks = 0;
async function crawl(origin, homepageHtml) {
  fragmentLinks = [...homepageHtml.matchAll(/<a\b[^>]*href=["']#[^"']*["']/gi)].length;
  const seen = new Set([origin + "/"]);
  let frontier = [{ url: origin + "/", html: homepageHtml, d: 0 }];
  while (frontier.length && seen.size < max) {
    const next = [];
    for (const { url, html, d } of frontier) {
      const body = html ?? (await get(url)).body;
      for (const m of body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
        const n = normalizeUrl(m[1], origin);
        if (!n || seen.has(n) || seen.size >= max) continue;
        seen.add(n);
        if (d + 1 < depth) next.push({ url: n, d: d + 1 });
      }
    }
    frontier = next;
  }
  return [...seen];
}

export async function discover(site) {
  const urlsFile = arg("--urls", "");
  if (urlsFile) {
    const list = fs.readFileSync(urlsFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    return { source: `--urls ${urlsFile}`, urls: list.map((u) => normalizeUrl(u, site.origin)).filter(Boolean) };
  }
  let urls = await fromSitemap(site.origin + "/sitemap.xml", site.origin);
  if (urls.length) return { source: "sitemap.xml", urls };
  urls = await fromRobots(site.origin);
  if (urls.length) return { source: "robots.txt Sitemap:", urls };
  urls = await crawl(site.origin, site.homepageHtml);
  const note = urls.length === 1 && fragmentLinks ? `; homepage has ${fragmentLinks} #fragment links and no other internal pages: single-page site` : "";
  return { source: `link crawl (depth ${depth})${note}`, urls };
}

// ---------- 3. Scoring ----------
async function scoreOne(url, strategy) {
  if (engine === "psi") return runPsi(url, strategy, { key, categories: PSI_CATEGORIES, outDir, runs, quiet: true });
  return runLighthouse(url, strategy, { outDir, runs, quiet: true });
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

const pct = (s) => (s === null || s === undefined ? "n/a" : String(Math.round(s * 100)));
const pathOf = (u) => new URL(u).pathname || "/";

// ---------- main ----------
const site = await resolveHost(input, arg("--host", ""));
const disc = await discover(site);
let urls = [...new Set(disc.urls.map((u) => normalizeUrl(u, site.origin)).filter(Boolean))].sort();
if (exclude) urls = urls.filter((u) => !exclude.test(u));
const capped = urls.length > max;
if (capped) urls = urls.slice(0, max);

const secsPer = engine === "psi" ? 25 : 40;
const jobs = urls.length * strategies.length * runs;
const est = Math.ceil((jobs * secsPer) / concurrency / 60);

if (!asJson) {
  console.log(`host: ${site.host}  (${site.notes.join("; ")})`);
  console.log(`discovered ${urls.length} page(s) via ${disc.source}${capped ? ` — capped at --max ${max}` : ""}`);
  console.log(`engine: ${engine}  strategy: ${strategies.join(",")}  runs: ${runs}  concurrency: ${concurrency}  ≈ ${est} min\n`);
}
if (dryRun) {
  if (asJson) console.log(JSON.stringify({ site: { host: site.host, origin: site.origin, notes: site.notes }, source: disc.source, urls }, null, 2));
  else for (const u of urls) console.log("  " + pathOf(u));
  process.exit(0);
}
if (engine === "psi" && !key) {
  console.error("no PAGESPEED_API_KEY; use --engine local or set the key (see psi.mjs header)");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const pages = [];
const failures = [];
for (const strategy of strategies) {
  await pool(urls, concurrency, async (url) => {
    try {
      const probe = await get(url);
      if (probe.status !== 200) {
        const err = new Error(`HTTP ${probe.status || "unreachable"} — not scored (graders need a 200; agent-checks.mjs covers the 404 page)`);
        err.status = probe.status;
        throw err;
      }
      const { raw, file } = await scoreOne(url, strategy);
      const n = normalize(raw);
      const rec = { url, path: pathOf(url), strategy, file, categories: Object.fromEntries(n.categories.map((c) => [c.id, c.score])), failing: n.categories.flatMap((c) => c.failing.filter((a) => a.weight > 0).map((a) => ({ cat: c.id, id: a.id, title: a.title, pointsLost: a.pointsLost }))) };
      pages.push(rec);
      if (!asJson) console.log(`${strategy.padEnd(7)} ${rec.path.padEnd(40)} ${n.categories.map((c) => `${c.id.replace("best-practices", "bp").replace("accessibility", "a11y").replace("performance", "perf").replace("agentic-browsing", "agentic")}=${pct(c.score)}`).join("  ")}`);
    } catch (e) {
      failures.push({ url, strategy, error: e.message });
      if (!asJson) console.log(`${strategy.padEnd(7)} ${pathOf(url).padEnd(40)} ERROR ${e.message.split("\n")[0]}`);
      if (e.status === 429) {
        console.error(explain429(key));
        throw e;
      }
    }
  }).catch(() => {});
}

// ---------- report ----------
const catIds = [...new Set(pages.flatMap((p) => Object.keys(p.categories)))];
const short = (id) => ({ performance: "Perf", accessibility: "A11y", "best-practices": "BP", seo: "SEO", "agentic-browsing": "Agentic" })[id] ?? id;
const lines = [];
for (const strategy of strategies) {
  const rows = pages.filter((p) => p.strategy === strategy).sort((a, b) => a.path.localeCompare(b.path));
  if (!rows.length) continue;
  lines.push(`\n## ${site.host} — ${strategy} (${engine}, ${runs} run${runs > 1 ? "s, median" : ""})\n`);
  lines.push(`| Page | ${catIds.map(short).join(" | ")} |`);
  lines.push(`|---|${catIds.map(() => "---:").join("|")}|`);
  for (const r of rows) lines.push(`| ${r.path} | ${catIds.map((c) => pct(r.categories[c])).join(" | ")} |`);
  lines.push("\n**Worst page per category**\n");
  for (const c of catIds) {
    const scored = rows.filter((r) => r.categories[c] !== null && r.categories[c] !== undefined);
    if (!scored.length) continue;
    const worst = scored.reduce((a, b) => (b.categories[c] < a.categories[c] ? b : a));
    const median = scored.map((r) => r.categories[c]).sort((a, b) => a - b)[Math.floor(scored.length / 2)];
    lines.push(`- ${short(c)}: ${worst.path} at ${pct(worst.categories[c])} (site median ${pct(median)})`);
  }
  const byAudit = new Map();
  for (const r of rows) for (const f of r.failing) {
    const e = byAudit.get(f.id) ?? { ...f, pages: new Set(), points: 0 };
    e.pages.add(r.path);
    e.points += f.pointsLost;
    byAudit.set(f.id, e);
  }
  const audits = [...byAudit.values()].map((a) => ({ ...a, pages: [...a.pages] })).sort((a, b) => b.pages.length - a.pages.length || b.points - a.points);
  if (audits.length) {
    lines.push("\n**Failing audits across pages** (fix once, clears everywhere)\n");
    for (const a of audits.slice(0, 25)) lines.push(`- \`${a.id}\` (${short(a.cat)}) — ${a.pages.length}/${rows.length} pages, ~${a.points.toFixed(1)} pts total — ${a.title}${a.pages.length <= top ? ` [${a.pages.join(", ")}]` : ` [${a.pages.slice(0, top).join(", ")}, …]`}`);
  }
}
if (failures.length) {
  lines.push(`\n**Not scored** (${failures.length})\n`);
  for (const f of failures) lines.push(`- ${f.strategy} ${pathOf(f.url)}: ${f.error.split("\n")[0]}`);
}

const sweep = { generatedAt: new Date().toISOString(), input, site: { host: site.host, origin: site.origin, redirectHost: site.redirectHost, canonicalHost: site.canonicalHost, notes: site.notes }, discovery: { source: disc.source, count: urls.length, capped }, engine, strategies, runs, pages, failures };
const sweepFile = path.join(outDir, `sweep-${site.host.replace(/[^a-z0-9]+/gi, "-")}.json`);
fs.writeFileSync(sweepFile, JSON.stringify(sweep, null, 2));
if (asJson) console.log(JSON.stringify(sweep, null, 2));
else {
  console.log(lines.join("\n"));
  console.log(`\nsaved: ${sweepFile}`);
}
process.exit(failures.length && !pages.length ? 2 : 0);
