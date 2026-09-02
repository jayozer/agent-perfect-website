#!/usr/bin/env node
// Official Vercel "Is Agentic" (is-agentic.com, scored by Ora) report via the
// site's public API, with an optional forced rescan and the full per-check
// picture from Ora.
//
//   node is-agentic.mjs <url-or-host> [--rescan] [--full] [--json] [--out DIR]
//
//   --rescan   start a fresh scan (GET /api/scan/stream?force=1, ~20-60 s)
//              before reading; otherwise the stored report is used (stale if
//              older than your last deploy: compare scanned_at). A missing
//              report triggers a scan automatically.
//   --full     also pull Ora's per-check list (passes, fractions, tiers,
//              bonus signals) from https://ora.ai/api/score/<host>
//   --json     raw JSON (report + ora essentials when --full)
//
// Scoring (from the page's own JS, reproduced on 20 sites):
//   Essential  = 80 × mean(fraction of each Essential check)
//   Recommended = 20 × mean(fraction of each Recommended check)
//   Bonus       = min(5, Σ 0.25 × fraction of each bonus check)
//   score = round(min(100, E + R + B)); robots.txt checks never count.
// Checks belonging to surfaces the site does not have (api, auth, mcp,
// commerce) are excluded, so a content site is judged on ~7 Essential checks
// (~11 pts each) and ~9 Recommended (~2 pts each). Adding an OpenAPI/MCP/
// OAuth file "for points" activates that surface's Essential checks, which
// then all have to pass: do not do it on a site that has no API.
//
// Identity is exact: "example.com" and "www.example.com" are separate
// reports. Scan the canonical host the site redirects to.
import fs from "node:fs";
import path from "node:path";

const ORIGIN = process.env.IS_AGENTIC_API_ORIGIN || "https://is-agentic.com";
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
const argv = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
if (!target) {
  console.error("usage: node is-agentic.mjs <url-or-host> [--rescan] [--full] [--json] [--out DIR]");
  process.exit(1);
}
const url = /^https?:\/\//.test(target) ? target : `https://${target}`;
const host = new URL(url).host;
const outDir = argv("--out", "");

async function readReport() {
  const res = await fetch(`${ORIGIN}/api/v1/report?url=${encodeURIComponent(url)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 404 && body.code === "report_not_found") return null;
  if (!res.ok) throw new Error(`is-agentic API ${res.status}: ${body.detail || body.title || body.code || ""}`);
  return body;
}

async function scan() {
  process.stderr.write(`scanning ${host} via ${ORIGIN}/api/scan/stream (force) ...\n`);
  const res = await fetch(`${ORIGIN}/api/scan/stream?target=${encodeURIComponent(host)}&force=1`, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`scan stream ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let done = false;
  let checks = 0;
  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      let ev;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === "check_complete") checks++;
      if (ev.type === "error") throw new Error(`scan error: ${ev.message || JSON.stringify(ev).slice(0, 200)}`);
      if (ev.type === "scan_archived" || ev.type === "summary_ready") { done = true; break; }
    }
  }
  process.stderr.write(`scan finished (${checks} checks reported); reading stored report ...\n`);
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    const rep = await readReport();
    if (rep) return rep;
  }
  throw new Error("report not available after scan; try again in a minute");
}

async function ora() {
  try {
    const res = await fetch(`https://ora.ai/api/score/${host}?include=essentials`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

let report = args.includes("--rescan") ? null : await readReport();
if (!report) report = await scan();
const essentials = args.includes("--full") ? await ora() : null;

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `is-agentic-${host.replace(/[^a-z0-9]+/gi, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ report, ora: essentials }, null, 2));
  process.stderr.write(`saved ${file}\n`);
}

if (args.includes("--json")) {
  console.log(JSON.stringify({ report, ora: essentials }, null, 2));
  process.exit(0);
}

const b = report.score_breakdown || {};
console.log(`# is-agentic.com · ${report.display_target || host}\n`);
console.log(`**Score ${report.score}/100** · ${report.score_label || ""} · scanned ${report.scanned_at} · ${report.eligible_checks ?? "?"} eligible checks`);
console.log(`Report: ${report.report_url || `${ORIGIN}/scan/${host}`}\n`);
if (b.essential) console.log(`- Essential: ${b.essential.earned}/${b.essential.available} pts (${b.essential.passing}/${b.essential.total} passing)`);
if (b.recommended) console.log(`- Recommended: ${b.recommended.earned}/${b.recommended.available} pts (${b.recommended.passing}/${b.recommended.total} passing)`);
if (b.bonus) console.log(`- Bonus: ${b.bonus.points}/5 pts (${b.bonus.positive_signals} positive signals)`);
const issues = report.issues || [];
console.log(`\n## Issues (${issues.length})`);
if (!issues.length) console.log("- none: every eligible Essential and Recommended check passes");
for (const i of issues) {
  console.log(`- ${i.result === "failed" ? "FAIL" : "PARTIAL"} · ${i.id} (${i.tier}) · ${i.name}`);
  if (i.details) console.log(`    evidence: ${String(i.details).replace(/\s+/g, " ").slice(0, 300)}`);
  if (i.recommendation) console.log(`    fix: ${String(i.recommendation).replace(/\s+/g, " ").slice(0, 300)}`);
}
if (essentials) {
  const e = essentials.essentials || essentials;
  const checks = e.checks || {};
  const rows = Object.entries(checks).map(([id, c]) => ({ id, tier: c.tier, bonus: c.bonus, fraction: c.fraction }));
  const byTier = (t) => rows.filter((r) => (t === "bonus" ? r.bonus : r.tier === t && !r.bonus)).sort((x, y) => (x.fraction ?? 1) - (y.fraction ?? 1));
  for (const tier of ["essential", "recommended", "bonus"]) {
    const list = byTier(tier);
    if (!list.length) continue;
    console.log(`\n## Ora ${tier} checks (${list.length})`);
    console.log(list.map((r) => `${r.fraction === 1 ? "pass" : r.fraction === 0 ? "FAIL" : `${Math.round((r.fraction ?? 0) * 100)}%`} ${r.id}`).join("  ·  "));
  }
  const name = (x) => (typeof x === "string" ? x : x?.id || x?.label || JSON.stringify(x));
  if (e.activeSurfaces) console.log(`\nActive surfaces: ${e.activeSurfaces.map(name).join(", ")}`);
  if (e.accessSignals) console.log(`Access signals: ${e.accessSignals.map((a) => `${a.label || a.id}: ${a.state}${a.total ? ` (${a.passing}/${a.total})` : ""}`).join("; ")}`);
}
console.log(`\nUI: ${ORIGIN}/scan/${host} (Rescan button = force scan). Ora probes with spoofed AI user agents (GPTBot, ClaudeBot, ChatGPT-User, PerplexityBot, Google-Extended, Applebot-Extended, OraBot); a WAF challenge on them fails the Essential reachability checks.`);
