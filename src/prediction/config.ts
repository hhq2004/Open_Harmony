import { checkPositiveInteger } from './validation.js';

export interface ModelConfig {
  readonly windowSize: number;
  readonly minSamples: number;
  readonly minProbability: number;
}

export interface SessionPolicy {
  readonly maxSessions: number;
  readonly maxGapMs: number;
  readonly limit: number;
}

export interface PredictionConfig {
  readonly schemaVersion: 1;
  readonly model: ModelConfig;
  readonly session: SessionPolicy;
}

/** Single source of application defaults. No platform/file API is used in this module. */
export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = Object.freeze({
  schemaVersion: 1,
  model: Object.freeze({ windowSize: 2048, minSamples: 1, minProbability: 0 }),
  session: Object.freeze({ maxSessions: 32, maxGapMs: 30 * 60 * 1000, limit: 1 }),
});

/** Historical comparator settings, distinct from the application's active configuration. */
export const DEFAULT_COMPARISON_MODEL: ModelConfig = Object.freeze({
  windowSize: 16, minSamples: 3, minProbability: 0.6,
});

function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !keys.includes(key))) {
    throw new TypeError(`Expected a configuration object with only: ${keys.join(', ')}.`);
  }
  return input as Record<string, unknown>;
}

function numberOption(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key] === undefined ? fallback : input[key];
  if (typeof value !== 'number') throw new RangeError(`${key} must be numeric.`);
  return value;
}

export function resolveModelConfig(input: unknown = {}, fallback: ModelConfig = DEFAULT_PREDICTION_CONFIG.model): ModelConfig {
  const values = record(input, ['windowSize', 'minSamples', 'minProbability']);
  const windowSize = numberOption(values, 'windowSize', fallback.windowSize);
  const minSamples = numberOption(values, 'minSamples', fallback.minSamples);
  const minProbability = numberOption(values, 'minProbability', fallback.minProbability);
  checkPositiveInteger(windowSize, 'windowSize');
  checkPositiveInteger(minSamples, 'minSamples');
  if (minSamples > windowSize) throw new RangeError('minSamples cannot exceed windowSize.');
  if (!Number.isFinite(minProbability) || minProbability < 0 || minProbability > 1) {
    throw new RangeError('minProbability must be between zero and one.');
  }
  return Object.freeze({ windowSize, minSamples, minProbability });
}

export function resolveSessionPolicy(input: unknown = {}, fallback: SessionPolicy = DEFAULT_PREDICTION_CONFIG.session): SessionPolicy {
  const values = record(input, ['maxSessions', 'maxGapMs', 'limit']);
  const maxSessions = numberOption(values, 'maxSessions', fallback.maxSessions);
  const maxGapMs = numberOption(values, 'maxGapMs', fallback.maxGapMs);
  const limit = numberOption(values, 'limit', fallback.limit);
  checkPositiveInteger(maxSessions, 'maxSessions');
  checkPositiveInteger(limit, 'limit');
  if (!Number.isFinite(maxGapMs) || maxGapMs <= 0) throw new RangeError('maxGapMs must be finite and positive.');
  return Object.freeze({ maxSessions, maxGapMs, limit });
}

/** Partial overrides merge with an explicit base; nulls and misspelled keys are rejected. */
export function resolvePredictionConfig(input: unknown = {}, fallback: PredictionConfig = DEFAULT_PREDICTION_CONFIG): PredictionConfig {
  const values = record(input, ['schemaVersion', 'model', 'session']);
  if (values['schemaVersion'] !== undefined && values['schemaVersion'] !== 1) {
    throw new RangeError('Prediction configuration schemaVersion must be 1.');
  }
  return Object.freeze({
    schemaVersion: 1,
    model: resolveModelConfig(values['model'] === undefined ? {} : values['model'], fallback.model),
    session: resolveSessionPolicy(values['session'] === undefined ? {} : values['session'], fallback.session),
  });
}
