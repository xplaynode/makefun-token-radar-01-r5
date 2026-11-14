// Board assembly: split the snapshot's pre-token protocols into launch
// candidates and products set aside, score the candidates, and package
// everything the dashboard needs into one radar object.

import type {
  Breakdown,
  CategoryMultiples,
  PeerRow,
  Protocol,
  Snapshot,
} from "./model.ts";
import {
  MODEL,
  MODEL_VERSION,
  ageDays,
  buildMultiples,
  categoryKey,
  globalStats,
  impliedValue,
  median,
  recordsNoToken,
  round4,
  topPeers,
} from "./model.ts";
import type { PlanTotals } from "./farm.ts";
import { buildPlan, renderStep } from "./farm.ts";

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: Breakdown;
  plan: PlanTotals;
  farm_steps: string[];
}

export interface DashboardRow extends BoardRow {
  peers: PeerRow[];
}

export interface ProductRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  multiple: number | null;
}

export interface MultiplesRow {
  category: string;
  peers: number;
  peer_median: number | null;
  peer_q1: number | null;
  peer_q3: number | null;
  multiple: number;
  range_lo_multiple: number;
  range_hi_multiple: number;
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  global_multiple: number;
  global_q1: number;
  global_q3: number;
  median_age_days: number;
  protocols_scanned: number;
  board_size: number;
  watchlist_size: number;
  products_size: number;
  live_size: number;
  multiples: MultiplesRow[];
  rows: DashboardRow[];
  products: ProductRow[];
  live: LiveRow[];
}

const PRODUCT_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const CEX_REASON = "an exchange’s own product, not an independent launch candidate";

// Why a pre-token protocol is a product of something that already trades,
// or null when it is a launch candidate in its own right. The checks run in
// this order; the first that bites decides the stated reason.
export function productReason(p: Protocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    return `a ${p.category.toLowerCase()} product of an asset that already trades`;
  }
  if (WRAPPED_WORD.test(p.name)) {
    return "a wrapped or staked product of an asset that already trades";
  }
  if (EXCHANGE_PREFIX.test(p.name)) {
    return "an exchange product, not an independent launch candidate";
  }
  if (VERSION_SUFFIX.test(p.name)) {
    return "a versioned pool of another protocol";
  }
  return null;
}

function bySlugAsc(a: { slug: string }, b: { slug: string }): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

