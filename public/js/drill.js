// drill.js — Fund Screener — MGA · shared fund-drill modal + reusable bits.
//
// openFundDrill(id) is the detail view every tab opens. Also exports the
// reusable return-ladder renderer, vehicle pill, and sparkline helper so the
// Screener / Leaderboard / Categories / Movers tabs (10–11) render consistently.

import {
  makeChart, fmtPct, pctColor, fmtAum, fmtDate, escapeHtml, initials,
  managerColor, categoryPill, refreshIcons, periodShort, starsHtml, growthMultiple,
} from "./ui.js";
import { fundById, fundHistory, fundRank, starRating } from "./data.js";
import { compareButton } from "./compare.js";

const PERIODS = [
  ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["y1", "1Y"],
  ["y2", "2Y"], ["y3", "3Y"], ["y5", "5Y"], ["si", "SI"],
];
const $ = (id) => document.getElementById(id);
const shortMonth = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return String(ym);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" }) + " '" + String(y).slice(2);
};

// ── reusable: vehicle pill (PMS indigo / AIF pink) ───────────────────────────
export function vehiclePill(v) {
  const c = v === "AIF" ? "#EC4899" : "#6366F1";
  return `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
    style="color:${c};background:${c}1a;box-shadow:inset 0 0 0 1px ${c}33;">${escapeHtml(v || "—")}</span>`;
}

const softChip = (text, icon) =>
  `<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
    ${icon ? `<i data-lucide="${icon}" class="h-3.5 w-3.5 text-slate-400"></i>` : ""}${escapeHtml(text)}</span>`;

// ── reusable: returns-vs-benchmark ladder table ──────────────────────────────
export function renderReturnLadder(f) {
  // Only show periods that actually carry a value somewhere — a Dec-2024 fund
  // has no 2Y/3Y/5Y, so those empty "—" columns are dropped (no dead space).
  const has = (p) =>
    (f.returns?.[p] ?? null) !== null ||
    (f.benchmark_returns?.[p] ?? null) !== null ||
    (f.alpha?.[p] ?? null) !== null;
  const cols = PERIODS.filter(([p]) => has(p));
  const periods = cols.length ? cols : PERIODS;
  const head = periods.map(
    ([p]) => `<th class="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">${periodShort(p)}</th>`
  ).join("");
  const cells = (obj, colored) =>
    periods.map(([p]) => {
      const v = obj?.[p];
      const cls = colored ? pctColor(v) : "text-slate-500";
      return `<td class="px-2 py-2 text-right ${cls}">${fmtPct(v)}</td>`;
    }).join("");
  const label = (t, cls) => `<td class="whitespace-nowrap py-2 pr-3 text-left text-xs font-semibold ${cls}">${t}</td>`;
  return `<div class="overflow-x-auto scroll-area rounded-2xl ring-1 ring-slate-200/70">
    <table class="w-full text-sm">
      <thead><tr class="bg-slate-50/70"><th class="rounded-tl-2xl py-2 pl-3 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Period</th>${head}</tr></thead>
      <tbody class="font-mono">
        <tr class="border-t border-slate-100">${label("Fund", "text-slate-700 pl-3")}${cells(f.returns, true)}</tr>
        <tr class="border-t border-slate-100">${label("Benchmark", "text-slate-400 pl-3")}${cells(f.benchmark_returns, false)}</tr>
        <tr class="border-t border-slate-100">${label("Alpha", "text-slate-700 pl-3")}${cells(f.alpha, true)}</tr>
      </tbody>
    </table>
  </div>`;
}

// ── reusable: 1Y-return history sparkline ────────────────────────────────────
export function fundSparkline(el, id) {
  if (!el) return;
  const hist = fundHistory(id);
  const chart = makeChart(el, "drill-spark");
  if (!chart) return;
  const g = window.echarts?.graphic;
  chart.setOption({
    grid: { left: 6, right: 14, top: 16, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", confine: true, valueFormatter: (v) => fmtPct(v) },
    xAxis: {
      type: "category", data: hist.map((h) => shortMonth(h.month)), boundaryGap: false,
      axisTick: { show: false }, axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisLabel: { color: "#94a3b8", fontSize: 11 },
    },
    yAxis: {
      type: "value", axisLabel: { formatter: (v) => v + "%", color: "#94a3b8", fontSize: 11 },
      splitLine: { lineStyle: { color: "#f1f5f9" } },
    },
    series: [{
      type: "line", data: hist.map((h) => h.y1), smooth: true, showSymbol: true, symbolSize: 7,
      lineStyle: { width: 3, color: "#8B5CF6" }, itemStyle: { color: "#8B5CF6" },
      areaStyle: g
        ? { color: new g.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(139,92,246,0.25)" }, { offset: 1, color: "rgba(139,92,246,0)" },
          ]) }
        : undefined,
    }],
  });
}

