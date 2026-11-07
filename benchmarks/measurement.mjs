import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMeasurementReport, JsonlMeasurementSink, MemoryMeasurementWriter, checkMeasurementReport,
} from '../dist/measurement/index.js';
import { createPredictionEngine } from '../dist/prediction/index.js';
import { DataPreloadScheduler, PredictionPreloadController } from '../dist/preload/index.js';
import { ResourceViewPreparer } from '../dist/preparation/index.js';
import { NodeMeasurementFileWriter } from '../adapters/node-measurement-file.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_BYTES = 256;
const VIEW_BYTES = 512;

/** A deterministic monotonic clock; no wall-clock or device timer is involved. */
export class ControlledRuntime {
  time = 0;
  timers = new Set();
  sequence = 0;

  now() {
    return this.time;
  }

  schedule(callback, delayMs) {
    if (typeof callback !== 'function') throw new TypeError('A timer callback is required.');
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('Timer delay must be finite and nonnegative.');
    const timer = { id: ++this.sequence, at: this.time + delayMs, callback };
    this.timers.add(timer);
    return () => {
      this.timers.delete(timer);
    };
  }

  advance(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Advance duration must be finite and nonnegative.');
    const target = this.time + ms;
    for (;;) {
      const due = [...this.timers]
        .filter(timer => timer.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (due === undefined) break;
      this.timers.delete(due);
      this.time = due.at;
      due.callback();
    }
    this.time = target;
  }

  get pendingTimers() {
    return this.timers.size;
  }
}

export const settle = async () => {
  for (let index = 0; index < 24; index += 1) await Promise.resolve();
};

function checkNonnegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer.`);
}

function checkPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer.`);
}

export function validateMeasurementConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Measurement config must be an object.');
  }
  if (config.schemaVersion !== 1) throw new RangeError('Measurement config schemaVersion must be 1.');
  if (config.scenario !== 'measurement-baseline-v1') {
    throw new RangeError('Measurement config must identify scenario measurement-baseline-v1.');
  }
  if (config.dataKind !== 'synthetic') throw new RangeError('The host measurement scenario must declare synthetic data.');
  if (typeof config.timingSource !== 'string' || config.timingSource.trim() === '') {
    throw new TypeError('timingSource must describe how interaction times were obtained.');
  }
  for (const key of ['fetchDelayMs', 'renderDelayMs', 'interactiveDelayMs']) {
    checkNonnegativeInteger(config[key], key);
  }
  if (!Array.isArray(config.pageCatalog) || config.pageCatalog.length === 0) {
    throw new TypeError('pageCatalog must be a nonempty array.');
  }
  const pages = new Set(config.pageCatalog);
  if (pages.size !== config.pageCatalog.length) throw new TypeError('pageCatalog cannot contain duplicates.');
  if (!Array.isArray(config.trainingSessions) || config.trainingSessions.length === 0) {
    throw new TypeError('trainingSessions must be a nonempty array.');
  }
  if (!Array.isArray(config.liveSessions) || config.liveSessions.length === 0) {
    throw new TypeError('liveSessions must be a nonempty array.');
  }
  for (const session of [...config.trainingSessions, ...config.liveSessions.map(item => item.pages)]) {
    if (!Array.isArray(session) || session.length === 0) throw new TypeError('Sessions must be nonempty arrays.');
    for (const page of session) {
      if (typeof page !== 'string' || !pages.has(page)) throw new TypeError('Every page must belong to pageCatalog.');
    }
  }
  for (const session of config.liveSessions) {
    if (typeof session.sessionId !== 'string' || session.sessionId.trim() === '') {
      throw new TypeError('Every live session needs an opaque sessionId.');
    }
  }
  checkPositiveInteger(config.scheduler?.timeoutMs, 'scheduler.timeoutMs');
  checkPositiveInteger(config.scheduler?.ttlMs, 'scheduler.ttlMs');
  checkPositiveInteger(config.scheduler?.maxTasks, 'scheduler.maxTasks');
  checkPositiveInteger(config.scheduler?.maxBytes, 'scheduler.maxBytes');
  checkPositiveInteger(config.viewPreparer?.maxPreparedViews, 'viewPreparer.maxPreparedViews');
  checkPositiveInteger(config.viewPreparer?.maxPreparedBytes, 'viewPreparer.maxPreparedBytes');
  checkPositiveInteger(config.viewPreparer?.ttlMs, 'viewPreparer.ttlMs');
  return config;
}

