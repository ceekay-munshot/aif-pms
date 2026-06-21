// newspaper.js — Fund Screener — MGA · "Get Insight" → the Munshot Newspaper.
//
// One click builds a 2-page, data-driven editorial broadsheet from the live
// committed data and downloads it as a PDF (no print dialog). Each page is a
// fixed A4-portrait element (794×1123px @96dpi) laid out to fill completely;
// charts render to crisp PNGs via ECharts getDataURL, then html2canvas + jsPDF
// snapshot each page full-bleed. Libraries + display fonts load from CDN on first
// use (so this only works where the CDNs are reachable — i.e. the live deploy).

import * as data from "./data.js";
import { escapeHtml, fmtPct, fmtAum, fmtMonth, categoryLabel } from "./ui.js";

const PAGE_W = 794, PAGE_H = 1123;
const INK = "#16161D", CREAM = "#FAF6EE";
const POS = "#059669", NEG = "#E11D48";
const PALETTE = ["#6366F1", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4", "#F97316", "#A855F7"];

const clip = (s, n) => { s = String(s ?? "—"); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const cls = (v) => (v == null ? "" : v >= 0 ? "np-pos" : "np-neg");
const pc = (v) => escapeHtml(fmtPct(v));
// Compact one-line category labels for the dense league tables (full labels wrap).
const NPCAT = {
  "Multi/Flexi Cap": "Multi-Cap", "Thematic/Sectoral": "Thematic", "Hybrid/Multi-Asset": "Hybrid",
  "Large & Mid": "Large & Mid", "Mid & Small": "Mid & Small", "Large Cap": "Large Cap",
  "Mid Cap": "Mid Cap", "Small Cap": "Small Cap", "Value/Contra": "Value", "Debt": "Debt",
  "Unclassified": "Unclassified",
};
const npCat = (c) => NPCAT[c] || categoryLabel(c);

// ── lazy CDN loaders ──────────────────────────────────────────────────────────
function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error("failed " + src));
    document.head.appendChild(s);
  });
}
async function ensureLibs() {
  if (!document.getElementById("np-fonts")) {
    const l = document.createElement("link");
    l.id = "np-fonts"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Newsreader:ital,wght@0,400;0,500;0,600;1,400&display=swap";
    document.head.appendChild(l);
  }
  injectStyles();
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", () => window.html2canvas);
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", () => window.jspdf);
}
async function waitFonts() {
  try {
    await Promise.all([
      document.fonts.load("900 48px 'Playfair Display'"),
      document.fonts.load("700 24px 'Fraunces'"),
      document.fonts.load("400 13px 'Newsreader'"),
      document.fonts.load("600 11px 'Space Grotesk'"),
      document.fonts.load("600 11px 'JetBrains Mono'"),
    ]);
    await document.fonts.ready;
  } catch { /* fall back to system fonts */ }
}

// ── gather the edition's data ─────────────────────────────────────────────────
function gather() {
  const funds = data.funds();
  const s = data.summary();
  const m = data.asOfMonth();
  const top1y = data.topN("y1", 8);
  const top3y = data.topN("y3", 8);
  const topA = data.topN("alpha_y1", 8);
  const withY1 = funds.filter((f) => f.returns?.y1 != null);
  const worst = [...withY1].sort((a, b) => a.returns.y1 - b.returns.y1).slice(0, 6);
  const best1y = top1y[0]?.returns?.y1 ?? null;
  const worst1y = worst[0]?.returns?.y1 ?? null;
  const cats = data.categoryAggregates()
    .map((c) => ({ ...c, beat: catBeat(funds, c.category) }))
    .sort((a, b) => (b.median_y1 ?? -1e9) - (a.median_y1 ?? -1e9));
  const pms = funds.filter((f) => f.vehicle === "PMS");
  const aif = funds.filter((f) => f.vehicle === "AIF");
  const vehStat = (xs) => ({
    n: xs.length,
    y1: data.median(xs.map((f) => f.returns?.y1)),
    y3: data.median(xs.map((f) => f.returns?.y3)),
    a1: data.median(xs.map((f) => f.alpha?.y1)),
  });
  const benchLadder = (name) => funds.find((f) => f.benchmark === name && f.benchmark_returns)?.benchmark_returns || {};
  return {
    funds, s, m, monthName: fmtMonth(m).toUpperCase(),
    top1y, top3y, topA, worst, best1y, worst1y, cats,
    pms: vehStat(pms), aif: vehStat(aif),
    bse: benchLadder("BSE 500 TRI"), nifty: benchLadder("Nifty 50 TRI"),
    managers: data.meta().manager_count ?? new Set(funds.map((f) => f.manager)).size,
  };
}
function catBeat(funds, cat) {
  const xs = funds.filter((f) => f.category === cat && f.alpha?.y1 != null);
  if (!xs.length) return null;
  return Math.round((100 * xs.filter((f) => f.alpha.y1 > 0).length) / xs.length);
}

