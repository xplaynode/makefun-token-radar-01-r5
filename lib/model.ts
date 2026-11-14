// Launch Radar model: implied launch values for pre-token protocols, derived
// from the snapshot's own tokenised protocols. Pure functions, no I/O, so the
// board builder and the self-test share exactly the same arithmetic.

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  protocols: Protocol[];
}

export const MODEL_VERSION = "launch-radar-3";

export const MODEL = {
  shrink_k: 6,
  thin_peer_threshold: 3,
  thin_peer_pull: 0.5,
  multiple_lo: 0.02,
  multiple_hi: 2.0,
  momentum_weight: 0.5,
  momentum_floor_pct: -50,
  momentum_cap_pct: 100,
  seasoning_base: 0.75,
  seasoning_range: 0.45,
  seasoning_days: 1460,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 7,
};

export function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// Validate the snapshot file's text and normalise it into a Snapshot. The
// file either wraps the snapshot in a "snapshot" member or carries the
// fields at the top level; both readings describe the same shape. Anything
// structurally wrong (not JSON, a bad as_of, a missing field, a protocol
// without a slug, name or finite TVL) is a SnapshotError; merely wrong-typed
// optional fields are coerced to null / [] instead of failing the run.
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError("snapshot is not valid JSON");
  }
  if (!isRecord(raw)) throw new SnapshotError("snapshot root is not an object");
  const root: Record<string, unknown> = isRecord(raw.snapshot) ? raw.snapshot : raw;

  const asOf = root.as_of;
  if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new SnapshotError("snapshot as_of is missing or not a YYYY-MM-DD date");
  }
  if (typeof root.source !== "string") {
    throw new SnapshotError("snapshot source is missing or not a string");
  }
  const floor = root.floor_usd;
  if (typeof floor !== "number" || !Number.isSafeInteger(floor) || floor <= 0) {
    throw new SnapshotError("snapshot floor_usd is not a positive safe integer");
  }
  if (!Array.isArray(root.watchlist)) {
    throw new SnapshotError("snapshot watchlist is missing or not an array");
  }
  if (!Array.isArray(root.protocols)) {
    throw new SnapshotError("snapshot protocols is missing or not an array");
  }

  const protocols: Protocol[] = root.protocols.map((entry, i) => {
    if (!isRecord(entry)) throw new SnapshotError(`protocol ${i} is not an object`);
    if (typeof entry.slug !== "string" || entry.slug.length === 0) {
      throw new SnapshotError(`protocol ${i} has no slug string`);
    }
    if (typeof entry.name !== "string") {
      throw new SnapshotError(`protocol ${entry.slug} has no name string`);
    }
    if (typeof entry.tvl_usd !== "number" || !Number.isFinite(entry.tvl_usd)) {
      throw new SnapshotError(`protocol ${entry.slug} has no finite tvl_usd`);
    }
    return {
      slug: entry.slug,
      name: entry.name,
      category: stringOrNull(entry.category),
      chains: Array.isArray(entry.chains)
        ? entry.chains.filter((c): c is string => typeof c === "string")
        : [],
      tvl_usd: entry.tvl_usd,
      change_7d: finiteOrNull(entry.change_7d),
      mcap_usd: finiteOrNull(entry.mcap_usd),
      listed_at: stringOrNull(entry.listed_at),
      gecko_id: stringOrNull(entry.gecko_id),
      symbol: stringOrNull(entry.symbol),
    };
  });

  return {
    as_of: asOf,
    source: root.source,
    floor_usd: floor,
    watchlist: root.watchlist.filter((s): s is string => typeof s === "string"),
    protocols,
  };
}

// Whole days between the listing date and the snapshot date, both read as
// UTC midnights. Null when either side is missing or unparseable.
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const l = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(l)) return null;
  return Math.max(0, Math.floor((a - l) / 86400000));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Nearest-rank quartile: Q1 is the element at floor((n-1)/4), Q3 the element
// at ceil(3(n-1)/4), indices clamped into range. No interpolation.
export function quartile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 1) return s[0];
  const raw = q < 0.5 ? Math.floor((n - 1) * q) : Math.ceil((n - 1) * q);
  const idx = Math.min(n - 1, Math.max(0, raw));
  return s[idx];
}

export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function categoryKey(p: Protocol): string {
  return p.category ?? "Uncategorized";
}

export function ratioOf(p: Protocol): number | null {
  return p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null;
}

export interface PeerStats {
  median: number;
  q1: number;
  q3: number;
  n: number;
}

function statsOf(ratios: number[]): PeerStats {
  return {
    median: median(ratios),
    q1: quartile(ratios, 0.25),
    q3: quartile(ratios, 0.75),
    n: ratios.length,
  };
}

export function globalStats(snapshot: Snapshot): PeerStats {
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    const r = ratioOf(p);
    if (r !== null) ratios.push(r);
  }
  return statsOf(ratios);
}

export function categoryStats(snapshot: Snapshot): Map<string, PeerStats> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    const r = ratioOf(p);
    if (r === null) continue;
    const key = categoryKey(p);
    const list = byCategory.get(key);
    if (list) list.push(r);
    else byCategory.set(key, [r]);
  }
  const out = new Map<string, PeerStats>();
  for (const [key, ratios] of byCategory) out.set(key, statsOf(ratios));
  return out;
}

