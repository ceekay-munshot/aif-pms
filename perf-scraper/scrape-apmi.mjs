/**
 * scrape-apmi.mjs — APMI PMS investment-approach performance scraper (PUBLIC, NO login)
 * Fund Screener — MGA · step 2 of 12 · data source 1 of 2
 *
 * Pulls SEBI-mandated "Investment Approach" performance disclosure from APMI:
 * per portfolio manager → per investment approach, with trailing returns +
 * benchmark + AUM, reported at month-end. Writes RAW output to
 *   perf-scraper/output/apmi-pms.json
 * This step does NOT normalise into the committed store, classify categories, or
 * derive alpha — that is the normalise step (prompt 4). Keep this output RAW.
 *
 * Source: https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu
 *
 * NOTE on the numbers: APMI reports returns as ABSOLUTE for periods <= 1Y and
 * ANNUALISED (CAGR) for periods > 1Y. We just store the numbers as published;
 * the normalise step handles labelling. Returns are percent (e.g. 18.4 = 18.4%).
 *
 * Tech: Node ESM, Playwright (chromium) + cheerio. Install deps --no-save:
 *   npm install playwright@1 cheerio@1 --no-save
 *   npx playwright install chromium
 *   node perf-scraper/scrape-apmi.mjs
 *
 * Discovery-first & defensive: the exact DOM is not assumed. We (a) watch the
 * network for a JSON/XHR dataset or an Excel/CSV download (preferred, far more
 * reliable), and (b) fall back to parsing the rendered table with cheerio,
 * reconstructing colspan/rowspan headers and mapping columns heuristically.
 * Always saves a full-page screenshot + logs a first-row markup sample so
 * selectors can be confirmed. If no performance table can be located, it FAILS
 * with a clear message (never writes junk data).
 *
 * Env knobs:
 *   LIMIT=<n>     cap number of approaches (quick tests); 0 = all (default 0)
 *   MONTH=YYYY-MM override the reporting month (default: latest available)
 *   HEADFUL=1     launch a visible browser to watch
 *   DEBUG=1       log discovered table headers + pagination candidates + endpoints
 *
 * Environment note (Claude Code on the web sandbox): outbound egress is
 * allowlisted. To run against the live site, `www.apmiindia.org` must be added
 * to the environment's network egress allowlist; otherwise navigation returns a
 * 403 block page and the scraper fails cleanly (by design).
 */

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCE = 'APMI';
const SOURCE_URL =
  'https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const OUT_JSON = path.join(OUT_DIR, 'apmi-pms.json');
const OUT_PNG = path.join(OUT_DIR, 'apmi-page.png');

const PERIODS = ['m1', 'm3', 'm6', 'y1', 'y2', 'y3', 'y5', 'si'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const env = process.env;
const LIMIT = parseInt(env.LIMIT || '0', 10) || 0;
const MONTH = (env.MONTH || '').trim();
const HEADFUL = !!env.HEADFUL && env.HEADFUL !== '0';
const DEBUG = !!env.DEBUG && env.DEBUG !== '0';
const EXPLORE = /^(1|true|yes|on)$/i.test(env.EXPLORE || '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const dbg = (...a) => DEBUG && console.log('[debug]', ...a);
const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
const emptyLadder = () => Object.fromEntries(PERIODS.map((p) => [p, null]));

// ───────────────────────────── parsing helpers (pure, exported) ──────────────

/** Defensive number parse: strip %/commas/₹/spaces; '-','NA','NM','nil' → null. */
export function parseNum(raw) {
  if (raw == null) return null;
  let s = clean(raw);
  if (!s) return null;
  if (/^(-+|–|—|n\.?\s*a\.?|na|nm|nil|n\/a|--+|\.\.+|\*+)$/i.test(s)) return null;
  s = s.replace(/[₹%,\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
  // handle trailing/leading stray chars; keep sign, digits, dot
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse a date cell into YYYY-MM-DD when confident; else keep raw string; else null. */
export function parseDate(raw) {
  const s = clean(raw);
  if (!s || /^(-+|n\.?\s*a\.?|na|n\/a)$/i.test(s)) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)))
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)))
    return `${m[3]}-${pad(m[2])}-${pad(m[1])}`; // DD-MM-YYYY (Indian convention)
  if ((m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/](\d{4})$/))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(m[1])}`;
  }
  if ((m = s.match(/^([A-Za-z]{3,})[-\s/](\d{1,2})[,]?[-\s/](\d{4})$/))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(m[2])}`;
  }
  return s; // unrecognised but non-empty: keep raw, normalise step can clean
}

