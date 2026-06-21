# CLAUDE.md — Fund Screener — MGA

> Persistent context for every session. **Read this first.** It is the source of
> truth for what this project is, how it is built, the data contract, the
> conventions to follow, and the roadmap of where we are.

## 1. Project identity & purpose

**Fund Screener — MGA** is a static analytics dashboard that screens Indian
**PMS** (Portfolio Management Services) and **AIF** (Alternative Investment Fund)
performance. A buy-side client uses it to **filter and sort** funds on
return/alpha metrics across time periods and to **surface the top-performing
firms**.

It is the **sister product to "Fund Tracker — MGA"** and **must share its exact
visual language** — the design tokens in `public/js/ui.js` and the `<style>`
block in `public/index.html` are the brand DNA and must not drift.

## 2. Architecture

A proven pattern carried over from the sister repo:

- **Static site, zero build step.** Everything in `public/` loads via CDN:
  Tailwind Play CDN, Google Fonts, Lucide icons, ECharts 5, ExcelJS. **No
  bundler, no frontend npm packages.**
- **Cloudflare Worker** at `worker/index.js` serves the static assets through the
  `ASSETS` binding and falls through to them for any non-API route. `/api/*` is
  **reserved** for the future — none implemented yet.
- **The datastore is committed JSON** under `public/data/`. **No database.**
- **Monthly** data cadence — PMS/AIF performance is reported at month-end.
- **Scrapers** (later prompts) are standalone **Node ESM `.mjs`** files under
  `perf-scraper/`, with dependencies installed **`--no-save`** (never committed).
- **GitHub Actions** (later) runs the pipeline monthly and commits refreshed data
  to `main`.

### Layout

```
wrangler.jsonc            Worker + static-assets config (name: fund-screener)
worker/index.js           Minimal Worker (ASSETS fall-through; /api/* reserved)
public/
  index.html              Dashboard shell + design-system <style> block
  js/ui.js                Shared design system (tokens, formatting, charts, loadData)
  js/data.js              Shared data/selectors layer (filter/sort/rank/topN, deltas, history)
  js/drill.js             Shared fund-drill modal + reusable ladder/sparkline/vehicle pill
  js/screener.js          Screener tab: filter bar + sortable/paginated table + category-relative top-N + getScreenerView()
  js/app.js               Boot + shell behaviour (KPI strip, tabs)
  data/
    funds-performance.json   Core file: all funds for the latest month
    metadata.json            Counts + sources for the latest month
    snapshots/
      index.json             Trail index across months
      <YYYY-MM>.json         One snapshot per month (powers Movers)
perf-scraper/             (later) ESM .mjs scrapers + orchestrator
```

## 3. Data sources

- **APMI** — **PMS** data. **Public, no login.**
  `https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu`
  - **Mechanics (confirmed live, May 2026):** the grid is populated by
    `POST …?action=loadIAReport` (returns an **HTML** `<table>`) with form params
    `strategyname=Equity`, `SelectedBenchmark=<id>`, `asOnDate=YYYY-M-D` (month-end,
    no zero-pad), `servicetype=D`. The **period dropdown is client-side** (each
    response already carries the full ladder incl. 2Y/3Y/4Y); the **benchmark
    dropdown is server-side** and partitions the universe — **BSE 500 TRI (810) +
    MSEI SX 40 TRI (8) + Nifty 50 TRI (383) = 1,201 IAs across 354 managers**. The
    scraper POSTs once per benchmark to get every period **and** each fund's
    `benchmark` name (`scrape-apmi.mjs`).
  - **Gaps handled in normalize (step 4):** APMI exposes **no benchmark return
    values** here → `benchmark_returns` (and thus **alpha**) must be sourced for
    just those 3 indices in step 4. `category` is **classified** in step 4;
    `inception` is not shown (stays `null`). Returns >1Y are CAGR, ≤1Y absolute.
