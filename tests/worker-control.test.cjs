const test = require('node:test');
const assert = require('node:assert/strict');
const { Automation } = require('../src/automation.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('explicit cycle restart resets only that account quota and preserves deduplication', () => {
  const a = setup();
  a.store.data.attempts = ['a', 'b'].map(id => ({ id, accountId: id, videoId: '123', status: 'sent', at: new Date().toISOString() }));
  a.workers.set('a', { id: 'a', done: false });
  a.accountProgress.set('a', { accountId: 'a', status: 'waiting', posted: 1 });
  assert.equal(a.restartAccountCycle('a'), true);
  assert.equal(a.hourlyCount('a'), 0); assert.equal(a.hourlyCount('b'), 1);
  assert.equal(a.attemptsFor('a', '123'), true); assert.equal(a.store.data.attempts.length, 2);
  a.store.data.attempts.push({ id: 'new', accountId: 'a', videoId: '456', status: 'unknown', at: new Date().toISOString() });
  assert.equal(a.hourlyCount('a'), 1);
  assert.equal(a.restartAccountCycle('a'), false, 'cannot reset a running account');
});
test('hourly waiting includes uncertain attempts and computes next available slot', () => {
  const a = setup(); const now = Date.now();
  a.store.data.attempts = [{ accountId: 'a', status: 'unknown', at: new Date(now - 1000).toISOString() }, { accountId: 'b', status: 'sent', at: new Date(now).toISOString() }];
  assert.equal(a.hourlyResumeAt('a', 1, now), now + 3599001);
  assert.equal(a.hourlyResumeAt('a', 2, now), now);
});
test('only exact app-owned drafts can be discarded, without submission', async () => {
  const a = setup(); let loads = 0;
  const win = { webContents: { getURL: () => 'https://www.tiktok.com/@news/video/123' } };
  a.load = async () => { loads++; };
  a.evaluate = async (_win, fn) => fn.name === 'inspectDraft' ? { matches: true } : false;
  assert.equal(await a.discardOwnedDraft(win, 'a'), false);
  a.ownedDrafts.set('a', { videoId: '123', url: win.webContents.getURL(), phrase: 'teste' });
  assert.equal(await a.discardOwnedDraft(win, 'a'), true); assert.equal(loads, 1);
  assert.equal(a.store.data.attempts.length, 0);
});
function setup() {
  const automation = new Automation({ store: { data: { accounts: [{ id: 'a', name: 'A' }] }, log() {} } });
  automation.current.status = 'running'; automation.sessionLimit = 100;
  return automation;
}
test('two hung windows timeout independently while third operation completes; late results discarded', async () => {
  const a = setup(); let destroyed = 0; let late;
  const win = { isDestroyed: () => false, destroy: () => destroyed++ };
  const contexts = ['a', 'b', 'c'].map(id => ({ id, generation: 0 }));
  const first = a.execution.run(contexts[0], () => a.bounded(win, 'read', 20, () => new Promise(resolve => { late = resolve; })));
  const second = a.execution.run(contexts[1], () => a.bounded(win, 'navigation', 20, () => new Promise(() => {})));
  const third = a.execution.run(contexts[2], () => a.bounded(win, 'read', 20, async () => 'ready'));
  const results = await Promise.allSettled([first, second, third]);
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected', 'fulfilled']);
  assert.equal(results[2].value, 'ready'); assert.equal(destroyed, 2);
  late('obsolete'); await tick(); assert.equal(contexts[0].generation, 1); assert.equal(contexts[0].needsRecovery, true);
});
test('repeated browser timeouts recover without waiting for Continue', async () => {
  const a = setup();
  const delays = [];
  let runs = 0;
  a.wait = async ms => { delays.push(ms); };
  a.runAccount = async () => {
    if (++runs <= 4) {
      a.execution.getStore().needsRecovery = true;
      throw new Error('Tempo excedido');
    }
  };
  const ctx = { id: 'a', generation: 0 };
  await a.execution.run(ctx, () => a.runAccountRecovering('a', { sessionLimit: 100 }));
  assert.equal(runs, 5);
  assert.deepEqual(delays, [2000, 5000, 10000, 20000]);
  assert.equal(a.attentionAccounts.size, 0);
});
test('individual pause blocks only its worker and resumes without losing state', async () => {
  const a = setup(); const state = { pending: { videoId: '123', skip: false }, queue: ['456'] };
  const ctx = { id: 'a', generation: 0, state }; a.workers.set('a', ctx);
  a.pauseAccount('a'); let advanced = false;
  const pending = a.execution.run(ctx, async () => { await a.checkpoint(); advanced = true; });
  await tick(); assert.equal(advanced, false);
  await a.execution.run({ id: 'b' }, () => a.checkpoint());
  a.resumeAccount('a'); await pending;
  assert.equal(advanced, true); assert.equal(ctx.state, state);
});
test('individual pause defers during submission and stop releases the waiter', async () => {
  const a = setup(); const ctx = { id: 'a', confirming: true }; a.workers.set('a', ctx);
  a.pauseAccount('a'); await a.execution.run(ctx, () => a.checkpoint());
  ctx.confirming = false;
  const pending = a.execution.run(ctx, () => a.checkpoint());
  await tick(); a.stop(); await assert.rejects(pending, /interrompida/);
});
test('global pause still blocks a resumed individual account', async () => {
  const a = setup(); const ctx = { id: 'a' }; a.workers.set('a', ctx);
  a.pauseAccount('a'); a.pause(); let advanced = false;
  const pending = a.execution.run(ctx, async () => { await a.checkpoint(); advanced = true; });
  a.resumeAccount('a'); await tick(); assert.equal(advanced, false);
  a.resume(); await pending; assert.equal(advanced, true);
});
