import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MarkovPredictor } from '../dist/prediction/markov.js';
import { checkIdentifier, checkPositiveInteger } from '../dist/prediction/validation.js';

/** Options are fixed before replay; frozen mode never learns evaluation outcomes. */
export function evaluateSessions(predictor, sessions, { topK = 1, onlineLearning = true, onStep } = {}) {
  checkPositiveInteger(topK, 'topK');
  if (typeof onlineLearning !== 'boolean') throw new TypeError('onlineLearning must be boolean.');
  if (!Array.isArray(sessions)) throw new TypeError('sessions must be an array.');
  for (const path of sessions) {
    if (!Array.isArray(path)) throw new TypeError('Each session must be an array.');
    for (const page of path) checkIdentifier(page);
  }
  let opportunities = 0;
  let predictionsMade = 0;
  let hits = 0;
  for (const [sessionIndex, path] of sessions.entries()) {
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1];
      const actual = path[index];
      // Predict before learning the actual next page. Never join different sessions.
      const candidates = predictor.predict(from, topK);
      opportunities += 1;
      if (candidates.length > 0) predictionsMade += 1;
      if (candidates.some(candidate => candidate.pageId === actual)) hits += 1;
      if (onlineLearning) predictor.observe(from, actual);
      onStep?.({ sessionIndex, stepIndex: index, fromPage: from, actual, candidates });
    }
  }
  return {
    opportunities,
    predictionsMade,
    hits,
    coverage: opportunities === 0 ? null : predictionsMade / opportunities,
    hitRateAll: opportunities === 0 ? null : hits / opportunities,
    hitRateWhenPredicted: predictionsMade === 0 ? null : hits / predictionsMade,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/synthetic-sessions.json', import.meta.url), 'utf8'));
  const predictor = new MarkovPredictor();
  for (const session of fixture.trainingSessions) predictor.train(session);
  console.log(JSON.stringify({
    scope: 'host-prediction-smoke',
    dataKind: fixture.dataKind,
    evaluationMode: 'predict-then-observe',
    openHarmonyPerformanceMeasured: false,
    metrics: evaluateSessions(predictor, fixture.evaluationSessions),
  }, null, 2));
}
