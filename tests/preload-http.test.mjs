import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { NodeHttpDataFetcher } from '../adapters/node-http-fetcher.mjs';
import { runPreloadScenario } from '../benchmarks/preload.mjs';

test('real HTTP scenario connects B→C, consumes data, aborts transport, and handles server failure', { timeout: 15000 }, async () => {
  const report = await runPreloadScenario();
  assert.equal(report.checks.prefetchedDataConsumed, true);
  assert.equal(report.checks.transportAbortObserved, true);
  assert.equal(report.checks.failureHandled, true);
  assert.equal(report.stats.physicalBusy, false);
  assert.equal(report.stats.activeTasks, 0);
  assert.equal(report.openHarmonyPerformanceMeasured, false);
  assert.equal(report.realViewReuseMeasured, false);
});

test('HTTP adapter bounds streaming input, validates data, rejects redirects, and releases payloads', { timeout: 15000 }, async () => {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/ok' }); response.end(); }
    else if (request.url === '/large') response.end('x'.repeat(100));
    else if (request.url === '/malformed') response.end('{');
    else response.end('{"id":1}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const make = (route, validate = () => true) => new NodeHttpDataFetcher({ resolveUrl: () => base + route, validate, maxResponseBytes: 16 });
  try {
    await assert.rejects(make('/large').start({}).result, RangeError);
    await assert.rejects(make('/malformed').start({}).result, SyntaxError);
    await assert.rejects(make('/ok', () => false).start({}).result, TypeError);
    await assert.rejects(make('/redirect').start({}).result);
    const data = await make('/ok').start({}).result;
    assert.deepEqual(data.value, { id: 1 }); assert.equal(data.byteLength, 8);
    data.dispose(); data.dispose(); assert.throws(() => data.value);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  assert.throws(() => new NodeHttpDataFetcher({ resolveUrl: () => '', validate: () => true, maxResponseBytes: 0 }));
  await assert.rejects(new NodeHttpDataFetcher({ resolveUrl: () => 'file:///tmp/data', validate: () => true }).start({}).result);
});
