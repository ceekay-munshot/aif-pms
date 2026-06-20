/**
 * scrape-pmsbazaar.mjs — PMS Bazaar AIF scheme performance scraper (LOGIN-GATED)
 * Fund Screener — MGA · step 3 of 12 · data source 2 of 2
 *
 * Logs in to PMS Bazaar and pulls AIF scheme performance, writing RAW output to
 *   perf-scraper/output/pmsbazaar-aif.json   (gitignored)
 * Normalising into the committed store / deriving alpha is step 4. Keep RAW.
 *
 * Source: https://pmsbazaar.com/Visitor/aif-investment (+ authenticated AIF
 * performance pages after login).
 *
 * Credentials: env PMSBAZAAR_EMAIL / PMSBAZAAR_PASSWORD (GitHub repo secrets).
 * Never hardcode or commit them.
 *
 * Tech: Node ESM, Playwright (chromium) + cheerio. Reuses the proven pure
 * parsing helpers from scrape-apmi.mjs (importing does NOT run its main()).
 *
 * Discovery-first (this won big on APMI): capture the underlying XHR/JSON
 * endpoint the AIF listing calls — far more robust than DOM scraping. Falls back
 * to cheerio table parsing. Always saves output/pmsbazaar-page.png + a sample;
 * fails fast with no junk if data/login can't be located.
 *
 * Env knobs:
 *   LIMIT=<n>   cap schemes (quick tests); 0 = all (default 0)
 *   HEADFUL=1   launch a visible browser to watch
 *   DEBUG=1     verbose: login steps, endpoints, headers
 *   EXPLORE=1   recon only: log login flow + endpoints/structure, write no data
 *
 * Environment note: the dev sandbox's egress allowlist blocks pmsbazaar.com — run
 * live on a GitHub runner (see .github/workflows/test-pmsbazaar.yml).
 */

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Reuse the APMI scraper's pure, unit-tested helpers (its main() is guarded).
import {
  parseNum,
  parseDate,
  parseMonthFromText,
  matchPeriod,
  extractApproachesFromHtml,
} from './scrape-apmi.mjs';

const SOURCE = 'PMS Bazaar';
const SITE = 'https://pmsbazaar.com';
const AIF_URL = 'https://pmsbazaar.com/Visitor/aif-investment';
// Candidate login entry points (the real one is confirmed by the recon run).
const LOGIN_URLS = [
  'https://pmsbazaar.com/login',
  'https://pmsbazaar.com/Visitor/login',
  'https://pmsbazaar.com/signin',
  AIF_URL,
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const OUT_JSON = path.join(OUT_DIR, 'pmsbazaar-aif.json');
const OUT_PNG = path.join(OUT_DIR, 'pmsbazaar-page.png');

const PERIODS = ['m1', 'm3', 'm6', 'y1', 'y2', 'y3', 'y5', 'si'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const env = process.env;
const LIMIT = parseInt(env.LIMIT || '0', 10) || 0;
const HEADFUL = /^(1|true|yes|on)$/i.test(env.HEADFUL || '');
const DEBUG = /^(1|true|yes|on)$/i.test(env.DEBUG || '');
const EXPLORE = /^(1|true|yes|on)$/i.test(env.EXPLORE || '');
const EMAIL = (env.PMSBAZAAR_EMAIL || '').trim();
const PASSWORD = env.PMSBAZAAR_PASSWORD || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const dbg = (...a) => DEBUG && console.log('[debug]', ...a);
const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
const emptyLadder = () => Object.fromEntries(PERIODS.map((p) => [p, null]));
const settle = async (page, ms = 1200) => {
  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await sleep(ms);
};

// ───────────────────────────── login ────────────────────────────────────────

/** Click a cookie/consent banner if present (best-effort). */
async function dismissConsent(page) {
  for (const name of ['Accept', 'Accept All', 'I Agree', 'Agree', 'Got it', 'Allow all', 'OK']) {
    try {
      const loc = page.getByRole('button', { name: new RegExp(`^\\s*${name}\\s*$`, 'i') }).first();
      if (await loc.count()) {
        await loc.click({ timeout: 2000 });
        dbg('dismissed consent:', name);
        await sleep(400);
        return;
      }
    } catch {
      /* ignore */
    }
  }
}

/** Detect an anti-bot interstitial (Cloudflare etc.). */
async function looksLikeChallenge(page) {
  const t = (await page.title().catch(() => '')) || '';
  if (/just a moment|attention required|checking your browser/i.test(t)) return true;
  const body = (await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '').catch(() => '')) || '';
  return /verify you are human|checking your browser|cf-browser-verification/i.test(body);
}

/** Ensure a login form (password field) is visible, navigating / opening modals as needed. */
async function ensureLoginForm(page) {
  const hasPw = () => page.locator('input[type="password"]').count();
  if (await hasPw()) return true;
  for (const url of LOGIN_URLS) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await dismissConsent(page);
      if (await hasPw()) {
        dbg('login form found at', url);
        return true;
      }
    } catch (e) {
      dbg('login url failed', url, e.message);
    }
  }
  // Try a login trigger (button/link) on the site/AIF page.
  for (const base of [AIF_URL, SITE]) {
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await dismissConsent(page);
    } catch {
      /* ignore */
    }
    for (const t of ['Login', 'Log In', 'Sign In', 'Sign in', 'Member Login', 'Login / Register']) {
      try {
        const loc = page
          .getByRole('link', { name: new RegExp(t, 'i') })
          .or(page.getByRole('button', { name: new RegExp(t, 'i') }))
          .first();
        if (await loc.count()) {
          await loc.click({ timeout: 3000 });
          await settle(page, 800);
          if (await hasPw()) {
            dbg('login form opened via trigger:', t);
            return true;
          }
        }
      } catch {
        /* try next */
      }
    }
  }
  return (await hasPw()) > 0;
}

