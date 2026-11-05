import assert from 'node:assert/strict';
import test from 'node:test';
import { DataPreloadScheduler, PredictionPreloadController } from '../dist/preload/index.js';
import { createPredictionEngine } from '../dist/prediction/index.js';
import { deferred, lease, ManualRuntime, request, settle, setup } from './preload-helpers.mjs';

test('preload is opt-in and explicit idle plus no foreground/memory pressure are required', async () => {
  const { scheduler, operations, idle } = setup();
  scheduler.setEnabled(false);
  scheduler.enqueue(request('off'));
  assert.equal(scheduler.getTask('off').cancelReason, 'disabled');
  scheduler.setEnabled(true);
  scheduler.enqueue(request('one'));
  await settle(); assert.equal(operations.length, 0);
  scheduler.setEnvironment({ idle: true, foregroundBusy: true, memoryPressure: false });
  await settle(); assert.equal(operations.length, 0);
  idle(); await settle(); assert.equal(operations.length, 1);
  operations[0].resolve(lease()); await settle();
  scheduler.clear();
});

test('priority descends, ties are FIFO, and only one physical operation executes', async () => {
  const { scheduler, operations, idle } = setup();
  scheduler.enqueue(request('low', { priority: -1 }));
  scheduler.enqueue(request('first', { priority: 10 }));
  scheduler.enqueue(request('second', { priority: 10 }));
  idle(); await settle();
  assert.deepEqual(operations.map(op => op.request.taskId), ['first']);
  operations[0].resolve(lease()); await settle();
  assert.deepEqual(operations.map(op => op.request.taskId), ['first', 'second']);
  operations[1].resolve(lease()); await settle();
  assert.equal(operations[2].request.taskId, 'low');
  operations[2].resolve(lease()); await settle(); scheduler.clear();
});

test('data ownership transfers once and cancellation cannot dispose a foreground lease', async () => {
  const { scheduler, operations, idle, runtime, events } = setup();
  idle(); scheduler.enqueue(request('one')); await settle();
  const data = lease(); operations[0].resolve(data); await settle();
  const taken = scheduler.take('one');
  assert.equal(taken.data, data);
  assert.equal(scheduler.take('one'), undefined);
  scheduler.cancel('one', 'prediction-miss'); scheduler.clear(); runtime.advance(10000);
  assert.equal(data.disposals, 0);
  assert.equal(scheduler.getStats().heldBytes, 0);
  taken.dispose(); taken.dispose(); assert.equal(data.disposals, 1);
  assert.deepEqual(events.map(event => event.state), ['queued', 'running', 'data-ready', 'consumed']);
});

test('same task is idempotent, content keys isolate details, sessions isolate duplicate suppression', async () => {
  const { scheduler, operations, idle } = setup();
  const input = request('one'); scheduler.enqueue(input); scheduler.enqueue(input);
  input.priority = 999;
  assert.equal(scheduler.getTask('one').request.priority, 1);
  assert.throws(() => scheduler.enqueue(request('one', { dataKey: 'different' })), TypeError);
  scheduler.enqueue(request('alias', { dataKey: 'one' }));
  assert.equal(scheduler.getTask('alias').cancelReason, 'superseded');
  scheduler.enqueue(request('two'));
  scheduler.enqueue(request('other-session', { dataKey: 'one', sessionId: 'other' }));
  idle(); await settle();
  for (let i = 0; i < 3; i++) { operations[i].resolve(lease()); await settle(); }
  assert.equal(operations.length, 3); scheduler.clear();
});

test('queued cancellation never starts a fetch; repeated/unknown cancellation is safe', async () => {
  const { scheduler, operations, idle } = setup();
  scheduler.enqueue(request('one')); scheduler.cancel('one', 'prediction-miss');
  scheduler.cancel('one', 'expired'); scheduler.cancel('missing', 'expired');
  idle(); await settle();
  assert.equal(operations.length, 0);
  assert.equal(scheduler.getTask('one').cancelReason, 'prediction-miss');
});