// ── hero chart (median 1Y return by category) → PNG ───────────────────────────
function heroOption(d) {
  const rows = d.cats.filter((c) => c.median_y1 != null).slice().sort((a, b) => a.median_y1 - b.median_y1);
  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 6, right: 64, top: 6, bottom: 6, containLabel: true },
    xAxis: { type: "value", axisLabel: { formatter: (v) => v + "%", color: "#7c7466", fontSize: 13, fontFamily: "JetBrains Mono" }, splitLine: { lineStyle: { color: "#e7ddc9" } } },
    yAxis: {
      type: "category", data: rows.map((c) => categoryLabel(c.category)),
      axisTick: { show: false }, axisLine: { lineStyle: { color: INK } },
      axisLabel: { color: INK, fontSize: 14, fontWeight: 600, fontFamily: "Space Grotesk" },
    },
    series: [{
      type: "bar",
      data: rows.map((c) => ({ value: c.median_y1, itemStyle: { color: c.median_y1 >= 0 ? POS : NEG, borderRadius: [0, 5, 5, 0] } })),
      barMaxWidth: 22,
      label: { show: true, position: "right", formatter: (p) => (p.value >= 0 ? "+" : "") + p.value.toFixed(1) + "%", color: INK, fontSize: 13, fontWeight: 700, fontFamily: "JetBrains Mono" },
    }],
  };
}
async function chartPng(stage, option, w, h) {
  if (!window.echarts) return "";
  const div = document.createElement("div");
  div.style.cssText = `width:${w}px;height:${h}px;position:absolute;left:0;top:0;`;
  stage.appendChild(div);
  const c = window.echarts.init(div, null, { renderer: "canvas" });
  c.setOption(option);
  await new Promise((r) => setTimeout(r, 80));
  let url = "";
  try { url = c.getDataURL({ pixelRatio: 2, backgroundColor: "transparent" }); } catch { /* ignore */ }
  c.dispose(); div.remove();
  return url;
}