/** Verify we are authenticated. Returns a short reason string, or null if not. */
async function verifyLoggedIn(page) {
  await sleep(1200);
  const hasPw = await page.locator('input[type="password"]').count().catch(() => 0);
  const logout = await page
    .locator('a:has-text("Logout"), a:has-text("Log Out"), a:has-text("Sign Out"), [href*="logout" i], [href*="signout" i]')
    .count()
    .catch(() => 0);
  const account = await page
    .locator('[href*="account" i], [href*="profile" i], [href*="dashboard" i], [class*="avatar" i]')
    .count()
    .catch(() => 0);
  if (logout > 0) return 'logout link present';
  if (hasPw === 0 && account > 0) return 'account/dashboard element present, no password field';
  if (hasPw === 0 && !/login|signin/i.test(page.url())) return `no password field; url=${page.url()}`;
  return null;
}

async function loginViaBrowser(page) {
  if (!EMAIL || !PASSWORD)
    throw new Error('Missing PMSBAZAAR_EMAIL / PMSBAZAAR_PASSWORD env (set them as repo secrets).');

  const found = await ensureLoginForm(page);
  if (await looksLikeChallenge(page))
    log('! Anti-bot interstitial detected — login may be blocked on this runner.');
  if (!found) throw new Error('Could not locate a login form (no password field). See screenshot.');

  const emailSel =
    'input[type="email"], input[name*="email" i], input[id*="email" i], ' +
    'input[name*="user" i], input[id*="user" i], input[name*="mobile" i], input[autocomplete="username"]';
  const passSel = 'input[type="password"]';

  const emailField = page.locator(emailSel).first();
  if (await emailField.count()) await emailField.fill(EMAIL);
  else dbg('! no email/username field matched');
  await page.locator(passSel).first().fill(PASSWORD);
  dbg('filled credentials; submitting…');

  const submit = page
    .getByRole('button', { name: /log\s*in|sign\s*in|^login$|^submit$|continue/i })
    .first();
  if (await submit.count()) await submit.click({ timeout: 5000 }).catch(() => {});
  else await page.locator(passSel).first().press('Enter');
  await settle(page, 2000);

  const ok = await verifyLoggedIn(page);
  if (!ok) {
    const errText = await page
      .locator('.error, .alert, .help-block, [class*="error" i], [class*="invalid" i]')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      'Login failed' +
        (errText ? `: "${clean(errText).slice(0, 160)}"` : '') +
        `. url=${page.url()} — check credentials / see screenshot.`
    );
  }
  log(`Logged in ✓ (${ok})`);
}

