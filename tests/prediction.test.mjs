import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkovPredictor } from '../dist/prediction/markov.js';

test('cold start abstains without inventing a candidate', () => {
  assert.deepEqual(new MarkovPredictor().predict('home'), []);
});

test('hand-calculated transition frequencies preserve their denominator at top one', () => {
  const predictor = new MarkovPredictor();
  predictor.train(['A', 'B', 'A', 'C', 'A', 'B']);
  assert.deepEqual(predictor.predict('A', 2), [
    { pageId: 'B', probability: 2 / 3 },
    { pageId: 'C', probability: 1 / 3 },
  ]);
  assert.deepEqual(predictor.predict('A'), [{ pageId: 'B', probability: 2 / 3 }]);
});

test('tie breaking uses a deterministic page identifier order', () => {
  const predictor = new MarkovPredictor();
  predictor.observe('home', 'z');
  predictor.observe('home', 'a');
  assert.deepEqual(predictor.predict('home', 2).map(item => item.pageId), ['a', 'z']);
});

test('separate training sessions never create a boundary transition', () => {
  const predictor = new MarkovPredictor();
  predictor.train(['home', 'list']);
  predictor.train(['settings', 'account']);
  assert.deepEqual(predictor.predict('list'), []);
});

test('incremental evidence can change the leading candidate', () => {
  const predictor = new MarkovPredictor();
  predictor.observe('A', 'B');
  predictor.observe('A', 'C');
  predictor.observe('A', 'C');
  assert.deepEqual(predictor.predict('A'), [{ pageId: 'C', probability: 2 / 3 }]);
});

test('clearing state removes all learned transitions', () => {
  const predictor = new MarkovPredictor();
  predictor.train(['home', 'list', 'detail']);
  predictor.clear();
  assert.deepEqual(predictor.predict('home'), []);
  assert.deepEqual(predictor.predict('list'), []);
});

test('invalid training input cannot leave partially learned transitions', () => {
  const predictor = new MarkovPredictor();
  assert.throws(() => predictor.train(['home', 'list', ' ']), TypeError);
  assert.deepEqual(predictor.predict('home'), []);
  assert.throws(() => predictor.observe('', 'home'), TypeError);
  assert.throws(() => predictor.observe('home', null), TypeError);
});

test('limits reject zero, negative, fractional and nonfinite values', () => {
  const predictor = new MarkovPredictor();
  for (const limit of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(() => predictor.predict('home', limit), RangeError);
  }
});

test('returned values cannot mutate model state and object-like keys are safe', () => {
  const predictor = new MarkovPredictor();
  predictor.observe('__proto__', 'constructor');
  const result = predictor.predict('__proto__');
  result[0].probability = 0;
  assert.deepEqual(predictor.predict('__proto__'), [{ pageId: 'constructor', probability: 1 }]);
});
