// Self-test: run the entry end-to-end twice against the kit snapshot and
// assert every pinned value — run counts, the top of the board, the edge
// rows that catch convention errors, the globals, the first row's plan,
// plan/step consistency, peer sanity, and dossier determinism.
// Usage: node tools/selftest.mjs [input-dir]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { categoryKey, parseSnapshot, round4 } from "../lib/model.ts";
import { boardIssue, buildRadar } from "../lib/board.ts";
import { buildPlan, gasFor, renderStep } from "../lib/farm.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const input =
  process.argv[2] ??
  join(ROOT, "..", "token-radar-01-kit", "token-radar-01-kit", "input");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`ok ${passed + failed} - ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${passed + failed} - ${name}${detail ? ` (${detail})` : ""}`);
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `got ${actual}, want ${expected}`);
}

function runFull() {
  const out = mkdtempSync(join(tmpdir(), "launch-radar-test-"));
  const env = { ...process.env };
  delete env.MAKEFUN_DATA_ONLY;
  const run = spawnSync(
    process.execPath,
    [join(ROOT, "main.ts"), "--input", input, "--output", out],
    { env, encoding: "utf8" },
  );
  if (run.status !== 0) {
    console.error(run.stdout);
    console.error(run.stderr);
    throw new Error(`full run failed with status ${run.status}`);
  }
  return { out, stdout: run.stdout };
}

const run1 = runFull();
const run2 = runFull();

const line = run1.stdout.split("\n")[0];
const m = line.match(
  /(\d+) protocols scanned, (\d+) on the watchlist, (\d+) launch candidates ranked, (\d+) products set aside, (\d+) live tokens shown apart/,
);
check("run line has the expected shape", m !== null, line);
if (m) {
  eq("protocols scanned", Number(m[1]), 758);
  eq("watchlist size", Number(m[2]), 40);
  eq("board size", Number(m[3]), 198);
  eq("products set aside", Number(m[4]), 144);
  eq("live rows", Number(m[5]), 30);
}

const dossier1 = readFileSync(join(run1.out, "dossier.json"));
const dossier2 = readFileSync(join(run2.out, "dossier.json"));
check("dossier is byte-identical across two full runs", dossier1.equals(dossier2));
const stated = run1.stdout.match(/dossier\.json \((\d+) bytes\)/);
check("run output states the dossier byte count", stated !== null);
if (stated) {
  eq("stated dossier bytes match the file", Number(stated[1]), dossier1.length);
  eq("dossier file size matches", statSync(join(run1.out, "dossier.json")).size, dossier1.length);
}
check(
  "data.js is byte-identical across two full runs",
  readFileSync(join(run1.out, "data.js")).equals(readFileSync(join(run2.out, "data.js"))),
);

const radar = JSON.parse(
  readFileSync(join(run1.out, "data.js"), "utf8").slice("window.RADAR=".length, -2),
);
const byRank = new Map(radar.rows.map((r) => [r.rank, r]));

const top3 = [
  [1, "steakhouse-financial", 1318555497, 942321512, 3594726302],
  [2, "sentora-curator", 1161167392, 829842213, 3165645264],
  [3, "gauntlet", 785299671, 561223835, 2140931792],
];
for (const [rank, slug, implied, lo, hi] of top3) {
  const r = byRank.get(rank);
  eq(`rank ${rank} slug`, r.slug, slug);
  eq(`rank ${rank} implied`, r.implied_value_usd, implied);
  eq(`rank ${rank} range lo`, r.model.value_lo_usd, lo);
  eq(`rank ${rank} range hi`, r.model.value_hi_usd, hi);
}

const edgePins = [
  [4, "polymarket-international", 531052934],
  [18, "extended-perps", 54683994],
  [19, "plume-vaults", 53180433],
  [20, "galaxy-curation", 51064438],
  [21, "defi-saver-asset-management", 41679040],
];
for (const [rank, slug, implied] of edgePins) {
  const r = byRank.get(rank);
  eq(`edge rank ${rank} slug`, r.slug, slug);
  eq(`edge rank ${rank} implied`, r.implied_value_usd, implied);
}

eq("global median rounds to 0.1689", radar.global_multiple, 0.1689);
eq("global Q1 rounds to 0.0314", radar.global_q1, 0.0314);
eq("global Q3 rounds to 1.001", radar.global_q3, 1.001);
eq("median pre-token age", radar.median_age_days, 513);

const plan1 = byRank.get(1).plan;
eq("row 1 plan capital", plan1.capital_usd, 375);
eq("row 1 plan gas", plan1.gas_usd, 13.5);
eq("row 1 plan hold days", plan1.hold_days, 30);
eq("row 1 plan minutes total", plan1.minutes_total, 140);

const snapshot = parseSnapshot(readFileSync(join(input, "snapshot.json"), "utf8"));
const { board } = buildRadar(snapshot);
eq("board gate returns null", boardIssue(board, snapshot), null);

const protoBySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
let plansConsistent = true;
for (const row of board) {
  const plan = buildPlan(protoBySlug.get(row.slug), row.age_days);
  const t = plan.totals;
  if (
    t.capital_usd !== row.plan.capital_usd ||
    t.gas_usd !== row.plan.gas_usd ||
    t.hold_days !== row.plan.hold_days ||
    t.weeks !== row.plan.weeks ||
    t.minutes_per_week !== row.plan.minutes_per_week ||
    t.minutes_total !== row.plan.minutes_total
  ) {
    plansConsistent = false;
  }
  const gasSum = plan.steps.reduce((s, x) => s + x.gas_usd, 0);
  if (Math.round(gasSum * 100) !== Math.round(t.gas_usd * 100)) plansConsistent = false;
  if (plan.steps.reduce((s, x) => s + x.minutes, 0) !== t.minutes_total) plansConsistent = false;
  const rendered = plan.steps.map(renderStep);
  if (JSON.stringify(rendered) !== JSON.stringify(row.farm_steps)) plansConsistent = false;
}
check("every row's plan totals equal the sums of its own steps", plansConsistent);

let peersOk = true;
for (const row of radar.rows) {
  if (row.peers.length > 3) peersOk = false;
  let prevTvl = Infinity;
  for (const peer of row.peers) {
    const proto = protoBySlug.get(peer.slug);
    if (!proto) { peersOk = false; continue; }
    if (categoryKey(proto) !== row.category) peersOk = false;
    if (proto.mcap_usd === null || proto.tvl_usd <= 0) peersOk = false;
    if (peer.tvl_usd !== proto.tvl_usd || peer.mcap_usd !== proto.mcap_usd) peersOk = false;
    if (peer.ratio !== round4(proto.mcap_usd / proto.tvl_usd)) peersOk = false;
    if (peer.tvl_usd > prevTvl) peersOk = false;
    prevTvl = peer.tvl_usd;
  }
}
check("peers on every row are real snapshot protocols of that category, TVL-ordered", peersOk);

const genericFirstChains = board.filter(
  (row) => gasFor(row.chains[0] ?? null).generic,
).length;
eq("board rows whose first chain prices at the generic gas class", genericFirstChains, 1);

console.log(`\nselftest: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
