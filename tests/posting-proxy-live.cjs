const { app, BrowserWindow, net, session, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createProxyFetch } = require('../src/proxy-fetch.cjs');
const dataDir = path.resolve(process.env.STUDIO_DATA_DIR || path.join(__dirname, '..', '.local'));
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(__dirname, '..', '.smoke', 'posting-proxy-browser'));
app.on('window-all-closed', () => {});

async function probe(connection) {
  const response = await createProxyFetch(net, connection)('https://api.ipify.org?format=json');
  if (!response.ok || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test((await response.json()).ip || '')) throw new Error('O IP de saída não foi confirmado.');
}

app.whenReady().then(async () => {
  try {
    const direct = session.fromPartition('posting-proxy-probe-direct');
    await direct.setProxy({ mode: 'direct' });
    await probe({ ses: direct, proxy: null, credentials: null });
    const stateFile = path.join(dataDir, 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const proxy = state.proxies.find(item => item.id === process.env.STUDIO_PROXY_ID) || state.proxies.find(item => item.protocol === 'http' && item.credentials);
    if (!proxy) throw new Error('Nenhum proxy HTTP autenticado cadastrado para o teste.');
    const saved = await safeStorage.decryptStringAsync(Buffer.from(proxy.credentials, 'base64'));
    const credentials = JSON.parse(saved.result);
    const proxied = session.fromPartition('posting-proxy-probe-proxied');
    await proxied.setProxy({ mode: 'fixed_servers', proxyRules: `${proxy.protocol}://${proxy.host}:${proxy.port}`, proxyBypassRules: '<-loopback>' });
    await probe({ ses: proxied, proxy, credentials });
    const browser = new BrowserWindow({ show: false, webPreferences: { session: proxied, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    app.on('login', (event, contents, details, authInfo, callback) => {
      event.preventDefault();
      if (contents?.id === browser.webContents.id && details.firstAuthAttempt && authInfo.isProxy && authInfo.host === proxy.host && authInfo.port === proxy.port) callback(credentials.username, credentials.password);
      else callback();
    });
    try {
      await browser.loadURL('https://api.ipify.org?format=json');
      const body = await browser.webContents.executeJavaScript('document.body.innerText');
      if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(JSON.parse(body).ip || '')) throw new Error('O navegador de login não confirmou o IP via proxy.');
    } finally { browser.destroy(); }
    const unavailable = session.fromPartition('posting-proxy-probe-unavailable');
    await unavailable.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:1', proxyBypassRules: '<-loopback>' });
    let rejected = false;
    try { await probe({ ses: unavailable, proxy: { host: '127.0.0.1', port: 1 }, credentials: null }); } catch { rejected = true; }
    if (!rejected) throw new Error('O proxy indisponível caiu para conexão direta.');
    console.log('Posting proxy probe: direct, authenticated proxy and unavailable proxy passed.');
  } catch (error) { console.error(`Posting proxy probe failed: ${error.message}`); process.exitCode = 1; }
  finally { app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error.message); app.exit(1); });
