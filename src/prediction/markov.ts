import type { PathPredictor, Prediction } from '../contracts.js';
import { checkIdentifier, checkPositiveInteger } from './validation.js';
import { resolveModelConfig } from './config.js';

export interface MarkovOptions {
  /** Maximum number of recent transitions retained across all sessions. */
  readonly windowSize?: number;
  /** Minimum outgoing observations for the current page before predicting. */
  readonly minSamples?: number;
  /** Filter candidates without renormalizing their empirical frequencies. */
  readonly minProbability?: number;
}

interface Row {
  readonly counts: Map<string, number>;
  total: number;
}

interface Transition {
  readonly from: string;
  readonly to: string;
}

/** Bounded first-order model; the caller supplies consecutive visits from the same session. */
export class MarkovPredictor implements PathPredictor {
  private readonly transitions = new Map<string, Row>();
  private readonly history: Transition[] = [];
  private head = 0;
  readonly windowSize: number;
  readonly minSamples: number;
  readonly minProbability: number;

  constructor(options: MarkovOptions = {}) {
    const config = resolveModelConfig(options);
    this.windowSize = config.windowSize;
    this.minSamples = config.minSamples;
    this.minProbability = config.minProbability;
  }

  observe(fromPage: string, toPage: string): void {
    checkIdentifier(fromPage);
    checkIdentifier(toPage);
    const transition = { from: fromPage, to: toPage };
    if (this.history.length === this.windowSize) {
      const oldest = this.history[this.head];
      if (oldest !== undefined) this.remove(oldest);
      this.history[this.head] = transition;
      this.head = (this.head + 1) % this.windowSize;
    } else {
      this.history.push(transition);
    }
    let outgoing = this.transitions.get(fromPage);
    if (outgoing === undefined) {
      outgoing = { counts: new Map<string, number>(), total: 0 };
      this.transitions.set(fromPage, outgoing);
    }
    outgoing.counts.set(toPage, (outgoing.counts.get(toPage) ?? 0) + 1);
    outgoing.total += 1;
  }

  private remove(transition: Transition): void {
    const row = this.transitions.get(transition.from);
    if (row === undefined) return;
    const count = row.counts.get(transition.to) ?? 0;
    if (count <= 1) row.counts.delete(transition.to);
    else row.counts.set(transition.to, count - 1);
    row.total -= 1;
    if (row.total === 0) this.transitions.delete(transition.from);
  }

  /** A path is one session. Validate the complete input before changing state. */
  train(path: readonly string[]): void {
    if (!Array.isArray(path)) throw new TypeError('A training path must be an array.');
    for (const page of path) checkIdentifier(page);
    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1];
      const current = path[index];
      if (previous !== undefined && current !== undefined) this.observe(previous, current);
    }
  }

  predict(fromPage: string, limit = 1): readonly Prediction[] {
    checkIdentifier(fromPage);
    checkPositiveInteger(limit, 'Prediction limit');
    const outgoing = this.transitions.get(fromPage);
    if (outgoing === undefined || outgoing.total < this.minSamples) return [];
    return [...outgoing.counts.entries()]
      .map(([pageId, count]) => ({ pageId, probability: count / outgoing.total }))
      .filter(candidate => candidate.probability >= this.minProbability)
      .sort((left, right) => {
        const probabilityOrder = right.probability - left.probability;
        if (probabilityOrder !== 0) return probabilityOrder;
        return left.pageId < right.pageId ? -1 : left.pageId > right.pageId ? 1 : 0;
      })
      .slice(0, limit);
  }

  clear(): void {
    this.transitions.clear();
    this.history.length = 0;
    this.head = 0;
  }

  /** Structural counts, not a byte-accurate heap measurement. No identifiers are exposed. */
  getStats(): { observations: number; sourcePages: number; edges: number } {
    let edges = 0;
    for (const row of this.transitions.values()) edges += row.counts.size;
    return { observations: this.history.length, sourcePages: this.transitions.size, edges };
  }
}
