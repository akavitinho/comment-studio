const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const { Automation, inspectVideo, discoverVideos } = require('../src/automation.cjs');
const { inspectIdentity, commentOpenPoint, exposeControl } = require('../src/page-controls.cjs');
const input = require('../src/background-input.cjs');

async function run() {
  const xResult = await require('./x-page-controls.cjs').run();
  console.log(`X DOM fixtures: ${xResult.passed} passed`);
  console.log('DOM fixtures: ready');
  let passed = 0;
  const store = { data: { attempts: [] }, save() {}, log() {} };
  const automation = new Automation({ store });
  const windows = [];
  const account = { id: 'ana', name: 'Ana Julia', handle: 'anajulia' };
  const makeWindow = async (handle, author = 'metropolesoficial', id = '123') => {
    const ses = session.fromPartition(`fixture-${windows.length}-${Date.now()}`);
    ses.protocol.handle('https', () => new Response(`<!doctype html><html><head><link rel="canonical" href="https://www.tiktok.com/@${author}/video/${id}"><style>
      body{margin:0;display:flex}nav{width:150px}main{display:flex;width:800px;height:650px}video{width:300px;height:450px}section{width:400px}button,a,[contenteditable]{display:block;min-height:25px}[contenteditable]{border:1px solid;width:250px;height:60px}.hidden{display:none!important}
      </style></head><body><nav><a data-e2e="nav-profile" href="/@${handle}" aria-label="Perfil">Perfil</a></nav>
      <main><article><video></video><a href="/@${author}" data-e2e="profile-icon" aria-label="Perfil">Autor</a><button data-e2e="comment-icon">Abrir</button></article>
      <section><div data-e2e="comments"><button role="tab" aria-selected="false" id="comments">Comentários</button></div><button role="tab" aria-selected="true">Você pode gostar</button>
      <aside><a href="/@g1" aria-label="Perfil">G1</a><nav><a data-e2e="nav-profile" href="/@g1">Perfil</a></nav></aside>
      <div id="panel" class="hidden"><div data-e2e="comment-input" contenteditable="true" role="textbox"></div><button data-e2e="comment-post" onclick="window.posts=(window.posts||0)+1">Publicar</button><div data-e2e="comment-text">Comentários desativados, escreveu alguém</div></div></section></main>
      <script>window.opens=0;document.querySelector('#comments').onclick=()=>{window.opens++;document.querySelector('#comments').setAttribute('aria-selected','true');if(window.opens>=(window.openAfter||1))setTimeout(()=>document.querySelector('#panel').classList.remove('hidden'),window.delay||0)};</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { session: ses, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    windows.push(win);
    console.log('DOM fixture: loading', handle);
    await win.loadURL(`https://www.tiktok.com/@${author}/video/${id}`);
    console.log('DOM fixture: loaded', handle);
    return win;
  };
  const js = (win, code) => win.webContents.executeJavaScript(code);
  try {
    const win = await makeWindow('anajulia');
    assert.deepEqual((await automation.evaluate(win, inspectIdentity)).handles, ['anajulia']);
    for (const author of ['metropolesoficial', 'g1']) {
      await js(win, `history.replaceState(null,'','/@${author}/video/123');document.querySelector('link').href=location.href`);
      const result = await automation.isOwnAccountVideo(win, account, `https://www.tiktok.com/@${author}/video/123`);
      assert.equal(result.own, false); assert.equal(result.source, 'session-navigation');
      passed++;
    }
    assert.equal((await automation.isOwnAccountVideo(win, account, 'https://www.tiktok.com/@anajulia/video/123')).own, true); passed++;
    await js(win, `document.querySelector('nav').remove()`);
    const fallback = await automation.isOwnAccountVideo(win, account, 'https://www.tiktok.com/@anajulia/video/123');
    assert.equal(fallback.own, true); assert.equal(fallback.source, 'configured-handle'); passed++;
    assert.equal((await automation.isOwnAccountVideo(win, account, 'https://www.tiktok.com/@7594962761973826580/video/123')).own, false); passed++;
    await js(win, `document.querySelector('link').href='https://www.tiktok.com/@anajulia/video/123'`);
    assert.equal((await automation.isOwnAccountVideo(win, account, 'https://www.tiktok.com/@7594962761973826580/video/123')).own, true); passed++;
    await js(win, `document.querySelector('link').href='https://www.tiktok.com/@anajulia/video/456'`);
    assert.equal((await automation.isOwnAccountVideo(win, account, 'https://www.tiktok.com/@7594962761973826580/video/123')).own, false); passed++;
    const second = await makeWindow('outraconta', 'g1', '456');
    assert.equal((await automation.isOwnAccountVideo(second, account, 'https://www.tiktok.com/@anajulia/video/456')).own, false); passed++;
    await js(second, `document.querySelector('nav a').href='/@anajulia'`);
    assert.equal((await automation.isOwnAccountVideo(second, account, 'https://www.tiktok.com/@anajulia/video/456')).own, true); passed++;
    await js(second, `document.querySelector('nav a').href='/@outraconta'`);
    assert.equal((await automation.isOwnAccountVideo(second, account, 'https://www.tiktok.com/@anajulia/video/456')).own, false); passed++;
    assert.deepEqual((await automation.evaluate(win, inspectIdentity)).handles, [], 'não reutiliza identidade de outra janela'); passed++;
    const reopened = await makeWindow('nova');
    assert.deepEqual((await automation.evaluate(reopened, inspectIdentity)).handles, ['nova']); passed++;
    const firstState = await automation.evaluate(win, inspectVideo);
    assert.equal(firstState.editor, false);
    const point = await automation.evaluate(win, commentOpenPoint);
    assert.ok(point);
    await input.click(win, point);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await automation.evaluate(win, inspectVideo)).editor, true);
    assert.equal(await js(win, `document.querySelector('#comments').getAttribute('aria-selected')`), 'true'); passed++;
    win.setSize(750, 550);
    await new Promise(resolve => setTimeout(resolve, 50));
    await js(win, `document.querySelector('section').style.cssText='height:170px;overflow-y:auto';document.querySelector('[data-e2e="comment-post"]').insertAdjacentHTML('beforebegin','<div id="spacer" style="height:500px"></div>')`);
    const exposed = await automation.evaluate(win, () => exposeControl(document.querySelector('[data-e2e="comment-post"]')));
    assert.ok(exposed, 'the send button can be exposed within the comments panel');
    assert.equal(await js(win, `document.elementFromPoint(${exposed.x},${exposed.y})?.getAttribute('data-e2e')`), 'comment-post'); passed++;
    await js(win, `document.querySelector('section').removeAttribute('style');document.querySelector('#spacer').remove()`);
    win.setSize(1100, 800);
    assert.equal((await automation.evaluate(win, inspectVideo)).disabled, false, 'texto de um comentário não desativa editor'); passed++;
    await js(win, `document.querySelector('video').classList.add('hidden');document.querySelector('#panel').classList.add('hidden')`);
    const hiddenVideoTab = await automation.evaluate(win, commentOpenPoint);
    assert.ok(hiddenVideoTab, 'the comments tab remains available while TikTok hides the video element');
    await input.click(win, hiddenVideoTab);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await automation.evaluate(win, inspectVideo)).editor, true); passed++;
    await js(win, `document.querySelector('video').classList.remove('hidden')`);
    await js(win, `document.querySelector('#panel').classList.add('hidden');window.opens=0;window.openAfter=2;window.delay=40`);
    // Keep the real DOM, real click and real polling algorithm; accelerate only its clock.
    let elapsed = 0;
    automation.wait = async ms => { elapsed += ms; await new Promise(resolve => setTimeout(resolve, 50)); };
    const slow = await automation.openComments(win, account);
    assert.equal(slow.editor, true); assert.equal(await js(win, 'window.opens'), 2); assert.ok(elapsed >= 2250); passed++;
    await js(win, `document.querySelector('#panel').classList.add('hidden');document.querySelector('section').insertAdjacentHTML('beforeend','<p data-e2e="comment-disabled">Os comentários estão desativados</p>')`);
    const disabled = await automation.openComments(win, account);
    assert.equal(disabled.disabled, true); assert.equal(await js(win, 'window.posts||0'), 0); passed++;
    await js(win, `history.replaceState(null,'','/tag/noticias');document.querySelector('main').innerHTML='<div data-e2e="challenge-item"><a href="/@g1/video/222">Notícia sem hashtag na legenda</a></div><aside><a href="/@beauty/video/333">Recomendação</a></aside>'`);
    assert.deepEqual((await automation.evaluate(win, discoverVideos, 'https://www.tiktok.com/tag/noticias')).urls, ['https://www.tiktok.com/@g1/video/222']); passed++;
    await js(win, `document.querySelector('main').innerHTML='<p data-e2e="challenge-empty">Nenhum vídeo</p>'`);
    const empty = await automation.evaluate(win, discoverVideos, 'https://www.tiktok.com/tag/noticias');
    assert.equal(empty.recognized, true); assert.equal(empty.empty, true); passed++;
    await js(win, `document.querySelector('main').innerHTML='<div>Carregando</div>'`);
    assert.equal((await automation.evaluate(win, discoverVideos, 'https://www.tiktok.com/tag/noticias')).recognized, false); passed++;
    return { ok: true, passed, realDOM: true, liveTikTok: false, at: new Date().toISOString() };
  } finally { for (const win of windows) if (!win.isDestroyed()) win.destroy(); }
}
exports.run = run;
if (require.main === module || (process.type === 'browser' && process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  app.on('window-all-closed', () => {}); // Keep Electron alive between the X and TikTok fixture suites.
  console.log('DOM fixtures: starting');
  setTimeout(() => { console.error('DOM fixtures: timeout'); app.exit(1); }, 60000);
  const resultFile = path.join(__dirname, '../.smoke/page-controls-result.json');
  app.setPath('userData', path.join(__dirname, '../.smoke/dom-session'));
  app.whenReady().then(run).then(result => { fs.mkdirSync(path.dirname(resultFile), { recursive: true }); fs.writeFileSync(resultFile, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); app.exit(0); }).catch(error => { fs.mkdirSync(path.dirname(resultFile), { recursive: true }); fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: error.stack, at: new Date().toISOString() }, null, 2)); console.error(error); app.exit(1); });
}
