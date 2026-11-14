// Farm plans: an 8-step, costed plan for farming a possible launch of each
// board protocol. Gas is priced by chain class with a midpoint used for all
// totals, so a plan's stated gas is always the exact sum of its steps.

import type { Protocol } from "./model.ts";
import { categoryKey } from "./model.ts";

export interface GasClass {
  label: string;
  per_action: string;
  midpoint: number;
  generic: boolean;
}

const NEAR_ZERO = new Set([
  "Solana", "Sui", "Aptos", "Near", "TON", "Fogo", "Cosmos", "Osmosis",
  "Injective", "Celestia", "dYdX", "Kujira", "Neutron", "Terra", "Terra2",
  "Akash", "Agoric", "Archway", "Chihuahua", "Juno", "Noble", "Persistence",
  "Regen", "Secret", "Stargaze", "Stride", "Umee", "XION", "ZIGChain",
  "BandChain", "Fetch Hub", "Evmos", "Canto", "Carbon", "Dymension",
  "Initia", "Mantra", "Babylon Genesis", "Stellar", "Algorand", "Hedera",
  "Tezos", "VeChain", "Provenance", "Proton", "Bittensor", "Qubic",
  "Ripple", "Stacks",
]);

const L2 = new Set([
  "Arbitrum", "Arbitrum Nova", "Base", "Optimism", "zkSync Era", "Linea",
  "Scroll", "Mantle", "Blast", "Mode", "Taiko", "Starknet", "Manta", "Zora",
  "Fraxtal", "Sonic", "Berachain", "Unichain", "Ink", "Abstract",
  "World Chain", "Soneium", "Metis", "Polygon zkEVM", "X Layer", "BOB",
  "Lisk", "Avalanche", "Polygon", "Fantom", "Cronos", "xDai", "Moonbeam",
  "Moonriver", "Celo", "Kava", "CORE", "Monad", "MegaETH", "Hyperliquid L1",
  "Plasma", "Katana", "Sophon", "Zircuit", "Swellchain", "Etherlink",
  "Story", "Lens", "Peaq", "Plume", "Plume Mainnet", "Vana", "Boba",
  "Boba_Bnb", "Boba_Avax", "Op_Bnb", "Kroma", "LightLink", "MetalL2",
  "Morph", "RISE", "Ethereal", "Gravity", "Hemi", "Sei", "Astar",
  "Astar zkEVM", "Shibarium", "Xai", "Silicon zkEVM", "Cronos zkEVM",
  "Mint", "re.al", "Fuel", "Eclipse", "BSquared", "Flare", "Arc", "Pharos",
  "Robinhood Chain", "Mezo", "Reya Network", "Stable", "Tempo", "Ronin",
  "RSK", "Strato", "Klaytn", "Fluent", "Citrea", "Hibachi",
  "Bifrost Network", "Bittensor EVM",
]);

export function gasFor(chain: string | null): GasClass {
  if (chain === "Ethereum") {
    return { label: "Ethereum mainnet", per_action: "$6-12 of gas", midpoint: 9, generic: false };
  }
  if (chain === "Bitcoin") {
    return { label: "Bitcoin", per_action: "$1-4 of fees", midpoint: 2, generic: false };
  }
  if (chain === "Tron") {
    return { label: "Tron", per_action: "$0.50-2 of fees", midpoint: 1, generic: false };
  }
  if (chain !== null && NEAR_ZERO.has(chain)) {
    return { label: chain, per_action: "under $0.10 of fees", midpoint: 0.05, generic: false };
  }
  if (chain !== null && L2.has(chain)) {
    return { label: chain, per_action: "$0.10-1 of gas", midpoint: 0.5, generic: false };
  }
  if (chain === "BNB Chain" || chain === "Binance") {
    return { label: "BNB Chain", per_action: "$0.20-1 of gas", midpoint: 0.6, generic: false };
  }
  return { label: chain ?? "its main chain", per_action: "$1-3 of gas", midpoint: 2, generic: true };
}

// Round half-up to whole cents; money is rendered as plain JS numbers, so
// 9 prints as "9" and 2.5 as "2.5", never with forced decimals.
export function cents(x: number): number {
  return Math.round(x * 100) / 100;
}

