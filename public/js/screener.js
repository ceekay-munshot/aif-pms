// screener.js — Fund Screener — MGA · the Screener tab (filters + sortable
// table + category-relative top-N). The heart of the product.
//
// Renders a sticky filter bar once (so the search box keeps focus), then
// re-renders only the results on change. Exposes getScreenerView() so prompt 11's
// Export can pull exactly the current filtered+sorted set.

import {
  escapeHtml, initials, managerColor, categoryPill, categoryLabel, fmtPct, pctColor, fmtAum,
  refreshIcons, periodLong, periodShort,
} from "./ui.js";
import * as data from "./data.js";
import { openFundDrill, vehiclePill } from "./drill.js";
import { compareButton } from "./compare.js";

const PERIODS = [
  ["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["y1", "1Y"],
  ["y2", "2Y"], ["y3", "3Y"], ["y5", "5Y"], ["si", "SI"],
];
const PAGE = 100;
const MEDAL = { 1: "#F59E0B", 2: "#94A3B8", 3: "#F97316" };
// Opaque (flattened-over-white) tints so the sticky Fund column never lets the
// scrolling cells bleed through on a medal row.
const TINT = { 1: "#FEF5E7", 2: "#F2F4F6", 3: "#FEF2EA" };

// Filter/sort state.
const F = {
  vehicle: "", category: "", search: "", aumMin: null, minThresh: null,
  period: "y1", mode: "returns", catRel: false, perCat: 5,
  sortCol: "y1", sortDir: "desc", page: 1,
};

let _view = null; // last computed view (for export)
const $ = (id) => document.getElementById(id);
const primaryMetric = () => (F.mode === "alpha" ? "alpha_" : "") + F.period;
const sortMetric = () => (F.mode === "alpha" ? "alpha_" : "") + F.sortCol;
const ladderVal = (f, p) => (F.mode === "alpha" ? f.alpha?.[p] : f.returns?.[p]) ?? null;

// ── compute the current view ─────────────────────────────────────────────────
function computeView() {
  let xs = data.filterFunds({
    vehicle: F.vehicle || undefined,
    category: F.category || undefined,
    search: F.search || undefined,
    aumMin: F.aumMin ?? undefined,
  });
  if (F.minThresh != null) {
    const pm = primaryMetric();
    xs = xs.filter((f) => {
      const v = data.metricValue(f, pm);
      return v != null && v >= F.minThresh;
    });
  }
  const totalMatched = xs.length;

  if (F.catRel) {
    const pm = primaryMetric();
    const by = new Map();
    for (const f of xs) {
      if (!by.has(f.category)) by.set(f.category, []);
      by.get(f.category).push(f);
    }
    const groups = [];
    for (const [category, list] of by) {
      const ranked = data.sortFunds(list.filter((f) => data.metricValue(f, pm) != null), pm, "desc");
      if (ranked.length) groups.push({ category, total: list.length, rows: ranked.slice(0, F.perCat) });
    }
    groups.sort((a, b) => data.metricValue(b.rows[0], pm) - data.metricValue(a.rows[0], pm));
    return { catRel: true, groups, totalMatched, flat: groups.flatMap((g) => g.rows) };
  }

  const sorted = data.sortFunds(xs, sortMetric(), F.sortDir);
  return { catRel: false, rows: sorted, totalMatched, flat: sorted };
}

/** The current filtered+sorted dataset + config — consumed by Export (prompt 11). */
export function getScreenerView() {
  const v = _view || computeView();
  return {
    rows: v.flat,
    catRelative: v.catRel,
    groups: v.catRel ? v.groups : null,
    mode: F.mode,
    period: F.period,
    periodLabel: periodLong(F.period),
    sortCol: F.sortCol,
    sortDir: F.sortDir,
    totalMatched: v.totalMatched,
    // "active" = the row SET is narrowed/grouped (filters), not just reordered.
    active: !!(F.vehicle || F.category || F.search || F.aumMin != null || F.minThresh != null || F.catRel),
    columns: PERIODS.map(([p, l]) => ({ key: p, label: l })),
  };
}

/** Deep-link entry from the Categories tab: filter the Screener to one category. */
export function focusCategory(cat) {
  F.vehicle = ""; F.category = cat; F.catRel = false; F.page = 1;
  if (!$("scr-category")) return; // not rendered yet — state applies on next render
  setSeg("scr-vehicle", "");
  setSeg("scr-catrel", "off");
  fillCategoryOptions();
  const sel = $("scr-category");
  sel.value = cat;
  if (sel.value !== cat) F.category = ""; // unknown bucket → show all
  syncCatRel();
  renderResults();
}

// ── results rendering ─────────────────────────────────────────────────────────
function head() {
  return PERIODS.map(([p]) => {
    const active = !F.catRel && F.sortCol === p;
    const caret = active ? (F.sortDir === "desc" ? " ↓" : " ↑") : "";
    const cls = F.catRel ? "" : "cursor-pointer hover:text-slate-600";
    const hl = active ? "text-violet-600" : "text-slate-400";
    return `<th data-col="${p}" class="scr-num px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide ${hl} ${cls}">${periodShort(p)}${caret}</th>`;
  }).join("");
}

function fundCell(f) {
  const color = managerColor(f.manager || f.id);
  return `<div class="flex items-center gap-2.5">
    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style="background:${color};">${escapeHtml(initials(f.manager))}</div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-slate-700">${escapeHtml(f.approach || "—")}</p>
      <div class="mt-0.5 flex items-center gap-1.5">${vehiclePill(f.vehicle)}<span class="truncate text-xs text-slate-400">${escapeHtml(f.manager || "—")}</span></div>
    </div>
    ${compareButton(f.id, "icon")}
  </div>`;
}

function ladderCells(f) {
  return PERIODS.map(([p]) => {
    const v = ladderVal(f, p);
    const active = !F.catRel && F.sortCol === p ? "bg-violet-50/50" : "";
    return `<td class="scr-num px-2 py-2.5 text-right font-mono text-sm ${pctColor(v)} ${active}">${fmtPct(v)}</td>`;
  }).join("");
}

function row(f, rankNum, tintRank) {
  const tint = tintRank ? `style="background:${TINT[tintRank]}"` : "";
  const medal = tintRank
    ? `<span class="inline-flex h-4 w-4 items-center justify-center rounded-full text-white" style="background:${MEDAL[tintRank]}"><i data-lucide="medal" class="h-3 w-3"></i></span>`
    : `<span class="font-mono text-xs text-slate-400">${rankNum}</span>`;
  return `<tr class="scr-row cursor-pointer border-t border-slate-100 bg-white hover:bg-violet-50" data-id="${escapeHtml(f.id)}" ${tint}>
    <td class="px-2 py-2.5 text-right">${medal}</td>
    <td class="scr-sticky bg-inherit px-3 py-2.5">${fundCell(f)}</td>
    <td class="px-3 py-2.5 text-right font-mono text-xs text-slate-500 whitespace-nowrap">${fmtAum(f.aum_cr)}</td>
    ${ladderCells(f)}
    <td class="hidden px-3 py-2.5 lg:table-cell">${categoryPill(f.category)}</td>
  </tr>`;
}

function tableShell(bodyHtml) {
  const catHead = `<th class="hidden px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 lg:table-cell">Category</th>`;
  return `<div class="overflow-x-auto scroll-area">
    <table class="w-full min-w-[880px]">
      <thead><tr>
        <th class="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">#</th>
        <th class="scr-sticky bg-white px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fund</th>
        <th class="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">AUM</th>
        ${head()}${catHead}
      </tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>
  </div>`;
}

function renderResults() {
  _view = computeView();
  const meta = $("scr-meta");
  const results = $("scr-results");
  if (!results) return;

  const metricName = `${periodLong(F.period)}${F.mode === "alpha" ? " alpha" : ""}`;
  if (meta) {
    meta.innerHTML = F.catRel
      ? `<span class="font-semibold text-slate-700">${_view.groups.length}</span> categories · top ${F.perCat} by ${metricName} · <span class="font-semibold text-slate-700">${_view.totalMatched.toLocaleString("en-IN")}</span> of ${data.funds().length.toLocaleString("en-IN")} funds`
      : `Showing <span class="font-semibold text-slate-700">${Math.min(F.page * PAGE, _view.rows.length).toLocaleString("en-IN")}</span> of <span class="font-semibold text-slate-700">${_view.totalMatched.toLocaleString("en-IN")}</span> · sorted by ${periodLong(F.sortCol)}${F.mode === "alpha" ? " alpha" : ""} ${F.sortDir === "desc" ? "↓" : "↑"}`;
  }

  if (_view.totalMatched === 0) {
    results.innerHTML = `<div class="fade-in flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><i data-lucide="search-x" class="h-7 w-7"></i></div>
      <h3 class="font-display text-lg font-semibold text-slate-700">No funds match these filters</h3>
      <p class="max-w-sm text-sm text-slate-500">Loosen a filter or reset to see the full universe.</p>
    </div>`;
    refreshIcons();
    return;
  }

  if (F.catRel) {
    results.innerHTML = _view.groups
      .map((g) => `<div class="mb-6 fade-in">
        <div class="mb-2 flex items-center gap-2">${categoryPill(g.category)}<span class="text-xs text-slate-400">top ${Math.min(F.perCat, g.rows.length)} of ${g.total.toLocaleString("en-IN")}</span></div>
        ${tableShell(g.rows.map((f, i) => row(f, i + 1, i < 3 ? i + 1 : 0)).join(""))}
      </div>`)
      .join("");
  } else {
    const shown = _view.rows.slice(0, F.page * PAGE);
    const body = shown.map((f, i) => row(f, i + 1, F.sortDir === "desc" && F.sortCol === F.period && i < 3 ? i + 1 : 0)).join("");
    const more = _view.rows.length > shown.length
      ? `<div class="mt-4 flex justify-center"><button id="scr-more" class="rounded-full bg-slate-100 px-5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-200">Show ${Math.min(PAGE, _view.rows.length - shown.length)} more</button></div>`
      : "";
    results.innerHTML = tableShell(body) + more;
    $("scr-more")?.addEventListener("click", () => { F.page += 1; renderResults(); });
  }

  results.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("[data-cmp-add]")) return; // +Compare handled separately
    openFundDrill(tr.dataset.id);
  }));
  if (!F.catRel) {
    results.querySelectorAll("th[data-col]").forEach((th) =>
      th.addEventListener("click", () => {
        const c = th.dataset.col;
        if (F.sortCol === c) F.sortDir = F.sortDir === "desc" ? "asc" : "desc";
        else { F.sortCol = c; F.sortDir = "desc"; }
        F.page = 1;
        renderResults();
      })
    );
  }
  renderChips();
  refreshIcons();
}

