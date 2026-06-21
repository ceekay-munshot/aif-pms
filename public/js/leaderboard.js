// leaderboard.js — Fund Screener — MGA · "who's on top" (step 11).
//
// Period + Return/Alpha + vehicle + optional category controls, a podium for the
// top 3, and a ranked top-25 list below. Reuses data.topN; every row/podium card
// opens the shared fund-drill.

import {
  escapeHtml, initials, managerColor, categoryPill, fmtPct, pctColor, refreshIcons,
} from "./ui.js";
import * as data from "./data.js";
import { openFundDrill, vehiclePill } from "./drill.js";

const PERIODS = [
  ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["y1", "1Y"],
  ["y2", "2Y"], ["y3", "3Y"], ["y5", "5Y"], ["si", "SI"],
];
const PL = Object.fromEntries(PERIODS);
const MEDAL = { 1: "#F59E0B", 2: "#94A3B8", 3: "#F97316" };
const PRESETS = [
  ["Best 1Y", { period: "y1", mode: "returns" }],
  ["Best 3Y", { period: "y3", mode: "returns" }],
  ["Best 5Y", { period: "y5", mode: "returns" }],
  ["Best Alpha 3Y", { period: "y3", mode: "alpha" }],
];

const F = { period: "y1", mode: "returns", vehicle: "", category: "" };
const $ = (id) => document.getElementById(id);
const metric = () => (F.mode === "alpha" ? "alpha_" : "") + F.period;
const metricLabel = () => `${PL[F.period]}${F.mode === "alpha" ? " alpha" : ""}`;

function seg(id, opts, active) {
  return `<div id="${id}" class="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-1">
    ${opts.map((o) => `<button data-val="${o.val}" class="lb-seg rounded-full px-3 py-1 text-xs font-semibold transition ${o.val === active ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}">${o.label}</button>`).join("")}
  </div>`;
}
const onSeg = (id, cb) => $(id)?.addEventListener("click", (e) => {
  const b = e.target.closest(".lb-seg"); if (b) cb(b.dataset.val);
});

// Count a percent value up from 0 (keeps one decimal + sign).
function animatePct(el, val) {
  if (!el) return;
  if (val == null || Number.isNaN(val)) { el.textContent = "—"; return; }
  const dur = 850, start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmtPct(val * e);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmtPct(val);
  };
  requestAnimationFrame(step);
}

function avatar(f, size = "h-10 w-10", text = "text-xs") {
  return `<div class="flex ${size} shrink-0 items-center justify-center rounded-xl ${text} font-bold text-white shadow-sm" style="background:${managerColor(f.manager || f.id)};">${escapeHtml(initials(f.manager))}</div>`;
}

function podiumCard(f, rank) {
  const v = data.metricValue(f, metric());
  const lift = rank === 1 ? "sm:-translate-y-3" : "";
  const ring = rank === 1 ? "ring-2 ring-amber-300" : "ring-1 ring-slate-200/70";
  return `<button data-id="${escapeHtml(f.id)}" class="lb-card group relative flex w-full flex-col items-center gap-2 rounded-3xl bg-white p-5 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${lift} ${ring}">
    <span class="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full text-white shadow" style="background:${MEDAL[rank]};"><i data-lucide="medal" class="h-4 w-4"></i></span>
    <div class="mt-2">${avatar(f, "h-14 w-14", "text-base")}</div>
    <p class="line-clamp-2 font-display text-sm font-bold leading-tight text-slate-800">${escapeHtml(f.approach || "—")}</p>
    <p class="-mt-1 truncate text-xs text-slate-400 max-w-full">${escapeHtml(f.manager || "—")}</p>
    <p class="lb-val font-display text-2xl font-extrabold ${pctColor(v)}">—</p>
    <div class="flex flex-wrap items-center justify-center gap-1">${vehiclePill(f.vehicle)}${categoryPill(f.category)}</div>
  </button>`;
}

function listRow(f, rank) {
  const v = data.metricValue(f, metric());
  return `<button data-id="${escapeHtml(f.id)}" class="lb-card flex w-full items-center gap-3 border-t border-slate-100 px-2 py-2.5 text-left transition hover:bg-violet-50">
    <span class="w-6 shrink-0 text-right font-mono text-xs text-slate-400">${rank}</span>
    ${avatar(f, "h-9 w-9", "text-[11px]")}
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-slate-700">${escapeHtml(f.approach || "—")}</p>
      <div class="mt-0.5 flex items-center gap-1.5">${vehiclePill(f.vehicle)}<span class="truncate text-xs text-slate-400">${escapeHtml(f.manager || "—")}</span></div>
    </div>
    <span class="hidden sm:block">${categoryPill(f.category)}</span>
    <span class="shrink-0 font-mono text-sm font-bold ${pctColor(v)} whitespace-nowrap">${fmtPct(v)}</span>
  </button>`;
}

