// Render the built dashboard with a headless browser and capture the three
// screenshots the entry ships: the board, one row's detail, a filtered
// board. Runs a data-only pass first so the shots always show a fresh
// build. Usage: node tools/shots.mjs [input-dir]
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_INPUT = join(
  ROOT,
  "..",
  "token-radar-01-kit",
  "token-radar-01-kit",
  "input",
);
const input = process.argv[2] ?? DEFAULT_INPUT;
const out = mkdtempSync(join(tmpdir(), "launch-radar-shots-"));
const MAX_BYTES = 524288;

const pass = spawnSync(
  process.execPath,
  [join(ROOT, "main.ts"), "--input", input, "--output", out],
  { env: { ...process.env, MAKEFUN_DATA_ONLY: "1" }, encoding: "utf8" },
);
if (pass.status !== 0) {
  console.error(pass.stdout);
  console.error(pass.stderr);
  throw new Error("data-only pass failed; cannot shoot a broken build");
}

const radar = JSON.parse(
  readFileSync(join(out, "data.js"), "utf8").slice("window.RADAR=".length, -2),
);
const first = radar.rows[0];
const pageBase = pathToFileURL(join(out, "dashboard", "index.html")).href;

// The platform's managed chromium refuses plain headless startup, so look
// for a working binary in order: an explicit CHROME_BIN, the puppeteer
// cache's own Chrome builds, then the usual system paths.
function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const cache = join(homedir(), ".cache", "puppeteer", "chrome");
  if (existsSync(cache)) {
    for (const build of readdirSync(cache).sort().reverse()) {
      const candidate = join(cache, build, "chrome-linux64", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  }
  const system = [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/meta-chromium/chrome",
  ];
  return system.find((c) => existsSync(c));
}
const chrome = findChrome();
if (!chrome) throw new Error("no headless chrome found in this VM");

function pngSize(path) {
  const buf = readFileSync(path);
  return { bytes: buf.length, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function shoot(url, dest) {
  for (const scale of [1, 0.85, 0.7]) {
    const run = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--window-size=1440,900",
        `--force-device-scale-factor=${scale}`,
        `--screenshot=${dest}`,
        url,
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    if (run.status !== 0 || !existsSync(dest)) {
      throw new Error(`chrome failed on ${url}: ${run.stderr}`);
    }
    const info = pngSize(dest);
    if (info.bytes <= MAX_BYTES) return { ...info, scale };
  }
  throw new Error(`screenshot ${dest} stays over ${MAX_BYTES} bytes`);
}

mkdirSync(join(ROOT, "screenshots"), { recursive: true });
const shots = [
  { name: "1-board.png", url: pageBase },
  { name: "2-detail.png", url: `${pageBase}#detail=${first.slug}` },
  {
    name: "3-filtered.png",
    url: `${pageBase}?cat=${encodeURIComponent(first.category)}`,
  },
];
for (const shot of shots) {
  const dest = join(ROOT, "screenshots", shot.name);
  const info = shoot(shot.url, dest);
  console.log(
    `${shot.name}: ${info.bytes} bytes, ${info.w}x${info.h}, scale ${info.scale}`,
  );
}
console.log(`screenshots written to ${join(ROOT, "screenshots")}`);