// ── active-filter chips ───────────────────────────────────────────────────────
function renderChips() {
  const box = $("scr-chips");
  if (!box) return;
  const chips = [];
  const add = (key, label) => chips.push({ key, label });
  if (F.vehicle) add("vehicle", `Vehicle: ${F.vehicle}`);
  if (F.category) add("category", categoryLabel(F.category));
  if (F.search) add("search", `“${F.search}”`);
  if (F.aumMin != null) add("aumMin", `AUM ≥ ₹${F.aumMin.toLocaleString("en-IN")} Cr`);
  if (F.minThresh != null) add("minThresh", `Min ${periodLong(F.period)}${F.mode === "alpha" ? " α" : ""} ≥ ${F.minThresh}%`);
  if (F.mode === "alpha") add("mode", "Alpha view");
  if (F.catRel) add("catRel", `Top ${F.perCat} / category`);
  box.innerHTML = chips.length
    ? chips.map((c) => `<button class="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-200" data-chip="${c.key}">${escapeHtml(c.label)} <i data-lucide="x" class="h-3 w-3"></i></button>`).join("")
    : `<span class="text-xs text-slate-400">No active filters — showing the full universe.</span>`;
  box.querySelectorAll("[data-chip]").forEach((b) => b.addEventListener("click", () => clearFilter(b.dataset.chip)));
}

