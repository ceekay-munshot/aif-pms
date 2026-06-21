// compare.js — Fund Screener — MGA · "compare like phones" (idea #17).
//
// Pick up to 3 funds (a "+ Compare" button on Screener rows and in the fund-drill),
// see a floating tray, then open a plain-English side-by-side card: type, category,
// star rating, "₹1 grew to", 1/3/5-year returns, beats-the-market, size, benchmark.
// Adding is wired by event delegation on [data-cmp-add]; no per-render binding.

import { fundById, starRating } from "./data.js";
import {
  escapeHtml, initials, managerColor, categoryPill, fmtPct, pctColor, fmtAum,
  starsHtml, growthMultiple, refreshIcons,
} from "./ui.js";

const MAX = 3;
const $ = (id) => document.getElementById(id);
let ids = [];
let _open = false;
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

export function toggleCompare(id) {
  if (!id) return;
  if (inCompare(id)) ids = ids.filter((x) => x !== id);
  else if (ids.length >= MAX) { toast(`Compare up to ${MAX} funds — remove one first.`); return; }
  else ids = [...ids, id];
  syncButtons();
  renderTray();
}
function removeFromCompare(id) { ids = ids.filter((x) => x !== id); syncButtons(); renderTray(); if (_open && ids.length < 2) closeCompare(); else if (_open) refreshOpen(); }
function clearCompare() { ids = []; syncButtons(); renderTray(); closeCompare(); }

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

// ── floating tray ─────────────────────────────────────────────────────────────
function renderTray() {
  const tray = $("cmp-tray");
  if (!tray) return;
  if (!ids.length) { tray.classList.add("hidden"); tray.innerHTML = ""; return; }
  tray.classList.remove("hidden");
  const chips = ids.map((id) => {
    const f = fundById(id);
    return `<span class="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs">
      <span class="max-w-[130px] truncate">${escapeHtml(f?.approach || f?.manager || id)}</span>
      <button type="button" data-cmp-remove="${escapeHtml(id)}" class="text-white/60 transition hover:text-white" aria-label="Remove">✕</button></span>`;
  }).join("");
  const ready = ids.length >= 2;
  tray.innerHTML = `<div class="flex items-center gap-2 rounded-2xl bg-slate-900/95 px-3 py-2 text-white shadow-xl ring-1 ring-white/10 backdrop-blur">
    <span class="hidden px-1 text-sm font-semibold sm:inline">Compare</span>
    <div class="flex flex-wrap items-center gap-1">${chips}</div>
    <button type="button" data-cmp-open ${ready ? "" : "disabled"} class="rounded-full px-3 py-1.5 text-sm font-semibold transition ${ready ? "bg-violet-500 hover:bg-violet-400" : "cursor-not-allowed bg-white/10 text-white/40"}">Compare ${ids.length}</button>
    <button type="button" data-cmp-clear class="rounded-full px-2 py-1 text-xs text-white/60 transition hover:text-white">Clear</button>
  </div>`;
}

// ── side-by-side modal ────────────────────────────────────────────────────────
function vehicleBadge(v) {
  const c = v === "AIF" ? "#EC4899" : "#6366F1";
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold" style="color:${c};background:${c}1a;box-shadow:inset 0 0 0 1px ${c}33;">${escapeHtml(v || "—")}</span>`;
}
const beats = (f) => { const a = f.alpha?.y3 ?? f.alpha?.y1 ?? null; return a == null ? null : a > 0; };
const grew3y = (f) => {
  const m = growthMultiple("y3", f.returns?.y3);
  return m == null ? `<span class="text-slate-400">—</span>` : `₹1 → <b class="text-slate-800">₹${m.toFixed(2)}</b> <span class="text-slate-400">(${m.toFixed(1)}×)</span>`;
};
function ratingCell(id) {
  const r = starRating(id);
  if (!r) return `<span class="text-slate-400">—</span>`;
  return `${starsHtml(r.stars)}<div class="mt-0.5 text-[11px] text-slate-400">better than ${Math.round(r.pct * 100)}%</div>`;
}
const pctCell = (v) => `<span class="font-mono font-semibold ${pctColor(v)}">${fmtPct(v)}</span>`;
const beatCell = (f) => { const b = beats(f); return b == null ? `<span class="text-slate-400">—</span>` : b ? `<span class="font-semibold text-emerald-600">✅ Yes</span>` : `<span class="font-semibold text-rose-500">❌ No</span>`; };

