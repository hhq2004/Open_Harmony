import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  JsonlMeasurementSink, MeasurementValidationError, MemoryMeasurementWriter,
  buildMeasurementReport, checkMeasurementReport, normalizeMeasurement, parseMeasurementJsonl,
  parseMeasurementRecord, summarizeMeasurements,
} from '../dist/measurement/index.js';
import { NodeMeasurementFileWriter } from '../adapters/node-measurement-file.mjs';

function record(overrides = {}) {
  const base = {
    schemaVersion: 1,
    interactionId: 'i1',
    pageId: 'b',
    clickedAtMs: 0,
    visibleAtMs: 10,
    optimized: true,
    predictionHit: true,
    sessionId: 's',
    interactiveAtMs: 12,
    coldStart: false,
    boundary: 'consecutive',
    predictedPages: ['b'],
    actualPage: 'b',
    preloadTaskId: 'prediction-1',
    viewReused: true,
    prefetchedBytes: 100,
    wastedBytes: 0,
    dataKind: 'synthetic',
  };
  const value = { ...base, ...overrides };
  if (!Object.hasOwn(overrides, 'actualPage')) value.actualPage = value.pageId;
  if (!Object.hasOwn(overrides, 'predictedPages')) {
    value.predictedPages = value.predictionHit ? [value.pageId] : [];
  }
  return value;
}

test('normalization fills conservative extension defaults from the shared contract fields', () => {
  const normalized = normalizeMeasurement({
    interactionId: 'first', pageId: 'home', clickedAtMs: 5, visibleAtMs: 9,
    optimized: false, predictionHit: false,
  }, { dataKind: 'host-observed' });
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.dataKind, 'host-observed');
  assert.deepEqual(normalized.predictedPages, []);
  assert.equal(normalized.coldStart, false);
  assert.equal(normalized.boundary, 'unknown');
  assert.equal(normalized.actualPage, 'home');
  assert.equal(normalized.viewReused, false);
  assert.equal(normalized.prefetchedBytes, 0);
  assert.throws(() => { normalized.prefetchedBytes = 1; }, TypeError);
});

test('validation rejects impossible timing, hit and ownership combinations', () => {
  for (const invalid of [
    record({ visibleAtMs: -1 }),
    record({ clickedAtMs: 20, visibleAtMs: 10 }),
    record({ interactiveAtMs: 5, clickedAtMs: 10 }),
    record({ predictionHit: true, predictedPages: [] }),
    record({ predictionHit: false, predictedPages: ['b'] }),
    record({ predictionHit: true, predictedPages: ['c'] }),
    record({ predictedPages: ['b', 'b'] }),
    record({ viewReused: true, optimized: false }),
    record({ prefetchedBytes: 10, wastedBytes: 11 }),
    record({ prefetchedBytes: -1 }),
    record({ schemaVersion: 2 }),
    record({ dataKind: 'invented' }),
    record({ actualPage: 'c' }),
    record({ sessionId: ' ' }),
    record({ unknownField: true }),
  ]) assert.throws(() => parseMeasurementRecord(invalid), MeasurementValidationError);
});

test('JSONL sink is append-once for exact duplicates and loud for conflicting duplicates', () => {
  const writer = new MemoryMeasurementWriter();
  const sink = new JsonlMeasurementSink(writer, { defaultDataKind: 'synthetic' });
  const first = record({ interactionId: 'same' });
  sink.record(first);
  sink.record(first);
  assert.equal(sink.count, 1);
  assert.equal(writer.lineCount, 1);
  assert.throws(() => sink.record(record({ interactionId: 'same', visibleAtMs: 11 })), MeasurementValidationError);
  sink.record(record({ interactionId: 'second', pageId: 'c', actualPage: 'c', predictedPages: ['c'], predictionHit: true }));
  assert.equal(sink.count, 2);
  const records = writer.records();
  assert.equal(records.length, 2);
  assert.equal(records[0].interactionId, 'same');
  sink.close();
  assert.throws(() => sink.record(record({ interactionId: 'third' })), /closed/);
  const invalidDefault = new JsonlMeasurementSink(new MemoryMeasurementWriter(), { defaultDataKind: 'invented' });
  assert.throws(() => invalidDefault.record({
    interactionId: 'default', pageId: 'home', clickedAtMs: 0, visibleAtMs: 1,
    optimized: false, predictionHit: false,
  }), MeasurementValidationError);
});

test('JSONL readback rejects duplicate IDs, malformed JSON and unknown fields', () => {
  const good = `${JSON.stringify(record({ interactionId: 'one' }))}\n`;
  assert.equal(parseMeasurementJsonl(good).length, 1);
  assert.throws(() => parseMeasurementJsonl(`${good}{bad json}\n`), MeasurementValidationError);
  assert.throws(() => parseMeasurementJsonl(good + good), MeasurementValidationError);
  assert.throws(() => parseMeasurementJsonl(`${JSON.stringify(record({ interactionId: 'x', extra: 1 }))}\n`), MeasurementValidationError);
});

