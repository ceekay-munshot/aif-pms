// compare.js — Fund Screener — MGA · the Compare tab.
//
// A dedicated tab (not a modal): add up to MAX funds — via the search box at the
// top of the tab, or the "Add to compare" button on any Screener/Leaderboard row
// or in a fund's detail — and see them side by side in plain English, with the
// best value in each return/alpha/growth row highlighted. A small floating pill
// jumps here from other tabs. Selection state + the +Compare button live here so
// every tab can add without knowing how Compare renders.

import { fundById, funds, starRating } from "./data.js";
import {
  escapeHtml, initials, managerColor, categoryPill, fmtPct, pctColor, fmtAum, fmtDate,
  starsHtml, growthMultiple, refreshIcons,
} from "./ui.js";
import { openFundDrill } from "./drill.js";

const MAX = 4;
const $ = (id) => document.getElementById(id);
let ids = [];
let _sec = null;       // the Compare tab <section>, set on first render
let _bound = false;

export const inCompare = (id) => ids.includes(id);
export const compareIds = () => ids.slice();

function toast(msg) {
  const t = document.createElement("div");
  t.className = "fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
const onCompareTab = () =>
  document.querySelector('.tab-btn[data-tab="compare"]')?.getAttribute("aria-selected") === "true";

export function toggleCompare(id) {
  if (!id) return;
  if (inCompare(id)) ids = ids.filter((x) => x !== id);
  else if (ids.length >= MAX) { toast(`Compare up to ${MAX} funds — remove one first.`); return; }
  else { ids = [...ids, id]; if (!onCompareTab()) toast("Added to Compare — open the Compare tab"); }
  afterChange();
}
function removeFromCompare(id) { ids = ids.filter((x) => x !== id); afterChange(); }
function clearCompare() { ids = []; afterChange(); }
function afterChange() { syncButtons(); paint(); renderNavPill(); }

// ── the +Compare button (used by Screener rows + the drill) ───────────────────
const cmpInner = (id, variant) => {
  const on = inCompare(id);
  if (variant === "full") return on ? "✓ Comparing" : "＋ Add to compare";
  return on ? "✓" : "＋"; // icon variant (compact)
};
export function compareButton(id, variant = "icon") {
  const on = inCompare(id);
  const base = variant === "full"
    ? "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition"
    : "cmp-chip inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold leading-none transition";
  const tone = on ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200";
  return `<button type="button" data-cmp-add="${escapeHtml(id)}" data-cmp-variant="${variant}" aria-pressed="${on}" title="Add to compare" class="${base} ${tone}">${cmpInner(id, variant)}</button>`;
}
function syncButtons() {
  document.querySelectorAll("[data-cmp-add]").forEach((el) => {
    const id = el.getAttribute("data-cmp-add");
    const on = inCompare(id);
    el.innerHTML = cmpInner(id, el.getAttribute("data-cmp-variant") || "icon");
    el.setAttribute("aria-pressed", String(on));
    el.classList.toggle("bg-violet-600", on);
    el.classList.toggle("text-white", on);
    el.classList.toggle("bg-slate-100", !on);
    el.classList.toggle("text-slate-500", !on);
  });
}

// ── floating pill: a quick jump to the Compare tab from elsewhere ─────────────
function renderNavPill() {
  const tray = $("cmp-tray");
  if (!tray) return;
  if (!ids.length || onCompareTab()) { tray.classList.add("hidden"); tray.innerHTML = ""; return; }
  tray.classList.remove("hidden");
  tray.innerHTML = `<button type="button" data-cmp-goto class="flex items-center gap-2 rounded-full bg-slate-900/95 px-4 py-2.5 text-sm font-semibold text-white shadow-xl ring-1 ring-white/10 backdrop-blur transition hover:-translate-y-0.5 hover:bg-slate-800">
    <i data-lucide="scale" class="h-4 w-4"></i> Compare
    <span class="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-500 px-1 text-xs">${ids.length}</span></button>`;
  refreshIcons();
}

// ── add-a-fund search (top of the tab) ────────────────────────────────────────
function pickMatches(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  return funds()
    .filter((f) => !inCompare(f.id) && ((f.manager || "").toLowerCase().includes(q) || (f.approach || "").toLowerCase().includes(q)))
    .sort((a, b) => (b.returns?.y1 ?? -1e9) - (a.returns?.y1 ?? -1e9))
    .slice(0, 8);
}
function renderPicks(q) {
  const box = $("cmp-search-results");
  if (!box) return;
  const xs = pickMatches(q);
  if (!q.trim() || !xs.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = xs.map((f) => `<button type="button" data-cmp-pick="${escapeHtml(f.id)}" class="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-violet-50">
    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style="background:${managerColor(f.manager || f.id)}">${escapeHtml(initials(f.manager))}</span>
    <span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold text-slate-700">${escapeHtml(f.approach || "—")}</span>
      <span class="block truncate text-xs text-slate-400">${escapeHtml(f.manager || "—")}</span></span>
    <span class="shrink-0 font-mono text-sm font-bold ${pctColor(f.returns?.y1)}">${escapeHtml(fmtPct(f.returns?.y1))}</span></button>`).join("");
}
function addBar(full) {
  return `<div class="relative">
    <div class="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 ${full ? "opacity-60" : ""}">
      <i data-lucide="search" class="h-4 w-4 shrink-0 text-slate-400"></i>
      <input id="cmp-search" type="search" autocomplete="off" ${full ? "disabled" : ""}
        placeholder="${full ? `Maximum ${MAX} funds — remove one to add another` : "Add a fund — search by manager or approach…"}"
        class="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400" />
    </div>
    <div id="cmp-search-results" class="scroll-area absolute left-0 right-0 top-full z-20 mt-1 hidden max-h-72 overflow-y-auto rounded-xl bg-white p-1 shadow-xl ring-1 ring-slate-200"></div>
  </div>`;
}

// ── the comparison table ──────────────────────────────────────────────────────
function vehicleBadge(v) {
  const c = v === "AIF" ? "#EC4899" : "#6366F1";
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold" style="color:${c};background:${c}1a;box-shadow:inset 0 0 0 1px ${c}33;">${escapeHtml(v || "—")}</span>`;
}
const pctTag = (v) => `<span class="font-mono text-sm font-semibold ${pctColor(v)}">${fmtPct(v)}</span>`;
const beats = (f) => { const a = f.alpha?.y3 ?? f.alpha?.y1 ?? null; return a == null ? null : a > 0; };

function colHeader(f) {
  return `<th class="min-w-[150px] border-b border-slate-100 px-3 pb-3 align-bottom">
    <div class="flex flex-col items-center gap-1.5 text-center">
      <button type="button" data-cmp-view="${escapeHtml(f.id)}" class="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-white transition hover:opacity-90" style="background:${managerColor(f.manager || f.id)};" title="View details">${escapeHtml(initials(f.manager))}</button>
      <button type="button" data-cmp-view="${escapeHtml(f.id)}" class="line-clamp-2 text-sm font-bold leading-tight text-slate-800 hover:text-violet-700">${escapeHtml(f.approach || "—")}</button>
      <p class="line-clamp-1 text-[11px] text-slate-400">${escapeHtml(f.manager || "—")}</p>
      <button type="button" data-cmp-remove="${escapeHtml(f.id)}" class="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 transition hover:text-rose-500"><i data-lucide="x" class="h-3 w-3"></i>remove</button>
    </div></th>`;
}
// categorical row (no "best" highlight)
function row(label, sub, cell) {
  return `<tr class="border-b border-slate-50">
    <td class="whitespace-nowrap py-3 pr-4 text-xs font-semibold text-slate-500">${label}${sub ? `<div class="font-normal text-slate-400">${sub}</div>` : ""}</td>
    ${_funds.map((f) => `<td class="px-3 py-3 text-center text-sm text-slate-700">${cell(f)}</td>`).join("")}</tr>`;
}
// numeric row: highlights the winning cell(s)
function metricRow(label, sub, getVal, render) {
  const vals = _funds.map(getVal);
  const nums = vals.filter((v) => v != null && Number.isFinite(v));
  const best = nums.length > 1 ? Math.max(...nums) : null;
  return `<tr class="border-b border-slate-50">
    <td class="whitespace-nowrap py-3 pr-4 text-xs font-semibold text-slate-500">${label}${sub ? `<div class="font-normal text-slate-400">${sub}</div>` : ""}</td>
    ${_funds.map((f, i) => {
      const v = vals[i];
      const win = best != null && v === best;
      return `<td class="px-3 py-3 text-center ${win ? "rounded-lg bg-violet-50" : ""}">${render(v, f)}${win ? `<div class="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-500">best</div>` : ""}</td>`;
    }).join("")}</tr>`;
}

let _funds = [];
function compareTable(list) {
  _funds = list;
  const head = list.map(colHeader).join("");
  const ratingStars = (f) => { const r = starRating(f.id); return r ? r.stars : null; };
  const ratingRender = (_v, f) => { const r = starRating(f.id); return r ? `${starsHtml(r.stars)}<div class="mt-0.5 text-[11px] text-slate-400">better than ${Math.round(r.pct * 100)}%</div>` : `<span class="text-slate-400">—</span>`; };
  const growRender = (v) => v == null ? `<span class="text-slate-400">—</span>` : `<span class="text-sm">₹1 → <b class="text-slate-800">₹${v.toFixed(2)}</b> <span class="text-slate-400">(${v.toFixed(1)}×)</span></span>`;
  const beatRender = (f) => { const b = beats(f); return b == null ? `<span class="text-slate-400">—</span>` : b ? `<span class="font-semibold text-emerald-600">✅ Yes</span>` : `<span class="font-semibold text-rose-500">❌ No</span>`; };
  return `<div class="overflow-x-auto scroll-area">
    <table class="w-full">
      <thead><tr><th class="px-3 pb-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Fund</th>${head}</tr></thead>
      <tbody>
        ${row("Type", "", (f) => vehicleBadge(f.vehicle))}
        ${row("Category", "", (f) => categoryPill(f.category))}
        ${metricRow("Rating", "vs all funds", ratingStars, ratingRender)}
        ${metricRow("Money growth", "over 3 years", (f) => growthMultiple("y3", f.returns?.y3), growRender)}
        ${metricRow("Return", "1 year", (f) => f.returns?.y1, (v) => pctTag(v))}
        ${metricRow("Return", "3 years", (f) => f.returns?.y3, (v) => pctTag(v))}
        ${metricRow("Return", "5 years", (f) => f.returns?.y5, (v) => pctTag(v))}
        ${metricRow("Alpha", "1 year, vs benchmark", (f) => f.alpha?.y1, (v) => pctTag(v))}
        ${metricRow("Alpha", "3 years, vs benchmark", (f) => f.alpha?.y3, (v) => pctTag(v))}
        ${row("Beats the market?", "vs its benchmark", beatRender)}
        ${row("Fund size", "", (f) => fmtAum(f.aum_cr))}
        ${row("Benchmark", "", (f) => `<span class="text-xs text-slate-500">${escapeHtml(f.benchmark || "—")}</span>`)}
        ${row("Started", "", (f) => `<span class="text-xs text-slate-500">${escapeHtml(fmtDate(f.inception))}</span>`)}
      </tbody>
    </table>
  </div>`;
}

function emptyState() {
  return `<div class="flex flex-col items-center justify-center gap-3 rounded-2xl bg-slate-50/70 py-16 text-center ring-1 ring-slate-200/60">
    <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 text-violet-500 ring-1 ring-violet-100"><i data-lucide="scale" class="h-8 w-8"></i></div>
    <h3 class="font-display text-lg font-semibold text-slate-700">Nothing to compare yet</h3>
    <p class="max-w-md text-sm text-slate-500">Search above to add funds, or tap <span class="font-semibold text-slate-600">“Add to compare”</span> on any fund in the Screener, Leaderboard, or a fund’s details.</p>
  </div>`;
}

// ── paint the tab ─────────────────────────────────────────────────────────────
function paint() {
  if (!_sec) return;
  const list = ids.map(fundById).filter(Boolean);
  ids = list.map((f) => f.id); // drop any stale ids
  _sec.innerHTML = `<div class="card p-4 sm:p-6">
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display text-lg font-bold text-slate-800">Compare funds</h2>
        <p class="text-sm text-slate-500">Add up to ${MAX} funds and see them side by side, in plain English. The <span class="font-semibold text-violet-600">best</span> in each row is highlighted.</p>
      </div>
      ${list.length ? `<button type="button" data-cmp-clear class="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"><i data-lucide="trash-2" class="h-4 w-4"></i> Clear all</button>` : ""}
    </div>
    ${addBar(list.length >= MAX)}
    <div class="mt-5">${list.length ? compareTable(list) : emptyState()}</div>
  </div>`;
  refreshIcons();
}

/** Tab entry point (app.js RENDERERS). */
export function renderCompare(sec) {
  if (!sec) return;
  _sec = sec;
  paint();
}

// ── one-time wiring (called from app boot) ────────────────────────────────────
export function mountCompare() {
  renderNavPill();
  if (_bound) return;
  _bound = true;
  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-cmp-add]");
    if (add) { e.preventDefault(); toggleCompare(add.getAttribute("data-cmp-add")); return; }
    const pick = e.target.closest("[data-cmp-pick]");
    if (pick) { e.preventDefault(); toggleCompare(pick.getAttribute("data-cmp-pick")); return; }
    const rm = e.target.closest("[data-cmp-remove]");
    if (rm) { e.preventDefault(); removeFromCompare(rm.getAttribute("data-cmp-remove")); return; }
    const view = e.target.closest("[data-cmp-view]");
    if (view) { e.preventDefault(); openFundDrill(view.getAttribute("data-cmp-view")); return; }
    if (e.target.closest("[data-cmp-clear]")) { clearCompare(); return; }
    if (e.target.closest("[data-cmp-goto]")) { document.querySelector('.tab-btn[data-tab="compare"]')?.click(); return; }
    // a hide-the-dropdown / refresh-the-pill catch-all
    if (!e.target.closest("#cmp-search-results") && !e.target.closest("#cmp-search")) renderPicks("");
    if (e.target.closest(".tab-btn")) requestAnimationFrame(renderNavPill);
  });
  document.addEventListener("input", (e) => { if (e.target.id === "cmp-search") renderPicks(e.target.value); });
}
