const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PostingPlan } = require('../src/posting-plan.cjs');
const { PostingWorker } = require('../src/posting-worker.cjs');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-facebook-'));
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  const account = { id: 'facebook-page', platform: 'facebook', name: 'Página teste', facebookPageId: '123' };
  plan.configure(account.id, { mode: 'fixed', times: ['12:00'], variationMinutes: 0, timeZone: 'America/Sao_Paulo' });
  return { dir, plan, account, close() { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
test('Facebook mantém fila própria de texto e não duplica item vindo do Instagram', () => {
  const f = fixture();
  try {
    const video = path.join(f.dir, 'reel.mp4'); fs.writeFileSync(video, 'video');
    f.plan.addFacebook(f.account.id, { type: 'text', caption: 'Olá Facebook' }, f.account.name);
    f.plan.addFacebook(f.account.id, { type: 'reel', file: video, caption: '', sourceItemId: 'instagram-1' }, f.account.name);
    f.plan.addFacebook(f.account.id, { type: 'reel', file: video, caption: '', sourceItemId: 'instagram-1' }, f.account.name);
    assert.equal(f.plan.snapshot().items.length, 2);
    assert.deepEqual(f.plan.snapshot().items.map(item => item.content_type), ['text', 'reel']);
    assert.equal(f.plan.snapshot().schedules[0].account_id, f.account.id);
  } finally { f.close(); }
});
test('Facebook publica texto sem exigir Storage ou conta Instagram', async () => {
  const f = fixture();
  let called = 0;
  const worker = new PostingWorker({ plan: f.plan, storage: {}, auth: {}, facebookAuth: { status: () => ({ connected: true }), token: async () => 'page-token' }, net: {}, getConnection: async () => ({ ses: {} }), getAccount: () => f.account, onChange: () => {}, makePublisher: () => ({ publishFacebookText: async (pageId, token, caption) => { called++; assert.deepEqual([pageId, token, caption], ['123', 'page-token', 'Olá Facebook']); return { id: 'post-1', permalink: 'https://www.facebook.com/post-1' }; } }) });
  try {
    f.plan.addFacebook(f.account.id, { type: 'text', caption: 'Olá Facebook' }, f.account.name);
    f.plan.setStatus(f.account.id, 'running');
    await worker.run(f.account.id);
    assert.equal(called, 1);
    assert.equal(f.plan.snapshot().items[0].status, 'published');
    assert.equal(f.plan.snapshot().items[0].facebook_permalink, 'https://www.facebook.com/post-1');
  } finally { worker.stop(); f.close(); }
});
test('erro durante publicação Facebook vira resultado incerto e não reenvia automaticamente', async () => {
  const f = fixture();
  const worker = new PostingWorker({ plan: f.plan, storage: {}, auth: {}, facebookAuth: { status: () => ({ connected: true }), token: async () => 'page-token' }, net: {}, getConnection: async () => ({ ses: {} }), getAccount: () => f.account, onChange: () => {}, makePublisher: () => ({ publishFacebookText: async () => { throw new Error('Conexão perdida'); } }) });
  try {
    f.plan.addFacebook(f.account.id, { type: 'text', caption: 'Olá Facebook' }, f.account.name);
    f.plan.setStatus(f.account.id, 'running');
    await worker.run(f.account.id);
    assert.equal(f.plan.snapshot().items[0].status, 'uncertain');
  } finally { worker.stop(); f.close(); }
});
