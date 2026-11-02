import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MarkovPredictor, SessionPredictor } from '../dist/prediction/index.js';
import { evaluateEventStream, validateEventSequence } from '../benchmarks/events.mjs';
import { comparePredictors, validateDataset } from '../benchmarks/prediction.mjs';

const visit = (order, sessionId, pageId, monotonicMs) => ({ order, kind: 'visit', visit: { sessionId, pageId, monotonicMs } });
const enabled = (order, value = true) => ({ order, kind: 'set-enabled', enabled: value });
const sessionOptions = { allowedPages: ['A', 'B', 'C'], maxGapMs: 10, maxSessions: 2 };

test('interleaved replay scores previously issued candidates with hand-calculated denominators', () => {
  const model = new MarkovPredictor();
  model.train(['A', 'B', 'A', 'B']);
  const result = evaluateEventStream(model, [
    enabled(1), visit(2, 's', 'A', 0), visit(3, 't', 'C', 0),
    visit(4, 's', 'B', 1), visit(5, 't', 'A', 1), visit(6, 's', 'A', 2),
  ], { sessionOptions });
  assert.deepEqual(result.metrics, {
    opportunities: 3, predictionsMade: 2, hits: 2, coverage: 2 / 3, hitRateAll: 2 / 3, hitRateWhenPredicted: 1,
  });
  assert.equal(result.finalState.observations, 6);
  assert.equal(result.totalCandidatesIssued, 4);
  assert.equal(result.candidatesIssued, 2);
  assert.equal(result.unresolvedCandidates, 2);
  assert.equal(result.discardedCandidates, 0);
});

test('gap, disabled visits, explicit end and clear break both learning and outcome pairing', () => {
  const model = new MarkovPredictor();
  model.observe('A', 'B');
  const result = evaluateEventStream(model, [
    enabled(1), visit(2, 's', 'A', 0), visit(3, 's', 'B', 11), visit(4, 's', 'A', 12),
    enabled(5, false), visit(6, 's', 'B', 13), enabled(7), visit(8, 's', 'A', 14),
    { order: 9, kind: 'end-session', sessionId: 's' }, visit(10, 's', 'A', 15),
    { order: 11, kind: 'clear' }, visit(12, 's', 'B', 16), visit(13, 's', 'A', 17),
  ], { sessionOptions });
  assert.equal(result.metrics.opportunities, 2);
  assert.equal(result.metrics.predictionsMade, 0);
  assert.equal(result.metrics.hitRateWhenPredicted, null);
  assert.equal(result.visitCounts.gap, 1);
  assert.equal(result.visitCounts.disabled, 1);
  assert.equal(result.discardedCandidates, 4);
  assert.equal(result.finalState.observations, 1);
  assert.deepEqual(model.predict('A'), []);
  assert.deepEqual(model.predict('B'), [{ pageId: 'A', probability: 1 }]);
});

test('late delivery cannot overwrite the prior prediction or cursor', () => {
  const model = new MarkovPredictor();
  model.observe('A', 'B');
  const result = evaluateEventStream(model, [enabled(1), visit(2, 's', 'A', 10), visit(3, 's', 'C', 9), visit(4, 's', 'B', 11)], { sessionOptions });
  assert.equal(result.visitCounts.outOfOrder, 1);
  assert.equal(result.metrics.opportunities, 1);
  assert.equal(result.metrics.hits, 1);
  assert.deepEqual(result.trace[2].decision.candidates, []);
});

test('LRU eviction discards stale predictions and keeps replay cursors bounded', () => {
  const model = new MarkovPredictor();
  model.observe('A', 'B');
  const result = evaluateEventStream(model, [
    enabled(1), visit(2, 'one', 'A', 100), visit(3, 'two', 'A', 0),
    visit(4, 'three', 'A', 0), visit(5, 'one', 'B', 101),
  ], { sessionOptions });
  assert.equal(result.metrics.opportunities, 0);
  assert.equal(result.trace[3].decision.evictedSessionId, 'one');
  assert.equal(result.discardedCandidates, 2);
  assert.equal(result.finalSessionState.activeSessions, 2);
});

test('temporal training cutoff resets session cursors while preserving model and switch state', () => {
  const model = new MarkovPredictor();
  const result = evaluateEventStream(model, [visit(3, 's', 'B', 1)], {
    sessionOptions, trainingEvents: [enabled(1), visit(2, 's', 'A', 0)],
  });
  assert.equal(result.metrics.opportunities, 0);
  assert.equal(result.trace[0].decision.boundary, 'first-visit');
  assert.equal(result.finalState.observations, 0);
});

test('frozen mode scores history without learning but still honors explicit data deletion', () => {
  const model = new MarkovPredictor();
  model.observe('A', 'B');
  const result = evaluateEventStream(model, [
    enabled(1), visit(2, 's', 'A', 0), visit(3, 's', 'B', 1),
    { order: 4, kind: 'clear' }, visit(5, 's', 'A', 2), visit(6, 's', 'B', 3),
  ], { sessionOptions, onlineLearning: false });
  assert.equal(result.metrics.hits, 1);
  assert.equal(result.metrics.opportunities, 2);
  assert.equal(result.finalState.observations, 0);
  assert.equal(result.hostTiming.observeMs.length, 0);
});

