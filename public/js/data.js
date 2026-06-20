// data.js — Fund Screener — MGA · shared data + selectors layer.
//
// Loads the committed data once (via ui.loadData) plus the per-month snapshot
// files, then exposes clean selectors used by app.js and every tab (10–11):
// filtering/sorting, overall + category-relative ranking, category aggregates,
// month-over-month deltas (Movers), and per-fund history (drill sparkline).

import { loadData } from "./ui.js";

let S = null; // { funds, meta, index, months: Map<ym, snapshot>, monthsSorted: [] }

const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

export function median(values) {
  const v = (values || []).filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Load core data + all monthly snapshot files (a handful for now). Idempotent.
export async function init() {
  if (S) return S;
  const { funds, meta, snapshots, dataError } = await loadData();
  const index = snapshots || { snapshots: [] };
  const monthList = (index.snapshots || []).map((s) => s.month).filter(Boolean);
  const months = new Map();
  await Promise.all(
    monthList.map(async (m) => {
      try {
        const r = await fetch(`data/snapshots/${m}.json`, { cache: "no-store" });
        if (r.ok) months.set(m, await r.json());
      } catch {
        /* a missing snapshot file just means no history for that month */
      }
    })
  );
  S = { funds, meta, index, months, monthsSorted: [...months.keys()].sort(), dataError };
  return S;
}

function st() {
  if (!S) throw new Error("data.init() must be awaited before using selectors");
  return S;
}

// ── basics ──────────────────────────────────────────────────────────────────
export const funds = () => st().funds;
export const meta = () => st().meta;
export const asOfMonth = () => st().meta.as_of_month;
export const snapshotIndex = () => st().index;
export const monthsAvailable = () => st().monthsSorted.slice();
export const latestMonth = () => st().monthsSorted[st().monthsSorted.length - 1] || st().meta.as_of_month;
export const snapshotFor = (m) => st().months.get(m) || null;
export const fundById = (id) => st().funds.find((f) => f.id === id) || null;

export const VEHICLES = ["PMS", "AIF"];
export function categories() {
  return [...new Set(st().funds.map((f) => f.category).filter(Boolean))].sort();
}
export function aumExtent() {
  const xs = st().funds.map((f) => f.aum_cr).filter((v) => v != null);
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 0];
}

// ── metric access ─────────────────────────────────────────────────────────────
// metric: "y1".."si"/"m1".. (returns), "alpha_<p>" (alpha), "bench_<p>"
// (benchmark_returns), or "aum_cr".
export function metricValue(f, metric) {
  if (!f) return null;
  const m = String(metric || "");
  if (m === "aum_cr") return f.aum_cr ?? null;
  if (m.startsWith("alpha_")) return f.alpha?.[m.slice(6)] ?? null;
  if (m.startsWith("bench_")) return f.benchmark_returns?.[m.slice(6)] ?? null;
  return f.returns?.[m] ?? null;
}

// ── filter + sort ─────────────────────────────────────────────────────────────
export function filterFunds({ vehicle, category, search, aumMin, aumMax } = {}) {
  let xs = st().funds;
  if (vehicle) xs = xs.filter((f) => f.vehicle === vehicle);
  if (category) xs = xs.filter((f) => f.category === category);
  if (aumMin != null) xs = xs.filter((f) => f.aum_cr != null && f.aum_cr >= aumMin);
  if (aumMax != null) xs = xs.filter((f) => f.aum_cr != null && f.aum_cr <= aumMax);
  if (search) {
    const q = String(search).toLowerCase().trim();
    if (q) xs = xs.filter((f) => (f.manager || "").toLowerCase().includes(q) || (f.approach || "").toLowerCase().includes(q));
  }
  return xs;
}