// ── page 1 (front page) ───────────────────────────────────────────────────────
function masthead(d) {
  return `<header class="np-mast">
    <div class="np-mast-rules"><span></span><span class="np-mast-est">EST. 2026 · MUMBAI</span><span></span></div>
    <h1 class="np-nameplate">Munshot</h1>
    <div class="np-nameplate-sub"><span>NEWSPAPER</span></div>
    <p class="np-mast-tag">THE PMS &amp; AIF PERFORMANCE CHRONICLE</p>
    <div class="np-dateline">
      <span>MUMBAI EDITION</span><span>${escapeHtml(d.monthName)}</span><span>VOL. 1 · NO. 1</span><span>FUND SCREENER — MGA</span>
    </div>
  </header>`;
}
function statRow(label, value, color) {
  return `<div class="np-stat"><span class="np-stat-k">${label}</span><span class="np-stat-v" style="${color ? `color:${color}` : ""}">${value}</span></div>`;
}
function page1(d, heroUrl) {
  const lead = d.top1y[0];
  const name = clip(lead.approach || lead.manager, 42);
  const gap = (lead.returns.y1 - d.s.medianY1);
  const spread = (d.best1y != null && d.worst1y != null) ? (d.best1y - d.worst1y) : null;
  const bestCat = d.cats[0], worstCat = d.cats[d.cats.length - 1];
  const t2 = d.top1y[1], t3 = d.top1y[2];
  const body = `
    <p><span class="np-dropcap">${escapeHtml((name[0] || "A").toUpperCase())}</span>${escapeHtml(name.slice(1))}, a ${escapeHtml(lead.vehicle)} ${escapeHtml(categoryLabel(lead.category))} mandate from ${escapeHtml(clip(lead.manager, 38))}, has vaulted to the head of India's discretionary league, returning <b>${pc(lead.returns.y1)}</b> over the trailing twelve months — roughly ${escapeHtml(Math.round(Math.abs(gap)).toString())} points clear of the ${d.funds.length.toLocaleString("en-IN")}-strong field's <b>${pc(d.s.medianY1)}</b> median.</p>
    <p>The breadth of outcomes is the real story. Across ${d.funds.length.toLocaleString("en-IN")} portfolios run by ${escapeHtml(String(d.managers))} managers, one-year results stretched from ${pc(d.best1y)} at the summit to ${pc(d.worst1y)} at the floor${spread != null ? ` — a chasm of ${Math.round(spread)} percentage points` : ""}. Trailing the leader sit ${escapeHtml(clip(t2?.approach || t2?.manager, 26))} at ${pc(t2?.returns?.y1)} and ${escapeHtml(clip(t3?.approach || t3?.manager, 26))} at ${pc(t3?.returns?.y1)}.</p>
    <p>Measured against the tape, ${Math.round(d.s.beatingPct)}% of funds carrying a benchmark cleared it, for a median one-year alpha of <b>${pc(d.s.medianAlphaY1)}</b>. The BSE 500 TRI returned ${pc(d.bse.y1)} and the Nifty 50 TRI ${pc(d.nifty.y1)} over the window — the yardsticks against which most of this field is judged.</p>
    <p>By style, ${escapeHtml(categoryLabel(bestCat.category))} led the pack with a ${pc(bestCat.median_y1)} median, while ${escapeHtml(categoryLabel(worstCat.category))} brought up the rear at ${pc(worstCat.median_y1)}. Stretch the lens to three years and the noise subsides: the typical fund compounded <b>${pc(d.s.medianY3)}</b> a year.</p>
    <p>For allocators the takeaway is selection over exposure. The distance between the best fund and the median dwarfs the distance between the median and the index — a market that has paid, handsomely, for getting the manager right.</p>`;
  return `<section class="np-page">
    ${masthead(d)}
    <div class="np-front">
      <div class="np-lead">
        <div class="np-kicker np-k-indigo">MARKET LEADERS · ${escapeHtml(d.monthName)}</div>
        <h2 class="np-headline">${escapeHtml(name)} Tops the ${d.funds.length.toLocaleString("en-IN")}-Fund Field at ${pc(lead.returns.y1)}</h2>
        <p class="np-deck">A ${escapeHtml(lead.vehicle)} ${escapeHtml(categoryLabel(lead.category))} strategy runs away with the year as the median fund barely clears flat and ${Math.round(d.s.beatingPct)}% of the field beats its benchmark.</p>
        <div class="np-byline">By Fund Screener — MGA · Data Desk</div>
        <div class="np-body">${body}</div>
        <figure class="np-figure">
          <figcaption class="np-fig-title">MEDIAN 1-YEAR RETURN BY CATEGORY</figcaption>
          ${heroUrl ? `<img src="${heroUrl}" alt="median return by category"/>` : `<div class="np-fig-fallback">chart</div>`}
        </figure>
      </div>
      <aside class="np-side">
        <div class="np-box">
          <div class="np-box-hd np-bg-grad">BY THE NUMBERS</div>
          <div class="np-box-bd">
            ${statRow("Funds tracked", d.funds.length.toLocaleString("en-IN"))}
            ${statRow("PMS · AIF", `${d.pms.n.toLocaleString("en-IN")} · ${d.aif.n.toLocaleString("en-IN")}`)}
            ${statRow("Managers", String(d.managers))}
            ${statRow("Median 1-yr", pc(d.s.medianY1), d.s.medianY1 >= 0 ? POS : NEG)}
            ${statRow("Median 3-yr", pc(d.s.medianY3), d.s.medianY3 >= 0 ? POS : NEG)}
            ${statRow("Beating benchmark", Math.round(d.s.beatingPct) + "%")}
            ${statRow("Median 1-yr alpha", pc(d.s.medianAlphaY1), d.s.medianAlphaY1 >= 0 ? POS : NEG)}
            ${statRow("Best 1-yr", pc(d.best1y), POS)}
            ${statRow("Worst 1-yr", pc(d.worst1y), NEG)}
          </div>
        </div>
        <div class="np-teaser">
          <div class="np-kicker np-k-pink">ALPHA KINGS</div>
          <h3 class="np-teaser-h">Skill, Not Just Beta</h3>
          <p>${escapeHtml(clip(d.topA[0]?.approach || d.topA[0]?.manager, 30))} leads on pure outperformance, beating its benchmark by <b>${pc(d.topA[0]?.alpha?.y1)}</b> over the year. The full alpha league runs on Page 2.</p>
        </div>
        <div class="np-teaser">
          <div class="np-kicker np-k-amber">PMS vs AIF</div>
          <h3 class="np-teaser-h">Who's Winning?</h3>
          <p>${d.pms.n.toLocaleString("en-IN")} PMS strategies posted a ${pc(d.pms.y1)} median; ${d.aif.n.toLocaleString("en-IN")} AIFs returned ${pc(d.aif.y1)}. ${(d.aif.y1 ?? -9) > (d.pms.y1 ?? -9) ? "AIFs" : "PMS"} edge the one-year read.</p>
        </div>
      </aside>
    </div>
    <footer class="np-folio"><span>MUNSHOT · ${escapeHtml(d.monthName)}</span><span>Performance as reported by the sources — not investment advice.</span><span>PAGE 1</span></footer>
  </section>`;
}

