// app.js — Fund Screener — MGA · boot + shell behaviour (step 11: full build).
//
// Loads the committed data via the shared data layer, renders the performance KPI
// strip, and wires the four tabs (Screener / Leaderboard / Categories / Movers)
// plus the header Export button. Every tab opens the shared fund-drill on click.

import {
  countUp, fmtPct, pctColor, fmtMonth, emptyState, refreshIcons, resizeCharts,
} from "./ui.js";
import * as data from "./data.js";
import { renderScreener, focusCategory } from "./screener.js";
import { renderLeaderboard } from "./leaderboard.js";
import { renderCategories } from "./categories.js";
import { renderMovers } from "./movers.js";
import { exportData } from "./export.js";
import { mountCompare } from "./compare.js";
import { getInsight } from "./newspaper.js";

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
      valueHtml: `<span id="kpi-beating">0</span><span class="text-slate-500">%</span>`,
      subHtml: `${s.beatingCount.toLocaleString("en-IN")} of ${s.beatingDenom.toLocaleString("en-IN")} with 1Y alpha`,
    }),
  ].join("");

  countUp($("kpi-funds"), meta.fund_count ?? 0);
  countUp($("kpi-beating"), Math.round(s.beatingPct));
}

// --- Tab routing ------------------------------------------------------------
const RENDERERS = {
  screener: renderScreener,
  leaderboard: renderLeaderboard,
  categories: renderCategories,
  movers: renderMovers,
};

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
    RENDERERS[name]?.($(`tab-${name}`));
    _rendered.add(name);
  }
  refreshIcons();
  // The newly-visible tab's charts may have sized to 0 while hidden — refit.
  requestAnimationFrame(resizeCharts);
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
  mountCompare(); // floating compare tray + side-by-side modal

  // Header Export → current Screener view (if filtered) else the full set.
  $("export-btn")?.addEventListener("click", (e) => exportData(e.currentTarget));
  // Header "Get Insight" → one-click Munshot Insights PDF.
  $("insight-btn")?.addEventListener("click", (e) => getInsight(e.currentTarget));
  // Categories tab deep-links into the Screener filtered to one category.
  document.addEventListener("screener:focus", (e) => {
    focusCategory(e.detail?.category);
    showTab("screener");
  });
  window.addEventListener("resize", resizeCharts);

  refreshIcons();
  loader?.remove();
}

boot();