const pad = (n) => String(n).padStart(2, '0');

/** Parse "as on" / month text into YYYY-MM, else null. */
export function parseMonthFromText(raw) {
  const s = clean(raw);
  if (!s) return null;
  let m;
  if ((m = s.match(/(\d{4})[-/](\d{1,2})\b/))) return `${m[1]}-${pad(m[2])}`;
  if ((m = s.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/)))
    return `${m[3]}-${pad(m[2])}`; // DD-MM-YYYY
  if ((m = s.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/](\d{4})\b/))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}`;
  }
  if ((m = s.match(/\b([A-Za-z]{3,})[-\s,/]+(\d{4})\b/))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[2]}-${pad(mo)}`;
  }
  return null;
}

/** Map a column header string to a return-ladder period key, else null. */
export function matchPeriod(hl) {
  const h = ' ' + hl.replace(/\s+/g, ' ').trim() + ' ';
  // Month units allow plurals/abbrevs (month/months/mth/mths/mo/mos/m); the
  // leading (?:^|[^0-9]) guards against "12" matching "1"/"2", and \b after the
  // unit keeps a bare "m" from matching inside other words.
  const mo = (n) => new RegExp(`(?:^|[^0-9])${n}\\s*(?:months?|mths?|mos?|m)\\b`, 'i');
  const yr = (n) => new RegExp(`(?:^|[^0-9])${n}\\s*(?:years?|yrs?|y)\\b`, 'i');
  if (mo(1).test(h)) return 'm1';
  if (mo(3).test(h)) return 'm3';
  if (mo(6).test(h)) return 'm6';
  if (yr(1).test(h)) return 'y1';
  if (yr(2).test(h)) return 'y2';
  if (yr(3).test(h)) return 'y3';
  if (yr(5).test(h)) return 'y5';
  if (/since\s*inception|(?:^|[^a-z])si(?:[^a-z]|$)|incep/i.test(h)) return 'si';
  return null;
}

/**
 * Classify a (combined) column header into a record field or a ladder period.
 * Returns one of:
 *   { field: 'manager'|'approach'|'category'|'benchmark'|'aum'|'inception' }
 *   { ladder: 'returns'|'benchmark', period: 'm1'..'si' }
 *   null
 */
export function classifyColumn(header) {
  const hl = clean(header).toLowerCase();
  if (!hl) return null;

  // Inception DATE column (distinct from the since-inception RETURN column).
  if (/incep/.test(hl) && /date/.test(hl)) return { field: 'inception' };

  const isBench = /bench\s*mark|\bbench\b|\bbm\b/.test(hl);
  const period = matchPeriod(hl);
  if (period) return { ladder: isBench ? 'benchmark' : 'returns', period };

  // Benchmark NAME column (has "benchmark" but no period and not a return).
  if (isBench) return { field: 'benchmark' };

  if (/aum|assets?\s*under|corpus|asset\s*under/.test(hl)) return { field: 'aum' };
  if (/incep/.test(hl)) return { field: 'inception' };
  // "IA" / "IA Name" is APMI's label for the investment approach.
  if (/invest(ment)?\s*approach|approach\s*name|name\s*of\s*(the\s*)?(invest(ment)?\s*)?approach|scheme\s*name|strategy\s*name|\bia\s*name\b|\bia\b/.test(hl))
    return { field: 'approach' };
  if (/portfolio\s*manager|fund\s*manager|name\s*of\s*(the\s*)?(portfolio\s*)?manager|manager\s*name|provider\s*name|\bamc\b|\bpms\b/.test(hl))
    return { field: 'manager' };
  if (/category|asset\s*class|sub[-\s]*category|strategy/.test(hl))
    return { field: 'category' };
  return null;
}

