// movers.js — Fund Screener — MGA · "what changed since last month" (step 11).
//
// Diffs the latest two monthly snapshots (data.monthlyDeltas). With one month so
// far it shows a polished accruing empty-state that previews what fills in; with
// two+ months it renders Climbers / Fallers / New entrants + 1Y-return change.
// Every card opens the fund-drill.

import {
  escapeHtml, initials, managerColor, fmtPct, pctColor, fmtMonth, refreshIcons,
} from "./ui.js";
import * as data from "./data.js";
import { openFundDrill, vehiclePill } from "./drill.js";

const $ = (id) => document.getElementById(id);

function avatar(f) {
  return `<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style="background:${managerColor(f.manager || f.id)};">${escapeHtml(initials(f.manager))}</div>`;
}

const rankChip = (delta) => {
  if (delta == null) return "";
  const up = delta > 0, flat = delta === 0;
  const c = flat ? "text-slate-400" : up ? "text-emerald-600" : "text-rose-500";
  const icon = flat ? "minus" : up ? "arrow-up" : "arrow-down";
  return `<span class="inline-flex items-center gap-0.5 font-mono text-xs font-bold ${c}"><i data-lucide="${icon}" class="h-3.5 w-3.5"></i>${Math.abs(delta)}</span>`;
};

function moverRow(r, kind) {
  const right = kind === "ret"
    ? `<span class="font-mono text-sm font-bold ${pctColor(r.y1_delta)} whitespace-nowrap">${r.y1_delta > 0 ? "+" : ""}${r.y1_delta != null ? r.y1_delta.toFixed(1) : "—"} pts</span>`
    : kind === "new"
      ? `<span class="font-mono text-sm font-bold ${pctColor(r.y1)} whitespace-nowrap">${fmtPct(r.y1)}</span>`
      : `${rankChip(r.rank_delta)}<span class="ml-2 font-mono text-xs text-slate-400">#${r.rank_prev ?? "—"}→#${r.rank_overall ?? "—"}</span>`;
  return `<button data-id="${escapeHtml(r.id)}" class="mv-card flex w-full items-center gap-3 border-t border-slate-100 px-2 py-2.5 text-left transition hover:bg-violet-50">
    ${avatar(r)}
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-slate-700">${escapeHtml(r.approach || "—")}</p>
      <div class="mt-0.5 flex items-center gap-1.5">${vehiclePill(r.vehicle)}<span class="truncate text-xs text-slate-400">${escapeHtml(r.manager || "—")}</span></div>
    </div>
    <span class="flex shrink-0 items-center">${right}</span>
  </button>`;
}

function panel(title, icon, accent, rows, kind) {
  const body = rows.length
    ? rows.map((r) => moverRow(r, kind)).join("")
    : `<p class="px-2 py-6 text-center text-sm text-slate-400">Nothing here this month.</p>`;
  return `<div class="card p-4">
    <h3 class="mb-1 flex items-center gap-2 font-display text-sm font-bold text-slate-800"><i data-lucide="${icon}" class="h-4 w-4 ${accent}"></i> ${title}</h3>
    <div class="-mx-2">${body}</div>
  </div>`;
}

function previewPanel(title, icon, accent, note) {
  return `<div class="card relative overflow-hidden p-4">
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-white/70"></div>
    <h3 class="mb-2 flex items-center gap-2 font-display text-sm font-bold text-slate-700"><i data-lucide="${icon}" class="h-4 w-4 ${accent}"></i> ${title}</h3>
    <div class="space-y-2">
      ${[70, 52, 38].map((w) => `<div class="flex items-center gap-3">
        <div class="h-9 w-9 shrink-0 rounded-lg bg-slate-100"></div>
        <div class="flex-1"><div class="h-2.5 rounded bg-slate-100" style="width:${w}%"></div><div class="mt-1.5 h-2 w-1/3 rounded bg-slate-50"></div></div>
        <div class="h-4 w-10 rounded bg-slate-100"></div>
      </div>`).join("")}
    </div>
    <p class="mt-3 text-xs text-slate-400">${escapeHtml(note)}</p>
  </div>`;
}

function renderAccruing(sec, latestMonth) {
  sec.innerHTML = `
    <div class="card relative overflow-hidden p-6 sm:p-8">
      <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-500"></div>
      <div class="flex flex-col items-center gap-3 text-center">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-500 ring-1 ring-violet-100"><i data-lucide="trending-up" class="h-7 w-7"></i></div>
        <h2 class="font-display text-xl font-bold text-slate-800">Movers builds from next month's data</h2>
        <p class="max-w-xl text-sm text-slate-500">Movers compares the two most recent monthly snapshots to surface who climbed, who slipped, and which funds are new. We have one snapshot so far — <span class="font-semibold text-slate-600">${escapeHtml(fmtMonth(latestMonth))}</span> — so there's nothing to diff yet. The monthly pipeline adds a snapshot each month; this tab lights up automatically after the next run.</p>
      </div>
      <div class="mt-7 grid grid-cols-1 gap-4 lg:grid-cols-3">
        ${previewPanel("Climbers", "arrow-up-circle", "text-emerald-500", "Biggest jumps in overall 1Y rank.")}
        ${previewPanel("Fallers", "arrow-down-circle", "text-rose-500", "Biggest drops in overall 1Y rank.")}
        ${previewPanel("New entrants", "sparkles", "text-amber-500", "Funds appearing for the first time.")}
      </div>
    </div>`;
  refreshIcons();
}

export function renderMovers(sec) {
  if (!sec) return;
  const d = data.monthlyDeltas();
  if (!d.hasPrior) { renderAccruing(sec, d.latest || data.asOfMonth()); return; }

  const climbers = d.rows.filter((r) => r.rank_delta != null && r.rank_delta > 0).sort((a, b) => b.rank_delta - a.rank_delta).slice(0, 10);
  const fallers = d.rows.filter((r) => r.rank_delta != null && r.rank_delta < 0).sort((a, b) => a.rank_delta - b.rank_delta).slice(0, 10);
  const entrants = d.rows.filter((r) => r.is_new).sort((a, b) => (b.y1 ?? -1e9) - (a.y1 ?? -1e9)).slice(0, 10);
  const retChange = d.rows.filter((r) => r.y1_delta != null).sort((a, b) => Math.abs(b.y1_delta) - Math.abs(a.y1_delta)).slice(0, 10);

  sec.innerHTML = `
    <div class="card p-4 sm:p-6">
      <h2 class="font-display text-lg font-bold text-slate-800">Movers</h2>
      <p class="text-sm text-slate-500">Change from <span class="font-semibold text-slate-600">${escapeHtml(fmtMonth(d.prior))}</span> to <span class="font-semibold text-slate-600">${escapeHtml(fmtMonth(d.latest))}</span> — by overall 1Y rank.</p>
    </div>
    <div class="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
      ${panel("Climbers", "arrow-up-circle", "text-emerald-500", climbers, "rank")}
      ${panel("Fallers", "arrow-down-circle", "text-rose-500", fallers, "rank")}
      ${panel("New entrants", "sparkles", "text-amber-500", entrants, "new")}
      ${panel("Biggest 1Y return change", "activity", "text-violet-500", retChange, "ret")}
    </div>`;
  sec.querySelectorAll(".mv-card").forEach((el) => el.addEventListener("click", () => openFundDrill(el.dataset.id)));
  refreshIcons();
}
