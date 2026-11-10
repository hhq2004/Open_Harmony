import type { SessionDecision } from '../prediction/index.js';
import type { PreparedPreload, PreloadEnvironment } from '../preload/types.js';
import type { PreloadTarget, RankedPreloadTarget } from '../preload/controller.js';
import { AppVisitCollector } from './visit-collector.js';

export interface PreloadVisitController<T> {
  visit(sessionId: string, actual: PreloadTarget, candidates: readonly RankedPreloadTarget[]): PreparedPreload<T> | undefined;
  endSession(sessionId: string): void;
  setEnabled(enabled: boolean): void;
  clear(): void;
}

export interface PreloadEnvironmentPort {
  setEnvironment(environment: PreloadEnvironment): void;
}

export interface IntegratedVisit<T> {
  readonly decision: SessionDecision | null;
  /** Ownership transfers to the page. The page must call dispose() when finished. */
  readonly prepared: PreparedPreload<T> | undefined;
}

/** A owns ordering between privacy-safe visits, B's decision and C's speculative work. */
export class AppVisitIntegration<T> {
  private environment: PreloadEnvironment = { idle: false, foregroundBusy: false, memoryPressure: false };

  constructor(
    private readonly collector: AppVisitCollector,
    private readonly controller: PreloadVisitController<T>,
    private readonly scheduler: PreloadEnvironmentPort,
    private readonly targetForPage: (pageId: string) => PreloadTarget | undefined,
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.collector.setEnabled(true);
      this.controller.setEnabled(true);
    } else {
      this.controller.setEnabled(false);
      this.collector.setEnabled(false);
    }
  }

  /** Only a platform idle signal may re-enable speculative execution. */
  setEnvironment(environment: PreloadEnvironment): void {
    this.scheduler.setEnvironment(environment);
    this.environment = { ...environment };
  }

  visit(pageId: string, monotonicMs: number): IntegratedVisit<T> {
    const sessionId = this.collector.getActiveSessionId();
    if (sessionId === null) return { decision: null, prepared: undefined };
    this.scheduler.setEnvironment({ ...this.environment, idle: false, foregroundBusy: true });
    let decision: SessionDecision | null;
    try {
      decision = this.collector.visit(pageId, monotonicMs);
    } catch (error) {
      this.controller.endSession(sessionId);
      throw error;
    }
    if (decision === null || decision.status !== 'accepted') return { decision, prepared: undefined };
    if (decision.boundary === 'gap') this.controller.endSession(sessionId);
    if (decision.evictedSessionId !== null) this.controller.endSession(decision.evictedSessionId);
    const actual = this.targetForPage(pageId);
    if (!actual) {
      this.controller.endSession(sessionId);
      return { decision, prepared: undefined };
    }
    const candidates: RankedPreloadTarget[] = [];
    decision.candidates.forEach((candidate, rank) => {
      const target = this.targetForPage(candidate.pageId);
      if (target) candidates.push({ ...target, priority: -rank });
    });
    return { decision, prepared: this.controller.visit(sessionId, actual, candidates) };
  }

  startNewSession(): void {
    const sessionId = this.collector.getActiveSessionId();
    if (sessionId !== null) this.controller.endSession(sessionId);
    this.collector.startNewSession();
  }

  clear(): void {
    this.controller.clear();
    this.collector.clear();
  }

  getState(): { readonly enabled: boolean } {
    return this.collector.getState();
  }
}
