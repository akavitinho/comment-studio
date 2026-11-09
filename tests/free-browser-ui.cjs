const { app, session } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const { openFreeBrowser } = require('../src/free-browser.cjs');
const { stealthPatchSource } = require('../src/stealth-preload.cjs');

app.setPath('userData', path.join(__dirname, '..', '.smoke', 'free-browser-ui'));
app.whenReady().then(async () => {
  let browser;
  try {
    const ses = session.fromPartition('free-browser-test');
    ses.setUserAgent(ses.getUserAgent().replace(/ Electron\/[\d.]+/g, ''));
    const register = (contents, openPopup) => contents.setWindowOpenHandler(details => { if (details.url.startsWith('https://') || details.url === 'about:blank') openPopup(details.url); return { action: 'deny' }; });
    browser = await openFreeBrowser({ title: 'Teste', session: ses, startURL: 'auditoria', show: false, register });
    const win = browser.window;
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#address').getAttribute('aria-label')"), 'Pesquisar ou digitar endereço');
    const size = win.contentView.children[0].getBounds();
    assert.equal(size.y, 116);
    const site = win.contentView.children[0].webContents;
    assert.equal(site.session, ses, 'site uses the selected account or proxy session');
    const navigation = new Promise(resolve => site.once('did-start-navigation', (_event, url) => resolve(url)));
    await win.webContents.executeJavaScript("document.querySelector('#address').value = 'auditoria'; document.querySelector('#bar').requestSubmit()");
    assert.match(await Promise.race([navigation, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 3000))]), /fingerprint-audit\.html/);
    site.on('dom-ready', () => { void site.executeJavaScript(stealthPatchSource()); });
    await new Promise(resolve => setTimeout(resolve, 550));
    const chrome = await site.executeJavaScript("({ app: Boolean(window.chrome?.app), csi: typeof window.chrome?.csi, loadTimes: typeof window.chrome?.loadTimes })");
    assert.deepEqual(chrome, { app: true, csi: 'function', loadTimes: 'function' });
    const differences = await site.executeJavaScript("[...document.querySelectorAll('#results .test:has(.fail)')].map(row => row.textContent.trim())");
    assert.deepEqual(differences, [], 'local audit has no failed checks');
    void site.executeJavaScript("window.__child = window.open('about:blank', 'tab-test'); Boolean(window.__child)").catch(() => {});
    let popupTabs = 0;
    for (let i = 0; i < 30 && popupTabs < 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      popupTabs = await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length");
    }
    assert.equal(popupTabs, 2, 'site popup opens as a tab');
    assert.equal(browser.site.session, ses, 'popup keeps the account session');
    const secondSession = session.fromPartition('free-browser-second-account');
    const second = await openFreeBrowser({ title: 'Outra conta', session: secondSession, startURL: 'auditoria', show: false, register });
    assert.equal(second.window, win, 'accounts share one browser window');
    assert.equal(second.site.session, secondSession, 'second account keeps its own session');
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length"), 3);
    await win.webContents.executeJavaScript("document.querySelector('#new-tab').click()");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length"), 4, 'plus creates a tab');
    assert.equal(second.site.session, secondSession, 'new tab uses current account session');
    await win.webContents.executeJavaScript("document.querySelector('.browser-tab.active .browser-tab-close').click()");
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length"), 3, 'close button removes only active tab');
    await win.webContents.executeJavaScript("document.querySelector('#tabs .browser-tab:first-child .browser-tab-select').click()");
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(browser.site.session, ses, 'switching tab restores the first account session');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('#tabs .browser-tab:first-child .browser-tab-select').getAttribute('aria-selected')"), 'true');
    site.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length"), 4, 'Ctrl+T na página cria aba na mesma sessão');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length"), 3, 'Ctrl+W na barra fecha a aba ativa');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length"), 4, 'Ctrl+T na barra cria aba');
    await win.webContents.executeJavaScript("document.querySelector('#address').value = 'auditoria'; document.querySelector('#bar').requestSubmit()");
    await new Promise(resolve => setTimeout(resolve, 300));
    second.site.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: ['control'] });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length"), 3, 'Ctrl+W na página fecha só a aba ativa');
    await win.webContents.executeJavaScript("document.querySelector('#address').value = 'https://127.0.0.1:64123/'; document.querySelector('#bar').requestSubmit()");
    let loadError = '';
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      loadError = await win.webContents.executeJavaScript("document.querySelector('#status').textContent");
      if (loadError.includes('ERR_CONNECTION_REFUSED')) break;
    }
    assert.match(loadError, /ERR_CONNECTION_REFUSED/, 'a falha de navegação continua visível após a página parar de carregar');
    browser.close();
    assert.equal(browser.isDestroyed(), true);
    assert.equal(second.isDestroyed(), false);
    let remaining = 0;
    for (let i = 0; i < 20; i++) {
      remaining = await win.webContents.executeJavaScript("document.querySelectorAll('#tabs .browser-tab').length");
      if (remaining === 1) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(remaining, 1);
    console.log('Free browser: tabs, popup routing and account sessions passed.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { browser?.window.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error); app.exit(1); });
