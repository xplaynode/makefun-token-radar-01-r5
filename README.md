# Launch Radar

A ranking of DeFi protocols that have not issued a token yet, priced by what
a launch might plausibly be worth. Launch Radar reads a sealed snapshot of
758 protocols and answers one question for each pre-token protocol: if this
launched at the kind of valuation its already-tokenised peers actually
trade at, what would it be worth? Every candidate carries that implied
value, a range around it, and an 8-step farm plan for positioning ahead of
a possible launch.

The output is a static, offline dashboard plus machine-readable files
(`board.json`, `data.js`, `dossier.json`). No network, no dependencies:
Node 22+ runs the TypeScript sources directly.

## The model

For every protocol in the snapshot that already has a token, take the
ratio `mcap / TVL`. Those 144 ratios are the only valuation evidence the
model uses.

**Category multiple.** Within a protocol's own category, take the median
ratio of its tokenised peers and shrink it toward the global median with
K = 6 pseudo-peers of weight:

    shrunk = (n · peer_stat + 6 · global_stat) / (n + 6)

The result is clamped to [×0.02, ×2.00]. Categories with fewer than three
peers are thin evidence, so their multiple is then pulled further toward
the global statistic: by 1/3 of the distance with two peers, 2/3 with one,
all the way with none.

**Value range.** The same shrinkage pipeline runs on the category's first
and third quartile ratios (nearest-rank quartiles: the element at
floor((n−1)/4) and at ceil(3(n−1)/4) of the sorted ratios). The low
multiple never exceeds the headline multiple and the high one never falls
below it, so the range always brackets the value.

**Adjustments.** The headline value is TVL × multiple × three factors:

- *Momentum* — `1 + clamp(change_7d, −50%, +100%) / 100 × 0.5`.
- *Seasoning* — `0.75 + 0.45 × age_days / 1460`, saturating at four years.
  A protocol with no listing date is seasoned at the median age of all
  pre-token protocols (513 days in this snapshot).
- *Breadth* — `1 + 0.03 × extra chains`, capped at seven extra chains.

**Products set aside.** A pre-token protocol that is itself a product of
an asset that already trades — a bridge, a liquid (re)staking product, a
wrapped or staked wrapper, an exchange's own product, or a versioned pool
of another protocol — is not an independent launch candidate and is listed
separately with its reason. Protocols on the snapshot's watchlist are
always candidates, even when a product rule would have set them aside.

**Farm plans.** Each board row ships an 8-step plan sized to the
protocol's TVL (working capital of $50–$375 across two positions), with
gas priced by the class of the chain it runs on — Ethereum mainnet at a
$9 midpoint, L2s at $0.50, near-zero-fee chains at $0.05, and so on — and
a hold of 30–45 days set by the protocol's age. The plan's stated totals
are exactly the sums of its steps.

## Running it

    node main.ts --input <snapshot file or its directory> --output <dir>

Defaults: input `/input`, output `$MAKEFUN_OUTPUT_DIR` or `/output`.
With `MAKEFUN_DATA_ONLY=1` the run stops after `board.json`, `data.js`
and the dashboard — that is the pass `tools/shots.mjs` renders for the
screenshots. `tools/selftest.mjs` runs the full pipeline twice against
the competition snapshot and asserts every pinned figure, including a
byte-identical dossier across runs.

Real run output against the sealed snapshot:

    launch radar: 758 protocols scanned, 40 on the watchlist, 198 launch candidates ranked, 144 products set aside, 30 live tokens shown apart
    wrote board.json, data.js, dashboard/, screenshots/ and dossier.json (815070 bytes) to /output

Top of the board: Steakhouse Financial at $1,318,555,497 (range
$942,321,512 – $3,594,726,302), Sentora Curator at $1,161,167,392, and
Gauntlet at $785,299,671.

## Honest limits

- Prediction Market has exactly one tokenised peer in the snapshot, and
  it trades near ×400 of TVL. Every shrunk multiple for the category runs
  through the ×2.00 clamp before the thin-peer pull separates them again
  (used ×1.3896, range ×1.3438 – ×1.6670), so the category's two board
  rows rest on a single extreme observation. Treat them as the board's
  least reliable figures.
- Eleven board categories have no tokenised peer at all; their rows
  borrow the global median (×0.1689) and the global quartiles for the
  range, which says "typical protocol" and nothing about the category.
- The model prices a hypothetical launch from current TVL and peer
  multiples. It knows nothing about whether a token is planned, a
  protocol's revenue, or its investors — it is a ranking of candidates
  worth a closer look, not a forecast.
