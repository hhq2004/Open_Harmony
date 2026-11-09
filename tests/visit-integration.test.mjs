import assert from 'node:assert/strict';
import test from 'node:test';
import { AppVisitCollector } from '../dist/application/visit-collector.js';
import { AppVisitIntegration } from '../dist/application/visit-integration.js';
import { createPredictionEngine } from '../dist/prediction/index.js';
import { PredictionPreloadController } from '../dist/preload/index.js';
import { lease, settle, setup } from './preload-helpers.mjs';

function fixture() {
  const pages = ['home', 'detail', 'cart'];
  const engine = createPredictionEngine(pages);
  let sequence = 0;
  const collector = new AppVisitCollector(engine.session, {
    allowedPages: pages,
    createSessionId: () => `s-${(++sequence).toString(16).padStart(32, '0')}`,
  });
  const host = setup();
  const controller = new PredictionPreloadController(host.scheduler);
  const app = new AppVisitIntegration(collector, controller, host.scheduler,
    pageId => pages.includes(pageId) ? { pageId, dataKey: pageId } : undefined);
  const idle = () => app.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false });
  return { app, collector, engine, host, idle };
}

test('A passes one anonymous session through B to C and transfers a ready bundle', async () => {
  const { app, collector, engine, host, idle } = fixture();
  assert.equal(app.visit('home', 1).decision, null);
  app.setEnabled(true);
  for (const [page, time] of [['home', 1], ['detail', 2], ['home', 3]]) {
    app.visit(page, time);
    idle();
  }
  await settle();
  assert.equal(engine.model.getStats().observations, 2);
  assert.equal(host.operations.length, 1);
  assert.equal(host.operations[0].request.pageId, 'detail');
  assert.equal(host.operations[0].request.sessionId, collector.getActiveSessionId());
  assert.equal(host.operations[0].request.dataKey, 'detail');
  const data = lease({ page: 'detail' });
  host.operations[0].resolve(data);
  await settle();
  const result = app.visit('detail', 4);
  assert.equal(result.decision.status, 'accepted');
  assert.equal(result.prepared?.data.value.page, 'detail');
  assert.equal(host.scheduler.getTask('prediction-1').state, 'consumed');
  assert.equal(data.disposals, 0);
  result.prepared.dispose();
  result.prepared.dispose();
  assert.equal(data.disposals, 1);
});

test('A closes and clears both prediction and speculative work without bridging sessions', async () => {
  const { app, collector, engine, host, idle } = fixture();
  app.setEnabled(true);
  for (const [page, time] of [['home', 1], ['detail', 2], ['home', 3]]) {
    app.visit(page, time);
    idle();
  }
  await settle();
  const firstId = collector.getActiveSessionId();
  assert.equal(host.scheduler.getTask('prediction-1').state, 'running');
  app.setEnabled(false);
  assert.equal(host.scheduler.getTask('prediction-1').state, 'cancelled');
  assert.equal(app.visit('cart', 4).decision, null);
  host.operations[0].resolve(lease());
  await settle();
  app.setEnabled(true);
  assert.notEqual(collector.getActiveSessionId(), firstId);
  assert.equal(app.visit('cart', 5).decision.boundary, 'first-visit');
  app.clear();
  assert.equal(engine.model.getStats().observations, 0);
  assert.equal(app.visit('home', 6).decision.boundary, 'first-visit');
  assert.equal(host.scheduler.getStats().heldBytes, 0);
});

test('A rejects raw routes and breaks C adjacency along with B', () => {
  const { app, host, idle } = fixture();
  app.setEnabled(true);
  app.visit('home', 1);
  idle();
  assert.throws(() => app.visit('https://example.test/detail?user=7', 2), /Rejected/);
  assert.equal(app.visit('detail', 3).decision.boundary, 'first-visit');
  assert.equal(host.scheduler.getStats().activeTasks, 0);
});

test('A stops in-flight speculation before navigation and releases late data', async () => {
  const { app, host, idle } = fixture();
  app.setEnabled(true);
  for (const [page, time] of [['home', 1], ['detail', 2], ['home', 3]]) {
    app.visit(page, time);
    idle();
  }
  await settle();
  assert.equal(host.operations[0].request.pageId, 'detail');
  const result = app.visit('cart', 4);
  assert.equal(result.prepared, undefined);
  assert.equal(host.scheduler.getTask('prediction-1').state, 'cancelled');
  assert.equal(host.scheduler.getTask('prediction-1').cancelReason, 'foreground-work');
  const late = lease({ page: 'detail' });
  host.operations[0].resolve(late);
  await settle();
  assert.equal(late.disposals, 1);
  assert.equal(host.scheduler.getStats().heldBytes, 0);
});

test('A labels a ready but unmatched candidate as prediction miss and frees its data', async () => {
  const { app, host, idle } = fixture();
  app.setEnabled(true);
  for (const [page, time] of [['home', 1], ['detail', 2], ['home', 3]]) {
    app.visit(page, time);
    idle();
  }
  await settle();
  const ready = lease({ page: 'detail' });
  host.operations[0].resolve(ready);
  await settle();
  assert.equal(host.scheduler.getTask('prediction-1').state, 'data-ready');
  app.visit('cart', 4);
  assert.equal(host.scheduler.getTask('prediction-1').cancelReason, 'prediction-miss');
  assert.equal(ready.disposals, 1);
  assert.equal(host.scheduler.getStats().heldBytes, 0);
});
