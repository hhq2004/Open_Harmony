import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runMeasurementScenario, validateMeasurementConfig } from '../benchmarks/measurement.mjs';
import { parseMeasurementJsonl } from '../dist/measurement/index.js';

const config = validateMeasurementConfig(JSON.parse(
  readFileSync(new URL('../config/measurement-baseline.json', import.meta.url), 'utf8'),
));

function metricsShape(metrics) {
  return {
    interactions: metrics.interactions,
    predictionsMade: metrics.predictionsMade,
    hits: metrics.hits,
    misses: metrics.misses,
    coldStartOpportunities: metrics.coldStartOpportunities,
    coverage: metrics.coverage,
    hitRateAll: metrics.hitRateAll,
    hitRateWhenPredicted: metrics.hitRateWhenPredicted,
    p50: metrics.clickToVisible?.p50Ms ?? null,
    p95: metrics.clickToVisible?.p95Ms ?? null,
    prefetchedBytes: metrics.prefetchedBytes,
    wastedBytes: metrics.wastedBytes,
    viewReused: metrics.viewReusedInteractions,
  };
}

test('B, C, D and E run one deterministic hit/miss scenario with clean ownership', async () => {
  const result = await runMeasurementScenario(config);
  assert.equal(result.baseline.scope, 'host');
  assert.equal(result.baseline.dataKind, 'synthetic');
  assert.equal(result.baseline.deviceValidation, 'not-run');
  assert.equal(result.baseline.timingSource, 'controlled-host-clock');
  assert.equal(result.optimized.deviceValidation, 'not-run');
  assert.equal(result.baseline.metrics.interactions, 11);
  assert.equal(result.baseline.metrics.predictionsMade, 9);
  assert.equal(result.baseline.metrics.hits, 7);
  assert.equal(result.baseline.metrics.misses, 2);
  assert.equal(result.baseline.metrics.coldStartOpportunities, 2);
  assert.equal(result.baseline.metrics.clickToVisible.p50Ms, 22);
  assert.equal(result.optimized.metrics.clickToVisible.p50Ms, 2);
  assert.equal(result.optimized.metrics.clickToVisible.p95Ms, 22);
  assert.equal(result.optimized.metrics.viewReusedInteractions, 7);
  assert.equal(result.optimized.metrics.viewReuseRate, 7 / 11);
  assert.equal(result.optimized.metrics.prefetchedBytes, 2304);
  assert.equal(result.optimized.metrics.wastedBytes, 512);
  assert.equal(result.optimized.metrics.wastedByteRatio, 512 / 2304);
  assert.deepEqual(metricsShape(result.baseline.metrics), {
    interactions: 11, predictionsMade: 9, hits: 7, misses: 2, coldStartOpportunities: 2,
    coverage: 9 / 11, hitRateAll: 7 / 11, hitRateWhenPredicted: 7 / 9,
    p50: 22, p95: 22, prefetchedBytes: 0, wastedBytes: 0, viewReused: 0,
  });
  assert.equal(result.comparison.samePredictions, true);
  assert.deepEqual(result.comparison.delta, {
    clickToVisibleP50SavedMs: 20,
    clickToVisibleP95SavedMs: 0,
    hitRateAllDelta: 0,
    prefetchedBytesAdded: 2304,
    wastedBytesAdded: 512,
  });
  for (const [name, check] of Object.entries(result.comparison.checks)) {
    assert.equal(check, true, `comparison check failed: ${name}`);
  }
  assert.equal(result.comparison.cleanup.scheduler.retainedTasks, 0);
  assert.equal(result.comparison.cleanup.scheduler.heldBytes, 0);
  assert.equal(result.comparison.cleanup.scheduler.physicalBusy, false);
  assert.equal(result.comparison.cleanup.scheduler.cleanupErrors, 0);
  assert.equal(result.comparison.cleanup.scheduler.observerErrors, 0);
  assert.equal(result.comparison.cleanup.scheduler.cancelErrors, 0);
  assert.equal(result.comparison.cleanup.runtime.pendingTimers, 0);
  assert.equal(result.comparison.cleanup.scheduler.transitions.consumed, 7);
  assert.equal(result.comparison.cleanup.scheduler.transitions.cancelled, 2);
  assert.equal(result.comparison.cleanup.scheduler.transitions.failed, 0);
  assert.ok(result.baselineRecords.every(record => record.optimized === false));
  assert.ok(result.optimizedRecords.every(record => record.optimized === true));
  assert.ok(result.baselineRecords.every(record => record.prefetchedBytes === 0 && record.wastedBytes === 0));
  assert.equal(result.optimizedRecords.filter(record => record.viewReused).length, 7);
  assert.equal(result.optimizedRecords.filter(record => record.boundary === 'first-visit').length, 2);
  assert.equal(result.optimizedRecords.filter(record => record.predictionHit).length, 7);
  assert.equal(result.optimizedRecords.filter(record => record.boundary === 'consecutive').length, 9);
  assert.equal(result.optimizedRecords.filter(record => record.boundary === 'gap').length, 0);
});

test('the same scenario yields the same metrics on a second run', async () => {
  const first = await runMeasurementScenario(config);
  const second = await runMeasurementScenario(config);
  assert.deepEqual(metricsShape(first.baseline.metrics), metricsShape(second.baseline.metrics));
  assert.deepEqual(metricsShape(first.optimized.metrics), metricsShape(second.optimized.metrics));
  assert.deepEqual(first.comparison.delta, second.comparison.delta);
});

test('raw JSONL round-trips with the same interaction IDs and no hidden fields', async () => {
  const result = await runMeasurementScenario(config);
  const baselineText = `${result.baselineRecords.map(record => JSON.stringify(record)).join('\n')}\n`;
  const restored = parseMeasurementJsonl(baselineText);
  assert.equal(restored.length, result.baselineRecords.length);
  assert.deepEqual(restored.map(record => record.interactionId), result.baselineRecords.map(record => record.interactionId));
  for (const record of restored) {
    assert.equal(record.dataKind, 'synthetic');
    assert.equal(record.actualPage, record.pageId);
    assert.equal(record.predictionHit, record.predictedPages.includes(record.actualPage));
    assert.equal(record.wastedBytes <= record.prefetchedBytes, true);
  }
});
