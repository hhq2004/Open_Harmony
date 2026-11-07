import type { InteractionMeasurement } from '../contracts.js';
import type {
  MeasurementBoundary, MeasurementDataKind, MeasurementRecord, MeasurementScope,
} from './types.js';

const DATA_KINDS: readonly MeasurementDataKind[] = ['synthetic', 'host-observed', 'device'];
const BOUNDARIES: readonly MeasurementBoundary[] = ['first-visit', 'consecutive', 'gap', 'unknown'];
const SCOPES: readonly MeasurementScope[] = ['host', 'device'];

const BASE_KEYS = [
  'interactionId', 'pageId', 'clickedAtMs', 'visibleAtMs', 'optimized', 'predictionHit',
] as const;
const EXTENSION_KEYS = [
  'schemaVersion', 'sessionId', 'interactiveAtMs', 'coldStart', 'boundary', 'predictedPages',
  'actualPage', 'preloadTaskId', 'viewReused', 'prefetchedBytes', 'wastedBytes', 'dataKind',
] as const;
const RECORD_REQUIRED_KEYS = [
  ...BASE_KEYS, 'schemaVersion', 'coldStart', 'boundary', 'predictedPages', 'actualPage',
  'viewReused', 'prefetchedBytes', 'wastedBytes', 'dataKind',
] as const;
const ALL_KEYS = new Set<string>([...BASE_KEYS, ...EXTENSION_KEYS]);

export class MeasurementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeasurementValidationError';
  }
}

function fail(message: string): never {
  throw new MeasurementValidationError(message);
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function checkIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    fail(`${name} must be a nonempty string of at most 128 UTF-16 code units.`);
  }
  return value;
}

function optionalIdentifier(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : checkIdentifier(value, name);
}

function checkBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') fail(`${name} must be boolean.`);
  return value;
}

function checkTime(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${name} must be a finite nonnegative number.`);
  }
  return value;
}

function optionalTime(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : checkTime(value, name);
}

function checkBytes(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${name} must be a nonnegative safe integer.`);
  }
  return value as number;
}

function optionalBytes(value: unknown, name: string, fallback: number): number {
  return value === undefined ? fallback : checkBytes(value, name);
}

export function checkDataKind(value: unknown, name = 'dataKind'): MeasurementDataKind {
  if (typeof value !== 'string' || !DATA_KINDS.includes(value as MeasurementDataKind)) {
    fail(`${name} must be one of: ${DATA_KINDS.join(', ')}.`);
  }
  return value as MeasurementDataKind;
}

export function checkScope(value: unknown, name = 'scope'): MeasurementScope {
  if (typeof value !== 'string' || !SCOPES.includes(value as MeasurementScope)) {
    fail(`${name} must be one of: ${SCOPES.join(', ')}.`);
  }
  return value as MeasurementScope;
}

function checkBoundary(value: unknown): MeasurementBoundary {
  if (typeof value !== 'string' || !BOUNDARIES.includes(value as MeasurementBoundary)) {
    fail(`boundary must be one of: ${BOUNDARIES.join(', ')}.`);
  }
  return value as MeasurementBoundary;
}

export interface NormalizeMeasurementOptions {
  /** Applied only when the input omits dataKind; it does not overwrite an explicit value. */
  readonly dataKind: MeasurementDataKind;
}

/**
 * Validate and fill optional E-module fields. A may call this through the shared
 * MeasurementSink with only InteractionMeasurement fields; missing extension fields
 * receive conservative defaults and are never inferred from timing.
 */
