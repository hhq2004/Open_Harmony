import { systemDateTime } from '@kit.BasicServicesKit';
import { DataPreloadScheduler, PredictionPreloadController } from '../core/preload/index';
import type { DataFetcher, DataRequest, FetchOperation, PreloadedData, SchedulerRuntime } from '../core/preload/index';
import type { DataViewPreparer } from '../core/preload/index';
import type { CancelReason, PreparedView, PreloadRequest } from '../core/contracts';
import { ResourceViewPreparer } from '../core/preparation/index';
import type { ManagedPreparedView } from '../core/preparation/index';

export interface DemoPageData {
  readonly pageId: string;
  readonly text: string;
}

export function demoPageText(pageId: string): string {
  if (pageId === 'home') return '首页静态内容';
  if (pageId === 'detail') return '详情页静态内容';
  if (pageId === 'cart') return '清单页静态内容';
  return '个人页静态内容';
}

class DemoFetcher implements DataFetcher<DemoPageData> {
  start(request: DataRequest): FetchOperation<DemoPageData> {
    const data: PreloadedData<DemoPageData> = {
      value: { pageId: request.pageId, text: demoPageText(request.pageId) },
      byteLength: 64,
      dispose(): void {},
    };
    return {
      result: Promise.resolve(data),
      cancel(): void {},
    };
  }
}

class DemoRuntime implements SchedulerRuntime {
  now(): number {
    return systemDateTime.getUptime(systemDateTime.TimeType.STARTUP);
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  }
}

interface DemoPreparedViewModel {
  readonly text: string;
}

interface DemoViewStats {
  readonly releasedViews: number;
  readonly lateResourcesDisposed: number;
}

/** D's resource manager prepares a render model; ArkUI still creates its native Text node on render. */
class DemoViewPreparer implements DataViewPreparer<DemoPageData> {
  private readonly dataByTask = new Map<string, PreloadedData<DemoPageData>>();
  private readonly manager = new ResourceViewPreparer<DemoPreparedViewModel>((request: PreloadRequest) => {
    const data = this.dataByTask.get(request.taskId);
    if (data === undefined) throw new Error('Prepared data is unavailable.');
    return { resource: { text: data.value.text }, estimatedBytes: 64, dispose(): void {} };
  }, { maxPreparedViews: 4, maxPreparedBytes: 4096, ttlMs: 5000,
    now: () => systemDateTime.getUptime(systemDateTime.TimeType.STARTUP) });

  async prepare(request: DataRequest, data: PreloadedData<DemoPageData>): Promise<PreparedView> {
    this.dataByTask.set(request.taskId, data);
    try {
      await this.manager.prepare(request);
      const taken = this.manager.take(request.pageId);
      if (taken === undefined) throw new Error('Prepared view was released before transfer.');
      return taken;
    } finally {
      this.dataByTask.delete(request.taskId);
    }
  }

  cancel(taskId: string, reason: CancelReason | 'timeout'): void {
    this.manager.cancel(taskId, reason === 'timeout' ? 'expired' : reason);
  }

  stats(): DemoViewStats {
    return this.manager.getStats();
  }
}

export const demoViewPreparer = new DemoViewPreparer();

export function demoPreparedText(view: PreparedView): string {
  return (view as ManagedPreparedView<DemoPreparedViewModel>).resource.text;
}

/** Static, in-memory demo data only. This is not a network or ArkUI view adapter. */
export const demoScheduler = new DataPreloadScheduler<DemoPageData>(new DemoFetcher(), new DemoRuntime(), {
  maxTasks: 4, maxBytes: 4096, ttlMs: 5000,
}, demoViewPreparer);
export const demoController = new PredictionPreloadController<DemoPageData>(demoScheduler);
