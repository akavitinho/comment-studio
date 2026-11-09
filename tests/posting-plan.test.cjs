const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { PostingPlan, validateConfig, nextAllowed, nextTime } = require('../src/posting-plan.cjs');
test('pasta por conta importa em ordem natural e ignora vídeos já enfileirados', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-folder-'));
  const folder = path.join(dir, 'videos'); fs.mkdirSync(folder);
  for (const name of ['video10.mp4', 'video2.mov', 'video1.mp4', 'nota.txt']) fs.writeFileSync(path.join(folder, name), name);
  const cover = path.join(dir, 'capa.png'); fs.writeFileSync(cover, 'image');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  try {
    plan.saveMediaSettings('a', { folder, cover });
    plan.saveMediaSettings('b', { folder });
    const first = plan.importFolder('a', 'Conta A');
    assert.equal(first.importedCount, 3);
    assert.deepEqual(first.items.map(item => path.basename(item.file)), ['video1.mp4', 'video2.mov', 'video10.mp4']);
    assert.equal(plan.importFolder('a').skippedCount, 3);
    assert.equal(plan.importFolder('b').importedCount, 3);
    plan.saveMediaSettings('a', { cover: null });
    assert.equal(plan.mediaSettings('a').cover, null);
    assert.equal(plan.mediaSettings('b').cover, null);
    const reopened = new PostingPlan(path.join(dir, 'postings.sqlite'));
    try { assert.equal(reopened.mediaSettings('a').folder, folder); assert.equal(reopened.snapshot().items.length, 6); }
    finally { reopened.close(); }
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('ordem dos vídeos migra como sequência e sorteia apenas a fila da conta quando escolhida', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-video-order-'));
  const file = path.join(dir, 'postings.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec('CREATE TABLE posting_media_settings (account_id TEXT PRIMARY KEY, folder TEXT, cover TEXT)');
  legacy.prepare('INSERT INTO posting_media_settings VALUES (?,?,?)').run('a', null, null);
  legacy.close();
  for (const name of ['one.mp4', 'two.mp4', 'three.mp4', 'shared-one.mp4', 'shared-two.mp4']) fs.writeFileSync(path.join(dir, name), name);
  const plan = new PostingPlan(file);
  try {
    const config = { minMinutes: 5, maxMinutes: 5, startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo' };
    plan.configure('a', config);
    for (const name of ['one.mp4', 'two.mp4', 'three.mp4']) plan.add('a', path.join(dir, name), '');
    assert.equal(plan.mediaSettings('a').video_order, 'sequence');
    assert.equal(path.basename(plan.claim('a').file), 'one.mp4');
    const cover = path.join(dir, 'cover.png'); fs.writeFileSync(cover, 'cover');
    plan.saveMediaSettings('a', { cover }); fs.unlinkSync(cover);
    plan.saveMediaSettings('a', { videoOrder: 'random' });
    assert.throws(() => plan.saveMediaSettings('a', { videoOrder: 'other' }), /Sequência ou Aleatório/);
    assert.equal(path.basename(plan.claim('a', 'account', () => 0.99).file), 'three.mp4');
    plan.addShared(['a'], [path.join(dir, 'shared-one.mp4'), path.join(dir, 'shared-two.mp4')], '');
    assert.equal(path.basename(plan.claim('a', 'shared', () => 0.99).file), 'shared-one.mp4');
    const reopened = new PostingPlan(file);
    try { assert.equal(reopened.mediaSettings('a').video_order, 'random'); }
    finally { reopened.close(); }
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('limpar fila remove só pendentes da conta e para sua programação', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-clear-queue-'));
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  try {
    const config = { minMinutes: 5, maxMinutes: 5, startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo' };
    plan.configure('a', config); plan.configure('b', config);
    for (const name of ['published.mp4', 'attention.mp4', 'pending.mp4', 'other.mp4']) fs.writeFileSync(path.join(dir, name), 'fixture');
    for (const name of ['published.mp4', 'attention.mp4', 'pending.mp4']) plan.add('a', path.join(dir, name), '');
    plan.add('b', path.join(dir, 'other.mp4'), '');
    const items = plan.snapshot().items.filter(item => item.account_id === 'a');
    plan.phase(items[0].id, 'published', { mediaId: 'published-id' });
    plan.phase(items[1].id, 'attention', { error: 'Falha de arquivo' });
    plan.addShared(['a'], [path.join(dir, 'other.mp4')], '');
    plan.setStatus('a', 'running');
    const result = plan.clearQueue('a');
    assert.equal(result.removedCount, 1);
    assert.deepEqual(result.items.filter(item => item.account_id === 'a').map(item => item.status).sort(), ['attention', 'published', 'queued']);
    assert.equal(result.items.find(item => item.account_id === 'a' && item.status === 'queued').queue_kind, 'shared');
    assert.equal(result.items.find(item => item.account_id === 'b').status, 'queued');
    assert.equal(result.schedules.find(row => row.account_id === 'a').status, 'stopped');
    assert.equal(result.schedules.find(row => row.account_id === 'a').next_at, null);
    assert.equal(fs.existsSync(path.join(dir, 'pending.mp4')), true);
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Insights mantêm a leitura atual e registram histórico real sem preencher métricas ausentes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-insight-history-'));
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  plan.add('a', video, 'Legenda');
  const id = plan.snapshot().items[0].id;
  plan.phase(id, 'published', { mediaId: 'meta-video' });
  plan.saveInsights(id, 'meta-video', { views: 100, reach: null });
  plan.saveInsights(id, 'meta-video', { views: 135, reach: 80 });
  const snapshot = plan.snapshot();
  assert.equal(snapshot.insights[0].views, 135);
  assert.equal(snapshot.insightHistory.length, 2);
  assert.equal(snapshot.insightHistory[0].reach, null);
  assert.equal(snapshot.insightHistory[1].views - snapshot.insightHistory[0].views, 35);
  plan.close(); fs.rmSync(dir, { recursive: true, force: true });
});

const config = validateConfig({ minMinutes: 30, maxMinutes: 90, startMinute: 540, endMinute: 1080, days: [1, 2, 3, 4, 5], timeZone: 'America/Sao_Paulo', dailyLimit: 0 });
test('fila única distribui cada vídeo uma vez e preserva horários independentes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shared-'));
  const plan=new PostingPlan(path.join(dir,'postings.sqlite'));
  try {
    const rhythm={minMinutes:5,maxMinutes:5,startMinute:0,endMinute:1440,days:[0,1,2,3,4,5,6],timeZone:'America/Sao_Paulo'};
    plan.configure('a',rhythm);plan.configure('b',rhythm);
    const files=Array.from({length:4},(_,i)=>path.join(dir,`video-${i}.mp4`));files.forEach(file=>fs.writeFileSync(file,'fake'));
    plan.addShared(['a','b'],files,'Legenda',{a:'Conta A',b:'Conta B'});
    const items=plan.snapshot().items;
    assert.equal(items.length,4);assert.equal(new Set(items.map(item=>item.file)).size,4);
    assert.deepEqual(items.reduce((count,item)=>(count[item.account_id]=(count[item.account_id]||0)+1,count),{}),{a:2,b:2});
    assert.ok(items.every(item=>item.queue_kind==='shared'));
    plan.setSharedStatus('running',['a','b']);
    assert.ok(plan.snapshot().schedules.every(row=>row.status==='stopped'));
    const dueAt=new Date(Math.max(...plan.snapshot().sharedSchedules.map(row=>Date.parse(row.next_at)))+60000);
    assert.equal(plan.due(dueAt).length,0);assert.equal(plan.dueShared(dueAt).length,2);
    const claimed=plan.claim('a','shared');assert.equal(claimed.account_id,'a');assert.equal(claimed.queue_kind,'shared');
    assert.equal(plan.snapshot().items.filter(item=>item.status==='uploading').length,1);
    plan.close();
    const resumed=new PostingPlan(path.join(dir,'postings.sqlite'));
    assert.ok(resumed.snapshot().sharedSchedules.every(row=>row.status==='paused'));
    resumed.close();
  } finally { try{plan.close();}catch{} fs.rmSync(dir,{recursive:true,force:true}); }
});
test('publicação de uma fila adia a outra fila da mesma conta pelo intervalo mínimo',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shared-gap-'));
  const plan=new PostingPlan(path.join(dir,'postings.sqlite'));
  try {
    const rhythm={minMinutes:30,maxMinutes:30,startMinute:0,endMinute:1440,days:[0,1,2,3,4,5,6],timeZone:'America/Sao_Paulo',firstAt:'2026-11-07T00:00:00.000Z'};
    plan.configure('a',rhythm);
    const own=path.join(dir,'own.mp4'),shared=path.join(dir,'shared.mp4');fs.writeFileSync(own,'x');fs.writeFileSync(shared,'x');
    plan.add('a',own,'');plan.addShared(['a'],[shared],'');
    const now=new Date('2026-11-07T15:00:00.000Z');
    plan.setStatus('a','running',new Date(now.getTime()-3600000));
    plan.setSharedStatus('running',['a'],new Date(now.getTime()-3600000));
    plan.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?').run(now.toISOString(),'a');
    plan.db.prepare('UPDATE shared_schedules SET next_at=? WHERE account_id=?').run(now.toISOString(),'a');
    const published=plan.snapshot().items.find(item=>item.queue_kind==='account');
    plan.phase(published.id,'published',{mediaId:'m'});
    plan.db.prepare('UPDATE items SET published_at=? WHERE id=?').run(now.toISOString(),published.id);
    assert.equal(plan.dueShared(now).length,0);
    assert.equal(plan.snapshot().sharedSchedules[0].next_at,new Date(now.getTime()+30*60000).toISOString());
  } finally {plan.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Insights persistem ligados ao ID confirmado do Reel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-insights-'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  try {
    plan.add('a', video, '');
    const id = plan.snapshot().items[0].id;
    assert.throws(() => plan.saveInsights(id, 'media-1', { views: 1, reach: 1 }), /não encontrado/);
    plan.phase(id, 'published', { mediaId: 'media-1' });
    plan.saveInsights(id, 'media-1', { views: 125, reach: 84 });
    assert.deepEqual(plan.snapshot().insights.map(item => [item.item_id, item.media_id, item.views, item.reach]), [[id, 'media-1', 125, 84]]);
    assert.throws(() => plan.saveInsights(id, 'media-2', { views: 1, reach: 1 }), /não encontrado/);
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('janela de 09:00 a 23:40 com limite diário de 100 é válida', () => {
  const saved = validateConfig({ minMinutes: 60, maxMinutes: 120, startMinute: 540, endMinute: 1420, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo', dailyLimit: 100 });
  assert.equal(saved.startMinute, 540);
  assert.equal(saved.endMinute, 1420);
});
test('contas selecionadas recebem o mesmo ritmo e horários separados, mantendo filas próprias', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-group-'));
  const videoA = path.join(dir, 'a.mp4'), videoB = path.join(dir, 'b.mp4');
  fs.writeFileSync(videoA, 'a'); fs.writeFileSync(videoB, 'b');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  try {
    const input = { minMinutes: 5, maxMinutes: 10, startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo' };
    plan.configureBatch(['a', 'b'], input);
    plan.add('a', videoA, 'Primeira conta'); plan.add('b', videoB, 'Segunda conta');
    const state = plan.snapshot();
    assert.deepEqual(state.schedules[0].config, state.schedules[1].config);
    assert.equal(state.schedules[0].group_id, state.schedules[1].group_id);
    assert.ok(Math.abs(Date.parse(state.schedules[0].next_at) - Date.parse(state.schedules[1].next_at)) >= 5 * 60000);
    assert.deepEqual(state.items.map(item => [item.account_id, path.basename(item.file)]), [['a', 'a.mp4'], ['b', 'b.mp4']]);
    const published = state.schedules[0].next_at;
    plan.phase(state.items[0].id, 'published');
    plan.db.prepare('UPDATE items SET published_at=? WHERE id=?').run(published, state.items[0].id);
    plan.db.prepare("UPDATE schedules SET status='running',next_at=? WHERE account_id='b'").run(published);
    assert.deepEqual(plan.due(new Date(Date.parse(published) + 60000)), []);
    assert.ok(Date.parse(plan.snapshot().schedules[1].next_at) >= Date.parse(published) + 5 * 60000);
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('iniciar filas em lote separa os primeiros horários e respeita uma fila já em execução', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-stagger-'));
  const file = path.join(dir, 'reel.mp4'); fs.writeFileSync(file, 'video');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  try {
    const rhythm = { minMinutes: 30, maxMinutes: 30, startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo', firstAt: '2026-11-08T00:00:00.000Z' };
    const now = new Date('2026-11-09T12:00:00.000Z');
    for (const id of ['a', 'b', 'c', 'running']) { plan.configure(id, rhythm); plan.add(id, file, id); plan.setStatus(id, 'running', now); }
    plan.db.prepare("UPDATE schedules SET next_at='2026-11-09T12:10:00.000Z' WHERE account_id='running'").run();
    plan.staggerStarts(['a', 'b', 'c']);
    const byId = Object.fromEntries(plan.snapshot().schedules.map(row => [row.account_id, row.next_at]));
    assert.deepEqual([byId.a, byId.b, byId.c, byId.running], [
      '2026-11-09T12:05:00.000Z', '2026-11-09T12:15:00.000Z', '2026-11-09T12:20:00.000Z', '2026-11-09T12:10:00.000Z'
    ]);
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('a janela diária e os dias permitidos governam o próximo envio', () => {
  assert.equal(nextAllowed(Date.parse('2026-11-06T21:00:00Z'), config), '2026-11-09T12:00:00.000Z');
  assert.equal(nextTime('2026-11-04T12:00:00Z', config, () => 0), '2026-11-04T12:30:00.000Z');
  assert.equal(nextTime('2026-11-04T12:00:00Z', config, () => 0.999), '2026-11-04T13:30:00.000Z');
});
test('não inicia uma programação vazia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-empty-'));
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  plan.configure('a', config);
  assert.throws(() => plan.setStatus('a', 'running'), /ao menos um vídeo/);
  plan.close(); fs.rmSync(dir, { recursive: true, force: true });
});
test('Iniciar espera cinco minutos; Continuar preserva horário futuro e reprograma horário vencido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-resume-'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  try {
    plan.configure('a', { minMinutes: 60, maxMinutes: 120, startMinute: 540, endMinute: 1200, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo', firstAt: '2026-11-05T12:00:00.000Z' });
    plan.add('a', video, '');
    const click = new Date('2026-11-05T15:00:00.000Z');
    plan.db.prepare("UPDATE schedules SET next_at=? WHERE account_id='a'").run('2026-11-05T14:00:00.000Z');
    plan.setStatus('a', 'running', click);
    assert.equal(plan.snapshot().schedules[0].next_at, '2026-11-05T15:05:00.000Z');
    plan.setStatus('a', 'paused');
    plan.db.prepare("UPDATE schedules SET next_at=? WHERE account_id='a'").run('2026-11-05T17:00:00.000Z');
    plan.setStatus('a', 'running', new Date('2026-11-05T16:20:00.000Z'));
    assert.equal(plan.snapshot().schedules[0].next_at, '2026-11-05T17:00:00.000Z');
    plan.setStatus('a', 'paused');
    plan.setStatus('a', 'running', new Date('2026-11-05T17:20:00.000Z'));
    assert.equal(plan.snapshot().schedules[0].next_at, '2026-11-05T17:25:00.000Z');
    plan.setStatus('a', 'paused');
    plan.setStatus('a', 'running', new Date('2026-11-05T23:00:00.000Z'));
    assert.equal(plan.snapshot().schedules[0].next_at, '2026-11-06T12:00:00.000Z');
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('não repete o nome do vídeo na mesma conta, inclusive após publicar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-duplicate-'));
  const other = path.join(dir, 'outro'); fs.mkdirSync(other);
  const first = path.join(dir, 'Reel.mp4'), sameName = path.join(other, 'reel.mp4');
  fs.writeFileSync(first, 'first'); fs.writeFileSync(sameName, 'second');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  try {
    plan.add('a', first, '');
    assert.throws(() => plan.add('a', sameName, ''), /já foi adicionado/);
    plan.phase(plan.snapshot().items[0].id, 'published');
    assert.throws(() => plan.add('a', sameName, ''), /já foi adicionado/);
    assert.doesNotThrow(() => plan.add('b', sameName, ''));
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('a fila persiste e uma publicação interrompida não volta ao estado de fila', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  const file = path.join(dir, 'postings.sqlite');
  const first = new PostingPlan(file); first.configure('a', config); first.add('a', video, 'Legenda');
  const id = first.snapshot().items[0].id;
  first.db.prepare("UPDATE items SET status='publishing' WHERE id=?").run(id);
  first.close();
  const second = new PostingPlan(file);
  assert.equal(second.snapshot().items[0].status, 'uncertain');
  assert.throws(() => second.remove(id), /ainda na fila/);
  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
test('um horário atrasado fora da janela é adiado sem consumir a fila', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-window-'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  plan.configure('a', config); plan.add('a', video, 'Legenda');
  plan.db.prepare("UPDATE schedules SET status='running',next_at=? WHERE account_id='a'").run('2026-11-06T20:00:00.000Z');
  assert.equal(plan.due(new Date('2026-11-06T22:00:00.000Z')).length, 0);
  assert.equal(plan.snapshot().schedules[0].next_at, '2026-11-09T12:00:00.000Z');
  assert.equal(plan.snapshot().items[0].status, 'queued');
  plan.close(); fs.rmSync(dir, { recursive: true, force: true });
});
test('espera de nova tentativa respeita o calendário', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-retry-'));
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  plan.configure('a', config);
  plan.delayRetry('a', 4, new Date('2026-11-06T20:58:00.000Z'));
  assert.equal(plan.snapshot().schedules[0].next_at, '2026-11-09T12:00:00.000Z');
  plan.close(); fs.rmSync(dir, { recursive: true, force: true });
});
test('resultado incerto exige conferência e não reenvia o item', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-uncertain-'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  plan.configure('a', config); plan.add('a', video, 'Legenda');
  const id = plan.snapshot().items[0].id;
  plan.phase(id, 'publishing'); plan.phase(id, 'uncertain'); plan.pauseAccount('a');
  assert.equal(plan.snapshot().schedules[0].status, 'paused');
  assert.equal(plan.snapshot().items[0].status, 'uncertain');
  assert.throws(() => plan.retryAttention(id), /vídeo em atenção/);
  plan.resolveUncertain(id, 'cancelled');
  assert.equal(plan.snapshot().items[0].status, 'cancelled');
  assert.throws(() => plan.resolveUncertain(id, 'published'), /aguardando conferência/);
  plan.close(); fs.rmSync(dir, { recursive: true, force: true });
});
test('repetição manual recupera só item em atenção e mantém a conta pausada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-attention-'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  const file = path.join(dir, 'postings.sqlite');
  const plan = new PostingPlan(file);
  plan.configure('a', config); plan.add('a', video, 'Legenda'); plan.setStatus('a', 'running');
  const id = plan.snapshot().items[0].id;
  plan.phase(id, 'processing', { creationId: 'container-antigo' });
  plan.phase(id, 'attention', { error: 'Proxy indisponível.' }); plan.pauseAccount('a');
  const nextAt = plan.snapshot().schedules[0].next_at;
  plan.retryAttention(id);
  const state = plan.snapshot();
  assert.equal(state.items[0].status, 'queued');
  assert.equal(state.items[0].error, null);
  assert.equal(state.items[0].creation_id, null);
  assert.equal(state.schedules[0].status, 'paused');
  assert.equal(state.schedules[0].next_at, nextAt);
  assert.equal(state.attempts[0].phase, 'manual_retry');
  assert.throws(() => plan.retryAttention(id), /vídeo em atenção/);
  plan.close();
  const reopened = new PostingPlan(file);
  assert.equal(reopened.snapshot().items[0].status, 'queued');
  assert.equal(reopened.snapshot().schedules[0].status, 'paused');
  reopened.close(); fs.rmSync(dir, { recursive: true, force: true });
});
test('intenção de publicação impede repetição mesmo se o estado for atenção', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-intent-'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  plan.configure('a', config); plan.add('a', video, 'Legenda');
  const id = plan.snapshot().items[0].id;
  plan.phase(id, 'publishing'); plan.phase(id, 'attention');
  assert.throws(() => plan.retryAttention(id), /Confira a publicação/);
  plan.close(); fs.rmSync(dir, { recursive: true, force: true });
});
test('cada upload temporário permanece rastreado até a própria remoção', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-objects-'));
  const video = path.join(dir, 'reel.mp4'); fs.writeFileSync(video, 'fake');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  plan.add('a', video, 'Legenda'); const id = plan.snapshot().items[0].id;
  plan.phase(id, 'processing', { storagePath: 'owner/a/first.mp4' });
  plan.phase(id, 'queued');
  plan.phase(id, 'processing', { storagePath: 'owner/a/second.mp4' });
  assert.deepEqual(plan.db.prepare('SELECT path FROM storage_objects ORDER BY path').all().map(x => x.path), ['owner/a/first.mp4', 'owner/a/second.mp4']);
  plan.clearStoragePath(id, 'owner/a/second.mp4');
  assert.equal(plan.snapshot().items[0].storage_path, null);
  assert.equal(plan.db.prepare('SELECT path FROM storage_objects').get().path, 'owner/a/first.mp4');
  plan.close(); fs.rmSync(dir, { recursive: true, force: true });
});
test('limite diário adia a segunda publicação para o próximo dia permitido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-daily-'));
  const video = path.join(dir, 'reel.mp4'), second = path.join(dir, 'outro-reel.mp4'); fs.writeFileSync(video, 'fake'); fs.writeFileSync(second, 'fake');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  plan.configure('a', { ...config, dailyLimit: 1 });
  plan.add('a', video, 'Primeiro'); plan.add('a', second, 'Segundo');
  plan.db.prepare("UPDATE items SET status='published',published_at=? WHERE caption='Primeiro'").run('2026-11-04T12:30:00.000Z');
  plan.db.prepare("UPDATE schedules SET status='running',next_at=? WHERE account_id='a'").run('2026-11-04T13:00:00.000Z');
  assert.equal(plan.due(new Date('2026-11-04T13:01:00.000Z')).length, 0);
  assert.equal(plan.snapshot().schedules[0].next_at, '2026-11-05T12:00:00.000Z');
  plan.close(); fs.rmSync(dir, { recursive: true, force: true });
});