export function capitalFor(tvl: number): number {
  if (tvl >= 1e9) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

export function holdDaysFor(age: number | null): number {
  if (age === null) return 35;
  if (age < 180) return 45;
  if (age < 540) return 35;
  return 30;
}

// The plan's shape follows what the protocol is: substring tests on the
// lowercased category, in a fixed order, first match wins.
export function familyOf(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("lend") || c.includes("cdp") || c.includes("collateral")) return "lending";
  if (c.includes("dex") || c.includes("liquidity") || c.includes("yield") || c.includes("farm")) return "liquidity";
  if (c.includes("derivative") || c.includes("perpetual") || c.includes("options")) return "perps";
  if (c.includes("curator") || c.includes("allocator")) return "curator";
  if (c.includes("staking pool")) return "staking";
  if (c === "chain") return "chain";
  if (c.includes("prediction")) return "prediction";
  if (c.includes("payment") || c.includes("card")) return "payments";
  return "generic";
}

function coreAction(family: string, name: string, capital: number, where: string): string {
  switch (family) {
    case "lending":
      return `Supply $${capital} of USDC as collateral in ${name} on ${where} and borrow about 40% of it against the position, so the wallet both lends and borrows.`;
    case "liquidity":
      return `Provide $${capital} split between USDC and the pool's paired asset in ${name}'s most-used pool on ${where} and keep the LP position open.`;
    case "perps":
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position (long one asset, short another of equal size) so the account trades without directional risk.`;
    case "curator":
      return `Deposit $${capital} of USDC into the largest ${name} vault on ${where} and keep the vault shares in the wallet.`;
    case "staking":
      return `Stake $${capital} of the chain's native asset through ${name} on ${where} and keep the staking position and its receipts.`;
    case "chain":
      return `Bridge $${capital} of USDC to ${name} and hold it there, paying gas in the chain's native asset for every action so the wallet builds a real history on the chain.`;
    case "prediction":
      return `Fund the account with $${capital} and take one position on each side of two liquid markets on ${name}, so the wallet both makes and settles trades.`;
    case "payments":
      return `Load $${capital} onto the ${name} account or card and make three ordinary payments with it, so the wallet reads as a customer, not a visitor.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${where} through its main app and keep the position open.`;
  }
}

function secondAction(family: string, name: string): string {
  switch (family) {
    case "lending":
      return `Repay part of the borrow and re-borrow a smaller amount, then vote in any governance poll ${name} opens to its users.`;
    case "liquidity":
      return `Claim any fees the pool shows, swap a few dollars through ${name}'s own interface and add the proceeds back to the position.`;
    case "perps":
      return `Adjust the hedge once (close one leg and reopen it at the current price) so the account shows ordinary trading activity on ${name}.`;
    case "curator":
      return `Move about a fifth of the position into a second ${name} vault, so the wallet holds more than one of the curator's strategies.`;
    case "staking":
      return `Claim the staking rewards ${name} shows and restake them into the same position rather than withdrawing them.`;
    case "chain":
      return `Use one native app on the chain each week (a swap or a name registration) and keep the receipts in the same wallet.`;
    case "prediction":
      return `Settle any finished position and place one new trade on a market that closes within the week.`;
    case "payments":
      return `Make one more ordinary payment and, if ${name} offers referrals, send one to a wallet you control.`;
    default:
      return `Repeat the core action with a small top-up of $10-20 and claim anything the app shows as claimable.`;
  }
}

export interface PlanStep {
  action: string;
  cost: string;
  time: string;
  gas_usd: number;
  minutes: number;
}

export interface PlanTotals {
  capital_usd: number;
  gas_usd: number;
  hold_days: number;
  weeks: number;
  minutes_per_week: number;
  minutes_total: number;
}

export interface FarmPlan {
  family: string;
  steps: PlanStep[];
  totals: PlanTotals;
}

