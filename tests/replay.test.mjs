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
