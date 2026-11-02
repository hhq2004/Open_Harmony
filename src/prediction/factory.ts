import { resolvePredictionConfig } from './config.js';
import type { PredictionConfig } from './config.js';
import { MarkovPredictor } from './markov.js';
import { SessionPredictor } from './session.js';

/** The application supplies its route aliases and parsed profile; platform loading belongs to A. */
export function createPredictionEngine(allowedPages: readonly string[], profile: unknown = {}): {
  readonly config: PredictionConfig;
  readonly model: MarkovPredictor;
  readonly session: SessionPredictor;
} {
  const config = resolvePredictionConfig(profile);
  const model = new MarkovPredictor(config.model);
  const session = new SessionPredictor(model, { ...config.session, allowedPages });
  return { config, model, session };
}
