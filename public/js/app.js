// app.js — Fund Screener — MGA · boot + shell behaviour
//
// Prompt 1 scope: load placeholder data, render the KPI strip + "Updated" badge,
// and wire tab switching. Each tab body is a placeholder until prompts 10–11.

import {
  loadData,
  emptyState,
  countUp,
  fmtMonth,
  refreshIcons,
  resizeCharts,
} from "./ui.js";

const TABS = ["screener", "leaderboard", "categories", "movers"];

// --- KPI strip --------------------------------------------------------------
function kpiCard({ label, icon, valueHtml }) {
  return `<div class="card card-hover relative overflow-hidden p-4 sm:p-5">
    <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-500"></div>
    <div class="flex items-center justify-between">
      <p class="text-xs font-medium uppercase tracking-wide text-slate-400">${label}</p>
      <i data-lucide="${icon}" class="h-4 w-4 text-slate-300"></i>
    </div>
    <div class="mt-2 font-display text-2xl font-bold text-slate-800 sm:text-3xl">${valueHtml}</div>
  </div>`;
}

function renderKpis(meta) {
  const strip = document.getElementById("kpi-strip");
  if (!strip) return;
  strip.innerHTML = [
    kpiCard({ label: "Funds Tracked", icon: "briefcase", valueHtml: `<span id="kpi-funds">0</span>` }),
    kpiCard({ label: "Managers", icon: "users", valueHtml: `<span id="kpi-managers">0</span>` }),
    kpiCard({
      label: "PMS / AIF",
      icon: "git-compare-arrows",
      valueHtml: `<span id="kpi-pms">0</span><span class="text-slate-300"> / </span><span id="kpi-aif">0</span>`,
    }),
    kpiCard({ label: "Categories", icon: "layers", valueHtml: `<span id="kpi-categories">0</span>` }),
  ].join("");

  countUp(document.getElementById("kpi-funds"), meta.fund_count ?? 0);
  countUp(document.getElementById("kpi-managers"), meta.manager_count ?? 0);
  countUp(document.getElementById("kpi-pms"), meta.pms_count ?? 0);
  countUp(document.getElementById("kpi-aif"), meta.aif_count ?? 0);
  countUp(document.getElementById("kpi-categories"), meta.category_count ?? 0);
}

// --- Tab bodies (placeholders until prompts 10–11) --------------------------
function renderPlaceholder(tab) {
  const sec = document.getElementById(`tab-${tab}`);
  if (sec) {
    sec.innerHTML = emptyState(
      "hammer",
      "Built in a later prompt",
      "This view arrives in prompts 10–11.",
    );
  }
}

const _rendered = new Set();

function showTab(name) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.dataset.tab === name ? "true" : "false");
  });
  TABS.forEach((t) => {
    const sec = document.getElementById(`tab-${t}`);
    if (sec) sec.hidden = t !== name;
  });
  if (!_rendered.has(name)) {
    renderPlaceholder(name); // swap for the real renderer in prompts 10–11
    _rendered.add(name);
  }
  refreshIcons();
}

// --- Boot -------------------------------------------------------------------
async function boot() {
  const { meta, dataError } = await loadData();
  const loader = document.getElementById("boot-loader");

  if (dataError) {
    const strip = document.getElementById("kpi-strip");
    if (strip) strip.innerHTML = "";
    const sec = document.getElementById("tab-screener");
    if (sec) {
      sec.hidden = false;
      sec.innerHTML = emptyState(
        "triangle-alert",
        "Couldn't load fund data",
        "data/funds-performance.json failed to load. Check the data files and reload.",
      );
    }
    refreshIcons();
    loader?.remove();
    return;
  }

  // "Updated <month>" badge.
  const label = document.getElementById("updated-label");
  if (label) label.textContent = `Updated ${fmtMonth(meta.as_of_month)}`;

  renderKpis(meta);

  // Tab switching.
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  showTab("screener");

  // Export — full behaviour lands in prompt 11.
  document.getElementById("export-btn")?.addEventListener("click", () => {
    console.info("Export: implemented in prompt 11.");
  });

  window.addEventListener("resize", resizeCharts);

  refreshIcons();
  loader?.remove();
}

boot();