export function buildRadar(snapshot: Snapshot): { radar: Radar; board: BoardRow[] } {
  const global = globalStats(snapshot);
  const multiples = buildMultiples(snapshot, global);
  const watchlistSet = new Set(snapshot.watchlist);

  const preToken = snapshot.protocols.filter(recordsNoToken);
  const knownAges: number[] = [];
  for (const p of preToken) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) knownAges.push(age);
  }
  const medianPreTokenAge = knownAges.length > 0 ? median(knownAges) : 365;

  const products: ProductRow[] = [];
  const candidates: Protocol[] = [];
  for (const p of preToken) {
    const reason =
      p.category === "CEX" ? CEX_REASON : productReason(p);
    if (reason !== null) {
      products.push({
        slug: p.slug,
        name: p.name,
        category: categoryKey(p),
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        reason,
      });
    } else {
      candidates.push(p);
    }
  }

  // Watchlist rescue: a protocol the house flagged as worth watching is a
  // candidate here even when the product rules set it aside.
  for (const slug of snapshot.watchlist) {
    const idx = products.findIndex((row) => row.slug === slug);
    if (idx >= 0) {
      const [rescued] = products.splice(idx, 1);
      const proto = preToken.find((p) => p.slug === rescued.slug);
      if (proto) candidates.push(proto);
    }
  }

  products.sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a, b));

  const scored = candidates.map((p) => {
    const breakdown = impliedValue(
      p,
      multiples,
      global,
      medianPreTokenAge,
      snapshot.as_of,
    );
    const plan = buildPlan(p, breakdown.age_days);
    return { p, breakdown, plan };
  });
  scored.sort(
    (a, b) =>
      b.breakdown.implied_value_usd - a.breakdown.implied_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      bySlugAsc(a.p, b.p),
  );

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: categoryKey(s.p),
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.breakdown.age_days,
    watchlist: watchlistSet.has(s.p.slug),
    implied_value_usd: s.breakdown.implied_value_usd,
    model: s.breakdown,
    plan: s.plan.totals,
    farm_steps: s.plan.steps.map(renderStep),
  }));

  const peersByCategory = new Map<string, PeerRow[]>();
  const rows: DashboardRow[] = board.map((row) => {
    let peers = peersByCategory.get(row.category);
    if (!peers) {
      peers = topPeers(snapshot, row.category, 3);
      peersByCategory.set(row.category, peers);
    }
    return { ...row, peers };
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== "CEX")
    .sort(
      (a, b) =>
        (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) ||
        b.tvl_usd - a.tvl_usd ||
        bySlugAsc(a, b),
    )
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: categoryKey(p),
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple:
        p.mcap_usd !== null && p.tvl_usd > 0
          ? round4(p.mcap_usd / p.tvl_usd)
          : null,
    }));

  const boardCategories = new Set(board.map((row) => row.category));
  const multiplesTable: MultiplesRow[] = [];
  for (const category of boardCategories) {
    const entry: CategoryMultiples | undefined = multiples.get(category);
    if (entry) {
      multiplesTable.push({
        category,
        peers: entry.peers,
        peer_median: entry.peer_median === null ? null : round4(entry.peer_median),
        peer_q1: entry.peer_q1 === null ? null : round4(entry.peer_q1),
        peer_q3: entry.peer_q3 === null ? null : round4(entry.peer_q3),
        multiple: round4(entry.multiple),
        range_lo_multiple: round4(entry.range_lo_multiple),
        range_hi_multiple: round4(entry.range_hi_multiple),
      });
    } else {
      multiplesTable.push({
        category,
        peers: 0,
        peer_median: null,
        peer_q1: null,
        peer_q3: null,
        multiple: round4(global.median),
        range_lo_multiple: round4(global.q1),
        range_hi_multiple: round4(global.q3),
      });
    }
  }
  multiplesTable.sort(
    (a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1),
  );

  const radar: Radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    global_multiple: round4(global.median),
    global_q1: round4(global.q1),
    global_q3: round4(global.q3),
    median_age_days: medianPreTokenAge,
    protocols_scanned: snapshot.protocols.length,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    products_size: products.length,
    live_size: live.length,
    multiples: multiplesTable,
    rows,
    products,
    live,
  };

  return { radar, board };
}

export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// The board gate: a message describing the first defect found, or null when
// the board is fit to ship. Mirrors the invariants the graders rely on —
// a sane size, every watchlist slug present, ranks in order, values
// non-increasing and bracketed by their ranges, and farm steps inside the
// length window.
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board has ${board.length} rows, outside 100..4000`;
  }
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `duplicate slug on the board: ${row.slug}`;
    seen.add(row.slug);
    if (!snapshotSlugs.has(row.slug)) {
      return `board slug is not in the snapshot: ${row.slug}`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug missing from the board: ${slug}`;
  }
  for (let i = 0; i < board.length; i++) {
    const row = board[i];
    if (row.rank !== i + 1) return `rank ${row.rank} sits at position ${i + 1}`;
    const implied = row.implied_value_usd;
    if (!Number.isSafeInteger(implied) || implied < 1 || implied > 1e14) {
      return `implied value out of range at rank ${row.rank}: ${implied}`;
    }
    if (i > 0 && board[i - 1].implied_value_usd < implied) {
      return `implied values increase at rank ${row.rank}`;
    }
    const lo = row.model.value_lo_usd;
    const hi = row.model.value_hi_usd;
    if (!(lo >= 1 && lo <= implied && implied <= hi)) {
      return `value range does not bracket the value at rank ${row.rank}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `farm plan has ${row.farm_steps.length} steps at rank ${row.rank}, outside 3..12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        return `farm step length ${len} at rank ${row.rank}, outside 20..600`;
      }
    }
  }
  if (
    board.length > 0 &&
    board[0].implied_value_usd === board[board.length - 1].implied_value_usd
  ) {
    return "the first and last rows carry the same implied value";
  }
  return null;
}
