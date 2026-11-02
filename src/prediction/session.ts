import type { PathPredictor, Prediction, VisitEvent } from '../contracts.js';
import { checkIdentifier } from './validation.js';
import { resolveSessionPolicy } from './config.js';

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

export interface SessionDecision {
  readonly status: 'accepted' | 'disabled' | 'out-of-order';
  readonly boundary: 'first-visit' | 'gap' | 'consecutive' | null;
  /** Completed eligible transition; null means there is no prediction opportunity to score. */
  readonly transition: { readonly fromPage: string; readonly toPage: string } | null;
  readonly evictedSessionId: string | null;
  readonly candidates: readonly Prediction[];
}

function ignored(status: 'disabled' | 'out-of-order'): SessionDecision {
  return { status, boundary: null, transition: null, evictedSessionId: null, candidates: [] };
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
    const policy = resolveSessionPolicy({ maxSessions: options.maxSessions, maxGapMs: options.maxGapMs, limit: options.limit });
    this.maxSessions = policy.maxSessions;
    this.maxGapMs = policy.maxGapMs;
    this.limit = policy.limit;
  }

  /** Disabling clears session cursors, retains aggregate history, and suppresses inference. */
  setEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
    this.enabled = enabled;
    if (!enabled) this.sessions.clear();
  }

  /** Learn the completed transition, then predict after the current visit. No future event is used. */
  accept(event: VisitEvent): readonly Prediction[] {
    return this.acceptDetailed(event).candidates;
  }

  /** Same execution path as accept; exposes boundaries so callers need not reconstruct them. */
  acceptDetailed(event: VisitEvent): SessionDecision {
    if (!this.enabled) return ignored('disabled');
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
    if (previous !== undefined && event.monotonicMs < previous.monotonicMs) return ignored('out-of-order');
    const consecutive = previous !== undefined && event.monotonicMs - previous.monotonicMs <= this.maxGapMs;
    if (consecutive) {
      this.predictor.observe(previous.pageId, event.pageId);
    }
    // Map insertion order implements LRU, independent of clocks in other sessions.
    this.sessions.delete(event.sessionId);
    this.sessions.set(event.sessionId, { pageId: event.pageId, monotonicMs: event.monotonicMs });
    let evictedSessionId: string | null = null;
    if (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest !== undefined) {
        this.sessions.delete(oldest);
        evictedSessionId = oldest;
      }
    }
    // Ask for the full ranking before filtering: a removed route must not hide a valid one.
    // The supplied model is expected to bound its history; MarkovPredictor retains at most W edges.
    const candidates = this.predictor.predict(event.pageId, Number.MAX_SAFE_INTEGER)
      .filter(candidate => this.pages.has(candidate.pageId)).slice(0, this.limit);
    return {
      status: 'accepted', boundary: consecutive ? 'consecutive' : previous === undefined ? 'first-visit' : 'gap',
      transition: consecutive ? { fromPage: previous.pageId, toPage: event.pageId } : null,
      evictedSessionId, candidates,
    };
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
