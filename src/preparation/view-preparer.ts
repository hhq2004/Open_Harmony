import type { CancelReason, PreloadRequest, PreparedView, ViewPreparer } from '../contracts.js';
import { checkIdentifier, checkPositiveInteger } from '../prediction/validation.js';

export interface BuiltView<T> {
  readonly resource: T;
  /** Adapter-supplied estimate used for cache accounting, not a device memory measurement. */
  readonly estimatedBytes: number;
  /** Release the native resource. The manager calls this at most once. */
  dispose(): void;
}

export interface ViewCancellationSignal {
  readonly cancelled: boolean;
  readonly reason: CancelReason | null;
}

export interface ViewBuildContext {
  readonly signal: ViewCancellationSignal;
}

export type ViewBuilder<T> = (
  request: PreloadRequest,
  context: ViewBuildContext,
) => BuiltView<T> | Promise<BuiltView<T>>;

export interface ViewPreparerOptions {
  readonly maxPreparedViews?: number;
  readonly maxPreparedBytes?: number;
  readonly ttlMs?: number;
  /** Monotonic milliseconds. Injected by host tests; production uses a platform monotonic clock. */
  readonly now?: () => number;
}

const DEFAULT_MAX_PREPARED_VIEWS = 4;
const DEFAULT_MAX_PREPARED_MIB = 32;
const DEFAULT_VIEW_TTL_MS = 60_000;

export const DEFAULT_VIEW_PREPARER_OPTIONS = Object.freeze({
  maxPreparedViews: DEFAULT_MAX_PREPARED_VIEWS,
  maxPreparedBytes: DEFAULT_MAX_PREPARED_MIB * 1024 * 1024,
  ttlMs: DEFAULT_VIEW_TTL_MS,
});

export class ViewPreparationCancelledError extends Error {
  constructor(readonly taskId: string, readonly pageId: string, readonly reason: CancelReason) {
    super(`View preparation '${taskId}' for '${pageId}' was cancelled: ${reason}.`);
    this.name = 'ViewPreparationCancelledError';
  }
}

export class ViewCapacityError extends Error {
  constructor(readonly taskId: string, readonly estimatedBytes: number, readonly maxPreparedBytes: number) {
    super(`View '${taskId}' needs ${estimatedBytes} bytes, exceeding the ${maxPreparedBytes}-byte cache budget.`);
    this.name = 'ViewCapacityError';
  }
}

type ViewState = 'cached' | 'taken' | 'disposed';
type ReleaseCause = 'released' | 'expired' | 'evicted';

export class ManagedPreparedView<T> implements PreparedView {
  private state: ViewState = 'cached';

  constructor(
    readonly taskId: string,
    readonly pageId: string,
    private readonly built: BuiltView<T>,
    private readonly onDispose: (view: ManagedPreparedView<T>, previous: ViewState, cause: ReleaseCause) => void,
  ) {}

  get resource(): T {
    if (this.state === 'disposed') throw new Error(`Prepared view '${this.taskId}' has been disposed.`);
    return this.built.resource;
  }

  get estimatedBytes(): number {
    return this.built.estimatedBytes;
  }

  get status(): ViewState {
    return this.state;
  }

  markTaken(): void {
    if (this.state === 'cached') this.state = 'taken';
  }

  dispose(): void {
    this.disposeWithCause('released');
  }

  disposeWithCause(cause: ReleaseCause): void {
    if (this.state === 'disposed') return;
    const previous = this.state;
    this.state = 'disposed';
    this.onDispose(this, previous, cause);
  }

  releaseBuilt(): void {
    this.built.dispose();
  }
}

interface PendingPreparation<T> {
  readonly request: PreloadRequest;
  readonly signal: { cancelled: boolean; reason: CancelReason | null };
  readonly promise: Promise<ManagedPreparedView<T>>;
}

interface CachedPreparation<T> {
  readonly view: ManagedPreparedView<T>;
  readonly priority: number;
  readonly createdAtMs: number;
  lastUsedAtMs: number;
}

const CANCEL_REASONS: readonly CancelReason[] = ['foreground-work', 'prediction-miss', 'memory-pressure', 'expired', 'disabled', 'cleared', 'session-ended', 'superseded'];

function checkReason(reason: CancelReason): void {
  if (!CANCEL_REASONS.includes(reason)) throw new TypeError(`Unknown view release reason: ${String(reason)}.`);
}

function checkRequest(request: PreloadRequest): void {
  if (request === null || typeof request !== 'object') throw new TypeError('A preload request is required.');
  checkIdentifier(request.taskId);
  checkIdentifier(request.pageId);
  if (typeof request.priority !== 'number' || !Number.isFinite(request.priority)) {
    throw new RangeError('Preload priority must be a finite number; larger values are retained first.');
  }
}

