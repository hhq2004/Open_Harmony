import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function latestComparison() {
  const pipelineRoot = join(root, 'artifacts', 'pipeline');
  if (!existsSync(pipelineRoot)) return null;
  for (const run of readdirSync(pipelineRoot).sort().reverse()) {
    const measurementRoot = join(pipelineRoot, run, 'measurement-evaluation');
    if (!existsSync(measurementRoot)) continue;
    for (const measurementRun of readdirSync(measurementRoot).sort().reverse()) {
      const candidate = join(measurementRoot, measurementRun, 'comparison.json');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function format(value, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(3)}${suffix}` : 'n/a';
}

function formatInteger(value) {
  return Number.isSafeInteger(value) ? String(value) : 'n/a';
}

function markdown(report, path) {
  const baseline = report.baseline ?? {};
  const optimized = report.optimized ?? {};
  const delta = report.delta ?? {};
  const checks = Object.entries(report.checks ?? {});
  return [
    '## Measurement (host)',
    '',
    `- Scenario: \`${report.scenario ?? 'unknown'}\``,
    `- Scope: \`${report.scope ?? 'unknown'}\` / \`${report.dataKind ?? 'unknown'}\` / deviceValidation: \`${report.deviceValidation ?? 'unknown'}\``,
    `- Report: \`${relative(root, path)}\``,
    '',
    '| Metric | Baseline | Optimized | Delta |',
    '| --- | ---: | ---: | ---: |',
    `| Interactions | ${formatInteger(baseline.interactions)} | ${formatInteger(optimized.interactions)} | - |`,
    `| Hit rate (all) | ${format(baseline.hitRateAll)} | ${format(optimized.hitRateAll)} | ${format(delta.hitRateAllDelta)} |`,
    `| Coverage | ${format(baseline.coverage)} | ${format(optimized.coverage)} | - |`,
    `| Click-to-visible p50 (ms) | ${format(baseline.clickToVisible?.p50Ms)} | ${format(optimized.clickToVisible?.p50Ms)} | saved ${format(delta.clickToVisibleP50SavedMs)} |`,
    `| Click-to-visible p95 (ms) | ${format(baseline.clickToVisible?.p95Ms)} | ${format(optimized.clickToVisible?.p95Ms)} | saved ${format(delta.clickToVisibleP95SavedMs)} |`,
    `| Prefetched bytes | ${formatInteger(baseline.prefetchedBytes)} | ${formatInteger(optimized.prefetchedBytes)} | +${formatInteger(delta.prefetchedBytesAdded)} |`,
    `| Wasted bytes | ${formatInteger(baseline.wastedBytes)} | ${formatInteger(optimized.wastedBytes)} | +${formatInteger(delta.wastedBytesAdded)} |`,
    '',
    `Checks: ${checks.length === 0 ? 'none' : checks.map(([name, value]) => `${value === true ? 'PASS' : 'FAIL'} ${name}`).join(', ')}`,
    '',
    'Host-only controlled-clock scenario. The numbers are not device latency, UI frame time or real-user hit rates.',
    '',
  ].join('\n');
}

try {
  const supplied = process.argv[2];
  const path = supplied === undefined ? latestComparison() : resolve(supplied);
  if (path === null) {
    console.log('No measurement comparison report found.');
    process.exitCode = 0;
  } else {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const text = markdown(report, path);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, text, 'utf8');
      console.log('Measurement summary appended to GITHUB_STEP_SUMMARY.');
    } else {
      console.log(text);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