test('cancel retains the physical slot until settlement and disposes a late result without D', async () => {
  let prepares = 0;
  const { scheduler, operations, idle } = setup({}, { prepare() { prepares++; }, cancel() {} });
  idle(); scheduler.enqueue(request('one')); scheduler.enqueue(request('two')); await settle();
  scheduler.cancel('one', 'foreground-work'); scheduler.cancel('one', 'expired');
  await settle();
  assert.deepEqual(operations[0].cancellations, ['foreground-work']);
  assert.equal(scheduler.getStats().physicalBusy, true); assert.equal(operations.length, 1);
  const data = lease(); operations[0].resolve(data); await settle();
  assert.equal(data.disposals, 1); assert.equal(prepares, 0); assert.equal(operations.length, 2);
  scheduler.cancel('two', 'disabled'); operations[1].reject(new Error('abort')); await settle();
  assert.equal(scheduler.getTask('one').state, 'cancelled');
});

test('cancel after resolve but before its microtask wins over fetch completion', async () => {
  const { scheduler, operations, idle } = setup(); idle(); scheduler.enqueue(request('one')); await settle();
  const data = lease(); operations[0].resolve(data); scheduler.cancel('one', 'prediction-miss'); await settle();
  assert.equal(data.disposals, 1); assert.equal(scheduler.take('one'), undefined);
});

test('foreground work and idle withdrawal stop running speculation but do not restart cancelled tasks', async () => {
  for (const environment of [
    { idle: true, foregroundBusy: true, memoryPressure: false },
    { idle: false, foregroundBusy: false, memoryPressure: false },
  ]) {
    const { scheduler, operations, idle } = setup(); idle(); scheduler.enqueue(request('one')); await settle();
    scheduler.setEnvironment(environment); idle();
    operations[0].resolve(lease()); await settle();
    assert.equal(scheduler.getTask('one').cancelReason, 'foreground-work'); assert.equal(operations.length, 1);
  }
});

test('fetch rejection, invalid leases, and synchronous start failures fail without blocking the queue', async () => {
  for (const value of [undefined, { value: {}, byteLength: -1, dispose() {} }, { value: {}, byteLength: Infinity, dispose() {} }]) {
    const { scheduler, operations, idle } = setup(); idle(); scheduler.enqueue(request('bad')); await settle();
    operations[0].resolve(value); await settle();
    assert.equal(scheduler.getTask('bad').failure, 'invalid-data'); assert.equal(scheduler.getStats().heldBytes, 0);
  }
  let calls = 0;
  const scheduler = new DataPreloadScheduler({ start() { calls++; throw new Error('private details'); } }, new ManualRuntime());
  const events = []; scheduler.subscribe(event => events.push(event)); scheduler.setEnabled(true);
  scheduler.enqueue(request('bad')); scheduler.enqueue(request('next'));
  scheduler.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false }); await settle();
  assert.equal(calls, 2); assert.equal(scheduler.getTask('next').failure, 'fetch');
  assert.equal(JSON.stringify(events).includes('private details'), false);
  const h = setup(); h.idle(); h.scheduler.enqueue(request('rejected')); await settle();
  h.operations[0].reject(new Error('network')); await settle();
  assert.equal(h.scheduler.getTask('rejected').failure, 'fetch');
});

test('timeout cancels the transport, preserves failure, and releases late data', async () => {
  const { scheduler, operations, runtime, idle } = setup({ timeoutMs: 10 }); idle(); scheduler.enqueue(request('one')); await settle();
  runtime.advance(10);
  assert.equal(scheduler.getTask('one').failure, 'timeout');
  assert.deepEqual(operations[0].cancellations, ['timeout']);
  const data = lease(); operations[0].resolve(data); await settle();
  assert.equal(data.disposals, 1); assert.equal(scheduler.getTask('one').state, 'failed');
});

test('TTL covers queue and ready cache; delayed timer dispatch cannot revive expired data', async () => {
  const h = setup({ ttlMs: 10 }); h.scheduler.enqueue(request('queued')); h.runtime.advance(10);
  assert.equal(h.scheduler.getTask('queued').cancelReason, 'expired');
  h.idle(); h.scheduler.enqueue(request('ready')); await settle();
  const data = lease(); h.operations[0].resolve(data); await settle(); h.runtime.advance(10, false);
  assert.equal(h.scheduler.take('ready'), undefined); assert.equal(data.disposals, 1);
  const delayed = setup({ ttlMs: 10 }); delayed.idle(); delayed.scheduler.enqueue(request('late')); await settle();
  delayed.runtime.advance(11, false); const lateData = lease(); delayed.operations[0].resolve(lateData); await settle();
  assert.equal(delayed.scheduler.getTask('late').cancelReason, 'expired'); assert.equal(lateData.disposals, 1);
});

