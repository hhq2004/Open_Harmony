import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePredictionConfig } from '../dist/prediction/config.js';
import { checkIdentifier } from '../dist/prediction/validation.js';
import { evaluateConfiguration, validateDataset } from './prediction.mjs';
import { savePredictionReport } from './artifacts.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function objectWithKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Unexpected sweep configuration fields.');
}

function splitDataset(input, split, refit = false) {
  const events = input.inputFormat === 'event-stream';
  const suffix = events ? 'Events' : 'Sessions';
  return {
    schemaVersion: events ? 2 : 1, dataKind: input.dataKind, source: input.source,
    pageCatalog: input.pageCatalog,
    ...(events && input.sessionOptions !== undefined ? { sessionOptions: input.sessionOptions } : {}),
    scenarios: input.scenarios.map(scenario => ({
      name: scenario.name,
      [`training${suffix}`]: refit ? [...scenario[`training${suffix}`], ...scenario[`validation${suffix}`]] : scenario[`training${suffix}`],
      [`evaluation${suffix}`]: scenario[`${split}${suffix}`],
    })),
  };
}

export function validateSweepDataset(input) {
  objectWithKeys(input, ['schemaVersion', 'inputFormat', 'dataKind', 'source', 'pageCatalog', 'sessionOptions', 'scenarios']);
  if (input.schemaVersion !== 1 || !['session-paths', 'event-stream'].includes(input.inputFormat)) {
    throw new TypeError('Sweep input requires schemaVersion 1 and an explicit inputFormat.');
  }
  if (input.inputFormat === 'session-paths' && input.sessionOptions !== undefined) {
    throw new TypeError('Path-only data cannot validate session lifecycle options.');
  }
  if (!Array.isArray(input.scenarios) || input.scenarios.length === 0) throw new TypeError('At least one sweep scenario is required.');
  const suffix = input.inputFormat === 'event-stream' ? 'Events' : 'Sessions';
  for (const scenario of input.scenarios) {
    objectWithKeys(scenario, ['name', `training${suffix}`, `validation${suffix}`, `test${suffix}`]);
    for (const split of ['training', 'validation', 'test']) {
      if (!Array.isArray(scenario[`${split}${suffix}`])) throw new TypeError('Explicit training, validation and test arrays are required.');
    }
  }
  validateDataset(splitDataset(input, 'validation'));
  // Includes validation in the past: event order must be strictly increasing across all splits.
  validateDataset(splitDataset(input, 'test', true));
  return input;
}

function summarize(report) {
  const counts = { opportunities: 0, predictionsMade: 0, hits: 0, candidatesIssued: 0, unusedCandidates: 0 };
  for (const scenario of report.scenarios) {
    const strategy = scenario.strategies[0];
    for (const key of ['opportunities', 'predictionsMade', 'hits']) counts[key] += strategy.metrics[key];
    counts.candidatesIssued += strategy.candidatesIssued;
    counts.unusedCandidates += strategy.unusedCandidates;
  }
  return {
    ...counts,
    coverage: counts.opportunities === 0 ? null : counts.predictionsMade / counts.opportunities,
    hitRateAll: counts.opportunities === 0 ? null : counts.hits / counts.opportunities,
    hitRateWhenPredicted: counts.predictionsMade === 0 ? null : counts.hits / counts.predictionsMade,
    meanCandidates: counts.opportunities === 0 ? null : counts.candidatesIssued / counts.opportunities,
  };
}

