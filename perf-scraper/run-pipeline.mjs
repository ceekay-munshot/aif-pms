/**
 * run-pipeline.mjs — the monthly orchestrator. Fund Screener — MGA · step 7 of 12.
 * Chains the five composable steps into one command (exactly what step 8's monthly
 * GitHub Action calls). Each step runs as a child process with stdio inherited and
 * the current env forwarded, so secrets / LIMIT / MONTH / DEBUG pass straight through.
 *
 *   1. scrape-apmi.mjs        required (fatal)      [skip: SKIP_APMI=1]
 *   2. scrape-pmsbazaar.mjs   required (fatal)      [skip: SKIP_PMSBAZAAR=1]
 *   3. normalize.mjs          required (fatal)
 *   4. build-store.mjs        required (fatal)
 *   5. write-snapshot.mjs     ALWAYS runs, NON-FATAL (store is already written by
 *                             build-store; a snapshot hiccup must not fail the run)
 *
 * Both scrapers are required by default so the monthly store is never published
 * half-complete. If a required step exits non-zero, abort immediately and report
 * exactly which step failed (exit code / signal). Then print a consolidated
 * summary read back from the resulting files.
 *
 * Env knobs (pass-through): LIMIT, MONTH=YYYY-MM, HEADFUL, DEBUG, EXPLORE,
 * STRATEGY, PMSBAZAAR_EMAIL/PASSWORD, plus SKIP_APMI / SKIP_PMSBAZAAR (testing).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const FP_JSON = path.join(DATA_DIR, 'funds-performance.json');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const INDEX_JSON = path.join(SNAP_DIR, 'index.json');

const PERIODS = ['m1', 'm3', 'm6', 'y1', 'y2', 'y3', 'y5', 'si'];
const truthy = (v) => /^(1|true|yes|on)$/i.test(v || '');
const log = (...a) => console.log(...a);

const STEPS = [
  { name: 'scrape-apmi', file: 'scrape-apmi.mjs', required: true, skipEnv: 'SKIP_APMI' },
  { name: 'scrape-pmsbazaar', file: 'scrape-pmsbazaar.mjs', required: true, skipEnv: 'SKIP_PMSBAZAAR' },
  { name: 'normalize', file: 'normalize.mjs', required: true },
  { name: 'build-store', file: 'build-store.mjs', required: true },
  { name: 'write-snapshot', file: 'write-snapshot.mjs', required: false },
];

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function runStep(step, i) {
  if (step.skipEnv && truthy(process.env[step.skipEnv])) {
    log(`\n▷ step ${i + 1}/${STEPS.length}: ${step.name} — SKIPPED (${step.skipEnv})`);
    return { skipped: true };
  }
  log(`\n▶ step ${i + 1}/${STEPS.length}: ${step.name}${step.required ? '' : ' (non-fatal)'}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, step.file)], {
    stdio: 'inherit',
    env: process.env,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.error) return { ok: false, status: null, signal: null, err: r.error.message, secs };
  if (r.signal) return { ok: false, status: null, signal: r.signal, secs };
  return { ok: r.status === 0, status: r.status, signal: null, secs };
}

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

function printSummary(elapsedMs) {
  log('\n════════ pipeline summary ════════');
  const fp = readJson(FP_JSON);
  if (fp && Array.isArray(fp.funds)) {
    log(`  as_of_month : ${fp.as_of_month}`);
    log(`  funds       : ${fp.fund_count}  (PMS ${fp.pms_count} · AIF ${fp.aif_count})`);
    log(`  managers    : ${fp.manager_count}   categories: ${fp.category_count}`);
    const anyAlpha = (f) => PERIODS.some((p) => f.alpha && f.alpha[p] != null);
    const pms = fp.funds.filter((f) => f.vehicle === 'PMS');
    const aif = fp.funds.filter((f) => f.vehicle === 'AIF');
    const aAll = fp.funds.filter(anyAlpha).length;
    log(
      `  alpha cover : ${aAll}/${fp.funds.length} (${pct(aAll, fp.funds.length)}%)  ·  ` +
        `PMS ${pms.filter(anyAlpha).length}/${pms.length} (${pct(pms.filter(anyAlpha).length, pms.length)}%)  ·  ` +
        `AIF ${aif.filter(anyAlpha).length}/${aif.length} (${pct(aif.filter(anyAlpha).length, aif.length)}%)`
    );
  } else {
    log('  (no funds-performance.json — store not written?)');
  }

  // New funds this month vs the prior snapshot month (if one exists).
  const idx = readJson(INDEX_JSON);
  const months = idx && Array.isArray(idx.snapshots) ? idx.snapshots.map((s) => s.month).sort() : [];
  if (months.length >= 2) {
    const latest = months[months.length - 1];
    const prior = months[months.length - 2];
    const ls = readJson(path.join(SNAP_DIR, `${latest}.json`));
    const ps = readJson(path.join(SNAP_DIR, `${prior}.json`));
    if (ls && ps) {
      const priorIds = new Set((ps.ranking || []).map((r) => r.id));
      const fresh = (ls.ranking || []).filter((r) => !priorIds.has(r.id));
      log(`  new funds   : ${fresh.length} new in ${latest} vs ${prior}`);
    }
  } else {
    log(`  new funds   : n/a (first month — Movers deltas accrue from next month)`);
  }
  log(`  elapsed     : ${(elapsedMs / 1000).toFixed(1)}s`);
  log('══════════════════════════════════');
}

function main() {
  const start = Date.now();
  log(`run-pipeline · ${STEPS.length} steps · LIMIT=${process.env.LIMIT || 'all'} MONTH=${process.env.MONTH || 'latest'}`);

  STEPS.forEach((step, i) => {
    const r = runStep(step, i);
    if (r.skipped || r.ok) return;
    const how = r.err ? `spawn error: ${r.err}` : r.signal ? `signal ${r.signal}` : `exit code ${r.status}`;
    if (step.required) {
      log(`\n✖ ABORT: required step "${step.name}" failed (${how}).`);
      printSummary(Date.now() - start);
      process.exit(1);
    }
    log(`\n! non-fatal step "${step.name}" failed (${how}) — continuing (store already written).`);
  });

  printSummary(Date.now() - start);
  log('\n✔ pipeline complete.');
}

main();
