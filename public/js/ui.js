// ui.js — Fund Screener — MGA · shared design system (light, visual-first)
//
// Single source of truth for brand tokens, formatting, the ECharts registry and
// the cached data loader. Keep this in lockstep with the sister "Fund Tracker —
// MGA" dashboard so both products render in the same visual language.

// ---------------------------------------------------------------------------
// Palette & color helpers
// ---------------------------------------------------------------------------
export const PALETTE = [
  "#6366F1", "#8B5CF6", "#EC4899", "#F43F5E", "#F59E0B", "#10B981", "#14B8A6",
  "#06B6D4", "#3B82F6", "#F97316", "#84CC16", "#A855F7", "#0EA5E9",
];

// Deterministic string hash (stable across reloads/sessions).
function hashStr(str) {
  let h = 0;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Stable per-id color (used to color managers consistently everywhere).
export function colorFor(id) {
  return PALETTE[hashStr(id) % PALETTE.length];
}

// Stable HSL hue per category.
export function categoryColor(cat) {
  return `hsl(${hashStr(cat) % 360}, 68%, 56%)`;
}

// Small Lucide icon name per category (best-effort, with a neutral fallback).
function categoryIcon(cat) {
  const c = String(cat || "").toLowerCase();
  if (c.includes("small") || c.includes("mid")) return "sprout";
  if (c.includes("multi")) return "layers";
  if (c.includes("thematic") || c.includes("sector")) return "sparkles";
  if (c.includes("long")) return "line-chart";
  if (c.includes("debt") || c.includes("credit")) return "landmark";
  if (c.includes("large") || c.includes("blue")) return "building-2";
  return "tag";
}

// Display label for a category. The huge PMS catch-all ("Multi/Flexi Cap") is
// shown as "Diversified / Multi-Cap" so the UI never implies false cap precision —
// the underlying data value stays "Multi/Flexi Cap" (filters/selectors use that).
export function categoryLabel(cat) {
  return cat === "Multi/Flexi Cap" ? "Diversified / Multi-Cap" : (cat || "—");
}

// Soft HSL pill for a category, with the vehicle (PMS/AIF) as a muted suffix.
export function categoryPill(cat, vehicle) {
  const h = hashStr(cat) % 360;
  const fg = `hsl(${h}, 68%, 38%)`;
  const bg = `hsla(${h}, 68%, 56%, 0.12)`;
  const ring = `hsla(${h}, 68%, 42%, 0.30)`;
  const icon = categoryIcon(cat);
  const veh = vehicle
    ? ` <span class="font-normal text-slate-400">· ${escapeHtml(vehicle)}</span>`
    : "";
  return `<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
    style="background:${bg}; color:${fg}; box-shadow: inset 0 0 0 1px ${ring};">
    <i data-lucide="${icon}" class="h-3.5 w-3.5"></i>${escapeHtml(categoryLabel(cat))}${veh}</span>`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function titleCase(s) {
  return String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Returns are numbers in percent. e.g. fmtPct(18.4) -> "+18.4%", null -> "—".
export function fmtPct(x) {
  if (x == null || Number.isNaN(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}

// Tailwind text color class for a percent value.
export function pctColor(x) {
  if (x == null || Number.isNaN(x)) return "text-slate-400";
  return x >= 0 ? "text-emerald-600" : "text-rose-500";
}

// ₹-crore with en-IN grouping. e.g. fmtAum(9500) -> "₹9,500 Cr".
export function fmtAum(cr) {
  if (cr == null || Number.isNaN(cr)) return "—";
  return `₹${Math.round(cr).toLocaleString("en-IN")} Cr`;
}

// "2026-05-31" -> "31 May 2026".
export function fmtDate(ymd) {
  if (!ymd) return "—";
  const d = new Date(`${ymd}${String(ymd).length === 10 ? "T00:00:00" : ""}`);
  if (Number.isNaN(d.getTime())) return String(ymd);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// "2026-05" -> "May 2026".
export function fmtMonth(ym) {
  if (!ym) return "—";
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return String(ym);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Periods (plain-English) & star ratings — for non-finance readers
// ---------------------------------------------------------------------------
// Each period has a compact `short` (dense tables) and a plain `long` (pills/prose).
export const PERIOD_META = {
  m1: { short: "1M", long: "1 month" },
  m3: { short: "3M", long: "3 months" },
  m6: { short: "6M", long: "6 months" },
  y1: { short: "1Y", long: "1 year" },
  y2: { short: "2Y", long: "2 years" },
  y3: { short: "3Y", long: "3 years" },
  y5: { short: "5Y", long: "5 years" },
  si: { short: "Start", long: "Since launch" },
};
export const periodShort = (k) => PERIOD_META[k]?.short ?? k;
export const periodLong = (k) => PERIOD_META[k]?.long ?? k;

// "₹1 grew to ₹X" multiple for a period. Short windows (≤1Y) are absolute returns
// → 1 + r/100; CAGR windows (2/3/5Y) compound by their years; `si` horizon is
// unknown → null. e.g. growthMultiple("y3", 13.6) ≈ 1.47.
export function growthMultiple(period, ret) {
  if (ret == null || Number.isNaN(ret)) return null;
  const yrs = { y2: 2, y3: 3, y5: 5 }[period];
  if (yrs) return Math.pow(1 + ret / 100, yrs);
  if (period === "si") return null;
  return 1 + ret / 100;
}

// ★★★★☆ — filled amber + faint outline. n = 0..5.
export function starsHtml(n, extra = "") {
  const full = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return `<span class="whitespace-nowrap ${extra}" role="img" aria-label="${full} out of 5 stars"><span class="text-amber-400">${"★".repeat(full)}</span><span class="text-slate-300">${"★".repeat(5 - full)}</span></span>`;
}

// ---------------------------------------------------------------------------
// Small UI bits
// ---------------------------------------------------------------------------
export function emptyState(icon, title, sub) {
  return `<div class="fade-in flex flex-col items-center justify-center gap-3 rounded-3xl bg-white/60 px-6 py-16 text-center">
    <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
      <i data-lucide="${escapeHtml(icon)}" class="h-7 w-7"></i>
    </div>
    <h3 class="font-display text-lg font-semibold text-slate-700">${escapeHtml(title)}</h3>
    <p class="max-w-sm text-sm text-slate-500">${escapeHtml(sub)}</p>
  </div>`;
}

// Animate an element's text from 0 to target (en-IN grouped).
export function countUp(el, target) {
  if (!el) return;
  const end = Number(target) || 0;
  const dur = 900;
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(end * eased).toLocaleString("en-IN");
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = end.toLocaleString("en-IN");
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// ECharts registry — keep one chart per id; dispose before re-init so canvases
// size correctly (heights come from real CSS in index.html, not Tailwind JIT).
// ---------------------------------------------------------------------------
const _charts = new Map();

export function makeChart(el, id) {
  if (!el || !window.echarts) return null;
  const prior = _charts.get(id);
  if (prior) {
    prior.dispose();
    _charts.delete(id);
  }
  const chart = window.echarts.init(el, null, { renderer: "canvas" });
  _charts.set(id, chart);
  return chart;
}

export function getChart(id) {
  return _charts.get(id) || null;
}

export function resizeCharts() {
  _charts.forEach((c) => c.resize());
}

// ---------------------------------------------------------------------------
// Data loader (cached). funds-performance.json is the core file; metadata.json
// and snapshots/index.json load in parallel with safe fallbacks.
// ---------------------------------------------------------------------------
let _dataCache = null;
const _managerColors = {};

export function managerColor(name) {
  return _managerColors[name] || colorFor(name);
}

export async function loadData() {
  if (_dataCache) return _dataCache;

  let dataError = false;

  const coreP = fetch("data/funds-performance.json", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  const metaP = fetch("data/metadata.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const snapsP = fetch("data/snapshots/index.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  let core = null;
  try {
    core = await coreP;
  } catch (err) {
    console.error("loadData: failed to load funds-performance.json", err);
    dataError = true;
  }

  let meta = await metaP;
  let snapshots = await snapsP;

  const funds = core && Array.isArray(core.funds) ? core.funds : [];

  // metadata fallback: derive minimal meta from the core file if needed.
  if (!meta && core) {
    meta = {
      generated_at: core.generated_at,
      as_of_month: core.as_of_month,
      sources: ["APMI (PMS)", "PMS Bazaar (AIF)"],
      fund_count: core.fund_count,
      pms_count: core.pms_count,
      aif_count: core.aif_count,
      manager_count: core.manager_count,
      category_count: core.category_count,
    };
  }
  meta = meta || {};
  if (!meta.as_of_month && core) meta.as_of_month = core.as_of_month;

  snapshots = snapshots || { updated_at: null, count: 0, snapshots: [] };

  // Build the manager color map from the funds.
  for (const f of funds) {
    const key = f.manager || f.id;
    if (key && !(key in _managerColors)) _managerColors[key] = colorFor(key);
  }

  _dataCache = { funds, meta, snapshots, dataError };
  return _dataCache;
}

// ---------------------------------------------------------------------------
export function refreshIcons() {
  window.lucide?.createIcons();
}
