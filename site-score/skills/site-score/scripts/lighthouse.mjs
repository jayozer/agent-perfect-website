#!/usr/bin/env node
// Run Lighthouse locally against any URL (production, a preview deploy, or
// `next start` on localhost) with all five categories, including the
// experimental Agentic Browsing category with WebMCP enabled in Chrome,
// and print the scorecard for the median run.
//
//   node lighthouse.mjs <url> [--runs N] [--form-factor mobile|desktop|both]
//                             [--out DIR] [--categories a,b,c] [--no-webmcp]
//                             [--top N] [--chrome-flags "..."]
//
// Why local runs matter even when PSI is available:
//  - PSI's Performance score for the same code swings 20+ points between
//    runs (datacenter load, cold CDN edge). Three local runs against the
//    production URL, median taken, is the stable "truth check".
//  - PSI runners ship an unflagged Chrome, so the three WebMCP audits show
//    "not applicable" there no matter what the site does. Only a local run
//    with --enable-features=WebMCP,DevToolsWebMCPSupport scores them.
//  - Localhost is pessimistic vs. a real CDN (http/1.1 + gzip vs h2 + brotli),
//    so treat localhost scores as a floor, not the number to report.
//
// Requires Chrome (or Chromium) on the machine; `npx -y lighthouse` fetches
// the CLI on first use. Full LHR JSONs are saved under --out.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { toMarkdown, normalize } from "./lh-summary.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
}
const url = process.argv.slice(2).find((a) => !a.startsWith("--") && /^https?:\/\//.test(a));
if (!url) {
  console.error("usage: node lighthouse.mjs <url> [--runs N] [--form-factor mobile|desktop|both] [--out DIR] [--categories a,b] [--no-webmcp] [--top N]");
  process.exit(1);
}
const runs = Number(arg("--runs", "1")) || 1;
const ffArg = arg("--form-factor", "mobile");
const formFactors = ffArg === "both" ? ["mobile", "desktop"] : [ffArg];
const outDir = arg("--out", "./site-score-out");
const top = Number(arg("--top", "5")) || 5;
const categories = arg("--categories", "performance,accessibility,best-practices,seo,agentic-browsing");
const webmcp = !process.argv.includes("--no-webmcp");
const extraFlags = arg("--chrome-flags", "");
const chromeFlags = ["--headless=new", webmcp ? "--enable-features=WebMCP,DevToolsWebMCPSupport" : "", extraFlags].filter(Boolean).join(" ");
fs.mkdirSync(outDir, { recursive: true });

function slug(u) {
  const p = new URL(u);
  return (p.host + p.pathname).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

const scoreLine = (raw) =>
  normalize(raw).categories.map((c) => `${c.id}=${c.score === null ? "n/a" : Math.round(c.score * 100)}`).join("  ");

for (const ff of formFactors) {
  const results = [];
  for (let i = 1; i <= runs; i++) {
    const file = path.join(outDir, `lh-${slug(url)}-${ff}-${i}.json`);
    const args = [
      "-y", "lighthouse", url,
      "--output=json", `--output-path=${file}`, "--quiet",
      `--chrome-flags=${chromeFlags}`,
      `--only-categories=${categories}`,
    ];
    if (ff === "desktop") args.push("--preset=desktop");
    else args.push("--form-factor=mobile");
    process.stderr.write(`lighthouse ${ff} run ${i}/${runs} for ${url} ...\n`);
    const r = spawnSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0 || !fs.existsSync(file)) {
      console.error(`lighthouse failed (exit ${r.status}):\n${(r.stderr || r.stdout || "").slice(-2000)}`);
      process.exit(2);
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw.runtimeError) console.error(`runtime error: ${raw.runtimeError.code} ${raw.runtimeError.message}`);
    results.push({ raw, file });
    console.log(`run ${i}: ${scoreLine(raw)}  (${file})`);
  }
  results.sort((a, b) => (normalize(a.raw).categories[0]?.score ?? 0) - (normalize(b.raw).categories[0]?.score ?? 0));
  const median = results[Math.floor(results.length / 2)];
  console.log(`\n${runs > 1 ? `median run (${median.file}):\n` : ""}`);
  console.log(toMarkdown(median.raw, { top }));
}
