import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { comparePredictors, validateDataset } from '../benchmarks/prediction.mjs';
import { evaluateSessions } from '../benchmarks/replay.mjs';
import { MarkovPredictor } from '../dist/prediction/markov.js';
import { SessionPredictor } from '../dist/prediction/session.js';

function dataset() {
  return {
    schemaVersion: 1, dataKind: 'synthetic', source: 'unit test only', pageCatalog: ['A', 'B', 'C'],
    scenarios: [{ name: 'example', trainingSessions: [['A', 'B']], evaluationSessions: [['A', 'B', 'A', 'C']] }],
  };
}

test('comparison preserves hand-calculated decisions, abstentions and unused candidates', () => {
  const result = comparePredictors(dataset());
  const full = result.scenarios[0].strategies.find(item => item.name === 'full-history');
  assert.deepEqual(full.metrics, {
    opportunities: 3, predictionsMade: 2, hits: 1, coverage: 2 / 3, hitRateAll: 1 / 3, hitRateWhenPredicted: 1 / 2,
  });
  assert.equal(full.misses, 1);
  assert.equal(full.unusedCandidates, 1);
  assert.deepEqual(full.trace.map(step => [step.fromPage, step.actual, step.hit]), [
    ['A', 'B', true], ['B', 'A', false], ['A', 'C', false],
  ]);
  assert.equal(full.hostTiming.predictMs.length, 3);
  assert.equal(full.hostTiming.observeMs.length, 3);
  assert.equal(result.openHarmonyPerformanceMeasured, false);
  const guarded = result.scenarios[0].strategies.find(item => item.name === 'guarded-window');
  assert.equal(guarded.metrics.predictionsMade, 0);
  assert.equal(guarded.metrics.hitRateWhenPredicted, null);
});

test('frozen comparison preserves every strategy state and counts top K waste', () => {
  const fixture = dataset();
  fixture.scenarios[0].trainingSessions.push(['A', 'C']);
  const result = comparePredictors(fixture, { mode: 'frozen', topK: 2 });
  for (const strategy of result.scenarios[0].strategies) {
    assert.deepEqual(strategy.finalState, strategy.initialState);
    assert.equal(strategy.hostTiming.observeMs.length, 0);
  }
  const full = result.scenarios[0].strategies[0];
  assert.equal(full.metrics.hits, 2);
  assert.equal(full.candidatesIssued, 4);
  assert.equal(full.unusedCandidates, 2);
});

test('identical fixtures yield identical decisions independently of timing and prior calls', () => {
  const input = JSON.parse(readFileSync(new URL('../benchmarks/fixtures/prediction-scenarios.json', import.meta.url)));
  const run = () => comparePredictors(input).scenarios.map(scenario => scenario.strategies.map(({ hostTiming, ...rest }) => rest));
  assert.deepEqual(run(), run());
});

test('dataset schema requires provenance, known routes and isolated session arrays', () => {
  const cases = [
    value => { value.schemaVersion = 2; }, value => { value.source = ''; },
    value => { value.dataKind = 'real-proven'; }, value => { value.pageCatalog = []; },
    value => { value.scenarios = []; }, value => { value.scenarios.push(value.scenarios[0]); },
    value => { value.scenarios[0].evaluationSessions = [['unknown']]; },
    value => { value.scenarios[0].trainingSessions = ['ABC']; },
  ];
  for (const mutate of cases) {
    const input = dataset();
    mutate(input);
    assert.throws(() => validateDataset(input));
  }
  assert.throws(() => comparePredictors(dataset(), { mode: 'bad' }), RangeError);
  assert.throws(() => comparePredictors(dataset(), { windowSize: 0 }), RangeError);
});

test('session adapter and offline replay make the same chronological predictions', () => {
  const paths = [['A', 'B', 'A', 'C'], ['A', 'B', 'C', 'A', 'B']];
  const replayModel = new MarkovPredictor({ windowSize: 3 });
  const sessionModel = new MarkovPredictor({ windowSize: 3 });
  const adapter = new SessionPredictor(sessionModel, { allowedPages: ['A', 'B', 'C'], limit: 2 });
  adapter.setEnabled(true);
  const expected = [];
  evaluateSessions(replayModel, paths, { topK: 2, onStep: step => expected.push(step.candidates) });
  const actual = [];
  for (const [session, path] of paths.entries()) {
    for (const [index, pageId] of path.entries()) {
      const candidates = adapter.accept({ sessionId: `s${session}`, pageId, monotonicMs: index });
      if (index < path.length - 1) actual.push(candidates);
    }
  }
  assert.deepEqual(actual, expected);
  assert.deepEqual(sessionModel.getStats(), replayModel.getStats());
});

test('invalid CLI arguments exit unsuccessfully without producing a success report', () => {
  const result = spawnSync(process.execPath, ['benchmarks/prediction.mjs', '--mode', 'invalid'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /mode must be/);
});
