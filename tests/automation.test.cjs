const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Automation, videoKey, videoAuthor, isOwnVideo, targetURL, campaignTargets, discoverVideos, inspectSkippableContent } = require('../src/automation.cjs');

const video = 'https://www.tiktok.com/@example/video/1234567890123456789';
const campaign = {
  name: 'Teste', targetType: 'hashtag', target: 'futebol', comments: ['Olá'], accountIds: ['account-1'],
  random: false, watchSeconds: 0, waitMin: 1, waitMax: 1, skipPercent: 0,
  sessionLimit: 1, hourlyLimit: 100, likePercent: 0, favoritePercent: 0, like: false, favorite: false
};
test('search advances with arrow without reloading when next result matches', async () => {
  const { automation, store } = fixture(true);
  const win = automation.getWindow();
  let current = 'https://www.tiktok.com/@previous/video/111';
  win.webContents.getURL = () => current;
  win.webContents.debugger.sendCommand = async (_method, event) => { if (event.type === 'mouseReleased') current = video; };
  automation.evaluate = async (_win, fn) => fn.name === 'inspectAnyDraft' ? false : ({ x: 10, y: 10 });
  automation.restoreSearch = async () => assert.fail('must not reload results');
  await automation.openSearchVideo(win, { ...campaign, targetType: 'search' }, store.data.accounts[0], video);
  assert.equal(current, video);
});
test('search never clicks the next arrow while a comment draft exists', async () => {
  const { automation, store } = fixture(true);
  const win = automation.getWindow();
  win.webContents.getURL = () => 'https://www.tiktok.com/@previous/video/111';
  automation.evaluate = async (_win, fn) => fn.name === 'inspectAnyDraft' ? true : assert.fail(`unexpected ${fn.name}`);
  await assert.rejects(automation.openSearchVideo(win, { ...campaign, targetType: 'search' }, store.data.accounts[0], video), /rascunho/);
});
test('search rejects unrelated arrow destination and opens the collected card instead', async () => {
  const { automation, store } = fixture(true);
  const win = automation.getWindow(); let current = 'https://www.tiktok.com/@previous/video/111';
  let restored = false; let clicks = 0;
  win.webContents.getURL = () => current;
  win.webContents.debugger.sendCommand = async (_method, event) => {
    if (event.type === 'mouseReleased') { clicks++; current = restored ? video : 'https://www.tiktok.com/@unrelated/video/999'; }
  };
  automation.restoreSearch = async () => { restored = true; current = 'https://www.tiktok.com/search/video?q=futebol'; };
  automation.evaluate = async (_win, fn) => fn.name === 'inspectChallenge' ? { detected: false } : fn.name === 'inspectAnyDraft' ? false : { x: 10, y: 10 };
  await automation.openSearchVideo(win, { ...campaign, targetType: 'search' }, store.data.accounts[0], video);
  assert.equal(restored, true); assert.equal(clicks, 2); assert.equal(current, video);
  assert.equal(store.data.attempts.length, 0);
});
test('search restores result scroll through browser history before falling back to reload', async () => {
  const { automation } = fixture(true);
  const settings = { ...campaign, targetType: 'search' };
  let current = video; let backs = 0;
  const win = { webContents: { getURL: () => current, navigationHistory: { canGoBack: () => true, goBack: () => { backs++; current = targetURL(settings); } } } };
  automation.load = async () => assert.fail('history should preserve results');
  await automation.restoreSearch(win, settings);
  assert.equal(backs, 1);
});
test('search opens the collected video directly when its result card plays in place', async () => {
  const { automation, store } = fixture(true);
  const win = automation.getWindow();
  let current = targetURL({ ...campaign, targetType: 'search' });
  const loads = [];
  win.webContents.getURL = () => current;
  automation.restoreSearch = async () => {};
  automation.evaluate = async (_win, fn) => fn.name === 'inspectChallenge' ? { detected: false } : { x: 10, y: 10 };
  automation.load = async (_win, url) => { loads.push(url); current = url; };
  await automation.openSearchVideo(win, { ...campaign, targetType: 'search' }, store.data.accounts[0], video);
  assert.deepEqual(loads, [video]);
});
test('search retries the exact video page and confirms the comment when its viewer has no editor', async () => {
  const { automation, store } = fixture(true);
  store.data.campaign = { ...campaign, targetType: 'search' };
  const win = automation.getWindow();
  automation.getWindow = () => win;
  const loads = [];
  automation.openSearchVideo = async () => {};
  automation.load = async (_win, url) => loads.push(url);
  let opens = 0;
  automation.openComments = async () => ++opens === 1
    ? { origin: 'https://www.tiktok.com', video: true, editor: false, post: false }
    : { origin: 'https://www.tiktok.com', video: true, editor: true, post: true };
  automation.start(); await finished(automation);
  assert.deepEqual(loads, [video]);
  assert.equal(opens, 2);
  assert.equal(automation.snapshot().posted, 1);
  assert.equal(store.data.attempts[0].status, 'sent');
});
test('search accepts an editor before TikTok reveals its send button', async () => {
  const { automation, store } = fixture(true);
  store.data.campaign = { ...campaign, targetType: 'search' };
  automation.openSearchVideo = async () => {};
  automation.openComments = async () => ({ origin: 'https://www.tiktok.com', video: true, editor: true, post: false });
  automation.start(); await finished(automation);
  assert.equal(automation.snapshot().posted, 1);
  assert.equal(store.data.attempts[0].status, 'sent');
});
test('search submits through the exact post button when it cannot be clicked by coordinates', async () => {
  const { automation, store } = fixture(true);
  store.data.campaign = { ...campaign, targetType: 'search' };
  automation.openSearchVideo = async () => {};
  const base = automation.evaluate;
  let submitted = 0;
  automation.evaluate = async (win, fn, arg) => {
    if (fn.name === 'postPoint') return { ready: true, dom: true };
    if (fn.name === 'submitPost') { submitted++; return arg === 'Olá'; }
    return base(win, fn, arg);
  };
  automation.start(); await finished(automation);
  assert.equal(submitted, 1);
  assert.equal(automation.snapshot().posted, 1);
  assert.equal(store.data.attempts[0].status, 'sent');
});
test('search skips three different videos without an editor and keeps running', async () => {
  const { automation, store } = fixture(true);
  const urls = ['111', '222', '333'].map(id => `https://www.tiktok.com/@example/video/${id}`);
  automation.sessionLimit = 1;
  automation.current.status = 'running';
  automation.openSearchVideo = async () => {};
  automation.openComments = async () => ({ origin: 'https://www.tiktok.com', video: true, editor: false, post: false, reason: 'A aba Comentários não abriu.' });
  automation.discover = async () => [];
  const alerts = [];
  automation.requireAttention = async (_account, pending, reason) => alerts.push({ videoId: pending.videoId, reason });
  const state = { queue: [...urls] };
  await automation.runAccount('account-1', { ...campaign, targetType: 'search' }, state);
  assert.deepEqual([...state.seen], ['111', '222', '333']);
  assert.equal(store.data.attempts.length, 0);
  assert.equal(alerts.length, 0);
});
test('access check opens the selected search video directly when the viewer lacks an editor', async () => {
  const { automation, store } = fixture(true);
  store.data.campaign = { ...campaign, targetType: 'search' };
  automation.openSearchVideo = async () => {};
  const loads = [];
  automation.load = async (_win, url) => loads.push(url);
  let opens = 0;
  automation.openComments = async () => ++opens === 1
    ? { origin: 'https://www.tiktok.com', video: true, editor: false, post: false }
    : { origin: 'https://www.tiktok.com', video: true, editor: true, post: true };
  await automation.check();
  assert.deepEqual(loads, [video]);
  assert.equal(store.data.attempts.length, 0);
});
function fixture(confirmation) {
  const store = { data: { accounts: [{ id: 'account-1', name: 'Conta de teste' }], campaign: { ...campaign }, attempts: [] }, save() {}, log() {} };
  const automation = new Automation({ store, getWindow: () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, getURL: () => video, debugger: { isAttached: () => true, sendCommand: async () => {} } } }), openAccount: async () => {} });
  automation.load = async () => {};
  automation.discover = async () => [video];
  automation.isOwnAccountVideo = async () => ({ own: false, author: 'example', handles: [] });
  automation.openComments = async () => ({ origin: 'https://www.tiktok.com', video: true, editor: true, post: true });
  automation.wait = async () => {};
  let reads = 0;
  automation.evaluate = async (_win, fn) => {
    if (fn.name === 'inspectChallenge') return { detected: false };
    if (fn.name === 'inspectSkippableContent') return { skip: false, reason: null };
    if (fn.name === 'activeFeedVideo') return { ready: true, url: video };
    if (fn.name === 'trackPlayback') return true;
    if (fn.name === 'playbackFinished') return false;
    if (fn.name === 'focusComment') return { ready: true, point: { x: 1, y: 1 } };
    if (fn.name === 'inspectDraft') return { matches: true, enabled: true };
    if (fn.name === 'holdActiveVideo' || fn.name === 'releaseActiveVideo') return true;
    if (fn.name === 'postPoint') return { ready: true, point: { x: 2, y: 2 } };
    if (fn.name === 'verifyComment') return ++reads === 1 ? 0 : confirmation ? 1 : 0;
    if (fn.name === 'inspectSubmission') return confirmation ? { count: 1, draftEmpty: true, draftMatches: false, enabled: false } : { count: 0, draftEmpty: false, draftMatches: true, enabled: true };
    throw new Error(`Unexpected DOM action: ${fn.name}`);
  };
  return { automation, store };
}
async function finished(automation) {
  for (let i = 0; i < 100 && automation.snapshot().status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.notEqual(automation.snapshot().status, 'running', 'execution settled');
}
test('accepts only TikTok video URLs and forms hashtag target', () => {
  assert.equal(videoKey(video), '1234567890123456789');
  assert.equal(videoKey('https://example.com/@user/video/123'), null);
  assert.equal(videoKey('https://www.tiktok.com/@user/live'), null);
  assert.equal(targetURL(campaign), 'https://www.tiktok.com/tag/futebol');
  const multiple = { ...campaign, target: 'futebol, esportes', targets: ['futebol', 'esportes'] };
  assert.deepEqual(campaignTargets(multiple), ['futebol', 'esportes']);
  assert.equal(targetURL(multiple, 1), 'https://www.tiktok.com/tag/esportes');
  assert.equal(targetURL({ ...campaign, targetType: 'search', target: 'frase completa' }), 'https://www.tiktok.com/search/video?q=frase%20completa');
  assert.equal(targetURL({ ...campaign, targetType: 'search', targets: ['zangi', 'conhecer pessoas'] }, 1), 'https://www.tiktok.com/search/video?q=conhecer%20pessoas');
  assert.equal(targetURL({ ...campaign, targetType: 'foryou' }), 'https://www.tiktok.com/foryou');
});
test('recognizes own videos by configured or session-detected handle', () => {
  assert.equal(videoAuthor('https://www.tiktok.com/@7594962761973826580/video/7701437482671361332'), '7594962761973826580');
  assert.equal(isOwnVideo('https://www.tiktok.com/@AnaJuliaBotX/video/1234567890123456789', ['anajuliabotx']), true);
  assert.equal(isOwnVideo('https://www.tiktok.com/@7594962761973826580/video/7701437482671361332', ['Anajuliabotx', '7594962761973826580']), true);
  assert.equal(isOwnVideo('https://www.tiktok.com/@outra_conta/video/1234567890123456789', ['anajuliabotx']), false);
});
test('campaign skips own profile before commenting or engaging', async () => {
  const { automation, store } = fixture(true);
  automation.isOwnAccountVideo = async () => ({ own: true, author: 'example', handles: ['example'] });
  automation.start(); await finished(automation);
  assert.equal(automation.snapshot().posted, 0);
  assert.equal(store.data.attempts.length, 0);
});
test('campaign accepts a result without inspecting hashtags in the caption', async () => {
  const { automation, store } = fixture(true);
  automation.start(); await finished(automation);
  assert.equal(automation.snapshot().posted, 1);
  assert.equal(store.data.attempts.length, 1);
});
test('discovery uses result cards and excludes sidebar, viewer and hidden links', () => {
  for (const source of ['https://www.tiktok.com/tag/futebol', 'https://www.tiktok.com/search?q=futebol', 'https://www.tiktok.com/search/video?q=futebol']) {
    const link = (href, excluded = false, hidden = false) => ({ href, closest: () => excluded ? {} : null, getClientRects: () => hidden ? [] : [{}] });
    const cards = [
      { closest: () => null, querySelectorAll: () => [link(video), link(video), link('sidebar', true), link('hidden', false, true)] },
      { closest: () => ({}), querySelectorAll: () => [link('viewer')] }
    ];
    const result = vm.runInNewContext(`(${discoverVideos.toString()})(source)`, {
      source, URL, location: { href: source },
      document: { querySelectorAll: selector => {
        if (selector.includes('search-empty')) return [];
        assert.ok(selector.includes(source.includes('/tag/') ? 'challenge-item' : 'search-video-item'));
        return cards;
      } },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
    });
    assert.deepEqual(Array.from(result.urls), [video]);
    assert.equal(result.recognized, true);
  }
});
test('discovery rejects redirects and a different search before reading any links', () => {
  const source = 'https://www.tiktok.com/search?q=futebol';
  for (const href of [video, 'https://www.tiktok.com/foryou', 'https://www.tiktok.com/search?q=beleza', 'https://other.test/search?q=futebol']) {
    assert.throws(() => vm.runInNewContext(`(${discoverVideos.toString()})(source)`, {
      source, URL, location: { href }, document: { querySelectorAll: () => assert.fail('Não deve coletar nesta página') }
    }), /Nenhum vídeo foi coletado/);
  }
});
test('Para você classifies LIVE and advertising before any interaction', () => {
  const inspect = (innerText, pathname = '/foryou') => {
    const scope = { innerText, querySelector: () => null };
    const video = { getBoundingClientRect: () => ({ width: 500, height: 700 }), closest: () => scope, parentElement: null };
    return vm.runInNewContext(`(${inspectSkippableContent.toString()})()`, {
      document: { querySelectorAll: selector => selector === 'video' ? [video] : [] },
      location: { pathname },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
    });
  };
  const ad = inspect('Criador\nPatrocinado\nSaiba mais');
  const live = inspect('Transmissão', '/@creator/live');
  const normal = inspect('Criador\nVídeo comum');
  assert.equal(ad.skip, true); assert.equal(ad.reason, 'advertisement');
  assert.equal(live.skip, true); assert.equal(live.reason, 'live');
  assert.equal(normal.skip, false); assert.equal(normal.reason, null);
});
test('does not start a TikTok campaign with an Instagram account', () => {
  const { automation, store } = fixture(true);
  store.data.accounts[0].platform = 'instagram';
  assert.throws(() => automation.start(), /não é TikTok/);
});
test('retries a transient TikTok script context failure', async () => {
  const { automation } = fixture(true);
  automation.wait = async () => {};
  let calls = 0;
  const win = { isDestroyed: () => false, webContents: { executeJavaScript: async () => {
    calls++;
    if (calls < 3) throw new Error('Script failed to execute, this normally means an error was thrown.');
    return { studioResult: true, ok: true, value: 'ready' };
  } } };
  assert.equal(await Automation.prototype.evaluate.call(automation, win, () => 'ready'), 'ready');
  assert.equal(calls, 3);
});
test('records a confirmed comment once', async () => {
  const { automation, store } = fixture(true);
  automation.start(); await finished(automation);
  assert.equal(automation.snapshot().status, 'completed');
  assert.equal(automation.snapshot().posted, 1);
  assert.equal(store.data.attempts[0].status, 'sent');
  assert.equal(automation.hourlyCount('account-1'), 1);
  assert.equal(automation.snapshot().accountProgress[0].posted, 1);
});
test('uncertain submission is recorded, skipped and not retried as a fresh video', async () => {
  const { automation, store } = fixture(false);
  automation.start(); await finished(automation);
  assert.equal(automation.snapshot().status, 'completed');
  assert.equal(automation.snapshot().posted, 0);
  assert.equal(store.data.attempts[0].status, 'unknown');
  assert.equal(automation.snapshot().accountProgress[0].posted, 0);
  assert.equal(automation.attemptsFor('account-1', '1234567890123456789'), true);
});
test('does not confirm when the same phrase appears but the draft did not clear, then continues safely', async () => {
  const { automation, store } = fixture(true);
  automation.evaluate = async (_win, fn) => {
    if (fn.name === 'inspectChallenge') return { detected: false };
    if (fn.name === 'trackPlayback') return true;
    if (fn.name === 'playbackFinished') return false;
    if (fn.name === 'focusComment') return { ready: true, point: { x: 1, y: 1 } };
    if (fn.name === 'inspectDraft') return { matches: true, enabled: true };
    if (fn.name === 'holdActiveVideo' || fn.name === 'releaseActiveVideo') return true;
    if (fn.name === 'postPoint') return { ready: true, point: { x: 2, y: 2 } };
    if (fn.name === 'verifyComment') return 0;
    if (fn.name === 'inspectSubmission') return { count: 1, draftEmpty: false, draftMatches: true, enabled: true };
    throw new Error(`Unexpected DOM action: ${fn.name}`);
  };
  automation.start(); await finished(automation);
  assert.equal(automation.snapshot().status, 'completed');
  assert.equal(automation.snapshot().posted, 0);
  assert.equal(store.data.attempts[0].status, 'unknown');
});
test('video ending interrupts remaining interval without replay', async () => {
  const { automation } = fixture(true);
  let elapsed = 0;
  automation.wait = async ms => { elapsed += ms; };
  automation.evaluate = async (_win, fn) => fn.name === 'inspectChallenge' ? { detected: false } : fn.name === 'playbackFinished' ? elapsed >= 500 : true;
  assert.equal(await automation.waitForPlayback({}, 30), 'ended');
  assert.equal(elapsed, 500);
});
test('already ended video requires no further wait', async () => {
  const { automation } = fixture(true);
  automation.evaluate = async (_win, fn) => fn.name === 'inspectChallenge' ? { detected: false } : true;
  automation.wait = async () => { assert.fail('must not wait for replay'); };
  assert.equal(await automation.waitForPlayback({}, 30), 'ended');
});
test('engagement confirms state and never toggles an active action off', async () => {
  const { automation } = fixture(true);
  let selected = false;
  let clicks = 0;
  const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, debugger: { isAttached: () => true, async sendCommand(_method, event) { if (event.type === 'mouseReleased') { clicks++; selected = true; } } } } };
  automation.evaluate = async (_win, fn) => fn.name === 'inspectChallenge' ? { detected: false } : ({ state: selected ? 'on' : 'off', point: { x: 1, y: 1 } });
  assert.equal(await automation.engage(win, 'favorite'), 'confirmado');
  assert.equal(await automation.engage(win, 'favorite'), 'já ativado');
  assert.equal(clicks, 1);
});
test('like and favorite use independent percentages', () => {
  const { automation } = fixture(true);
  const settings = { like: true, favorite: true, likePercent: 70, favoritePercent: 15 };
  assert.equal(automation.shouldEngage(settings, 'like', 69), true);
  assert.equal(automation.shouldEngage(settings, 'like', 70), false);
  assert.equal(automation.shouldEngage(settings, 'favorite', 14), true);
  assert.equal(automation.shouldEngage(settings, 'favorite', 15), false);
  assert.equal(automation.shouldEngage({ ...settings, favorite: false }, 'favorite', 0), false);
});
test('sequential phrases follow the list and only repeat after the full cycle', () => {
  const { automation } = fixture(true);
  const settings = { comments: ['Primeira', 'Segunda', 'Terceira'], random: false };
  assert.deepEqual([0, 1, 2, 3].map(() => automation.nextPhrase(settings)), ['Primeira', 'Segunda', 'Terceira', 'Primeira']);
});
test('random phrases use a shuffled deck without repeats inside a cycle', () => {
  const { automation } = fixture(true);
  const settings = { comments: ['Primeira', 'Segunda', 'Terceira'], random: true };
  const firstCycle = [0, 1, 2].map(() => automation.nextPhrase(settings, () => 0));
  const firstNextCycle = automation.nextPhrase(settings, () => 0);
  assert.equal(new Set(firstCycle).size, 3);
  assert.notEqual(firstNextCycle, firstCycle.at(-1), 'não repete imediatamente na troca de ciclos');
});
test('account recovers from a video failure and preserves its seen-video state', async () => {
  const { automation } = fixture(true);
  automation.current.status = 'running';
  automation.wait = async () => {};
  let calls = 0;
  let firstState;
  automation.runAccount = async (_accountId, _campaign, workerState) => {
    calls++;
    if (calls === 1) {
      firstState = workerState;
      workerState.seen.add('video-with-error');
      throw new Error('Falha temporária no vídeo');
    }
    assert.equal(workerState, firstState);
    assert.equal(workerState.seen.has('video-with-error'), true);
  };
  assert.equal(await automation.runAccountRecovering('account-1', campaign), null);
  assert.equal(calls, 2);
});
test('pause holds progress until resume and blocks a second start', async () => {
  const { automation } = fixture(true);
  automation.current = { status: 'running', posted: 2, scanned: 3 };
  automation.pause();
  let advanced = false;
  const pending = automation.checkpoint().then(() => { advanced = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(automation.current.status, 'paused');
  assert.equal(advanced, false);
  assert.throws(() => automation.start(), /Continuar/);
  automation.resume(); await pending;
  assert.equal(advanced, true);
  assert.equal(automation.current.posted, 2);
  assert.equal(automation.current.scanned, 3);
});
test('stop releases a paused campaign without executing next step', async () => {
  const { automation } = fixture(true);
  automation.current.status = 'running';
  automation.pause();
  const pending = automation.checkpoint();
  automation.stop();
  await assert.rejects(pending, /interrompida/);
});
test('pause during submission waits for confirmation boundary', async () => {
  const { automation } = fixture(true);
  automation.current.status = 'running';
  automation.confirming = true;
  automation.pause();
  await automation.checkpoint();
  assert.equal(automation.current.status, 'pausing');
  automation.confirming = false;
  const pending = automation.checkpoint();
  assert.equal(automation.current.status, 'paused');
  automation.resume(); await pending;
});
test('human verification focuses the account and resumes only after it disappears', async () => {
  const { automation, store } = fixture(true);
  automation.current.status = 'running';
  const messages = [];
  store.log = message => messages.push(message);
  let checks = 0;
  let challengeVisible = false;
  automation.evaluate = async (_win, fn) => {
    assert.equal(fn.name, 'inspectChallenge');
    checks++;
    return { detected: checks < 3, kind: 'slider' };
  };
  automation.wait = async () => {
    challengeVisible ||= automation.snapshot().challenges.length === 1;
  };
  let shown = 0; let focused = 0;
  const win = { show: () => shown++, focus: () => focused++ };
  assert.equal(await automation.resolveChallenge(win, store.data.accounts[0]), true);
  assert.equal(challengeVisible, true);
  assert.equal(automation.snapshot().challenges.length, 0);
  assert.equal(shown, 1);
  assert.equal(focused, 1);
  assert.match(messages[0], /Verificação humana/);
  assert.match(messages[1], /Verificação concluída/);
});
test('Para você publishes and confirms the prepared comment automatically', async () => {
  const { automation, store } = fixture(true);
  store.data.campaign = { ...campaign, targetType: 'foryou', target: 'Para você' };
  const loads = [];
  automation.load = async (_win, url) => loads.push(url);
  automation.start(); await finished(automation);
  assert.equal(automation.snapshot().status, 'completed');
  assert.equal(automation.snapshot().posted, 1);
  assert.equal(store.data.attempts[0].status, 'sent');
  assert.deepEqual(loads, ['https://www.tiktok.com/foryou'], 'permanece no fluxo da página principal e não abre /@perfil/video');
});
test('one account with unavailable comments does not stop other accounts', async () => {
  const store = { data: { accounts: [{ id: 'bad', name: 'Conta lenta' }, { id: 'good', name: 'Conta pronta' }], campaign: { ...campaign, accountIds: ['bad', 'good'] }, attempts: [] }, save() {}, log() {} };
  const makeWindow = id => ({ id, isDestroyed: () => false, webContents: { isDestroyed: () => false, getURL: () => id === 'bad' ? 'https://www.tiktok.com/@bad/video/111' : 'https://www.tiktok.com/@good/video/222', debugger: { isAttached: () => true, sendCommand: async () => {} } } });
  const windows = new Map([['bad', makeWindow('bad')], ['good', makeWindow('good')]]);
  const automation = new Automation({ store, getWindow: id => windows.get(id), openAccount: async () => {} });
  automation.isOwnAccountVideo = async () => ({ own: false, author: null, handles: [] });
  automation.discover = async win => [win.webContents.getURL()];
  automation.load = async () => {};
  automation.wait = async () => {};
  automation.waitForPlayback = async () => 'interval';
  automation.openComments = async win => win.id === 'bad' ? { origin: 'https://www.tiktok.com', video: true, editor: false, post: false } : { origin: 'https://www.tiktok.com', video: true, editor: true, post: true };
  let reads = 0;
  automation.evaluate = async (_win, fn) => {
    if (fn.name === 'inspectChallenge') return { detected: false };
    if (fn.name === 'trackPlayback') return true;
    if (fn.name === 'focusComment') return { ready: true, point: { x: 1, y: 1 } };
    if (fn.name === 'inspectDraft') return { matches: true, enabled: true };
    if (fn.name === 'holdActiveVideo' || fn.name === 'releaseActiveVideo') return true;
    if (fn.name === 'postPoint') return { ready: true, point: { x: 2, y: 2 } };
    if (fn.name === 'verifyComment') return ++reads === 1 ? 0 : 1;
    if (fn.name === 'inspectSubmission') return { count: 1, draftEmpty: true, draftMatches: false, enabled: false };
    throw new Error(`Unexpected DOM action: ${fn.name}`);
  };
  automation.start(); await finished(automation);
  assert.equal(automation.current.status, 'completed');
  assert.equal(automation.current.posted, 1);
  assert.equal(store.data.attempts[0].accountId, 'good');
});
test('starts selected accounts in parallel instead of waiting for the first cycle', async () => {
  const accounts = [{ id: 'one', name: 'Conta um' }, { id: 'two', name: 'Conta dois' }];
  const urls = { one: 'https://www.tiktok.com/@one/video/111', two: 'https://www.tiktok.com/@two/video/222' };
  const store = { data: { accounts, campaign: { ...campaign, accountIds: ['one', 'two'], sessionLimit: 2, hourlyLimit: 2 }, attempts: [] }, save() {}, log() {} };
  const windows = new Map(accounts.map(account => [account.id, { id: account.id, isDestroyed: () => false, webContents: { isDestroyed: () => false, getURL: () => urls[account.id], debugger: { isAttached: () => true, sendCommand: async () => {} } } }]));
  const automation = new Automation({ store, getWindow: id => windows.get(id), openAccount: async () => {} });
  automation.isOwnAccountVideo = async () => ({ own: false, author: null, handles: [] });
  automation.discover = async win => [urls[win.id]];
  const started = new Set();
  let releaseFirst;
  const firstMayContinue = new Promise(resolve => { releaseFirst = resolve; });
  automation.load = async win => { started.add(win.id); if (win.id === 'one') await firstMayContinue; };
  automation.openComments = async () => ({ origin: 'https://www.tiktok.com', video: true, editor: true, post: true });
  automation.wait = async () => {};
  automation.waitForPlayback = async () => 'interval';
  const reads = new Map();
  automation.evaluate = async (win, fn) => {
    if (fn.name === 'inspectChallenge') return { detected: false };
    if (fn.name === 'trackPlayback') return true;
    if (fn.name === 'focusComment') return { ready: true, point: { x: 1, y: 1 } };
    if (fn.name === 'inspectDraft') return { matches: true, enabled: true };
    if (fn.name === 'holdActiveVideo' || fn.name === 'releaseActiveVideo') return true;
    if (fn.name === 'postPoint') return { ready: true, point: { x: 2, y: 2 } };
    if (fn.name === 'verifyComment') { const count = (reads.get(win.id) || 0) + 1; reads.set(win.id, count); return count === 1 ? 0 : 1; }
    if (fn.name === 'inspectSubmission') return { count: 1, draftEmpty: true, draftMatches: false, enabled: false };
    throw new Error(`Unexpected DOM action: ${fn.name}`);
  };
  automation.start();
  for (let i = 0; i < 30 && started.size < 2; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual([...started].sort(), ['one', 'two']);
  releaseFirst();
  await finished(automation);
  assert.equal(automation.current.status, 'completed');
  assert.equal(automation.current.posted, 2);
  assert.deepEqual(new Set(store.data.attempts.map(item => item.accountId)), new Set(['one', 'two']));
});

test('failed editors retry once per hashtag video and then continue to a working result', async () => {
  const { automation, store } = fixture(true);
  const urls = ['111', '222', '333', '444'].map(id => `https://www.tiktok.com/@news/video/${id}`);
  let current = urls[0];
  const win = automation.getWindow(); win.webContents.getURL = () => current;
  automation.getWindow = () => win;
  automation.load = async (_win, url) => { current = url; };
  let collections = 0;
  automation.discover = async () => { collections++; return urls; };
  const inspected = [];
  automation.openComments = async () => { inspected.push(current); const ready = current === urls[3]; return { origin: 'https://www.tiktok.com', video: true, editor: ready, post: ready }; };
  automation.current.status = 'running';
  const settings = { ...campaign, targets: ['noticias', 'esportes'], targetSwitchMin: 15, targetSwitchMax: 20 };
  const state = {};
  await automation.runAccount('account-1', settings, state);
  assert.deepEqual(inspected, urls);
  assert.equal(automation.attentionAccounts.size, 0);
  assert.equal(state.targetIndex, 0);
  assert.equal(collections, 1);
  assert.equal(store.data.attempts[0].videoId, '444');
});

test('recovery preserves pending video and random choice without recording a failed preparation', async () => {
  const { automation, store } = fixture(true);
  store.data.campaign = { ...campaign, skipPercent: 10 };
  let draws = 0;
  const random = Math.random;
  Math.random = () => { draws++; return 0.5; };
  const evaluate = automation.evaluate;
  let fail = true;
  automation.evaluate = async (win, fn, arg) => {
    if (fn.name === 'verifyComment') return 0;
    if (fn.name === 'postPoint' && fail) { fail = false; assert.equal(store.data.attempts.length, 0); throw new Error('Falha antes do envio'); }
    return evaluate(win, fn, arg);
  };
  try {
    automation.start(); await finished(automation);
    assert.equal(automation.current.posted, 1);
    assert.equal(store.data.attempts.length, 1);
    // One skip draw, plus the default random arguments for the two disabled interactions.
    assert.equal(draws, 3);
    assert.equal(automation.current.scanned, 1);
  } finally { Math.random = random; }
});

test('uncertain submission receives only one click and remains deduplicated', async () => {
  const { automation, store } = fixture(false);
  const win = automation.getWindow(); let clicks = 0;
  win.webContents.debugger.sendCommand = async (_method, event) => { if (event.type === 'mouseReleased') clicks++; };
  automation.getWindow = () => win;
  automation.start(); await finished(automation);
  assert.equal(clicks, 1); assert.equal(store.data.attempts.length, 1);
  assert.equal(store.data.attempts[0].status, 'unknown');
});

test('a changed video after pause prevents the submit click and any attempt record', async () => {
  const { automation, store } = fixture(true);
  const win = automation.getWindow(); let current = video; let clicks = 0;
  win.webContents.getURL = () => current;
  win.webContents.debugger.sendCommand = async (_method, event) => { if (event.type === 'mouseReleased') clicks++; };
  automation.getWindow = () => win;
  const evaluate = automation.evaluate;
  automation.current.status = 'running';
  automation.evaluate = async (window, fn, arg) => {
    const result = await evaluate(window, fn, arg);
    if (fn.name === 'postPoint') { automation.confirmingCount = 0; automation.pause(); }
    return result;
  };
  const pending = automation.runAccount('account-1', campaign);
  for (let i = 0; i < 100 && automation.current.status !== 'paused'; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(automation.current.status, 'paused');
  current = 'https://www.tiktok.com/@other/video/999';
  automation.resume();
  await assert.rejects(pending, /O vídeo mudou/);
  assert.equal(clicks, 0); assert.equal(store.data.attempts.length, 0);
});

test('stopping and reaching the campaign limit release accounts waiting for attention', async () => {
  for (const action of ['stop', 'limit']) {
    const { automation, store } = fixture(true);
    automation.current.status = 'running'; automation.sessionLimit = 1;
    const pending = automation.requireAttention(store.data.accounts[0], { videoId: '123' }, 'Editor indisponível');
    assert.equal(automation.snapshot().attentionAccounts.length, 1);
    if (action === 'stop') { automation.stop(); await assert.rejects(pending, /interrompida/); }
    else { automation.update({ posted: 1 }); await pending; }
    assert.equal(automation.attentionWaiters.size, 0); assert.equal(automation.snapshot().attentionAccounts.length, 0);
  }
});

test('explicitly disabled comments are skipped without attention or attempted submission', async () => {
  const { automation, store } = fixture(true);
  automation.openComments = async () => ({ disabled: true });
  automation.start(); await finished(automation);
  assert.equal(store.data.attempts.length, 0); assert.equal(automation.attentionAccounts.size, 0);
});

test('comment opener retries DOM and browser clicks while the editor loads', async () => {
  const { automation, store } = fixture(true);
  let elapsed = 0; const clicks = []; const domClicks = [];
  const win = automation.getWindow();
  win.webContents.debugger.sendCommand = async (_method, event) => { if (event.type === 'mouseReleased') clicks.push(elapsed); };
  automation.wait = async ms => { elapsed += ms; };
  automation.evaluate = async (_win, fn) => {
    if (fn.name === 'inspectChallenge') return { detected: false };
    if (fn.name === 'clickCommentTab') { domClicks.push(elapsed); return true; }
    if (fn.name === 'commentOpenPoint') return { x: 10, y: 10 };
    if (fn.name === 'inspectVideo') return { editor: elapsed >= 30000, post: elapsed >= 30000 };
    throw new Error(fn.name);
  };
  const result = await Automation.prototype.openComments.call(automation, win, store.data.accounts[0]);
  assert.equal(result.editor, true); assert.equal(elapsed, 30000);
  assert.deepEqual(domClicks, Array.from({ length: 10 }, (_, index) => index * 3000));
  assert.deepEqual(clicks, Array.from({ length: 10 }, (_, index) => index * 3000 + 1500));
});

test('For You advances past three failed editors and comments on the next video', async () => {
  const { automation, store } = fixture(true);
  const urls = ['111', '222', '333', '444'].map(id => `https://www.tiktok.com/@news/video/${id}`);
  let current = urls[0]; let index = 0;
  const base = automation.evaluate;
  automation.evaluate = async (win, fn, arg) => fn.name === 'activeFeedVideo' ? { ready: true, url: current } : base(win, fn, arg);
  automation.load = async (_win, url) => { if (url !== 'https://www.tiktok.com/foryou') current = url; };
  automation.advanceForYou = async () => { current = urls[++index]; };
  automation.openComments = async () => ({ origin: 'https://www.tiktok.com', video: true, editor: index === 3, post: index === 3 });
  automation.current.status = 'running';
  const state = {};
  await automation.runAccount('account-1', { ...campaign, targetType: 'foryou' }, state);
  assert.equal(automation.attentionAccounts.size, 0);
  assert.equal(state.deferred.length, 0);
  assert.deepEqual([...state.seen], ['111', '222', '333', '444']);
  assert.equal(store.data.attempts[0].videoId, '444');
});
