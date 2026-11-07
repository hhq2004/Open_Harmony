import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Host-only JSONL writer for the measurement core. The core owns validation and
 * duplicate handling; this adapter owns the Node file descriptor and optional tee.
 */
export class NodeMeasurementFileWriter {
  #fd;
  #closed = false;

  constructor(filePath, { onLine } = {}) {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new TypeError('A nonempty output file path is required.');
    }
    if (onLine !== undefined && typeof onLine !== 'function') {
      throw new TypeError('onLine must be a function when provided.');
    }
    mkdirSync(dirname(filePath), { recursive: true });
    this.#fd = openSync(filePath, 'w');
    this.onLine = onLine;
  }

  writeLine(line) {
    if (this.#closed) throw new Error('Measurement file writer is closed.');
    if (typeof line !== 'string' || line.trim() === '') {
      throw new TypeError('A nonempty JSONL line is required.');
    }
    writeSync(this.#fd, `${line}\n`);
    this.onLine?.(line);
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    closeSync(this.#fd);
  }
}
