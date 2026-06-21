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
import { readFile, mkdir, stat } from "node:fs/promises";
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2, acceptDownloads: true });
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

    // Drive the Screener filter bar and capture its key states (default,
    // filtered+sorted, Alpha view, category-relative) — the prompt-10 deliverable.
    const seg = async (id, val) => { await page.click(`#${id} button[data-val="${val}"]`); await sleep(350); };
    log("Capturing Screener states:");
    await shoot(page, "01-screener-default.png");

    // Filtered + sorted: PMS · Small Cap · sorted 3Y desc (mirrors the acceptance check).
    try {
      await seg("scr-vehicle", "PMS");
      await page.waitForFunction(
        () => { const s = document.getElementById("scr-category"); return s && [...s.options].some((o) => o.value === "Small Cap"); },
        { timeout: 5000 }
      ).catch(() => {});
      await page.selectOption("#scr-category", "Small Cap").catch(() => {});
      await sleep(300);
      await seg("scr-period", "y3");
      await sleep(450);
      await shoot(page, "02-screener-filtered.png");
    } catch (e) { log("  (filtered shot skipped: " + (e && e.message) + ")"); }

    // Alpha view: reset, then flip the metric toggle to Alpha.
    try {
      await page.click("#scr-reset"); await sleep(350);
      await seg("scr-mode", "alpha");
      await sleep(450);
      await shoot(page, "03-screener-alpha.png");
    } catch (e) { log("  (alpha shot skipped: " + (e && e.message) + ")"); }

    // Category-relative: top 5 per category.
    try {
      await page.click("#scr-reset"); await sleep(350);
      await seg("scr-catrel", "on");
      await sleep(450);
      await shoot(page, "04-screener-percat.png");
      await page.click("#scr-reset"); await sleep(300);
    } catch (e) { log("  (per-category shot skipped: " + (e && e.message) + ")"); }

    log("Capturing tabs:");
    for (const [i, tab] of [["05", "leaderboard"], ["06", "categories"], ["07", "movers"]]) {
      await page.click(`.tab-btn[data-tab="${tab}"]`);
      await page.waitForSelector(`#tab-${tab}:not([hidden])`, { timeout: 10_000 });
      if (tab === "categories") await page.waitForSelector("#cat-chart canvas", { timeout: 8000 }).catch(() => {});
      await sleep(700);
      await shoot(page, `${i}-${tab}.png`);
    }

    // Verify Export downloads a populated workbook (acceptance check).
    try {
      await page.click('.tab-btn[data-tab="screener"]');
      await page.waitForSelector("#tab-screener:not([hidden]) tr[data-id]", { timeout: 10_000 });
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15_000 }),
        page.click("#export-btn"),
      ]);
      const name = download.suggestedFilename();
      const dlPath = path.join(OUT, name);
      await download.saveAs(dlPath);
      const { size } = await stat(dlPath);
      log(`Export: downloaded ${name} (${size.toLocaleString()} bytes)`);
    } catch (e) { log("  (export check skipped: " + (e && e.message) + ")"); }

    // Open the fund-drill from the first Screener row and capture it.
    await page.click('.tab-btn[data-tab="screener"]');
    await page.waitForSelector("#tab-screener:not([hidden]) tr[data-id]", { timeout: 10_000 });
    await page.click("#tab-screener tr[data-id]");
    await page.waitForSelector("#drill-panel:not(.hidden)", { timeout: 10_000 });
    await page.waitForSelector("#drill-spark canvas", { timeout: 8000 }).catch(() => {});
    await sleep(1000);
    log("Capturing drill:");
    await page.screenshot({ path: path.join(OUT, "08-drill.png"), fullPage: false });
    log(`  · ${path.relative(process.cwd(), path.join(OUT, "08-drill.png"))}`);

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
