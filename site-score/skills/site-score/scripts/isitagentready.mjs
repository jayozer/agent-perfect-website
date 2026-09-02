#!/usr/bin/env node
// Official Cloudflare "Is It Agent Ready?" scan via the site's public API,
// with the 0-100 score computed exactly the way the web UI computes it.
//
//   node isitagentready.mjs <url> [--profile all|content|apiApp] [--checks a,b,c]
//                                 [--json] [--agent] [--out DIR] [--retries N]
//
//   --profile   which check set to score (default all; the UI default).
//               content = the 7 checks a content/marketing site is judged on.
//   --checks    explicit check keys (overrides profile). Get the current list
//               from `--list`.
//   --agent     print the site's own markdown "fix prompt" for failing checks
//   --json      raw API response plus the computed score
//   --list      print the check keys the API currently supports and exit
//
// Why this exists: isitagentready.com is a single-page app, but its worker
// exposes POST /api/scan (no auth, CORS *). The API returns the readiness
// level (0-5) and per-check pass/fail/neutral/unableToCheck; the percentage
// shown in the UI is computed client-side as
//   round(passed / (total - neutral) * 100)
// over the discoverability, contentAccessibility, botAccessControl and
// discovery categories (commerce never counts). `unableToCheck` counts as a
// fail, and it happens when the scanner's headless browser is unavailable,
// so retry a scan that reports it before believing the number.
import fs from "node:fs";
import path from "node:path";

const API = "https://isitagentready.com/api/scan";
const MCP = "https://isitagentready.com/mcp";
const SCORED_CATEGORIES = ["discoverability", "contentAccessibility", "botAccessControl", "discovery"];
const FIX = {
  robotsTxt: "Serve /robots.txt as text/plain with at least one User-agent line and a Sitemap: line.",
  sitemap: "Serve /sitemap.xml (or sitemap-index.xml) as valid XML and reference it from robots.txt.",
  linkHeaders: 'Send an HTTP Link header on the scanned URL, e.g. Link: </llms.txt>; rel="describedby"; type="text/markdown", </.well-known/api-catalog>; rel="api-catalog", </.well-known/mcp/server-card.json>; rel="service-desc" (counted rels: alternate, describedby, service-desc, service-doc, api-catalog, service-meta, status).',
  dnsAid: "Publish DNSSEC-signed SVCB/HTTPS records at _index._agents.<apex> / _mcp._agents.<apex> (DNS-AID draft); needs DNSSEC + DS at the registrar.",
  markdownNegotiation: "Return Content-Type: text/markdown for GET <url> with Accept: text/markdown (key off the Accept header, tolerate query strings, add Vary: Accept).",
  robotsTxtAiRules: "Add User-agent blocks for AI crawlers (GPTBot, ChatGPT-User, Google-Extended, CCBot, anthropic-ai, Claude-Web, PerplexityBot, Applebot-Extended, meta-externalagent, Amazonbot, Bytespider...) or at least a User-agent: * block.",
  contentSignals: "Add a Content-Signal: line to robots.txt, e.g. Content-Signal: search=yes, ai-input=yes, ai-train=no.",
  webBotAuth: "Optional: serve /.well-known/http-message-signatures-directory (JWKS, Ed25519) and sign responses (Web Bot Auth). Neutral when absent.",
  mcpServerCard: 'Serve /.well-known/mcp/server-card.json with serverInfo.name/version, description, url, transport {type: "streamable-http", endpoint}. Only if an MCP server really exists: at is-agentic.com it activates the "mcp" surface and its Essential checks.',
  a2aAgentCard: "Optional (off by default): /.well-known/agent-card.json with name, version, supportedInterfaces.",
  agentSkills: 'Serve /.well-known/agent-skills/index.json ($schema https://schemas.agentskills.io/discovery/0.2.0/schema.json, skills[] with name/type/description/url/digest) plus the SKILL.md files.',
  webMcp: "Register WebMCP tools on page load via navigator.modelContext.registerTool()/provideContext(); make sure headless Chrome is not challenged by the WAF.",
  apiCatalog: 'Serve /.well-known/api-catalog (application/linkset+json) with linkset[] entries carrying anchor + service-desc/service-doc/status. Only if the site has a real API: at is-agentic.com this file activates the "api" surface and its Essential checks.',
  oauthDiscovery: "Serve /.well-known/openid-configuration or /.well-known/oauth-authorization-server with issuer, authorization_endpoint, token_endpoint, jwks_uri, grant_types_supported, response_types_supported.",
  oauthProtectedResource: "Serve /.well-known/oauth-protected-resource with resource, authorization_servers, scopes_supported.",
  authMd: "Serve /auth.md (H1 containing 'auth.md') and an agent_auth block in the authorization-server metadata (workos.com/auth-md).",
  ard: "Serve /.well-known/ai-catalog.json (specVersion, host, entries[] with urn:air identifiers) or advertise it via Agentmap: in robots.txt / <link rel=ai-catalog>.",
};

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const argv = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const profile = argv("--profile", "all");
const checksArg = argv("--checks", "");
const retries = Number(argv("--retries", "2")) || 0;
const outDir = argv("--out", "");