function createLease(request) {
  let disposed = false;
  return Object.freeze({
    value: Object.freeze({ id: request.dataKey, pageId: request.pageId }),
    byteLength: DATA_BYTES,
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  });
}

/** A controlled host fetch. Cancellation still settles so C can release its slot. */
class ControlledFetcher {
  fetches = 0;
  cancellations = 0;

  constructor(runtime, delayMs, events) {
    this.runtime = runtime;
    this.delayMs = delayMs;
    this.events = events;
  }

  start(request) {
    this.fetches += 1;
    let cancelled = false;
    const result = new Promise(resolve => {
      this.runtime.schedule(() => {
        this.events.push({ event: 'fetch-settled', taskId: request.taskId, cancelled });
        resolve(createLease(request));
      }, this.delayMs);
    });
    return {
      result,
      cancel: reason => {
        if (cancelled) return;
        cancelled = true;
        this.cancellations += 1;
        this.events.push({ event: 'fetch-cancelled', taskId: request.taskId, reason });
      },
    };
  }
}

function createViewPreparer(runtime, config, events) {
  return new ResourceViewPreparer(request => {
    events.push({ event: 'view-built', taskId: request.taskId, pageId: request.pageId });
    return {
      resource: Object.freeze({ taskId: request.taskId, pageId: request.pageId }),
      estimatedBytes: VIEW_BYTES,
      dispose() {
        events.push({ event: 'view-disposed', taskId: request.taskId });
      },
    };
  }, { ...config.viewPreparer, now: () => runtime.now() });
}

function createViewAdapter(views) {
  return {
    async prepare(request) {
      const prepared = await views.prepare(request);
      const taken = views.take(request.pageId);
      if (taken !== prepared) throw new Error('The prepared view was not transferable.');
      return taken;
    },
    cancel(taskId, reason) {
      views.cancel(taskId, reason === 'timeout' ? 'expired' : reason);
    },
  };
}

function createTaskTracker(scheduler) {
  const latest = new Map();
  const maxBytes = new Map();
  const events = [];
  const unsubscribe = scheduler.subscribe(snapshot => {
    latest.set(snapshot.request.taskId, snapshot);
    maxBytes.set(snapshot.request.taskId, Math.max(maxBytes.get(snapshot.request.taskId) ?? 0, snapshot.byteLength));
    events.push({
      at: snapshot.updatedAtMs,
      taskId: snapshot.request.taskId,
      sessionId: snapshot.request.sessionId,
      pageId: snapshot.request.pageId,
      state: snapshot.state,
      byteLength: snapshot.byteLength,
      viewReady: snapshot.viewReady,
      cancelReason: snapshot.cancelReason,
      failure: snapshot.failure,
    });
  });
  const latestTaskIdForSessionSince = (sessionId, startIndex) => {
    for (let index = events.length - 1; index >= startIndex; index -= 1) {
      if (events[index].sessionId === sessionId) return events[index].taskId;
    }
    return undefined;
  };
  return { latest, maxBytes, events, unsubscribe, latestTaskIdForSessionSince };
}

async function waitForTaskReady(scheduler, runtime, taskId, fetchDelayMs) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await settle();
    const snapshot = scheduler.getTask(taskId);
    if (snapshot === undefined) return undefined;
    if (snapshot.state === 'data-ready' && (!snapshot.preparingView || snapshot.viewReady)) return snapshot;
    if (snapshot.state === 'cancelled' || snapshot.state === 'failed' || snapshot.state === 'consumed') return snapshot;
    runtime.advance(fetchDelayMs + 1);
  }
  throw new Error(`Task '${taskId}' did not settle in the controlled scenario.`);
}

function target(pageId) {
  return { pageId, dataKey: pageId };
}

