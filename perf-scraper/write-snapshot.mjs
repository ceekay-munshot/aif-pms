/**
 * write-snapshot.mjs — append one compact dated snapshot per month + rebuild the
 * index. Fund Screener — MGA · step 6 of 12. PURE (no network).
 *
 * Reads:  public/data/funds-performance.json   (current store)
 * Writes: public/data/snapshots/<as_of_month>.json   (one per month, ~all funds)
 *         public/data/snapshots/index.json           (rebuilt from files on disk)
 *
 * This is the month-over-month history that powers the Movers tab (diff a fund by
 * `id` across two months) and per-fund history sparklines.
 *
 * Idempotent: same store ⇒ byte-identical snapshot; `generated_at`/`updated_at`
 * are preserved when content is unchanged; re-running the same month overwrites
 * that file identically (never duplicates). With one month present there are no
 * deltas yet — Movers fills in as months accrue.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { nowIstIso } from './build-store.mjs'; // shared IST timestamp (its main is guarded)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FP_JSON = path.join(ROOT, 'public', 'data', 'funds-performance.json');
const SNAP_DIR = path.join(ROOT, 'public', 'data', 'snapshots');
const INDEX_JSON = path.join(SNAP_DIR, 'index.json');
const MONTH_RE = /^\d{4}-\d{2}\.json$/;

const log = (...a) => console.log(...a);
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// ───────────────────────────── pure helpers (exported) ──────────────────────

export function median(values) {
  const v = (values || []).filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Standard competition ranking ("1,2,2,4") by `valFn` desc over funds with a
 * non-null value; ties share a rank, id breaks sort order. Returns Map(id→rank);
 * funds with null value are absent (→ null rank).
 */