test('aggregation uses hand-calculated denominators, nearest-rank percentiles and disjoint groups', () => {
  const metrics = summarizeMeasurements([
    record({ interactionId: 'hit', clickedAtMs: 0, visibleAtMs: 10, interactiveAtMs: 12, prefetchedBytes: 100, wastedBytes: 0 }),
    record({
      interactionId: 'miss', clickedAtMs: 0, visibleAtMs: 40, interactiveAtMs: 45,
      predictionHit: false, predictedPages: ['c'], viewReused: false, prefetchedBytes: 200, wastedBytes: 200,
    }),
    record({
      interactionId: 'cold', pageId: 'a', actualPage: 'a', clickedAtMs: 0, visibleAtMs: 30, interactiveAtMs: 33,
      predictionHit: false, predictedPages: [], viewReused: false, prefetchedBytes: 0, wastedBytes: 0,
      coldStart: true, boundary: 'first-visit', optimized: true,
    }),
    record({
      interactionId: 'baseline', clickedAtMs: 0, visibleAtMs: 50, interactiveAtMs: 55,
      optimized: false, viewReused: false, prefetchedBytes: 0, wastedBytes: 0,
    }),
  ]);
  assert.equal(metrics.interactions, 4);
  assert.equal(metrics.opportunities, 4);
  assert.equal(metrics.predictionsMade, 3);
  assert.equal(metrics.hits, 2);
  assert.equal(metrics.misses, 1);
  assert.equal(metrics.coverage, 0.75);
  assert.equal(metrics.hitRateAll, 0.5);
  assert.equal(metrics.hitRateWhenPredicted, 2 / 3);
  assert.equal(metrics.missRate, 1 / 3);
  assert.equal(metrics.coldStartOpportunities, 1);
  assert.equal(metrics.coldStartShare, 0.25);
  assert.deepEqual(metrics.clickToVisible, {
    count: 4, minMs: 10, p50Ms: 30, p95Ms: 50, maxMs: 50, meanMs: 32.5,
  });
  assert.deepEqual(metrics.clickToInteractive, {
    count: 4, minMs: 12, p50Ms: 33, p95Ms: 55, maxMs: 55, meanMs: 36.25,
  });
  assert.equal(metrics.byOptimized.optimized.interactions, 3);
  assert.equal(metrics.byOptimized.optimized.hits, 1);
  assert.equal(metrics.byOptimized.unoptimized.interactions, 1);
  assert.equal(metrics.byOptimized.unoptimized.hits, 1);
  assert.equal(metrics.byPrediction.hit.interactions, 2);
  assert.equal(metrics.byPrediction.miss.interactions, 1);
  assert.equal(metrics.byPrediction.noPrediction.interactions, 1);
  assert.equal(metrics.prefetchedBytes, 300);
  assert.equal(metrics.wastedBytes, 200);
  assert.equal(metrics.wastedByteRatio, 2 / 3);
  assert.equal(metrics.viewReusedInteractions, 1);
  assert.equal(metrics.viewReuseRate, 1 / 3);
});

test('empty input and abstaining-only input produce null ratios without inventing values', () => {
  const empty = summarizeMeasurements([]);
  assert.equal(empty.interactions, 0);
  assert.equal(empty.coverage, null);
  assert.equal(empty.hitRateAll, null);
  assert.equal(empty.hitRateWhenPredicted, null);
  assert.equal(empty.missRate, null);
  assert.equal(empty.coldStartShare, null);
  assert.equal(empty.clickToVisible, null);
  assert.equal(empty.clickToInteractive, null);
  assert.equal(empty.wastedByteRatio, null);
  assert.equal(empty.viewReuseRate, null);
  const abstain = summarizeMeasurements([
    record({
      predictionHit: false, predictedPages: [], viewReused: false,
      prefetchedBytes: 0, wastedBytes: 0, coldStart: true, boundary: 'first-visit',
    }),
  ]);
  assert.equal(abstain.coverage, 0);
  assert.equal(abstain.hitRateAll, 0);
  assert.equal(abstain.hitRateWhenPredicted, null);
  assert.equal(abstain.missRate, null);
});

test('reports keep scope, data kind and device validation mutually honest', () => {
  const report = buildMeasurementReport([record()], {
    scope: 'host', dataKind: 'synthetic', deviceValidation: 'not-run',
    timingSource: 'controlled-host-clock', generatedAtUtc: '2026-11-07T00:00:00.000Z',
    command: 'unit-test', notes: ['fixture only'],
  });
  assert.equal(report.scope, 'host');
  assert.equal(report.deviceValidation, 'not-run');
  assert.equal(report.generatedAtUtc, '2026-11-07T00:00:00.000Z');
  assert.equal(report.metrics.hits, 1);
  checkMeasurementReport(report);
  assert.throws(() => buildMeasurementReport([record()], {
    scope: 'host', dataKind: 'synthetic', deviceValidation: 'run', timingSource: 'clock',
  }), MeasurementValidationError);
  assert.throws(() => buildMeasurementReport([record()], {
    scope: 'device', dataKind: 'synthetic', deviceValidation: 'not-run', timingSource: 'clock',
  }), MeasurementValidationError);
  assert.throws(() => buildMeasurementReport([record()], {
    scope: 'host', dataKind: 'device', deviceValidation: 'not-run', timingSource: 'clock',
  }), MeasurementValidationError);
  assert.throws(() => buildMeasurementReport([record()], {
    scope: 'host', dataKind: 'synthetic', deviceValidation: 'not-run', timingSource: ' ',
  }), MeasurementValidationError);
});

test('Node file writer persists the same JSONL that the core validates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'p07-measurement-'));
  try {
    const path = join(directory, 'nested', 'interactions.jsonl');
    const lines = [];
    const writer = new NodeMeasurementFileWriter(path, { onLine: line => lines.push(line) });
    const sink = new JsonlMeasurementSink(writer, { defaultDataKind: 'synthetic' });
    sink.record(record());
    sink.record(record({ interactionId: 'second', pageId: 'c', actualPage: 'c', predictedPages: ['c'] }));
    sink.close();
    assert.equal(lines.length, 2);
    const records = parseMeasurementJsonl(readFileSync(path, 'utf8'));
    assert.equal(records.length, 2);
    assert.equal(records[1].pageId, 'c');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
