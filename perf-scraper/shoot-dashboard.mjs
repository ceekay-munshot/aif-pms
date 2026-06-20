/**
 * shoot-dashboard.mjs — visual verification for UI steps. Fund Screener — MGA.
 *
 * Serves public/ with a tiny static server, opens the dashboard in Playwright
 * (CDNs — Tailwind/fonts/ECharts/Lucide — load on the runner), waits for the
 * boot loader to clear + fonts/charts, and screenshots each tab plus an open
 * fund-drill to perf-scraper/output/shots/. Run via .github/workflows/shoot-
 * dashboard.yml; the artifacts are the source of truth for UI review.
 *
 *   HEADFUL=1 to watch · PORT=#### to fix the port
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, "..", "public");
const OUT = path.join(__dirname, "output", "shots");
const HEADFUL = /^(1|true|yes|on)$/i.test(process.env.HEADFUL || "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2",
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/" || p === "") p = "/index.html";
      const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
      const file = path.join(PUBLIC, safe);
      if (!file.startsWith(PUBLIC)) {
        res.writeHead(403);
        return res.end("forbidden");
      }
      const buf = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(Number(process.env.PORT) || 0, "127.0.0.1", () => resolve(server));
  });
}

async function shoot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  log(`  · ${path.relative(process.cwd(), file)}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  log(`shoot-dashboard · serving ${path.relative(process.cwd(), PUBLIC)} at ${url}`);

  const browser = await chromium.launch({
    headless: !HEADFUL,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !document.getElementById("boot-loader"), { timeout: 30_000 });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
    await page.waitForSelector("#tab-screener tr[data-id]", { timeout: 15_000 });
    await sleep(1400); // count-up + layout settle

    log("Capturing tabs:");
    await shoot(page, "01-screener.png");

    for (const [i, tab] of [["02", "leaderboard"], ["03", "categories"], ["04", "movers"]]) {
      await page.click(`.tab-btn[data-tab="${tab}"]`);
      await page.waitForSelector(`#tab-${tab}:not([hidden])`, { timeout: 10_000 });
      await sleep(500);
      await shoot(page, `${i}-${tab}.png`);
    }

    // Open the fund-drill from the first Screener row and capture it.
    await page.click('.tab-btn[data-tab="screener"]');
    await page.waitForSelector("#tab-screener:not([hidden]) tr[data-id]", { timeout: 10_000 });
    await page.click("#tab-screener tr[data-id]");
    await page.waitForSelector("#drill-panel:not(.hidden)", { timeout: 10_000 });
    await page.waitForSelector("#drill-spark canvas", { timeout: 8000 }).catch(() => {});
    await sleep(1000);
    log("Capturing drill:");
    await page.screenshot({ path: path.join(OUT, "05-drill.png"), fullPage: false });
    log(`  · ${path.relative(process.cwd(), path.join(OUT, "05-drill.png"))}`);

    log("\n✔ screenshots written to perf-scraper/output/shots/");
  } catch (err) {
    console.error("\n[shoot-dashboard] " + (err && err.message ? err.message : err));
    await page.screenshot({ path: path.join(OUT, "error.png"), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
  }
}

main();
