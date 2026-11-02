import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkovPredictor } from '../dist/prediction/markov.js';
import { evaluateSessions } from '../benchmarks/replay.mjs';

test('replay learns only after prediction; its first observations cannot score hits', () => {
  const result = evaluateSessions(new MarkovPredictor(), [['A', 'B', 'A', 'B']]);
  assert.deepEqual(result, {
    opportunities: 3,
    predictionsMade: 1,
    hits: 1,
    coverage: 1 / 3,
    hitRateAll: 1 / 3,
    hitRateWhenPredicted: 1,
  });
});

test('replay does not train across session boundaries', () => {
  const predictor = new MarkovPredictor();
  evaluateSessions(predictor, [['A', 'B'], ['C', 'D']]);
  assert.deepEqual(predictor.predict('B'), []);
});

test('no prediction and no opportunities remain distinguishable', () => {
  const empty = evaluateSessions(new MarkovPredictor(), [[], ['A']]);
  assert.equal(empty.opportunities, 0);
  assert.equal(empty.hitRateAll, null);
  const cold = evaluateSessions(new MarkovPredictor(), [['A', 'B']]);
  assert.equal(cold.opportunities, 1);
  assert.equal(cold.hitRateAll, 0);
  assert.equal(cold.hitRateWhenPredicted, null);
});

test('frozen evaluation never trains on evaluation outcomes', () => {
  const predictor = new MarkovPredictor();
  predictor.observe('A', 'B');
  const before = predictor.getStats();
  const result = evaluateSessions(predictor, [['A', 'C', 'A', 'C']], { onlineLearning: false });
  assert.equal(result.predictionsMade, 2);
  assert.equal(result.hits, 0);
  assert.deepEqual(predictor.getStats(), before);
  assert.deepEqual(predictor.predict('C'), []);
});

test('top K uses membership and still counts one opportunity per transition', () => {
  const predictor = new MarkovPredictor();
  predictor.observe('A', 'B');
  predictor.observe('A', 'C');
  const trace = [];
  const result = evaluateSessions(predictor, [['A', 'C']], {
    topK: 2, onlineLearning: false, onStep: step => trace.push(step),
  });
  assert.equal(result.opportunities, 1);
  assert.equal(result.hits, 1);
  assert.deepEqual(trace[0].candidates, [{ pageId: 'B', probability: 0.5 }, { pageId: 'C', probability: 0.5 }]);
});

test('invalid replay input is validated before any learning', () => {
  const predictor = new MarkovPredictor();
  for (const sessions of [null, ['ABC'], [['A', 'B'], ['']], [['A', 'x'.repeat(129)]]]) {
    assert.throws(() => evaluateSessions(predictor, sessions));
    assert.equal(predictor.getStats().observations, 0);
  }
  assert.throws(() => evaluateSessions(predictor, [], { topK: 0 }), RangeError);
  assert.throws(() => evaluateSessions(predictor, [], { onlineLearning: 'false' }), TypeError);
});
