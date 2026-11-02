import { performance } from 'node:perf_hooks';
import { SessionPredictor } from '../dist/prediction/session.js';
import { checkIdentifier, checkPositiveInteger } from '../dist/prediction/validation.js';

function checkKeys(value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new TypeError('Event contains unsupported fields. Export only the documented anonymous fields.');
  }
}

/** order is global delivery order; monotonicMs is local to a session and may arrive out of order. */
export function validateEventSequence(events, allowedPages, afterOrder = 0) {
  if (!Array.isArray(events)) throw new TypeError('An event sequence must be an array.');
  const pages = new Set(allowedPages);
  let previousOrder = afterOrder;
  for (const event of events) {
    if (event === null || typeof event !== 'object') throw new TypeError('Expected an event object.');
    checkPositiveInteger(event.order, 'event.order');
    if (event.order <= previousOrder) throw new RangeError('Events must have strictly increasing global order.');
    previousOrder = event.order;
    switch (event.kind) {
      case 'visit':
        checkKeys(event, ['order', 'kind', 'visit']);
        checkKeys(event.visit, ['sessionId', 'pageId', 'monotonicMs']);
        checkIdentifier(event.visit.sessionId);
        checkIdentifier(event.visit.pageId);
        if (!pages.has(event.visit.pageId)) throw new TypeError('Visit page is outside pageCatalog.');
        if (!Number.isFinite(event.visit.monotonicMs) || event.visit.monotonicMs < 0) {
          throw new RangeError('Visit monotonicMs must be finite and nonnegative.');
        }
        break;
      case 'set-enabled':
        checkKeys(event, ['order', 'kind', 'enabled']);
        if (typeof event.enabled !== 'boolean') throw new TypeError('enabled must be boolean.');
        break;
      case 'end-session':
        checkKeys(event, ['order', 'kind', 'sessionId']);
        checkIdentifier(event.sessionId);
        break;
      case 'clear':
        checkKeys(event, ['order', 'kind']);
        break;
      default:
        throw new TypeError('Unknown event kind.');
    }
  }
  return previousOrder;
}

/** Replay uses the actual B adapter, including its session cursor, gap and catalog behavior. */
export function evaluateEventStream(model, events, {
  sessionOptions, trainingEvents = [], onlineLearning = true,
} = {}) {
  if (typeof onlineLearning !== 'boolean') throw new TypeError('onlineLearning must be boolean.');
  let phase = 'training';
  const predictMs = [];
  const observeMs = [];
  const trackedModel = {
    observe(from, to) {
      if (phase === 'evaluation' && !onlineLearning) return;
      const started = performance.now();
      model.observe(from, to);
      if (phase === 'evaluation') observeMs.push(performance.now() - started);
    },
    predict(from, limit) {
      const started = performance.now();
      const candidates = model.predict(from, limit);
      if (phase === 'evaluation') predictMs.push(performance.now() - started);
      return candidates;
    },
    clear() { model.clear(); },
  };
  const adapter = new SessionPredictor(trackedModel, sessionOptions);
  const lastTrainingOrder = validateEventSequence(trainingEvents, sessionOptions.allowedPages);
  // Validate the complete input before any training or clearing can affect the supplied model.
  validateEventSequence(events, sessionOptions.allowedPages, lastTrainingOrder);
  const pending = new Map();
  const trace = [];
  let opportunities = 0;
  let predictionsMade = 0;
  let hits = 0;
  let candidatesIssued = 0;
  let totalCandidatesIssued = 0;
  let discardedCandidates = 0;
  const visitCounts = { total: 0, accepted: 0, disabled: 0, outOfOrder: 0, firstVisit: 0, gap: 0 };

  function discard(sessionId) {
    discardedCandidates += pending.get(sessionId)?.length ?? 0;
    pending.delete(sessionId);
  }

  function discardAll() {
    for (const sessionId of pending.keys()) discard(sessionId);
  }

  function apply(event, record) {
    let decision = null;
    let outcome = null;
    switch (event.kind) {
      case 'set-enabled':
        adapter.setEnabled(event.enabled);
        if (!event.enabled) discardAll();
        break;
      case 'clear':
        adapter.clear();
        discardAll();
        break;
      case 'end-session':
        adapter.endSession(event.sessionId);
        discard(event.sessionId);
        break;
      case 'visit': {
        decision = adapter.acceptDetailed(event.visit);
        if (!record) break;
        visitCounts.total += 1;
        if (decision.status === 'disabled') visitCounts.disabled += 1;
        else if (decision.status === 'out-of-order') visitCounts.outOfOrder += 1;
        else {
          visitCounts.accepted += 1;
          if (decision.boundary === 'first-visit') visitCounts.firstVisit += 1;
          if (decision.boundary === 'gap') visitCounts.gap += 1;
          if (decision.transition !== null) {
            // Score candidates issued at the previous visit, never a recomputed prediction.
            const candidates = pending.get(event.visit.sessionId) ?? [];
            const hit = candidates.some(candidate => candidate.pageId === event.visit.pageId);
            opportunities += 1;
            if (candidates.length > 0) predictionsMade += 1;
            if (hit) hits += 1;
            candidatesIssued += candidates.length;
            outcome = { ...decision.transition, candidates, hit };
            pending.delete(event.visit.sessionId);
          } else discard(event.visit.sessionId);
          if (decision.evictedSessionId !== null) discard(decision.evictedSessionId);
          pending.set(event.visit.sessionId, decision.candidates);
          totalCandidatesIssued += decision.candidates.length;
        }
        break;
      }
    }
    if (record) trace.push({ event, decision, outcome, sessionState: adapter.getStats() });
  }

  for (const event of trainingEvents) apply(event, false);
  // A temporal evaluation split starts new cursors, preserving learned counts and switch state.
  const enabledAtSplit = adapter.getStats().enabled;
  adapter.setEnabled(false);
  adapter.setEnabled(enabledAtSplit);
  const initialState = model.getStats?.() ?? null;
  phase = 'evaluation';
  for (const event of events) apply(event, true);
  const unresolvedCandidates = [...pending.values()].reduce((sum, items) => sum + items.length, 0);
  return {
    metrics: {
      opportunities, predictionsMade, hits,
      coverage: opportunities === 0 ? null : predictionsMade / opportunities,
      hitRateAll: opportunities === 0 ? null : hits / opportunities,
      hitRateWhenPredicted: predictionsMade === 0 ? null : hits / predictionsMade,
    },
    misses: predictionsMade - hits, candidatesIssued, unusedCandidates: candidatesIssued - hits,
    totalCandidatesIssued, discardedCandidates, unresolvedCandidates, visitCounts,
    evaluationBoundary: 'reset-session-cursors-preserve-model-and-enabled-state',
    initialState, finalState: model.getStats?.() ?? null,
    finalSessionState: adapter.getStats(), trace,
    hostTiming: { unit: 'ms', predictMs, observeMs },
  };
}
