// app.js — Fund Screener — MGA · boot + shell behaviour (step 9: real data).
//
// Loads the committed data via the shared data layer, renders the performance KPI
// strip, and wires tabs. The Screener tab shows a TEMPORARY "Top 25 by 1Y" list
// (every row opens the shared fund-drill) — prompt 10 replaces it with the full
// filterable Screener. Leaderboard / Categories / Movers stay placeholders (11).

import {
  countUp, fmtPct, pctColor, fmtMonth, escapeHtml, initials, managerColor,
  categoryPill, emptyState, refreshIcons, resizeCharts,
} from "./ui.js";
import * as data from "./data.js";
import { openFundDrill, vehiclePill } from "./drill.js";

const $ = (id) => document.getElementById(id);
const TABS = ["screener", "leaderboard", "categories", "movers"];

// --- KPI strip (performance-forward) ----------------------------------------
function kpiCard({ label, icon, valueHtml, subHtml }) {
  return `<div class="card card-hover relative overflow-hidden p-4 sm:p-5">
    <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-500"></div>
    <div class="flex items-center justify-between">
      <p class="text-xs font-medium uppercase tracking-wide text-slate-400">${label}</p>
      <i data-lucide="${icon}" class="h-4 w-4 text-slate-300"></i>
    </div>
    <div class="mt-2 font-display text-2xl font-bold text-slate-800 sm:text-3xl">${valueHtml}</div>
    <p class="mt-1 text-xs font-medium text-slate-400">${subHtml || "&nbsp;"}</p>
  </div>`;
}

function renderKpis(meta, s) {
  const strip = $("kpi-strip");
  if (!strip) return;
  strip.innerHTML = [
    kpiCard({
      label: "Funds Tracked", icon: "briefcase",
      valueHtml: `<span id="kpi-funds">0</span>`,
      subHtml: `${(meta.pms_count ?? 0).toLocaleString("en-IN")} PMS · ${(meta.aif_count ?? 0).toLocaleString("en-IN")} AIF`,
    }),
    kpiCard({
      label: "Median 1Y", icon: "trending-up",
      valueHtml: `<span class="${pctColor(s.medianY1)}">${fmtPct(s.medianY1)}</span>`,
      subHtml: `median alpha <span class="${pctColor(s.medianAlphaY1)}">${fmtPct(s.medianAlphaY1)}</span>`,
    }),
    kpiCard({
      label: "Median 3Y", icon: "calendar-range",
      valueHtml: `<span class="${pctColor(s.medianY3)}">${fmtPct(s.medianY3)}</span>`,
      subHtml: "annualised (CAGR)",
    }),
    kpiCard({
      label: "Beating Benchmark (1Y)", icon: "target",
      valueHtml: `<span id="kpi-beating">0</span><span class="text-slate-300">%</span>`,
      subHtml: `${s.beatingCount.toLocaleString("en-IN")} of ${s.beatingDenom.toLocaleString("en-IN")} with 1Y alpha`,
    }),
  ].join("");

  countUp($("kpi-funds"), meta.fund_count ?? 0);
  countUp($("kpi-beating"), Math.round(s.beatingPct));
}

// --- Screener (TEMPORARY Top-25 stopgap — replaced by prompt 10) -------------
function fundRow(f, n) {
  const color = managerColor(f.manager || f.id);
  const num = (v) => `<td class="px-3 py-2.5 text-right font-mono text-sm ${pctColor(v)}">${fmtPct(v)}</td>`;
  return `<tr class="cursor-pointer border-t border-slate-100 transition hover:bg-violet-50/40" data-id="${escapeHtml(f.id)}">
    <td class="px-3 py-2.5 text-right font-mono text-xs text-slate-400">${n}</td>
    <td class="px-3 py-2.5">
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style="background:${color};">${escapeHtml(initials(f.manager))}</div>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-slate-700">${escapeHtml(f.approach || "—")}</p>
          <p class="truncate text-xs text-slate-400">${escapeHtml(f.manager || "—")}</p>
        </div>
      </div>
    </td>
    <td class="px-3 py-2.5">${vehiclePill(f.vehicle)}</td>
    <td class="hidden px-3 py-2.5 md:table-cell">${categoryPill(f.category)}</td>
    ${num(f.returns?.y1)}
    ${num(f.returns?.y3)}
    ${num(f.alpha?.y1)}
  </tr>`;
}

