#!/usr/bin/env node
// Summarize a Lighthouse result as a compact markdown scorecard.
//
// Accepts either a local Lighthouse LHR JSON (from `lighthouse --output=json`)
// or a PageSpeed Insights API response (which wraps the LHR under
// `lighthouseResult` and adds CrUX field data under `loadingExperience`).
//
//   node lh-summary.mjs <result.json> [--top N] [--all] [--json]
//
//   --top N   items to print per failing audit (default 5)
//   --all     also list passing diagnostics/insights that carry savings
//   --json    emit the normalized structure instead of markdown
//
// The point of this file is to turn a 1-4 MB JSON blob into the ~60 lines a
// human or agent needs to decide what to fix next: category scores, the
// metrics that drive Performance, and every weighted audit that is losing
// points, sorted by how many points it costs, with the offending
// elements/URLs so the fix can start immediately.
import fs from "node:fs";

const CATEGORY_ORDER = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
  "agentic-browsing",
];
const METRICS = [
  ["first-contentful-paint", "FCP"],
  ["largest-contentful-paint", "LCP"],
  ["total-blocking-time", "TBT"],
  ["cumulative-layout-shift", "CLS"],
  ["speed-index", "SI"],
  ["interactive", "TTI"],
];
const SKIP_MODES = new Set(["informative", "manual", "notApplicable"]);

function pct(score) {
  return score === null || score === undefined ? "n/a" : Math.round(score * 100);
}

function itemLabel(item) {
  // Lighthouse detail items vary by audit; pull whatever identifies the culprit.
  const node = item.node ?? item.source?.node ?? null;
  const parts = [];
  if (item.type === "checklist" && item.items) {
    const failing = Object.values(item.items).filter((c) => c && c.value === false).map((c) => c.label);
    return failing.length ? `checklist not met: ${failing.join("; ")}` : "checklist met";
  }
  if (node?.selector) parts.push(node.selector);
  else if (node?.snippet) parts.push(node.snippet);
  if (item.url) parts.push(item.url);
  else if (item.source?.url) parts.push(item.source.url);
  if (item.nodeLabel && !parts.length) parts.push(item.nodeLabel);
  if (item.description && !parts.length) parts.push(item.description);
  if (item.statistic) parts.push(item.statistic);
  if (item.subItems?.items?.length) {
    const sub = item.subItems.items[0];
    const subLabel = sub.url ?? sub.selector ?? sub.reason ?? sub.node?.selector;
    if (subLabel) parts.push(`e.g. ${subLabel}`);
  }
  const savings = [];
  if (typeof item.wastedMs === "number" && item.wastedMs > 0) savings.push(`${Math.round(item.wastedMs)} ms`);
  if (typeof item.wastedBytes === "number" && item.wastedBytes > 0) savings.push(`${Math.round(item.wastedBytes / 1024)} KiB`);
  if (typeof item.totalBytes === "number" && !savings.length && item.totalBytes > 0) savings.push(`${Math.round(item.totalBytes / 1024)} KiB total`);
  if (item.value !== undefined && typeof item.value !== "object") parts.push(String(item.value));
  const label = parts.filter(Boolean).join(" · ") || JSON.stringify(item).slice(0, 120);
  return savings.length ? `${label} (${savings.join(", ")})` : label;
}

function flattenItems(details, limit) {
  if (!details) return [];
  if (details.type === "criticalrequestchain" || details.type === "debugdata" || details.type === "screenshot" || details.type === "treemap-data") return [];
  const items = Array.isArray(details.items) ? details.items : [];
  // Some audits (network trees, list-sections) nest tables inside items.
  const out = [];
  for (const item of items) {
    if (item.type === "list-section" && item.value?.items) {
      for (const inner of item.value.items) out.push(inner);
    } else if (item.type === "network-tree" && item.chains) {
      out.push({ description: "critical request chain (see report)" });
    } else if (item.value?.type === "network-tree") {
      out.push({ description: `network dependency chain, longest ${item.value.longestChain?.duration ? Math.round(item.value.longestChain.duration) + " ms" : "(see report)"}` });
    } else {
      out.push(item);
    }
  }
  return out.slice(0, limit).map(itemLabel);
}

