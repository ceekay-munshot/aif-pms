# Fund Screener — MGA

A static analytics dashboard that screens Indian **PMS** (Portfolio Management
Services) and **AIF** (Alternative Investment Fund) performance. It lets a
buy-side client filter and sort on return/alpha metrics across time periods and
surfaces the top-performing firms. Sister product to **Fund Tracker — MGA**, with
which it shares an exact visual language.

## Stack

- **Static site, zero build step.** Everything in `public/` loads via CDN
  (Tailwind Play CDN, Google Fonts, Lucide, ECharts 5, ExcelJS).
- **Cloudflare Worker** (`worker/index.js`) serves the static assets through the
  `ASSETS` binding. `/api/*` is reserved for later.
- **Datastore is committed JSON** under `public/data/` — no database. Cadence is
  **monthly** (PMS/AIF performance is reported at month-end).
- Performance scrapers (added in later prompts) are standalone Node ESM `.mjs`
  files under `perf-scraper/`, with deps installed `--no-save`.

## Run locally

```bash
npx wrangler dev
```

Then open the printed URL. The dashboard boots from the placeholder data in
`public/data/`.

## Status

This is being **built as a 12-step project**. See `CLAUDE.md` for the full
architecture, data contract, conventions, and the step-by-step roadmap. This
README is fleshed out in the final step.
