import { JsonlMeasurementSink, MemoryMeasurementWriter, summarizeMeasurements } from '../core/measurement/index';
import type { MeasurementBoundary, MeasurementRecord } from '../core/measurement/types';

/** E records this static-data demonstration in memory; render completion is not instrumented. */
class DemoMeasurements {
  private writer: MemoryMeasurementWriter = new MemoryMeasurementWriter();
  private sink: JsonlMeasurementSink = new JsonlMeasurementSink(this.writer, { defaultDataKind: 'synthetic' });
  private sequence: number = 0;

  reset(): void {
    this.sink.close();
    this.writer = new MemoryMeasurementWriter();
    this.sink = new JsonlMeasurementSink(this.writer, { defaultDataKind: 'synthetic' });
    this.sequence = 0;
  }

  record(pageId: string, clickedAtMs: number, stateUpdatedAtMs: number, predictedPages: string[],
    viewReused: boolean, prefetchedBytes: number, wastedBytes: number,
    boundary: MeasurementBoundary): void {
    const record: MeasurementRecord = {
      schemaVersion: 1,
      interactionId: `demo-${++this.sequence}`,
      pageId,
      actualPage: pageId,
      clickedAtMs,
      visibleAtMs: Math.max(clickedAtMs, stateUpdatedAtMs),
      optimized: true,
      predictionHit: predictedPages.includes(pageId),
      coldStart: predictedPages.length === 0,
      boundary,
      predictedPages,
      viewReused,
      prefetchedBytes,
      wastedBytes,
      dataKind: 'synthetic',
    };
    this.sink.record(record);
  }

  summary(): string {
    const metrics = summarizeMeasurements(this.writer.records());
    return `演示记录 ${metrics.interactions} 次 · 候选命中 ${metrics.hits} 次 · 模型复用 ${metrics.viewReusedInteractions} 次 · 估算预取 ${metrics.prefetchedBytes} B / 未复用 ${metrics.wastedBytes} B`;
  }

  lines(): string[] {
    return this.writer.text.trim().split('\n').filter(line => line.length > 0).slice(-3);
  }
}

export const demoMeasurements = new DemoMeasurements();