function renderScreener() {
  const sec = $("tab-screener");
  if (!sec) return;
  const rows = data.topN("y1", 25);
  sec.innerHTML = `
    <div class="card p-4 sm:p-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 class="font-display text-lg font-bold text-slate-800">Top 25 by 1-Year Return</h2>
          <p class="text-sm text-slate-500">Temporary preview — the full filterable Screener arrives in prompt 10.</p>
        </div>
        <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">${data.funds().length.toLocaleString("en-IN")} funds</span>
      </div>
      <div class="overflow-x-auto scroll-area">
        <table class="w-full">
          <thead>
            <tr class="text-[11px] uppercase tracking-wide text-slate-400">
              <th class="px-3 py-2 text-right font-semibold">#</th>
              <th class="px-3 py-2 text-left font-semibold">Fund</th>
              <th class="px-3 py-2 text-left font-semibold">Vehicle</th>
              <th class="hidden px-3 py-2 text-left font-semibold md:table-cell">Category</th>
              <th class="px-3 py-2 text-right font-semibold">1Y</th>
              <th class="px-3 py-2 text-right font-semibold">3Y</th>
              <th class="px-3 py-2 text-right font-semibold">α 1Y</th>
            </tr>
          </thead>
          <tbody>${rows.map((f, i) => fundRow(f, i + 1)).join("")}</tbody>
        </table>
      </div>
    </div>`;
  sec.querySelectorAll("tr[data-id]").forEach((tr) =>
    tr.addEventListener("click", () => openFundDrill(tr.dataset.id))
  );
}

// --- Placeholders (built in prompt 11) --------------------------------------
function renderPlaceholder(tab) {
  const sec = $(`tab-${tab}`);
  if (sec) sec.innerHTML = emptyState("hammer", "Built in prompt 11", "Leaderboard, Categories and Movers arrive next.");
}

const _rendered = new Set();
function showTab(name) {
  document.querySelectorAll(".tab-btn").forEach((btn) =>
    btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false")
  );
  TABS.forEach((t) => {
    const sec = $(`tab-${t}`);
    if (sec) sec.hidden = t !== name;
  });
  if (!_rendered.has(name)) {
    if (name === "screener") renderScreener();
    else renderPlaceholder(name);
    _rendered.add(name);
  }
  refreshIcons();
}

// --- Boot -------------------------------------------------------------------
async function boot() {
  const { meta, dataError } = await data.init();
  const loader = $("boot-loader");

  if (dataError) {
    const strip = $("kpi-strip");
    if (strip) strip.innerHTML = "";
    const sec = $("tab-screener");
    if (sec) {
      sec.hidden = false;
      sec.innerHTML = emptyState("triangle-alert", "Couldn't load fund data", "data/funds-performance.json failed to load. Check the data files and reload.");
    }
    refreshIcons();
    loader?.remove();
    return;
  }

  const label = $("updated-label");
  if (label) label.textContent = `Updated ${fmtMonth(meta.as_of_month)}`;

  renderKpis(meta, data.summary());

  document.querySelectorAll(".tab-btn").forEach((btn) =>
    btn.addEventListener("click", () => showTab(btn.dataset.tab))
  );
  showTab("screener");

  $("export-btn")?.addEventListener("click", () => console.info("Export: implemented in prompt 11."));
  window.addEventListener("resize", resizeCharts);

  refreshIcons();
  loader?.remove();
}

boot();