test('elapsed timeout is checked before accepting data even when timers have not dispatched', async () => {
  const { scheduler, runtime, operations, idle } = setup({ timeoutMs: 10 }); idle(); scheduler.enqueue(request('one')); await settle();
  runtime.advance(11, false); const data = lease(); operations[0].resolve(data); await settle();
  assert.equal(scheduler.getTask('one').failure, 'timeout'); assert.equal(data.disposals, 1);
});

test('bounded bytes evict oldest ready lease and reject an oversized response', async () => {
  const h = setup({ maxBytes: 6 }); h.idle();
  h.scheduler.enqueue(request('one')); await settle(); const one = lease(); h.operations[0].resolve(one); await settle();
  h.scheduler.enqueue(request('two')); await settle(); h.operations[1].resolve(lease()); await settle();
  assert.equal(one.disposals, 1); assert.equal(h.scheduler.getTask('one').cancelReason, 'memory-pressure');
  assert.equal(h.scheduler.getStats().heldBytes, 4);
  h.scheduler.enqueue(request('large')); await settle(); const large = lease({}, 7); h.operations[2].resolve(large); await settle();
  assert.equal(large.disposals, 1); assert.equal(h.scheduler.getTask('large').failure, 'budget'); h.scheduler.clear();
});

test('capacity counts unsettled cancelled tasks, history is bounded, and clear forgets history after late settlement', async () => {
  const h = setup({ maxTasks: 1, historyLimit: 2 }); h.idle(); h.scheduler.enqueue(request('one')); await settle();
  h.scheduler.cancel('one', 'expired'); h.scheduler.enqueue(request('two'));
  assert.equal(h.scheduler.getTask('two').failure, 'capacity');
  h.scheduler.clear(); h.operations[0].resolve(lease()); await settle();
  assert.equal(h.scheduler.getTask('one'), undefined); assert.equal(h.scheduler.getStats().historySize, 0);
  h.scheduler.setEnabled(false);
  for (let i = 0; i < 10; i++) h.scheduler.enqueue(request(`off-${i}`));
  assert.equal(h.scheduler.getStats().historySize, 2);
});

test('session end is isolated; disable, clear and memory pressure invalidate all owned work', async () => {
  for (const [action, reason] of [
    [s => s.setEnabled(false), 'disabled'], [s => s.clear(), 'cleared'],
    [s => s.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: true }), 'memory-pressure'],
  ]) {
    const h = setup(); h.idle(); h.scheduler.enqueue(request('ready')); await settle(); const data = lease();
    h.operations[0].resolve(data); await settle(); h.scheduler.enqueue(request('running')); await settle();
    action(h.scheduler); assert.equal(data.disposals, 1);
    assert.equal(h.scheduler.getTask('running').cancelReason, reason);
    h.operations[1].reject(new Error('abort')); await settle(); assert.equal(h.scheduler.getStats().retainedTasks, 0);
  }
  const h = setup(); h.scheduler.enqueue(request('a')); h.scheduler.enqueue(request('b', { sessionId: 'other' }));
  h.scheduler.endSession('s'); assert.equal(h.scheduler.getTask('a').cancelReason, 'session-ended');
  assert.equal(h.scheduler.getTask('b').state, 'queued'); h.scheduler.clear();
});

