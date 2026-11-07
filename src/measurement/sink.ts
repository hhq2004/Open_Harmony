import type { InteractionMeasurement, MeasurementSink } from '../contracts.js';
import type { MeasurementDataKind, MeasurementRecord } from './types.js';
import {
  MeasurementValidationError, normalizeMeasurement, parseMeasurementJsonl, parseMeasurementRecord,
} from './validation.js';

/** The core module never imports Node APIs; platform writers are supplied by adapters. */
export interface MeasurementWriter {
  writeLine(line: string): void;
  close?(): void;
}

export class MemoryMeasurementWriter implements MeasurementWriter {
  private readonly lines: string[] = [];
  private closed = false;

  writeLine(line: string): void {
    if (this.closed) throw new Error('Measurement writer is closed.');
    this.lines.push(line);
  }

  close(): void {
    this.closed = true;
  }

  get lineCount(): number {
    return this.lines.length;
  }

  get text(): string {
    return this.lines.length === 0 ? '' : `${this.lines.join('\n')}\n`;
  }

  records(): readonly MeasurementRecord[] {
    return parseMeasurementJsonl(this.text);
  }
}

export interface JsonlMeasurementSinkOptions {
  /** Applied only to inputs that omit dataKind. */
  readonly defaultDataKind?: MeasurementDataKind;
}

/**
 * Validates once, writes one JSON object per line, and makes exact duplicate delivery
 * idempotent. A conflicting duplicate is an error rather than a silent overwrite.
 */
export class JsonlMeasurementSink implements MeasurementSink {
  private readonly seen = new Map<string, string>();
  private readonly defaultDataKind: MeasurementDataKind;
  private closed = false;

  constructor(private readonly writer: MeasurementWriter, options: JsonlMeasurementSinkOptions = {}) {
    if (writer === null || typeof writer !== 'object' || typeof writer.writeLine !== 'function') {
      throw new TypeError('A measurement writer with writeLine() is required.');
    }
    this.defaultDataKind = options.defaultDataKind ?? 'host-observed';
  }

  record(measurement: InteractionMeasurement): void {
    if (this.closed) throw new Error('Measurement sink is closed.');
    const record = normalizeMeasurement(measurement, { dataKind: this.defaultDataKind });
    const serialized = JSON.stringify(record);
    const previous = this.seen.get(record.interactionId);
    if (previous !== undefined) {
      if (previous === serialized) return;
      throw new MeasurementValidationError(
        `Conflicting duplicate interactionId: ${record.interactionId}.`,
      );
    }
    this.writer.writeLine(serialized);
    this.seen.set(record.interactionId, serialized);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.writer.close?.();
  }

  get count(): number {
    return this.seen.size;
  }
}

/** Strict readback for tests and offline tools; rejects duplicate interaction IDs. */
export function readMeasurementRecords(text: string): readonly MeasurementRecord[] {
  return parseMeasurementJsonl(text);
}

export { parseMeasurementRecord };