export function assignRanks(funds, valFn) {
  const ranked = funds
    .filter((f) => valFn(f) != null)
    .sort((a, b) => {
      const d = valFn(b) - valFn(a);
      return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const ranks = new Map();
  let prevVal = null;
  let prevRank = 0;
  ranked.forEach((f, i) => {
    const v = valFn(f);
    const r = prevVal !== null && v === prevVal ? prevRank : i + 1;
    ranks.set(f.id, r);
    prevVal = v;
    prevRank = r;
  });
  return ranks;
}

const y1Of = (f) => (f.returns ? f.returns.y1 ?? null : null);
const y3Of = (f) => (f.returns ? f.returns.y3 ?? null : null);
const aY1Of = (f) => (f.alpha ? f.alpha.y1 ?? null : null);

/** Compact, ranked ranking[] over ALL funds (Movers diffs these by id). */
export function buildRanking(funds) {
  const overall = assignRanks(funds, y1Of);
  const byCat = new Map();
  for (const f of funds) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category).push(f);
  }
  const catRanks = new Map();
  for (const [, list] of byCat) for (const [id, r] of assignRanks(list, y1Of)) catRanks.set(id, r);

  return funds
    .map((f) => ({
      id: f.id,
      manager: f.manager ?? null,
      approach: f.approach ?? null,
      vehicle: f.vehicle ?? null,
      category: f.category ?? null,
      aum_cr: f.aum_cr ?? null,
      y1: y1Of(f),
      y3: y3Of(f),
      alpha_y1: aY1Of(f),
      rank_overall: overall.get(f.id) ?? null,
      rank_in_category: catRanks.get(f.id) ?? null,
    }))
    .sort((a, b) => {
      // ranked funds first in rank order; unranked (null y1) last by id.
      const ra = a.rank_overall ?? Infinity;
      const rb = b.rank_overall ?? Infinity;
      if (ra !== rb) return ra - rb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** Per-category medians, sorted by fund_count desc (category asc tiebreak). */
export function buildPerCategory(funds) {
  const byCat = new Map();
  for (const f of funds) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category).push(f);
  }
  return [...byCat.entries()]
    .map(([category, list]) => ({
      category,
      fund_count: list.length,
      median_y1: round2(median(list.map(y1Of))),
      median_y3: round2(median(list.map(y3Of))),
      median_alpha_y1: round2(median(list.map(aY1Of))),
    }))
    .sort((a, b) => (b.fund_count - a.fund_count) || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

function totalsOf(funds) {
  return {
    funds: funds.length,
    pms: funds.filter((f) => f.vehicle === 'PMS').length,
    aif: funds.filter((f) => f.vehicle === 'AIF').length,
    managers: new Set(funds.map((f) => f.manager).filter(Boolean)).size,
    categories: new Set(funds.map((f) => f.category).filter(Boolean)).size,
  };
}

/** Snapshot body (no generated_at) for a given month + funds. */
export function buildSnapshotBody(month, funds) {
  return {
    month,
    totals: totalsOf(funds),
    per_category: buildPerCategory(funds),
    ranking: buildRanking(funds),
  };
}

const snapComparable = (s) =>
  s ? { month: s.month, totals: s.totals, per_category: s.per_category, ranking: s.ranking } : null;

/** One index row from a (loaded) snapshot. median_y1 = median of its y1 column. */
export function indexEntry(snap) {
  return {
    month: snap.month,
    fund_count: snap.totals.funds,
    pms_count: snap.totals.pms,
    aif_count: snap.totals.aif,
    median_y1: round2(median((snap.ranking || []).map((r) => r.y1))),
  };
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
  const store = await readJson(FP_JSON);
  if (!store || !Array.isArray(store.funds))
    throw new Error(`Missing/invalid ${path.relative(process.cwd(), FP_JSON)} — run build-store.mjs first.`);
  if (!store.as_of_month) throw new Error('store has no as_of_month.');
  const month = store.as_of_month;

  await mkdir(SNAP_DIR, { recursive: true });

  // ── Monthly snapshot (idempotent) ──
  const body = buildSnapshotBody(month, store.funds);
  const monthPath = path.join(SNAP_DIR, `${month}.json`);
  const priorSnap = await readJson(monthPath);
  const snapUnchanged =
    priorSnap && !priorSnap._placeholder && JSON.stringify(snapComparable(priorSnap)) === JSON.stringify(body);
  const generated_at = snapUnchanged && priorSnap.generated_at ? priorSnap.generated_at : nowIstIso();
  const snapshot = { month: body.month, generated_at, totals: body.totals, per_category: body.per_category, ranking: body.ranking };
  await writeFile(monthPath, serialize(snapshot));

  // ── Index rebuilt from the snapshot files actually on disk ──
  const files = (await readdir(SNAP_DIR)).filter((f) => MONTH_RE.test(f)).sort();
  const entries = [];
  for (const f of files) {
    const snap = await readJson(path.join(SNAP_DIR, f));
    if (!snap || snap._placeholder || !snap.totals || !snap.ranking) continue;
    entries.push(indexEntry(snap));
  }
  entries.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  const idxBody = { count: entries.length, snapshots: entries };
  const priorIdx = await readJson(INDEX_JSON);
  const idxUnchanged =
    priorIdx && !priorIdx._placeholder && JSON.stringify({ count: priorIdx.count, snapshots: priorIdx.snapshots }) === JSON.stringify(idxBody);
  const updated_at = idxUnchanged && priorIdx.updated_at ? priorIdx.updated_at : nowIstIso();
  await writeFile(INDEX_JSON, serialize({ updated_at, count: idxBody.count, snapshots: idxBody.snapshots }));

  // ── Summary ──
  log('──────── write-snapshot summary ────────');
  log(`  month         : ${month}`);
  log(`  snapshot      : ${path.relative(process.cwd(), monthPath)} (${snapUnchanged ? 'unchanged → generated_at preserved' : 'updated'})`);
  log(`  totals        : funds ${body.totals.funds} · pms ${body.totals.pms} · aif ${body.totals.aif} · managers ${body.totals.managers} · categories ${body.totals.categories}`);
  log(`  ranking rows  : ${body.ranking.length} (ranked by y1: ${body.ranking.filter((r) => r.rank_overall != null).length})`);
  log(`  index         : ${entries.length} month(s) → ${entries.map((e) => e.month).join(', ')} (${idxUnchanged ? 'unchanged' : 'updated'})`);
  log('  per_category (top 12 by fund_count):');
  for (const c of body.per_category.slice(0, 12))
    log(`     ${String(c.category).padEnd(20)} n=${String(c.fund_count).padStart(4)}  median y1=${c.median_y1}  y3=${c.median_y3}  alpha_y1=${c.median_alpha_y1}`);
  log('────────────────────────────────────────');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('\n[write-snapshot] ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  });
}
