// search.js — Fund Screener — MGA · global header search.
//
// A header "Search funds" button opens a command-palette modal: type a manager or
// approach, see live matches, click one → its fund-drill opens. Independent of the
// Screener's filters.

import * as data from "./data.js";
import { escapeHtml, initials, managerColor, fmtPct, pctColor, refreshIcons } from "./ui.js";
import { openFundDrill, vehiclePill } from "./drill.js";

const $ = (id) => document.getElementById(id);
let _bound = false, _open = false;

function matches(q) {
  q = q.trim().toLowerCase();
  let xs = data.funds();
  if (q) xs = xs.filter((f) => (f.manager || "").toLowerCase().includes(q) || (f.approach || "").toLowerCase().includes(q));
  return [...xs].sort((a, b) => (b.returns?.y1 ?? -1e9) - (a.returns?.y1 ?? -1e9)).slice(0, 16);
}

function renderList(q) {
  const box = $("search-results");
  if (!box) return;
  const xs = matches(q);
  if (!xs.length) {
    box.innerHTML = `<div class="px-3 py-10 text-center text-sm text-slate-400">No funds match “${escapeHtml(q)}”.</div>`;
    return;
  }
  box.innerHTML = xs.map((f) => `<button data-id="${escapeHtml(f.id)}" class="search-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-violet-50">
    <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style="background:${managerColor(f.manager || f.id)}">${escapeHtml(initials(f.manager))}</div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-slate-700">${escapeHtml(f.approach || "—")}</p>
      <div class="mt-0.5 flex items-center gap-1.5">${vehiclePill(f.vehicle)}<span class="truncate text-xs text-slate-400">${escapeHtml(f.manager || "—")}</span></div>
    </div>
    <span class="shrink-0 font-mono text-sm font-bold ${pctColor(f.returns?.y1)} whitespace-nowrap">${escapeHtml(fmtPct(f.returns?.y1))}</span>
  </button>`).join("");
  refreshIcons();
}

export function openSearch() {
  const ov = $("search-overlay"), pn = $("search-panel"), inp = $("search-input");
  if (!ov || !pn) return;
  ov.classList.remove("hidden");
  pn.classList.remove("hidden");
  pn.classList.add("flex");
  document.body.style.overflow = "hidden";
  _open = true;
  if (inp) { inp.value = ""; renderList(""); setTimeout(() => inp.focus(), 40); }
  refreshIcons();
}
function closeSearch() {
  const ov = $("search-overlay"), pn = $("search-panel");
  if (!ov) return;
  ov.classList.add("hidden");
  pn.classList.add("hidden");
  pn.classList.remove("flex");
  document.body.style.overflow = "";
  _open = false;
}

export function mountSearch() {
  if (_bound) return;
  _bound = true;
  $("search-btn")?.addEventListener("click", openSearch);
  $("search-input")?.addEventListener("input", (e) => renderList(e.target.value));
  $("search-overlay")?.addEventListener("click", closeSearch);
  $("search-panel")?.addEventListener("click", (e) => { if (e.target === $("search-panel")) closeSearch(); });
  $("search-results")?.addEventListener("click", (e) => {
    const b = e.target.closest(".search-item");
    if (b) { closeSearch(); openFundDrill(b.dataset.id); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _open) closeSearch();
    else if ((e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) && !_open) {
      const tag = document.activeElement?.tagName;
      if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") { e.preventDefault(); openSearch(); }
    }
  });
}