- **PMS Bazaar** — **AIF** data. **Login-gated.** Credentials come from secrets
  **`PMSBAZAAR_EMAIL`** / **`PMSBAZAAR_PASSWORD`** and are driven with
  **Playwright** — the same login approach as the sister repo's Screener login.
  - **Mechanics (confirmed live, May 2026):** login is an ASP.NET form at
    `/Home/Login` — the page also renders a **hidden** header/register login form,
    so target the **visible** field (`firstVisible`). After login, the AIF listing
    loads everything from one call: `POST /Visitor/AIFDashboardData` →
    **double-encoded JSON** (a quoted string containing the array) with **162 AIF
    schemes**. Each carries metadata (`AMCName`, `SchemeName`, `ProductName`=Cat
    type, `DisplayCategory`="CAT III - LONG ONLY", `AssetClass`=Long Only/Long-Short,
    `Category`=cap orientation, `AUM_In_Crs`, `BenchmarkIndex`,
    `Strategy_Inception_Date`) and a nested **`SchemeReturns[]`** with **both** the
    fund value (`SchemeReturnValue`) **and** the benchmark value (`IndexReturnValue`)
    per period → **PMS Bazaar exposes `benchmark_returns`** (`scrape-pmsbazaar.mjs`).
  - **For step 4:** AIF **alpha is derivable directly** (benchmark returns present);
    compose the unified `category` from `aif_category`(ProductName) + `strategy`
    (AssetClass) — `DisplayCategory` already encodes that form.

## 4. Data contract

Convention: **returns are numbers in percent** (e.g. `18.4` = 18.4%); use
**`null`** where a value is unavailable. Alpha is **derived**:
`alpha = returns − benchmark_returns` per period. Periods are
`m1, m3, m6, y1, y2, y3, y5, si` (`si` = since inception).

### `public/data/funds-performance.json` (core file)

```json
{
  "generated_at": "ISO-8601", "as_of_month": "YYYY-MM",
  "fund_count": 0, "manager_count": 0, "pms_count": 0, "aif_count": 0, "category_count": 0,
  "funds": [{
    "id": "slug(manager)-slug(approach)", "manager": "string", "approach": "string",
    "vehicle": "PMS|AIF", "category": "unified cap/style bucket",
    "strategy": "Long Only|Long-Short|null", "aif_cat": "Cat I|II|III|null (AIF only)",
    "aum_cr": "number|null", "benchmark": "string|null",
    "inception": "YYYY-MM-DD|null", "as_of": "YYYY-MM-DD", "as_of_month": "YYYY-MM",
    "returns": { "m1":0,"m3":0,"m6":0,"y1":0,"y2":0,"y3":0,"y5":0,"si":0 },
    "benchmark_returns": { "m1":0,"m3":0,"m6":0,"y1":0,"y2":0,"y3":0,"y5":0,"si":0 },
    "alpha": { "m1":0,"m3":0,"m6":0,"y1":0,"y2":0,"y3":0,"y5":0,"si":0 },
    "source": "APMI|PMS Bazaar", "source_url": "string|null",
    "source_category": "raw source label|null", "category_fallback": "true|absent (PMS unclear→Multi/Flexi)"
  }]
}
```

