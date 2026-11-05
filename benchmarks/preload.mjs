import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataPreloadScheduler, PredictionPreloadController } from '../dist/preload/index.js';
import { createPredictionEngine } from '../dist/prediction/index.js';
import { NodeHttpDataFetcher } from '../adapters/node-http-fetcher.mjs';
import { nodeRuntime } from '../adapters/node-runtime.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Bounded wait for host I/O completion, never a latency benchmark. */
export async function waitFor(predicate) {
  const deadline = performance.now() + 5000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('Host scenario did not settle.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

export async function runPreloadScenario() {
  const received = [];
  const server = createServer((request, response) => {
    received.push({ route: request.url, event: 'received' });
    if (request.url === '/slow') {
      request.on('aborted', () => received.push({ route: '/slow', event: 'aborted' }));
      // Deliberately pending until client aborts. No timer or synthetic successful response.
      return;
    }
    response.writeHead(request.url === '/fail' ? 503 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ id: 'item-1', title: 'Host fixture' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const routes = Object.freeze({ 'item-1': '/ok', fail: '/fail', slow: '/slow' });
  const fetcher = new NodeHttpDataFetcher({
    resolveUrl(request) {
      const route = Object.hasOwn(routes, request.dataKey) ? routes[request.dataKey] : undefined;
      if (!route) throw new Error('Unknown data alias.');
      return base + route;
    },
    validate: value => value?.id === 'item-1' && typeof value.title === 'string',
  });
  const scheduler = new DataPreloadScheduler(fetcher, nodeRuntime);
  const controller = new PredictionPreloadController(scheduler);
  const trace = [];
  const stop = scheduler.subscribe(snapshot => trace.push(snapshot));
  const bundle = { current: undefined };
  try {
    controller.setEnabled(true);
    const { session } = createPredictionEngine(['list', 'detail']);
    session.setEnabled(true);
    session.accept({ sessionId: 'training', pageId: 'list', monotonicMs: 0 });
    session.accept({ sessionId: 'training', pageId: 'detail', monotonicMs: 1 });
    const decision = session.acceptDetailed({ sessionId: 'live', pageId: 'list', monotonicMs: 0 });
    // Manually supplied host idle flag; not a measured system/UI idle window.
    scheduler.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false });
    controller.visit('live', { pageId: 'list', dataKey: 'list' }, decision.candidates.map((p, i) => ({
      pageId: p.pageId, dataKey: 'item-1', priority: -i,
    })));
    await waitFor(() => scheduler.getTask('prediction-1')?.state === 'data-ready');
    bundle.current = controller.visit('live', { pageId: 'detail', dataKey: 'item-1' }, []);
    assert.equal(bundle.current?.data.value.id, 'item-1');
    bundle.current.dispose();
    scheduler.enqueue({ taskId: 'cancel', pageId: 'detail', sessionId: 'live', dataKey: 'slow', priority: 1 });
    await waitFor(() => received.some(event => event.route === '/slow'));
    scheduler.cancel('cancel', 'foreground-work');
    await waitFor(() => !scheduler.getStats().physicalBusy && received.some(event => event.event === 'aborted'));
    scheduler.enqueue({ taskId: 'failure', pageId: 'detail', sessionId: 'live', dataKey: 'fail', priority: 1 });
    await waitFor(() => scheduler.getTask('failure')?.state === 'failed' && !scheduler.getStats().physicalBusy);
    assert.equal(scheduler.getTask('failure')?.failure, 'fetch');
    assert.equal(scheduler.getStats().heldBytes, 0);
    return {
      schemaVersion: 1, scope: 'host-http-functional', dataKind: 'synthetic',
      openHarmonyPerformanceMeasured: false, realViewReuseMeasured: false,
      idleSignal: 'manually-supplied-host-flag', profile: scheduler.options,
      checks: { prefetchedDataConsumed: true, transportAbortObserved: true, failureHandled: true, heldBytesAfterRun: 0 },
      trace, serverEvents: received, stats: scheduler.getStats(),
    };
  } finally {
    bundle.current?.dispose(); controller.setEnabled(false); stop();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function saveReport(report, outputRoot) {
  const sourceFiles = [
    'src/contracts.ts', 'src/preload/types.ts', 'src/preload/scheduler.ts', 'src/preload/controller.ts',
    'src/preload/index.ts', 'adapters/node-runtime.mjs', 'adapters/node-http-fetcher.mjs',
    'src/prediction/config.ts', 'src/prediction/validation.ts', 'src/prediction/factory.ts',
    'src/prediction/markov.ts', 'src/prediction/session.ts', 'src/prediction/index.ts',
    'benchmarks/preload.mjs', 'package.json', 'package-lock.json', 'tsconfig.json',
  ];
  const hash = path => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
  let git = { baseCommit: null, dirty: null };
  try {
    git = {
      baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim() !== '',
    };
  } catch { /* Source hashes remain sufficient to distinguish working-tree implementations. */ }
  report.evidence = {
    createdAtUtc: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    argv: process.argv.slice(2), git, sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, hash(path)])),
  };
  const run = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  const directory = join(resolve(outputRoot), run);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'report.json');
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return path;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output-root' || !args[1])) {
    throw new TypeError('Usage: node benchmarks/preload.mjs [--output-root directory]');
  }
  const report = await runPreloadScenario();
  console.log(`Host HTTP preload checks passed. Report: ${saveReport(report, args[1] ?? join(root, 'artifacts', 'preload'))}`);
  console.log('OpenHarmony idle, view reuse and device performance: NOT RUN.');
}
