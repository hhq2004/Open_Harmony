import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { MarkovPredictor } from '../dist/prediction/markov.js';
import { SessionPredictor } from '../dist/prediction/session.js';
import { checkIdentifier, checkPositiveInteger } from '../dist/prediction/validation.js';
import { evaluateSessions } from './replay.mjs';
import { evaluateEventStream, validateEventSequence } from './events.mjs';
import { DEFAULT_COMPARISON_MODEL, resolveModelConfig, resolvePredictionConfig } from '../dist/prediction/config.js';
import { savePredictionReport } from './artifacts.mjs';

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
  clear() { this.next.clear(); }
}

export function validateDataset(dataset) {
  if (![1, 2].includes(dataset?.schemaVersion) || !['synthetic', 'anonymized-real'].includes(dataset.dataKind)) {
    throw new TypeError('Expected schemaVersion 1 or 2 and an explicit dataKind.');
  }
  if (typeof dataset.source !== 'string' || dataset.source.trim() === '') {
    throw new TypeError('source must describe data provenance.');
  }
  if (!Array.isArray(dataset.pageCatalog) || dataset.pageCatalog.length === 0) {
    throw new TypeError('pageCatalog must contain fixed route aliases.');
  }
  for (const page of dataset.pageCatalog) checkIdentifier(page);
  const pages = new Set(dataset.pageCatalog);
  if (dataset.schemaVersion === 2) {
    if (dataset.sessionOptions !== undefined && (dataset.sessionOptions === null
        || typeof dataset.sessionOptions !== 'object' || Array.isArray(dataset.sessionOptions)
        || Object.keys(dataset.sessionOptions).some(key => !['maxSessions', 'maxGapMs'].includes(key)))) {
      throw new TypeError('sessionOptions supports only maxSessions and maxGapMs.');
    }
    // Reuse the real adapter's configuration validation without observing any events.
    new SessionPredictor(new MarkovPredictor(), { ...dataset.sessionOptions, allowedPages: dataset.pageCatalog });
  }
  if (!Array.isArray(dataset.scenarios) || dataset.scenarios.length === 0) {
    throw new TypeError('At least one scenario is required.');
  }
  const names = new Set();
  for (const scenario of dataset.scenarios) {
    checkIdentifier(scenario?.name);
    if (names.has(scenario.name)) throw new TypeError('Scenario names must be unique.');
    names.add(scenario.name);
    if (dataset.schemaVersion === 2) {
      const lastOrder = validateEventSequence(scenario.trainingEvents, dataset.pageCatalog);
      validateEventSequence(scenario.evaluationEvents, dataset.pageCatalog, lastOrder);
      continue;
    }
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

function evaluateStrategy(definition, scenario, dataset, effectiveConfig, mode) {
  const model = definition.options === null ? new LastSuccessor() : new MarkovPredictor(definition.options);
  if (dataset.schemaVersion === 2) {
    return {
      ...definition,
      ...evaluateEventStream(model, scenario.evaluationEvents, {
        trainingEvents: scenario.trainingEvents, onlineLearning: mode === 'online',
        sessionOptions: { ...effectiveConfig.session, allowedPages: dataset.pageCatalog },
      }),
    };
  }
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
    topK: effectiveConfig.session.limit, onlineLearning: mode === 'online',
    onStep: step => trace.push({ ...step, hit: step.candidates.some(item => item.pageId === step.actual) }),
  });
  const candidatesIssued = trace.reduce((sum, step) => sum + step.candidates.length, 0);
  return {
    ...definition, metrics, misses: metrics.predictionsMade - metrics.hits,
    candidatesIssued, unusedCandidates: candidatesIssued - metrics.hits,
    initialState, finalState: model.getStats(), trace, hostTiming: { unit: 'ms', predictMs, observeMs },
  };
}

function prepare(dataset, config, mode, topK) {
  validateDataset(dataset);
  if (!['online', 'frozen'].includes(mode)) throw new RangeError('mode must be online or frozen.');
  if (topK !== undefined) checkPositiveInteger(topK, 'topK');
  const profile = resolvePredictionConfig(config);
  const effectiveConfig = resolvePredictionConfig({
    session: { ...(dataset.schemaVersion === 2 ? dataset.sessionOptions : {}), limit: topK ?? profile.session.limit },
  }, profile);
  return { profile, effectiveConfig };
}