/** Expand a set of <tr> rows into a rectangular matrix, honouring colspan/rowspan. */
function expandRows($, trs) {
  const width = Math.max(
    1,
    ...trs.map((tr) =>
      $(tr)
        .children('td,th')
        .toArray()
        .reduce((s, c) => s + (parseInt($(c).attr('colspan'), 10) || 1), 0)
    )
  );
  const grid = [];
  const carry = {}; // colIndex -> { text, remaining }
  for (const tr of trs) {
    const cells = $(tr).children('td,th').toArray();
    const row = new Array(width).fill(null);
    let ci = 0;
    let c = 0;
    while (c < width) {
      if (carry[c] && carry[c].remaining > 0) {
        row[c] = carry[c].text;
        carry[c].remaining--;
        c++;
        continue;
      }
      if (ci >= cells.length) {
        c++;
        continue;
      }
      const $cell = $(cells[ci++]);
      const text = clean($cell.text());
      const colspan = Math.max(1, parseInt($cell.attr('colspan'), 10) || 1);
      const rowspan = Math.max(1, parseInt($cell.attr('rowspan'), 10) || 1);
      for (let k = 0; k < colspan && c < width; k++, c++) {
        row[c] = text;
        if (rowspan > 1) carry[c] = { text, remaining: rowspan - 1 };
      }
    }
    grid.push(row);
  }
  return { grid, width };
}

/** Parse a single <table> element into a scored result with extracted approaches. */
function parseTable($, table) {
  const $t = $(table);
  let headerTrs = $t.find('thead tr').toArray();
  let bodyTrs = $t.find('tbody tr').toArray();

  if (!headerTrs.length || !bodyTrs.length) {
    // No thead/tbody split: treat leading all-<th> rows as header.
    const all = $t.find('tr').toArray();
    headerTrs = [];
    bodyTrs = [];
    let inHeader = true;
    for (const tr of all) {
      const cells = $(tr).children('td,th');
      const allTh = cells.length > 0 && $(tr).children('td').length === 0;
      if (inHeader && allTh) headerTrs.push(tr);
      else {
        inHeader = false;
        bodyTrs.push(tr);
      }
    }
    if (!headerTrs.length && all.length) headerTrs = [all[0]];
    if (!bodyTrs.length && all.length > 1) bodyTrs = all.slice(1);
  }
  if (!headerTrs.length || !bodyTrs.length) return null;

  const head = expandRows($, headerTrs);
  const body = expandRows($, bodyTrs);
  const width = Math.max(head.width, body.width);

  // Combined header per column = all header-row texts for that column joined.
  const combined = [];
  for (let c = 0; c < width; c++) {
    const parts = [];
    for (const r of head.grid) if (r[c]) parts.push(r[c]);
    combined[c] = [...new Set(parts)].join(' ');
  }

  // Column map.
  const colMap = combined.map(classifyColumn);
  const periodCols = colMap.filter((x) => x && x.period).length;
  const hasManagerOrApproach = colMap.some(
    (x) => x && (x.field === 'manager' || x.field === 'approach')
  );

  // Extract rows.
  const approaches = [];
  let lastManager = null;
  for (const row of body.grid) {
    const rec = {
      manager: null,
      approach: null,
      vehicle: 'PMS',
      category: null,
      benchmark: null,
      aum_cr: null,
      inception: null,
      returns: emptyLadder(),
      benchmark_returns: emptyLadder(),
    };
    for (let c = 0; c < width; c++) {
      const cls = colMap[c];
      if (!cls) continue;
      const val = row[c];
      if (cls.field === 'manager' && clean(val)) rec.manager = clean(val);
      else if (cls.field === 'approach' && clean(val)) rec.approach = clean(val);
      else if (cls.field === 'category') rec.category = clean(val) || null;
      else if (cls.field === 'benchmark') rec.benchmark = clean(val) || null;
      else if (cls.field === 'aum') rec.aum_cr = parseNum(val);
      else if (cls.field === 'inception') rec.inception = parseDate(val);
      else if (cls.ladder)
        rec[cls.ladder === 'benchmark' ? 'benchmark_returns' : 'returns'][
          cls.period
        ] = parseNum(val);
    }
    // Forward-fill manager across approach rows where the cell was blank.
    if (rec.manager) lastManager = rec.manager;
    else if (lastManager) rec.manager = lastManager;

    const hasAnyReturn =
      PERIODS.some((p) => rec.returns[p] != null) ||
      PERIODS.some((p) => rec.benchmark_returns[p] != null);
    // Keep genuine data rows; drop sub-headers/totals/blank rows.
    if ((rec.approach || rec.manager) && (hasAnyReturn || rec.aum_cr != null))
      approaches.push(rec);
  }

  const score = periodCols * 100 + approaches.length;
  const sampleRowHtml = bodyTrs.length ? clean($.html(bodyTrs[0])).slice(0, 1200) : '';
  return {
    score,
    width,
    combined,
    colMap,
    periodCols,
    hasManagerOrApproach,
    approaches,
    sampleRowHtml,
    rowCount: bodyTrs.length,
  };
}