test('D receives fetched data, publishes matching view, and foreground owns both leases', async () => {
  const ready = deferred(); let borrowed;
  const h = setup({}, { prepare(req, data) { borrowed = data; return ready.promise; }, cancel() {} });
  h.idle(); h.scheduler.enqueue(request('one')); await settle(); const data = lease(); h.operations[0].resolve(data); await settle();
  assert.equal(borrowed, data); assert.equal(h.scheduler.take('one'), undefined);
  let viewDisposals = 0; const view = { taskId: 'one', pageId: 'detail', dispose() { viewDisposals++; } };
  ready.resolve(view); await settle(); const bundle = h.scheduler.take('one'); assert.equal(bundle.view, view);
  h.scheduler.clear(); assert.equal(viewDisposals, 0); bundle.dispose(); bundle.dispose();
  assert.equal(viewDisposals, 1); assert.equal(data.disposals, 1);
  assert.equal(h.scheduler.getStats().transitions['data-ready'], 1);
});

test('D cancellation keeps borrowed data alive until late view settles, then releases both', async () => {
  const ready = deferred(); const cancellations = [];
  const h = setup({}, { prepare() { return ready.promise; }, cancel(...args) { cancellations.push(args); } });
  h.idle(); h.scheduler.enqueue(request('one')); await settle(); const data = lease(); h.operations[0].resolve(data); await settle();
  h.scheduler.cancel('one', 'prediction-miss'); assert.equal(data.disposals, 0);
  assert.equal(h.scheduler.getStats().heldBytes, 4); assert.deepEqual(cancellations, [['one', 'prediction-miss']]);
  let disposals = 0; ready.resolve({ taskId: 'one', pageId: 'detail', dispose() { disposals++; } }); await settle();
  assert.equal(disposals, 1); assert.equal(data.disposals, 1); assert.equal(h.scheduler.getStats().heldBytes, 0);
  assert.equal(h.scheduler.getTask('one').state, 'cancelled');
});

test('D rejection or mismatched view cleans up and fails without poisoning later tasks', async () => {
  for (const mismatch of [false, true]) {
    const ready = deferred(); const h = setup({}, { prepare() { return ready.promise; }, cancel() {} });
    h.idle(); h.scheduler.enqueue(request('one')); await settle(); const data = lease(); h.operations[0].resolve(data); await settle();
    let viewDisposals = 0;
    if (mismatch) ready.resolve({ taskId: 'wrong', pageId: 'detail', dispose() { viewDisposals++; } });
    else ready.reject(new Error('D failed'));
    await settle(); assert.equal(h.scheduler.getTask('one').failure, 'prepare'); assert.equal(data.disposals, 1);
    assert.equal(viewDisposals, mismatch ? 1 : 0); assert.equal(h.scheduler.getStats().physicalBusy, false);
  }
});

test('D timeout and expiry cannot publish a late view', async () => {
  for (const options of [{ timeoutMs: 10 }, { ttlMs: 10 }]) {
    const ready = deferred(); const h = setup(options, { prepare() { return ready.promise; }, cancel() {} });
    h.idle(); h.scheduler.enqueue(request('one')); await settle(); const data = lease(); h.operations[0].resolve(data); await settle();
    h.runtime.advance(11, false); let disposed = 0;
    ready.resolve({ taskId: 'one', pageId: 'detail', dispose() { disposed++; } }); await settle();
    assert.equal(h.scheduler.take('one'), undefined); assert.equal(disposed, 1); assert.equal(data.disposals, 1);
  }
});

test('observer reentrancy can cancel before transport starts and take at readiness', async () => {
  const h = setup(); h.idle();
  h.scheduler.subscribe(event => { if (event.state === 'running') h.scheduler.cancel(event.request.taskId, 'disabled'); });
  h.scheduler.enqueue(request('one')); await settle(); assert.equal(h.operations.length, 0);
  const next = setup(); next.idle(); let bundle;
  next.scheduler.subscribe(event => { if (event.state === 'data-ready') bundle = next.scheduler.take(event.request.taskId); });
  next.scheduler.enqueue(request('two')); await settle(); const data = lease(); next.operations[0].resolve(data); await settle();
  assert.ok(bundle); assert.equal(next.scheduler.getTask('two').state, 'consumed'); assert.equal(data.disposals, 0); bundle.dispose();
});