function reportHeader(dataset, mode, settings) {
  return {
    schemaVersion: 2, inputFormat: dataset.schemaVersion === 2 ? 'event-stream' : 'session-paths',
    scope: 'host-offline-prediction', dataKind: dataset.dataKind, source: dataset.source,
    profile: settings.profile, effectiveConfig: settings.effectiveConfig,
    sessionOptions: dataset.schemaVersion === 2 ? settings.effectiveConfig.session : null,
    evaluationMode: mode === 'online' ? 'predict-then-observe' : 'frozen-training-only',
    topK: settings.effectiveConfig.session.limit,
    openHarmonyPerformanceMeasured: false,
    timingCaveat: 'Unwarmed host operations in a shared process; not UI latency or a stable microbenchmark.',
    memoryCaveat: 'Structural counts only; no byte-accurate heap or device memory claim.',
  };
}

/** Evaluate just the active profile. Used by both parameter selection and application parity tests. */
export function evaluateConfiguration(dataset, config = {}, { mode = 'online' } = {}) {
  const settings = prepare(dataset, config, mode);
  return {
    ...reportHeader(dataset, mode, settings),
    scenarios: dataset.scenarios.map(scenario => ({
      name: scenario.name,
      strategies: [evaluateStrategy({ name: 'configured', options: settings.effectiveConfig.model }, scenario, dataset, settings.effectiveConfig, mode)],
    })),
  };
}

export function comparePredictors(dataset, {
  mode = 'online', topK, windowSize = DEFAULT_COMPARISON_MODEL.windowSize,
  comparisonMinSamples, comparisonMinProbability = DEFAULT_COMPARISON_MODEL.minProbability, config = {},
} = {}) {
  const settings = prepare(dataset, config, mode, topK);
  const guarded = resolveModelConfig({
    windowSize, minSamples: comparisonMinSamples ?? Math.min(DEFAULT_COMPARISON_MODEL.minSamples, windowSize),
    minProbability: comparisonMinProbability,
  });
  const scenarios = dataset.scenarios.map(scenario => {
    const transitionCount = dataset.schemaVersion === 2
      ? [...scenario.trainingEvents, ...scenario.evaluationEvents].filter(event => event.kind === 'visit').length
      : [...scenario.trainingSessions, ...scenario.evaluationSessions].reduce((sum, path) => sum + Math.max(0, path.length - 1), 0);
    const definitions = [
      { name: 'full-history', options: { windowSize: Math.max(1, transitionCount) } },
      { name: 'recent-window', options: { windowSize } },
      { name: 'guarded-window', options: guarded },
      { name: 'last-successor', options: null },
      { name: 'configured', options: settings.effectiveConfig.model },
    ];
    return {
      name: scenario.name,
      strategies: definitions.map(definition => evaluateStrategy(definition, scenario, dataset, settings.effectiveConfig, mode)),
    };
  });
  return { ...reportHeader(dataset, mode, settings), windowSize, comparisonModel: guarded, scenarios };
}

function parseArgs(args) {
  const result = {
    input: join(root, 'benchmarks', 'fixtures', 'prediction-scenarios.json'),
    mode: 'online', configPath: join(root, 'config', 'prediction.json'), outputRoot: join(root, 'artifacts', 'prediction'),
  };
  const keys = new Map([
    ['--input', 'input'], ['--mode', 'mode'], ['--top-k', 'topK'],
    ['--window-size', 'windowSize'], ['--output-root', 'outputRoot'],
    ['--config', 'configPath'], ['--comparison-min-samples', 'comparisonMinSamples'],
    ['--comparison-min-probability', 'comparisonMinProbability'],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = keys.get(args[index]);
    const value = args[index + 1];
    if (key === undefined || value === undefined) throw new TypeError(`Unknown or incomplete argument: ${args[index]}`);
    result[key] = ['topK', 'windowSize', 'comparisonMinSamples', 'comparisonMinProbability'].includes(key) ? Number(value) : value;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const raw = readFileSync(resolve(args.input));
    const dataset = JSON.parse(raw.toString('utf8'));
    const configRaw = readFileSync(resolve(args.configPath));
    const report = comparePredictors(dataset, { ...args, config: JSON.parse(configRaw.toString('utf8')) });
    const reportPath = savePredictionReport(report, { 'input.json': raw, 'config.json': configRaw }, args.outputRoot);
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