function clearFilter(key) {
  if (key === "vehicle") { F.vehicle = ""; setSeg("scr-vehicle", ""); fillCategoryOptions(); }
  else if (key === "category") { F.category = ""; const s = $("scr-category"); if (s) s.value = ""; }
  else if (key === "search") { F.search = ""; const s = $("scr-search"); if (s) s.value = ""; }
  else if (key === "aumMin") { F.aumMin = null; const s = $("scr-aum"); if (s) s.value = ""; }
  else if (key === "minThresh") { F.minThresh = null; const s = $("scr-thresh"); if (s) s.value = ""; }
  else if (key === "mode") { F.mode = "returns"; setSeg("scr-mode", "returns"); }
  else if (key === "catRel") { F.catRel = false; setSeg("scr-catrel", "off"); syncCatRel(); }
  F.page = 1;
  renderResults();
}

// ── segmented control helpers ─────────────────────────────────────────────────
function seg(id, opts, active) {
  return `<div id="${id}" class="inline-flex flex-wrap items-center gap-0.5 rounded-full bg-slate-100 p-1">
    ${opts.map((o) => `<button data-val="${o.val}" class="seg-btn rounded-full px-3 py-1 text-xs font-semibold transition ${o.val === active ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}">${o.label}</button>`).join("")}
  </div>`;
}
function setSeg(id, val) {
  const c = $(id);
  if (!c) return;
  c.querySelectorAll(".seg-btn").forEach((b) => {
    const on = b.dataset.val === String(val);
    b.classList.toggle("bg-white", on);
    b.classList.toggle("text-slate-800", on);
    b.classList.toggle("shadow-sm", on);
    b.classList.toggle("text-slate-500", !on);
  });
}
function onSeg(id, cb) {
  $(id)?.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    setSeg(id, btn.dataset.val);
    cb(btn.dataset.val);
  });
}
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function fillCategoryOptions() {
  const sel = $("scr-category");
  if (!sel) return;
  const xs = data.filterFunds({ vehicle: F.vehicle || undefined });
  const counts = new Map();
  for (const f of xs) counts.set(f.category, (counts.get(f.category) || 0) + 1);
  const opts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const cur = F.category;
  sel.innerHTML =
    `<option value="">All categories (${xs.length.toLocaleString("en-IN")})</option>` +
    opts.map(([c, n]) => `<option value="${escapeHtml(c)}">${escapeHtml(categoryLabel(c))} (${n.toLocaleString("en-IN")})</option>`).join("");
  // keep selection if still valid; else reset
  if (cur && counts.has(cur)) sel.value = cur;
  else { F.category = ""; sel.value = ""; }
}

