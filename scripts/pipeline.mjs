import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
const outDir = join(root, 'artifacts', 'pipeline', runId);
mkdirSync(outDir, { recursive: true });
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const tests = readdirSync(join(root, 'tests')).filter(name => name.endsWith('.test.mjs')).sort();
if (tests.length === 0) throw new Error('No tests found; refusing to report an empty suite as passing.');
const stages = [
  { name: 'environment', args: ['scripts/doctor.mjs'] },
  { name: 'typecheck', args: [tsc, '-p', 'tsconfig.json', '--noEmit'] },
  { name: 'build', args: ['scripts/build.mjs'] },
  { name: 'unit-tests', args: ['--test', ...tests.map(name => `tests/${name}`)] },
  { name: 'synthetic-replay', args: ['benchmarks/replay.mjs'] },
];
const report = {
  runId,
  startedAtUtc: new Date().toISOString(),
  scope: 'host-logic',
  nodeVersion: process.versions.node,
  status: 'running',
  stages: [],
  targetValidation: {
    status: 'not-run',
    pending: ['SDK/API and target selection', 'HAP build and install', 'preload and prerender integration', 'device latency, memory and stability measurements'],
  },
};
let failed = false;
for (const stage of stages) {
  if (failed) {
    report.stages.push({ name: stage.name, status: 'not-run' });
    continue;
  }
  console.log(`\n[${stage.name}]`);
  const started = Date.now();
  const result = spawnSync(process.execPath, stage.args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 10 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const stderr = (result.stderr ?? '') + (result.error ? `\n${result.error.message}\n` : '');
  writeFileSync(join(outDir, `${stage.name}.stdout.txt`), stdout, 'utf8');
  writeFileSync(join(outDir, `${stage.name}.stderr.txt`), stderr, 'utf8');
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  failed = result.status !== 0 || result.error !== undefined;
  report.stages.push({ name: stage.name, status: failed ? 'failed' : 'passed', exitCode: result.status, elapsedMs: Date.now() - started });
}
report.status = failed ? 'failed' : 'passed';
report.finishedAtUtc = new Date().toISOString();
const reportPath = join(outDir, 'report.json');
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`\nHost pipeline ${report.status}. Report: ${reportPath}`);
console.log('OpenHarmony target validation: NOT RUN.');
if (failed) process.exitCode = 1;