// ─────────────────────── JSON endpoint discovery + mapping ───────────────────

/** Recursively find the largest array-of-objects inside a parsed JSON value. */
function findLargestObjectArray(node, depth = 0) {
  if (depth > 6 || node == null) return null;
  let best = null;
  const consider = (arr) => {
    if (Array.isArray(arr) && arr.length && arr.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      if (!best || arr.length > best.length) best = arr;
    }
  };
  if (Array.isArray(node)) {
    consider(node);
    for (const v of node) {
      const sub = findLargestObjectArray(v, depth + 1);
      if (sub && (!best || sub.length > best.length)) best = sub;
    }
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) {
      const sub = findLargestObjectArray(v, depth + 1);
      if (sub && (!best || sub.length > best.length)) best = sub;
    }
  }
  return best;
}

/** Map a JSON key to a return-ladder period (handles numeric + word forms). */
function periodFromKey(key) {
  const k = String(key).toLowerCase();
  const p = matchPeriod(k.replace(/[_\-]/g, ' '));
  if (p) return p;
  if (/\bsi\b|inception|incep/.test(k)) return 'si';
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const wm = k.match(/(one|two|three|four|five|six)\s*(month|mon|mth|year|yr)/);
  if (wm) {
    const n = words[wm[1]];
    return /mon|mth/.test(wm[2]) ? `m${n}` : `y${n}`;
  }
  return null;
}

const findKey = (obj, re) => Object.keys(obj).find((k) => re.test(k));

/** Best-effort generic mapping of a JSON scheme row → AIF record (refined post-recon). */
function mapJsonRow(row) {
  const rec = blankScheme();
  const mgrK = findKey(row, /amc|manager|house|sponsor|company|fundmanager/i);
  const nameK = findKey(row, /scheme|fundname|productname|approach|strateg(y| name)|^name$|aifname|^fund$/i);
  const catK = findKey(row, /category|catg|^cat$|aifcategory/i);
  const stratK = findKey(row, /strategy|style|substrateg/i);
  const aumK = findKey(row, /aum|asset/i);
  const benchK = findKey(row, /benchmark|indexname|bmname/i);
  const incK = findKey(row, /inception|launch|startdate|sinceinception(date)?/i);
  if (mgrK) rec.manager = clean(row[mgrK]) || null;
  if (nameK) rec.approach = clean(row[nameK]) || null;
  if (catK) rec.aif_category = clean(row[catK]) || null;
  if (stratK && stratK !== catK) rec.strategy = clean(row[stratK]) || null;
  if (aumK) rec.aum_cr = parseNum(row[aumK]);
  if (benchK) rec.benchmark = clean(row[benchK]) || null;
  if (incK) rec.inception = parseDate(row[incK]);
  for (const [k, v] of Object.entries(row)) {
    const isBench = /bench|bm|index/i.test(k);
    const p = periodFromKey(k);
    if (!p) continue;
    if (isBench) rec.benchmark_returns[p] = parseNum(v);
    else if (rec.returns[p] == null) rec.returns[p] = parseNum(v);
  }
  return rec;
}

function blankScheme() {
  return {
    manager: null,
    approach: null,
    vehicle: 'AIF',
    aif_category: null,
    strategy: null,
    aum_cr: null,
    benchmark: null,
    inception: null,
    returns: emptyLadder(),
    benchmark_returns: emptyLadder(),
    as_of: null,
  };
}

/** Adapt a generic table-extracted approach → AIF scheme record. */
function approachToScheme(a) {
  const rec = blankScheme();
  rec.manager = a.manager ?? null;
  rec.approach = a.approach ?? null;
  rec.aif_category = a.category ?? null; // step 4 splits cat-type vs strategy
  rec.aum_cr = a.aum_cr ?? null;
  rec.benchmark = a.benchmark ?? null;
  rec.inception = a.inception ?? null;
  if (a.returns) for (const p of PERIODS) rec.returns[p] = a.returns[p] ?? null;
  if (a.benchmark_returns) for (const p of PERIODS) rec.benchmark_returns[p] = a.benchmark_returns[p] ?? null;
  return rec;
}

