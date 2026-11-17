const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
async function run({ mainWindow, handlers, store, prepareAccount }) {
  const evaluate = code => mainWindow.webContents.executeJavaScript(code);
  const settled = async () => {
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (await evaluate(`!document.querySelector('#creator-new').disabled`)) return;
    }
    throw new Error('Proxy operation timed out');
  };
  const originalAdd = handlers.addProxy;
  const originalAccounts = new Set(store.data.accounts.map(item => item.id));
  const originalProxies = new Set(store.data.proxies.map(item => item.id));
  const proxyServer = require('node:http').createServer((_request, response) => response.end('creator-proxy-fixture'));
  await new Promise(resolve => proxyServer.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxyServer.address().port;
  let calls = 0;
  try {
    // Simulate provider success/failure; keep the renderer, parser, IPC, draft and session real.
    handlers.addProxy = async input => {
      calls++;
      if (input.host === 'failed.example') throw new Error('Falha no teste de conexão.');
      assert.equal(input.host, '127.0.0.1'); assert.equal(input.port, proxyPort);
      assert.equal(input.username, 'usuario'); assert.equal(input.password, 'senha:extra');
      assert.equal(input.protocol, 'http');
      store.data.proxies.push({ id: randomUUID(), name: input.name, protocol: input.protocol, host: input.host, port: input.port, diagnostic: { ip: '192.0.2.1', location: { city: 'Campinas', region: 'São Paulo', country: 'Brasil' } } });
      store.save(); return handlers.state();
    };
    await evaluate(`document.querySelector('[data-platform="instagram"] button').click(); document.querySelector('[data-page="creator"]').click(); document.querySelector('#creator-generate').click()`);
    await settled();
    await evaluate(`(() => { const transfer = new DataTransfer(); transfer.setData('text', 'invalida'); document.querySelector('#creator-proxy-paste').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); })()`);
    await settled();
    assert.equal(calls, 0, 'invalid paste never reaches provider');
    await evaluate(`document.querySelector('#creator-open').click()`); await settled();
    assert.equal(store.data.accounts.length, originalAccounts.size, 'invalid proxy cannot fall back to direct signup');
    await evaluate(`document.querySelector('#creator-proxy-paste').value = 'failed.example:8080'; document.querySelector('#creator-open').click()`); await settled();
    assert.equal(calls, 1); assert.equal(store.data.accounts.length, originalAccounts.size);
    assert.equal(await evaluate(`document.querySelector('#creator-proxy-feedback').dataset.error`), 'true');
    await evaluate(`(() => { const transfer = new DataTransfer(); transfer.setData('text', '127.0.0.1:${proxyPort}:usuario:senha:extra'); document.querySelector('#creator-proxy-paste').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); })()`);
    await settled();
    const proxy = store.data.proxies.find(item => !originalProxies.has(item.id));
    assert.ok(proxy); assert.equal(calls, 2);
    assert.equal(await evaluate(`document.querySelector('#creator-proxy').value`), proxy.id, 'pasted proxy selected automatically');
    assert.equal(await evaluate(`document.querySelector('#creator-connection.is-connected')?.textContent`), 'Conectada · IP 192.0.2.1 · Campinas, São Paulo, Brasil');
    assert.equal(await evaluate(`document.querySelector('#creator-proxy-paste').value`), '', 'credentials removed from paste input');
    await evaluate(`document.querySelector('#creator-save').click()`); await settled();
    const account = store.data.accounts.find(item => !originalAccounts.has(item.id));
    assert.ok(account); assert.equal(account.proxyId, proxy.id);
    const connection = await prepareAccount(account.id);
    assert.equal(connection.proxy.id, proxy.id);
    assert.match(await connection.ses.resolveProxy('https://www.instagram.com/'), /PROXY 127\.0\.0\.1:/);
    const routed = await new Promise((resolve, reject) => {
      const request = require('electron').net.request({ url: 'http://creator-proxy.invalid/', session: connection.ses });
      const timer = setTimeout(() => { request.abort(); reject(new Error('Proxy routing timed out')); }, 5000);
      request.on('error', error => { clearTimeout(timer); reject(error); });
      request.on('response', response => {
        let body = ''; response.on('data', chunk => { body += chunk; });
        response.on('end', () => { clearTimeout(timer); resolve(body); });
      });
      request.end();
    });
    assert.equal(routed, 'creator-proxy-fixture', 'signup session reaches the pasted upstream proxy');
    await evaluate(`document.querySelector('#creator-open').click()`); await settled();
    assert.equal(account.registration.status, 'awaiting');
    assert.equal(calls, 2, 'save/open does not duplicate the pasted proxy');
    const cookieUrl = 'https://creator-session.invalid/';
    await connection.ses.cookies.set({ url: cookieUrl, name: 'test_login', value: 'first-account', secure: true });
    await evaluate(`document.querySelector('#creator-generate').click()`); await settled();
    assert.equal(await evaluate(`document.querySelector('#creator-stage').textContent`), 'Novo rascunho');
    assert.equal(await evaluate(`document.querySelector('#creator-proxy').value`), proxy.id);
    await evaluate(`document.querySelector('#creator-form [name="handle"]').value = 'outro.perfilpxx42'; document.querySelector('#creator-open').click()`); await settled();
    const second = store.data.accounts.find(item => item.handle === 'outro.perfilpxx42');
    assert.ok(second);
    const nextConnection = await prepareAccount(second.id);
    assert.equal(nextConnection.proxy.id, proxy.id);
    assert.notEqual(nextConnection.ses, connection.ses);
    assert.equal((await nextConnection.ses.cookies.get({ url: cookieUrl, name: 'test_login' })).length, 0);
    assert.equal((await connection.ses.cookies.get({ url: cookieUrl, name: 'test_login' })).length, 1);
  } finally {
    handlers.addProxy = originalAdd;
    for (const account of store.data.accounts.filter(item => !originalAccounts.has(item.id))) await handlers.deleteAccount(account.id);
    for (const proxy of store.data.proxies.filter(item => !originalProxies.has(item.id))) await handlers.deleteProxy(proxy.id);
    proxyServer.closeAllConnections();
    await new Promise(resolve => proxyServer.close(resolve));
    await evaluate(`(async () => { window.applyStudioState(await window.studio.state()); })()`);
  }
}
module.exports = { run };
