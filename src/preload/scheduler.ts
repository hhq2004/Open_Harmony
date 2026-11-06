import type { CancelReason, PreloadRequest, PreloadScheduler, PreparedView } from '../contracts.js';
import type {
  DataFetcher, DataRequest, DataViewPreparer, FailureCode, FetchOperation, PreloadedData,
  PreparedPreload, PreloadEnvironment, SchedulerOptions, SchedulerRuntime, TaskSnapshot, TaskState,
} from './types.js';

/** Host development defaults, not device budgets or course acceptance thresholds. */
export const DEFAULT_SCHEDULER_OPTIONS = Object.freeze({
  timeoutMs: 3000, ttlMs: 5000, maxTasks: 8, maxBytes: 8 * 1024 * 1024, historyLimit: 128,
});

interface Task {
  readonly request: DataRequest;
  readonly enqueuedAtMs: number;
  readonly expiresAtMs: number;
  state: TaskState;
  updatedAtMs: number;
  preparingView: boolean;
  cancelReason: CancelReason | null;
  failure: FailureCode | null;
  data: PreloadedData<unknown> | undefined;
  view: PreparedView | undefined;
  bytes: number;
  operation: FetchOperation<unknown> | undefined;
  expiryTimer: (() => void) | undefined;
  timeoutTimer: (() => void) | undefined;
  timeoutAtMs: number;
  publishedState: TaskState | undefined;
  retainHistory: boolean;
}

const reasons: readonly CancelReason[] = [
  'foreground-work', 'prediction-miss', 'memory-pressure', 'expired',
  'disabled', 'cleared', 'session-ended', 'superseded',
];
const live = (task: Task) => ['queued', 'running', 'data-ready'].includes(task.state);
function identifier(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new TypeError('Use an opaque nonempty identifier of at most 128 code units.');
  }
}

/** Single physical operation, bounded leases/history, explicit platform idle input. */
export class DataPreloadScheduler<T> implements PreloadScheduler {
  readonly options: Readonly<Required<SchedulerOptions>>;
  private readonly tasks = new Map<string, Task>();
  private readonly history = new Map<string, TaskSnapshot>();
  private readonly listeners = new Set<(snapshot: TaskSnapshot) => void>();
  private readonly notifications: TaskSnapshot[] = [];
  private notifying = false;
  private environment: PreloadEnvironment = Object.freeze({ idle: false, foregroundBusy: false, memoryPressure: false });
  private enabled = false;
  private slot: Task | undefined;
  private heldBytes = 0;
  private lastNow = 0;
  private cleanupErrors = 0;
  private observerErrors = 0;
  private cancelErrors = 0;
  private pumping = false;
  private clearing = false;
  private readonly counts: Record<TaskState, number> = {
    queued: 0, running: 0, 'data-ready': 0, consumed: 0, cancelled: 0, failed: 0,
  };

  constructor(
    private readonly fetcher: DataFetcher<T>,
    private readonly runtime: SchedulerRuntime,
    options: SchedulerOptions = {},
    private readonly preparer?: DataViewPreparer<T>,
  ) {
    for (const key of Object.keys(options)) {
      if (!Object.hasOwn(DEFAULT_SCHEDULER_OPTIONS, key)) throw new TypeError('Unknown scheduler option.');
    }
    this.options = Object.freeze({ ...DEFAULT_SCHEDULER_OPTIONS, ...options });
    for (const value of Object.values(this.options)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Scheduler limits must be positive safe integers.');
    }
    if (this.options.timeoutMs > 2147483647 || this.options.ttlMs > 2147483647) {
      throw new RangeError('Timer duration exceeds portable timer range.');
    }
  }

  setEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
    this.enabled = enabled;
    if (!enabled) this.cancelAll('disabled');
    this.pump();
  }

  setEnvironment(environment: PreloadEnvironment): void {
    if (!environment || [environment.idle, environment.foregroundBusy, environment.memoryPressure]
      .some(value => typeof value !== 'boolean')) throw new TypeError('Provide all environment flags.');
    this.environment = Object.freeze({
      idle: environment.idle, foregroundBusy: environment.foregroundBusy, memoryPressure: environment.memoryPressure,
    });
    if (environment.memoryPressure) this.cancelAll('memory-pressure');
    else if (environment.foregroundBusy || !environment.idle) {
      // Idle becoming false stops speculative work too; ready data may remain within its TTL.
      for (const task of [...this.tasks.values()]) {
        if (task === this.slot && live(task)) this.cancel(task.request.taskId, 'foreground-work');
      }
    }
    this.pump();
  }

  enqueue(request: PreloadRequest): void {
    const normalized = this.normalize(request);
    const existing = this.tasks.get(normalized.taskId)?.request ?? this.history.get(normalized.taskId)?.request;
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(normalized)) return;
      throw new TypeError('taskId already identifies a different request.');
    }
    const now = this.now();
    const task: Task = {
      request: normalized, enqueuedAtMs: now, expiresAtMs: now + this.options.ttlMs,
      updatedAtMs: now, state: 'queued', preparingView: false, cancelReason: null, failure: null,
      data: undefined, view: undefined, bytes: 0, operation: undefined, expiryTimer: undefined, timeoutTimer: undefined,
      timeoutAtMs: Infinity, publishedState: undefined,
      retainHistory: true,
    };
    if (this.clearing || !this.enabled || this.environment.memoryPressure) {
      task.state = 'cancelled';
      task.cancelReason = this.clearing ? 'cleared' : !this.enabled ? 'disabled' : 'memory-pressure';
      task.retainHistory = !this.clearing;
      this.remember(task);
      this.publish(task);
      return;
    }
    const duplicate = [...this.tasks.values()].some(other => live(other)
      && other.request.sessionId === normalized.sessionId
      && other.request.pageId === normalized.pageId && other.request.dataKey === normalized.dataKey);
    if (duplicate) {
      task.state = 'cancelled'; task.cancelReason = 'superseded';
      this.remember(task); this.publish(task); return;
    }
    // Include cancelled-but-unsettled operations in capacity accounting.
    if (this.tasks.size >= this.options.maxTasks) {
      task.state = 'failed'; task.failure = 'capacity';
      this.remember(task); this.publish(task); return;
    }
    this.tasks.set(normalized.taskId, task);
    task.expiryTimer = this.runtime.schedule(() => {
      if (this.tasks.get(normalized.taskId) === task) this.cancel(normalized.taskId, 'expired');
    }, this.options.ttlMs);
    this.publish(task);
    this.pump();
  }

  cancel(taskId: string, reason: CancelReason): void {
    if (!reasons.includes(reason)) throw new TypeError('Unknown cancellation reason.');
    const task = this.tasks.get(taskId);
    if (!task || !live(task)) return;
    task.cancelReason = reason;
    this.terminate(task, 'cancelled');
    this.stop(task, reason);
    this.pump();
  }

  cancelAll(reason: CancelReason): void {
    // Suppress pump during batch invalidation, including cancellation reentrancy.
    const previous = this.pumping;
    this.pumping = true;
    try { for (const task of [...this.tasks.values()]) this.cancel(task.request.taskId, reason); }
    finally { this.pumping = previous; }
    this.pump();
  }

  endSession(sessionId: string): void {
    identifier(sessionId);
    const previous = this.pumping;
    this.pumping = true;
    try {
      for (const task of [...this.tasks.values()]) {
        if (task.request.sessionId === sessionId) this.cancel(task.request.taskId, 'session-ended');
      }
    } finally { this.pumping = previous; }
    this.pump();
  }

  clear(): void {
    this.clearing = true;
    try {
      for (const task of this.tasks.values()) task.retainHistory = false;
      this.cancelAll('cleared');
      this.history.clear();
    } finally { this.clearing = false; }
  }

  /** undefined means the foreground must load normally; it never waits for speculation. */
  take(taskId: string): PreparedPreload<T> | undefined {
    const task = this.tasks.get(taskId);
    if (!task || task.state !== 'data-ready' || task.preparingView) return undefined;
    if (this.now() >= task.expiresAtMs) { this.cancel(taskId, 'expired'); return undefined; }
    if (!task.data) return undefined;
    const data = task.data as PreloadedData<T>;
    const view = task.view;
    task.data = undefined; task.view = undefined;
    this.heldBytes -= task.bytes; task.bytes = 0;
    this.terminate(task, 'consumed');
    let disposed = false;
    return Object.freeze({
      request: task.request, data, view,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.cleanup(() => view?.dispose());
        this.cleanup(() => data.dispose());
      },
    });
  }

  getTask(taskId: string): TaskSnapshot | undefined {
    const task = this.tasks.get(taskId);
    return task ? this.snapshot(task) : this.history.get(taskId);
  }

  subscribe(listener: (snapshot: TaskSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getStats() {
    return Object.freeze({
      enabled: this.enabled, environment: this.environment, physicalBusy: this.slot !== undefined,
      retainedTasks: this.tasks.size, activeTasks: [...this.tasks.values()].filter(live).length,
      heldBytes: this.heldBytes, historySize: this.history.size,
      cleanupErrors: this.cleanupErrors, observerErrors: this.observerErrors, cancelErrors: this.cancelErrors,
      transitions: Object.freeze({ ...this.counts }),
    });
  }

  private normalize(request: PreloadRequest): DataRequest {
    identifier(request.taskId); identifier(request.pageId);
    const sessionId = request.sessionId ?? 'default';
    const dataKey = request.dataKey ?? request.pageId;
    identifier(sessionId); identifier(dataKey);
    if (!Number.isFinite(request.priority)) throw new TypeError('priority must be finite.');
    return Object.freeze({ taskId: request.taskId, pageId: request.pageId, priority: request.priority, sessionId, dataKey });
  }

  private now(): number {
    const time = this.runtime.now();
    if (!Number.isFinite(time) || time < this.lastNow) throw new RangeError('Runtime clock must be monotonic.');
    this.lastNow = time;
    return time;
  }

  private pump(): void {
    if (this.pumping || this.slot || !this.enabled || !this.environment.idle
      || this.environment.foregroundBusy || this.environment.memoryPressure) return;
    this.pumping = true;
    try {
      // Map insertion order is the FIFO tie breaker; never reorder using session clocks.
      for (;;) {
        if (!this.enabled || !this.environment.idle || this.environment.foregroundBusy || this.environment.memoryPressure) break;
        const task = [...this.tasks.values()].filter(item => item.state === 'queued')
          .sort((a, b) => b.request.priority - a.request.priority)[0];
        if (!task) break;
        // Expiry callbacks may enqueue higher-priority work; arbitrate again after each cancellation.
        if (this.now() >= task.expiresAtMs) { this.cancel(task.request.taskId, 'expired'); continue; }
        this.slot = task;
        task.state = 'running'; task.updatedAtMs = this.now();
        task.timeoutAtMs = task.updatedAtMs + this.options.timeoutMs;
        task.timeoutTimer = this.runtime.schedule(() => {
          if (!live(task)) return;
          task.failure = 'timeout'; this.terminate(task, 'failed'); this.stop(task, 'timeout');
        }, this.options.timeoutMs);
        this.publish(task);
        // Defer adapters so a synchronous start() failure can still drain the next task.
        void Promise.resolve().then(() => this.execute(task));
        break;
      }
    } finally { this.pumping = false; }
  }

  private async execute(task: Task): Promise<void> {
    let stage: FailureCode = 'fetch';
    try {
      if (!this.valid(task)) return; // A running-state observer may have cancelled synchronously.
      const operation = this.fetcher.start(task.request);
      task.operation = operation as FetchOperation<unknown>;
      // start() may reenter the scheduler before returning its cancellation handle.
      if (!live(task)) this.stop(task, task.cancelReason ?? 'timeout');
      const data = await operation.result;
      stage = 'invalid-data';
      if (!data || typeof data.dispose !== 'function') throw new TypeError('Invalid data lease.');
      task.data = data;
      if (!this.valid(task)) return;
      if (!Number.isSafeInteger(data.byteLength) || data.byteLength < 0) throw new TypeError('Invalid byte length.');
      // Reading value is also the adapter's validation boundary (e.g. disposed data must reject).
      void data.value;
      if (!this.makeRoom(task, data.byteLength)) {
        task.failure = 'budget'; this.terminate(task, 'failed'); return;
      }
      // Eviction observers are allowed to cancel the incoming task.
      if (!this.valid(task)) return;
      task.bytes = data.byteLength; this.heldBytes += task.bytes;
      task.state = 'data-ready'; task.preparingView = this.preparer !== undefined;
      task.updatedAtMs = this.now(); this.publish(task);
      if (!this.valid(task)) return;
      if (this.preparer) {
        stage = 'prepare';
        const view = await this.preparer.prepare(task.request, data as PreloadedData<T>);
        task.view = view;
        if (!view || typeof view.dispose !== 'function'
          || view.taskId !== task.request.taskId || view.pageId !== task.request.pageId) {
          throw new TypeError('Invalid prepared view.');
        }
        if (!this.valid(task)) return;
        task.preparingView = false; task.updatedAtMs = this.now(); this.publish(task);
      }
    } catch {
      if (live(task)) { task.failure = stage; this.terminate(task, 'failed'); }
    } finally {
      task.operation = undefined;
      task.preparingView = false;
      task.timeoutTimer?.(); task.timeoutTimer = undefined;
      if (!live(task)) { this.release(task); this.tasks.delete(task.request.taskId); this.remember(task); }
      this.slot = undefined;
      this.pump();
    }
  }

  private makeRoom(incoming: Task, bytes: number): boolean {
    if (bytes > this.options.maxBytes) return false;
    for (const task of [...this.tasks.values()]) {
      if (this.heldBytes + bytes <= this.options.maxBytes) return true;
      if (task !== incoming && task.state === 'data-ready' && !task.preparingView) {
        this.cancel(task.request.taskId, 'memory-pressure');
      }
    }
    return this.heldBytes + bytes <= this.options.maxBytes;
  }

  private valid(task: Task): boolean {
    if (!live(task)) return false;
    const now = this.now();
    if (now >= task.expiresAtMs) { this.cancel(task.request.taskId, 'expired'); return false; }
    if (now >= task.timeoutAtMs) {
      task.failure = 'timeout'; this.terminate(task, 'failed'); this.stop(task, 'timeout'); return false;
    }
    return true;
  }

  private terminate(task: Task, state: 'consumed' | 'cancelled' | 'failed'): void {
    task.state = state; task.updatedAtMs = this.now();
    task.expiryTimer?.(); task.expiryTimer = undefined;
    task.timeoutTimer?.(); task.timeoutTimer = undefined;
    // An in-flight preparer borrows data until settlement. Keep the slot and lease alive.
    if (task !== this.slot) { this.release(task); this.tasks.delete(task.request.taskId); }
    this.remember(task);
    this.publish(task);
  }

  private stop(task: Task, reason: CancelReason | 'timeout'): void {
    try { task.operation?.cancel(reason); } catch { this.cancelErrors++; }
    if (task.preparingView) {
      try { this.preparer?.cancel(task.request.taskId, reason); } catch { this.cancelErrors++; }
    }
  }

  private release(task: Task): void {
    const view = task.view, data = task.data;
    task.view = undefined; task.data = undefined;
    this.heldBytes -= task.bytes; task.bytes = 0;
    this.cleanup(() => view?.dispose()); this.cleanup(() => data?.dispose());
  }

  private cleanup(callback: () => void): void {
    try { callback(); } catch { this.cleanupErrors++; }
  }

  private snapshot(task: Task): TaskSnapshot {
    return Object.freeze({
      request: task.request, state: task.state, enqueuedAtMs: task.enqueuedAtMs,
      updatedAtMs: task.updatedAtMs, expiresAtMs: task.expiresAtMs,
      preparingView: task.preparingView, viewReady: task.view !== undefined, byteLength: task.bytes,
      cancelReason: task.cancelReason, failure: task.failure,
    });
  }

  private remember(task: Task): void {
    if (!task.retainHistory) return;
    this.history.set(task.request.taskId, this.snapshot(task));
    while (this.history.size > this.options.historyLimit) {
      const oldest = this.history.keys().next().value;
      if (oldest !== undefined) this.history.delete(oldest);
    }
  }

  private publish(task: Task): void {
    const snapshot = this.snapshot(task);
    if (task.publishedState !== task.state) {
      this.counts[task.state]++;
      task.publishedState = task.state;
    }
    this.notifications.push(snapshot);
    if (this.notifying) return;
    this.notifying = true;
    try {
      // Deliver a transition to every observer before transitions caused by their callbacks.
      // State changes are immediate; notifications remain FIFO even under synchronous reentrancy.
      for (let index = 0; index < this.notifications.length; index++) {
        const notification = this.notifications[index]!;
        for (const listener of [...this.listeners]) {
          try { listener(notification); } catch { this.observerErrors++; }
        }
      }
    } finally { this.notifications.length = 0; this.notifying = false; }
  }
}
