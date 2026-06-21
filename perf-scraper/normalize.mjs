/**
 * normalize.mjs — unify APMI (PMS) + PMS Bazaar (AIF) raw scrapes into one
 * funds[] dataset matching the data contract, and derive alpha.
 * Fund Screener — MGA · step 4 of 12. PURE transform (no network).
 *
 * Reads:   perf-scraper/output/apmi-pms.json        (PMS, from scrape-apmi.mjs)
 *          perf-scraper/output/pmsbazaar-aif.json    (AIF, from scrape-pmsbazaar.mjs)
 *          perf-scraper/static/benchmark-returns.json (committed; index ladders)
 *          perf-scraper/static/pms-category-overrides.json (committed; id→bucket)
 * Writes:  perf-scraper/output/funds-normalized.json (the unified dataset)
 *          perf-scraper/static/benchmark-returns.json (merged: harvested ⊕ committed)
 *
 * Alpha = fund return − benchmark return, per period; null if either is null.
 *  · AIF: benchmark returns come straight from each scheme's per-period
 *    IndexReturnValue → alpha (incl. si) is direct.
 *  · PMS (APMI) exposes only the benchmark NAME. We harvest index ladders from the
 *    AIF dataset's IndexReturnValue (median per benchmark per period), keep them in
 *    static/benchmark-returns.json (hand-overridable for uncovered indices), and
 *    look them up by normalized benchmark name. PMS `si` alpha is always null (no
 *    index-since-inception). Missing alpha never blocks.
 *
 * Committing the result into the rolling store is step 5.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const STATIC_DIR = path.join(__dirname, 'static');
const APMI_JSON = path.join(OUT_DIR, 'apmi-pms.json');
const AIF_JSON = path.join(OUT_DIR, 'pmsbazaar-aif.json');
const BENCH_JSON = path.join(STATIC_DIR, 'benchmark-returns.json');
const OVERRIDES_JSON = path.join(STATIC_DIR, 'pms-category-overrides.json');
const OUT_JSON = path.join(OUT_DIR, 'funds-normalized.json');

const PERIODS = ['m1', 'm3', 'm6', 'y1', 'y2', 'y3', 'y5', 'si'];
// Benchmarks are harvested for trailing periods only — `si` is per-fund (inception).
const BENCH_PERIODS = ['m1', 'm3', 'm6', 'y1', 'y2', 'y3', 'y5'];

const BENCH_COMMENT =
  'Canonical benchmark return ladders for deriving PMS alpha. Keyed by a ' +
  'normalized benchmark key (UPPER, no S&P/TRI/INDEX, alphanumerics). Each entry: ' +
  '{ label, months: { "YYYY-MM": { m1..y5 } } }. Auto-harvested from the AIF ' +
  'dataset (median IndexReturnValue per period); hand-edit to add/override ' +
  'uncovered indices (e.g. MSEI SX 40 TRI). Committed values win over harvested.';

const log = (...a) => console.log(...a);
const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
const emptyLadder = () => Object.fromEntries(PERIODS.map((p) => [p, null]));
const num = (x) =>
  x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x);
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// ───────────────────────────── pure helpers (exported) ──────────────────────

/** Deterministic ASCII slug. */
export function slug(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Normalized benchmark matching key: "S&P BSE 500 TRI" → "BSE 500". */
export function benchKey(name) {
  if (!name) return '';
  return String(name)
    .toUpperCase()
    .replace(/S&P/g, ' ')
    .replace(/\bTRI\b/g, ' ')
    .replace(/\bTR\b/g, ' ')
    .replace(/TOTAL\s+RETURNS?/g, ' ')
    .replace(/\bINDEX\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** "YYYY-MM" → month-end "YYYY-MM-DD", else null. */
export function monthEnd(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return null;
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, '0')}`;
}

export function median(arr) {
  const v = (arr || []).filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Unified STYLE/CAP taxonomy (drives category-relative ranking later). Ordered:
// compound caps first, then single caps, then style/asset-class buckets. Documented
// & overridable — tune the regexes or use static/pms-category-overrides.json.
// High-precision, name-based only: a clear cap/style/sector word must be present,
// else PMS falls back to Multi/Flexi (flagged). NOTE the ordering + word boundaries:
// `\ball[\s-]*cap` must keep its leading \b or it would match "sm-ALL CAP"; the
// all/mid/large compound rules sit ABOVE the single-cap rules on purpose. "Emerging"
// is deliberately NOT a rule — it's ambiguous (markets vs. small/mid co's) → stays
// Multi/Flexi unless an id override says otherwise.
export const CATEGORY_BUCKETS = [
  'Large Cap', 'Large & Mid', 'Multi/Flexi Cap', 'Mid Cap', 'Mid & Small',
  'Small Cap', 'Thematic/Sectoral', 'Value/Contra', 'Debt', 'Hybrid/Multi-Asset', 'Unclassified',
];
const CATEGORY_RULES = [
  ['Large & Mid', /large\s*(?:&|and|\+|-|,|\/)?\s*mid/i],
  ['Mid & Small', /mid\s*(?:&|and|\+|-|,|\/)?\s*small|small\s*(?:&|and)\s*mid|\bsmid\b/i],
  ['Multi/Flexi Cap', /multi[\s-]*cap|flexi[\s-]*cap|multicap|flexicap|diversified|\ball[\s-]*cap|go[\s-]*anywhere|cap[\s-]*agnostic/i],
  ['Large Cap', /large[\s-]*cap|blue[\s-]*chip|bluechip|top\s*100/i],
  ['Mid Cap', /mid[\s-]*cap|midcap/i],
  ['Small Cap', /small[\s-]*cap|smallcap|micro[\s-]*cap|nano[\s-]*cap/i],
  ['Value/Contra', /\bvalue\b|\bcontra\b|special\s*situation|deep\s*value|turnaround/i],
  ['Thematic/Sectoral', /thematic|theme|sector|pharma|health|technolog|fintech|\btech\b|digital|bank|financ|\bbfsi\b|infra|consum|manufactur|\bit\b|\bpsu\b|defen[cs]e|energy|\bauto\b|realty|real\s*estat|metal|chemical|export|fmcg|telecom|logistic|\bmnc\b|agri|commodit/i],
  ['Debt', /\bdebt\b|credit|fixed\s*income|\bbond\b|\bgilt\b|duration|liquid|money\s*market|\byield\b/i],
  ['Hybrid/Multi-Asset', /hybrid|multi[\s-]*asset|balanced|asset\s*alloc|arbitrage|long\s*[-/ ]?\s*short|absolute\s*return|multi[\s-]*strateg|equity\s*savings/i],
];

/** Classify a cap/style bucket from free text; null if no rule matches. */
export function classifyCategory(text) {
  const t = clean(text);
  if (!t) return null;
  for (const [bucket, re] of CATEGORY_RULES) if (re.test(t)) return bucket;
  return null;
}

/** "AIF CAT III" / "AIF_CAT3" → "Cat III"; else null. */
export function normalizeAifCat(productName) {
  const t = String(productName || '').toUpperCase();
  if (/CAT\s*_?\s*(III|3)\b/.test(t)) return 'Cat III';
  if (/CAT\s*_?\s*(II|2)\b/.test(t)) return 'Cat II';
  if (/CAT\s*_?\s*(I|1)\b/.test(t)) return 'Cat I';
  return null;
}

/** "Long Only" / "Long-Short" / raw; null if empty. */
export function normalizeStrategy(s) {
  const t = clean(s);
  if (!t) return null;
  if (/long\s*[-/ ]?\s*short/i.test(t)) return 'Long-Short';
  if (/long\s*only/i.test(t)) return 'Long Only';
  return t;
}

const padLadder = (l) => {
  const o = emptyLadder();
  if (l) for (const p of PERIODS) o[p] = num(l[p]);
  return o;
};

/** alpha[p] = returns[p] − benchmark_returns[p]; null if either side null. */
export function deriveAlpha(returns, bench) {
  const a = emptyLadder();
  for (const p of PERIODS) {
    const r = returns ? returns[p] : null;
    const b = bench ? bench[p] : null;
    a[p] = r != null && b != null ? round2(r - b) : null;
  }
  return a;
}

/** Median index ladder per normalized benchmark, harvested from AIF schemes. */
export function harvestBenchmarks(aifSchemes) {
  const groups = new Map();
  for (const s of aifSchemes || []) {
    const key = benchKey(s.benchmark);
    if (!key || !s.benchmark_returns) continue;
    let g = groups.get(key);
    if (!g) {
      g = { labels: new Map(), per: Object.fromEntries(BENCH_PERIODS.map((p) => [p, []])) };
      groups.set(key, g);
    }
    g.labels.set(s.benchmark, (g.labels.get(s.benchmark) || 0) + 1);
    for (const p of BENCH_PERIODS) {
      const v = num(s.benchmark_returns[p]);
      if (v != null) g.per[p].push(v);
    }
  }
  const out = {};
  for (const [key, g] of groups) {
    const ladder = {};
    for (const p of BENCH_PERIODS) ladder[p] = round2(median(g.per[p]));
    const label = [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out[key] = { label, ladder, n: [...g.labels.values()].reduce((x, y) => x + y, 0) };
  }
  return out;
}

/** Merge harvested ladders into the committed store (committed values win). */
export function mergeBenchStore(store, harvested, month) {
  store.benchmarks = store.benchmarks || {};
  for (const [key, h] of Object.entries(harvested)) {
    const e = (store.benchmarks[key] = store.benchmarks[key] || { label: h.label, months: {} });
    if (!e.label) e.label = h.label;
    e.months = e.months || {};
    const existing = e.months[month] || {};
    const merged = {};
    for (const p of BENCH_PERIODS) merged[p] = existing[p] != null ? existing[p] : h.ladder[p] ?? null;
    e.months[month] = merged;
  }
  return store;
}

const SOURCE_URL = {
  PMS: 'https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu',
  AIF: 'https://pmsbazaar.com/Visitor/aif-investment',
};

/** AIF scheme → unified record. */
export function normalizeAifRecord(s, month, overrides = {}) {
  const id = `${slug(s.manager)}-${slug(s.approach)}`;
  const returns = padLadder(s.returns);
  const benchmark_returns = padLadder(s.benchmark_returns);
  const category =
    overrides[id] ||
    classifyCategory(s.market_cap) ||
    classifyCategory(s.approach) ||
    classifyCategory(s.display_category) ||
    'Unclassified';
  return {
    id,
    manager: clean(s.manager) || null,
    approach: clean(s.approach) || null,
    vehicle: 'AIF',
    category,
    strategy: normalizeStrategy(s.strategy),
    aif_cat: normalizeAifCat(s.aif_category),
    aum_cr: num(s.aum_cr),
    benchmark: clean(s.benchmark) || null,
    inception: s.inception || null,
    as_of: monthEnd(month),
    as_of_month: month,
    returns,
    benchmark_returns,
    alpha: deriveAlpha(returns, benchmark_returns),
    source: 'PMS Bazaar',
    source_url: SOURCE_URL.AIF,
    source_category: clean(s.display_category) || null,
  };
}

/** APMI PMS approach → unified record (benchmark ladder looked up by name). */
export function normalizePmsRecord(a, month, benchLookup, overrides = {}) {
  const id = `${slug(a.manager)}-${slug(a.approach)}`;
  const returns = padLadder(a.returns);
  const benchmark_returns = emptyLadder();
  const ladder = benchLookup && benchLookup.get(benchKey(a.benchmark));
  if (ladder) for (const p of BENCH_PERIODS) benchmark_returns[p] = ladder[p] ?? null; // si stays null
  let category = overrides[id] || classifyCategory(a.approach);
  let category_fallback = false;
  if (!category) {
    category = 'Multi/Flexi Cap'; // unclear-but-equity (APMI universe is Equity)
    category_fallback = true;
  }
  const rec = {
    id,
    manager: clean(a.manager) || null,
    approach: clean(a.approach) || null,
    vehicle: 'PMS',
    category,
    strategy: 'Long Only', // structurally long-only
    aif_cat: null,
    aum_cr: num(a.aum_cr),
    benchmark: clean(a.benchmark) || null,
    inception: a.inception || null,
    as_of: monthEnd(month),
    as_of_month: month,
    returns,
    benchmark_returns,
    alpha: deriveAlpha(returns, benchmark_returns),
    source: 'APMI',
    source_url: SOURCE_URL.PMS,
    source_category: null,
  };
  if (category_fallback) rec.category_fallback = true;
  return rec;
}

function benchLookupFor(store, month) {
  const map = new Map();
  for (const [key, e] of Object.entries(store.benchmarks || {})) {
    const lad = e.months && e.months[month];
    if (lad) map.set(key, lad);
  }
  return map;
}

const anyAlpha = (r) => PERIODS.some((p) => r.alpha[p] != null);

// ───────────────────────────── main ─────────────────────────────────────────

async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const apmi = await readJson(APMI_JSON);
  const aif = await readJson(AIF_JSON);
  if (!apmi && !aif)
    throw new Error(
      `No input found. Expected ${path.relative(process.cwd(), APMI_JSON)} and/or ` +
        `${path.relative(process.cwd(), AIF_JSON)} — run the scrapers first.`
    );
  const approaches = apmi?.approaches || [];
  const schemes = aif?.schemes || [];
  log(`normalize · PMS approaches=${approaches.length} · AIF schemes=${schemes.length}`);

  const monthApmi = apmi?.as_of_month || null;
  const monthAif = aif?.as_of_month || null;
  const month = [monthApmi, monthAif].filter(Boolean).sort().pop() || null;
  if (monthApmi && monthAif && monthApmi !== monthAif)
    log(`! as_of_month differ (APMI ${monthApmi} vs AIF ${monthAif}); using ${month}`);
  if (!month) throw new Error('Could not resolve as_of_month from inputs.');

  // Harvest benchmark ladders from AIF, merge into the committed store, persist.
  const store = (await readJson(BENCH_JSON)) || { _comment: BENCH_COMMENT, benchmarks: {} };
  const harvested = harvestBenchmarks(schemes);
  mergeBenchStore(store, harvested, month);
  store._comment = BENCH_COMMENT;
  await mkdir(STATIC_DIR, { recursive: true });
  await writeFile(BENCH_JSON, JSON.stringify(store, null, 2) + '\n');
  const benchLookup = benchLookupFor(store, month);

  const overrides = (await readJson(OVERRIDES_JSON))?.overrides || {};

  const aifRecs = schemes.map((s) => normalizeAifRecord(s, month, overrides));
  const pmsRecs = approaches.map((a) => normalizePmsRecord(a, month, benchLookup, overrides));
  const all = [...pmsRecs, ...aifRecs];

  // Stable-id collision pass (expect 0).
  const collisions = [];
  const seen = new Map();
  for (const rec of all) {
    if (!seen.has(rec.id)) {
      seen.set(rec.id, rec);
      continue;
    }
    let nid = `${rec.id}-${rec.vehicle.toLowerCase()}`;
    let i = 2;
    while (seen.has(nid)) nid = `${rec.id}-${rec.vehicle.toLowerCase()}-${i++}`;
    collisions.push({ from: rec.id, to: nid, manager: rec.manager, approach: rec.approach });
    rec.id = nid;
    seen.set(nid, rec);
  }

  const out = {
    generated_at: new Date().toISOString(),
    as_of_month: month,
    count: all.length,
    pms_count: pmsRecs.length,
    aif_count: aifRecs.length,
    funds: all,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(out, null, 2) + '\n');

  // ── Stats ──
  const dist = Object.fromEntries(CATEGORY_BUCKETS.map((b) => [b, 0]));
  for (const r of all) dist[r.category] = (dist[r.category] || 0) + 1;
  const pmsFallback = pmsRecs.filter((r) => r.category_fallback);
  const aifUnclassified = aifRecs.filter((r) => r.category === 'Unclassified');
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const aifAlpha = aifRecs.filter(anyAlpha).length;
  const pmsAlpha = pmsRecs.filter(anyAlpha).length;

  log('\n──────── normalize summary ────────');
  log(`  as_of_month : ${month}  (as_of ${monthEnd(month)})`);
  log(`  funds       : ${all.length}  (PMS ${pmsRecs.length} · AIF ${aifRecs.length})`);
  log('  category distribution:');
  for (const b of CATEGORY_BUCKETS) if (dist[b]) log(`     ${b.padEnd(20)} ${dist[b]}`);
  log(`  PMS category fallbacks (unclear→Multi/Flexi): ${pmsFallback.length}`);
  log(`  AIF Unclassified: ${aifUnclassified.length}`);
  log(`  alpha coverage: AIF ${aifAlpha}/${aifRecs.length} (${pct(aifAlpha, aifRecs.length)}%) · ` +
      `PMS ${pmsAlpha}/${pmsRecs.length} (${pct(pmsAlpha, pmsRecs.length)}%)`);
  log('  harvested benchmarks (key · label · n · y1):');
  for (const [key, h] of Object.entries(harvested).sort((a, b) => b[1].n - a[1].n).slice(0, 12))
    log(`     ${key.padEnd(22)} "${h.label}"  n=${h.n}  y1=${h.ladder.y1}`);
  // Which PMS benchmark names matched a harvested ladder?
  const pmsBench = new Map();
  for (const a of approaches) {
    const k = benchKey(a.benchmark);
    if (!pmsBench.has(k)) pmsBench.set(k, { name: a.benchmark, n: 0, covered: benchLookup.has(k) });
    pmsBench.get(k).n++;
  }
  log('  PMS benchmark coverage:');
  for (const [k, v] of [...pmsBench.entries()].sort((a, b) => b[1].n - a[1].n))
    log(`     ${(v.name || '(none)').padEnd(24)} n=${v.n}  ${v.covered ? 'COVERED' : 'no ladder → null alpha'}`);
  log(`  id collisions: ${collisions.length}`);
  for (const c of collisions.slice(0, 10)) log(`     ${c.from} → ${c.to} (${c.manager} / ${c.approach})`);
  if (pmsFallback.length) {
    log(`  unclassified PMS approaches (first 40 of ${pmsFallback.length}):`);
    log('     ' + pmsFallback.slice(0, 40).map((r) => r.approach).join(' | '));
  }
  log(`  output: ${path.relative(process.cwd(), OUT_JSON)}`);
  log('  sample (1 PMS, 1 AIF):');
  const onePms = pmsRecs.find((r) => anyAlpha(r)) || pmsRecs[0];
  const oneAif = aifRecs.find((r) => anyAlpha(r)) || aifRecs[0];
  log(JSON.stringify([onePms, oneAif].filter(Boolean), null, 2));
  log('───────────────────────────────────');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('\n[normalize] ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  });
}