**Normalize (step 4, `perf-scraper/normalize.mjs` → `output/funds-normalized.json`):**
- **Unified category** = one cap/style taxonomy across both vehicles:
  `Large Cap · Large & Mid · Multi/Flexi Cap · Mid Cap · Mid & Small · Small Cap ·
  Thematic/Sectoral · Value/Contra · Debt · Hybrid/Multi-Asset · Unclassified`.
  AIF from PMS Bazaar `Category` (cap orientation); PMS from a documented keyword
  map (`CATEGORY_RULES`) on the approach name (unclear-but-equity → "Multi/Flexi Cap"
  + `category_fallback`). The map is **name-based & high-precision** — a clear
  cap/style/sector word must be present (incl. `\ball cap`/`smid`/`mnc`/`technolog`/
  `turnaround`; `\ball cap` keeps its leading `\b` so it never matches "sm-**all cap**").
  **"emerging" is deliberately not a rule** (ambiguous: markets vs. small/mid co's) →
  stays Multi/Flexi unless overridden. APMI benchmarks are only the 3 partition indices
  (BSE 500 / Nifty 50 / MSEI SX 40) so the benchmark is **not** a usable cap signal.
  Per-fund overrides live in **`perf-scraper/static/pms-category-overrides.json`**
  (id→bucket, applied before the classifier) — the human tuning knob, curated by AUM
  for marquee funds whose mandate is unambiguous (e.g. Marcellus CCP → Large Cap,
  Motilal NTDOP → Mid Cap, Abakkus Emerging → Mid & Small). A still-substantial
  Multi/Flexi bucket (~1,080) is expected: most PMS names genuinely encode no cap.
  Reclassifying a fund out of the fallback bucket **clears** its `category_fallback`
  flag (build-store's monotonic merge keeps the flag travelling with `category`).
- **alpha** = `returns − benchmark_returns` per period (null if either null). **AIF**:
  direct from per-period `IndexReturnValue`. **PMS**: APMI gives only the benchmark
  *name*, so index ladders are harvested (median `IndexReturnValue` per benchmark)
  into **`perf-scraper/static/benchmark-returns.json`** (committed, hand-overridable;
  e.g. add MSEI SX 40); matched by normalized name; **PMS `si` alpha is always null**.
  Uncovered benchmark → null ladder → null alpha (never blocks).

**Store (step 5, `perf-scraper/build-store.mjs` → `public/data/`):** folds
`funds-normalized.json` into **`funds-performance.json`** (the **latest-month**
full detail the Screener/Leaderboard/Categories read — stays small/fast) +
**`metadata.json`** (the "Updated" badge + counts). Month-over-month **history**
lives in **`snapshots/`** (step 6) and is never overwritten. **Dedup key =
`id + as_of_month`.** Merge: placeholder prior → dropped; **same month → overlay
by `id`** with **monotonic enrichment** (new non-null wins, else keep prior
non-null — never downgrade benchmark/alpha/inception/category to null; partial/
LIMIT runs keep prior funds); **new month → roll over** (prior month already in
its snapshot). Funds sorted by manager→approach. **Idempotent**: same input +
same prior ⇒ byte-identical output (`generated_at` preserved when unchanged).

### `public/data/metadata.json`

```json
{ "generated_at": "...", "as_of_month": "YYYY-MM",
  "sources": ["APMI (PMS)", "PMS Bazaar (AIF)"],
  "fund_count": 0, "pms_count": 0, "aif_count": 0, "manager_count": 0, "category_count": 0 }
```

### `public/data/snapshots/index.json`

```json
{ "updated_at": "...", "count": 0,
  "snapshots": [{ "month": "YYYY-MM", "fund_count": 0, "pms_count": 0, "aif_count": 0, "median_y1": 0 }] }
```

### `public/data/snapshots/<YYYY-MM>.json` (powers Movers; step 6, `write-snapshot.mjs`)

```json
{ "month": "YYYY-MM", "generated_at": "...",
  "totals": { "funds": 0, "pms": 0, "aif": 0, "managers": 0, "categories": 0 },
  "per_category": [{ "category": "...", "fund_count": 0, "median_y1": 0, "median_y3": 0, "median_alpha_y1": 0 }],
  "ranking": [{ "id": "...", "manager": "...", "approach": "...", "vehicle": "PMS|AIF", "category": "...",
               "aum_cr": null, "y1": null, "y3": null, "alpha_y1": null,
               "rank_overall": null, "rank_in_category": null }] }
```

`ranking` holds **ALL funds** (compact) — the per-fund record Movers diffs by `id`
across months. `rank_overall`/`rank_in_category` = rank by `y1` desc overall / within
category (competition ranking; null `y1` → null rank). `index.json` is **rebuilt
from the snapshot files on disk**. Idempotent: same store ⇒ byte-identical snapshot
(`generated_at`/`updated_at` preserved when unchanged); re-running a month overwrites
its file identically (never duplicates).

> The data currently in `public/data/` is **placeholder** (flagged
> `"_placeholder": true`, fictional managers) and is **overwritten by the
> pipeline in prompts 2–6**.

## 5. Conventions

- **Scrapers**: ESM `.mjs` under `perf-scraper/`; install deps **`--no-save`** so
  they are never committed (`node_modules/` is git-ignored).
- **Idempotent store**: dedup key is **`id + as_of_month`**. The store keeps
  **rolling history** — **append, never overwrite** past months.
- **Monotonic enrichment**: never downgrade a resolved field back to `null`. Once
  a value is known, a later partial run must not erase it.
- **Dating**: use **IST (`Asia/Kolkata`)** for "today" / month boundaries.
- **GitHub Actions** commits refreshed data to **`main`** with a
  **rebase-retry push** loop (fetch + rebase + retry on the non-fast-forward
  race when two runs collide). The production **`monthly-refresh.yml`** (cron
  `23 14 20 * *` + manual `month`/`limit` inputs) runs `run-pipeline.mjs` and
  commits `public/data/`. GitHub disables scheduled workflows after ~60 days of
  repo inactivity, but the monthly data commit keeps the repo active — so the
  schedule is **self-sustaining** once it has run.
- **Design tokens live in `ui.js`** (+ the `<style>` block in `index.html`).
  Treat them as the brand contract shared with Fund Tracker — MGA; do not let
  them drift.
- **Returns in percent, `null` for missing.** Alpha derived, never sourced.

## 6. 12-step roadmap

1. [x] Scaffold + design system + data contract
2. [x] APMI PMS scraper (public) → `perf-scraper/scrape-apmi.mjs`
3. [x] PMS Bazaar AIF scraper (login) → `perf-scraper/scrape-pmsbazaar.mjs`
4. [x] Normalize/unify + derive alpha → `perf-scraper/normalize.mjs`
5. [x] Build store (idempotent merge) → `perf-scraper/build-store.mjs`
6. [x] Monthly snapshot trail → `perf-scraper/write-snapshot.mjs`
7. [x] Orchestrator → `perf-scraper/run-pipeline.mjs`
8. [x] GitHub Actions (monthly + manual full backfill) → `.github/workflows/monthly-refresh.yml` (commits real data; manual tests `test-apmi`/`test-pmsbazaar`/`test-pipeline` stay artifact-only)
9. [x] Dashboard shell on real data → `js/data.js` + `js/drill.js` + KPI strip (Screener tab was a temporary Top-25, replaced in step 10; visual check via `shoot-dashboard.yml`)
10. [x] Screener tab (filters + sortable table + category-relative top-N) → `js/screener.js` (sticky filter bar: vehicle/category/search/min-AUM/period/Return-Alpha/min-threshold/category-relative top-N; sortable header ladder; frozen Fund column + nowrap numerics — fixes the α-clip; incremental pagination; removable chips; `getScreenerView()` for prompt 11 export)
11. [ ] Leaderboard / Categories / Movers + fund-drill modal + export
12. [ ] Docs + polish + deploy notes

## 7. Running locally

```bash
npx wrangler dev      # serves ./public via the Worker's ASSETS binding
```

The boot loader disappears, the KPI strip counts up from the (placeholder) data,
all four tabs switch, and the "Updated &lt;month&gt;" badge reflects
`as_of_month`.

### Running the scrapers (sandbox / CI egress)

Scrapers reach external hosts, so the runtime's **network egress allowlist** must
include them. In Claude Code on the web (and CI), allow:

- `www.apmiindia.org` — APMI (PMS), step 2
- `pmsbazaar.com` — PMS Bazaar (AIF), step 3 (login; needs `PMSBAZAAR_EMAIL` / `PMSBAZAAR_PASSWORD`)

Playwright's chromium is **preinstalled** at `PLAYWRIGHT_BROWSERS_PATH`; the
browser-download CDN may be blocked, so install deps with the download skipped:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright@1 cheerio@1 --no-save
node perf-scraper/scrape-apmi.mjs        # → perf-scraper/output/apmi-pms.json (gitignored)
```

Without the host allowlisted, `scrape-apmi.mjs` **fails fast (no junk data)** and
saves `perf-scraper/output/apmi-page.png` for inspection. Knobs: `LIMIT`,
`MONTH=YYYY-MM`, `HEADFUL=1`, `DEBUG=1`.

### Full pipeline (one command — step 7)

```bash
node perf-scraper/run-pipeline.mjs   # scrape-apmi → scrape-pmsbazaar → normalize → build-store → write-snapshot
```

Runs each step as a child process (env forwarded). Steps 1–4 are **required**
(abort + report which step on non-zero exit); `write-snapshot` is **non-fatal**.
Extra knobs: `SKIP_APMI=1` / `SKIP_PMSBAZAAR=1` (testing). Prints a consolidated
summary (counts, alpha coverage, new-funds-vs-prior-month, elapsed). This is what
step 8's scheduled Action invokes; the manual `test-pipeline.yml` runs it in CI.
