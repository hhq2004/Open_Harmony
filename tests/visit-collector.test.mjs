import assert from 'node:assert/strict';
import test from 'node:test';
import { AppVisitCollector } from '../dist/application/visit-collector.js';
import { createPredictionEngine } from '../dist/prediction/index.js';

function setup() {
  const engine = createPredictionEngine(['home', 'detail', 'cart']);
  let sequence = 0;
  const collector = new AppVisitCollector(engine.session, {
    allowedPages: ['home', 'detail', 'cart'],
    createSessionId: () => `s-${(++sequence).toString(16).padStart(32, '0')}`,
  });
  return { engine, collector };
}

test('collection is opt-in and one app session learns completed visits', () => {
  const { engine, collector } = setup();
  assert.equal(collector.visit('home', 1), null);
  assert.equal(engine.model.getStats().observations, 0);
  collector.setEnabled(true);
  assert.equal(collector.visit('home', 2)?.boundary, 'first-visit');
  assert.deepEqual(collector.visit('detail', 3)?.transition, { fromPage: 'home', toPage: 'detail' });
  assert.deepEqual(collector.visit('home', 4)?.candidates, [{ pageId: 'detail', probability: 1 }]);
  assert.equal(engine.model.getStats().observations, 2);
});

test('disable, resume and clear break adjacency; deletion removes learned history', () => {
  const { engine, collector } = setup();
  collector.setEnabled(true);
  collector.visit('home', 1);
  collector.visit('detail', 2);
  collector.setEnabled(false);
  assert.equal(collector.visit('cart', 3), null);
  collector.setEnabled(true);
  assert.equal(collector.visit('cart', 4)?.boundary, 'first-visit');
  collector.startNewSession();
  assert.equal(collector.visit('home', 5)?.boundary, 'first-visit');
  collector.clear();
  assert.equal(engine.model.getStats().observations, 0);
  assert.equal(collector.visit('home', 6)?.boundary, 'first-visit');
  assert.deepEqual(collector.visit('home', 6)?.candidates, [{ pageId: 'home', probability: 1 }]);
});

test('raw URL, foreign session and invalid clock are rejected without bridging visits', () => {
  for (const invalid of [
    collector => collector.visit('https://example.test/detail?uid=7', 2),
    collector => collector.record({ sessionId: 's-ffffffffffffffffffffffffffffffff', pageId: 'detail', monotonicMs: 2 }),
    collector => collector.visit('detail', NaN),
  ]) {
    const { engine, collector } = setup();
    collector.setEnabled(true);
    collector.visit('home', 1);
    assert.throws(() => invalid(collector), /Rejected/);
    assert.equal(collector.visit('detail', 3)?.boundary, 'first-visit');
    assert.equal(engine.model.getStats().observations, 0);
  }
});

test('route catalog and anonymous ID factory are checked', () => {
  const { engine } = setup();
  assert.throws(() => new AppVisitCollector(engine.session, {
    allowedPages: ['home', 'home'], createSessionId: () => 's-00000000000000000000000000000001',
  }));
  assert.throws(() => new AppVisitCollector(engine.session, {
    allowedPages: ['detail?uid=7'], createSessionId: () => 's-00000000000000000000000000000001',
  }));
  const collector = new AppVisitCollector(engine.session, {
    allowedPages: ['home'], createSessionId: () => 'user@example.test',
  });
  assert.throws(() => collector.setEnabled(true), /fresh random/);
  assert.equal(collector.getState().enabled, false);
});
