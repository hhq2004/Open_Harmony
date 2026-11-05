import type { PreparedPreload } from './types.js';
import { DataPreloadScheduler } from './scheduler.js';

export interface PreloadTarget {
  readonly pageId: string;
  /** Includes content parameters/version; use opaque aliases, not raw URLs or account IDs. */
  readonly dataKey: string;
}

export interface RankedPreloadTarget extends PreloadTarget {
  readonly priority: number;
}

function checkTarget(target: PreloadTarget): void {
  for (const value of [target.pageId, target.dataKey]) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
      throw new TypeError('Use bounded opaque page/data aliases.');
    }
  }
}

/** Optional A→C coordinator. Owns an exclusive scheduler; does not collect visits or call B. */
export class PredictionPreloadController<T> {
  private readonly previous = new Map<string, { taskId: string; target: PreloadTarget }>();
  private sequence = 0;

  constructor(private readonly scheduler: DataPreloadScheduler<T>, private readonly maxSessions = 32) {
    if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) throw new RangeError('Invalid session capacity.');
  }

  /** A first calls B.acceptDetailed once. Ignore out-of-order decisions; endSession on boundaries.
   * Match the previous generation BEFORE scheduling the first new ranked candidate (even if empty).
   */
  visit(sessionId: string, actual: PreloadTarget, candidates: readonly RankedPreloadTarget[]): PreparedPreload<T> | undefined {
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 128) throw new TypeError('Invalid session alias.');
    checkTarget(actual);
    for (const candidate of candidates) {
      checkTarget(candidate);
      if (!Number.isFinite(candidate.priority)) throw new TypeError('Invalid candidate priority.');
    }
    const prior = this.previous.get(sessionId);
    this.previous.delete(sessionId);
    let reused: PreparedPreload<T> | undefined;
    if (prior) {
      if (prior.target.pageId === actual.pageId && prior.target.dataKey === actual.dataKey) {
        reused = this.scheduler.take(prior.taskId);
        if (!reused) this.scheduler.cancel(prior.taskId, 'foreground-work');
      } else this.scheduler.cancel(prior.taskId, 'prediction-miss');
    }
    const candidate = candidates[0];
    if (candidate) {
      if (this.previous.size >= this.maxSessions) {
        const oldest = this.previous.keys().next().value;
        if (oldest !== undefined) this.endSession(oldest);
      }
      const taskId = `prediction-${++this.sequence}`;
      this.previous.set(sessionId, { taskId, target: Object.freeze({ pageId: candidate.pageId, dataKey: candidate.dataKey }) });
      this.scheduler.enqueue({ taskId, sessionId, pageId: candidate.pageId, dataKey: candidate.dataKey, priority: candidate.priority });
    }
    return reused;
  }

  endSession(sessionId: string): void {
    this.previous.delete(sessionId);
    this.scheduler.endSession(sessionId);
  }

  setEnabled(enabled: boolean): void {
    this.scheduler.setEnabled(enabled);
    if (!enabled) this.previous.clear();
  }

  clear(): void { this.previous.clear(); this.scheduler.clear(); }
}
