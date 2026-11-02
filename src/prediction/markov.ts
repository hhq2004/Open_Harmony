import type { PathPredictor, Prediction } from '../contracts.js';

function checkPage(page: string): void {
  if (typeof page !== 'string' || page.trim().length === 0) {
    throw new TypeError('A page identifier must be a nonempty string.');
  }
}

/** First-order baseline; the caller supplies consecutive visits from the same session. */
export class MarkovPredictor implements PathPredictor {
  private readonly transitions = new Map<string, Map<string, number>>();

  observe(fromPage: string, toPage: string): void {
    checkPage(fromPage);
    checkPage(toPage);
    let outgoing = this.transitions.get(fromPage);
    if (outgoing === undefined) {
      outgoing = new Map<string, number>();
      this.transitions.set(fromPage, outgoing);
    }
    outgoing.set(toPage, (outgoing.get(toPage) ?? 0) + 1);
  }

  /** A path is one session. Validate the complete input before changing state. */
  train(path: readonly string[]): void {
    for (const page of path) checkPage(page);
    for (let index = 1; index < path.length; index += 1) {
      const previous = path[index - 1];
      const current = path[index];
      if (previous !== undefined && current !== undefined) this.observe(previous, current);
    }
  }

  predict(fromPage: string, limit = 1): readonly Prediction[] {
    checkPage(fromPage);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('Prediction limit must be a positive safe integer.');
    }
    const outgoing = this.transitions.get(fromPage);
    if (outgoing === undefined) return [];
    const total = [...outgoing.values()].reduce((sum, count) => sum + count, 0);
    return [...outgoing.entries()]
      .map(([pageId, count]) => ({ pageId, probability: count / total }))
      .sort((left, right) => {
        const probabilityOrder = right.probability - left.probability;
        if (probabilityOrder !== 0) return probabilityOrder;
        return left.pageId < right.pageId ? -1 : left.pageId > right.pageId ? 1 : 0;
      })
      .slice(0, limit);
  }

  clear(): void {
    this.transitions.clear();
  }
}
