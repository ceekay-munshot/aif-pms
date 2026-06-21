# Fund Screener — MGA

A static analytics dashboard that screens Indian **PMS** (Portfolio Management
Services) and **AIF** (Alternative Investment Fund) performance. It lets a
**buy-side** user filter and sort **1,300+ funds** on return and alpha across
time periods, surface the top-performing managers, and drill into any fund —
all from committed JSON, with no backend and no build step.

Sister product to **Fund Tracker — MGA**, with which it shares an exact visual
language (the design tokens in `public/js/ui.js` + the `<style>` block in
`public/index.html`).

> **Current data:** 1,363 funds (1,201 PMS · 162 AIF) across 454 managers,
> as of **May 2026**. Refreshed monthly.

---

## What it shows

A KPI strip (funds tracked, median 1Y, median 3Y, % beating benchmark) over four tabs:

| Tab | What it does |
|---|---|
| **Screener** | Sticky filter bar (vehicle · category · search · min-AUM · period · Return/Alpha · min-threshold · category-relative top-N) over a sortable, paginated table with a frozen fund column and the full return/alpha ladder. |
| **Leaderboard** | Top-3 podium + ranked top-25 for any period/metric/vehicle/category, with quick presets (Best 1Y / 3Y / 5Y / Alpha 3Y). |
| **Categories** | Median-return-by-category bar chart (1Y/3Y) + a per-category table (counts, median 1Y/3Y/5Y, median α, best fund). Click a category to screen it. |
| **Movers** | Month-over-month Climbers / Fallers / New entrants + biggest 1Y change. Accrues from the monthly snapshot trail (it lights up once there are two months). |

Every row/card opens a **fund-drill** modal (returns-vs-benchmark ladder + 1Y
history sparkline + rank badge + ★ rating + "what ₹1 became"), you can **＋ Compare**
up to 3 funds side-by-side, and the header **Export** button downloads the current
view (or the full set) as a styled `.xlsx` (CSV fallback).

**Get Insight → Munshot Insights.** A header button composes a 2-page,
colorful editorial **PDF** ("MUNSHOT · INSIGHTS") from the live data in one click —
a lead story headlined from the month's standout, a By-the-Numbers box, league
tables (Top 8 by 1Y / 3Y / alpha), a category roundup, the BSE 500 / Nifty 50
benchmark strip, and a watch list. Built as fixed A4 pages (ECharts → PNG,
html2canvas + jsPDF); libraries and display fonts lazy-load from CDN, so it runs
on the live deploy (not behind a CDN-blocked network).

---

## How it works

A static front-end reads committed JSON produced by a monthly scraping pipeline.

```
scrape-apmi.mjs ─┐
                 ├─► normalize.mjs ─► build-store.mjs ─► write-snapshot.mjs
scrape-pmsbazaar ┘   (+derive alpha)   (rolling store)    (monthly trail)
        run by perf-scraper/run-pipeline.mjs
```

1. **`scrape-apmi.mjs`** — PMS performance from **APMI** (public, no login).
2. **`scrape-pmsbazaar.mjs`** — AIF performance from **PMS Bazaar** (login).
3. **`normalize.mjs`** — unify both into the data contract, classify a unified
   cap/style **category**, and **derive alpha** (`returns − benchmark_returns`).
4. **`build-store.mjs`** — fold this run into `funds-performance.json` +
   `metadata.json` (idempotent, monotonic-enrichment merge; dedup key
   `id + as_of_month`).
5. **`write-snapshot.mjs`** — append one compact dated snapshot + rebuild the
   index (powers Movers and per-fund history).

`run-pipeline.mjs` runs all five as child processes with env forwarded; steps
1–4 are required, the snapshot is non-fatal.

### Data sources

- **APMI** — PMS, **public** (`apmiindia.org`). Equity strategy; returns by
  period; benchmark *name* only (alpha is derived via a harvested index ladder).
- **PMS Bazaar** — AIF, **login-gated** (`pmsbazaar.com`), driven with Playwright
  using the **`PMSBAZAAR_EMAIL`** / **`PMSBAZAAR_PASSWORD`** secrets. Carries both
  the fund and benchmark return per period (alpha is direct).

Cadence is **monthly**, as of **month-end** (sources finalize the prior month
with a lag, so the pipeline runs mid/late month).

---

## Data files (`public/data/`)

| File | Purpose |
|---|---|
| `funds-performance.json` | The **latest month**, full detail — the file every tab reads. Kept small/fast. |
| `metadata.json` | Counts + sources + as-of month (the "Updated" badge). |
| `snapshots/<YYYY-MM>.json` | One compact snapshot per month (all funds, ranked) — the month-over-month history. **Never overwritten.** |
| `snapshots/index.json` | Trail index, rebuilt from the snapshot files on disk. |

Convention: **returns are numbers in percent** (`18.4` = 18.4%), `null` where
unavailable. Periods are `m1, m3, m6, y1, y2, y3, y5, si`. Alpha is **derived,
never sourced**. Full contract in `CLAUDE.md`.

---

## Tuning knobs (committed, hand-editable)

- **`perf-scraper/static/pms-category-overrides.json`** — `id → category` map,
  applied **before** the keyword classifier. The human knob for funds whose
  cap/style the name can't safely encode (curated by AUM for marquee funds).
- **`perf-scraper/static/benchmark-returns.json`** — canonical index return
  ladders used to derive **PMS** alpha (APMI gives only the benchmark name).
  Auto-harvested from the AIF data; **committed values win**, so you can add or
  override an index (e.g. MSEI SX 40) by hand.