// Sort a copy by metric; nulls always sink to the bottom; id tiebreak (stable).
export function sortFunds(xs, metric, dir = "desc") {
  return [...xs].sort((a, b) => {
    const av = metricValue(a, metric);
    const bv = metricValue(b, metric);
    if (av == null && bv == null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return a.id < b.id ? -1 : 1;
    return dir === "desc" ? bv - av : av - bv;
  });
}

// ── ranking ───────────────────────────────────────────────────────────────────
// Competition ranking (1,2,2,4) by metric desc over a fund set; Map(id→rank),
// null-metric funds absent.
export function rankWithin(xs, metric) {
  const ranked = xs.filter((f) => metricValue(f, metric) != null);
  const sorted = sortFunds(ranked, metric, "desc");
  const ranks = new Map();
  let prev = null;
  let prevRank = 0;
  sorted.forEach((f, i) => {
    const v = metricValue(f, metric);
    const r = prev !== null && v === prev ? prevRank : i + 1;
    ranks.set(f.id, r);
    prev = v;
    prevRank = r;
  });
  return ranks;
}
export const rank = (metric) => rankWithin(st().funds, metric);

// Top N by metric, overall or within a category/vehicle (category-relative).
export function topN(metric, n = 10, { category, vehicle } = {}) {
  let xs = filterFunds({ category, vehicle }).filter((f) => metricValue(f, metric) != null);
  xs = sortFunds(xs, metric, "desc");
  return n > 0 ? xs.slice(0, n) : xs;
}

// ── category aggregates ───────────────────────────────────────────────────────
// Prefer the latest snapshot's per_category; fall back to computing from funds.
export function categoryAggregates() {
  const snap = snapshotFor(latestMonth());
  if (snap && Array.isArray(snap.per_category) && snap.per_category.length) return snap.per_category;
  const by = new Map();
  for (const f of st().funds) {
    if (!by.has(f.category)) by.set(f.category, []);
    by.get(f.category).push(f);
  }
  return [...by.entries()]
    .map(([category, list]) => ({
      category,
      fund_count: list.length,
      median_y1: round2(median(list.map((f) => f.returns?.y1))),
      median_y3: round2(median(list.map((f) => f.returns?.y3))),
      median_alpha_y1: round2(median(list.map((f) => f.alpha?.y1))),
    }))
    .sort((a, b) => b.fund_count - a.fund_count || (a.category < b.category ? -1 : 1));
}

// ── month-over-month (Movers) ────────────────────────────────────────────────
// Diff the latest two snapshots' ranking by id → per-fund y1 + rank change.
// rank_delta > 0 means the fund CLIMBED (rank number went down).
export function monthlyDeltas() {
  const ms = st().monthsSorted;
  if (ms.length < 2) return { hasPrior: false, latest: ms[ms.length - 1] || null, prior: null, rows: [] };
  const latest = ms[ms.length - 1];
  const prior = ms[ms.length - 2];
  const ls = snapshotFor(latest);
  const ps = snapshotFor(prior);
  const pById = new Map((ps.ranking || []).map((r) => [r.id, r]));
  const rows = (ls.ranking || []).map((r) => {
    const p = pById.get(r.id);
    return {
      id: r.id,
      manager: r.manager,
      approach: r.approach,
      vehicle: r.vehicle,
      category: r.category,
      y1: r.y1,
      y1_prev: p ? p.y1 : null,
      y1_delta: r.y1 != null && p && p.y1 != null ? round2(r.y1 - p.y1) : null,
      rank_overall: r.rank_overall,
      rank_prev: p ? p.rank_overall : null,
      rank_delta: r.rank_overall != null && p && p.rank_overall != null ? p.rank_overall - r.rank_overall : null,
      is_new: !p,
    };
  });
  return { hasPrior: true, latest, prior, rows };
}

// ── per-fund history (drill sparkline) ───────────────────────────────────────
export function fundHistory(id) {
  return st().monthsSorted.map((m) => {
    const snap = snapshotFor(m);
    const r = (snap?.ranking || []).find((x) => x.id === id);
    return { month: m, y1: r ? r.y1 : null, y3: r ? r.y3 : null };
  });
}

// The fund's latest-snapshot rank badge (rank_in_category / rank_overall).
export function fundRank(id) {
  const snap = snapshotFor(latestMonth());
  const r = (snap?.ranking || []).find((x) => x.id === id);
  return r ? { rank_overall: r.rank_overall ?? null, rank_in_category: r.rank_in_category ?? null } : null;
}

// ── headline stats (KPI strip) ───────────────────────────────────────────────
export function summary() {
  const fs = st().funds;
  const withAlphaY1 = fs.filter((f) => f.alpha?.y1 != null);
  const beating = withAlphaY1.filter((f) => f.alpha.y1 > 0).length;
  return {
    total: fs.length,
    medianY1: median(fs.map((f) => f.returns?.y1)),
    medianY3: median(fs.map((f) => f.returns?.y3)),
    medianAlphaY1: median(fs.map((f) => f.alpha?.y1)),
    beatingCount: beating,
    beatingDenom: withAlphaY1.length,
    beatingPct: withAlphaY1.length ? (beating / withAlphaY1.length) * 100 : 0,
  };
}