async function runOne(config, optimized) {
  const engine = createPredictionEngine(config.pageCatalog, config.prediction);
  for (const path of config.trainingSessions) engine.model.train(path);
  engine.session.setEnabled(true);

  const runtime = new ControlledRuntime();
  const fetcherEvents = [];
  const viewEvents = [];
  const writer = new MemoryMeasurementWriter();
  const sink = new JsonlMeasurementSink(writer, { defaultDataKind: 'synthetic' });
  let scheduler;
  let controller;
  let tracker;
  let views;
  let fetcher;
  if (optimized) {
    views = createViewPreparer(runtime, config, viewEvents);
    fetcher = new ControlledFetcher(runtime, config.fetchDelayMs, fetcherEvents);
    scheduler = new DataPreloadScheduler(fetcher, runtime, config.scheduler, createViewAdapter(views));
    controller = new PredictionPreloadController(scheduler);
    controller.setEnabled(true);
    tracker = createTaskTracker(scheduler);
  }
  const issues = [];

  try {
    for (const live of config.liveSessions) {
      let previousCandidates = [];
      let previousTaskId;
      let monotonicMs = 0;
      for (const [index, page] of live.pages.entries()) {
        monotonicMs += 1000;
        const decision = engine.session.acceptDetailed({
          sessionId: live.sessionId, pageId: page, monotonicMs,
        });
        if (decision.status !== 'accepted') throw new Error('Scenario visit was rejected by B.');
        const predictionHit = previousCandidates.some(candidate => candidate.pageId === page);
        const coldStart = decision.boundary === 'first-visit';
        const clickedAtMs = runtime.now();
        const taskEventStart = tracker?.events.length ?? 0;
        let bundle;
        let prefetchedBytes = 0;
        let viewReused = false;

        if (optimized) {
          if (previousTaskId !== undefined) prefetchedBytes = tracker.maxBytes.get(previousTaskId) ?? 0;
          scheduler.setEnvironment({ idle: false, foregroundBusy: true, memoryPressure: false });
          bundle = controller.visit(
            live.sessionId,
            target(page),
            decision.candidates.map((candidate, rank) => ({
              pageId: candidate.pageId, dataKey: candidate.pageId, priority: -rank,
            })),
          );
          const hit = bundle !== undefined;
          if (hit !== predictionHit) {
            issues.push({ sessionId: live.sessionId, page, expectedHit: predictionHit, actualHit: hit });
          }
          viewReused = bundle?.view !== undefined;
          runtime.advance(hit ? config.renderDelayMs : config.fetchDelayMs + config.renderDelayMs);
        } else {
          runtime.advance(config.fetchDelayMs + config.renderDelayMs);
        }

        const visibleAtMs = runtime.now();
        const interactiveAtMs = visibleAtMs + config.interactiveDelayMs;
        bundle?.dispose();
        sink.record({
          interactionId: `${live.sessionId}-${index + 1}`,
          pageId: page,
          clickedAtMs,
          visibleAtMs,
          optimized,
          predictionHit,
          sessionId: live.sessionId,
          interactiveAtMs,
          coldStart,
          boundary: decision.boundary ?? 'unknown',
          predictedPages: previousCandidates.map(candidate => candidate.pageId),
          actualPage: page,
          ...(previousTaskId === undefined ? {} : { preloadTaskId: previousTaskId }),
          viewReused,
          prefetchedBytes,
          wastedBytes: optimized && !viewReused ? prefetchedBytes : 0,
          dataKind: 'synthetic',
        });
        previousCandidates = decision.candidates;

        if (optimized) {
          scheduler.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false });
          const nextTaskId = tracker.latestTaskIdForSessionSince(live.sessionId, taskEventStart);
          const hasNewTask = nextTaskId !== undefined && nextTaskId !== previousTaskId;
          if (hasNewTask) {
            await waitForTaskReady(scheduler, runtime, nextTaskId, config.fetchDelayMs);
            previousTaskId = nextTaskId;
          } else {
            previousTaskId = undefined;
          }
        }
      }
      controller?.endSession(live.sessionId);
    }
  } finally {
    controller?.setEnabled(false);
    scheduler?.clear();
    views?.releaseAll('session-ended');
    tracker?.unsubscribe();
    sink.close();
  }

  const records = writer.records();
  const schedulerStats = scheduler?.getStats();
  return {
    records,
    taskEvents: tracker?.events ?? [],
    fetcherEvents,
    viewEvents,
    checks: {
      recordsMatchMode: records.every(record => record.optimized === optimized),
      noIssues: issues.length === 0,
      cleanupErrorsZero: (schedulerStats?.cleanupErrors ?? 0) === 0
        && (schedulerStats?.observerErrors ?? 0) === 0
        && (schedulerStats?.cancelErrors ?? 0) === 0,
    },
    stats: {
      scheduler: schedulerStats ?? null,
      runtime: { now: runtime.now(), pendingTimers: runtime.pendingTimers },
      fetcher: { fetches: fetcher?.fetches ?? 0, cancellations: fetcher?.cancellations ?? 0 },
    },
    issues,
  };
}

