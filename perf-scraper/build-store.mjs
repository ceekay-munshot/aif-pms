/**
 * build-store.mjs — fold this run's normalized funds into the committed store the
 * dashboard reads. Fund Screener — MGA · step 5 of 12. PURE merge (no network).
 *
 * Reads:  perf-scraper/output/funds-normalized.json   (this run, required)
 *         public/data/funds-performance.json          (prior committed store; may be placeholder)
 *         public/data/metadata.json                   (prior; for generated_at preservation)
 * Writes: public/data/funds-performance.json          (latest-month detail the UI reads)
 *         public/data/metadata.json                   (the "Updated" badge + counts)
 *
 * Architecture: funds-performance.json holds ONLY the latest month's full detail
 * (stays small/fast). Month-over-month history lives in snapshots/ (step 6) and is
 * never overwritten. Dedup key = id + as_of_month (each id once per month).
 *
 * Merge:
 *   · placeholder prior            → drop it; store = this run's funds.
 *   · prior month == this month    → OVERLAY by id with MONOTONIC enrichment
 *                                    (new non-null wins, else keep prior non-null;
 *                                    never downgrade a resolved field to null);
 *                                    prior funds absent from a partial run are kept.
 *   · prior month != this month    → ROLL OVER (store = this run's funds; the prior
 *                                    month's detail already lives in its snapshot).
 *   Funds sorted by manager, then approach. Counts recomputed.
 *
 * Idempotent: same normalized input + same prior store ⇒ byte-identical output
 * (generated_at is preserved when the content body is unchanged).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const NORM_JSON = path.join(__dirname, 'output', 'funds-normalized.json');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const FP_JSON = path.join(DATA_DIR, 'funds-performance.json');
const META_JSON = path.join(DATA_DIR, 'metadata.json');

const PERIODS = ['m1', 'm3', 'm6', 'y1', 'y2', 'y3', 'y5', 'si'];
const SOURCES = ['APMI (PMS)', 'PMS Bazaar (AIF)'];
const log = (...a) => console.log(...a);

// ───────────────────────────── pure helpers (exported) ──────────────────────

/** Now as IST ISO-8601 with +05:30 (matches the project's dating convention). */
export function nowIstIso(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}+05:30`;
}

const orderLadder = (l) => {
  const o = {};
  for (const p of PERIODS) o[p] = l && l[p] != null ? l[p] : null;
  return o;
};

/** Canonical key order + complete ladders, so equal content serializes identically. */
export function orderFund(f) {
  const o = {
    id: f.id,
    manager: f.manager ?? null,
    approach: f.approach ?? null,
    vehicle: f.vehicle ?? null,
    category: f.category ?? null,
    strategy: f.strategy ?? null,
    aif_cat: f.aif_cat ?? null,
    aum_cr: f.aum_cr ?? null,
    benchmark: f.benchmark ?? null,
    inception: f.inception ?? null,
    as_of: f.as_of ?? null,
    as_of_month: f.as_of_month ?? null,
    returns: orderLadder(f.returns),
    benchmark_returns: orderLadder(f.benchmark_returns),
    alpha: orderLadder(f.alpha),
    source: f.source ?? null,
    source_url: f.source_url ?? null,
    source_category: f.source_category ?? null,
  };
  if (f.category_fallback) o.category_fallback = true;
  return o;
}

/** Monotonic field-by-field merge: take next when non-null, else keep prior. */
export function mergeFund(prior, next) {
  const pick = (k) => (next[k] != null ? next[k] : prior[k]);
  const ladder = (a, b) => {
    const o = {};
    for (const p of PERIODS) o[p] = a && a[p] != null ? a[p] : b && b[p] != null ? b[p] : null;
    return o;
  };
  const m = {
    id: next.id ?? prior.id,
    manager: pick('manager'),
    approach: pick('approach'),
    vehicle: pick('vehicle'),
    category: pick('category'),
    strategy: pick('strategy'),
    aif_cat: pick('aif_cat'),
    aum_cr: pick('aum_cr'),
    benchmark: pick('benchmark'),
    inception: pick('inception'),
    as_of: pick('as_of'),
    as_of_month: pick('as_of_month'),
    returns: ladder(next.returns, prior.returns),
    benchmark_returns: ladder(next.benchmark_returns, prior.benchmark_returns),
    alpha: ladder(next.alpha, prior.alpha),
    source: pick('source'),
    source_url: pick('source_url'),
    source_category: pick('source_category'),
  };
  const cf = 'category_fallback' in next ? next.category_fallback : prior.category_fallback;
  if (cf) m.category_fallback = true;
  return orderFund(m);
}

const byManagerApproach = (a, b) => {
  const ma = (a.manager || '').toLowerCase();
  const mb = (b.manager || '').toLowerCase();
  if (ma !== mb) return ma < mb ? -1 : 1;
  const pa = (a.approach || '').toLowerCase();
  const pb = (b.approach || '').toLowerCase();
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function counts(funds) {
  return {
    fund_count: funds.length,
    manager_count: new Set(funds.map((f) => f.manager).filter(Boolean)).size,
    pms_count: funds.filter((f) => f.vehicle === 'PMS').length,
    aif_count: funds.filter((f) => f.vehicle === 'AIF').length,
    category_count: new Set(funds.map((f) => f.category).filter(Boolean)).size,
  };
}

/** The funds-performance body (no generated_at): sorted funds + recomputed counts. */
export function buildFundsBody(funds, month) {
  const f = funds.map(orderFund).sort(byManagerApproach);
  const c = counts(f);
  return {
    as_of_month: month,
    fund_count: c.fund_count,
    manager_count: c.manager_count,
    pms_count: c.pms_count,
    aif_count: c.aif_count,
    category_count: c.category_count,
    funds: f,
  };
}

const metaBodyOf = (body) => ({
  as_of_month: body.as_of_month,
  sources: SOURCES,
  fund_count: body.fund_count,
  pms_count: body.pms_count,
  aif_count: body.aif_count,
  manager_count: body.manager_count,
  category_count: body.category_count,
});
const metaComparable = (m) =>
  m ? { as_of_month: m.as_of_month, sources: m.sources, fund_count: m.fund_count, pms_count: m.pms_count, aif_count: m.aif_count, manager_count: m.manager_count, category_count: m.category_count } : null;

/**
 * Core merge → { fp, meta, mode, fpUnchanged }. Pure & deterministic given `now`.
 */
export function mergeStore(priorFp, normalized, priorMeta, now) {
  const month = normalized.as_of_month;
  const nextFunds = (normalized.funds || []).map(orderFund);

  let mode;
  if (!priorFp || priorFp._placeholder) mode = priorFp ? 'placeholder-replaced' : 'fresh';
  else if (priorFp.as_of_month !== month) mode = 'rollover';
  else mode = 'overlay';

  const base = mode === 'overlay' ? (priorFp.funds || []).map(orderFund) : [];
  const byId = new Map(base.map((f) => [f.id, f]));
  for (const nf of nextFunds) byId.set(nf.id, byId.has(nf.id) ? mergeFund(byId.get(nf.id), nf) : nf);

  const newBody = buildFundsBody([...byId.values()], month);
  const priorBody = priorFp && !priorFp._placeholder ? buildFundsBody(priorFp.funds || [], priorFp.as_of_month) : null;
  const fpUnchanged = !!priorBody && JSON.stringify(priorBody) === JSON.stringify(newBody);
  const fp = { generated_at: fpUnchanged && priorFp.generated_at ? priorFp.generated_at : now, ...newBody };

  const newMeta = metaBodyOf(newBody);
  const metaUnchanged =
    priorMeta && !priorMeta._placeholder && JSON.stringify(metaComparable(priorMeta)) === JSON.stringify(newMeta);
  const meta = { generated_at: metaUnchanged && priorMeta.generated_at ? priorMeta.generated_at : now, ...newMeta };

  return { fp, meta, mode, fpUnchanged };
}

// ───────────────────────────── main ─────────────────────────────────────────

async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}
const serialize = (o) => JSON.stringify(o, null, 2) + '\n';

async function main() {
  const normalized = await readJson(NORM_JSON);
  if (!normalized || !Array.isArray(normalized.funds))
    throw new Error(`Missing/invalid ${path.relative(process.cwd(), NORM_JSON)} — run normalize.mjs first.`);
  if (!normalized.as_of_month) throw new Error('normalized input has no as_of_month.');

  const priorFp = await readJson(FP_JSON);
  const priorMeta = await readJson(META_JSON);

  const { fp, meta, mode, fpUnchanged } = mergeStore(priorFp, normalized, priorMeta, nowIstIso());

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FP_JSON, serialize(fp));
  await writeFile(META_JSON, serialize(meta));

  log('──────── build-store summary ────────');
  log(`  merge mode    : ${mode}${priorFp ? ` (prior ${priorFp._placeholder ? 'placeholder' : priorFp.as_of_month})` : ''}`);
  log(`  as_of_month   : ${fp.as_of_month}`);
  log(`  funds         : ${fp.fund_count}  (PMS ${fp.pms_count} · AIF ${fp.aif_count})`);
  log(`  managers      : ${fp.manager_count}`);
  log(`  categories    : ${fp.category_count}`);
  log(`  content change: ${fpUnchanged ? 'NONE (generated_at preserved → idempotent)' : 'updated'}`);
  log(`  placeholder   : ${priorFp && priorFp._placeholder ? 'dropped ✓' : priorFp ? 'n/a (real prior)' : 'no prior'}`);
  log(`  wrote         : ${path.relative(process.cwd(), FP_JSON)} + ${path.relative(process.cwd(), META_JSON)}`);
  log('─────────────────────────────────────');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('\n[build-store] ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  });
}
