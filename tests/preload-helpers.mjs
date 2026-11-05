import { DataPreloadScheduler } from '../dist/preload/index.js';

export const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export class ManualRuntime {
  time = 0;
  timers = new Set();
  now() { return this.time; }
  schedule(callback, delay) {
    const timer = { at: this.time + delay, callback };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  }
  advance(ms, dispatch = true) {
    this.time += ms;
    if (!dispatch) return;
    for (;;) {
      const timer = [...this.timers].filter(item => item.at <= this.time).sort((a, b) => a.at - b.at)[0];
      if (!timer) return;
      this.timers.delete(timer);
      timer.callback();
    }
  }
}

export function lease(value = { id: 'one' }, byteLength = 4) {
  let disposals = 0;
  return { value, byteLength, dispose() { disposals++; }, get disposals() { return disposals; } };
}

export function setup(options = {}, preparer) {
  const runtime = new ManualRuntime();
  const operations = [];
  const fetcher = {
    start(request) {
      const pending = deferred();
      const operation = { request, ...pending, cancellations: [], cancel(reason) { this.cancellations.push(reason); } };
      operations.push(operation);
      return { result: pending.promise, cancel: reason => operation.cancel(reason) };
    },
  };
  const scheduler = new DataPreloadScheduler(fetcher, runtime, options, preparer);
  const events = [];
  scheduler.subscribe(event => events.push(event));
  scheduler.setEnabled(true);
  const idle = () => scheduler.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false });
  return { scheduler, runtime, operations, events, idle };
}

export const request = (taskId, extra = {}) => ({ taskId, pageId: 'detail', dataKey: taskId, sessionId: 's', priority: 1, ...extra });
