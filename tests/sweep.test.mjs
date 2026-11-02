import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { sweepConfigurations, validateSweepDataset } from '../benchmarks/sweep.mjs';

function input() {
  return {
    schemaVersion: 1, inputFormat: 'session-paths', dataKind: 'synthetic', source: 'held-out selection unit test',
    pageCatalog: ['A', 'B', 'C'], scenarios: [{
      name: 'one', trainingSessions: [['A', 'B'], ['A', 'B'], ['A', 'C']],
      validationSessions: [['A', 'B'], ['A', 'B']], testSessions: [['A', 'C']],
    }],
  };
}
function grid() {
  return {
    schemaVersion: 1, selection: { metric: 'hitRateAll', minCoverage: 0.5, maxMeanCandidates: 1 },
    candidates: [{ id: 'full', overrides: {} }, { id: 'one-transition', overrides: { model: { windowSize: 1 } } }],
  };
}

test('validation chooses the hand-calculated winner; only it is refit and tested', () => {
  const report = sweepConfigurations(input(), grid(), { mode: 'frozen' });
  assert.equal(report.selected.id, 'full');
  assert.equal(report.validation.find(item => item.id === 'full').metrics.hitRateAll, 1);
  assert.equal(report.validation.find(item => item.id === 'one-transition').metrics.hitRateAll, 0);
  assert.equal(report.test.metrics.hitRateAll, 0);
  assert.equal(report.test.refit, 'training-plus-validation');
  assert.equal(report.test.report.scenarios[0].strategies.length, 1);
  assert.equal(report.test.report.scenarios[0].strategies[0].initialState.observations, 5);
  assert.equal(report.openHarmonyPerformanceMeasured, false);
});

test('changing final test labels and size cannot change validation ranking or selected configuration', () => {
  const original = input();
  const changed = input();
  changed.scenarios[0].testSessions = Array.from({ length: 50 }, () => ['A', 'B']);
  const first = sweepConfigurations(original, grid(), { mode: 'frozen' });
  const second = sweepConfigurations(changed, grid(), { mode: 'frozen' });
  assert.deepEqual(first.ranking, second.ranking);
  assert.deepEqual(first.selected, second.selected);
  assert.deepEqual(first.validation.map(item => item.metrics), second.validation.map(item => item.metrics));
  assert.equal(first.test.metrics.hits, 0);
  assert.equal(second.test.metrics.hits, 50);
});

test('candidate budget and coverage constraints can reject a higher top K or abstaining profile', () => {
  const data = input();
  const candidates = grid();
  candidates.candidates.push({ id: 'two', overrides: { session: { limit: 2 } } });
  candidates.candidates.push({ id: 'silent', overrides: { model: { minSamples: 100 } } });
  const report = sweepConfigurations(data, candidates, { mode: 'frozen' });
  assert.equal(report.validation.find(item => item.id === 'two').metrics.meanCandidates, 2);
  assert.equal(report.validation.find(item => item.id === 'two').eligible, false);
  assert.equal(report.validation.find(item => item.id === 'silent').eligible, false);
  assert.equal(report.selected.id, 'full');
});

test('ties resolve by smaller window and id, independently of candidate declaration order', () => {
  const candidates = { schemaVersion: 1, candidates: [
    { id: 'z', overrides: { model: { windowSize: 8 } } },
    { id: 'a', overrides: { model: { windowSize: 8 } } }, { id: 'large', overrides: {} },
  ] };
  const first = sweepConfigurations(input(), candidates, { mode: 'frozen' });
  candidates.candidates.reverse();
  const second = sweepConfigurations(input(), candidates, { mode: 'frozen' });
  assert.equal(first.selected.id, 'a');
  assert.deepEqual(first.ranking, second.ranking);
});

test('empty validation or no eligible profile produces no selection and no final test scores', () => {
  const data = input();
  data.scenarios[0].validationSessions = [];
  const empty = sweepConfigurations(data, grid());
  assert.equal(empty.selected, null);
  assert.equal(empty.test, null);
  const tooStrict = grid();
  tooStrict.candidates = [{ id: 'silent', overrides: { model: { minSamples: 100 } } }];
  assert.equal(sweepConfigurations(input(), tooStrict).selectionReason, 'no-eligible-validation-candidate');
});

test('aggregate ratios use summed opportunities, not averages of scenario ratios', () => {
  const data = input();
  data.scenarios.push({ name: 'many', trainingSessions: [['A', 'B']], validationSessions: Array.from({ length: 8 }, () => ['A', 'C']), testSessions: [] });
  const report = sweepConfigurations(data, { schemaVersion: 1, candidates: [{ id: 'only', overrides: {} }] }, { mode: 'frozen' });
  assert.equal(report.validation[0].metrics.opportunities, 10);
  assert.equal(report.validation[0].metrics.hits, 2);
  assert.equal(report.validation[0].metrics.hitRateAll, 0.2);
});

test('event sweep respects three-way ordering, factory policy and candidate accounting', () => {
  const data = JSON.parse(readFileSync(new URL('../benchmarks/fixtures/prediction-sweep.json', import.meta.url)));
  const candidates = JSON.parse(readFileSync(new URL('../config/prediction-candidates.json', import.meta.url)));
  const report = sweepConfigurations(data, candidates);
  assert.equal(report.selected.id, 'recent');
  assert.equal(report.selected.config.model.windowSize, 16);
  for (const candidate of report.validation) {
    const strategy = candidate.report.scenarios[0].strategies[0];
    assert.equal(strategy.totalCandidatesIssued, strategy.candidatesIssued + strategy.discardedCandidates + strategy.unresolvedCandidates);
    assert.equal(candidate.metrics.opportunities, 4);
  }
  data.scenarios[0].testEvents[0].order = data.scenarios[0].validationEvents.at(-1).order;
  assert.throws(() => validateSweepDataset(data), RangeError);
});

test('invalid grids, misspelled configuration and lifecycle-policy sweeps fail explicitly', () => {
  const invalid = [
    { schemaVersion: 1, candidates: [] },
    { schemaVersion: 1, candidates: [{ id: 'a' }, { id: 'a' }] },
    { schemaVersion: 1, selection: { metric: 'testHitRate' }, candidates: [{ id: 'a' }] },
    { schemaVersion: 1, selection: { maxMeanCandidates: 0 }, candidates: [{ id: 'a' }] },
    { schemaVersion: 1, candidates: [{ id: 'a', overrides: { session: { maxGapMs: 1 } } }] },
    { schemaVersion: 1, candidates: [{ id: 'a', overrides: { model: { windowSiz: 2 } } }] },
  ];
  for (const candidate of invalid) assert.throws(() => sweepConfigurations(input(), candidate));
  const data = input();
  delete data.scenarios[0].validationSessions;
  assert.throws(() => validateSweepDataset(data));
});

test('sweep CLI rejects invalid mode without a success report', () => {
  const result = spawnSync(process.execPath, ['benchmarks/sweep.mjs', '--mode', 'invalid'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /mode must be/);
});