// ── drill markup ─────────────────────────────────────────────────────────────
function drillHtml(f) {
  const color = managerColor(f.manager || f.id);
  const rk = fundRank(f.id);
  const rankBadge =
    rk && (rk.rank_in_category != null || rk.rank_overall != null)
      ? `<div class="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200">
          <i data-lucide="medal" class="h-3.5 w-3.5"></i>
          ${rk.rank_in_category != null ? `#${rk.rank_in_category} in ${escapeHtml(f.category)}` : ""}${
          rk.rank_in_category != null && rk.rank_overall != null ? " · " : ""
        }${rk.rank_overall != null ? `#${rk.rank_overall} overall` : ""}</div>`
      : `<div class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
          <i data-lucide="minus" class="h-3.5 w-3.5"></i> Unranked (no 1Y return)</div>`;

  const stat = (label, value) =>
    `<div class="rounded-xl bg-slate-50 px-3 py-2">
      <p class="text-[11px] font-medium uppercase tracking-wide text-slate-400">${label}</p>
      <p class="mt-0.5 truncate text-sm font-semibold text-slate-700">${value}</p></div>`;

  const stratChips = [
    f.strategy ? softChip(f.strategy, "git-compare-arrows") : "",
    f.aif_cat ? softChip(f.aif_cat, "shield") : "",
  ].join("");

  // ★ rating (#10)
  const sr = starRating(f.id);
  const starsBadge = sr
    ? `<span class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">${starsHtml(sr.stars)}<span class="text-amber-600/80">better than ${Math.round(sr.pct * 100)}% of funds</span></span>`
    : "";

  const h4 = (icon, text) => `<h4 class="mb-2 flex items-center gap-2 font-display text-sm font-semibold text-slate-700"><i data-lucide="${icon}" class="h-4 w-4 text-slate-400"></i> ${text}</h4>`;

  // "What ₹1 would've become" (#6) — columns track the number of cards so a
  // young fund with only a 1-year figure doesn't leave two empty cells.
  const growCard = (p, lbl) => {
    const m = growthMultiple(p, f.returns?.[p]);
    if (m == null) return "";
    return `<div class="rounded-xl bg-slate-50 px-3 py-3 text-center ring-1 ring-slate-100">
      <p class="text-[11px] font-medium uppercase tracking-wide text-slate-400">${lbl}</p>
      <p class="mt-0.5 text-base font-bold text-slate-800">₹1 → ₹${m.toFixed(2)}</p>
      <p class="text-[11px] text-slate-400">${m.toFixed(1)}× your money</p></div>`;
  };
  const growList = [growCard("y1", "1 year"), growCard("y3", "3 years"), growCard("y5", "5 years")].filter(Boolean);
  const growBody = growList.length
    ? `<div class="grid gap-2" style="grid-template-columns:repeat(${growList.length},minmax(0,1fr))">${growList.join("")}</div>
       <p class="mt-2 text-[11px] text-slate-400">If you'd invested and stayed in — from reported returns; past performance isn't a promise.</p>`
    : `<p class="text-sm text-slate-400">Not enough return history to project growth yet.</p>`;
  const growSection = `${h4("piggy-bank", "What ₹1 would've become")}${growBody}`;

  // 1-Year return history: a real trend line once ≥2 snapshots exist, else a
  // clean "latest 1Y" highlight — no lonely dot floating in an empty chart.
  const hist = fundHistory(f.id);
  const historySection = hist.length >= 2
    ? `${h4("activity", "1-Year return history")}<div id="drill-spark" class="chart-box" style="height:210px;"></div>`
    : `${h4("activity", "Latest 1-year return")}
       <div class="flex flex-1 flex-col items-center justify-center rounded-xl bg-gradient-to-br from-violet-50 to-fuchsia-50 px-5 py-8 text-center ring-1 ring-violet-100">
         <p class="font-display text-4xl font-extrabold ${pctColor(f.returns?.y1)}">${fmtPct(f.returns?.y1)}</p>
         <p class="mt-2 max-w-[16rem] text-xs text-slate-500">History builds monthly — a trend line appears once there's a second snapshot.</p>
       </div>`;

  return `
    <div class="flex items-start justify-between gap-4">
      <div class="flex min-w-0 items-start gap-3">
        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm"
             style="background:${color};">${escapeHtml(initials(f.manager))}</div>
        <div class="min-w-0">
          <h3 class="font-display text-xl font-bold leading-tight text-slate-800">${escapeHtml(f.approach || "—")}</h3>
          <p class="truncate text-sm text-slate-500">${escapeHtml(f.manager || "—")}</p>
        </div>
      </div>
      <button data-drill-close class="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
        <i data-lucide="x" class="h-5 w-5"></i>
      </button>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      ${vehiclePill(f.vehicle)} ${categoryPill(f.category)} ${stratChips}
      ${rankBadge} ${starsBadge} ${compareButton(f.id, "full")}
    </div>

    <div class="mt-5 space-y-4">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        ${stat("Benchmark", escapeHtml(f.benchmark || "—"))}
        ${stat("AUM", fmtAum(f.aum_cr))}
        ${stat("Inception", fmtDate(f.inception))}
      </div>
      <div>${h4("table", "Returns vs benchmark")}${renderReturnLadder(f)}</div>
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">${growSection}</div>
        <div class="flex flex-col rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">${historySection}</div>
      </div>
    </div>`;
}

