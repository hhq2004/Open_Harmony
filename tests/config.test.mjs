import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPredictionEngine, DEFAULT_PREDICTION_CONFIG, MarkovPredictor, resolvePredictionConfig } from '../dist/prediction/index.js';
import { comparePredictors, evaluateConfiguration } from '../benchmarks/prediction.mjs';

const visit = (order, sessionId, pageId, monotonicMs) => ({ order, kind: 'visit', visit: { sessionId, pageId, monotonicMs } });

test('the shipped partial profile and standalone constructors resolve the same immutable defaults', () => {
  const raw = JSON.parse(readFileSync(new URL('../config/prediction.json', import.meta.url)));
  const engine = createPredictionEngine(['A', 'B'], raw);
  assert.deepEqual(engine.config, DEFAULT_PREDICTION_CONFIG);
  const standalone = new MarkovPredictor();
  assert.equal(standalone.windowSize, engine.config.model.windowSize);
  assert.equal(standalone.minSamples, engine.config.model.minSamples);
  assert.equal(standalone.minProbability, engine.config.model.minProbability);
  assert.deepEqual(engine.session.getStats(), { enabled: false, activeSessions: 0 });
  assert.throws(() => { engine.config.model.windowSize = 1; }, TypeError);
  assert.throws(() => { engine.config.session.limit = 99; }, TypeError);
});

test('partial overrides preserve their base, detach caller input and reject typos or invalid values', () => {
  const raw = { model: { windowSize: 9 }, session: { limit: 2 } };
  const base = resolvePredictionConfig(raw);
  raw.model.windowSize = 100;
  assert.equal(base.model.windowSize, 9);
  const next = resolvePredictionConfig({ model: { minSamples: 3 } }, base);
  assert.equal(next.model.windowSize, 9);
  assert.equal(next.session.limit, 2);
  assert.equal(base.model.minSamples, 1);
  for (const invalid of [
    null, [], { schemaVersion: 2 }, { session: { topK: 2 } }, { model: { windowSiz: 1 } },
    { model: null }, { model: { windowSize: '8' } }, { session: { maxGapMs: null } },
    { model: { windowSize: 2, minSamples: 3 } }, { session: { limit: 0 } },
    { model: { minProbability: NaN } }, { session: { maxSessions: Infinity } },
  ]) assert.throws(() => resolvePredictionConfig(invalid));
});

test('the configured evaluator uses the same policy and decisions as the application factory', () => {
  const profile = { model: { windowSize: 3 }, session: { limit: 2, maxSessions: 2, maxGapMs: 10 } };
  const trainingEvents = [{ order: 1, kind: 'set-enabled', enabled: true }, visit(2, 'train', 'A', 0), visit(3, 'train', 'B', 1)];
  const evaluationEvents = [visit(4, 'eval', 'A', 0), visit(5, 'eval', 'B', 1), visit(6, 'eval', 'A', 2), visit(7, 'eval', 'B', 20)];
  const data = { schemaVersion: 2, dataKind: 'synthetic', source: 'factory parity test', pageCatalog: ['A', 'B'], scenarios: [{ name: 'one', trainingEvents, evaluationEvents }] };
  const application = createPredictionEngine(data.pageCatalog, profile);
  application.session.setEnabled(true);
  for (const event of trainingEvents.slice(1)) application.session.acceptDetailed(event.visit);
  application.session.setEnabled(false);
  application.session.setEnabled(true);
  const direct = evaluationEvents.map(event => application.session.acceptDetailed(event.visit));
  const report = evaluateConfiguration(data, profile);
  const configured = report.scenarios[0].strategies[0];
  assert.deepEqual(report.effectiveConfig, application.config);
  assert.deepEqual(configured.trace.map(step => step.decision), direct);
  assert.deepEqual(configured.finalState, application.model.getStats());
  const comparison = comparePredictors(data, { config: profile, windowSize: 1 });
  assert.deepEqual(comparison.scenarios[0].strategies.find(item => item.name === 'configured').trace.map(item => item.decision), direct);
  assert.equal(comparison.effectiveConfig.model.windowSize, 3);
});

test('dataset session overrides and CLI top K are explicit in the effective configuration', () => {
  const data = JSON.parse(readFileSync(new URL('../benchmarks/fixtures/prediction-events.json', import.meta.url)));
  const result = comparePredictors(data, { config: { session: { maxSessions: 64, limit: 1 } }, topK: 2 });
  assert.equal(result.profile.session.maxSessions, 64);
  assert.equal(result.effectiveConfig.session.maxSessions, 2);
  assert.equal(result.effectiveConfig.session.maxGapMs, 10);
  assert.equal(result.effectiveConfig.session.limit, 2);
});

test('independent factories never share training or enable state', () => {
  const one = createPredictionEngine(['A', 'B']);
  const two = createPredictionEngine(['A', 'B']);
  one.model.observe('A', 'B');
  one.session.setEnabled(true);
  assert.deepEqual(two.model.predict('A'), []);
  assert.equal(two.session.getStats().enabled, false);
});