export function sweepConfigurations(input, grid, { config = {}, mode = 'online' } = {}) {
  validateSweepDataset(input);
  if (!['online', 'frozen'].includes(mode)) throw new RangeError('mode must be online or frozen.');
  const profile = resolvePredictionConfig(config);
  objectWithKeys(grid, ['schemaVersion', 'selection', 'candidates']);
  if (grid.schemaVersion !== 1 || !Array.isArray(grid.candidates) || grid.candidates.length === 0) {
    throw new TypeError('A versioned, nonempty candidate list is required.');
  }
  const selection = { metric: 'hitRateAll', minCoverage: 0, maxMeanCandidates: 1, ...grid.selection };
  objectWithKeys(selection, ['metric', 'minCoverage', 'maxMeanCandidates']);
  if (selection.metric !== 'hitRateAll' || !Number.isFinite(selection.minCoverage)
      || selection.minCoverage < 0 || selection.minCoverage > 1
      || !Number.isFinite(selection.maxMeanCandidates) || selection.maxMeanCandidates <= 0) {
    throw new RangeError('Selection requires hitRateAll, minCoverage in [0,1], and positive maxMeanCandidates.');
  }
  if (grid.selection !== undefined) objectWithKeys(grid.selection, ['metric', 'minCoverage', 'maxMeanCandidates']);
  const ids = new Set();
  const candidates = grid.candidates.map(candidate => {
    objectWithKeys(candidate, ['id', 'overrides']);
    checkIdentifier(candidate.id);
    if (ids.has(candidate.id)) throw new TypeError('Candidate ids must be unique.');
    ids.add(candidate.id);
    const normalized = resolvePredictionConfig(candidate.overrides, profile);
    // Lifecycle changes alter opportunity denominators; compare model/limit choices under one policy.
    if (normalized.session.maxSessions !== profile.session.maxSessions || normalized.session.maxGapMs !== profile.session.maxGapMs) {
      throw new RangeError('Sweep candidates cannot change maxSessions or maxGapMs.');
    }
    return { id: candidate.id, config: normalized };
  });
  const validationData = splitDataset(input, 'validation');
  const validation = candidates.map(candidate => {
    const report = evaluateConfiguration(validationData, candidate.config, { mode });
    const metrics = summarize(report);
    const eligible = metrics.opportunities > 0 && metrics.coverage >= selection.minCoverage
      && metrics.meanCandidates <= selection.maxMeanCandidates;
    return { ...candidate, effectiveConfig: report.effectiveConfig, metrics, eligible, report };
  });
  if (new Set(validation.map(item => item.metrics.opportunities)).size !== 1) {
    throw new Error('Candidate opportunity denominators differ; refusing to rank.');
  }
  const ranked = validation.filter(item => item.eligible).sort((left, right) =>
    right.metrics.hitRateAll - left.metrics.hitRateAll
    || left.metrics.meanCandidates - right.metrics.meanCandidates
    || left.config.model.windowSize - right.config.model.windowSize
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const winner = ranked[0] ?? null;
  // Only the validation winner is refit using past data and evaluated on the final test split.
  // No other candidate receives test scores, and test labels never participate in ranking.
  const testReport = winner === null ? null : evaluateConfiguration(splitDataset(input, 'test', true), winner.config, { mode });
  return {
    schemaVersion: 1, scope: 'host-parameter-selection', inputFormat: input.inputFormat,
    dataKind: input.dataKind, source: input.source, profile,
    evaluationMode: mode === 'online' ? 'predict-then-observe' : 'frozen-training-only',
    openHarmonyPerformanceMeasured: false, selection,
    tieBreak: ['higher validation hitRateAll', 'fewer mean candidates', 'smaller model window', 'candidate id'],
    validation, ranking: ranked.map(item => item.id),
    selected: winner === null ? null : { id: winner.id, config: winner.config, effectiveConfig: winner.effectiveConfig },
    selectionReason: winner === null ? 'no-eligible-validation-candidate' : 'validation-only',
    test: testReport === null ? null : { refit: 'training-plus-validation', metrics: summarize(testReport), report: testReport },
    caveat: 'Candidate counts are not device resource costs; synthetic inputs do not select production parameters.',
  };
}

function parseArgs(args) {
  const options = {
    input: join(root, 'benchmarks', 'fixtures', 'prediction-sweep.json'),
    candidates: join(root, 'config', 'prediction-candidates.json'),
    configPath: join(root, 'config', 'prediction.json'), mode: 'online',
    outputRoot: join(root, 'artifacts', 'prediction-sweep'),
  };
  const keys = new Map([['--input', 'input'], ['--candidates', 'candidates'], ['--config', 'configPath'], ['--mode', 'mode'], ['--output-root', 'outputRoot']]);
  for (let index = 0; index < args.length; index += 2) {
    const key = keys.get(args[index]);
    if (key === undefined || args[index + 1] === undefined) throw new TypeError(`Unknown or incomplete argument: ${args[index]}`);
    options[key] = args[index + 1];
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const raw = readFileSync(resolve(options.input));
    const configRaw = readFileSync(resolve(options.configPath));
    const candidatesRaw = readFileSync(resolve(options.candidates));
    const report = sweepConfigurations(JSON.parse(raw.toString('utf8')), JSON.parse(candidatesRaw.toString('utf8')), {
      config: JSON.parse(configRaw.toString('utf8')), mode: options.mode,
    });
    const reportPath = savePredictionReport(report, { 'input.json': raw, 'config.json': configRaw, 'candidates.json': candidatesRaw }, options.outputRoot);
    console.log(JSON.stringify({
      reportPath, scope: report.scope, dataKind: report.dataKind, selectionReason: report.selectionReason,
      selected: report.selected, validation: report.validation.map(({ id, metrics, eligible }) => ({ id, metrics, eligible })),
      test: report.test?.metrics ?? null,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