export function buildPlan(p: Protocol, age: number | null): FarmPlan {
  const family = familyOf(categoryKey(p));
  const name = p.name;
  const chainName = p.chains[0] ?? null;
  const gas = gasFor(chainName);
  const where = chainName === null ? "its main chain" : gas.label;
  const capital = capitalFor(p.tvl_usd);
  const secondCapital = Math.max(25, Math.round(capital / 2));
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const secondChain = p.chains[1] ?? null;
  const gas2 = gasFor(secondChain);

  const steps: PlanStep[] = [];

  steps.push({
    action: `Create a fresh wallet for this farm alone, back up its seed phrase offline, and fund it on ${where} with the $${capital + secondCapital} the two positions need plus a gas buffer.`,
    cost: `one funding transfer, about ${gas.per_action} (about $${gas.midpoint} at the midpoint)`,
    time: "10 minutes",
    gas_usd: gas.midpoint,
    minutes: 10,
  });

  steps.push({
    action: coreAction(family, name, capital, where),
    cost: `$${capital} of working capital plus about ${gas.per_action}`,
    time: "15 minutes to set up",
    gas_usd: gas.midpoint,
    minutes: 15,
  });

  steps.push({
    action: secondAction(family, name),
    cost: `about ${gas.per_action}`,
    time: "10 minutes, on the first weekly visit",
    gas_usd: gas.midpoint,
    minutes: 10,
  });

  if (secondChain !== null) {
    steps.push({
      action: `${name} also runs on ${secondChain}: repeat the core action there with $${secondCapital}, funded by a bridge from ${where}, so the farm is not a single-chain footprint.`,
      cost: `$${secondCapital} of working capital plus about ${gas2.per_action} on ${secondChain} and one bridge fee`,
      time: "15 minutes",
      gas_usd: gas2.midpoint,
      minutes: 15,
    });
  } else {
    steps.push({
      action: `Open a second, smaller position of $${secondCapital} in a different market or vault of ${name} on ${where}, so the wallet uses more than the protocol's front door.`,
      cost: `$${secondCapital} of working capital plus about ${gas.per_action}`,
      time: "10 minutes",
      gas_usd: gas.midpoint,
      minutes: 10,
    });
  }

  steps.push({
    action: `Return once a week for ${weeks} weeks and repeat one qualifying action each visit, varying the amount slightly so the history reads as ordinary use of ${name}.`,
    cost: `about ${gas.per_action} a week, about $${cents(gas.midpoint * weeks)} across the ${weeks} visits at the midpoint`,
    time: "10 minutes a week",
    gas_usd: cents(gas.midpoint * weeks),
    minutes: 10 * weeks,
  });

  steps.push({
    action: `Hold both positions for at least ${hold} days without withdrawing, so the wallet appears in several weekly snapshots of ${name}'s users rather than one.`,
    cost: `the $${capital + secondCapital} stays in the positions for the full ${hold} days`,
    time: `${hold} days`,
    gas_usd: 0,
    minutes: 0,
  });

  steps.push({
    action: `Each week, check ${name}'s own app and announcements for a points or rewards program; if one opens, register this same wallet before doing anything new, and never connect it to a look-alike site.`,
    cost: "nothing to check; never pay to register",
    time: "5 minutes a week",
    gas_usd: 0,
    minutes: 5 * weeks,
  });

  steps.push({
    action: `If ${name} issues a token, claim only from the link its own app or announcement publishes and pay nothing beyond gas. If the ${hold} days end with no token and no points program, withdraw both positions in two tranches a week apart and rotate the capital to the next candidate on this board instead of leaving it idle.`,
    cost: `claim or exit gas only, about ${gas.per_action}`,
    time: "15 minutes on the day",
    gas_usd: gas.midpoint,
    minutes: 15,
  });

  const totals: PlanTotals = {
    capital_usd: capital + secondCapital,
    gas_usd: cents(steps.reduce((sum, s) => sum + s.gas_usd, 0)),
    hold_days: hold,
    weeks,
    minutes_per_week: 15,
    minutes_total: steps.reduce((sum, s) => sum + s.minutes, 0),
  };

  return { family, steps, totals };
}

// The one-line rendering of a step that the board carries: the action, its
// cost and its time, kept inside the board gate's 20..600 character window.
export function renderStep(step: PlanStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = s.slice(0, 596) + "...";
  if (s.length < 20) {
    s += " Hold the position and check the protocol's own page before acting.";
  }
  return s;
}
