import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { MarkovPredictor } from '../dist/prediction/markov.js';
import { checkIdentifier, checkPositiveInteger } from '../dist/prediction/validation.js';
import { evaluateSessions } from './replay.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** A recency-only comparator, not an application rule tuned using evaluation outcomes. */
class LastSuccessor {
  next = new Map();
  observe(from, to) { this.next.set(from, to); }
  predict(from) {
    const pageId = this.next.get(from);
    // 1 denotes the one retained observation, not a calibrated confidence.
    return pageId === undefined ? [] : [{ pageId, probability: 1 }];
  }
  getStats() { return { sourcePages: this.next.size, edges: this.next.size }; }
}

export function validateDataset(dataset) {
  if (dataset?.schemaVersion !== 1 || !['synthetic', 'anonymized-real'].includes(dataset.dataKind)) {
    throw new TypeError('Expected schemaVersion 1 and an explicit dataKind.');
  }
  if (typeof dataset.source !== 'string' || dataset.source.trim() === '') {
    throw new TypeError('source must describe data provenance.');
  }
  if (!Array.isArray(dataset.pageCatalog) || dataset.pageCatalog.length === 0) {
    throw new TypeError('pageCatalog must contain fixed route aliases.');
  }
  for (const page of dataset.pageCatalog) checkIdentifier(page);
  const pages = new Set(dataset.pageCatalog);
  if (!Array.isArray(dataset.scenarios) || dataset.scenarios.length === 0) {
    throw new TypeError('At least one scenario is required.');
  }
  const names = new Set();
  for (const scenario of dataset.scenarios) {
    checkIdentifier(scenario?.name);
    if (names.has(scenario.name)) throw new TypeError('Scenario names must be unique.');
    names.add(scenario.name);
    for (const sessions of [scenario.trainingSessions, scenario.evaluationSessions]) {
      if (!Array.isArray(sessions)) throw new TypeError('Session collections must be arrays.');
      for (const path of sessions) {
        if (!Array.isArray(path)) throw new TypeError('A session must be an array of route aliases.');
        for (const page of path) {
          checkIdentifier(page);
          if (!pages.has(page)) throw new TypeError('Every route must belong to pageCatalog.');
        }
      }
    }
  }
  return dataset;
}

export function comparePredictors(dataset, { mode = 'online', topK = 1, windowSize = 16 } = {}) {
  validateDataset(dataset);
  if (!['online', 'frozen'].includes(mode)) throw new RangeError('mode must be online or frozen.');
  checkPositiveInteger(topK, 'topK');
  checkPositiveInteger(windowSize, 'windowSize');
  const scenarios = dataset.scenarios.map(scenario => {
    const transitionCount = [...scenario.trainingSessions, ...scenario.evaluationSessions]
      .reduce((sum, path) => sum + Math.max(0, path.length - 1), 0);
    const definitions = [
      { name: 'full-history', options: { windowSize: Math.max(1, transitionCount) } },
      { name: 'recent-window', options: { windowSize } },
      { name: 'guarded-window', options: { windowSize, minSamples: Math.min(3, windowSize), minProbability: 0.6 } },
      { name: 'last-successor', options: null },
    ];
    const strategies = definitions.map(definition => {
      const model = definition.options === null ? new LastSuccessor() : new MarkovPredictor(definition.options);
      for (const path of scenario.trainingSessions) {
        for (let index = 1; index < path.length; index += 1) model.observe(path[index - 1], path[index]);
      }
      const initialState = model.getStats();
      const trace = [];
      const predictMs = [];
      const observeMs = [];
      const timed = {
        predict(from, limit) {
          const started = performance.now();
          const result = model.predict(from, limit);
          predictMs.push(performance.now() - started);
          return result;
        },
        observe(from, to) {
          const started = performance.now();
          model.observe(from, to);
          observeMs.push(performance.now() - started);
        },
      };
      const metrics = evaluateSessions(timed, scenario.evaluationSessions, {
        topK, onlineLearning: mode === 'online',
        onStep: step => trace.push({ ...step, hit: step.candidates.some(item => item.pageId === step.actual) }),
      });
      const candidatesIssued = trace.reduce((sum, step) => sum + step.candidates.length, 0);
      return {
        name: definition.name, options: definition.options, metrics,
        misses: metrics.predictionsMade - metrics.hits,
        candidatesIssued, unusedCandidates: candidatesIssued - metrics.hits,
        initialState, finalState: model.getStats(), trace,
        hostTiming: { unit: 'ms', predictMs, observeMs },
      };
    });
    return { name: scenario.name, strategies };
  });
  return {
    schemaVersion: 1, scope: 'host-offline-prediction', dataKind: dataset.dataKind, source: dataset.source,
    evaluationMode: mode === 'online' ? 'predict-then-observe' : 'frozen-training-only', topK, windowSize,
    openHarmonyPerformanceMeasured: false,
    timingCaveat: 'Unwarmed host operations in a shared process; not UI latency or a stable microbenchmark.',
    memoryCaveat: 'Structural counts only; no byte-accurate heap or device memory claim.',
    scenarios,
  };
}

function parseArgs(args) {
  const result = {
    input: join(root, 'benchmarks', 'fixtures', 'prediction-scenarios.json'),
    mode: 'online', topK: 1, windowSize: 16, outputRoot: join(root, 'artifacts', 'prediction'),
  };
  const keys = new Map([
    ['--input', 'input'], ['--mode', 'mode'], ['--top-k', 'topK'],
    ['--window-size', 'windowSize'], ['--output-root', 'outputRoot'],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = keys.get(args[index]);
    const value = args[index + 1];
    if (key === undefined || value === undefined) throw new TypeError(`Unknown or incomplete argument: ${args[index]}`);
    result[key] = ['topK', 'windowSize'].includes(key) ? Number(value) : value;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const raw = readFileSync(resolve(args.input));
    const dataset = JSON.parse(raw.toString('utf8'));
    const report = comparePredictors(dataset, args);
    const sourceFiles = [
      'src/contracts.ts', 'src/prediction/markov.ts', 'src/prediction/session.ts',
      'src/prediction/validation.ts', 'src/prediction/index.ts', 'benchmarks/replay.mjs',
      'benchmarks/prediction.mjs', 'package.json', 'package-lock.json', 'tsconfig.json',
    ];
    const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
    let git = { baseCommit: null, dirty: null };
    try {
      git = {
        baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
        dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim() !== '',
      };
    } catch { /* Source hashes remain authoritative without a Git checkout. */ }
    report.evidence = {
      createdAtUtc: new Date().toISOString(), node: process.version, platform: process.platform,
      arch: process.arch, argv: process.argv.slice(2), git,
      inputSha256: sha256(raw),
      sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, sha256(readFileSync(join(root, path)))])),
    };
    const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
    const output = join(resolve(args.outputRoot), runId);
    mkdirSync(output, { recursive: true });
    // Preserve exact input alongside raw per-transition decisions for replay and audit.
    writeFileSync(join(output, 'input.json'), raw, { flag: 'wx' });
    const reportPath = join(output, 'report.json');
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({
      reportPath, scope: report.scope, dataKind: report.dataKind, evaluationMode: report.evaluationMode,
      scenarios: report.scenarios.map(scenario => ({
        name: scenario.name,
        strategies: scenario.strategies.map(({ name, metrics, unusedCandidates }) => ({ name, ...metrics, unusedCandidates })),
      })),
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
