import type {
  DurationStats, InteractionGroup, MeasurementMetrics, MeasurementRecord,
} from './types.js';
import { parseMeasurementRecord } from './validation.js';

function durationStats(values: readonly number[]): DurationStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const p50 = sorted[Math.max(0, Math.ceil(0.5 * sorted.length) - 1)]!;
  const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]!;
  const sum = values.reduce((total, value) => total + value, 0);
  return Object.freeze({
    count: values.length,
    minMs: sorted[0]!,
    p50Ms: p50,
    p95Ms: p95,
    maxMs: sorted[sorted.length - 1]!,
    meanMs: sum / values.length,
  });
}

function visibleDurations(records: readonly MeasurementRecord[]): number[] {
  return records.map(record => record.visibleAtMs - record.clickedAtMs);
}

function interactiveDurations(records: readonly MeasurementRecord[]): number[] {
  return records.flatMap(record => record.interactiveAtMs === undefined
    ? [] : [record.interactiveAtMs - record.clickedAtMs]);
}

function group(records: readonly MeasurementRecord[]): InteractionGroup {
  return Object.freeze({
    interactions: records.length,
    hits: records.filter(record => record.predictionHit).length,
    clickToVisible: durationStats(visibleDurations(records)),
    clickToInteractive: durationStats(interactiveDurations(records)),
  });
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * One recorded interaction is one opportunity. First visits and gap boundaries are
 * retained in the denominator with no prediction so coverage cannot be inflated by
 * dropping interactions where the model abstained.
 */
export function summarizeMeasurements(input: readonly MeasurementRecord[]): MeasurementMetrics {
  if (!Array.isArray(input)) throw new TypeError('Measurement input must be an array.');
  const records = input.map(parseMeasurementRecord);
  const interactions = records.length;
  const predicted = records.filter(record => record.predictedPages.length > 0);
  const hits = records.filter(record => record.predictionHit).length;
  const predictionsMade = predicted.length;
  const misses = predictionsMade - hits;
  const coldStartOpportunities = records.filter(record => record.coldStart).length;
  const optimized = records.filter(record => record.optimized);
  const hitRecords = records.filter(record => record.predictionHit);
  const missedPredictions = records.filter(record => record.predictedPages.length > 0 && !record.predictionHit);
  const noPrediction = records.filter(record => record.predictedPages.length === 0);
  const prefetchedBytes = records.reduce((total, record) => total + record.prefetchedBytes, 0);
  const wastedBytes = records.reduce((total, record) => total + record.wastedBytes, 0);
  const viewReusedInteractions = records.filter(record => record.viewReused).length;

  return Object.freeze({
    schemaVersion: 1,
    opportunities: interactions,
    interactions,
    predictionsMade,
    hits,
    misses,
    coldStartOpportunities,
    coverage: ratio(predictionsMade, interactions),
    hitRateAll: ratio(hits, interactions),
    hitRateWhenPredicted: ratio(hits, predictionsMade),
    missRate: ratio(misses, predictionsMade),
    coldStartShare: ratio(coldStartOpportunities, interactions),
    clickToVisible: durationStats(visibleDurations(records)),
    clickToInteractive: durationStats(interactiveDurations(records)),
    byOptimized: Object.freeze({
      optimized: group(optimized),
      unoptimized: group(records.filter(record => !record.optimized)),
    }),
    byPrediction: Object.freeze({
      hit: group(hitRecords),
      miss: group(missedPredictions),
      noPrediction: group(noPrediction),
    }),
    prefetchedBytes,
    wastedBytes,
    wastedByteRatio: ratio(wastedBytes, prefetchedBytes),
    viewReusedInteractions,
    viewReuseRate: ratio(viewReusedInteractions, optimized.length),
  });
}
