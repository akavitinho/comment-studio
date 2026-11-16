const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PostingPlan, validateConfig } = require('../src/posting-plan.cjs');
const fixed = { mode: 'fixed', times: ['10:00', '16:00'], variationMinutes: 0, timeZone: 'America/Sao_Paulo' };
function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fixed-'));
  const file = path.join(dir, 'postings.sqlite');
  let plan = new PostingPlan(file);
  try { run({ dir, file, get plan() { return plan; }, reopen() { plan.close(); plan = new PostingPlan(file); return plan; } }); }
  finally { try { plan.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); }
}
test('horários fixos validam duplicatas e janelas sobrepostas', () => {
  assert.deepEqual(validateConfig({ ...fixed, times: ['16:00', '10:00'] }).times, ['10:00', '16:00']);
  assert.throws(() => validateConfig({ ...fixed, times: ['10:00', '10:00'] }), /repita/);
  assert.throws(() => validateConfig({ ...fixed, times: ['10:00', '10:30'], variationMinutes: 20 }), /sobrepor/);
});
test('cada horário é persistido uma vez e respeita o fuso', () => fixture(ctx => {
  ctx.plan.configure('a', fixed);
  const at = ctx.plan.scheduleFixed('a', new Date('2026-11-11T12:00:00Z'));
  assert.equal(at, '2026-11-11T13:00:00.000Z');
  assert.equal(ctx.reopen().scheduleFixed('a', new Date('2026-11-11T12:00:00Z'), { preserve: true }), at);
  ctx.plan.configure('b', { ...fixed, times: ['10:00'], variationMinutes: 20 });
  ctx.plan.ensureFixedSlots('b', '2026-11-15', { ...fixed, times: ['10:00'], variationMinutes: 20 }, () => 0);
  const saved = ctx.plan.db.prepare('SELECT planned_at FROM fixed_posting_slots WHERE account_id=? AND local_date=?').get('b', '2026-11-15').planned_at;
  assert.equal(saved, '2026-11-15T12:40:00.000Z');
  const preview = ctx.plan.preview('b', { ...fixed, times: ['10:00'], variationMinutes: 20 });
  assert.deepEqual(ctx.plan.preview('b', { ...fixed, times: ['10:00'], variationMinutes: 20 }), preview);
  assert.equal(ctx.reopen().db.prepare('SELECT planned_at FROM fixed_posting_slots WHERE account_id=? AND local_date=?').get('b', '2026-11-15').planned_at, saved);
  assert.deepEqual(ctx.plan.preview('b', { ...fixed, times: ['10:00'], variationMinutes: 20 }), preview);
}));
test('horário perdido aguarda próximo slot; após o último aplica três horas e mantém vídeo', () => fixture(ctx => {
  ctx.plan.configure('a', fixed);
  const video = path.join(ctx.dir, 'reel.mp4'); fs.writeFileSync(video, 'x'); ctx.plan.add('a', video, '');
  assert.equal(ctx.plan.setStatus('a', 'running', new Date('2026-11-11T14:00:00Z')).schedules[0].next_at, '2026-11-11T19:00:00.000Z');
  assert.equal(ctx.plan.setStatus('a', 'running', new Date('2026-11-11T20:00:00Z')).schedules[0].next_at, '2026-11-11T20:05:00.000Z');
  assert.equal(ctx.plan.snapshot().items[0].status, 'queued');
  ctx.plan.db.prepare("INSERT INTO items (id,account_id,file,caption,position,status,created_at,published_at,queue_kind) VALUES ('old','a','old.mp4','',0,'published','2026-11-11T18:00:00Z','2026-11-11T18:00:00Z','account')").run();
  assert.equal(ctx.plan.scheduleFixed('a', new Date('2026-11-11T20:00:00Z')), '2026-11-11T21:00:00.000Z');
}));
test('publica no máximo uma vez por horário e avança para o dia seguinte', () => fixture(ctx => {
  ctx.plan.configure('a', fixed);
  for (const name of ['one.mp4', 'two.mp4', 'three.mp4']) { const file = path.join(ctx.dir, name); fs.writeFileSync(file, 'x'); ctx.plan.add('a', file, ''); }
  ctx.plan.setStatus('a', 'running', new Date('2026-11-11T12:00:00Z'));
  for (const at of ['2026-11-11T13:00:00.000Z', '2026-11-11T19:00:00.000Z']) {
    assert.equal(ctx.plan.due(new Date(at)).length, 1);
    const item = ctx.plan.claim('a'); ctx.plan.phase(item.id, 'published', { mediaId: item.id });
    ctx.plan.db.prepare('UPDATE items SET published_at=? WHERE id=?').run(at, item.id);
    ctx.plan.advance('a', 'account', new Date(at));
  }
  assert.equal(ctx.plan.snapshot().schedules[0].next_at, '2026-11-12T13:00:00.000Z');
  assert.equal(ctx.plan.due(new Date('2026-11-11T20:00:00Z')).length, 0);
  assert.equal(ctx.plan.snapshot().items.filter(item => item.status === 'queued').length, 1);
}));
test('vaga permanece consumida quando a fila esgota e recebe outro vídeo', () => fixture(ctx => {
  ctx.plan.configure('a', fixed);
  const first = path.join(ctx.dir, 'first.mp4'); fs.writeFileSync(first, 'x'); ctx.plan.add('a', first, '');
  ctx.plan.setStatus('a', 'running', new Date('2026-11-11T12:00:00Z'));
  const item = ctx.plan.claim('a'); ctx.plan.phase(item.id, 'published', { mediaId: 'first' });
  ctx.plan.db.prepare('UPDATE items SET published_at=? WHERE id=?').run('2026-11-11T13:00:00Z', item.id);
  ctx.plan.advance('a', 'account', new Date('2026-11-11T13:00:00Z'));
  assert.equal(ctx.plan.snapshot().schedules[0].status, 'stopped');
  assert.equal(ctx.plan.db.prepare("SELECT status FROM fixed_posting_slots WHERE account_id='a' AND local_date='2026-11-11' AND minute=600").get().status, 'used');
  const second = path.join(ctx.dir, 'second.mp4'); fs.writeFileSync(second, 'x'); ctx.plan.add('a', second, '');
  assert.equal(ctx.plan.setStatus('a', 'running', new Date('2026-11-11T13:02:00Z')).schedules[0].next_at, '2026-11-11T19:00:00.000Z');
}));
test('publicação em andamento não perde seu horário quando passa da tolerância', () => fixture(ctx => {
  ctx.plan.configure('a', fixed);
  const file = path.join(ctx.dir, 'slow.mp4'); fs.writeFileSync(file, 'x'); ctx.plan.add('a', file, '');
  ctx.plan.setStatus('a', 'running', new Date('2026-11-11T12:00:00Z'));
  assert.equal(ctx.plan.due(new Date('2026-11-11T13:06:00Z'), new Set(['a'])).length, 0);
  assert.equal(ctx.plan.snapshot().schedules[0].slot_minute, 600);
  assert.equal(ctx.plan.db.prepare("SELECT status FROM fixed_posting_slots WHERE account_id='a' AND local_date='2026-11-11' AND minute=600").get().status, 'pending');
}));
test('sem três horas livres no fim do dia, pula a vaga mas conserva o vídeo', () => fixture(ctx => {
  ctx.plan.configure('a', fixed);
  const file = path.join(ctx.dir, 'tomorrow.mp4'); fs.writeFileSync(file, 'x'); ctx.plan.add('a', file, '');
  ctx.plan.db.prepare("INSERT INTO items (id,account_id,file,caption,position,status,created_at,published_at,queue_kind) VALUES ('late','a','late.mp4','',0,'published','2026-11-12T01:00:00Z','2026-11-12T01:00:00Z','account')").run();
  const next = ctx.plan.setStatus('a', 'running', new Date('2026-11-12T01:30:00Z')).schedules[0].next_at;
  assert.equal(next, '2026-11-12T13:00:00.000Z');
  assert.equal(ctx.plan.snapshot().items.find(item => item.file === file).status, 'queued');
}));
test('aplicar os mesmos horários a várias contas separa os instantes em cinco minutos', () => fixture(ctx => {
  ctx.plan.configureBatch(['a', 'b'], fixed);
  ctx.plan.scheduleFixed('a', new Date('2026-11-15T12:00:00Z'));
  ctx.plan.scheduleFixed('b', new Date('2026-11-15T12:00:00Z'));
  const slots = ctx.plan.db.prepare("SELECT account_id,planned_at FROM fixed_posting_slots WHERE local_date='2026-11-15' AND minute=600 ORDER BY account_id").all();
  assert.equal(slots.length, 2);
  assert.ok(Math.abs(Date.parse(slots[0].planned_at) - Date.parse(slots[1].planned_at)) >= 300000);
}));
test('atualização exclui pendentes da fila removida e conserva histórico e conferência', () => fixture(ctx => {
  ctx.plan.configure('a', { minMinutes: 30, maxMinutes: 30, startMinute: 0, endMinute: 1440, days: [0,1,2,3,4,5,6], timeZone: 'America/Sao_Paulo' });
  const folder = path.join(ctx.dir, 'videos'); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'pending.mp4'), 'x');
  ctx.plan.saveMediaSettings('a', { folder });
  const insert = ctx.plan.db.prepare("INSERT INTO items (id,account_id,file,caption,position,status,created_at,queue_kind) VALUES (?,?,?,?,?,?,?,'shared')");
  insert.run('pending', 'a', path.join(folder, 'pending.mp4'), '', 1, 'queued', new Date().toISOString());
  insert.run('history', 'a', 'history.mp4', '', 2, 'published', new Date().toISOString());
  insert.run('uncertain', 'a', 'uncertain.mp4', '', 3, 'uncertain', new Date().toISOString());
  insert.run('attention', 'a', 'attention.mp4', '', 4, 'attention', new Date().toISOString());
  ctx.plan.db.prepare("INSERT INTO shared_schedules (account_id,status,next_at) VALUES ('a','running','2026-11-11T13:00:00Z')").run();
  const plan = ctx.reopen();
  assert.equal(plan.db.prepare("SELECT 1 FROM items WHERE id='pending'").get(), undefined);
  assert.ok(plan.db.prepare("SELECT 1 FROM items WHERE id='history'").get());
  assert.ok(plan.db.prepare("SELECT 1 FROM items WHERE id='uncertain'").get());
  assert.equal(plan.db.prepare("SELECT status FROM shared_schedules WHERE account_id='a'").get().status, 'stopped');
  assert.equal(plan.importFolder('a').importedCount, 0);
  assert.equal(fs.existsSync(path.join(folder, 'pending.mp4')), true);
  plan.retryAttention('attention');
  assert.equal(plan.db.prepare("SELECT queue_kind,status FROM items WHERE id='attention'").get().queue_kind, 'account');
  assert.equal(plan.snapshot().schedules[0].config.mode, undefined);
}));
