// categories.js — Fund Screener — MGA · "where the performance is by style" (step 11).
//
// Median-return-by-category bar chart (1Y/3Y toggle) + a per-category table with
// the best fund in each. Click a category → deep-link into the Screener filtered to
// it; click the best fund → fund-drill. The big PMS catch-all shows as
// "Diversified / Multi-Cap" (ui.categoryLabel) so nothing implies false precision.

import {
  escapeHtml, categoryLabel, categoryColor, fmtPct, pctColor, refreshIcons, makeChart,
} from "./ui.js";
import * as data from "./data.js";
import { openFundDrill } from "./drill.js";

const POS = "#10B981", NEG = "#F43F5E";
const $ = (id) => document.getElementById(id);
let _period = "y1"; // chart toggle: y1 | y3
let _sec = null;

// Rich per-category aggregate from the funds (median 1Y/3Y/5Y + alpha + best fund).
function aggregates() {
  const by = new Map();
  for (const f of data.funds()) {
    if (!by.has(f.category)) by.set(f.category, []);
    by.get(f.category).push(f);
  }
  return [...by.entries()].map(([category, list]) => ({
    category,
    fund_count: list.length,
    m_y1: data.median(list.map((f) => f.returns?.y1)),
    m_y3: data.median(list.map((f) => f.returns?.y3)),
    m_y5: data.median(list.map((f) => f.returns?.y5)),
    m_alpha_y1: data.median(list.map((f) => f.alpha?.y1)),
    best: data.sortFunds(list.filter((f) => f.returns?.y1 != null), "y1", "desc")[0] || null,
  }));
}

function renderChart(aggs) {
  const el = $("cat-chart");
  const chart = makeChart(el, "cat-bar");
  if (!chart) return;
  const key = _period === "y3" ? "m_y3" : "m_y1";
  const rows = aggs.filter((a) => a[key] != null).sort((a, b) => a[key] - b[key]); // asc → bars read bottom-up
  chart.setOption({
    grid: { left: 8, right: 44, top: 10, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" }, confine: true,
      formatter: (p) => {
        const a = rows[p[0].dataIndex];
        return `<b>${escapeHtml(categoryLabel(a.category))}</b><br/>median ${_period === "y3" ? "3Y" : "1Y"}: ${fmtPct(a[key])}<br/>${a.fund_count} funds`;
      },
    },
    xAxis: { type: "value", axisLabel: { formatter: (v) => v + "%", color: "#94a3b8", fontSize: 11 }, splitLine: { lineStyle: { color: "#f1f5f9" } } },
    yAxis: {
      type: "category", data: rows.map((a) => categoryLabel(a.category)),
      axisTick: { show: false }, axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisLabel: { color: "#475569", fontSize: 12, fontWeight: 500 },
    },
    series: [{
      type: "bar", data: rows.map((a) => ({ value: a[key], itemStyle: { color: a[key] >= 0 ? POS : NEG, borderRadius: [0, 6, 6, 0] } })),
      barMaxWidth: 26,
      label: { show: true, position: "right", formatter: (p) => fmtPct(p.value), color: "#64748b", fontSize: 11, fontWeight: 600 },
    }],
  });
  chart.off("click");
  chart.on("click", (p) => { const a = rows[p.dataIndex]; if (a) focusCategory(a.category); });
}

function focusCategory(category) {
  document.dispatchEvent(new CustomEvent("screener:focus", { detail: { category } }));
}

function tableRow(a) {
  const lowN = a.fund_count < 5;
  const cell = (v) => `<td class="px-3 py-2.5 text-right font-mono text-sm ${pctColor(v)} whitespace-nowrap">${fmtPct(v)}</td>`;
  const best = a.best
    ? `<button data-id="${escapeHtml(a.best.id)}" class="cat-best truncate text-left text-xs font-semibold text-violet-600 hover:underline max-w-[180px]">${escapeHtml(a.best.approach || a.best.manager || "—")} <span class="font-mono ${pctColor(a.best.returns?.y1)}">${fmtPct(a.best.returns?.y1)}</span></button>`
    : `<span class="text-xs text-slate-400">—</span>`;
  return `<tr class="border-t border-slate-100 transition hover:bg-violet-50/40">
    <td class="px-3 py-2.5">
      <button data-cat="${escapeHtml(a.category)}" class="cat-link inline-flex items-center gap-2 text-left">
        <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background:${categoryColor(a.category)}"></span>
        <span class="text-sm font-semibold text-slate-700 hover:text-violet-700">${escapeHtml(categoryLabel(a.category))}</span>
        ${lowN ? `<span class="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 ring-1 ring-amber-200">small n</span>` : ""}
      </button>
    </td>
    <td class="px-3 py-2.5 text-right font-mono text-sm text-slate-500">${a.fund_count.toLocaleString("en-IN")}</td>
    ${cell(a.m_y1)}${cell(a.m_y3)}${cell(a.m_y5)}${cell(a.m_alpha_y1)}
    <td class="px-3 py-2.5">${best}</td>
  </tr>`;
}

export function renderCategories(sec) {
  if (sec) _sec = sec;
  sec = _sec;
  if (!sec) return;
  const aggs = aggregates();
  const tableAggs = [...aggs].sort((a, b) => b.fund_count - a.fund_count);

  sec.innerHTML = `
    <div class="card p-4 sm:p-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 class="font-display text-lg font-bold text-slate-800">Categories</h2>
          <p class="text-sm text-slate-500">Median performance by style across ${data.funds().length.toLocaleString("en-IN")} funds. Click a category to screen it.</p>
        </div>
        <div id="cat-period" class="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-1">
          <button data-val="y1" class="cat-seg rounded-full px-3 py-1 text-xs font-semibold transition ${_period === "y1" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}">Median 1Y</button>
          <button data-val="y3" class="cat-seg rounded-full px-3 py-1 text-xs font-semibold transition ${_period === "y3" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}">Median 3Y</button>
        </div>
      </div>
      <div id="cat-chart" class="chart-tall"></div>
    </div>

    <div class="card mt-5 p-4 sm:p-6">
      <h3 class="mb-3 font-display text-base font-bold text-slate-800">By category</h3>
      <div class="overflow-x-auto scroll-area">
        <table class="w-full min-w-[720px]">
          <thead><tr class="text-[11px] uppercase tracking-wide text-slate-400">
            <th class="px-3 py-2 text-left font-semibold">Category</th>
            <th class="px-3 py-2 text-right font-semibold">Funds</th>
            <th class="px-3 py-2 text-right font-semibold">Median 1Y</th>
            <th class="px-3 py-2 text-right font-semibold">Median 3Y</th>
            <th class="px-3 py-2 text-right font-semibold">Median 5Y</th>
            <th class="px-3 py-2 text-right font-semibold">Median α 1Y</th>
            <th class="px-3 py-2 text-left font-semibold">Best fund (1Y)</th>
          </tr></thead>
          <tbody>${tableAggs.map(tableRow).join("")}</tbody>
        </table>
      </div>
    </div>`;

  renderChart(aggs);
  $("cat-period")?.addEventListener("click", (e) => {
    const b = e.target.closest(".cat-seg"); if (!b) return;
    _period = b.dataset.val; renderCategories();
  });
  sec.querySelectorAll(".cat-link").forEach((el) => el.addEventListener("click", () => focusCategory(el.dataset.cat)));
  sec.querySelectorAll(".cat-best").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); openFundDrill(el.dataset.id); }));
  refreshIcons();
}