test('throwing observers, cancellation handles and disposal cannot strand scheduler resources', async () => {
  const h = setup(); h.scheduler.subscribe(() => { throw new Error('observer'); }); h.idle();
  h.scheduler.enqueue(request('one')); await settle(); h.operations[0].cancel = () => { throw new Error('abort'); };
  h.scheduler.cancel('one', 'expired'); const data = lease(); data.dispose = () => { throw new Error('cleanup'); };
  h.operations[0].resolve(data); await settle();
  assert.equal(h.scheduler.getStats().cancelErrors, 1); assert.equal(h.scheduler.getStats().cleanupErrors, 1);
  assert.ok(h.scheduler.getStats().observerErrors > 0); assert.equal(h.scheduler.getStats().physicalBusy, false);
});

test('invalid configuration/request/environment cannot start or alter existing work', () => {
  for (const options of [{ timeoutMs: 0 }, { ttlMs: Infinity }, { maxTasks: 1.5 }, { maxBytes: -1 }, { historyLimit: 0 }, { unknown: 1 }]) {
    assert.throws(() => setup(options));
  }
  const h = setup();
  for (const extra of [{ taskId: '' }, { pageId: '' }, { sessionId: '' }, { dataKey: '' }, { priority: NaN }]) {
    assert.throws(() => h.scheduler.enqueue(request('bad', extra)));
  }
  assert.throws(() => h.scheduler.setEnvironment({ idle: true }));
  assert.throws(() => h.scheduler.setEnabled('yes'));
  assert.throws(() => h.scheduler.cancel('none', 'unknown'));
  assert.equal(h.scheduler.getStats().retainedTasks, 0);
});

test('controller matches previous exact content before next top-one candidate; empty candidates still clean up', async () => {
  const h = setup(); const controller = new PredictionPreloadController(h.scheduler); h.idle();
  const target = { pageId: 'detail', dataKey: 'item-1', priority: 5 };
  controller.visit('s', { pageId: 'list', dataKey: 'list' }, [target, { ...target, dataKey: 'unused' }]); await settle();
  assert.equal(h.operations.length, 1); const data = lease(); h.operations[0].resolve(data); await settle();
  const bundle = controller.visit('s', target, []); assert.equal(bundle.data, data); bundle.dispose();
  controller.visit('s', target, [target]); await settle();
  controller.visit('s', { ...target, dataKey: 'item-2' }, []);
  assert.equal(h.scheduler.getTask('prediction-2').cancelReason, 'prediction-miss');
  const late = lease(); h.operations[1].resolve(late); await settle(); assert.equal(late.disposals, 1);
});

test('controller bounds sessions and synchronizes disable/clear/end with the scheduler', () => {
  const h = setup(); const controller = new PredictionPreloadController(h.scheduler, 1);
  const target = { pageId: 'detail', dataKey: 'one', priority: 1 };
  controller.visit('s1', target, [target]); controller.visit('s2', target, [target]);
  assert.equal(h.scheduler.getTask('prediction-1').cancelReason, 'session-ended');
  controller.setEnabled(false); assert.equal(h.scheduler.getTask('prediction-2').cancelReason, 'disabled');
  controller.setEnabled(true); controller.visit('s1', target, [target]); controller.endSession('s1');
  assert.equal(h.scheduler.getTask('prediction-3').cancelReason, 'session-ended');
  controller.clear(); assert.equal(h.scheduler.getStats().historySize, 0);
});

test('real B predictions drive C without duplicate learning or future-path knowledge', async () => {
  const { session, model } = createPredictionEngine(['list', 'detail']);
  session.setEnabled(true);
  session.accept({ sessionId: 'training', pageId: 'list', monotonicMs: 0 });
  session.accept({ sessionId: 'training', pageId: 'detail', monotonicMs: 1 });
  const h = setup(); const controller = new PredictionPreloadController(h.scheduler); h.idle();
  const decision = session.acceptDetailed({ sessionId: 'live', pageId: 'list', monotonicMs: 0 });
  controller.visit('live', { pageId: 'list', dataKey: 'list' }, decision.candidates.map((p, i) => ({ pageId: p.pageId, dataKey: 'item-1', priority: -i })));
  await settle(); assert.equal(h.operations[0].request.pageId, 'detail');
  const data = lease(); h.operations[0].resolve(data); await settle();
  const bundle = controller.visit('live', { pageId: 'detail', dataKey: 'item-1' }, []);
  assert.ok(bundle);
  assert.equal(model.getStats().observations, 1);
  bundle.dispose();
});

