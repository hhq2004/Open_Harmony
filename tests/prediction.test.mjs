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

test('a full window removes old counts, empty edges and source rows', () => {
  const predictor = new MarkovPredictor({ windowSize: 3 });
  predictor.observe('A', 'B');
  predictor.observe('A', 'C');
  predictor.observe('A', 'B');
  predictor.observe('X', 'Y');
  assert.deepEqual(predictor.predict('A', 2), [
    { pageId: 'B', probability: 1 / 2 }, { pageId: 'C', probability: 1 / 2 },
  ]);
  predictor.observe('X', 'Y');
  assert.deepEqual(predictor.predict('A'), [{ pageId: 'B', probability: 1 }]);
  predictor.observe('X', 'Y');
  assert.deepEqual(predictor.predict('A'), []);
  assert.deepEqual(predictor.getStats(), { observations: 3, sourcePages: 1, edges: 1 });
});

test('sample and probability gates abstain without changing score denominators', () => {
  const predictor = new MarkovPredictor({ windowSize: 4, minSamples: 3, minProbability: 0.6 });
  predictor.observe('A', 'B');
  predictor.observe('A', 'B');
  assert.deepEqual(predictor.predict('A'), []);
  predictor.observe('A', 'C');
  assert.deepEqual(predictor.predict('A', 2), [{ pageId: 'B', probability: 2 / 3 }]);
  predictor.observe('A', 'C');
  assert.deepEqual(predictor.predict('A'), []);
});

test('invalid input at a full window cannot evict valid observations', () => {
  const predictor = new MarkovPredictor({ windowSize: 1 });
  predictor.observe('A', 'B');
  assert.throws(() => predictor.observe('X', 'a'.repeat(129)), TypeError);
  assert.throws(() => predictor.train(['X', 'Y', '']), TypeError);
  assert.throws(() => predictor.train('XYZ'), TypeError);
  assert.deepEqual(predictor.predict('A'), [{ pageId: 'B', probability: 1 }]);
});

test('invalid configuration is rejected before training', () => {
  for (const windowSize of [0, -1, 2.5, Infinity, NaN, '4']) {
    assert.throws(() => new MarkovPredictor({ windowSize }), RangeError);
  }
  for (const minSamples of [0, -1, 1.1, 3]) {
    assert.throws(() => new MarkovPredictor({ windowSize: 2, minSamples }), RangeError);
  }
  for (const minProbability of [-0.1, 1.1, Infinity, NaN, '0.5']) {
    assert.throws(() => new MarkovPredictor({ minProbability }), RangeError);
  }
});

test('bounded model agrees with an independent rolling-list oracle over 2000 updates', () => {
  const windowSize = 17;
  const predictor = new MarkovPredictor({ windowSize });
  const recent = [];
  let seed = 72;
  const randomPage = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return `P${seed % 9}`;
  };
  for (let step = 0; step < 2000; step += 1) {
    const from = randomPage();
    const to = randomPage();
    predictor.observe(from, to);
    recent.push([from, to]);
    if (recent.length > windowSize) recent.shift();
    for (let page = 0; page < 9; page += 1) {
      const source = `P${page}`;
      const targets = recent.filter(([item]) => item === source).map(([, target]) => target);
      const unique = [...new Set(targets)];
      const expected = unique.map(pageId => ({
        pageId, probability: targets.filter(target => target === pageId).length / targets.length,
      })).sort((left, right) => right.probability - left.probability || (left.pageId < right.pageId ? -1 : 1));
      assert.deepEqual(predictor.predict(source, 9), expected);
    }
    const stats = predictor.getStats();
    assert.equal(stats.observations, recent.length);
    assert.ok(stats.sourcePages <= windowSize);
    assert.ok(stats.edges <= windowSize);
    if (step === 1000) { predictor.clear(); recent.length = 0; }
  }
});

test('many unique routes remain bounded and clearing permits clean retraining', () => {
  const predictor = new MarkovPredictor({ windowSize: 8 });
  for (let index = 0; index < 1000; index += 1) predictor.observe(`A${index}`, `B${index}`);
  assert.deepEqual(predictor.getStats(), { observations: 8, sourcePages: 8, edges: 8 });
  assert.deepEqual(predictor.predict('A0'), []);
  predictor.clear();
  assert.deepEqual(predictor.getStats(), { observations: 0, sourcePages: 0, edges: 0 });
  predictor.train(['new', 'route']);
  assert.deepEqual(predictor.predict('new'), [{ pageId: 'route', probability: 1 }]);
});