export async function runMeasurementScenario(config) {
  validateMeasurementConfig(config);
  const baseline = await runOne(config, false);
  const optimized = await runOne(config, true);
  const environment = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
  const provenance = readProvenance();
  const generatedAtUtc = new Date().toISOString();
  const notes = [
    'Host-only controlled clock; click/visible intervals model data availability and are not UI or device latency.',
    'The fixture is synthetic; no real user path, device memory or ArkTS prerender result is measured.',
    'deviceValidation stays not-run until A supplies the application, SDK and target device.',
  ];
  const common = {
    scope: 'host',
    dataKind: 'synthetic',
    deviceValidation: 'not-run',
    timingSource: config.timingSource,
    command: 'node benchmarks/measurement.mjs',
    config,
    environment,
    provenance,
    notes,
    generatedAtUtc,
  };
  const baselineReport = buildMeasurementReport(baseline.records, common);
  const optimizedReport = buildMeasurementReport(optimized.records, common);
  checkMeasurementReport(baselineReport);
  checkMeasurementReport(optimizedReport);
  const base = baselineReport.metrics;
  const fast = optimizedReport.metrics;
  const saved = (slower, faster) => slower === null || faster === null ? null : slower - faster;
  const comparison = {
    schemaVersion: 1,
    scenario: config.scenario,
    generatedAtUtc,
    scope: 'host',
    dataKind: 'synthetic',
    deviceValidation: 'not-run',
    timingSource: config.timingSource,
    samePredictions: base.predictionsMade === fast.predictionsMade
      && base.hits === fast.hits && base.misses === fast.misses,
    delta: {
      clickToVisibleP50SavedMs: saved(base.clickToVisible?.p50Ms ?? null, fast.clickToVisible?.p50Ms ?? null),
      clickToVisibleP95SavedMs: saved(base.clickToVisible?.p95Ms ?? null, fast.clickToVisible?.p95Ms ?? null),
      hitRateAllDelta: base.hitRateAll === null || fast.hitRateAll === null
        ? null : fast.hitRateAll - base.hitRateAll,
      prefetchedBytesAdded: fast.prefetchedBytes - base.prefetchedBytes,
      wastedBytesAdded: fast.wastedBytes - base.wastedBytes,
    },
    baseline: base,
    optimized: fast,
    checks: {
      predictionsMatchAcrossRuns: baseline.records.length === optimized.records.length
        && baselineReport.metrics.predictionsMade === optimizedReport.metrics.predictionsMade
        && baselineReport.metrics.hits === optimizedReport.metrics.hits,
      baselineMadeNoPrefetch: baseline.records.every(record => record.prefetchedBytes === 0 && record.wastedBytes === 0),
      optimizedHitsReusedViews: optimized.records
        .filter(record => record.predictionHit && record.boundary !== 'first-visit')
        .every(record => record.viewReused),
      optimizedCleanup: optimized.stats.scheduler?.retainedTasks === 0
        && optimized.stats.scheduler?.heldBytes === 0
        && optimized.stats.scheduler?.physicalBusy === false
        && optimized.stats.runtime.pendingTimers === 0,
      baselineCleanup: baseline.stats.runtime.pendingTimers === 0,
      schedulerErrorsZero: optimized.checks.cleanupErrorsZero,
      scenarioIssuesZero: optimized.checks.noIssues && baseline.checks.noIssues,
    },
    cleanup: {
      scheduler: optimized.stats.scheduler,
      runtime: optimized.stats.runtime,
      fetcherEvents: optimized.fetcherEvents,
      viewEvents: optimized.viewEvents,
    },
    taskEvents: optimized.taskEvents,
    notes,
  };
  if (Object.values(comparison.checks).some(value => value !== true)) {
    throw new Error(`Measurement scenario checks failed: ${JSON.stringify(comparison.checks)}`);
  }
  return { baseline: baselineReport, optimized: optimizedReport, comparison, baselineRecords: baseline.records, optimizedRecords: optimized.records };
}