// Shrink a category statistic toward the global one with K pseudo-peers,
// clamp to the sane multiple band, then — for thin categories only — pull
// the result partway back to the global statistic. The pull is deliberately
// not re-clamped: it moves toward the global value, which is in band.
export function shrink(stat: number, peers: number, globalStat: number): number {
  let m =
    (peers * stat + MODEL.shrink_k * globalStat) / (peers + MODEL.shrink_k);
  m = Math.min(MODEL.multiple_hi, Math.max(MODEL.multiple_lo, m));
  if (peers < MODEL.thin_peer_threshold) {
    const pull =
      ((MODEL.thin_peer_threshold - peers) / MODEL.thin_peer_threshold) *
      MODEL.thin_peer_pull;
    m = m * (1 - pull) + globalStat * pull;
  }
  return m;
}

export interface CategoryMultiples {
  category: string;
  peers: number;
  peer_median: number | null;
  peer_q1: number | null;
  peer_q3: number | null;
  multiple: number;
  range_lo_multiple: number;
  range_hi_multiple: number;
}

export function buildMultiples(
  snapshot: Snapshot,
  global: PeerStats,
): Map<string, CategoryMultiples> {
  const out = new Map<string, CategoryMultiples>();
  for (const [category, stats] of categoryStats(snapshot)) {
    const multiple = shrink(stats.median, stats.n, global.median);
    const loRaw = shrink(stats.q1, stats.n, global.q1);
    const hiRaw = shrink(stats.q3, stats.n, global.q3);
    out.set(category, {
      category,
      peers: stats.n,
      peer_median: stats.median,
      peer_q1: stats.q1,
      peer_q3: stats.q3,
      multiple,
      range_lo_multiple: Math.min(loRaw, multiple),
      range_hi_multiple: Math.max(hiRaw, multiple),
    });
  }
  return out;
}

export interface Breakdown {
  category_multiple: number;
  range_lo_multiple: number;
  range_hi_multiple: number;
  momentum_factor: number;
  seasoning_factor: number;
  breadth_factor: number;
  multiple_peers: number;
  age_days: number | null;
  implied_value_usd: number;
  value_lo_usd: number;
  value_hi_usd: number;
}

// The implied launch value of one pre-token protocol: its TVL times its
// category's shrunk multiple, adjusted by a momentum factor from its 7-day
// TVL change, a seasoning factor from its age, and a breadth factor from
// its chain count. The range reruns the same arithmetic with the category's
// quartile multiples. A category with no tokenised peer borrows the global
// statistics outright.
export function impliedValue(
  p: Protocol,
  multiples: Map<string, CategoryMultiples>,
  global: PeerStats,
  medianPreTokenAge: number,
  asOf: string,
): Breakdown {
  const entry = multiples.get(categoryKey(p));
  let multiple: number;
  let loMultiple: number;
  let hiMultiple: number;
  let peers: number;
  if (entry) {
    multiple = entry.multiple;
    loMultiple = entry.range_lo_multiple;
    hiMultiple = entry.range_hi_multiple;
    peers = entry.peers;
  } else {
    multiple = global.median;
    loMultiple = global.q1;
    hiMultiple = global.q3;
    peers = 0;
  }

  const change =
    p.change_7d === null
      ? 0
      : Math.min(
          MODEL.momentum_cap_pct,
          Math.max(MODEL.momentum_floor_pct, p.change_7d),
        );
  const momentum = 1 + (change / 100) * MODEL.momentum_weight;

  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? medianPreTokenAge;
  const clampedAge = Math.min(
    Math.max(ageForModel, 0),
    MODEL.seasoning_days,
  );
  const seasoning =
    MODEL.seasoning_base +
    MODEL.seasoning_range * (clampedAge / MODEL.seasoning_days);

  const breadth =
    1 +
    MODEL.breadth_per_chain *
      Math.min(
        Math.max(p.chains.length - 1, 0),
        MODEL.breadth_max_extra_chains,
      );

  const rest = momentum * seasoning * breadth;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * rest));
  const lo = Math.min(
    implied,
    Math.max(1, Math.round(p.tvl_usd * loMultiple * rest)),
  );
  const hi = Math.max(
    implied,
    Math.max(1, Math.round(p.tvl_usd * hiMultiple * rest)),
  );

  return {
    category_multiple: round4(multiple),
    range_lo_multiple: round4(loMultiple),
    range_hi_multiple: round4(hiMultiple),
    momentum_factor: round4(momentum),
    seasoning_factor: round4(seasoning),
    breadth_factor: round4(breadth),
    multiple_peers: peers,
    age_days: age,
    implied_value_usd: implied,
    value_lo_usd: lo,
    value_hi_usd: hi,
  };
}

export interface PeerRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

// The largest tokenised protocols of a category — the named evidence behind
// its multiple. TVL descending, slug ascending on ties.
export function topPeers(
  snapshot: Snapshot,
  category: string,
  limit: number,
): PeerRow[] {
  const rows: PeerRow[] = [];
  for (const p of snapshot.protocols) {
    if (categoryKey(p) !== category) continue;
    const r = ratioOf(p);
    if (r === null || p.mcap_usd === null) continue;
    rows.push({
      slug: p.slug,
      name: p.name,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      ratio: round4(r),
    });
  }
  rows.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  return rows.slice(0, limit);
}
