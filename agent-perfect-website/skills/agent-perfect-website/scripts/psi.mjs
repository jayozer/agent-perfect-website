#!/usr/bin/env node
// Run Google PageSpeed Insights (the same engine as pagespeed.web.dev) via
// its REST API and print a compact scorecard per strategy.
//
//   node psi.mjs <url> [--strategy mobile|desktop|both] [--runs N]
//                      [--key KEY] [--out DIR] [--no-agentic] [--top N]
//
// Why an API key matters: without one, every anonymous caller in the world
// shares one daily quota whose limit is now effectively zero (HTTP 429
// RESOURCE_EXHAUSTED on the first call), so treat the key as required. A free key from Google Cloud Console (enable "PageSpeed
// Insights API", create an API key) gives 25,000 queries/day. Pass it with
// --key or set PAGESPEED_API_KEY (also honors PSI_API_KEY / GOOGLE_API_KEY).
// When the API is unavailable, fall back to lighthouse.mjs (local Chrome)
// and, for the official numbers, drive https://pagespeed.web.dev in a
// browser.
//
// Each run's full JSON is saved under --out (default ./agent-perfect-website-out) so the
// summary can be regenerated with lh-summary.mjs and elements/urls looked up.
import fs from "node:fs";
import path from "node:path";
import { toMarkdown, normalize } from "./lh-summary.mjs";

// Pick up PAGESPEED_API_KEY from the project's .env.local or .env when it is
// not already in the environment (Node 21.7+ / 20.12+ has loadEnvFile; it
// never overrides variables that are already set).
if (!process.env.PAGESPEED_API_KEY && !process.env.PSI_API_KEY && !process.env.GOOGLE_API_KEY && typeof process.loadEnvFile === "function") {
  for (const f of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(f);
    } catch {
      /* file absent */
    }
  }
}

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo", "agentic-browsing"];

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
}
const url = process.argv.slice(2).find((a) => !a.startsWith("--") && /^https?:\/\//.test(a));
if (!url) {
  console.error("usage: node psi.mjs <url> [--strategy mobile|desktop|both] [--runs N] [--key KEY] [--out DIR] [--no-agentic] [--top N]");
  process.exit(1);
}
const strategyArg = arg("--strategy", "mobile");
const strategies = strategyArg === "both" ? ["mobile", "desktop"] : [strategyArg];
const runs = Number(arg("--runs", "1")) || 1;
const key = arg("--key", process.env.PAGESPEED_API_KEY || process.env.PSI_API_KEY || process.env.GOOGLE_API_KEY || "");
const outDir = arg("--out", "./agent-perfect-website-out");
const top = Number(arg("--top", "5")) || 5;
let categories = process.argv.includes("--no-agentic") ? CATEGORIES.slice(0, 4) : CATEGORIES;
fs.mkdirSync(outDir, { recursive: true });

function slug(u) {
  const p = new URL(u);
  return (p.host + p.pathname).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function query(strategy) {
  const params = new URLSearchParams({ url, strategy });
  for (const c of categories) params.append("category", c);
  if (key) params.set("key", key);
  const res = await fetch(`${ENDPOINT}?${params}`);
  const body = await res.json();
  if (body.error) {
    const msg = body.error.message || "";
    if (res.status === 400 && /category/i.test(msg) && categories.includes("agentic-browsing")) {
      // The API is sometimes behind the web UI on new categories; drop it and retry.
      console.error("note: API rejected category=agentic-browsing; retrying without it (use lighthouse.mjs for that category)");
      categories = categories.filter((c) => c !== "agentic-browsing");
      return query(strategy);
    }
    const err = new Error(`PSI API ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const scoreLine = (raw) =>
  normalize(raw).categories.map((c) => `${c.id}=${c.score === null ? "n/a" : Math.round(c.score * 100)}`).join("  ");

try {
  for (const strategy of strategies) {
    const results = [];
    for (let i = 1; i <= runs; i++) {
      process.stderr.write(`PSI ${strategy} run ${i}/${runs} for ${url} ...\n`);
      const raw = await query(strategy);
      const file = path.join(outDir, `psi-${slug(url)}-${strategy}-${i}.json`);
      fs.writeFileSync(file, JSON.stringify(raw));
      results.push({ raw, file });
      console.log(`run ${i}: ${scoreLine(raw)}  (${file})`);
    }
    // Performance swings run to run on Google's side; report the median run
    // so a single cold-edge reading does not drive decisions.
    results.sort((a, b) => (normalize(a.raw).categories[0]?.score ?? 0) - (normalize(b.raw).categories[0]?.score ?? 0));
    const median = results[Math.floor(results.length / 2)];
    console.log(`\n${runs > 1 ? `median run (${median.file}):\n` : ""}`);
    console.log(toMarkdown(median.raw, { top }));
    const ui = `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=${strategy}`;
    console.log(`Official UI for a shareable report: ${ui}\n`);
  }
} catch (e) {
  console.error(e.message);
  if (e.status === 429) {
    console.error(
      key
        ? "Your key's quota is exhausted; wait for the daily reset or use another project's key."
        : "The shared keyless quota is exhausted. Set PAGESPEED_API_KEY (free, Google Cloud Console → enable 'PageSpeed Insights API' → create key), or measure locally: node lighthouse.mjs <url> --runs 3"
    );
  }
  process.exit(2);
}