const hasAnyReturn = (rec) =>
  PERIODS.some((p) => rec.returns[p] != null) || PERIODS.some((p) => rec.benchmark_returns[p] != null);

// ───────────────────────────── recon (EXPLORE) ──────────────────────────────

async function exploreSite(page, apiHits) {
  log('\n=== EXPLORE: post-login AIF page recon ===');
  try {
    await page.goto(AIF_URL, { waitUntil: 'domcontentloaded' });
    await settle(page, 2000);
  } catch (e) {
    log('  goto AIF_URL failed:', e.message);
  }
  log('  url   :', page.url());
  log('  title :', await page.title().catch(() => ''));

  const tables = await page.locator('table').count().catch(() => 0);
  log('  tables on page:', tables);
  const best = extractApproachesFromHtml(await page.content(), { debug: DEBUG });
  if (best) {
    log('  best table headers:', JSON.stringify(best.combined));
    log('  best table rows   :', best.approaches.length);
  }
  const sels = await page
    .locator('select')
    .evaluateAll((els) =>
      els.map((el) => ({ id: el.name || el.id || el.className, n: el.options.length })).slice(0, 20)
    )
    .catch(() => []);
  log('  selects:', JSON.stringify(sels));
  const tabs = await page
    .locator('a, button')
    .evaluateAll((els) =>
      els
        .map((e) => clean(e.textContent))
        .filter((t) => /return|performance|aif|categor|long|short|nav/i.test(t))
        .slice(0, 25)
    )
    .catch(() => []);
  log('  perf/returns-ish controls:', JSON.stringify(tabs));

  // Give late XHRs a moment, then report endpoints.
  await sleep(2500);
  reportApiHits(apiHits);
  log('=== EXPLORE complete (no data written) ===');
}

function reportApiHits(apiHits) {
  if (!apiHits.length) {
    log('  (no JSON XHR endpoints captured)');
    return;
  }
  log(`  captured ${apiHits.length} JSON endpoint(s):`);
  for (const h of apiHits) {
    log(`   · ${h.method} ${h.url}`);
    log(`       rows=${h.count} keys=${JSON.stringify(h.keys)}`);
    if (DEBUG) log(`       sample=${h.sample}`);
  }
}

