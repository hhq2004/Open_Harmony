import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ResourceViewPreparer,
  ViewCapacityError,
  ViewPreparationCancelledError,
} from '../dist/preparation/index.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function request(taskId, pageId = taskId, priority = 0) {
  return { taskId, pageId, priority };
}

function builtView(id, estimatedBytes = 100) {
  return {
    resource: { id },
    estimatedBytes,
    disposeCalls: 0,
    dispose() { this.disposeCalls += 1; },
  };
}

test('a built view is reused by identity and taken ownership is released exactly once', async () => {
  const native = builtView('detail-view');
  let builds = 0;
  const preparer = new ResourceViewPreparer(() => { builds += 1; return native; });
  await preparer.prepare(request('task-1', 'detail'));
  const taken = preparer.take('detail');
  assert.equal(taken.resource, native.resource);
  assert.equal(taken.status, 'taken');
  assert.equal(preparer.take('detail'), undefined);
  assert.equal(builds, 1);
  assert.deepEqual(preparer.getStats().cachedViews, 0);
  taken.dispose();
  taken.dispose();
  assert.equal(native.disposeCalls, 1);
  assert.equal(taken.status, 'disposed');
  assert.throws(() => taken.resource, /disposed/);
});

test('prediction misses release every manager-owned view and prevent reuse', async () => {
  const first = builtView('first');
  const second = builtView('second');
  const preparer = new ResourceViewPreparer(({ taskId }) => taskId === 'first' ? first : second);
  await preparer.prepare(request('first'));
  await preparer.prepare(request('second'));
  preparer.releaseAll('prediction-miss');
  assert.equal(first.disposeCalls, 1);
  assert.equal(second.disposeCalls, 1);
  assert.equal(preparer.take('first'), undefined);
  assert.equal(preparer.getStats().cachedBytes, 0);
});

test('cancellation disposes a late resource and rejects without exposing a half-ready view', async () => {
  const pending = deferred();
  const late = builtView('late');
  const preparer = new ResourceViewPreparer(() => pending.promise);
  const preparation = preparer.prepare(request('late-task', 'detail'));
  await Promise.resolve();
  preparer.cancel('late-task', 'prediction-miss');
  pending.resolve(late);
  await assert.rejects(preparation, error => error instanceof ViewPreparationCancelledError
    && error.reason === 'prediction-miss');
  assert.equal(late.disposeCalls, 1);
  assert.equal(preparer.take('detail'), undefined);
  assert.equal(preparer.getStats().lateResourcesDisposed, 1);
  assert.equal(preparer.getStats().cachedViews, 0);
});

test('cancellation before builder startup avoids unnecessary native work', async () => {
  let builds = 0;
  const preparer = new ResourceViewPreparer(() => { builds += 1; return builtView('unexpected'); });
  const preparation = preparer.prepare(request('task'));
  preparer.cancel('task', 'foreground-work');
  await assert.rejects(preparation, ViewPreparationCancelledError);
  assert.equal(builds, 0);
});

test('expiration is checked at the boundary and expired views cannot be taken', async () => {
  let now = 100;
  const native = builtView('old');
  const preparer = new ResourceViewPreparer(() => native, { ttlMs: 20, now: () => now });
  await preparer.prepare(request('old'));
  now = 119;
  assert.equal(preparer.take('old').resource.id, 'old');
  const second = builtView('second');
  const other = new ResourceViewPreparer(() => second, { ttlMs: 20, now: () => now });
  await other.prepare(request('second'));
  now = 139;
  assert.equal(other.take('second'), undefined);
  assert.equal(second.disposeCalls, 1);
  assert.equal(other.getStats().expiredViews, 1);
});

test('releaseExpired removes only stale cache entries', async () => {
  let now = 0;
  const views = [builtView('old'), builtView('fresh')];
  const preparer = new ResourceViewPreparer(() => views.shift(), { ttlMs: 10, now: () => now });
  await preparer.prepare(request('old'));
  now = 9;
  await preparer.prepare(request('fresh'));
  now = 10;
  assert.equal(preparer.releaseExpired(), 1);
  assert.equal(preparer.take('old'), undefined);
  assert.equal(preparer.take('fresh').resource.id, 'fresh');
});

test('capacity eviction uses priority then least recent use', async () => {
  let now = 0;
  const views = new Map();
  const preparer = new ResourceViewPreparer(({ taskId }) => {
    const view = builtView(taskId);
    views.set(taskId, view);
    return view;
  }, { maxPreparedViews: 2, now: () => ++now });
  await preparer.prepare(request('low', 'low', 0));
  await preparer.prepare(request('high', 'high', 10));
  await preparer.prepare(request('middle', 'middle', 5));
  assert.equal(views.get('low').disposeCalls, 1);
  assert.equal(preparer.take('high').resource.id, 'high');
  assert.equal(preparer.take('middle').resource.id, 'middle');
  assert.equal(preparer.getStats().evictedViews, 1);
});

test('duplicate prepare touches an entry so the less recent sibling is evicted', async () => {
  let now = 0;
  const views = new Map();
  const preparer = new ResourceViewPreparer(({ taskId }) => {
    const view = builtView(taskId);
    views.set(taskId, view);
    return view;
  }, { maxPreparedViews: 2, now: () => ++now });
  await preparer.prepare(request('a'));
  await preparer.prepare(request('b'));
  await preparer.prepare(request('a'));
  await preparer.prepare(request('c'));
  assert.equal(views.get('a').disposeCalls, 0);
  assert.equal(views.get('b').disposeCalls, 1);
  assert.equal(views.get('c').disposeCalls, 0);
});