// ── page 2 (league tables) ────────────────────────────────────────────────────
function tbl(cols, rows) {
  const head = cols.map((c) => `<th class="${c.cls || ""}" style="${c.w ? `width:${c.w}` : ""}">${c.h}</th>`).join("");
  const body = rows.map((r, i) => `<tr>${cols.map((c) => `<td class="${c.cls || ""}">${c.f(r, i)}</td>`).join("")}</tr>`).join("");
  return `<table class="np-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
const rankCell = (r, i) => `<span class="np-rank">${i + 1}</span>`;
const fundCell = (r, n) => `<div class="np-fname">${escapeHtml(clip(r.approach || r.manager, n))}</div><div class="np-fmgr">${escapeHtml(clip(r.manager, n + 6))}</div>`;

function page2(d) {
  const t1 = tbl([
    { h: "#", cls: "np-c", w: "22px", f: rankCell },
    { h: "Fund / Manager", f: (r) => fundCell(r, 32) },
    { h: "Veh", cls: "np-c", w: "32px", f: (r) => escapeHtml(r.vehicle) },
    { h: "Category", cls: "np-nowrap", w: "92px", f: (r) => escapeHtml(npCat(r.category)) },
    { h: "1Y", cls: "np-r", w: "62px", f: (r) => `<b class="${cls(r.returns?.y1)}">${pc(r.returns?.y1)}</b>` },
    { h: "3Y", cls: "np-r", w: "58px", f: (r) => `<span class="${cls(r.returns?.y3)}">${pc(r.returns?.y3)}</span>` },
    { h: "AUM", cls: "np-r", w: "80px", f: (r) => escapeHtml(fmtAum(r.aum_cr)) },
  ], d.top1y);
  const t3 = tbl([
    { h: "#", cls: "np-c", w: "20px", f: rankCell },
    { h: "Fund / Manager", f: (r) => fundCell(r, 20) },
    { h: "3Y", cls: "np-r", f: (r) => `<b class="${cls(r.returns?.y3)}">${pc(r.returns?.y3)}</b>` },
    { h: "1Y", cls: "np-r", f: (r) => `<span class="${cls(r.returns?.y1)}">${pc(r.returns?.y1)}</span>` },
  ], d.top3y);
  const ta = tbl([
    { h: "#", cls: "np-c", w: "20px", f: rankCell },
    { h: "Fund / Manager", f: (r) => fundCell(r, 20) },
    { h: "α 1Y", cls: "np-r", f: (r) => `<b class="${cls(r.alpha?.y1)}">${pc(r.alpha?.y1)}</b>` },
    { h: "1Y", cls: "np-r", f: (r) => `<span class="${cls(r.returns?.y1)}">${pc(r.returns?.y1)}</span>` },
  ], d.topA);
  const cat = tbl([
    { h: "Category", f: (r) => `<b>${escapeHtml(categoryLabel(r.category))}</b>` },
    { h: "Funds", cls: "np-r", w: "56px", f: (r) => r.fund_count.toLocaleString("en-IN") },
    { h: "Med 1Y", cls: "np-r", w: "70px", f: (r) => `<span class="${cls(r.median_y1)}">${pc(r.median_y1)}</span>` },
    { h: "Med 3Y", cls: "np-r", w: "70px", f: (r) => `<span class="${cls(r.median_y3)}">${pc(r.median_y3)}</span>` },
    { h: "Med α", cls: "np-r", w: "64px", f: (r) => `<span class="${cls(r.median_alpha_y1)}">${pc(r.median_alpha_y1)}</span>` },
    { h: "%Beat", cls: "np-r", w: "56px", f: (r) => (r.beat == null ? "—" : r.beat + "%") },
  ], d.cats);

  const leadVeh = (d.pms.y1 ?? -9) >= (d.aif.y1 ?? -9) ? "PMS" : "AIF";
  return `<section class="np-page np-page2">
    <header class="np-p2hd">
      <div class="np-p2hd-l"><span class="np-mini">Munshot</span><span class="np-mini-sub">NEWSPAPER · ${escapeHtml(d.monthName)}</span></div>
      <h2 class="np-p2title">League Tables &amp; Analysis</h2>
      <div class="np-p2hd-r">PAGE 2</div>
    </header>

    <div class="np-sec">
      <div class="np-kicker np-k-emerald">TOP 8 · BY ONE-YEAR RETURN</div>
      ${t1}
    </div>

    <div class="np-cols2">
      <div class="np-sec"><div class="np-kicker np-k-indigo">TOP 8 · THREE-YEAR (CAGR)</div>${t3}</div>
      <div class="np-sec"><div class="np-kicker np-k-pink">TOP 8 · ALPHA GENERATORS</div>${ta}</div>
    </div>

    <div class="np-sec">
      <div class="np-kicker np-k-violet">CATEGORY ROUNDUP · MEDIANS &amp; HIT-RATE</div>
      ${cat}
    </div>

    <div class="np-band">
      <div class="np-box np-band-box">
        <div class="np-box-hd np-bg-indigo">PMS vs AIF</div>
        <div class="np-box-bd">
          ${statRow("PMS · median 1Y", pc(d.pms.y1), d.pms.y1 >= 0 ? POS : NEG)}
          ${statRow("AIF · median 1Y", pc(d.aif.y1), d.aif.y1 >= 0 ? POS : NEG)}
          ${statRow("PMS · median 3Y", pc(d.pms.y3))}
          ${statRow("AIF · median 3Y", pc(d.aif.y3))}
          <div class="np-verdict">${leadVeh} leads the 1-year read.</div>
        </div>
      </div>
      <div class="np-box np-band-box">
        <div class="np-box-hd np-bg-emerald">THE BENCHMARKS</div>
        <div class="np-box-bd">
          ${statRow("BSE 500 TRI · 1Y", pc(d.bse.y1), d.bse.y1 >= 0 ? POS : NEG)}
          ${statRow("BSE 500 TRI · 3Y", pc(d.bse.y3))}
          ${statRow("Nifty 50 TRI · 1Y", pc(d.nifty.y1), d.nifty.y1 >= 0 ? POS : NEG)}
          ${statRow("Nifty 50 TRI · 3Y", pc(d.nifty.y3))}
          <div class="np-verdict">The market the field is measured against.</div>
        </div>
      </div>
      <div class="np-box np-band-box">
        <div class="np-box-hd np-bg-rose">THE WATCH LIST</div>
        <div class="np-box-bd np-watch">
          ${d.worst.slice(0, 5).map((f) => `<div class="np-stat"><span class="np-stat-k">${escapeHtml(clip(f.approach || f.manager, 24))}</span><span class="np-stat-v np-neg">${pc(f.returns?.y1)}</span></div>`).join("")}
          <div class="np-verdict">Year's hardest one-year losses — a reminder dispersion cuts both ways.</div>
        </div>
      </div>
    </div>

    <footer class="np-colophon">
      Sources: APMI (PMS) · PMS Bazaar (AIF) · as of ${escapeHtml(d.monthName)}. Returns ≤1Y absolute, &gt;1Y annualised (CAGR); alpha vs stated benchmark. Performance as reported by the sources — <b>not investment advice</b>. Composed by Fund Screener — MGA.
    </footer>
  </section>`;
}

// ── styles (injected once) ────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("np-styles")) return;
  const css = `
  #np-stage{ position:fixed; left:-12000px; top:0; z-index:-1; }
  .np-page{ width:${PAGE_W}px; height:${PAGE_H}px; background:${CREAM}; color:${INK}; box-sizing:border-box; padding:30px 34px 22px; display:flex; flex-direction:column; overflow:hidden; font-family:"Newsreader",Georgia,serif; position:relative; }
  .np-page + .np-page{ margin-top:30px; }
  .np-pos{ color:${POS}; } .np-neg{ color:${NEG}; }
  /* masthead */
  .np-mast{ text-align:center; }
  .np-mast-rules{ display:flex; align-items:center; gap:12px; }
  .np-mast-rules span:first-child, .np-mast-rules span:last-child{ flex:1; height:0; border-top:2px solid ${INK}; }
  .np-mast-est{ font-family:"Space Grotesk",sans-serif; font-size:9px; font-weight:600; letter-spacing:.45em; }
  .np-nameplate{ font-family:"Playfair Display",serif; font-weight:900; font-size:92px; line-height:.84; letter-spacing:-2px; margin:4px 0 0; background:linear-gradient(100deg,#6366F1,#A855F7 48%,#EC4899 88%); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .np-nameplate-sub{ display:flex; align-items:center; justify-content:center; gap:12px; margin-top:1px; }
  .np-nameplate-sub::before, .np-nameplate-sub::after{ content:""; height:0; border-top:1.5px solid ${INK}; width:74px; }
  .np-nameplate-sub span{ font-family:"Space Grotesk",sans-serif; font-weight:800; font-size:22px; letter-spacing:.56em; padding-left:.56em; color:${INK}; }
  .np-mast-tag{ font-family:"Space Grotesk",sans-serif; font-size:10px; font-weight:500; letter-spacing:.34em; margin:7px 0 0; color:#46423a; }
  .np-dateline{ display:flex; justify-content:space-between; font-family:"Space Grotesk",sans-serif; font-size:9.5px; letter-spacing:.14em; border-top:1px solid ${INK}; border-bottom:3px double ${INK}; padding:5px 2px; margin-top:7px; }
  /* front grid */
  .np-front{ flex:1; display:grid; grid-template-columns:1fr 236px; gap:18px; min-height:0; margin-top:10px; }
  .np-lead{ display:flex; flex-direction:column; min-height:0; border-right:1px solid #ddd2bc; padding-right:18px; }
  .np-kicker{ font-family:"Space Grotesk",sans-serif; font-size:10px; font-weight:700; letter-spacing:.18em; text-transform:uppercase; padding:2px 0; margin-bottom:4px; border-bottom:2px solid; display:inline-block; }
  .np-k-indigo{ color:#6366F1; border-color:#6366F1; } .np-k-pink{ color:#EC4899; border-color:#EC4899; }
  .np-k-amber{ color:#D97706; border-color:#F59E0B; } .np-k-emerald{ color:#059669; border-color:#10B981; }
  .np-k-violet{ color:#7C3AED; border-color:#A855F7; }
  .np-headline{ font-family:"Playfair Display",serif; font-weight:800; font-size:33px; line-height:1.03; letter-spacing:-.3px; margin:2px 0 6px; }
  .np-deck{ font-family:"Fraunces",serif; font-weight:600; font-size:14px; line-height:1.32; color:#3a3630; margin:0 0 4px; }
  .np-byline{ font-family:"Space Grotesk",sans-serif; font-size:9.5px; letter-spacing:.1em; text-transform:uppercase; color:#8a8270; border-top:1px solid ${INK}; border-bottom:1px solid ${INK}; padding:3px 0; margin-bottom:8px; }
  .np-body{ flex:1; min-height:0; overflow:hidden; column-count:2; column-gap:18px; column-rule:1px solid #ddd2bc; text-align:justify; hyphens:auto; }
  .np-body p{ font-size:11.5px; line-height:1.42; margin:0 0 6px; }
  .np-dropcap{ float:left; font-family:"Playfair Display",serif; font-weight:900; font-size:52px; line-height:.74; padding:6px 7px 0 0; color:#6366F1; }
  .np-figure{ margin:6px 0 0; border-top:2px solid ${INK}; padding-top:5px; }
  .np-fig-title{ font-family:"Space Grotesk",sans-serif; font-size:10px; font-weight:700; letter-spacing:.16em; margin-bottom:3px; }
  .np-figure img{ display:block; width:100%; height:236px; object-fit:contain; }
  .np-fig-fallback{ height:236px; display:flex; align-items:center; justify-content:center; color:#bbb; }
  /* sidebar */
  .np-side{ display:flex; flex-direction:column; gap:12px; min-height:0; }
  .np-box{ border:2px solid ${INK}; background:#fffdf8; display:flex; flex-direction:column; }
  .np-box-hd{ font-family:"Space Grotesk",sans-serif; font-size:12px; font-weight:700; letter-spacing:.14em; color:#fff; padding:6px 9px; }
  .np-bg-grad{ background:linear-gradient(100deg,#6366F1,#A855F7 50%,#EC4899); }
  .np-bg-indigo{ background:#6366F1; } .np-bg-emerald{ background:#059669; } .np-bg-rose{ background:#E11D48; }
  .np-box-bd{ padding:6px 9px; flex:1; }
  .np-stat{ display:flex; justify-content:space-between; align-items:baseline; gap:6px; padding:3.5px 0; border-bottom:1px solid #ece3cf; }
  .np-stat:last-child{ border-bottom:0; }
  .np-stat-k{ font-family:"Newsreader",serif; font-size:12px; color:#46423a; }
  .np-stat-v{ font-family:"JetBrains Mono",monospace; font-size:13px; font-weight:700; }
  .np-teaser{ border-top:2px solid ${INK}; padding-top:6px; flex:1; min-height:0; overflow:hidden; }
  .np-teaser-h{ font-family:"Fraunces",serif; font-weight:700; font-size:17px; line-height:1.05; margin:2px 0 4px; }
  .np-teaser p{ font-size:11.5px; line-height:1.4; margin:0; text-align:justify; }
  .np-folio{ display:flex; justify-content:space-between; font-family:"Space Grotesk",sans-serif; font-size:8.5px; letter-spacing:.1em; text-transform:uppercase; color:#8a8270; border-top:2px solid ${INK}; padding-top:5px; margin-top:8px; }
  /* page 2 */
  .np-p2hd{ display:flex; align-items:center; justify-content:space-between; border-bottom:3px double ${INK}; padding-bottom:6px; }
  .np-p2hd-l{ display:flex; flex-direction:column; }
  .np-mini{ font-family:"Playfair Display",serif; font-weight:900; font-size:30px; line-height:.9; background:linear-gradient(100deg,#6366F1,#A855F7 55%,#EC4899); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .np-mini-sub{ font-family:"Space Grotesk",sans-serif; font-size:9px; font-weight:700; letter-spacing:.22em; color:${INK}; }
  .np-p2hd-r{ font-family:"Space Grotesk",sans-serif; font-size:9px; letter-spacing:.2em; color:#8a8270; align-self:flex-end; }
  .np-p2title{ font-family:"Playfair Display",serif; font-weight:900; font-size:30px; letter-spacing:-.5px; margin:0; }
  .np-page2{ justify-content:space-between; }
  .np-sec{ margin-top:0; display:flex; flex-direction:column; }
  .np-cols2{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:0; }
  .np-tbl{ width:100%; border-collapse:collapse; font-family:"JetBrains Mono",monospace; margin-top:3px; }
  .np-tbl th{ font-family:"Space Grotesk",sans-serif; font-size:8.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; text-align:left; color:#6b6454; border-bottom:1.5px solid ${INK}; padding:4px 7px; }
  .np-tbl td{ font-size:10px; padding:3px 7px; border-bottom:1px solid #e7ddc9; vertical-align:middle; }
  .np-tbl tr:nth-child(even) td{ background:rgba(99,102,241,.04); }
  .np-tbl th.np-r, .np-tbl td.np-r{ text-align:right; } .np-tbl th.np-c, .np-tbl td.np-c{ text-align:center; }
  .np-r{ text-align:right; } .np-c{ text-align:center; } .np-nowrap{ white-space:nowrap; }
  .np-tbl td{ white-space:nowrap; }
  .np-rank{ display:inline-flex; width:15px; height:15px; align-items:center; justify-content:center; border-radius:50%; background:${INK}; color:#fff; font-size:8.5px; font-weight:700; }
  .np-fname{ font-family:"Newsreader",serif; font-size:10.5px; font-weight:600; line-height:1.18; }
  .np-fmgr{ font-family:"Space Grotesk",sans-serif; font-size:7.5px; color:#8a8270; line-height:1.12; letter-spacing:.02em; }
  .np-band{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:0; }
  .np-band-box{ overflow:hidden; }
  .np-band-box .np-box-hd{ font-size:11px; padding:5px 8px; }
  .np-band-box .np-box-bd{ padding:4px 9px; }
  .np-band-box .np-stat{ padding:1.5px 0; }
  .np-band-box .np-stat-k{ font-size:11px; } .np-band-box .np-stat-v{ font-size:12px; }
  .np-band-box .np-verdict{ margin-top:3px; font-size:10px; }
  .np-watch .np-stat-k{ font-family:"Newsreader",serif; }
  .np-verdict{ font-family:"Fraunces",serif; font-style:italic; font-size:11px; color:#46423a; margin-top:6px; line-height:1.3; }
  .np-colophon{ font-family:"Space Grotesk",sans-serif; font-size:8.5px; line-height:1.5; letter-spacing:.04em; color:#6b6454; border-top:2px solid ${INK}; padding-top:6px; margin-top:10px; text-align:center; }
  `;
  const st = document.createElement("style");
  st.id = "np-styles"; st.textContent = css;
  document.head.appendChild(st);
}

// ── orchestrator ──────────────────────────────────────────────────────────────
let _busy = false;
export async function getInsight(btn) {
  if (_busy) return;
  _busy = true;
  const label = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i data-lucide="loader" class="h-4 w-4 animate-spin"></i> Composing your edition…`; window.lucide?.createIcons(); }

  const stage = document.createElement("div");
  stage.id = "np-stage";
  document.body.appendChild(stage);

  try {
    await ensureLibs();
    const d = gather();
    const heroUrl = await chartPng(stage, heroOption(d), 470, 240);
    stage.innerHTML = page1(d, heroUrl) + page2(d);
    await waitFonts();
    await new Promise((r) => setTimeout(r, 120)); // let layout/images settle

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [PAGE_W, PAGE_H], compress: true });
    const pages = stage.querySelectorAll(".np-page");
    for (let i = 0; i < pages.length; i++) {
      const canvas = await window.html2canvas(pages[i], {
        scale: 2, backgroundColor: CREAM, useCORS: true, logging: false,
        width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W, windowHeight: PAGE_H,
      });
      if (i > 0) pdf.addPage([PAGE_W, PAGE_H], "portrait");
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, PAGE_W, PAGE_H, undefined, "FAST");
    }
    pdf.save(`Munshot-Newspaper-${d.m}.pdf`);
  } catch (err) {
    console.error("Get Insight failed:", err);
    alert("Couldn't compose the newspaper — please retry on a connected network.");
  } finally {
    stage.remove();
    if (btn && label != null) { btn.disabled = false; btn.innerHTML = label; window.lucide?.createIcons(); }
    _busy = false;
  }
}
