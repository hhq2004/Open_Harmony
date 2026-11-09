import { systemDateTime } from '@kit.BasicServicesKit';
import { DataPreloadScheduler, PredictionPreloadController } from '../core/preload/index';
import type { DataFetcher, DataRequest, FetchOperation, PreloadedData, SchedulerRuntime } from '../core/preload/index';

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

/** Static, in-memory demo data only. This is not a network or ArkUI view adapter. */
export const demoScheduler = new DataPreloadScheduler<DemoPageData>(new DemoFetcher(), new DemoRuntime(), {
  maxTasks: 4, maxBytes: 4096, ttlMs: 5000,
});
export const demoController = new PredictionPreloadController<DemoPageData>(demoScheduler);
