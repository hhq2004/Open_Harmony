import type { InteractionMeasurement } from '../contracts.js';

/** Provenance classes are deliberately explicit so synthetic data cannot masquerade as device data. */
export type MeasurementDataKind = 'synthetic' | 'host-observed' | 'device';

export type MeasurementScope = 'host' | 'device';

export type MeasurementBoundary = 'first-visit' | 'consecutive' | 'gap' | 'unknown';

/**
 * One completed click-to-page interaction. The inherited fields are the shared
 * MeasurementSink contract; the remaining fields are the E-module extension that
 * can be supplied by A without changing src/contracts.ts yet.
 */
export interface MeasurementRecord extends InteractionMeasurement {
  readonly schemaVersion: 1;
  /** Opaque anonymous session alias; never a user or account identifier. */
  readonly sessionId?: string;
  /** Monotonic timestamp at which the page became interactive, if the platform can report it. */
  readonly interactiveAtMs?: number;
  /** True when this interaction is the first visit of a session. */
  readonly coldStart: boolean;
  readonly boundary: MeasurementBoundary;
  /** Candidates issued after the previous visit, not a future-derived prediction. */
  readonly predictedPages: readonly string[];
  readonly actualPage: string;
  readonly preloadTaskId?: string;
  readonly viewReused: boolean;
  readonly prefetchedBytes: number;
  readonly wastedBytes: number;
  readonly dataKind: MeasurementDataKind;
}

/** Nearest-rank summary. p50/p95 are order statistics, not interpolated device percentiles. */
export interface DurationStats {
  readonly count: number;
  readonly minMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
}

export interface InteractionGroup {
  readonly interactions: number;
  readonly hits: number;
  readonly clickToVisible: DurationStats | null;
  readonly clickToInteractive: DurationStats | null;
}

export interface MeasurementMetrics {
  readonly schemaVersion: 1;
  /** Every recorded interaction is one opportunity, including first visits and gaps. */
  readonly opportunities: number;
  readonly interactions: number;
  readonly predictionsMade: number;
  readonly hits: number;
  readonly misses: number;
  readonly coldStartOpportunities: number;
  readonly coverage: number | null;
  readonly hitRateAll: number | null;
  readonly hitRateWhenPredicted: number | null;
  readonly missRate: number | null;
  readonly coldStartShare: number | null;
  readonly clickToVisible: DurationStats | null;
  readonly clickToInteractive: DurationStats | null;
  readonly byOptimized: {
    readonly optimized: InteractionGroup;
    readonly unoptimized: InteractionGroup;
  };
  readonly byPrediction: {
    readonly hit: InteractionGroup;
    readonly miss: InteractionGroup;
    readonly noPrediction: InteractionGroup;
  };
  readonly prefetchedBytes: number;
  readonly wastedBytes: number;
  readonly wastedByteRatio: number | null;
  readonly viewReusedInteractions: number;
  /** Denominator is optimized interactions, not all interactions. */
  readonly viewReuseRate: number | null;
}

export interface MeasurementProvenance {
  readonly gitCommit?: string | null;
  readonly gitDirty?: boolean | null;
  readonly sourceSha256?: Readonly<Record<string, string>>;
  readonly node?: string;
  readonly platform?: string;
  readonly arch?: string;
}

export interface MeasurementReport {
  readonly schemaVersion: 1;
  readonly scope: MeasurementScope;
  readonly dataKind: MeasurementDataKind;
  readonly deviceValidation: 'not-run' | 'run';
  readonly timingSource: string;
  readonly generatedAtUtc: string;
  readonly command: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly provenance: MeasurementProvenance;
  readonly metrics: MeasurementMetrics;
  readonly notes: readonly string[];
}