// ───────────────────────────── main ─────────────────────────────────────────

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  log(`PMS Bazaar AIF scraper · ${AIF_URL}`);
  log(`Knobs: LIMIT=${LIMIT || 'all'} HEADFUL=${HEADFUL} DEBUG=${DEBUG} EXPLORE=${EXPLORE} · creds=${EMAIL ? 'set' : 'MISSING'}`);

  const browser = await chromium.launch({
    headless: !HEADFUL,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  // Capture JSON XHR/fetch responses (the likely AIF data source).
  const apiHits = [];
  context.on('response', async (resp) => {
    try {
      const req = resp.request();
      if (!['xhr', 'fetch'].includes(req.resourceType())) return;
      const url = resp.url();
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (!/json/.test(ct) && !/\.json(\?|$)/.test(url)) return;
      const text = await resp.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        return;
      }
      const arr = findLargestObjectArray(json);
      apiHits.push({
        url,
        method: req.method(),
        postData: req.postData() || null,
        count: arr ? arr.length : 0,
        keys: arr && arr[0] ? Object.keys(arr[0]).slice(0, 40) : [],
        sample: text.slice(0, 300).replace(/\s+/g, ' '),
        _arr: arr,
      });
      if (EXPLORE) log(`[net←json] ${req.method()} ${url} rows=${arr ? arr.length : 0}`);
    } catch {
      /* ignore */
    }
  });

  let screenshotSaved = false;
  const saveShot = async () => {
    try {
      await page.screenshot({ path: OUT_PNG, fullPage: true });
      screenshotSaved = true;
      log(`Saved screenshot → ${path.relative(process.cwd(), OUT_PNG)}`);
    } catch (e) {
      dbg('screenshot failed:', e.message);
    }
  };

  try {
    await loginViaBrowser(page);

    if (EXPLORE) {
      await exploreSite(page, apiHits);
      await saveShot();
      return;
    }

    // Navigate to the AIF listing and let it fetch its data.
    await page.goto(AIF_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await settle(page, 2500);
    await saveShot();

    const as_of_month = scanAsOf(await page.content());

    // Prefer a JSON endpoint (largest scheme-like array); fall back to table parse.
    let schemes = [];
    const apiCandidate = apiHits
      .filter((h) => h.count >= 3)
      .sort((a, b) => b.count - a.count)[0];
    if (apiCandidate && apiCandidate._arr) {
      log(`Using JSON endpoint: ${apiCandidate.url} (${apiCandidate.count} rows)`);
      schemes = apiCandidate._arr.map(mapJsonRow).filter((r) => r.manager || r.approach);
    }
    if (!schemes.length) {
      dbg('no usable JSON endpoint; trying table parse');
      const best = extractApproachesFromHtml(await page.content(), { debug: DEBUG });
      if (best) {
        if (DEBUG) log('table headers:', JSON.stringify(best.combined));
        schemes = best.approaches.map(approachToScheme);
      }
    }
    schemes = schemes.filter((r) => (r.manager || r.approach) && hasAnyReturn(r));
    for (const s of schemes) s.as_of = s.as_of || (as_of_month ? `${as_of_month}` : null);

    if (!schemes.length) {
      reportApiHits(apiHits);
      throw new Error(
        'FAILED to locate AIF scheme data after login.\n' +
          `  · Inspect the screenshot: ${path.relative(process.cwd(), OUT_PNG)}\n` +
          `  · url=${page.url()}\n` +
          '  · Re-run with EXPLORE=1 to dump endpoints/headers, then wire up the mapping.'
      );
    }

    if (LIMIT > 0 && schemes.length > LIMIT) {
      log(`Applying LIMIT=${LIMIT} (of ${schemes.length}).`);
      schemes = schemes.slice(0, LIMIT);
    }

    const out = {
      generated_at: new Date().toISOString(),
      source: SOURCE,
      source_url: AIF_URL,
      as_of_month: as_of_month || null,
      count: schemes.length,
      schemes,
    };
    await writeFile(OUT_JSON, JSON.stringify(out, null, 2) + '\n');

    // Summary.
    const houses = new Set(schemes.map((s) => s.manager).filter(Boolean));
    const cats = new Set(schemes.map((s) => s.aif_category).filter(Boolean));
    const withY1 = schemes.filter((s) => s.returns.y1 != null).length;
    const withY3 = schemes.filter((s) => s.returns.y3 != null).length;
    const withBench = schemes.filter((s) => PERIODS.some((p) => s.benchmark_returns[p] != null)).length;
    log('\n──────── PMS Bazaar AIF scrape summary ────────');
    log(`  as_of_month     : ${out.as_of_month}`);
    log(`  schemes         : ${schemes.length}`);
    log(`  AIF houses      : ${houses.size}`);
    log(`  categories seen : ${[...cats].slice(0, 12).join(' | ') || '(none)'}`);
    log(`  with y1 / y3    : ${withY1} / ${withY3}`);
    log(`  with benchmark_returns : ${withBench}`);
    log(`  output          : ${path.relative(process.cwd(), OUT_JSON)}`);
    log('  first 3 entries :');
    log(JSON.stringify(schemes.slice(0, 3), null, 2));
    log('───────────────────────────────────────────────');
  } catch (err) {
    if (!screenshotSaved) await saveShot();
    if (EXPLORE) reportApiHits(apiHits);
    console.error('\n[scrape-pmsbazaar] ' + (err && err.message ? err.message : err));
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/** Find an "as on <date>" month on the page, else null. */
function scanAsOf(html) {
  const $ = cheerio.load(html);
  const text = clean($('body').text());
  const m = text.match(/as\s+(?:on|of|at)\s*:?\s*([^\n,;|]{4,28})/i);
  if (m) {
    const ym = parseMonthFromText(m[1]);
    if (ym) return ym;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