function checkBuiltView<T>(built: BuiltView<T>): void {
  if (built === null || typeof built !== 'object' || typeof built.dispose !== 'function') {
    throw new TypeError('The view builder must return a resource, estimatedBytes and dispose().');
  }
  if (!Number.isSafeInteger(built.estimatedBytes) || built.estimatedBytes < 1) {
    built.dispose();
    throw new RangeError('A built view estimatedBytes must be a positive safe integer.');
  }
}

/**
 * Owns cached and pending views. A taken view belongs exclusively to its caller.
 * Calls are serialized by the JavaScript event loop; builders may complete in any order.
 */
export class ResourceViewPreparer<T> implements ViewPreparer {
  private readonly pendingByTask = new Map<string, PendingPreparation<T>>();
  private readonly activeTaskByPage = new Map<string, string>();
  private readonly cachedByTask = new Map<string, CachedPreparation<T>>();
  private readonly maxPreparedViews: number;
  private readonly maxPreparedBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cachedBytes = 0;
  private releasedViews = 0;
  private lateResourcesDisposed = 0;
  private expiredViews = 0;
  private evictedViews = 0;

  constructor(private readonly builder: ViewBuilder<T>, options: ViewPreparerOptions = {}) {
    if (typeof builder !== 'function') throw new TypeError('A view builder function is required.');
    this.maxPreparedViews = options.maxPreparedViews ?? DEFAULT_VIEW_PREPARER_OPTIONS.maxPreparedViews;
    this.maxPreparedBytes = options.maxPreparedBytes ?? DEFAULT_VIEW_PREPARER_OPTIONS.maxPreparedBytes;
    this.ttlMs = options.ttlMs ?? DEFAULT_VIEW_PREPARER_OPTIONS.ttlMs;
    checkPositiveInteger(this.maxPreparedViews, 'maxPreparedViews');
    checkPositiveInteger(this.maxPreparedBytes, 'maxPreparedBytes');
    checkPositiveInteger(this.ttlMs, 'ttlMs');
    this.now = options.now ?? (() => Date.now());
    if (typeof this.now !== 'function') throw new TypeError('now must be a function.');
    this.readNow();
  }

  prepare(request: PreloadRequest): Promise<ManagedPreparedView<T>> {
    checkRequest(request);
    const existingPending = this.pendingByTask.get(request.taskId);
    if (existingPending !== undefined) {
      if (existingPending.request.pageId !== request.pageId) {
        throw new TypeError(`Task '${request.taskId}' is already preparing another page.`);
      }
      return existingPending.promise;
    }
    const existingCached = this.cachedByTask.get(request.taskId);
    if (existingCached !== undefined) {
      if (existingCached.view.pageId !== request.pageId) {
        throw new TypeError(`Task '${request.taskId}' is already caching another page.`);
      }
      existingCached.lastUsedAtMs = this.readNow();
      return Promise.resolve(existingCached.view);
    }

    const previousTask = this.activeTaskByPage.get(request.pageId);
    if (previousTask !== undefined && previousTask !== request.taskId) {
      this.cancel(previousTask, 'prediction-miss');
    }
    this.activeTaskByPage.set(request.pageId, request.taskId);

    let pending!: PendingPreparation<T>;
    const signal = { cancelled: false, reason: null as CancelReason | null };
    const promise = Promise.resolve().then(() => {
      if (signal.cancelled) throw new ViewPreparationCancelledError(request.taskId, request.pageId, signal.reason!);
      return this.builder(request, { signal });
    }).then(built => {
      checkBuiltView(built);
      if (signal.cancelled) {
        const cancellation = new ViewPreparationCancelledError(request.taskId, request.pageId, signal.reason!);
        this.lateResourcesDisposed += 1;
        try {
          built.dispose();
          this.releasedViews += 1;
        } catch (error) {
          throw new AggregateError([cancellation, error], 'A late view arrived but its resource release failed.');
        }
        throw cancellation;
      }
      if (built.estimatedBytes > this.maxPreparedBytes) {
        built.dispose();
        this.releasedViews += 1;
        throw new ViewCapacityError(request.taskId, built.estimatedBytes, this.maxPreparedBytes);
      }
      const createdAtMs = this.readNow();
      const view = new ManagedPreparedView<T>(request.taskId, request.pageId, built, (item, previous, cause) => {
        this.release(item, previous, cause);
      });
      this.cachedByTask.set(request.taskId, {
        view, priority: request.priority, createdAtMs, lastUsedAtMs: createdAtMs,
      });
      this.cachedBytes += built.estimatedBytes;
      this.removePending(pending);
      this.enforceCapacity(request.taskId);
      return view;
    }).catch(error => {
      this.removePending(pending);
      if (signal.cancelled && !(error instanceof ViewPreparationCancelledError) && !(error instanceof AggregateError)) {
        throw new ViewPreparationCancelledError(request.taskId, request.pageId, signal.reason!);
      }
      throw error;
    });
    pending = { request, signal, promise };
    this.pendingByTask.set(request.taskId, pending);
    return promise;
  }