export function normalize(raw) {
  const lhr = raw.lighthouseResult ?? raw;
  const crux = raw.loadingExperience ?? null;
  const originCrux = raw.originLoadingExperience ?? null;
  const audits = lhr.audits ?? {};
  const categories = [];
  for (const id of CATEGORY_ORDER) {
    const cat = lhr.categories?.[id];
    if (!cat) continue;
    const totalWeight = cat.auditRefs.reduce((s, r) => s + (r.weight || 0), 0) || 1;
    const failing = [];
    const all = [];
    for (const ref of cat.auditRefs) {
      const a = audits[ref.id];
      if (!a) continue;
      const entry = {
        id: ref.id,
        title: a.title,
        score: a.score,
        mode: a.scoreDisplayMode,
        weight: ref.weight || 0,
        displayValue: a.displayValue ?? "",
        explanation: a.explanation ?? "",
        pointsLost: ref.weight && a.score !== null ? +(((1 - a.score) * ref.weight * 100) / totalWeight).toFixed(1) : 0,
        savingsMs: a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? a.metricSavings?.FCP ?? 0,
        items: [],
      };
      all.push(entry);
      const isFail = a.score !== null && a.score < 1 && !SKIP_MODES.has(a.scoreDisplayMode);
      const isSavings = SKIP_MODES.has(a.scoreDisplayMode) === false && ref.weight === 0 && a.score !== null && a.score < 1;
      if (isFail || isSavings) failing.push(entry);
    }
    failing.sort((x, y) => y.pointsLost - x.pointsLost || (y.savingsMs || 0) - (x.savingsMs || 0));
    categories.push({ id, title: cat.title, score: cat.score, failing, all });
  }
  const metrics = METRICS.filter(([id]) => audits[id]).map(([id, label]) => ({
    id,
    label,
    value: audits[id].displayValue ?? "",
    score: audits[id].score,
  }));
  const lcpEl = audits["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node;
  return {
    url: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl,
    fetchTime: lhr.fetchTime,
    lighthouseVersion: lhr.lighthouseVersion,
    formFactor: lhr.configSettings?.formFactor ?? lhr.configSettings?.emulatedFormFactor ?? "",
    categories,
    metrics,
    lcpElement: lcpEl ? lcpEl.selector ?? lcpEl.snippet : null,
    crux: crux?.metrics ? { overall: crux.overall_category, metrics: crux.metrics } : null,
    originCrux: originCrux?.metrics ? { overall: originCrux.overall_category, metrics: originCrux.metrics } : null,
    audits,
  };
}

export function toMarkdown(raw, { top = 5, all = false } = {}) {
  const n = normalize(raw);
  const lines = [];
  lines.push(`# Lighthouse ${n.lighthouseVersion} · ${n.formFactor || "?"} · ${n.url}`);
  lines.push(`fetched ${n.fetchTime}`);
  lines.push("");
  lines.push("| Category | Score |");
  lines.push("|---|---|");
  for (const c of n.categories) lines.push(`| ${c.title} | **${pct(c.score)}** |`);
  lines.push("");
  if (n.metrics.length) {
    lines.push("| Metric | Value | Score |");
    lines.push("|---|---|---|");
    for (const m of n.metrics) lines.push(`| ${m.label} | ${m.value} | ${pct(m.score)} |`);
    if (n.lcpElement) lines.push(`\nLCP element: \`${n.lcpElement}\``);
    lines.push("");
  }
  if (n.crux) {
    lines.push(`Field data (CrUX, this URL): ${n.crux.overall}`);
    for (const [k, v] of Object.entries(n.crux.metrics)) lines.push(`- ${k}: p75 ${v.percentile} (${v.category})`);
    lines.push("");
  } else if (n.originCrux) {
    lines.push(`Field data (CrUX, origin): ${n.originCrux.overall}`);
    for (const [k, v] of Object.entries(n.originCrux.metrics)) lines.push(`- ${k}: p75 ${v.percentile} (${v.category})`);
    lines.push("");
  }
  for (const c of n.categories) {
    const weighted = c.failing.filter((f) => f.weight > 0);
    const unweighted = c.failing.filter((f) => f.weight === 0);
    if (c.id === "agentic-browsing") {
      lines.push(`## ${c.title}: ${pct(c.score)}`);
      for (const a of c.all) {
        const mark = a.mode === "notApplicable" ? "n/a" : a.mode === "informative" ? "info" : a.score === null ? "?" : a.score >= 1 ? "pass" : "FAIL";
        lines.push(`- ${mark} · ${a.id}${a.explanation ? ` — ${a.explanation}` : ""}${a.displayValue ? ` — ${a.displayValue}` : ""}`);
        if (mark === "FAIL") for (const it of flattenItems(n.audits[a.id]?.details, top)) lines.push(`    - ${it}`);
      }
      lines.push("");
      continue;
    }
    if (!weighted.length && !(unweighted.length && (all || c.id === "performance"))) continue;
    lines.push(`## ${c.title}: ${pct(c.score)}`);
    for (const f of weighted) {
      lines.push(`- **${f.id}** (weight ${f.weight}, ~${f.pointsLost} pts) · ${f.title}${f.displayValue ? ` · ${f.displayValue}` : ""}${f.explanation ? ` · ${f.explanation}` : ""}`);
      for (const it of flattenItems(n.audits[f.id]?.details, top)) lines.push(`    - ${it}`);
    }
    if (unweighted.length && (all || c.id === "performance")) {
      lines.push(`- Diagnostics / insights not passing (unweighted, but they move the metrics above):`);
      for (const f of unweighted.slice(0, all ? unweighted.length : 12)) {
        lines.push(`    - ${f.id}${f.displayValue ? ` · ${f.displayValue}` : ""}${f.savingsMs ? ` · est. ${Math.round(f.savingsMs)} ms` : ""}`);
        for (const it of flattenItems(n.audits[f.id]?.details, Math.min(top, 3))) lines.push(`        - ${it}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node lh-summary.mjs <lighthouse-or-psi.json> [--top N] [--all] [--json]");
    process.exit(1);
  }
  const top = Number(args[args.indexOf("--top") + 1]) || 5;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (raw.error) {
    console.error(`API error ${raw.error.code}: ${raw.error.message}`);
    process.exit(2);
  }
  if (args.includes("--json")) {
    const n = normalize(raw);
    delete n.audits;
    console.log(JSON.stringify(n, null, 2));
  } else {
    console.log(toMarkdown(raw, { top, all: args.includes("--all") }));
  }
}