test('expiry observers cannot start cancelled queue snapshots or work after withdrawing idle', async () => {
  const h = setup({ ttlMs: 10 });
  h.scheduler.enqueue(request('expired')); h.runtime.advance(5, false); h.scheduler.enqueue(request('pending'));
  h.runtime.advance(6, false);
  h.scheduler.subscribe(event => {
    if (event.request.taskId === 'expired' && event.state === 'cancelled') {
      h.scheduler.cancel('pending', 'disabled'); h.scheduler.setEnabled(false);
    }
  });
  h.idle(); await settle(); assert.equal(h.operations.length, 0);
  assert.equal(h.scheduler.getTask('pending').state, 'cancelled');
});

test('clear rejects reentrant observer work and does not restore deleted history', () => {
  const h = setup(); h.scheduler.enqueue(request('one'));
  h.scheduler.subscribe(event => {
    if (event.request.taskId === 'one' && event.cancelReason === 'cleared') h.scheduler.enqueue(request('reentrant'));
  });
  h.scheduler.clear(); assert.equal(h.scheduler.getStats().retainedTasks, 0); assert.equal(h.scheduler.getStats().historySize, 0);
});

test('start can synchronously cancel before returning its transport handle', async () => {
  const pending = deferred(); let scheduler; let cancelled = 0;
  scheduler = new DataPreloadScheduler({
    start() {
      scheduler.cancel('one', 'foreground-work');
      return { result: pending.promise, cancel() { cancelled++; } };
    },
  }, new ManualRuntime());
  scheduler.setEnabled(true); scheduler.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false });
  scheduler.enqueue(request('one')); await settle(); const data = lease(); pending.resolve(data); await settle();
  assert.equal(cancelled, 1); assert.equal(data.disposals, 1); assert.equal(scheduler.getTask('one').state, 'cancelled');
});

test('all observers receive ordered transitions when another observer cancels at readiness', async () => {
  const h = setup(); const observed = [];
  h.scheduler.subscribe(event => {
    if (event.state === 'data-ready') h.scheduler.cancel(event.request.taskId, 'prediction-miss');
  });
  h.scheduler.subscribe(event => observed.push(event.state));
  h.idle(); h.scheduler.enqueue(request('one')); await settle();
  const data = lease(); h.operations[0].resolve(data); await settle();
  assert.deepEqual(observed, ['queued', 'running', 'data-ready', 'cancelled']);
  assert.equal(data.disposals, 1);
});

test('initial environment statistics cannot be mutated to bypass explicit idle admission', async () => {
  const h = setup(); const environment = h.scheduler.getStats().environment;
  assert.ok(Object.isFrozen(environment));
  assert.throws(() => { environment.idle = true; }, TypeError);
  h.scheduler.enqueue(request('one')); await settle();
  assert.equal(h.operations.length, 0); h.scheduler.clear();
});

test('expiry observer requests participate in priority arbitration before dispatch', async () => {
  const h = setup({ ttlMs: 10 });
  h.scheduler.enqueue(request('expired', { priority: 10 }));
  h.runtime.advance(5, false); h.scheduler.enqueue(request('low', { priority: 0 })); h.runtime.advance(6, false);
  h.scheduler.subscribe(event => {
    if (event.request.taskId === 'expired' && event.state === 'cancelled') h.scheduler.enqueue(request('high', { priority: 100 }));
  });
  h.idle(); await settle();
  assert.equal(h.operations[0].request.taskId, 'high');
  h.operations[0].resolve(lease()); await settle();
  assert.equal(h.operations[1].request.taskId, 'low');
  h.operations[1].resolve(lease()); await settle(); h.scheduler.clear();
});

test('environment snapshots strip unrelated fields and option validation rejects prototype names', () => {
  const h = setup();
  h.scheduler.setEnvironment({ idle: false, foregroundBusy: false, memoryPressure: false, userData: 'private' });
  assert.equal('userData' in h.scheduler.getStats().environment, false);
  assert.throws(() => setup({ toString: 1 }), TypeError);
});