function compareTable(list) {
  const funds = list.map(fundById).filter(Boolean);
  const head = funds.map((f) => `<th class="min-w-[150px] border-b border-slate-100 px-3 pb-3 align-bottom">
    <div class="flex flex-col items-center gap-1.5 text-center">
      <div class="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold text-white" style="background:${managerColor(f.manager || f.id)};">${escapeHtml(initials(f.manager))}</div>
      <p class="line-clamp-2 text-sm font-bold leading-tight text-slate-800">${escapeHtml(f.approach || "—")}</p>
      <p class="text-[11px] text-slate-400">${escapeHtml(f.manager || "—")}</p>
      <button type="button" data-cmp-remove="${escapeHtml(f.id)}" class="text-[11px] font-medium text-slate-400 hover:text-rose-500">remove</button>
    </div></th>`).join("");
  const row = (label, cell, plain) => `<tr class="border-b border-slate-50">
    <td class="whitespace-nowrap py-2.5 pr-4 text-xs font-semibold text-slate-500">${label}${plain ? `<div class="font-normal text-slate-400">${plain}</div>` : ""}</td>
    ${funds.map((f) => `<td class="px-3 py-2.5 text-center text-sm text-slate-700">${cell(f)}</td>`).join("")}
  </tr>`;
  return `<div class="overflow-x-auto scroll-area">
    <table class="w-full">
      <thead><tr><th class="px-3 pb-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Fund</th>${head}</tr></thead>
      <tbody>
        ${row("Type", (f) => vehicleBadge(f.vehicle))}
        ${row("Category", (f) => categoryPill(f.category))}
        ${row("Rating", (f) => ratingCell(f.id), "vs all funds")}
        ${row("Money growth", (f) => grew3y(f), "over 3 years")}
        ${row("Return", (f) => pctCell(f.returns?.y1), "1 year")}
        ${row("Return", (f) => pctCell(f.returns?.y3), "3 years")}
        ${row("Return", (f) => pctCell(f.returns?.y5), "5 years")}
        ${row("Beats the market?", (f) => beatCell(f), "vs its benchmark")}
        ${row("Fund size", (f) => fmtAum(f.aum_cr))}
        ${row("Benchmark", (f) => `<span class="text-xs text-slate-500">${escapeHtml(f.benchmark || "—")}</span>`)}
      </tbody>
    </table>
  </div>`;
}

function refreshOpen() { const { content } = els(); if (content) { content.innerHTML = headerHtml() + compareTable(ids); refreshIcons(); } }
function headerHtml() {
  return `<div class="mb-4 flex items-start justify-between gap-4">
    <div>
      <h3 class="font-display text-lg font-bold text-slate-800">Compare funds</h3>
      <p class="text-sm text-slate-500">Side by side, in plain English.</p>
    </div>
    <button type="button" data-cmp-close class="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="Close">✕</button>
  </div>`;
}

function els() { return { overlay: $("cmp-overlay"), panel: $("cmp-panel"), content: $("cmp-content") }; }
export function openCompare() {
  if (ids.length < 2) return;
  const { overlay, panel, content } = els();
  if (!overlay || !panel || !content) return;
  content.innerHTML = headerHtml() + compareTable(ids);
  overlay.classList.remove("hidden");
  panel.classList.remove("hidden");
  panel.classList.add("flex");
  document.body.style.overflow = "hidden";
  _open = true;
  refreshIcons();
}
function closeCompare() {
  const { overlay, panel } = els();
  if (!overlay) return;
  overlay.classList.add("hidden");
  panel.classList.add("hidden");
  panel.classList.remove("flex");
  document.body.style.overflow = "";
  _open = false;
}

// ── one-time wiring (called from app boot) ────────────────────────────────────
export function mountCompare() {
  renderTray();
  if (_bound) return;
  _bound = true;
  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-cmp-add]");
    if (add) { e.preventDefault(); toggleCompare(add.getAttribute("data-cmp-add")); return; }
    const rm = e.target.closest("[data-cmp-remove]");
    if (rm) { e.preventDefault(); removeFromCompare(rm.getAttribute("data-cmp-remove")); return; }
    if (e.target.closest("[data-cmp-open]")) { openCompare(); return; }
    if (e.target.closest("[data-cmp-clear]")) { clearCompare(); return; }
    if (e.target.closest("[data-cmp-close]")) { closeCompare(); return; }
    const panel = $("cmp-panel");
    if (e.target === $("cmp-overlay") || e.target === panel) closeCompare();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && _open) closeCompare(); });
}
