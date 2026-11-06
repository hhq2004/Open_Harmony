import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceViewPreparer } from '../dist/preparation/index.js';
import { deferred, lease, request, settle, setup } from './preload-helpers.mjs';

// Test-only bridge: transfer D's view out of its cache before returning it to C.
// A platform bridge must also define aggregate view budgets and native data binding.
function connect(builder, options = {}) {
  let now = () => 0;
  const borrowed = new Map();
  const views = new ResourceViewPreparer((input, context) => builder(input, borrowed.get(input.taskId), context), {
    now: () => now(),
  });
  const adapter = {
    async prepare(input, data) {
      borrowed.set(input.taskId, data);
      try {
        const prepared = await views.prepare(input);
        const transferred = views.take(input.pageId);
        assert.equal(transferred, prepared);
        return transferred;
      } finally { borrowed.delete(input.taskId); }
    },
    cancel(taskId, reason) { views.cancel(taskId, reason === 'timeout' ? 'expired' : reason); },
  };
  const host = setup(options, adapter);
  now = () => host.runtime.now();
  return { ...host, views, borrowed };
}

function nativeView(id) {
  let disposals = 0;
  return { resource: { id }, estimatedBytes: 16, dispose() { disposals++; }, get disposals() { return disposals; } };
}

test('C and D share exact fetched content and transfer view identity without a second cache', async () => {
  const native = new Map();
  const host = connect((input, data) => {
    assert.equal(data.value.id, input.dataKey);
    const built = nativeView(data.value.id);
    native.set(input.taskId, built);
    return built;
  });
  host.idle();
  for (const taskId of ['first', 'second']) {
    host.scheduler.enqueue(request(taskId));
    await settle();
    host.operations.at(-1).resolve(lease({ id: taskId }));
    await settle();
    assert.equal(host.scheduler.getTask(taskId).viewReady, true);
  }
  assert.equal(host.views.getStats().cachedViews, 0);
  assert.equal(host.borrowed.size, 0);
  const foreground = host.scheduler.take('first');
  assert.equal(foreground.view.resource, native.get('first').resource);
  host.scheduler.setEnvironment({ idle: false, foregroundBusy: true, memoryPressure: true });
  host.views.releaseAll('memory-pressure');
  assert.equal(native.get('first').disposals, 0);
  assert.equal(native.get('second').disposals, 1);
  foreground.dispose(); foreground.dispose();
  assert.equal(native.get('first').disposals, 1);
  assert.equal(host.scheduler.getStats().heldBytes, 0);
});

for (const reason of [
  'foreground-work', 'prediction-miss', 'memory-pressure', 'expired',
  'disabled', 'cleared', 'session-ended', 'superseded', 'timeout',
]) {
  test(`C forwards ${reason} through D and releases late resources after the borrowed data settles`, async () => {
    const late = deferred();
    let signal;
    const host = connect((_input, data, context) => {
      assert.equal(data.value.id, 'pending');
      signal = context.signal;
      return late.promise;
    }, { timeoutMs: 20, ttlMs: 100 });
    const data = lease({ id: 'pending' });
    const native = nativeView('late');
    host.idle(); host.scheduler.enqueue(request('pending'));
    await settle(); host.operations[0].resolve(data); await settle();
    if (reason === 'timeout') host.runtime.advance(20);
    else host.scheduler.cancel('pending', reason);
    assert.equal(host.scheduler.getStats().cancelErrors, 0);
    assert.equal(signal.cancelled, true);
    assert.equal(signal.reason, reason === 'timeout' ? 'expired' : reason);
    assert.equal(data.disposals, 0);
    assert.equal(host.scheduler.getStats().physicalBusy, true);
    late.resolve(native); await settle();
    assert.equal(native.disposals, 1);
    assert.equal(data.disposals, 1);
    assert.equal(host.borrowed.size, 0);
    assert.equal(host.views.getStats().cachedViews, 0);
    assert.equal(host.views.getStats().pendingViews, 0);
    assert.equal(host.views.getStats().lateResourcesDisposed, 1);
    assert.equal(host.scheduler.getStats().physicalBusy, false);
    assert.equal(host.scheduler.getTask('pending').state, reason === 'timeout' ? 'failed' : 'cancelled');
    if (reason === 'timeout') assert.equal(host.scheduler.getTask('pending').failure, 'timeout');
  });
}

test('a D builder failure reaches C as prepare failure and releases borrowed data', async () => {
  const host = connect(() => { throw new Error('Platform builder failed.'); });
  const data = lease();
  host.idle(); host.scheduler.enqueue(request('failure'));
  await settle(); host.operations[0].resolve(data); await settle();
  assert.equal(host.scheduler.getTask('failure').failure, 'prepare');
  assert.equal(data.disposals, 1);
  assert.equal(host.borrowed.size, 0);
  assert.equal(host.views.getStats().pendingViews, 0);
  assert.equal(host.scheduler.getStats().physicalBusy, false);
});
