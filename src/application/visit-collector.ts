import type { VisitCollector, VisitEvent } from '../contracts.js';
import type { SessionDecision, SessionPredictor } from '../prediction/index.js';

/** The UI owns this fixed catalog. It must contain route aliases, never URLs or content IDs. */
export const DEMO_PAGES = ['home', 'detail', 'cart', 'profile'] as const;

export interface VisitCollectorOptions {
  readonly allowedPages: readonly string[];
  /** Supply a fresh, random, process-local identifier; it is never persisted. */
  readonly createSessionId: () => string;
}

/** A's privacy and lifecycle boundary in front of B's session predictor. */
export class AppVisitCollector implements VisitCollector {
  private readonly pages: Set<string>;
  private sessionId: string | null = null;
  private enabled = false;

  constructor(private readonly predictor: SessionPredictor, private readonly options: VisitCollectorOptions) {
    if (!Array.isArray(options.allowedPages) || options.allowedPages.length === 0 ||
        options.allowedPages.some(page => typeof page !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(page)) ||
        new Set(options.allowedPages).size !== options.allowedPages.length) {
      throw new TypeError('allowedPages must be distinct, fixed route aliases.');
    }
    this.pages = new Set(options.allowedPages);
  }

  setEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
    if (this.enabled === enabled) return;
    if (enabled) {
      const id = this.newSessionId();
      this.predictor.setEnabled(true);
      this.sessionId = id;
      this.enabled = true;
    } else {
      if (this.sessionId !== null) this.predictor.endSession(this.sessionId);
      this.predictor.setEnabled(false);
      this.sessionId = null;
      this.enabled = false;
    }
  }

  /** Call on app resume or a clock reset; the next visit starts a new path. */
  startNewSession(): void {
    if (!this.enabled) return;
    const id = this.newSessionId();
    if (this.sessionId !== null) this.predictor.endSession(this.sessionId);
    this.sessionId = id;
  }

  /** Route is an app-defined alias; no raw location, query, account or device data enters B. */
  visit(pageId: string, monotonicMs: number): SessionDecision | null {
    if (!this.enabled || this.sessionId === null) return null;
    return this.record({ sessionId: this.sessionId, pageId, monotonicMs });
  }

  record(event: VisitEvent): SessionDecision | null {
    if (!this.enabled || this.sessionId === null) return null;
    if (event.sessionId !== this.sessionId || !this.pages.has(event.pageId) ||
        !Number.isFinite(event.monotonicMs) || event.monotonicMs < 0) {
      this.predictor.endSession(this.sessionId);
      throw new TypeError('Rejected an invalid or unrecognized visit.');
    }
    return this.predictor.acceptDetailed(event);
  }

  /** Delete B's learned history and rotate the active anonymous session. */
  clear(): void {
    const id = this.enabled ? this.newSessionId() : null;
    this.predictor.clear();
    this.sessionId = id;
  }

  getState(): { readonly enabled: boolean } {
    return { enabled: this.enabled };
  }

  /** For the in-process A→C handoff only. Never display, persist or transmit this ID. */
  getActiveSessionId(): string | null {
    return this.sessionId;
  }

  private newSessionId(): string {
    const id = this.options.createSessionId();
    if (!/^s-[0-9a-f]{32}$/.test(id) || id === this.sessionId) {
      throw new TypeError('createSessionId must return a fresh random s-hex identifier.');
    }
    return id;
  }
}
