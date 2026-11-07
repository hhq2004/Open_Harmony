import type {
  MeasurementDataKind, MeasurementProvenance, MeasurementRecord, MeasurementReport, MeasurementScope,
} from './types.js';
import { summarizeMeasurements } from './aggregate.js';
import {
  MeasurementValidationError, checkDataKind, checkScope,
} from './validation.js';

export interface MeasurementReportOptions {
  readonly scope: MeasurementScope;
  readonly dataKind: MeasurementDataKind;
  readonly deviceValidation: 'not-run' | 'run';
  readonly timingSource: string;
  readonly command?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly environment?: Readonly<Record<string, unknown>>;
  readonly provenance?: MeasurementProvenance;
  readonly notes?: readonly string[];
  readonly generatedAtUtc?: string;
}

function checkText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MeasurementValidationError(`${name} must be a nonempty string.`);
  }
  return value;
}

/** Build a report that keeps data provenance and measurement scope explicit. */
export function buildMeasurementReport(
  records: readonly MeasurementRecord[],
  options: MeasurementReportOptions,
): MeasurementReport {
  const scope = checkScope(options.scope);
  const dataKind = checkDataKind(options.dataKind);
  if (options.deviceValidation !== 'not-run' && options.deviceValidation !== 'run') {
    throw new MeasurementValidationError("deviceValidation must be 'not-run' or 'run'.");
  }
  if (options.deviceValidation === 'run' && scope !== 'device') {
    throw new MeasurementValidationError('deviceValidation=run requires scope=device.');
  }
  if (scope === 'device' && dataKind !== 'device') {
    throw new MeasurementValidationError('scope=device requires dataKind=device.');
  }
  if (scope === 'host' && dataKind === 'device') {
    throw new MeasurementValidationError('scope=host cannot claim device data.');
  }
  const timingSource = checkText(options.timingSource, 'timingSource');
  const generatedAtUtc = options.generatedAtUtc === undefined
    ? new Date().toISOString() : checkText(options.generatedAtUtc, 'generatedAtUtc');
  const notes = options.notes === undefined ? [] : options.notes;
  if (!Array.isArray(notes) || notes.some(note => typeof note !== 'string')) {
    throw new MeasurementValidationError('notes must be an array of strings.');
  }

  return Object.freeze({
    schemaVersion: 1,
    scope,
    dataKind,
    deviceValidation: options.deviceValidation,
    timingSource,
    generatedAtUtc,
    command: options.command ?? '',
    config: Object.freeze({ ...(options.config ?? {}) }),
    environment: Object.freeze({ ...(options.environment ?? {}) }),
    provenance: Object.freeze({ ...(options.provenance ?? {}) }),
    metrics: summarizeMeasurements(records),
    notes: Object.freeze([...notes]),
  });
}

/** Minimal structural check used by the CI summary and CLI round-trip tests. */
export function checkMeasurementReport(value: MeasurementReport): void {
  if (value === null || typeof value !== 'object' || value.schemaVersion !== 1) {
    throw new MeasurementValidationError('Report schemaVersion must be 1.');
  }
  checkScope(value.scope);
  checkDataKind(value.dataKind);
  if (!value.metrics || value.metrics.schemaVersion !== 1) {
    throw new MeasurementValidationError('Report metrics are missing or have a foreign schema.');
  }
  if (value.metrics.opportunities !== value.metrics.interactions) {
    throw new MeasurementValidationError('One interaction must equal one opportunity.');
  }
}
