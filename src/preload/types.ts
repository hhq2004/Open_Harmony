import type { CancelReason, PreloadRequest, PreparedView } from '../contracts.js';

export interface DataRequest extends PreloadRequest {
  readonly dataKey: string;
  readonly sessionId: string;
}

/** A resource lease. The receiver must eventually dispose it; no payloads belong in logs. */
export interface PreloadedData<T> {
  readonly value: T;
  readonly byteLength: number;
  dispose(): void;
}

export interface FetchOperation<T> {
  readonly result: Promise<PreloadedData<T>>;
  /** Best effort. result MUST eventually settle, even after cancellation. */
  cancel(reason: CancelReason | 'timeout'): void;
}

export interface DataFetcher<T> {
  /** Must return promptly; expensive synchronous work is not allowed on the UI thread. */
  start(request: DataRequest): FetchOperation<T>;
}

/** Supplied by D. A cancellation may race prepare; any late view is disposed by C. */
export interface DataViewPreparer<T> {
  /** Borrows data until settlement. Do not publish the view into a separate take() cache. */
  prepare(request: DataRequest, data: PreloadedData<T>): Promise<PreparedView>;
  cancel(taskId: string, reason: CancelReason | 'timeout'): void;
}

export interface SchedulerRuntime {
  /** One process-wide monotonic clock, unrelated to VisitEvent's per-session clock. */
  now(): number;
  /** Schedule once; return an idempotent cancellation function. Never invoke inline. */
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface PreloadEnvironment {
  readonly idle: boolean;
  readonly foregroundBusy: boolean;
  readonly memoryPressure: boolean;
}

export interface SchedulerOptions {
  readonly timeoutMs?: number;
  /** Total lifetime starting at enqueue, including time spent queued/preparing. */
  readonly ttlMs?: number;
  readonly maxTasks?: number;
  readonly maxBytes?: number;
  readonly historyLimit?: number;
}

export type TaskState = 'queued' | 'running' | 'data-ready' | 'consumed' | 'cancelled' | 'failed';
export type FailureCode = 'fetch' | 'invalid-data' | 'prepare' | 'timeout' | 'budget' | 'capacity';

export interface TaskSnapshot {
  readonly request: DataRequest;
  readonly state: TaskState;
  readonly enqueuedAtMs: number;
  readonly updatedAtMs: number;
  readonly expiresAtMs: number;
  readonly preparingView: boolean;
  readonly viewReady: boolean;
  readonly byteLength: number;
  readonly cancelReason: CancelReason | null;
  readonly failure: FailureCode | null;
}

/** take() transfers BOTH leases to the foreground. Cancellation cannot reclaim them. */
export interface PreparedPreload<T> {
  readonly request: DataRequest;
  readonly data: PreloadedData<T>;
  readonly view: PreparedView | undefined;
  dispose(): void;
}
