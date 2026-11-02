/** Logical integration contracts. These are not OpenHarmony system API declarations. */
export interface VisitEvent {
  readonly sessionId: string;
  readonly pageId: string;
  /** Monotonic milliseconds within this session; never compare across sessions. */
  readonly monotonicMs: number;
}

export interface Prediction {
  readonly pageId: string;
  /** Empirical conditional frequency, not a calibrated confidence guarantee. */
  readonly probability: number;
}

export interface PathPredictor {
  observe(fromPage: string, toPage: string): void;
  predict(fromPage: string, limit?: number): readonly Prediction[];
  clear(): void;
}

export interface VisitCollector {
  setEnabled(enabled: boolean): void;
  record(event: VisitEvent): void;
  clear(): void;
}

export type CancelReason = 'foreground-work' | 'prediction-miss' | 'memory-pressure' | 'expired';

export interface PreloadRequest {
  readonly taskId: string;
  readonly pageId: string;
  readonly priority: number;
}

export interface PreloadScheduler {
  enqueue(request: PreloadRequest): void;
  cancel(taskId: string, reason: CancelReason): void;
}

export interface PreparedView {
  readonly taskId: string;
  readonly pageId: string;
  /** Idempotent release, including a resource produced after cancellation. */
  dispose(): void;
}

export interface ViewPreparer {
  prepare(request: PreloadRequest): Promise<PreparedView>;
  /** Transfers ownership to the caller; undefined means there is no reusable view. */
  take(pageId: string): PreparedView | undefined;
  releaseAll(reason: CancelReason): void;
}

export interface InteractionMeasurement {
  readonly interactionId: string;
  readonly pageId: string;
  readonly clickedAtMs: number;
  readonly visibleAtMs: number;
  readonly optimized: boolean;
  readonly predictionHit: boolean;
}

export interface MeasurementSink {
  record(measurement: InteractionMeasurement): void;
}
