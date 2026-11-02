import type { PathPredictor, Prediction, VisitEvent } from '../contracts.js';
import { checkIdentifier, checkPositiveInteger } from './validation.js';

export interface SessionOptions {
  /** Fixed route aliases supplied by the application. Never include query parameters. */
  readonly allowedPages: readonly string[];
  readonly maxSessions?: number;
  readonly maxGapMs?: number;
  readonly limit?: number;
}

interface LastVisit {
  readonly pageId: string;
  readonly monotonicMs: number;
}

/** Consumes already-sanitized visits from A; does not hook platform navigation or collect data. */
export class SessionPredictor {
  private readonly pages: Set<string>;
  private readonly sessions = new Map<string, LastVisit>();
  private readonly maxSessions: number;
  private readonly maxGapMs: number;
  private readonly limit: number;
  private enabled = false;

  constructor(private readonly predictor: PathPredictor, options: SessionOptions) {
    if (!Array.isArray(options.allowedPages) || options.allowedPages.length === 0) {
      throw new TypeError('allowedPages must be a nonempty route catalog.');
    }
    for (const page of options.allowedPages) checkIdentifier(page);
    this.pages = new Set(options.allowedPages);
    this.maxSessions = options.maxSessions ?? 32;
    this.maxGapMs = options.maxGapMs ?? 30 * 60 * 1000;
    this.limit = options.limit ?? 1;
    checkPositiveInteger(this.maxSessions, 'maxSessions');
    checkPositiveInteger(this.limit, 'limit');
    if (!Number.isFinite(this.maxGapMs) || this.maxGapMs <= 0) {
      throw new RangeError('maxGapMs must be finite and positive.');
    }
  }

  /** Disabling clears session cursors, retains aggregate history, and suppresses inference. */
  setEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
    this.enabled = enabled;
    if (!enabled) this.sessions.clear();
  }

  /** Learn the completed transition, then predict after the current visit. No future event is used. */
  accept(event: VisitEvent): readonly Prediction[] {
    if (!this.enabled) return [];
    checkIdentifier(event.sessionId);
    try {
      checkIdentifier(event.pageId);
      if (!this.pages.has(event.pageId)) throw new TypeError('Page is outside the route catalog.');
      if (!Number.isFinite(event.monotonicMs) || event.monotonicMs < 0) {
        throw new RangeError('monotonicMs must be finite and nonnegative.');
      }
    } catch (error) {
      // An unobserved/invalid navigation breaks adjacency; do not bridge across it later.
      this.sessions.delete(event.sessionId);
      throw error;
    }
    const previous = this.sessions.get(event.sessionId);
    // Equal timestamps retain arrival order; older delivery is ignored without moving the cursor.
    if (previous !== undefined && event.monotonicMs < previous.monotonicMs) return [];
    if (previous !== undefined && event.monotonicMs - previous.monotonicMs <= this.maxGapMs) {
      this.predictor.observe(previous.pageId, event.pageId);
    }
    // Map insertion order implements LRU, independent of clocks in other sessions.
    this.sessions.delete(event.sessionId);
    this.sessions.set(event.sessionId, { pageId: event.pageId, monotonicMs: event.monotonicMs });
    if (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) this.sessions.delete(oldest);
    }
    return this.predictor.predict(event.pageId, this.limit).filter(candidate => this.pages.has(candidate.pageId));
  }

  endSession(sessionId: string): void {
    checkIdentifier(sessionId);
    this.sessions.delete(sessionId);
  }

  /** User data deletion: remove both aggregate history and all session cursors. */
  clear(): void {
    this.sessions.clear();
    this.predictor.clear();
  }

  getStats(): { enabled: boolean; activeSessions: number } {
    return { enabled: this.enabled, activeSessions: this.sessions.size };
  }
}
