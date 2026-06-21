// export.js — Fund Screener — MGA · download the data (step 11).
//
// Exports the CURRENT Screener view when filters are active (getScreenerView),
// else the full fund set. Styled .xlsx via ExcelJS (loaded in index.html; falls
// back to an unpkg load), and a CSV fallback if ExcelJS can't be reached at all.
// Columns: manager, approach, vehicle, category, strategy, AUM, benchmark, the
// full return ladder (m1…si), the full alpha ladder, and as_of_month.

import { categoryLabel, fmtMonth } from "./ui.js";
import * as data from "./data.js";
import { getScreenerView } from "./screener.js";

const PERIODS = [["m1", "1M"], ["m3", "3M"], ["m6", "6M"], ["y1", "1Y"], ["y2", "2Y"], ["y3", "3Y"], ["y5", "5Y"], ["si", "SI"]];

// [header, accessor, numFmt, width]
const COLS = [
  ["Manager", (f) => f.manager ?? "", null, 30],
  ["Approach", (f) => f.approach ?? "", null, 34],
  ["Vehicle", (f) => f.vehicle ?? "", null, 9],
  ["Category", (f) => categoryLabel(f.category), null, 22],
  ["Strategy", (f) => f.strategy ?? "", null, 14],
  ["AUM (Cr)", (f) => f.aum_cr ?? null, "#,##0", 12],
  ["Benchmark", (f) => f.benchmark ?? "", null, 18],
  ...PERIODS.map(([p, l]) => [`R ${l}`, (f) => f.returns?.[p] ?? null, "0.0", 8]),
  ...PERIODS.map(([p, l]) => [`α ${l}`, (f) => f.alpha?.[p] ?? null, "0.0", 8]),
  ["As of", (f) => f.as_of_month ?? "", null, 10],
];

function pickRows() {
  let view = null;
  try { view = getScreenerView(); } catch { /* screener not rendered yet */ }
  if (view && view.active && Array.isArray(view.rows) && view.rows.length) {
    return { rows: view.rows, scoped: true, total: view.totalMatched };
  }
  return { rows: data.funds(), scoped: false, total: data.funds().length };
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error("script load failed"));
    document.head.appendChild(s);
  });
}
async function getExcelJS() {
  if (window.ExcelJS) return window.ExcelJS;
  try { await loadScript("https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js"); } catch { /* offline / blocked */ }
  return window.ExcelJS || null;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function toast(msg, kind = "ok") {
  const wrap = document.createElement("div");
  const color = kind === "warn" ? "bg-amber-500" : "bg-slate-900";
  wrap.className = `fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full ${color} px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300`;
  wrap.style.opacity = "0"; wrap.style.transform = "translate(-50%, 8px)";
  wrap.textContent = msg;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => { wrap.style.opacity = "1"; wrap.style.transform = "translate(-50%, 0)"; });
  setTimeout(() => { wrap.style.opacity = "0"; wrap.style.transform = "translate(-50%, 8px)"; setTimeout(() => wrap.remove(), 350); }, 3200);
}

function toCsv(rows) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLS.map((c) => esc(c[0])).join(",")];
  for (const f of rows) lines.push(COLS.map((c) => esc(c[1](f))).join(","));
  return lines.join("\r\n");
}

async function buildXlsx(rows, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Fund Screener — MGA";
  const ws = wb.addWorksheet("Funds", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLS.map((c) => ({ header: c[0], width: c[3] }));
  for (const f of rows) ws.addRow(COLS.map((c) => c[1](f)));
  // header style
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D28D9" } };
  head.alignment = { vertical: "middle" };
  head.height = 20;
  // number formats per column
  COLS.forEach((c, i) => { if (c[2]) ws.getColumn(i + 1).numFmt = c[2]; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

let _busy = false;
export async function exportData(btn) {
  if (_busy) return;
  _busy = true;
  const month = data.asOfMonth() || "latest";
  const base = `fund-screener-${month}`;
  const { rows, scoped, total } = pickRows();
  const label = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i data-lucide="loader" class="h-4 w-4 animate-spin"></i> Exporting…`; window.lucide?.createIcons(); }

  try {
    const ExcelJS = await getExcelJS();
    if (ExcelJS) {
      const blob = await buildXlsx(rows, ExcelJS);
      download(blob, `${base}.xlsx`);
      toast(`Exported ${rows.length.toLocaleString("en-IN")} ${scoped ? "filtered" : ""} fund${rows.length === 1 ? "" : "s"} → ${base}.xlsx`);
    } else {
      download(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
      toast(`Spreadsheet library unavailable — exported CSV instead (${rows.length.toLocaleString("en-IN")} funds).`, "warn");
    }
  } catch (err) {
    console.error("export failed, falling back to CSV", err);
    download(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
    toast(`Export hit an error — saved CSV instead.`, "warn");
  } finally {
    if (btn && label != null) { btn.disabled = false; btn.innerHTML = label; window.lucide?.createIcons(); }
    _busy = false;
  }
}
