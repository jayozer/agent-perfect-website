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
//
// site-sweep.mjs imports runLighthouse() from here to score every page.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { toMarkdown, normalize } from "./lh-summary.mjs";

export const DEFAULT_CATEGORIES = "performance,accessibility,best-practices,seo,agentic-browsing";

export function chromeFlagsFor({ webmcp = true, extra = "" } = {}) {
  return ["--headless=new", webmcp ? "--enable-features=WebMCP,DevToolsWebMCPSupport" : "", extra].filter(Boolean).join(" ");
}

// Readable host+path plus a short hash of the exact URL, so paths that
// differ only in punctuation (/a-b vs /a/b) never share an output file.
export function slug(u) {
  const p = new URL(u);
  const readable = (p.host + p.pathname).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${readable}-${createHash("sha1").update(p.href).digest("hex").slice(0, 6)}`;
}

export const scoreLine = (raw) =>
  normalize(raw).categories.map((c) => `${c.id}=${c.score === null ? "n/a" : Math.round(c.score * 100)}`).join("  ");

// Run Lighthouse `runs` times for one url+form factor, save each LHR, return
// the median run by Performance score: { raw, file, runs }. Throws on failure.
export async function runLighthouse(url, formFactor, { outDir = "./agent-perfect-website-out", runs = 1, categories = DEFAULT_CATEGORIES, chromeFlags = chromeFlagsFor(), quiet = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (let i = 1; i <= runs; i++) {
    const file = path.join(outDir, `lh-${slug(url)}-${formFactor}-${i}.json`);
    const args = ["-y", "lighthouse", url, "--output=json", `--output-path=${file}`, "--quiet", `--chrome-flags=${chromeFlags}`, `--only-categories=${categories}`];
    if (formFactor === "desktop") args.push("--preset=desktop");
    else args.push("--form-factor=mobile");
    if (!quiet) process.stderr.write(`lighthouse ${formFactor} run ${i}/${runs} for ${url} ...\n`);
    const r = spawnSync("npx", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.status !== 0 || !fs.existsSync(file)) {
      throw new Error(`lighthouse failed (exit ${r.status}):\n${(r.stderr || r.stdout || "").slice(-2000)}`);
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw.runtimeError) console.error(`runtime error: ${raw.runtimeError.code} ${raw.runtimeError.message}`);
    results.push({ raw, file });
    if (!quiet) console.log(`run ${i}: ${scoreLine(raw)}  (${file})`);
  }
  results.sort((a, b) => (normalize(a.raw).categories[0]?.score ?? 0) - (normalize(b.raw).categories[0]?.score ?? 0));
  const median = results[Math.floor(results.length / 2)];
  return { ...median, runs: results };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
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
  const outDir = arg("--out", "./agent-perfect-website-out");
  const top = Number(arg("--top", "5")) || 5;
  const categories = arg("--categories", DEFAULT_CATEGORIES);
  const chromeFlags = chromeFlagsFor({ webmcp: !process.argv.includes("--no-webmcp"), extra: arg("--chrome-flags", "") });

  for (const ff of formFactors) {
    let median;
    try {
      median = await runLighthouse(url, ff, { outDir, runs, categories, chromeFlags });
    } catch (e) {
      console.error(e.message);
      process.exit(2);
    }
    console.log(`\n${runs > 1 ? `median run (${median.file}):\n` : ""}`);
    console.log(toMarkdown(median.raw, { top }));
  }
}