test('default-disabled replay never learns or issues predictions', () => {
  const model = new MarkovPredictor();
  const result = evaluateEventStream(model, [visit(1, 's', 'A', 0), visit(2, 's', 'B', 1)], { sessionOptions });
  assert.equal(result.metrics.opportunities, 0);
  assert.equal(result.metrics.hitRateAll, null);
  assert.equal(result.visitCounts.disabled, 2);
  assert.equal(result.finalState.observations, 0);
});

test('cold-start event replay cannot score the outcome that just trained the model', () => {
  const result = evaluateEventStream(new MarkovPredictor(), [
    enabled(1), visit(2, 's', 'A', 0), visit(3, 's', 'B', 1),
    visit(4, 's', 'A', 2), visit(5, 's', 'B', 3),
  ], { sessionOptions });
  assert.equal(result.metrics.opportunities, 3);
  assert.equal(result.metrics.predictionsMade, 1);
  assert.equal(result.metrics.hits, 1);
  assert.equal(result.trace[2].outcome.hit, false);
});

test('event top K scores membership and accounts for the other candidate', () => {
  const model = new MarkovPredictor();
  model.observe('A', 'B');
  model.observe('A', 'C');
  const result = evaluateEventStream(model, [enabled(1), visit(2, 's', 'A', 0), visit(3, 's', 'C', 1)], {
    sessionOptions: { ...sessionOptions, limit: 2 }, onlineLearning: false,
  });
  assert.equal(result.metrics.hits, 1);
  assert.equal(result.candidatesIssued, 2);
  assert.equal(result.unusedCandidates, 1);
});

test('invalid event input is rejected before training or clear can mutate the model', () => {
  const model = new MarkovPredictor();
  model.observe('A', 'B');
  const invalidSequences = [
    [visit(1, 's', 'A', 0)], [visit(3, 's', 'A', 0), visit(3, 's', 'B', 1)],
    [visit(3, 's', 'other', 0)], [visit(3, 's', 'A', Infinity)],
    [{ order: 3, kind: 'unknown' }], [{ ...enabled(3), userEmail: 'unwanted' }],
  ];
  for (const events of invalidSequences) {
    assert.throws(() => evaluateEventStream(model, events, { sessionOptions, trainingEvents: [{ order: 2, kind: 'clear' }] }));
    assert.equal(model.getStats().observations, 1);
  }
  assert.throws(() => validateEventSequence([enabled(0)], ['A']), RangeError);
});

test('event replay decisions match direct application calls across 200 ordered actions', () => {
  const directModel = new MarkovPredictor({ windowSize: 7 });
  const direct = new SessionPredictor(directModel, sessionOptions);
  const events = [];
  for (let index = 1; index <= 200; index += 1) {
    if (index % 31 === 1) events.push(enabled(index));
    else if (index % 31 === 30) events.push(enabled(index, false));
    else if (index % 43 === 0) events.push({ order: index, kind: 'clear' });
    else if (index % 23 === 0) events.push({ order: index, kind: 'end-session', sessionId: `s${index % 4}` });
    else events.push(visit(index, `s${index % 4}`, ['A', 'B', 'C'][index % 3], index));
  }
  const expected = events.map(event => {
    if (event.kind === 'set-enabled') direct.setEnabled(event.enabled);
    else if (event.kind === 'clear') direct.clear();
    else if (event.kind === 'end-session') direct.endSession(event.sessionId);
    else return direct.acceptDetailed(event.visit);
    return null;
  });
  const replayModel = new MarkovPredictor({ windowSize: 7 });
  const replay = evaluateEventStream(replayModel, events, { sessionOptions });
  assert.deepEqual(replay.trace.map(item => item.decision), expected);
  assert.deepEqual(replay.finalState, directModel.getStats());
  assert.deepEqual(replay.finalSessionState, direct.getStats());
  assert.equal(replay.totalCandidatesIssued, replay.candidatesIssued + replay.discardedCandidates + replay.unresolvedCandidates);
});

test('schema 2 compares all strategies and accounts for every issued candidate', () => {
  const fixture = JSON.parse(readFileSync(new URL('../benchmarks/fixtures/prediction-events.json', import.meta.url)));
  const result = comparePredictors(fixture);
  assert.equal(result.inputFormat, 'event-stream');
  for (const scenario of result.scenarios) {
    assert.equal(scenario.strategies.length, 4);
    for (const strategy of scenario.strategies) {
      assert.equal(strategy.totalCandidatesIssued, strategy.candidatesIssued + strategy.discardedCandidates + strategy.unresolvedCandidates);
      assert.equal(strategy.trace.filter(item => item.outcome !== null).length, strategy.metrics.opportunities);
      assert.ok(strategy.finalSessionState.activeSessions <= fixture.sessionOptions.maxSessions);
    }
  }
  fixture.sessionOptions = { limit: 7 };
  assert.throws(() => validateDataset(fixture), TypeError);
});