/** Pick the best performance table from a full HTML document and extract rows. */
export function extractApproachesFromHtml(html, { debug = false } = {}) {
  const $ = cheerio.load(html);
  const tables = $('table').toArray();
  let best = null;
  let idx = -1;
  tables.forEach((t, i) => {
    const parsed = parseTable($, t);
    if (!parsed) return;
    if (debug)
      console.log(
        `[debug] table#${i}: rows=${parsed.rowCount} periodCols=${parsed.periodCols} ` +
          `extracted=${parsed.approaches.length} score=${parsed.score}`
      );
    if (
      parsed.periodCols >= 1 &&
      parsed.hasManagerOrApproach &&
      parsed.approaches.length >= 1 &&
      (!best || parsed.score > best.score)
    ) {
      best = parsed;
      idx = i;
    }
  });
  if (best) best.tableIndex = idx;
  return best;
}

// ───────────────────────────── browser interaction ──────────────────────────

async function clickConsentIfPresent(page) {
  const labels = [
    'I Agree', 'I agree', 'Agree', 'Accept', 'Accept All', 'I Accept',
    'Proceed', 'Continue', 'OK', 'Ok', 'Got it', 'I Understand', 'Disclaimer',
  ];
  for (const label of labels) {
    try {
      const loc = page
        .getByRole('button', { name: new RegExp(`^\\s*${label}\\s*$`, 'i') })
        .first();
      if (await loc.count()) {
        await loc.click({ timeout: 2500 });
        dbg('clicked consent button:', label);
        await sleep(800);
        return true;
      }
    } catch {
      /* keep trying */
    }
  }
  // Generic anchor/input fallbacks.
  for (const sel of [
    'a:has-text("I Agree")', 'a:has-text("Agree")', 'a:has-text("Proceed")',
    'input[type="submit"][value*="gree" i]', 'button:has-text("Agree")',
  ]) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        await loc.click({ timeout: 2500 });
        dbg('clicked consent (fallback):', sel);
        await sleep(800);
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Find a date/month <select>, choose latest (or MONTH override). Returns YYYY-MM|null. */
async function selectReportingMonth(page) {
  const selects = await page.locator('select').all();
  for (const sel of selects) {
    let options;
    try {
      options = await sel.evaluate((el) =>
        Array.from(el.options).map((o) => ({ value: o.value, text: o.textContent }))
      );
    } catch {
      continue;
    }
    const parsed = options
      .map((o) => ({ ...o, ym: parseMonthFromText(o.text) || parseMonthFromText(o.value) }))
      .filter((o) => o.ym);
    if (parsed.length < 1) continue; // not a date select

    dbg('date select options:', parsed.map((o) => o.ym).join(', '));
    let pick = null;
    if (MONTH) pick = parsed.find((o) => o.ym === MONTH) || null;
    if (!pick) pick = parsed.slice().sort((a, b) => (a.ym < b.ym ? 1 : -1))[0]; // latest

    if (pick) {
      try {
        await sel.selectOption(pick.value);
        await sleep(1500); // allow AJAX reload
        log(`Selected reporting month: ${pick.ym} ("${clean(pick.text)}")`);
        return pick.ym;
      } catch (e) {
        dbg('selectOption failed:', e.message);
      }
    }
  }
  return null;
}

/** Fallback: derive the reporting month from "as on <date>" text on the page. */
async function scanAsOfMonth(page) {
  const txt = await page
    .evaluate(() => (document.body ? document.body.innerText : ''))
    .catch(() => '');
  if (!txt) return null;
  for (const m of txt.matchAll(/as\s+(?:on|of|at)\s*:?\s*([^\n,;|]{4,28})/gi)) {
    const ym = parseMonthFromText(m[1]);
    if (ym) return ym;
  }
  return null;
}

/** Maximise rows-per-page on a DataTables-style listing (prefer "All"). */
async function maximiseEntriesPerPage(page) {
  // Prefer the actual DataTables length menu; only then fall back to a heuristic
  // select (the loose heuristic once grabbed an unrelated select with a "580"
  // option, leaving the table on its default page size).
  let target = null;
  for (const sel of [
    '.dataTables_length select',
    'div[class*="length"] select',
    'select[name$="_length"]',
    'select[name*="length" i]',
    'select[id*="length" i]',
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      target = loc;
      break;
    }
  }
  if (!target) {
    const selects = await page.locator('select').all();
    for (const sel of selects) {
      const info = await sel
        .evaluate((el) => ({
          meta: (el.className + ' ' + (el.name || '') + ' ' + (el.id || '')).toLowerCase(),
          opts: Array.from(el.options).map((o) => `${o.value}|${(o.textContent || '').trim()}`),
        }))
        .catch(() => null);
      if (!info) continue;
      // A length menu is SHORT with numeric page-size values; this guard rejects
      // big filter dropdowns (e.g. APMI's 1,201-option IA-name select, whose
      // values are numeric IDs and whose labels include words like "All Weather").
      const numericVals = info.opts.filter((o) => /^-?\d+\|/.test(o)).length;
      const looks =
        info.opts.length <= 12 &&
        numericVals >= Math.max(2, info.opts.length - 1) &&
        (/length|per\s*page|page\s*size|entries|show/.test(info.meta) ||
          info.opts.some((o) => /\ball\b|^-1\|/i.test(o)));
      if (looks) {
        target = sel;
        break;
      }
    }
  }
  if (!target) {
    dbg('no entries-per-page select found');
    return false;
  }

  const opts = await target
    .evaluate((el) => Array.from(el.options).map((o) => ({ v: o.value, t: (o.textContent || '').trim() })))
    .catch(() => []);
  dbg('length-menu options:', JSON.stringify(opts));
  // DataTables "All" is the sentinel value "-1"; else text "All"; else largest numeric.
  const chosen =
    opts.find((o) => o.v === '-1') ||
    opts.find((o) => /^all$/i.test(o.t)) ||
    opts
      .map((o) => ({ ...o, n: parseInt(o.v, 10) }))
      .filter((o) => Number.isFinite(o.n))
      .sort((a, b) => b.n - a.n)[0] ||
    null;
  if (!chosen) return false;
  try {
    await target.selectOption(chosen.v);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await sleep(1200);
    dbg('set entries-per-page to', JSON.stringify(chosen));
    return true;
  } catch (e) {
    dbg('length select failed:', e.message);
    return false;
  }
}

/** Read the DataTables-style listing info text + tbody row count + total. */
async function readListingInfo(page) {
  return await page
    .evaluate(() => {
      const el = document.querySelector('.dataTables_info, [class*="_info"]');
      const txt = el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
      let total = null;
      if (txt) {
        const m = txt.match(/of\s+([\d,]+)\s+(?:entries|records)/i);
        if (m) total = parseInt(m[1].replace(/,/g, ''), 10);
      }
      return { txt, bodyRows: document.querySelectorAll('table tbody tr').length, total };
    })
    .catch(() => ({ txt: null, bodyRows: 0, total: null }));
}

/** Collect page HTML across pagination (server-side DataTables Next / numbered pages). */
async function collectPaginatedHtml(page) {
  const htmls = [];
  const MAX_PAGES = 800;

  if (DEBUG) {
    const cands = await page
      .evaluate(() => {
        const out = [];
        document.querySelectorAll('a,button,li').forEach((el) => {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const c = el.className || '';
          if (/next|prev|paginate|page/i.test(c) || /^(next|previous|»|›|‹|«)$/i.test(t))
            out.push(`<${el.tagName.toLowerCase()} class="${c}">${t.slice(0, 16)}`);
        });
        return out.slice(0, 15);
      })
      .catch(() => []);
    dbg('pagination candidates:', JSON.stringify(cands));
  }

  const parseShown = (txt) => {
    const m = txt && txt.match(/showing\s+[\d,]+\s+to\s+([\d,]+)\s+of\s+([\d,]+)/i);
    return m ? { to: +m[1].replace(/,/g, ''), of: +m[2].replace(/,/g, '') } : null;
  };

  for (let i = 0; i < MAX_PAGES; i++) {
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const info = await readListingInfo(page);
    htmls.push(await page.content());
    const shown = parseShown(info.txt);
    // Early-stop a capped test once enough rows have been seen.
    if (LIMIT > 0 && shown && shown.to >= LIMIT) break;
    // Stop on the last page.
    if (shown && shown.to >= shown.of) break;

    const next = await findEnabledNext(page);
    if (!next) break;
    const prevTxt = info.txt;
    try {
      await next.click({ timeout: 5000 });
    } catch {
      break;
    }
    // Server-side pagination is an AJAX round-trip: wait for the "Showing X to Y
    // of Z" text to actually change before capturing the next page (a fixed
    // 700ms sleep was too short and made it false-stop after page 1).
    if (prevTxt) {
      await page
        .waitForFunction(
          (prev) => {
            const el = document.querySelector('.dataTables_info, [class*="_info"]');
            return el && el.textContent.replace(/\s+/g, ' ').trim() !== prev;
          },
          prevTxt,
          { timeout: 12_000 }
        )
        .catch(() => {});
    } else {
      await sleep(1500);
    }
  }
  dbg('collected pages:', htmls.length);
  return htmls;
}

/** Return a locator for an enabled "Next" pagination control, or null. */
async function findEnabledNext(page) {
  for (const sel of [
    'a.paginate_button.next:not(.disabled)',
    '.dataTables_paginate a.next:not(.disabled)',
    '.dataTables_paginate .paginate_button.next:not(.disabled)',
    '.paginate_button.next:not(.disabled)',
    'li.next:not(.disabled) a',
    'li.paginate_button.next:not(.disabled) a',
    'a[rel="next"]',
    'a.next:not(.disabled)',
    'button[aria-label*="Next" i]:not([disabled])',
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      const cls = (await loc.getAttribute('class').catch(() => '')) || '';
      if (!/\bdisabled\b/.test(cls)) return loc;
    }
  }
  return null;
}

/** Merge approaches across pages, dedup on manager+approach. */
function mergeApproaches(lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const rec of list) {
      const key = `${(rec.manager || '').toLowerCase()}||${(rec.approach || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rec);
    }
  }
  return out;
}

// ───────────────────────── toggle exploration (EXPLORE=1) ───────────────────

/**
 * One-shot reconnaissance for the period (`tableFilter-select`) and benchmark
 * (`tableFilter-benchmark`) toggles: drive each option and dump how the table
 * mutates (headers / first row / listing total) so the real multi-period +
 * benchmark capture can be built from facts. Writes nothing. EXPLORE=1 only.
 * Pair with the broad request/response logger attached in main when EXPLORE.
 */
async function exploreToggles(page) {
  const dump = async (label) => {
    const best = extractApproachesFromHtml(await page.content(), { debug: false });
    const info = await readListingInfo(page);
    log(`\n=== STATE: ${label} ===`);
    log('  headers :', JSON.stringify(best ? best.combined : null));
    log('  colMap  :', JSON.stringify(best ? best.colMap : null));
    log('  listing :', JSON.stringify(info));
    log('  parsed0 :', JSON.stringify(best && best.approaches[0] ? best.approaches[0] : null));
    log('  rawRow0 :', best ? best.sampleRowHtml.slice(0, 600) : null);
  };

  await dump('baseline');

  for (const id of ['tableFilter-select', 'tableFilter-benchmark']) {
    const sel = page.locator(`#${id}, select[id*="${id}" i]`).first();
    if (!(await sel.count().catch(() => 0))) {
      log(`\n(no #${id} on page)`);
      continue;
    }
    const opts = await sel
      .evaluate((el) => Array.from(el.options).map((o) => ({ v: o.value, t: (o.textContent || '').trim() })))
      .catch(() => []);
    log(`\n#${id} options: ${JSON.stringify(opts)}`);
    for (const o of opts) {
      try {
        await sel.selectOption(o.v);
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        await sleep(1400);
        await dump(`${id}=${o.t}`);
      } catch (e) {
        log(`  select ${id}=${o.t} failed: ${e.message}`);
      }
    }
    // Reset to the first option before exploring the next toggle.
    if (opts[0]) await sel.selectOption(opts[0].v).catch(() => {});
    await sleep(800);
  }
}