function syncCatRel() {
  const wrap = $("scr-percat-wrap");
  if (wrap) wrap.style.display = F.catRel ? "" : "none";
}

const threshLabel = () => `Min ${periodLong(F.period)}${F.mode === "alpha" ? " α" : ""} ≥`;
function updateThreshLabel() {
  const el = $("scr-thresh-label");
  if (el) el.textContent = threshLabel();
}

// ── filter bar (rendered once) ────────────────────────────────────────────────
function filterBar() {
  const inputCls = "rounded-xl border-0 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 outline-none ring-1 ring-transparent transition focus:bg-white focus:ring-violet-300";
  return `<div class="card sticky top-[5.25rem] z-20 mb-5 p-4 sm:p-5">
    <div class="flex flex-wrap items-center gap-3">
      ${seg("scr-vehicle", [{ val: "", label: "All" }, { val: "PMS", label: "PMS" }, { val: "AIF", label: "AIF" }], F.vehicle)}
      <select id="scr-category" class="${inputCls} max-w-[220px]"></select>
      <div class="relative min-w-[180px] flex-1">
        <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"></i>
        <input id="scr-search" type="search" placeholder="Search manager or approach…" class="${inputCls} w-full pl-9" />
      </div>
      <button id="scr-reset" class="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"><i data-lucide="rotate-ccw" class="h-4 w-4"></i> Reset</button>
      <button id="scr-adv-toggle" class="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 sm:hidden"><i data-lucide="sliders-horizontal" class="h-4 w-4"></i> Filters</button>
    </div>

    <div id="scr-adv" class="mt-3 hidden flex-wrap items-center gap-x-4 gap-y-3 sm:flex">
      <div class="flex items-center gap-2"><span class="text-xs font-medium text-slate-400">Period</span>${seg("scr-period", PERIODS.map(([v]) => ({ val: v, label: periodLong(v) })), F.period)}</div>
      <div class="flex items-center gap-2"><span class="text-xs font-medium text-slate-400">Metric</span>${seg("scr-mode", [{ val: "returns", label: "Returns" }, { val: "alpha", label: "Alpha" }], F.mode)}</div>
      <label class="flex items-center gap-2 text-xs font-medium text-slate-400">AUM ≥ <input id="scr-aum" type="number" min="0" placeholder="₹ Cr" class="${inputCls} w-24" /></label>
      <label class="flex items-center gap-2 text-xs font-medium text-slate-400"><span id="scr-thresh-label">${threshLabel()}</span> <input id="scr-thresh" type="number" placeholder="%" class="${inputCls} w-20" /></label>
      <div class="flex items-center gap-2">${seg("scr-catrel", [{ val: "off", label: "Overall" }, { val: "on", label: "Per category" }], F.catRel ? "on" : "off")}
        <span id="scr-percat-wrap" style="display:none">${seg("scr-percat", [{ val: "3", label: "3" }, { val: "5", label: "5" }, { val: "10", label: "10" }], String(F.perCat))}</span>
      </div>
    </div>

    <div id="scr-chips" class="mt-3 flex flex-wrap items-center gap-2"></div>
  </div>
  <div id="scr-meta" class="mb-3 px-1 text-sm text-slate-500"></div>
  <div id="scr-results"></div>`;
}