After editing either, **regenerate** the data (see Maintenance) so the dashboard
reflects the change.

### Env knobs (scrapers / pipeline)

| Var | Effect |
|---|---|
| `MONTH=YYYY-MM` | Target reporting month (default: latest available). |
| `LIMIT=N` | Cap funds per source (0 = all). Handy for quick test runs. |
| `STRATEGY` | APMI strategy (default `Equity`). |
| `HEADFUL=1` | Run the browser headful (watch it). |
| `DEBUG=1` | Verbose: selects, endpoints, per-benchmark headers. |
| `EXPLORE=1` | Recon only — dump source structure, write nothing. |
| `SKIP_APMI=1` / `SKIP_PMSBAZAAR=1` | Skip a source (testing). |

---

## Automation

`.github/workflows/monthly-refresh.yml` runs the pipeline and **commits the
refreshed `public/data/` to `main`**:

- **Schedule:** `23 14 20 * *` (14:23 UTC on the 20th, monthly). The monthly
  data commit keeps the repo active, so the schedule is self-sustaining.
- **Manual:** `workflow_dispatch` with `month` (backfill/override) + `limit`
  inputs.
- **Push:** rebase-retry loop (fetch + rebase + exponential backoff) to survive
  the non-fast-forward race if two runs collide. The commit step **skips when
  there's no diff** (idempotent no-op).

Other workflows are artifact-only (no commits): `test-apmi.yml`,
`test-pmsbazaar.yml`, `test-pipeline.yml` (CI checks), and
`shoot-dashboard.yml` (screenshots every tab + verifies the Export download —
how the UI is reviewed, since the CDNs load on the runner).

---

## Deployment

Static assets served by a **Cloudflare Worker** — `wrangler.jsonc`
(`name: fund-screener`) maps the `ASSETS` binding to `./public`, and
`worker/index.js` falls through to those assets for every route (`/api/*` is
reserved). **No build step**; libraries (Tailwind, fonts, Lucide, ECharts,
ExcelJS) load from CDNs.

Cloudflare's Git integration **auto-deploys on push to `main`** and posts a
preview URL per PR.

### Run locally

```bash
npx wrangler dev      # serves ./public via the Worker's ASSETS binding
```

The boot loader clears, the KPI strip counts up, all four tabs switch, and the
"Updated &lt;month&gt;" badge reflects `as_of_month`.

---

## Honest caveats (please read)

- **Freshness.** Data is **monthly**, as of month-end, and the sources publish
  with a lag — figures can trail the calendar by a few weeks.
- **Categories.** Cap-style often **isn't determinable from a PMS approach name**.
  Those funds sit in a **"Diversified / Multi-Cap"** catch-all (~1,082 of 1,363)
  — that's deliberate, not a gap; the clean dimensions are vehicle, returns,
  alpha and AUM.
- **Alpha coverage.** Derived per period. **PMS ≈ 98.8%** (via the harvested
  index ladder; MSEI SX 40 and PMS *since-inception* alpha are `null`).
  **AIF ≈ 85.2%** (direct from source benchmark values).
- **Scope.** Equity only (APMI's Equity strategy). Debt/Hybrid PMS isn't
  ingested yet.
- **Returns convention.** ≤ 1Y are **absolute**, > 1Y are **annualised (CAGR)** —
  as reported by the sources.
- **Not advice.** Performance is shown **as reported by the sources** — this is
  an information tool, **not investment advice**.
- **AIF source access.** PMS Bazaar AIF data is accessed via **your authenticated
  subscription** — confirm your subscription / terms of service permit this use.

---

## Maintenance / runbook

**First-time Cloudflare setup**
1. Create the Worker from this repo (Git integration) — it serves `./public`.
2. Add repo **secrets** `PMSBAZAAR_EMAIL` + `PMSBAZAAR_PASSWORD`.
3. Trigger `monthly-refresh.yml` manually once to replace placeholder data with a
   real harvest (then the schedule takes over).

**Refresh / backfill a month**
- Run `monthly-refresh.yml` (manual). Leave `month` blank for the latest, or set
  `month=YYYY-MM` to backfill. Same-month re-runs are an idempotent overlay
  (categories/values update; counts stay put).
- Locally: `node perf-scraper/run-pipeline.mjs` (needs egress to
  `apmiindia.org` + `pmsbazaar.com` and the `PMSBAZAAR_*` env vars).

**Tune categories** — edit `pms-category-overrides.json`, then regenerate
(re-run the pipeline, or re-run `build-store.mjs` + `write-snapshot.mjs` if you
already have a normalized run).

**Patch a benchmark ladder** — edit `benchmark-returns.json` (committed values
win over harvested), then regenerate so PMS alpha picks it up.

**If a scraper breaks**
1. Run `shoot-dashboard.yml` / check the saved page PNGs the scraper writes on
   failure (e.g. `perf-scraper/output/apmi-page.png`).
2. Re-run the scraper with `DEBUG=1` (dumps selects/endpoints/headers) or
   `EXPLORE=1` (recon only — reveals how the source's toggles fire XHRs).
3. The scrapers **fail fast (no junk data)**; the pipeline aborts and reports
   which step failed, so a bad run never corrupts the committed store.

---

## Roadmap / future

- PMS-Bazaar PMS-category enrichment (real cap/style for the Diversified bucket).
- Debt / Hybrid PMS via the `STRATEGY` knob.
- Risk-adjusted metrics (volatility, drawdown, Sharpe) once enough monthly
  history accrues.

---

*Built as a 12-step project — see `CLAUDE.md` for the architecture, data
contract, conventions and the full roadmap.*
