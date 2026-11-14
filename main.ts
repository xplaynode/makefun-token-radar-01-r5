// Launch Radar entry point: read the sealed snapshot, build the board,
// gate it, and write the run outputs (board.json, data.js, the dashboard,
// the screenshots and the dossier) into the output directory.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SnapshotError, parseSnapshot } from "./lib/model.ts";
import { boardIssue, buildRadar, dataScript } from "./lib/board.ts";
import { PLAIN_NAME, buildDossier } from "./vendor/makefun-board.ts";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const IMAGE_NAME = /\.(?:png|jpe?g|webp)$/i;
const SCREENSHOT_MAX_BYTES = 524288;

function fail(code: number, message: string): never {
  console.error(`launch radar: ${message}`);
  process.exit(code);
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "/input";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : null;
    if (name === "--input" || name === "--output") {
      const value = inline ?? argv[++i];
      if (value === undefined) fail(2, `${name} needs a value`);
      if (name === "--input") input = value;
      else output = value;
    }
  }
  return { input, output };
}

// Copy a directory tree of regular files, skipping dot-names at every level.
function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));

  let inputFile = input;
  if (existsSync(input) && statSync(input).isDirectory()) {
    inputFile = join(input, "snapshot.json");
  }
  if (!existsSync(inputFile)) {
    fail(2, `input snapshot not found: ${inputFile}`);
  }

  let snapshot;
  try {
    snapshot = parseSnapshot(readFileSync(inputFile, "utf8"));
  } catch (err) {
    if (err instanceof SnapshotError) fail(1, err.message);
    throw err;
  }

  const { radar, board } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) fail(1, `board gate: ${issue}`);

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "board.json"), JSON.stringify({ rows: board }) + "\n");
  writeFileSync(join(output, "data.js"), dataScript(radar));
  copyTree(join(ROOT, "dashboard"), join(output, "dashboard"));

  if (process.env.MAKEFUN_DATA_ONLY === "1") {
    console.log(
      `launch radar: data-only pass complete (board.json, data.js, dashboard/) in ${output}`,
    );
    return;
  }

  const shotsSrc = join(ROOT, "screenshots");
  const shotsDst = join(output, "screenshots");
  const shotNames = existsSync(shotsSrc)
    ? readdirSync(shotsSrc).filter((name) => IMAGE_NAME.test(name))
    : [];
  if (shotNames.length < 3 || shotNames.length > 4) {
    fail(1, `expected 3-4 screenshots, found ${shotNames.length}`);
  }
  mkdirSync(shotsDst, { recursive: true });
  for (const name of shotNames) {
    if (!PLAIN_NAME.test(name)) {
      fail(1, `screenshot name is not a plain file name: ${name}`);
    }
    const size = statSync(join(shotsSrc, name)).size;
    if (size > SCREENSHOT_MAX_BYTES) {
      fail(1, `screenshot ${name} is ${size} bytes, over the ${SCREENSHOT_MAX_BYTES} cap`);
    }
    copyFileSync(join(shotsSrc, name), join(shotsDst, name));
  }

  let dossier: Uint8Array;
  try {
    dossier = buildDossier(output, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524288 },
      dashboard: { max_files: 400, max_bytes: 4194304 },
    });
  } catch (err) {
    fail(1, `dossier: ${err instanceof Error ? err.message : String(err)}`);
  }
  writeFileSync(join(output, "dossier.json"), dossier);

  console.log(
    `launch radar: ${radar.protocols_scanned} protocols scanned, ${radar.watchlist_size} on the watchlist, ${radar.board_size} launch candidates ranked, ${radar.products_size} products set aside, ${radar.live_size} live tokens shown apart`,
  );
  console.log(
    `wrote board.json, data.js, dashboard/, screenshots/ and dossier.json (${dossier.length} bytes) to ${output}`,
  );
}

main();