// ── public entry ──────────────────────────────────────────────────────────────
export function renderScreener(sec) {
  if (!sec) return;
  sec.innerHTML = `<div class="card p-4 sm:p-6">
    <div class="mb-4">
      <h2 class="font-display text-lg font-bold text-slate-800">Screener</h2>
      <p class="text-sm text-slate-500">Filter and rank ${data.funds().length.toLocaleString("en-IN")} PMS &amp; AIF funds on return or alpha — overall or relative to category.</p>
    </div>
    ${filterBar()}
  </div>`;

  fillCategoryOptions();
  syncCatRel();

  onSeg("scr-vehicle", (v) => { F.vehicle = v; F.page = 1; fillCategoryOptions(); renderResults(); });
  onSeg("scr-period", (v) => { F.period = v; F.sortCol = v; F.sortDir = "desc"; F.page = 1; updateThreshLabel(); renderResults(); });
  onSeg("scr-mode", (v) => { F.mode = v; F.page = 1; updateThreshLabel(); renderResults(); });
  onSeg("scr-catrel", (v) => { F.catRel = v === "on"; F.page = 1; syncCatRel(); renderResults(); });
  onSeg("scr-percat", (v) => { F.perCat = Number(v); renderResults(); });

  $("scr-category")?.addEventListener("change", (e) => { F.category = e.target.value; F.page = 1; renderResults(); });
  $("scr-search")?.addEventListener("input", debounce((e) => { F.search = e.target.value.trim(); F.page = 1; renderResults(); }, 180));
  $("scr-aum")?.addEventListener("input", debounce((e) => { const n = parseFloat(e.target.value); F.aumMin = Number.isFinite(n) ? n : null; F.page = 1; renderResults(); }, 220));
  $("scr-thresh")?.addEventListener("input", debounce((e) => { const n = parseFloat(e.target.value); F.minThresh = Number.isFinite(n) ? n : null; F.page = 1; renderResults(); }, 220));
  $("scr-reset")?.addEventListener("click", reset);
  $("scr-adv-toggle")?.addEventListener("click", () => $("scr-adv")?.classList.toggle("hidden"));

  renderResults();
  refreshIcons();
}

function reset() {
  Object.assign(F, { vehicle: "", category: "", search: "", aumMin: null, minThresh: null, period: "y1", mode: "returns", catRel: false, perCat: 5, sortCol: "y1", sortDir: "desc", page: 1 });
  setSeg("scr-vehicle", ""); setSeg("scr-period", "y1"); setSeg("scr-mode", "returns");
  setSeg("scr-catrel", "off"); setSeg("scr-percat", "5");
  const s = $("scr-search"); if (s) s.value = "";
  const a = $("scr-aum"); if (a) a.value = "";
  const t = $("scr-thresh"); if (t) t.value = "";
  syncCatRel(); updateThreshLabel(); fillCategoryOptions();
  renderResults();
}
