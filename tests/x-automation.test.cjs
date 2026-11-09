const { test } = require('node:test');
const assert = require('node:assert/strict');
const { xCampaign, postKey, eligible, ReplyBag, searchURL } = require('../src/x-domain.cjs');
const { XAutomation } = require('../src/x-automation.cjs');
const accounts = [{ id: 'a', platform: 'x' }, { id: 'b', platform: 'x' }, { id: 't', platform: 'tiktok' }];
const base = { hashtags: '#Teste, teste\n#Outro', mode: 'both', search: 'latest', comments: 'Olá\nBom dia', accountIds: ['a'], recent: true, maxAgeMinutes: 50, waitMin: 1, waitMax: 1, hourlyLimit: 10, sessionLimit: 2 };
const post = { id: '123', url: 'https://x.com/author/status/123', author: 'author', at: new Date().toISOString() };
const turn = () => new Promise(r => setImmediate(r));
async function until(fn) { for (let i = 0; i < 500; i++) { if (fn()) return; await turn(); } assert.fail('Condição não atingida'); }
function fixture(overrides = {}, driverOverrides = {}, attempts = []) {
  let now = Date.now();
  const store = { data: { accounts, xCampaign: xCampaign({ ...base, ...overrides }, accounts), xAttempts: attempts }, save() { this.saves = (this.saves || 0) + 1; } };
  const driver = {
    async search() { return { handle: 'me', posts: [post], empty: true }; },
    async more() { return { handle: 'me', posts: [], empty: true }; },
    async inspectPost() { return { handle: 'me', posts: [post] }; },
    async prepare() { return {}; },
    async send(id, p, action, text, prepared, dispatch) { if (!dispatch()) return 'cancelled'; assert.equal(store.data.xAttempts[0].status, 'pending'); assert.ok(store.saves); return 'confirmed'; },
    ...driverOverrides
  };
  const engine = new XAutomation({ store, driver, now: () => now, wait: async ms => { now += ms; await turn(); }, random: () => 0 });
  return { store, engine, driver, advance: ms => { now += ms; } };
}
test('X configuration normalizes hashtags and rejects missing limits / non-X accounts', () => {
  assert.deepEqual(xCampaign(base, accounts).hashtags, ['teste', 'outro']);
  for (const changes of [{ hourlyLimit: '' }, { waitMax: 0 }, { accountIds: ['t'] }, { hashtags: 'wrong tag' }, { mode: 'invalid' }, { comments: '' }]) assert.throws(() => xCampaign({ ...base, ...changes }, accounts));
  assert.deepEqual(xCampaign({ ...base, mode: 'like', comments: '' }, accounts).comments, []);
});
test('X canonical IDs and age filtering fail closed', () => {
  assert.equal(postKey(post.url), '123'); assert.equal(postKey('https://evil.test/a/status/123'), null);
  assert.equal(eligible(post, 'author', base), false); assert.equal(eligible(post, null, base), false);
  assert.equal(eligible({ ...post, at: null }, 'me', base), false);
  assert.equal(eligible({ ...post, ad: true }, 'me', base), false);
  assert.equal(eligible({ ...post, at: new Date(Date.now() - 51 * 60000).toISOString() }, 'me', base), false);
  assert.equal(eligible(post, 'me', base), true);
  assert.match(searchURL('ação', 'latest'), /f=live$/); assert.doesNotMatch(searchURL('ação', 'top'), /f=live/);
});
test('Reply bag consumes each phrase before repeating and avoids adjacent cycles', () => {
  const bag = new ReplyBag(['a', 'b', 'c'], () => 0.5), values = Array.from({ length: 18 }, () => bag.next());
  for (let i = 0; i < 18; i += 3) assert.equal(new Set(values.slice(i, i + 3)).size, 3);
  for (let i = 1; i < values.length; i++) assert.notEqual(values[i], values[i - 1]);
  const single = new ReplyBag(['one']); assert.equal(single.next(), single.next());
});
for (const mode of ['like', 'reply', 'both']) test(`X ${mode}: confirms actions with durable intent`, async () => {
  const { engine, store } = fixture({ mode, sessionLimit: mode === 'both' ? 2 : 1 });
  engine.start(); await engine.completion;
  assert.deepEqual(store.data.xAttempts.map(a => a.action).reverse(), mode === 'both' ? ['reply', 'like'] : [mode]);
  assert.ok(store.data.xAttempts.every(a => a.status === 'confirmed')); assert.equal(engine.status, 'idle');
});
test('Concurrent accounts reserve the shared last action atomically', async () => {
  const { engine, store } = fixture({ accountIds: ['a', 'b'], sessionLimit: 1 });
  engine.start(); await engine.completion; assert.equal(store.data.xAttempts.length, 1); assert.equal(engine.used, 1);
});
test('An uncertain reply does not send a like for that post', async () => {
  const { engine, store } = fixture({}, { async send(id, p, action, text, prep, dispatch) { assert.ok(dispatch()); if (action === 'reply') throw new Error('lost confirmation'); return 'confirmed'; } });
  engine.delay = async () => { engine.stop(); return false; };
  engine.start(); await engine.completion;
  assert.equal(store.data.xAttempts.find(a => a.action === 'like'), undefined);
  assert.equal(store.data.xAttempts.find(a => a.action === 'reply').status, 'unknown');
  assert.equal(engine.seen('a', '123', 'reply'), true);
});
test('Pending actions become uncertain on restart; failures before send remain retryable', () => {
  const { engine, store } = fixture({}, {}, [{ accountId: 'a', postId: '123', action: 'like', status: 'pending' }, { accountId: 'a', postId: '123', action: 'reply', status: 'failed' }]);
  assert.equal(store.data.xAttempts[0].status, 'unknown'); assert.equal(engine.seen('a', '123', 'like'), true); assert.equal(engine.seen('a', '123', 'reply'), false);
});
test('Pause before dispatch and stop do not send an action', async () => {
  let release;
  const ready = new Promise(r => { release = r; });
  const { engine, store } = fixture({}, { async prepare() { await ready; return {}; } });
  engine.start(); await turn(); engine.pause(); release(); await turn();
  assert.equal(store.data.xAttempts.length, 0); engine.stop(); await engine.completion; assert.equal(store.data.xAttempts.length, 0);
});
test('Stop during send waits for confirmation and prevents the next action', async () => {
  let finish;
  const sent = new Promise(r => { finish = r; });
  const { engine, store } = fixture({}, { async send(id, p, a, text, prep, dispatch) { dispatch(); await sent; return 'confirmed'; } });
  engine.start(); await until(() => store.data.xAttempts.length === 1); engine.stop(); assert.equal(engine.status, 'stopping'); finish(); await engine.completion;
  assert.equal(store.data.xAttempts.length, 1); assert.equal(store.data.xAttempts[0].status, 'confirmed');
});
test('An account awaiting manual attention does not block another account', async () => {
  const { engine, store } = fixture({ accountIds: ['a', 'b'], mode: 'like', sessionLimit: 1 }, { async search(id) { if (id === 'a') throw new Error('Login necessário'); return { handle: 'me', posts: [post], empty: true }; } });
  engine.start(); await engine.completion; assert.equal(store.data.xAttempts[0].accountId, 'b');
});
test('Hourly budget waits for sliding-window expiry without resetting history', async () => {
  const old = { accountId: 'a', postId: '999', action: 'like', status: 'confirmed', at: new Date().toISOString() };
  const { engine, store } = fixture({ mode: 'like', hourlyLimit: 1, sessionLimit: 1, recent: false }, {}, [old]);
  engine.start(); await until(() => engine.workers.get('a').status === 'waiting'); assert.equal(store.data.xAttempts.length, 1);
  engine.stop(); await engine.completion; assert.equal(store.data.xAttempts.length, 1);
});
test('Explicit login failure requires manual resume without automatic retries', async () => {
  let calls = 0;
  const { engine } = fixture({}, { async search() { calls++; throw new Error('Login necessário'); } });
  engine.start(); await until(() => engine.workers.get('a').attention);
  assert.equal(calls, 1); assert.equal(engine.isActive(), true);
  engine.resume('a'); await until(() => calls === 2); engine.stop(); await engine.completion;
});
test('Access verification invokes only read operations', async () => {
  const { engine, store } = fixture(); const result = await engine.check(); assert.equal(result[0].ok, true); assert.equal(store.data.xAttempts.length, 0);
});
test('Existing likes are recorded without consuming budget', async () => {
  const { engine, store } = fixture({ mode: 'like', sessionLimit: 1 }, { async prepare() { return { skipped: true }; } });
  engine.start(); await until(() => store.data.xAttempts.length === 1);
  assert.equal(store.data.xAttempts[0].status, 'skipped'); assert.equal(engine.used, 0);
  engine.stop(); await engine.completion;
});
test('Expired hourly entries free capacity while remaining in durable history', async () => {
  const old = { accountId: 'a', postId: '999', action: 'like', status: 'unknown', at: new Date().toISOString() };
  const { engine, store, advance } = fixture({ mode: 'like', recent: false, hourlyLimit: 1, sessionLimit: 1 }, {}, [old]);
  engine.start(); await until(() => engine.workers.get('a').status === 'waiting'); advance(3600000); await engine.completion;
  assert.equal(store.data.xAttempts.length, 2); assert.equal(store.data.xAttempts[1].status, 'unknown'); assert.equal(engine.used, 1);
});
test('Each hashtag round examines at most 20 posts', async () => {
  const posts = Array.from({ length: 30 }, (_, n) => ({ ...post, id: String(100 + n), url: `https://x.com/author/status/${100 + n}` }));
  const { engine } = fixture({ mode: 'like', sessionLimit: 1 }, {
    async search() { return { handle: 'me', posts, empty: false }; },
    async inspectPost(id, p) { return { handle: 'me', posts: [p] }; }
  });
  engine.start(); await engine.completion; assert.equal(engine.workers.get('a').scanned, 20);
});
test('No eligible posts waits 60 seconds after the full hashtag round', async () => {
  const { engine } = fixture({}, { async search() { return { handle: 'me', posts: [], empty: true }; } });
  let delay;
  engine.delay = async (w, ms) => { delay = ms; engine.stop(); return false; };
  engine.start(); await engine.completion; assert.equal(delay, 60000);
});
test('Stopping one paused account leaves the other worker active', async () => {
  const { engine } = fixture({ accountIds: ['a', 'b'] }, { async search() { return { handle: 'me', posts: [], empty: true }; } });
  engine.start(); engine.pause('a'); engine.stopAccount('a');
  await until(() => engine.workers.get('a').done);
  assert.equal(engine.workers.get('b').done, false); assert.equal(engine.isActive(), true);
  engine.stop(); await engine.completion;
});
test('Keyword searches preserve phrases and do not add hashtag prefixes', () => {
  const config = xCampaign({ ...base, targetType: 'search', hashtags: '', queries: 'marketing digital\nnegócios\nmarketing digital' }, accounts);
  assert.deepEqual(config.queries, ['marketing digital', 'negócios']);
  assert.equal(config.search, 'top');
  assert.equal(new URL(searchURL(config.queries[0], 'latest', 'search')).searchParams.get('q'), 'marketing digital filter:media');
  assert.equal(new URL(searchURL(config.queries[0], 'latest', 'search')).searchParams.has('f'), false);
  assert.throws(() => xCampaign({ ...base, targetType: 'search', queries: '' }, accounts));
  assert.throws(() => xCampaign({ ...base, targetType: 'invalid' }, accounts));
});
test('X validates switching interval and preserves legacy configurations', () => {
  assert.equal(xCampaign(base, accounts).targetSwitchMin, 20);
  assert.throws(() => xCampaign({ ...base, targetSwitchMin: 5, targetSwitchMax: 4 }, accounts));
  assert.throws(() => xCampaign({ ...base, targetSwitchMin: '' }, accounts));
});
for (const type of ['hashtag', 'search']) for (const [random, quota] of [[0, 2], [0.999, 4]]) test(`X ${type} switches after drawn quota ${quota}`, async () => {
  let searches = 0; const origins = [];
  const { engine, store } = fixture({ targetType: type, queries: 'primeira frase\nsegunda frase', targetSwitchMin: 2, targetSwitchMax: 4, mode: 'like', sessionLimit: quota + 1 }, {
    async search(id, target) {
      origins.push(target); searches++;
      return { handle: 'me', empty: true, posts: Array.from({ length: 6 }, (_, i) => ({ ...post, id: String(searches * 100 + i), url: `https://x.com/author/status/${searches * 100 + i}` })) };
    },
    async inspectPost(id, p) { return { handle: 'me', posts: [p] }; }
  });
  engine.random = () => random;
  engine.start(); await engine.completion;
  assert.deepEqual(origins, type === 'search' ? ['primeira frase', 'segunda frase'] : ['teste', 'outro']);
  assert.equal(store.data.xAttempts.filter(a => Number(a.postId) < 200).length, quota);
});
for (const targetType of ['search', 'foryou']) test(`X runs and checks source ${targetType}`, async () => {
  const origins = [];
  const { engine } = fixture({ targetType, queries: 'marketing digital', hashtags: '', mode: 'like', sessionLimit: 1 }, {
    async search(id, value, order, type) { origins.push({ value, type }); return { handle: 'me', posts: [post], empty: true }; }
  });
  await engine.check(); engine.start(); await engine.completion;
  assert.equal(origins.length, 2);
  assert.ok(origins.every(o => o.type === targetType && o.value === (targetType === 'foryou' ? 'Para você' : 'marketing digital')));
});
const nextPost = { ...post, id: '124', url: 'https://x.com/author/status/124' };
const twoPosts = {
  async search() { return { handle: 'me', posts: [post, nextPost], empty: true }; },
  async inspectPost(id, p) { return { handle: 'me', posts: [p] }; }
};
test('A failed editor retries once, skips that post and confirms the next without attention', async () => {
  let failedPrepares = 0;
  const { engine, store } = fixture({ mode: 'reply', sessionLimit: 1 }, { ...twoPosts,
    async prepare(id, p) { if (p.id === post.id) { failedPrepares++; throw new Error('Falha ao reconhecer o editor'); } return {}; }
  });
  engine.start(); await engine.completion;
  assert.equal(failedPrepares, 2); assert.equal(store.data.xAttempts.filter(a => a.status === 'failed').length, 2);
  assert.equal(store.data.xAttempts[0].status, 'confirmed'); assert.equal(store.data.xAttempts[0].postId, '124');
  assert.equal(engine.workers.get('a').attention, false);
});
test('An uncertain send is never retried and the next post proceeds automatically', async () => {
  const calls = [];
  const { engine, store } = fixture({ mode: 'reply', sessionLimit: 2 }, { ...twoPosts,
    async send(id, p, action, text, prep, dispatch) { assert.ok(dispatch()); calls.push(p.id); if (p.id === post.id) throw new Error('Confirmação indisponível'); return 'confirmed'; }
  });
  engine.start(); await engine.completion;
  assert.deepEqual(calls, ['123', '124']); assert.equal(store.data.xAttempts[1].status, 'unknown');
  assert.equal(store.data.xAttempts[0].status, 'confirmed'); assert.equal(engine.workers.get('a').attention, false);
  assert.match(store.data.xAttempts[1].message, /Confirmação indisponível/);
});
test('Reply is confirmed before an uncertain like, and the next post still receives a reply', async () => {
  const calls = [];
  const { engine } = fixture({ mode: 'both', sessionLimit: 3 }, { ...twoPosts,
    async send(id, p, action, text, prep, dispatch) { assert.ok(dispatch()); calls.push(`${p.id}:${action}`); if (p.id === post.id && action === 'like') throw new Error('Confirmação indisponível'); return 'confirmed'; }
  });
  engine.start(); await engine.completion;
  assert.deepEqual(calls, ['123:reply', '123:like', '124:reply']);
});
test('Temporary source failure retries and recovers without manual resume', async () => {
  let reads = 0;
  const { engine } = fixture({ mode: 'like', sessionLimit: 1 }, {
    async search() { if (++reads <= 3) throw new Error('ERR_CONNECTION_RESET'); return { handle: 'me', posts: [post], empty: true }; }
  });
  engine.start(); await engine.completion;
  assert.equal(reads, 4); assert.equal(engine.workers.get('a').attention, false); assert.equal(engine.workers.get('a').recoveries, 1);
});
test('Three consecutive failures cause a bounded cooldown that Stop can interrupt', async () => {
  const { engine } = fixture(); engine.config = engine.configFromStore(); engine.status = 'running';
  const w = { id: 'a', failures: 2, recoveries: 0 }; let waited;
  engine.delay = async (worker, ms) => { waited = ms; engine.stop(); return false; };
  assert.equal(await engine.recover(w, 'Falha transitória'), false); assert.equal(waited, 60000); assert.equal(w.failures, 0);
});
test('A restricted account after dispatch remains in attention, preserving uncertain history', async () => {
  const { engine, store } = fixture({ mode: 'like', sessionLimit: 2 }, { ...twoPosts,
    async send(id, p, action, text, prep, dispatch) { dispatch(); throw Object.assign(new Error('O X restringiu a interação'), { code: 'X_MANUAL' }); }
  });
  engine.start(); await until(() => engine.workers.get('a').attention);
  assert.equal(store.data.xAttempts.length, 1); assert.equal(store.data.xAttempts[0].status, 'unknown');
  engine.stop(); await engine.completion;
});