  take(pageId: string): ManagedPreparedView<T> | undefined {
    checkIdentifier(pageId);
    const taskId = this.activeTaskByPage.get(pageId);
    if (taskId === undefined) return undefined;
    const entry = this.cachedByTask.get(taskId);
    if (entry === undefined) return undefined;
    if (this.readNow() - entry.createdAtMs >= this.ttlMs) {
      entry.view.disposeWithCause('expired');
      return undefined;
    }
    this.detach(entry);
    entry.view.markTaken();
    return entry.view;
  }

  cancel(taskId: string, reason: CancelReason): void {
    checkIdentifier(taskId);
    checkReason(reason);
    const pending = this.pendingByTask.get(taskId);
    if (pending !== undefined) {
      pending.signal.cancelled = true;
      pending.signal.reason = reason;
      if (this.activeTaskByPage.get(pending.request.pageId) === taskId) {
        this.activeTaskByPage.delete(pending.request.pageId);
      }
    }
    this.cachedByTask.get(taskId)?.view.dispose();
  }

  releaseExpired(): number {
    const now = this.readNow();
    let released = 0;
    for (const entry of [...this.cachedByTask.values()]) {
      if (now - entry.createdAtMs >= this.ttlMs) {
        entry.view.disposeWithCause('expired');
        released += 1;
      }
    }
    return released;
  }

  releaseAll(reason: CancelReason): void {
    checkReason(reason);
    const taskIds = new Set([...this.pendingByTask.keys(), ...this.cachedByTask.keys()]);
    const errors: unknown[] = [];
    for (const taskId of taskIds) {
      try {
        this.cancel(taskId, reason);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `Some views could not be released: ${reason}.`);
  }

  getStats(): {
    pendingViews: number;
    cachedViews: number;
    cachedBytes: number;
    releasedViews: number;
    lateResourcesDisposed: number;
    expiredViews: number;
    evictedViews: number;
  } {
    return {
      pendingViews: this.pendingByTask.size,
      cachedViews: this.cachedByTask.size,
      cachedBytes: this.cachedBytes,
      releasedViews: this.releasedViews,
      lateResourcesDisposed: this.lateResourcesDisposed,
      expiredViews: this.expiredViews,
      evictedViews: this.evictedViews,
    };
  }

  private readNow(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < 0) throw new RangeError('The view clock must be finite and nonnegative.');
    return value;
  }

  private removePending(pending: PendingPreparation<T>): void {
    if (this.pendingByTask.get(pending.request.taskId) !== pending) return;
    this.pendingByTask.delete(pending.request.taskId);
    if (this.cachedByTask.has(pending.request.taskId)) return;
    if (this.activeTaskByPage.get(pending.request.pageId) === pending.request.taskId) {
      this.activeTaskByPage.delete(pending.request.pageId);
    }
  }

  private detach(entry: CachedPreparation<T>): void {
    const current = this.cachedByTask.get(entry.view.taskId);
    if (current !== entry) return;
    this.cachedByTask.delete(entry.view.taskId);
    if (this.activeTaskByPage.get(entry.view.pageId) === entry.view.taskId) {
      this.activeTaskByPage.delete(entry.view.pageId);
    }
    this.cachedBytes -= entry.view.estimatedBytes;
  }

  private release(view: ManagedPreparedView<T>, previous: ViewState, cause: ReleaseCause): void {
    const entry = this.cachedByTask.get(view.taskId);
    if (entry?.view === view) {
      this.detach(entry);
      if (previous === 'cached' && cause === 'expired') this.expiredViews += 1;
      if (previous === 'cached' && cause === 'evicted') this.evictedViews += 1;
    }
    this.releasedViews += 1;
    view.releaseBuilt();
  }

  private enforceCapacity(newTaskId: string): void {
    while (this.cachedByTask.size > this.maxPreparedViews || this.cachedBytes > this.maxPreparedBytes) {
      const candidates = [...this.cachedByTask.values()].filter(entry => entry.view.taskId !== newTaskId);
      const victim = candidates.sort((left, right) => left.priority - right.priority
        || left.lastUsedAtMs - right.lastUsedAtMs
        || (left.view.taskId < right.view.taskId ? -1 : 1))[0];
      if (victim === undefined) {
        const entry = this.cachedByTask.get(newTaskId);
        entry?.view.disposeWithCause('evicted');
        throw new ViewCapacityError(newTaskId, entry?.view.estimatedBytes ?? 0, this.maxPreparedBytes);
      }
      victim.view.disposeWithCause('evicted');
    }
  }
}