export function normalizeMeasurement(
  input: InteractionMeasurement,
  options: NormalizeMeasurementOptions,
): MeasurementRecord {
  const raw = asRecord(input, 'measurement');
  for (const key of Object.keys(raw)) {
    if (!ALL_KEYS.has(key)) fail(`Unknown measurement field: ${key}.`);
  }
  const interactionId = checkIdentifier(raw['interactionId'], 'interactionId');
  const pageId = checkIdentifier(raw['pageId'], 'pageId');
  const clickedAtMs = checkTime(raw['clickedAtMs'], 'clickedAtMs');
  const visibleAtMs = checkTime(raw['visibleAtMs'], 'visibleAtMs');
  if (visibleAtMs < clickedAtMs) fail('visibleAtMs cannot precede clickedAtMs.');
  const optimized = checkBoolean(raw['optimized'], 'optimized');
  const predictionHit = checkBoolean(raw['predictionHit'], 'predictionHit');

  const version = raw['schemaVersion'];
  if (version !== undefined && version !== 1) fail('schemaVersion must be 1.');
  const sessionId = optionalIdentifier(raw['sessionId'], 'sessionId');
  const interactiveAtMs = optionalTime(raw['interactiveAtMs'], 'interactiveAtMs');
  if (interactiveAtMs !== undefined && interactiveAtMs < clickedAtMs) {
    fail('interactiveAtMs cannot precede clickedAtMs.');
  }
  const coldStart = raw['coldStart'] === undefined ? false : checkBoolean(raw['coldStart'], 'coldStart');
  const boundary = raw['boundary'] === undefined ? 'unknown' : checkBoundary(raw['boundary']);
  const actualPage = raw['actualPage'] === undefined
    ? pageId : checkIdentifier(raw['actualPage'], 'actualPage');
  if (actualPage !== pageId) fail('actualPage must equal pageId for a click-to-page interaction.');

  const predictedPages = raw['predictedPages'] === undefined ? [] : raw['predictedPages'];
  if (!Array.isArray(predictedPages)) fail('predictedPages must be an array of route aliases.');
  const seenPages = new Set<string>();
  const candidates: string[] = [];
  for (const [index, candidate] of predictedPages.entries()) {
    const page = checkIdentifier(candidate, `predictedPages[${index}]`);
    if (seenPages.has(page)) fail(`predictedPages contains duplicate route: ${page}.`);
    seenPages.add(page);
    candidates.push(page);
  }

  const preloadTaskId = optionalIdentifier(raw['preloadTaskId'], 'preloadTaskId');
  const viewReused = raw['viewReused'] === undefined ? false : checkBoolean(raw['viewReused'], 'viewReused');
  if (viewReused && !optimized) fail('viewReused requires optimized=true.');
  const prefetchedBytes = optionalBytes(raw['prefetchedBytes'], 'prefetchedBytes', 0);
  const wastedBytes = optionalBytes(raw['wastedBytes'], 'wastedBytes', 0);
  if (wastedBytes > prefetchedBytes) fail('wastedBytes cannot exceed prefetchedBytes.');

  const dataKind = raw['dataKind'] === undefined
    ? checkDataKind(options.dataKind, 'defaultDataKind')
    : checkDataKind(raw['dataKind'], 'dataKind');

  if (candidates.length === 0 && predictionHit) {
    fail('predictionHit requires at least one predicted page.');
  }
  if (candidates.length > 0 && predictionHit !== candidates.includes(actualPage)) {
    fail('predictionHit must equal membership of actualPage in predictedPages.');
  }

  return Object.freeze({
    schemaVersion: 1,
    interactionId,
    pageId,
    clickedAtMs,
    visibleAtMs,
    optimized,
    predictionHit,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(interactiveAtMs === undefined ? {} : { interactiveAtMs }),
    coldStart,
    boundary,
    predictedPages: Object.freeze(candidates),
    actualPage,
    ...(preloadTaskId === undefined ? {} : { preloadTaskId }),
    viewReused,
    prefetchedBytes,
    wastedBytes,
    dataKind,
  });
}

/** Strict reader for stored records: unlike normalizeMeasurement, it does not fill missing fields. */
export function parseMeasurementRecord(value: unknown): MeasurementRecord {
  const raw = asRecord(value, 'measurement record');
  for (const key of RECORD_REQUIRED_KEYS) {
    if (!(key in raw)) fail(`Measurement record is missing required field: ${key}.`);
  }
  const dataKind = checkDataKind(raw['dataKind'], 'dataKind');
  return normalizeMeasurement(value as InteractionMeasurement, { dataKind });
}

/** Parse the durable JSONL form written by JsonlMeasurementSink. */
export function parseMeasurementJsonl(text: string): readonly MeasurementRecord[] {
  if (typeof text !== 'string') fail('Measurement JSONL input must be a string.');
  const records: MeasurementRecord[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      fail(`Invalid JSON on measurement line ${index + 1}.`);
    }
    const record = parseMeasurementRecord(value);
    if (seen.has(record.interactionId)) {
      fail(`Duplicate interactionId in measurement JSONL: ${record.interactionId}.`);
    }
    seen.add(record.interactionId);
    records.push(record);
  }
  return Object.freeze(records);
}