function presetBar() {
  return PRESETS.map(([label, p]) => {
    const on = p.period === F.period && p.mode === F.mode;
    return `<button data-preset="${label}" class="rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? "bg-violet-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}">${label}</button>`;
  }).join("");
}

function categoryOptions() {
  const xs = data.filterFunds({ vehicle: F.vehicle || undefined });
  const counts = new Map();
  for (const f of xs) counts.set(f.category, (counts.get(f.category) || 0) + 1);
  const opts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return `<option value="">All categories</option>` +
    opts.map(([c, n]) => `<option value="${escapeHtml(c)}"${c === F.category ? " selected" : ""}>${escapeHtml(catLabel(c))} (${n})</option>`).join("");
}

// local label (mirrors ui.categoryLabel without a hard import cycle on render)
const catLabel = (c) => (c === "Multi/Flexi Cap" ? "Diversified / Multi-Cap" : c);

let _sec = null;
export function renderLeaderboard(sec) {
  if (sec) _sec = sec;
  sec = _sec;
  if (!sec) return;
  const rows = data.topN(metric(), 25, { category: F.category || undefined, vehicle: F.vehicle || undefined });
  const inputCls = "rounded-xl border-0 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 outline-none ring-1 ring-transparent transition focus:bg-white focus:ring-violet-300";

  sec.innerHTML = `
    <div class="card p-4 sm:p-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 class="font-display text-lg font-bold text-slate-800">Leaderboard</h2>
          <p class="text-sm text-slate-500">Top performers by ${metricLabel()} — ${F.vehicle || "all vehicles"}${F.category ? " · " + catLabel(F.category) : ""}.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">${presetBar()}</div>
      </div>

      <div class="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div class="flex items-center gap-2"><span class="text-xs font-medium text-slate-400">Period</span>${seg("lb-period", PERIODS.map(([v, l]) => ({ val: v, label: l })), F.period)}</div>
        <div class="flex items-center gap-2"><span class="text-xs font-medium text-slate-400">Metric</span>${seg("lb-mode", [{ val: "returns", label: "Returns" }, { val: "alpha", label: "Alpha" }], F.mode)}</div>
        <div class="flex items-center gap-2"><span class="text-xs font-medium text-slate-400">Vehicle</span>${seg("lb-vehicle", [{ val: "", label: "All" }, { val: "PMS", label: "PMS" }, { val: "AIF", label: "AIF" }], F.vehicle)}</div>
        <select id="lb-category" class="${inputCls} max-w-[220px]">${categoryOptions()}</select>
      </div>

      <div id="lb-body"></div>
    </div>`;

  const body = $("lb-body");
  if (!rows.length) {
    body.innerHTML = `<div class="py-14 text-center"><div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><i data-lucide="search-x" class="h-7 w-7"></i></div>
      <h3 class="font-display text-lg font-semibold text-slate-700">No funds with a ${metricLabel()} value</h3>
      <p class="text-sm text-slate-500">Try another period, metric, or vehicle.</p></div>`;
  } else {
    const top3 = rows.slice(0, 3), rest = rows.slice(3);
    const order = [2, 1, 3]; // visual: silver · gold · bronze
    const podium = `<div class="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
      ${order.filter((r) => top3[r - 1]).map((r) => `<div class="${r === 1 ? "order-first sm:order-none" : ""}">${podiumCard(top3[r - 1], r)}</div>`).join("")}
    </div>`;
    const list = rest.length
      ? `<div class="mt-6 rounded-2xl bg-white p-2 ring-1 ring-slate-200/70">
          <p class="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Ranked 4–${rows.length}</p>
          ${rest.map((f, i) => listRow(f, i + 4)).join("")}
        </div>`
      : "";
    body.innerHTML = podium + list;
    // count-up each podium card's metric value
    sec.querySelectorAll(".grid .lb-card").forEach((card) => {
      const f = data.fundById(card.dataset.id);
      animatePct(card.querySelector(".lb-val"), data.metricValue(f, metric()));
    });
  }

  // wire controls
  onSeg("lb-period", (v) => { F.period = v; renderLeaderboard(); });
  onSeg("lb-mode", (v) => { F.mode = v; renderLeaderboard(); });
  onSeg("lb-vehicle", (v) => { F.vehicle = v; F.category = ""; renderLeaderboard(); });
  $("lb-category")?.addEventListener("change", (e) => { F.category = e.target.value; renderLeaderboard(); });
  sec.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    const p = PRESETS.find(([l]) => l === b.dataset.preset)[1];
    Object.assign(F, p); renderLeaderboard();
  }));
  sec.querySelectorAll(".lb-card").forEach((el) => el.addEventListener("click", () => openFundDrill(el.dataset.id)));
  refreshIcons();
}
