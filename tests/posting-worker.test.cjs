const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PostingPlan } = require('../src/posting-plan.cjs');
const { PostingWorker } = require('../src/posting-worker.cjs');

function setup(publisher, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-worker-'));
  const file = path.join(dir, 'reel.mp4'); fs.writeFileSync(file, 'video fixture');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  plan.configure('account-1', { minMinutes: 5, maxMinutes: 5, startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo' });
  plan.add('account-1', file, 'Legenda'); plan.setStatus('account-1', 'running');
  let uploads = 0, removals = 0, uploadedFile = null;
  const worker = new PostingWorker({
    plan,
    storage: { upload: async (_accountId, _connection, file) => { uploads++; uploadedFile = file; return { client: {}, objectPath: `upload-${uploads}`, signedUrl: 'https://example.org/video' }; }, remove: async () => { removals++; } },
    auth: { data: { graphVersion: 'v23.0' }, status: () => ({ connected: true, igId: 'instagram-1' }), token: async () => 'token' },
    net: {}, getConnection: async () => ({ ses: {} }), getAccount: () => ({ platform: 'instagram' }), onChange: () => {},
    validateMedia: async () => {}, prepareMedia: options.prepareMedia || (async file => ({ file, cleanup: () => {} })), makePublisher: () => publisher
  });
  worker.stop();
  return { plan, worker, get uploads() { return uploads; }, get uploadedFile() { return uploadedFile; }, get removals() { return removals; }, close: () => { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('prepara a capa da conta no momento de postar, envia só o temporário e preserva o original', async () => {
  const observed = [];
  let preparedFile;
  const fixture = setup({ create: async () => 'container', waitReady: async () => {}, publish: async () => 'reel' }, {
    prepareMedia: async (file, cover) => {
      observed.push({ file, cover });
      preparedFile = path.join(path.dirname(file), 'temporary.mp4');
      fs.writeFileSync(preparedFile, 'prepared');
      return { file: preparedFile, cleanup: () => fs.rmSync(preparedFile, { force: true }) };
    }
  });
  try {
    const original = fixture.plan.snapshot().items[0].file;
    const cover = path.join(path.dirname(original), 'cover.png'); fs.writeFileSync(cover, 'cover');
    fixture.plan.saveMediaSettings('account-1', { cover });
    await fixture.worker.run('account-1');
    assert.deepEqual(observed, [{ file: original, cover }]);
    assert.equal(fixture.uploadedFile, preparedFile);
    assert.equal(fs.existsSync(preparedFile), false);
    assert.equal(fs.existsSync(original), true);
    assert.equal(fixture.plan.snapshot().items[0].status, 'published');
  } finally { fixture.close(); }
});

test('fila única usa capa da conta e remove temporário após resultado incerto', async () => {
  let coverUsed, preparedFile;
  const fixture = setup({ create: async () => 'container', waitReady: async () => {}, publish: async () => { throw new Error('Resultado incerto.'); } }, {
    prepareMedia: async (file, cover) => {
      coverUsed = cover;
      preparedFile = path.join(path.dirname(file), 'temporary.mp4'); fs.writeFileSync(preparedFile, 'prepared');
      return { file: preparedFile, cleanup: () => fs.rmSync(preparedFile, { force: true }) };
    }
  });
  try {
    const original = fixture.plan.snapshot().items[0].file;
    fixture.plan.addShared(['account-1'], [original], '');
    fixture.plan.setSharedStatus('running', ['account-1']);
    await fixture.worker.run('account-1', 'shared');
    assert.equal(coverUsed, null);
    assert.equal(fixture.uploadedFile, preparedFile);
    assert.equal(fs.existsSync(preparedFile), false);
    assert.equal(fs.existsSync(original), true);
    assert.equal(fixture.plan.snapshot().items.find(item => item.queue_kind === 'shared').status, 'uncertain');
  } finally { fixture.close(); }
});

test('falha no preparo não envia o original', async () => {
  const fixture = setup({ create: async () => { throw new Error('Não deveria criar mídia.'); } }, { prepareMedia: async () => { throw new Error('Falha ao preparar vídeo.'); } });
  try {
    const original = fixture.plan.snapshot().items[0].file;
    await fixture.worker.run('account-1');
    assert.equal(fixture.uploads, 0);
    assert.equal(fs.existsSync(original), true);
    assert.equal(fixture.plan.snapshot().items[0].status, 'attention');
  } finally { fixture.close(); }
});

test('duas contas usam capas diferentes para o mesmo vídeo', async () => {
  const covers = [];
  const fixture = setup({ create: async () => 'container', waitReady: async () => {}, publish: async () => 'reel' }, {
    prepareMedia: async (file, cover) => { covers.push(cover); return { file, cleanup: () => {} }; }
  });
  try {
    const file = fixture.plan.snapshot().items[0].file;
    const config = { minMinutes: 5, maxMinutes: 5, startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo' };
    fixture.plan.configure('account-2', config);
    fixture.plan.add('account-2', file, '');
    fixture.plan.setStatus('account-2', 'running');
    const first = path.join(path.dirname(file), 'first.png'), second = path.join(path.dirname(file), 'second.png');
    fs.writeFileSync(first, 'first'); fs.writeFileSync(second, 'second');
    fixture.plan.saveMediaSettings('account-1', { cover: first });
    fixture.plan.saveMediaSettings('account-2', { cover: second });
    await fixture.worker.run('account-1');
    await fixture.worker.run('account-2');
    assert.deepEqual(covers, [first, second]);
  } finally { fixture.close(); }
});

test('fila única publica um vídeo atribuído sem consumir a fila individual',async()=>{
  const fixture=setup({create:async()=> 'container-shared',waitReady:async()=>{},publish:async()=> 'media-shared',permalink:async()=> 'https://instagram.com/reel/shared'});
  try {
    const file=fixture.plan.snapshot().items[0].file;
    fixture.plan.addShared(['account-1'],[file],'Compartilhada');
    fixture.plan.setSharedStatus('running',['account-1']);
    await fixture.worker.run('account-1','shared');
    const state=fixture.plan.snapshot();
    assert.equal(state.items.find(item=>item.queue_kind==='shared').status,'published');
    assert.equal(state.items.find(item=>item.queue_kind==='account').status,'queued');
    assert.equal(state.sharedSchedules[0].status,'stopped');
    assert.equal(state.schedules[0].status,'running');
  } finally { fixture.close(); }
});

test('contas do mesmo grupo não iniciam publicações simultâneas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-worker-group-'));
  const file = path.join(dir, 'reel.mp4'); fs.writeFileSync(file, 'video fixture');
  const plan = new PostingPlan(path.join(dir, 'postings.sqlite'));
  const config = { minMinutes: 5, maxMinutes: 5, startMinute: 0, endMinute: 1440, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo' };
  plan.configureBatch(['a', 'b'], config);
  for (const id of ['a', 'b']) { plan.add(id, file, id); plan.setStatus(id, 'running'); }
  plan.db.prepare("UPDATE schedules SET next_at=? WHERE group_id IS NOT NULL").run(new Date(Date.now() - 60000).toISOString());
  const worker = new PostingWorker({ plan, storage: {}, auth: {}, net: {}, getConnection: () => {}, getAccount: () => {}, onChange: () => {} });
  worker.stop(); worker.cleanup = async () => {};
  const started = [];
  worker.run = async id => { started.push(id); };
  try {
    await worker.tick();
    assert.equal(started.length, 1);
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('falha anterior ao envio final mantém o vídeo na fila e agenda espera', async () => {
  let publishCalls = 0;
  const fixture = setup({ create: async () => { throw new Error('Rede temporariamente indisponível.'); }, waitReady: async () => {}, publish: async () => { publishCalls++; } });
  try {
    await fixture.worker.run('account-1');
    const state = fixture.plan.snapshot();
    assert.equal(state.items[0].status, 'queued');
    assert.equal(state.schedules[0].status, 'running');
    assert.ok(Date.parse(state.schedules[0].next_at) > Date.now());
    assert.equal(publishCalls, 0);
    assert.equal(fixture.uploads, 1);
  } finally { fixture.close(); }
});

test('falha após registrar a intenção de publicação pausa sem reenviar', async () => {
  let publishCalls = 0;
  const fixture = setup({ create: async () => 'container-1', waitReady: async () => {}, publish: async () => { publishCalls++; throw new Error('A conexão caiu após o envio.'); } });
  try {
    await fixture.worker.run('account-1');
    const state = fixture.plan.snapshot();
    assert.equal(state.items[0].status, 'uncertain');
    assert.equal(state.items[0].creation_id, 'container-1');
    assert.equal(state.schedules[0].status, 'paused');
    assert.equal(publishCalls, 1);
    assert.equal(fixture.plan.due().length, 0);
    assert.equal(fixture.removals, 0);
  } finally { fixture.close(); }
});

test('pausa durante processamento impede a chamada final e preserva a fila', async () => {
  let publishCalls = 0;
  let fixture;
  fixture = setup({ create: async () => 'container-1', waitReady: async () => { fixture.plan.pauseAccount('account-1'); }, publish: async () => { publishCalls++; } });
  try {
    await fixture.worker.run('account-1');
    const state = fixture.plan.snapshot();
    assert.equal(state.items[0].status, 'queued');
    assert.equal(state.schedules[0].status, 'paused');
    assert.equal(publishCalls, 0);
    assert.equal(fixture.removals, 1);
  } finally { fixture.close(); }
});

test('falha ao assinar URL mantém rastreio de objeto que não pôde ser removido', async () => {
  const fixture = setup({ create: async () => { throw new Error('Não deveria criar mídia.'); } });
  fixture.worker.storage.upload = async () => { const error = new Error('Falha ao assinar URL.'); error.orphanPath = 'owner/account-1/orphan.mp4'; throw error; };
  try {
    await fixture.worker.run('account-1');
    assert.equal(fixture.plan.snapshot().items[0].status, 'queued');
    assert.equal(fixture.plan.db.prepare('SELECT path FROM storage_objects').get().path, 'owner/account-1/orphan.mp4');
  } finally { fixture.close(); }
});

test('falha de proxy coloca só a conta afetada em atenção', async () => {
  const fixture = setup({ create: async () => { throw new Error('Não deveria criar mídia.'); } });
  fixture.worker.storage.upload = async () => { const error = new Error('Falha de rede.'); error.proxyFailure = true; throw error; };
  try {
    await fixture.worker.run('account-1');
    assert.equal(fixture.plan.snapshot().items[0].status, 'attention');
    assert.equal(fixture.plan.snapshot().schedules[0].status, 'paused');
  } finally { fixture.close(); }
});

test('repetição manual reinicia tentativas pré-publicação e publica após correção', async () => {
  let creations = 0, publications = 0;
  const fixture = setup({
    create: async () => { creations++; if (creations <= 4) throw new Error('Rede temporariamente indisponível.'); return 'container-corrigido'; },
    waitReady: async () => {},
    publish: async () => { publications++; return 'reel-publicado'; }
  });
  try {
    for (let attempt = 0; attempt < 3; attempt++) await fixture.worker.run('account-1');
    let state = fixture.plan.snapshot();
    assert.equal(state.items[0].status, 'attention');
    assert.equal(state.schedules[0].status, 'paused');
    assert.equal(publications, 0);
    fixture.plan.retryAttention(state.items[0].id);
    assert.equal(fixture.plan.snapshot().schedules[0].status, 'paused');
    fixture.plan.setStatus('account-1', 'running');
    await fixture.worker.run('account-1');
    state = fixture.plan.snapshot();
    assert.equal(state.items[0].status, 'queued');
    assert.equal(state.schedules[0].status, 'running');
    await fixture.worker.run('account-1');
    assert.equal(fixture.plan.snapshot().items[0].status, 'published');
    assert.equal(publications, 1);
  } finally { fixture.close(); }
});

test('falha no banco ao reservar item pausa a conta sem deixar rejeição solta', async () => {
  const fixture = setup({ create: async () => { throw new Error('Não deveria criar mídia.'); } });
  let reported = 0;
  fixture.worker.onFailure = accountId => { assert.equal(accountId, 'account-1'); reported++; };
  fixture.plan.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?').run(new Date(Date.now() - 60000).toISOString(), 'account-1');
  fixture.plan.claim = () => { throw new Error('Falha simulada no SQLite.'); };
  try {
    await fixture.worker.tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reported, 1);
    assert.equal(fixture.worker.active.size, 0);
    assert.equal(fixture.plan.snapshot().schedules[0].status, 'paused');
  } finally { fixture.close(); }
});