// ───────────────────────────── main ─────────────────────────────────────────

function istPrevMonth() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  istNow.setDate(1);
  istNow.setMonth(istNow.getMonth() - 1);
  return `${istNow.getFullYear()}-${pad(istNow.getMonth() + 1)}`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  log(`APMI PMS scraper · ${SOURCE_URL}`);
  log(`Knobs: LIMIT=${LIMIT || 'all'} MONTH=${MONTH || 'latest'} HEADFUL=${HEADFUL} DEBUG=${DEBUG} EXPLORE=${EXPLORE}`);

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

  // EXPLORE: broad request/response logger to reveal the data endpoint + how the
  // period/benchmark toggles fire XHRs (which params change). Noisy → EXPLORE only.
  if (EXPLORE) {
    page.on('request', (req) => {
      if (['xhr', 'fetch'].includes(req.resourceType())) {
        const d = req.postData();
        log(`[net→] ${req.method()} ${req.url()}${d ? ' DATA=' + d.slice(0, 250) : ''}`);
      }
    });
    page.on('response', async (resp) => {
      const req = resp.request();
      if (!['xhr', 'fetch'].includes(req.resourceType())) return;
      const ct = (resp.headers()['content-type'] || '').replace(/\s+/g, ' ');
      let sample = '';
      try {
        sample = (await resp.text()).slice(0, 220).replace(/\s+/g, ' ');
      } catch {
        /* ignore */
      }
      log(`[net←] ${resp.status()} ${ct} ${resp.url()} :: ${sample}`);
    });
  }

  // Discovery: capture candidate JSON datasets + download links.
  const jsonEndpoints = [];
  context.on('response', async (resp) => {
    try {
      const url = resp.url();
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (!/json/.test(ct) && !/\.json(\?|$)/.test(url)) return;
      if (/welcomeiaperformance|apmi/i.test(url) === false && /apmiindia/i.test(url) === false)
        return;
      const text = await resp.text();
      jsonEndpoints.push({ url, length: text.length, sample: text.slice(0, 400) });
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
    let resp;
    try {
      resp = await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded' });
    } catch (navErr) {
      throw new Error(
        `Could not load APMI: ${navErr.message}\n` +
          '  · This is usually an egress/network block (TLS interception shows as ' +
          'ERR_CERT_AUTHORITY_INVALID; an allowlist proxy shows as HTTP 403).\n' +
          '  · If running in a Claude Code / CI sandbox, add `www.apmiindia.org` to the ' +
          'network egress allowlist, then re-run.'
      );
    }
    dbg('navigation status:', resp && resp.status());
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await clickConsentIfPresent(page);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    if (EXPLORE) {
      await page.waitForSelector('table', { timeout: 20_000 }).catch(() => {});
      await saveShot();
      await exploreToggles(page);
      log('\nEXPLORE complete — no output written (reconnaissance only).');
      return;
    }

    let asOf = await selectReportingMonth(page);
    await page.waitForSelector('table', { timeout: 20_000 }).catch(() => {});
    await maximiseEntriesPerPage(page);
    if (!asOf) {
      asOf = await scanAsOfMonth(page); // text-based "as on <date>" fallback
      if (asOf) log(`Reporting month (from page text): ${asOf}`);
    }
    await saveShot();

    // Discovery logging.
    if (jsonEndpoints.length) {
      log(`Discovered ${jsonEndpoints.length} JSON endpoint(s):`);
      for (const e of jsonEndpoints) log(`  · ${e.url} (${e.length}b)`);
      if (DEBUG) for (const e of jsonEndpoints) dbg('  sample:', e.sample);
    }
    if (DEBUG) {
      const dl = await page
        .locator('a[href$=".xlsx"], a[href$=".xls"], a[href$=".csv"], a:has-text("Download"), a:has-text("Export")')
        .evaluateAll((els) => els.map((a) => a.href || a.textContent).slice(0, 10))
        .catch(() => []);
      dbg('download/export candidates:', dl);
      const sels = await page
        .locator('select')
        .evaluateAll((els) =>
          els.map((el) => ({
            id: el.name || el.id || el.className,
            opts: Array.from(el.options).map((o) => (o.textContent || '').trim()).slice(0, 10),
          }))
        )
        .catch(() => []);
      dbg('selects on page:', JSON.stringify(sels));
      dbg('listing info:', JSON.stringify(await readListingInfo(page)));
    }

    // Parse the rendered table(s), walking pagination.
    const htmls = await collectPaginatedHtml(page);
    const perPage = htmls.map((h) => extractApproachesFromHtml(h, { debug: DEBUG }));
    const best = perPage.find(Boolean);

    if (DEBUG && best) {
      log('[debug] chosen table headers:', JSON.stringify(best.combined));
      log('[debug] column map:', JSON.stringify(best.colMap));
    }
    if (best && best.sampleRowHtml) {
      log('First data-row markup sample:');
      log('  ' + best.sampleRowHtml);
    }

    let approaches = mergeApproaches(perPage.filter(Boolean).map((p) => p.approaches));

    if (!approaches.length) {
      const msg =
        'FAILED to locate the APMI performance table / dataset.\n' +
        `  · Inspect the screenshot: ${path.relative(process.cwd(), OUT_PNG)}\n` +
        `  · Navigation status was ${resp && resp.status()} for ${SOURCE_URL}\n` +
        (jsonEndpoints.length
          ? `  · ${jsonEndpoints.length} JSON endpoint(s) were seen — re-run with DEBUG=1 to inspect samples and wire up the JSON path.\n`
          : '  · No JSON endpoints were observed.\n') +
        '  · If running in a sandbox, ensure `www.apmiindia.org` is in the network egress allowlist.\n' +
        '  · Re-run with DEBUG=1 to dump discovered table headers + pagination candidates.';
      throw new Error(msg);
    }

    const as_of_month = MONTH || asOf || istPrevMonth();
    if (!asOf && !MONTH)
      log(`! No reporting month found on page; defaulting as_of_month to IST previous month: ${as_of_month}`);

    if (LIMIT > 0 && approaches.length > LIMIT) {
      log(`Applying LIMIT=${LIMIT} (of ${approaches.length} discovered).`);
      approaches = approaches.slice(0, LIMIT);
    }

    const out = {
      generated_at: new Date().toISOString(),
      source: SOURCE,
      source_url: SOURCE_URL,
      as_of_month,
      count: approaches.length,
      approaches,
    };
    await writeFile(OUT_JSON, JSON.stringify(out, null, 2) + '\n');

    // ── Summary ──
    const managers = new Set(approaches.map((a) => a.manager).filter(Boolean));
    const withY1 = approaches.filter((a) => a.returns.y1 != null).length;
    const withY3 = approaches.filter((a) => a.returns.y3 != null).length;
    log('\n──────── APMI scrape summary ────────');
    log(`  reporting month : ${as_of_month}`);
    log(`  approaches      : ${approaches.length}`);
    log(`  managers        : ${managers.size}`);
    log(`  with y1 / y3    : ${withY1} / ${withY3}`);
    log(`  output          : ${path.relative(process.cwd(), OUT_JSON)}`);
    log('  first 3 entries :');
    log(JSON.stringify(approaches.slice(0, 3), null, 2));
    log('─────────────────────────────────────');
  } catch (err) {
    if (!screenshotSaved) await saveShot();
    console.error('\n[scrape-apmi] ' + (err && err.message ? err.message : err));
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Guarded entry so the parser helpers can be imported/unit-tested without a run.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
