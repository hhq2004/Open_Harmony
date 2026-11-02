import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceFiles = [
  'src/contracts.ts', 'src/prediction/markov.ts', 'src/prediction/session.ts',
  'src/prediction/config.ts', 'src/prediction/factory.ts', 'src/prediction/validation.ts',
  'src/prediction/index.ts', 'benchmarks/replay.mjs', 'benchmarks/events.mjs',
  'benchmarks/prediction.mjs', 'benchmarks/sweep.mjs', 'benchmarks/artifacts.mjs',
  'package.json', 'package-lock.json', 'tsconfig.json',
];

/** Preserve exact inputs and executable provenance in a new directory on every run. */
export function savePredictionReport(report, inputs, outputRoot, argv = process.argv.slice(2)) {
  const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
  let git = { baseCommit: null, dirty: null };
  try {
    git = {
      baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim() !== '',
    };
  } catch { /* Source hashes are still available outside a Git checkout. */ }
  report.evidence = {
    createdAtUtc: new Date().toISOString(), node: process.version, platform: process.platform,
    arch: process.arch, argv, git, inputSha256: sha256(inputs['input.json']),
    filesSha256: Object.fromEntries(Object.entries(inputs).map(([name, raw]) => [name, sha256(raw)])),
    sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, sha256(readFileSync(join(root, path)))])),
  };
  const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  const output = join(resolve(outputRoot), runId);
  mkdirSync(output, { recursive: true });
  for (const [name, raw] of Object.entries(inputs)) {
    if (!['input.json', 'config.json', 'candidates.json'].includes(name)) throw new TypeError('Unsupported evidence filename.');
    writeFileSync(join(output, name), raw, { flag: 'wx' });
  }
  const reportPath = join(output, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return reportPath;
}