const SOURCE_FILES = [
  'src/contracts.ts',
  'src/measurement/types.ts', 'src/measurement/validation.ts', 'src/measurement/aggregate.ts',
  'src/measurement/sink.ts', 'src/measurement/report.ts', 'src/measurement/index.ts',
  'src/prediction/index.ts', 'src/prediction/markov.ts', 'src/prediction/session.ts',
  'src/prediction/config.ts', 'src/prediction/factory.ts', 'src/prediction/validation.ts',
  'src/preload/index.ts', 'src/preload/scheduler.ts', 'src/preload/controller.ts', 'src/preload/types.ts',
  'src/preparation/index.ts', 'src/preparation/view-preparer.ts',
  'benchmarks/measurement.mjs', 'benchmarks/replay.mjs', 'config/measurement-baseline.json',
  'adapters/node-measurement-file.mjs', 'package.json', 'package-lock.json', 'tsconfig.json',
];

function readProvenance() {
  let gitCommit = null;
  let gitDirty = null;
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim() !== '';
  } catch {
    // Source hashes still distinguish a working tree outside Git.
  }
  const sourceSha256 = {};
  for (const file of SOURCE_FILES) {
    try {
      sourceSha256[file] = createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
    } catch {
      sourceSha256[file] = 'missing';
    }
  }
  return { gitCommit, gitDirty, sourceSha256, node: process.version, platform: process.platform, arch: process.arch };
}

function parseArgs(args) {
  const result = {
    outputRoot: join(root, 'artifacts', 'measurement'),
    configPath: join(root, 'config', 'measurement-baseline.json'),
  };
  const keys = new Map([['--output-root', 'outputRoot'], ['--config', 'configPath']]);
  for (let index = 0; index < args.length; index += 2) {
    const key = keys.get(args[index]);
    const value = args[index + 1];
    if (key === undefined || value === undefined) throw new TypeError(`Unknown or incomplete argument: ${args[index]}`);
    result[key] = value;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const raw = readFileSync(resolve(args.configPath), 'utf8');
    const config = validateMeasurementConfig(JSON.parse(raw));
    const result = await runMeasurementScenario(config);
    const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
    const output = join(resolve(args.outputRoot), runId);
    mkdirSync(output, { recursive: true });
    const writeRun = (name, report, records) => {
      const directory = join(output, name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      const writer = new NodeMeasurementFileWriter(join(directory, 'interactions.jsonl'));
      try {
        for (const record of records) writer.writeLine(JSON.stringify(record));
      } finally {
        writer.close();
      }
    };
    writeRun('baseline', result.baseline, result.baselineRecords);
    writeRun('optimized', result.optimized, result.optimizedRecords);
    writeFileSync(join(output, 'comparison.json'), `${JSON.stringify(result.comparison, null, 2)}\n`, 'utf8');
    writeFileSync(join(output, 'config.json'), raw, { flag: 'wx' });
    console.log(JSON.stringify({
      reportPath: join(output, 'comparison.json'), scope: 'host', dataKind: 'synthetic', deviceValidation: 'not-run',
      baseline: result.baseline.metrics, optimized: result.optimized.metrics, delta: result.comparison.delta,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