// ── open / close ─────────────────────────────────────────────────────────────
let _bound = false;
let _open = false;
let _lastFocus = null;

function els() {
  return { overlay: $("drill-overlay"), panel: $("drill-panel"), card: $("drill-card"), content: $("drill-content") };
}

// Keep Tab focus inside the open modal (basic focus trap).
function focusables(card) {
  return [...card.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
}
function trapTab(e) {
  const card = $("drill-card");
  if (!card) return;
  const list = focusables(card);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function setFrom(card, overlay, panel) {
  overlay.style.opacity = "0";
  panel.style.opacity = "0";
  card.style.opacity = "0";
  card.style.transform = "translateY(12px) scale(0.985)";
}

export function closeFundDrill() {
  const { overlay, panel, card } = els();
  if (!overlay || !_open) return;
  _open = false;
  setFrom(card, overlay, panel);
  setTimeout(() => {
    overlay.classList.add("hidden");
    panel.classList.add("hidden");
    panel.classList.remove("flex");
    document.body.style.overflow = "";
    _lastFocus?.focus?.(); // return focus to whatever opened the drill
    _lastFocus = null;
  }, 280);
}

export function openFundDrill(id) {
  const f = fundById(id);
  const { overlay, panel, card, content } = els();
  if (!f || !overlay || !panel || !card || !content) return;

  bindOnce();
  _lastFocus = document.activeElement; // remember opener for focus restore
  content.innerHTML = drillHtml(f);
  content.scrollTop = 0;
  card.classList.remove("translate-y-4", "opacity-0"); // hand control to inline styles

  overlay.classList.remove("hidden");
  panel.classList.remove("hidden");
  panel.classList.add("flex");
  document.body.style.overflow = "hidden";
  setFrom(card, overlay, panel);
  _open = true;

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      panel.style.opacity = "1";
      card.style.opacity = "1";
      card.style.transform = "translateY(0) scale(1)";
    })
  );

  refreshIcons();
  // Move focus into the modal (close button) for keyboard users.
  requestAnimationFrame(() => card.querySelector("[data-drill-close]")?.focus());
  // Render the sparkline once the panel has laid out (so ECharts sizes correctly).
  requestAnimationFrame(() => fundSparkline($("drill-spark"), f.id));
}

function bindOnce() {
  if (_bound) return;
  _bound = true;
  const { overlay, panel, card } = els();
  overlay?.addEventListener("click", closeFundDrill);
  panel?.addEventListener("click", (e) => {
    if (e.target === panel) closeFundDrill(); // click on backdrop area
  });
  card?.addEventListener("click", (e) => {
    if (e.target.closest("[data-drill-close]")) closeFundDrill();
  });
  document.addEventListener("keydown", (e) => {
    if (!_open) return;
    if (e.key === "Escape") closeFundDrill();
    else if (e.key === "Tab") trapTab(e);
  });
}