test('byte accounting evicts old views and an oversized newcomer does not flush valid cache', async () => {
  const small = builtView('small', 60);
  const other = builtView('other', 60);
  const huge = builtView('huge', 101);
  const views = new Map([['small', small], ['other', other], ['huge', huge]]);
  const preparer = new ResourceViewPreparer(({ taskId }) => views.get(taskId), { maxPreparedBytes: 100 });
  await preparer.prepare(request('small'));
  await assert.rejects(preparer.prepare(request('huge')), ViewCapacityError);
  assert.equal(huge.disposeCalls, 1);
  assert.equal(small.disposeCalls, 0);
  await preparer.prepare(request('other'));
  assert.equal(small.disposeCalls, 1);
  assert.equal(preparer.getStats().cachedBytes, 60);
});

test('memory pressure leaves taken foreground views alive but cancels pending and cached work', async () => {
  const pending = deferred();
  const takenNative = builtView('taken');
  const cachedNative = builtView('cached');
  const lateNative = builtView('late');
  const preparer = new ResourceViewPreparer(({ taskId }) => {
    if (taskId === 'pending') return pending.promise;
    return taskId === 'taken' ? takenNative : cachedNative;
  });
  await preparer.prepare(request('taken'));
  const foreground = preparer.take('taken');
  await preparer.prepare(request('cached'));
  const latePreparation = preparer.prepare(request('pending'));
  await Promise.resolve();
  preparer.releaseAll('memory-pressure');
  pending.resolve(lateNative);
  await assert.rejects(latePreparation, ViewPreparationCancelledError);
  assert.equal(takenNative.disposeCalls, 0);
  assert.equal(cachedNative.disposeCalls, 1);
  assert.equal(lateNative.disposeCalls, 1);
  foreground.dispose();
  assert.equal(takenNative.disposeCalls, 1);
});

test('a newer task supersedes the same page and an old late result cannot evict it', async () => {
  const oldPending = deferred();
  const newPending = deferred();
  const oldView = builtView('old');
  const newView = builtView('new');
  const preparer = new ResourceViewPreparer(({ taskId }) => taskId === 'old' ? oldPending.promise : newPending.promise);
  const oldPreparation = preparer.prepare(request('old', 'detail'));
  await Promise.resolve();
  const newPreparation = preparer.prepare(request('new', 'detail'));
  await Promise.resolve();
  newPending.resolve(newView);
  await newPreparation;
  oldPending.resolve(oldView);
  await assert.rejects(oldPreparation, ViewPreparationCancelledError);
  assert.equal(oldView.disposeCalls, 1);
  assert.equal(newView.disposeCalls, 0);
  assert.equal(preparer.take('detail').resource.id, 'new');
});

test('duplicate task preparation shares one build and one cached resource', async () => {
  const pending = deferred();
  let builds = 0;
  const preparer = new ResourceViewPreparer(() => { builds += 1; return pending.promise; });
  const first = preparer.prepare(request('same'));
  const second = preparer.prepare(request('same'));
  assert.equal(first, second);
  pending.resolve(builtView('same'));
  assert.equal(await first, await second);
  assert.equal(builds, 1);
  assert.equal(preparer.getStats().cachedViews, 1);
});

test('builder failures propagate, clean bookkeeping and allow an explicit retry', async () => {
  let attempts = 0;
  const native = builtView('retry');
  const preparer = new ResourceViewPreparer(() => {
    attempts += 1;
    if (attempts === 1) throw new Error('native build failed');
    return native;
  });
  await assert.rejects(preparer.prepare(request('retry')), /native build failed/);
  assert.equal(preparer.getStats().pendingViews, 0);
  assert.equal(preparer.take('retry'), undefined);
  const view = await preparer.prepare(request('retry'));
  assert.equal(view.resource, native.resource);
});

test('releaseAll attempts every disposal and reports failures together', async () => {
  const failing = builtView('failing');
  failing.dispose = () => { throw new Error('release failed'); };
  const healthy = builtView('healthy');
  const preparer = new ResourceViewPreparer(({ taskId }) => taskId === 'failing' ? failing : healthy);
  await preparer.prepare(request('failing'));
  await preparer.prepare(request('healthy'));
  assert.throws(() => preparer.releaseAll('memory-pressure'), AggregateError);
  assert.equal(healthy.disposeCalls, 1);
  assert.equal(preparer.getStats().cachedViews, 0);
  preparer.releaseAll('memory-pressure');
});

test('invalid requests, resources, configuration and clocks fail loudly', async () => {
  assert.throws(() => new ResourceViewPreparer(null), TypeError);
  for (const options of [{ maxPreparedViews: 0 }, { maxPreparedBytes: 1.5 }, { ttlMs: Infinity }, { now: () => -1 }]) {
    assert.throws(() => new ResourceViewPreparer(() => builtView('bad'), options));
  }
  const preparer = new ResourceViewPreparer(() => builtView('valid'));
  assert.throws(() => preparer.prepare(request('', 'page')), TypeError);
  assert.throws(() => preparer.prepare(request('task', 'page', NaN)), RangeError);
  assert.throws(() => preparer.cancel('unknown', 'not-a-reason'), TypeError);
  await assert.rejects(new ResourceViewPreparer(() => ({ resource: {}, estimatedBytes: 0, dispose() {} }))
    .prepare(request('bad')), RangeError);
});