async function listChecks() {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const text = await res.text();
  const json = JSON.parse(text.startsWith("event:") || text.startsWith("data:") ? text.split("\n").find((l) => l.startsWith("data:")).slice(5) : text);
  const tool = json.result?.tools?.find((t) => t.name === "scan_site");
  const enumList = tool?.inputSchema?.properties?.enabledChecks?.items?.enum;
  return enumList ?? Object.keys(FIX);
}

if (args.includes("--list")) {
  console.log((await listChecks()).join("\n"));
  process.exit(0);
}
if (!url) {
  console.error("usage: node isitagentready.mjs <url> [--profile all|content|apiApp] [--checks a,b] [--json] [--agent] [--out DIR] [--list]");
  process.exit(1);
}

async function scan(format) {
  const body = { url, format };
  if (checksArg) body.enabledChecks = checksArg.split(",").map((s) => s.trim()).filter(Boolean);
  else body.profile = profile;
  const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/markdown" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`isitagentready API ${res.status}: ${text.slice(0, 300)}`);
  return format === "agent" ? text : JSON.parse(text);
}

function score(result) {
  let pass = 0, total = 0, neutral = 0;
  const rows = [];
  for (const [cat, checks] of Object.entries(result.checks ?? {})) {
    let cp = 0, ct = 0, cn = 0;
    for (const [key, c] of Object.entries(checks)) {
      rows.push({ category: cat, key, status: c.status, message: c.message ?? "" });
      ct++;
      if (c.status === "pass") cp++;
      else if (c.status === "neutral") cn++;
    }
    if (SCORED_CATEGORIES.includes(cat)) { pass += cp; total += ct; neutral += cn; }
  }
  const denom = total - neutral;
  return { score: denom ? Math.round((pass / denom) * 100) : 0, pass, denom, rows };
}

let result;
let attempt = 0;
for (;;) {
  result = await scan("json");
  const unable = Object.values(result.checks ?? {}).flatMap((c) => Object.values(c)).filter((c) => c.status === "unableToCheck").length;
  if (!unable || attempt >= retries) break;
  attempt++;
  process.stderr.write(`${unable} check(s) unableToCheck (scanner browser busy); retry ${attempt}/${retries}...\n`);
}
const s = score(result);
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `isitagentready-${new URL(url).host.replace(/[^a-z0-9]+/gi, "-")}-${profile}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...result, computedScore: s.score }, null, 2));
  process.stderr.write(`saved ${file}\n`);
}

if (args.includes("--json")) {
  console.log(JSON.stringify({ ...result, computedScore: s.score, computedDenominator: s.denom }, null, 2));
} else {
  console.log(`# isitagentready.com · ${url} · profile ${checksArg ? "custom" : profile}\n`);
  console.log(`**Score ${s.score}/100** (${s.pass}/${s.denom} scored checks) · Level ${result.level} ${result.levelName}${result.isCommerce ? " · commerce site" : ""}\n`);
  let cat = "";
  for (const r of s.rows) {
    if (r.category !== cat) { cat = r.category; console.log(`\n## ${cat}${SCORED_CATEGORIES.includes(cat) ? "" : " (not in score)"}`); }
    const mark = r.status === "pass" ? "pass" : r.status === "neutral" ? "n/a " : r.status === "unableToCheck" ? "UNABLE (counts as fail)" : "FAIL";
    console.log(`- ${mark} · ${r.key} — ${r.message}${r.status !== "pass" && r.status !== "neutral" && FIX[r.key] ? `\n    fix: ${FIX[r.key]}` : ""}`);
  }
  if (result.nextLevel) {
    console.log(`\n## To reach Level ${result.nextLevel.target} (${result.nextLevel.name})`);
    for (const req of result.nextLevel.requirements ?? []) console.log(`- ${req.check}: ${req.description}${req.skillUrl ? ` (${req.skillUrl})` : ""}`);
  }
  console.log(`\nUI: https://isitagentready.com/ (paste the URL; "Customize scan" picks the profile). Scanner UA: AgentReadinessScanner/1.0 + HeadlessChrome via Cloudflare Browser Rendering, so do not challenge those at the firewall.`);
}
if (args.includes("--agent")) {
  console.log("\n---\n" + (await scan("agent")));
}
