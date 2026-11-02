import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkovPredictor, SessionPredictor } from '../dist/prediction/index.js';

const visit = (sessionId, pageId, monotonicMs) => ({ sessionId, pageId, monotonicMs });
function setup(options = {}) {
  const model = new MarkovPredictor();
  const session = new SessionPredictor(model, { allowedPages: ['A', 'B', 'C'], ...options });
  return { model, session };
}

test('session inference and learning are off until explicitly enabled', () => {
  const { model, session } = setup();
  model.observe('A', 'B');
  assert.deepEqual(session.accept(visit('s', 'A', 0)), []);
  assert.deepEqual(session.getStats(), { enabled: false, activeSessions: 0 });
  session.setEnabled(true);
  assert.deepEqual(session.accept(visit('s', 'A', 1)), [{ pageId: 'B', probability: 1 }]);
  assert.equal(model.getStats().observations, 1);
});

test('interleaved sessions learn only their own completed transitions', () => {
  const { model, session } = setup();
  session.setEnabled(true);
  session.accept(visit('one', 'A', 100));
  session.accept(visit('two', 'C', 0));
  session.accept(visit('one', 'B', 101));
  session.accept(visit('two', 'A', 1));
  assert.deepEqual(model.predict('A'), [{ pageId: 'B', probability: 1 }]);
  assert.deepEqual(model.predict('C'), [{ pageId: 'A', probability: 1 }]);
  assert.deepEqual(model.predict('B'), []);
});

test('disable and re-enable cannot bridge across missing events', () => {
  const { model, session } = setup();
  session.setEnabled(true);
  session.accept(visit('s', 'A', 0));
  session.accept(visit('s', 'B', 1));
  session.setEnabled(false);
  session.accept(visit('s', 'C', 2));
  session.setEnabled(true);
  session.accept(visit('s', 'A', 3));
  assert.deepEqual(model.predict('B'), []);
  assert.equal(model.getStats().observations, 1);
  assert.throws(() => session.setEnabled('false'), TypeError);
});

test('clear removes model and session data without silently changing the enable switch', () => {
  const { model, session } = setup();
  session.setEnabled(true);
  session.accept(visit('s', 'A', 0));
  session.accept(visit('s', 'B', 1));
  session.clear();
  assert.deepEqual(model.getStats(), { observations: 0, sourcePages: 0, edges: 0 });
  assert.deepEqual(session.getStats(), { enabled: true, activeSessions: 0 });
  session.accept(visit('s', 'C', 2));
  assert.equal(model.getStats().observations, 0);
});

test('out-of-order events cannot move the cursor; equal timestamps use arrival order', () => {
  const { model, session } = setup();
  session.setEnabled(true);
  session.accept(visit('s', 'A', 10));
  assert.deepEqual(session.accept(visit('s', 'C', 9)), []);
  session.accept(visit('s', 'B', 10));
  assert.deepEqual(model.predict('A'), [{ pageId: 'B', probability: 1 }]);
  assert.deepEqual(model.predict('C'), []);
});

test('an idle gap and an explicit session end break adjacency', () => {
  const { model, session } = setup({ maxGapMs: 10 });
  session.setEnabled(true);
  session.accept(visit('s', 'A', 0));
  session.accept(visit('s', 'B', 11));
  assert.deepEqual(model.predict('A'), []);
  session.accept(visit('s', 'C', 21));
  assert.deepEqual(model.predict('B'), [{ pageId: 'C', probability: 1 }]);
  session.endSession('s');
  session.accept(visit('s', 'A', 22));
  assert.deepEqual(model.predict('C'), []);
});

test('LRU capacity evicts a session cursor without comparing clocks across sessions', () => {
  const { model, session } = setup({ maxSessions: 2 });
  session.setEnabled(true);
  session.accept(visit('s1', 'A', 100));
  session.accept(visit('s2', 'B', 0));
  session.accept(visit('s1', 'A', 101));
  session.accept(visit('s3', 'C', 0));
  session.accept(visit('s2', 'C', 1));
  assert.deepEqual(model.predict('B'), []);
  assert.equal(session.getStats().activeSessions, 2);
});

test('unknown routes and invalid times reject and break that session adjacency', () => {
  for (const invalid of [visit('s', 'https://example.com/?user=1', 1), visit('s', 'B', NaN), visit('s', 'B', -1)]) {
    const { model, session } = setup();
    session.setEnabled(true);
    session.accept(visit('s', 'A', 0));
    assert.throws(() => session.accept(invalid));
    session.accept(visit('s', 'C', 2));
    assert.equal(model.getStats().observations, 0);
  }
});

test('route catalog is copied and inputs are not retained by reference', () => {
  const allowedPages = ['A', 'B'];
  const { model, session } = setup({ allowedPages });
  allowedPages.push('C');
  session.setEnabled(true);
  const event = visit('s', 'A', 0);
  session.accept(event);
  event.pageId = 'C';
  session.accept(visit('s', 'B', 1));
  assert.deepEqual(model.predict('A'), [{ pageId: 'B', probability: 1 }]);
  assert.throws(() => session.accept(visit('s', 'C', 2)), TypeError);
});

test('session settings reject invalid catalogs, limits, gaps and capacities', () => {
  for (const options of [
    { allowedPages: [] }, { allowedPages: [''] }, { allowedPages: ['x'.repeat(129)] },
    { maxSessions: 0 }, { limit: 1.5 }, { maxGapMs: Infinity }, { maxGapMs: 0 },
  ]) assert.throws(() => setup(options));
});

test('inference uses only history available at the current visit', () => {
  const { session } = setup();
  session.setEnabled(true);
  assert.deepEqual(session.accept(visit('s', 'A', 0)), []);
  assert.deepEqual(session.accept(visit('s', 'B', 1)), []);
  assert.deepEqual(session.accept(visit('s', 'A', 2)), [{ pageId: 'B', probability: 1 }]);
});

test('a reused model cannot emit routes outside the application catalog', () => {
  const { model, session } = setup();
  model.observe('A', 'private-route-from-old-app');
  session.setEnabled(true);
  assert.deepEqual(session.accept(visit('s', 'A', 0)), []);
});
