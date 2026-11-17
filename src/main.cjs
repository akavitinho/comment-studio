const { app, BrowserWindow, Menu, ipcMain, session, safeStorage, net, dialog, shell, nativeImage, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { isIP } = require('node:net');
const { Store } = require('./store.cjs');
const domain = require('./domain.cjs');
const { creatorHandlers, publicAccount } = require('./instagram-creator.cjs');
const { signupURL: instagramSignupURL, startInstagramSignupFill } = require('./instagram-signup-fill.cjs');
const { windowTitle } = require('./window-title.cjs');
const { Automation, videoKey, targetURL, campaignTargets } = require('./automation.cjs');
const { XAutomation } = require('./x-automation.cjs');
const { xCampaign, postKey } = require('./x-domain.cjs');
const { MediaProcessor } = require('./media.cjs');
const { VideoDownloader, analyzeLinks } = require('./downloader.cjs');
const { PostingPlan, validateConfig: validatePostingConfig } = require('./posting-plan.cjs');
const { syncPostingFolders } = require('./posting-folder-sync.cjs');
const { MetaAuth } = require('./meta-auth.cjs');
const { FacebookAuth } = require('./facebook-auth.cjs');
const { TikTokAnalytics } = require('./tiktok-analytics.cjs');
const { PostingStorage } = require('./posting-storage.cjs');
const { PostingWorker } = require('./posting-worker.cjs');
const { MetaPublisher } = require('./meta-publisher.cjs');
const { InstagramAccountInsights } = require('./instagram-account-insights.cjs');
const { createProxyFetch } = require('./proxy-fetch.cjs');
const { openFreeBrowser } = require('./free-browser.cjs');
const { stealthPatchSource } = require('./stealth-preload.cjs');
const { ensureFingerprint } = require('./fingerprint.cjs');
const { TlsProxy } = require('./tls-proxy.cjs');
const { allowInstagramNotifications } = require('./site-permissions.cjs');
const { binaryPath } = require('./runtime-binaries.cjs');
const { campaignAnalytics } = require('./campaign-analytics.cjs');

const root = path.join(__dirname, '..');
const dashboardSmoke=process.argv.includes('--smoke-dashboard');
const smoke = dashboardSmoke || process.argv.includes('--smoke');
const xReadOnly = process.argv.includes('--check-x-readonly');
const dataDir = app.isPackaged ? app.getPath('userData') : path.join(root, smoke ? `.smoke/run-${Date.now()}` : '.local');
fs.mkdirSync(dataDir, { recursive: true });
if (!app.isPackaged) app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'browser'));
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// Prevent Electron/app name from leaking into HTTP headers and navigator properties
app.commandLine.appendSwitch('disable-features', 'ElectronSerialChooser,HardwareMediaKeyHandling');
app.commandLine.appendSwitch('enable-features', 'ReduceUserAgentMinorVersion');
const sitePreloadPath = path.join(dataDir, 'site-preload.generated.cjs');
fs.writeFileSync(sitePreloadPath, "'use strict';\nconst { webFrame } = require('electron');\nwebFrame.executeJavaScript(" + JSON.stringify(stealthPatchSource()) + ").catch(() => {});\n");
const homeURL = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
const execFileAsync = promisify(execFile);
const thumbnailCache = new Map();
const postingProfilePictures = new Map();
let mainWindow, store, automation, xAutomation, mediaProcessor, videoDownloader, postingPlan, metaAuth, facebookAuth, tiktokAnalytics, postingStorage, postingWorker;
const pendingInstagramLinks = new Map();
let postingFolderSyncTimer;
const accountWindows = new Map();
const proxyBrowserWindows = new Map();
const freeAccountWindows = new Map();
const prepared = new Map();
const tlsProxy = new TlsProxy({ dataDir, helperPath: app.isPackaged
  ? path.join(process.resourcesPath, 'bin', 'tls-helper.exe')
  : path.join(root, 'vendor', 'tls-helper.exe') });
let tlsProxyReady;
const lastErrors = new Map();
const authByContents = new Map();
const busyConnections = new Set();
let instagramCoordinator = null;
const { InstagramInsightsCoordinator } = require('./instagram-insights-coordinator.cjs');
const { createInstagramCollector } = require('./instagram-insights-collector.cjs');
async function confirmRestartCycle(id) {
  const account = getAccount(id);
  if (automation.accountProgress.get(id)?.status !== 'waiting') return snapshot();
  const result = await dialog.showMessageBox(accountWindows.get(id) || mainWindow, {
    type: 'question', title: 'Limite atingido',
    message: 'Você atingiu o limite que definiu. Deseja continuar?',
    detail: `${account.name}: iniciar um novo ciclo com o mesmo limite por hora configurado? O histórico será mantido.`,
    buttons: ['Não', 'Sim, reiniciar ciclo'], defaultId: 0, cancelId: 0, noLink: true
  });
  if (result.response === 1) automation.restartAccountCycle(id);
  return snapshot();
}
function accountTitle(account, platform, proxy) {
  return windowTitle(account, platform, proxy, automation?.accountProgress.get(account.id), automation?.current.status);
}
function refreshAccountTitles() {
  for (const [id, win] of accountWindows) {
    const account = store.data.accounts.find(item => item.id === id);
    if (!account || win.isDestroyed()) continue;
    win.refreshCampaignMenu?.();
    win.setTitle(accountTitle(account, accountPlatform(account), store.data.proxies.find(item => item.id === account.proxyId)));
  }
}
function ensureClosed(account) {
  if (xAutomation?.owns(account.id) || xAutomation?.checking) throw new Error('Pare o aquecimento do X antes de alterar esta conexão.');
  if (accountWindows.has(account.id)) throw new Error(`Feche a janela de ${account.name} antes de editar a conexão.`);
  if (freeAccountWindows.has(account.id)) throw new Error(`Feche o navegador livre de ${account.name} antes de editar a conexão.`);
}
function clearPrepared(id) {
  prepared.delete(`persist:account-${id}`);
  prepared.delete(`persist:posting-account-${id}`);
  tlsProxy.deallocate(`persist:account-${id}`);
}
async function lookupLocation(ip) {
  try {
    const result = await new Promise((resolve, reject) => {
      const request = net.request({ url: `https://api.ipapi.is/?q=${encodeURIComponent(ip)}`, session: session.defaultSession, redirect: 'error', cache: 'no-store' });
      let finished = false;
      const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { request.abort(); finish(new Error('timeout')); }, 6000);
      request.on('error', error => finish(error));
      request.on('response', response => {
        if (response.statusCode !== 200) { response.resume(); finish(new Error('lookup failed')); return; }
        let body = '';
        response.on('data', chunk => { body += chunk; if (body.length > 16384) { request.abort(); finish(new Error('response too large')); } });
        response.on('end', () => { try { finish(null, JSON.parse(body)); } catch (error) { finish(error); } });
        response.on('error', error => finish(error));
      });
      request.end();
    });
    if (result.ip !== ip || result.error || result.is_bogon) return null;
    const clean = value => typeof value === 'string' ? value.slice(0, 120) : null;
    const location = result.location ?? result;
    return {
      city: clean(location.city), region: clean(location.state || location.region), country: clean(location.country),
      network: clean(result.asn?.descr || result.company?.name || result.asn || result.company), source: 'ipapi.is'
    };
  } catch { return null; }
}

function getAccount(id) {
  const account = store.data.accounts.find(a => a.id === id);
  if (!account) throw new Error('Conta não encontrada.');
  return account;
}
function accountPlatform(account) {
  if (account.platform === 'instagram') return { id: 'instagram', label: 'Instagram', login: 'https://www.instagram.com/accounts/login/', home: 'https://www.instagram.com/' };
  if (account.platform === 'facebook') return { id: 'facebook', label: 'Facebook', login: 'https://www.facebook.com/login/', home: 'https://www.facebook.com/' };
  if (account.platform === 'x') return { id: 'x', label: 'X', login: 'https://x.com/i/flow/login', home: 'https://x.com/home' };
  return { id: 'tiktok', label: 'TikTok', login: 'https://www.tiktok.com/login', home: 'https://www.tiktok.com/foryou' };
}
function snapshot() {
  return {
    accounts: store.data.accounts.map(a => ({ ...publicAccount(a), open: accountWindows.has(a.id), browserOpen: freeAccountWindows.has(a.id), error: lastErrors.get(a.id) || null, meta: a.platform === 'instagram' ? metaAuth?.status(a.id) : undefined, facebook: a.platform === 'facebook' ? facebookAuth?.status(a.id) : undefined, tiktokAnalytics: a.platform === 'tiktok' ? tiktokAnalytics?.status(a.id) : undefined })),
    accountTags: store.data.accountTags || [],
    proxies: store.data.proxies.map(({ credentials, ...p }) => ({ ...p, authenticated: Boolean(credentials), browserOpen: Boolean(proxyBrowserWindows.get(p.id) && !proxyBrowserWindows.get(p.id).isDestroyed()) })),
    campaign: store.data.campaign, events: store.data.events, automation: automation?.snapshot(),
    xCampaign: store.data.xCampaign || null, xAutomation: xAutomation?.snapshot(),
    postings: postingPlan?.snapshot(),
    facebookMetrics: postingPlan?.db.prepare('SELECT * FROM facebook_page_insights').all() || [],
    accountMetrics: postingPlan?.accountInsights?.latestRanking(store.data.accounts.filter(account => account.platform === 'instagram').map(account => account.id)),
    metaSettings: metaAuth?.settings(),
    tiktokAnalyticsSettings: tiktokAnalytics?.settings(),
    tiktokInsights: tiktokAnalytics?.snapshot(),
    campaignAnalytics: campaignAnalytics(store.data),
    postingStorage: postingStorage?.info(),
    xAttempts: (store.data.xAttempts || []).slice(0, 100).map(item => ({ ...item, accountName: store.data.accounts.find(a => a.id === item.accountId)?.name || 'Conta removida' })),
    attempts: (store.data.attempts || []).slice(0, 30).map(item => ({ ...item, accountName: store.data.accounts.find(a => a.id === item.accountId)?.name || 'Conta removida' })),
    version: app.getVersion()
  };
}
function refreshPostingFolders(completedFile = null) {
  const importedCount = syncPostingFolders(postingPlan, store.data.accounts, { completedFile });
  if (importedCount && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:postings', snapshot());
  return importedCount;
}
function configStealth(ses) {
  const rawUA = ses.getUserAgent();
  const cleanUA = rawUA
    .replace(/ Electron\/[\d.]+/g, '')
    .replace(/ [\w\s-]+\/[\d.]+(?= Chrome\/)/g, '');
  ses.setUserAgent(cleanUA);
  // Override Sec-CH-UA headers to include Google Chrome branding.
  // Google/Instagram block login from embedded browsers that lack this brand.
  const chromeMatch = cleanUA.match(/Chrome\/(\d+)/);
  const chromeMajor = chromeMatch ? chromeMatch[1] : '134';
  const chromeFullMatch = cleanUA.match(/Chrome\/([\d.]+)/);
  const chromeFull = chromeFullMatch ? chromeFullMatch[1] : chromeMajor;
  const brandHeader = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not:A-Brand";v="99"`;
  const brandFullHeader = `"Chromium";v="${chromeFull}", "Google Chrome";v="${chromeFull}", "Not:A-Brand";v="99.0.0.0"`;
  const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const keys = Object.keys(headers);
    for (const k of keys) {
      const lk = k.toLowerCase();
      if (lk === 'sec-ch-ua') { delete headers[k]; }
      if (lk === 'sec-ch-ua-full-version-list') { delete headers[k]; }
      if (lk === 'sec-ch-ua-mobile') { delete headers[k]; }
      if (lk === 'sec-ch-ua-platform') { delete headers[k]; }
      // Remove any header that may leak Electron or app name
      if (lk === 'user-agent') { delete headers[k]; }
    }
    headers['User-Agent'] = cleanUA;
    headers['Sec-CH-UA'] = brandHeader;
    headers['Sec-CH-UA-Full-Version-List'] = brandFullHeader;
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = `"${platform}"`;
    // Fix Sec-Fetch-* headers for top-level navigation to look like real Chrome
    if (details.resourceType === 'mainFrame') {
      headers['Sec-Fetch-Dest'] = 'document';
      headers['Sec-Fetch-Mode'] = 'navigate';
      headers['Sec-Fetch-Site'] = 'none';
      headers['Sec-Fetch-User'] = '?1';
    }
    callback({ requestHeaders: headers });
  });
}
async function prepareAccount(id) {
  const account = getAccount(id);
  const proxy = account.proxyId ? store.data.proxies.find(p => p.id === account.proxyId) : null;
  if (account.proxyId && !proxy) throw new Error('O proxy desta conta não foi encontrado.');
  if (proxy && account.browserProfile === 'proxy') return { ...await prepareProxyBrowser(proxy.id), account };
  return prepareConnection(`persist:account-${account.id}`, account, proxy);
}
async function preparePostingAccount(id) {
  const account = getAccount(id);
  if (!['instagram', 'facebook'].includes(account.platform)) throw new Error('Esta conta não publica posts ou Reels.');
  const proxy = domain.postingProxy(account, store.data.proxies);
  return prepareConnection(`persist:posting-account-${id}`, account, proxy);
}
async function prepareTikTokAnalyticsAccount(id) {
  const account = getAccount(id);
  const proxy = account.proxyId ? store.data.proxies.find(p => p.id === account.proxyId) : null;
  if (account.proxyId && !proxy) throw new Error('O proxy desta conta não foi encontrado.');
  return prepareConnection(`persist:tiktok-analytics-${id}`, account, proxy);
}
async function prepareProxy(id) {
  const proxy = store.data.proxies.find(p => p.id === id);
  if (!proxy) throw new Error('Proxy não encontrado.');
  return prepareConnection(`proxy-test-${proxy.id}`, proxy, proxy);
}
async function prepareProxyBrowser(id) {
  const proxy = store.data.proxies.find(p => p.id === id);
  if (!proxy) throw new Error('Proxy não encontrado.');
  return prepareConnection(`persist:proxy-browser-${id}`, proxy, proxy);
}
function injectStealth(contents, profile) {
  const patch = stealthPatchSource(profile || null);
  contents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.log('[PAGE-ERROR]', sourceId?.split('/').pop(), ':', line, message?.slice(0, 300));
  });
  const inject = () => { contents.executeJavaScript(patch).catch(() => {}); };
  contents.on('dom-ready', inject);
  contents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && url !== 'about:blank') inject();
  });
}
function registerFreeContents(contents, config, openPopup) {
  authByContents.set(contents.id, config);
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  injectStealth(contents, config.account ? config.account.fingerprint : null);
  const checkNavigation = (event, next) => { if (!next.startsWith('https://') && next !== 'about:blank' && !next.startsWith('blob:') && !next.startsWith('data:')) event.preventDefault(); };
  contents.on('will-navigate', checkNavigation);
  contents.on('will-redirect', checkNavigation);
  contents.setWindowOpenHandler(details => {
    const url = details.url;
    if ((url.startsWith('https://') || url === 'about:blank') && openPopup) openPopup(url);
    return { action: 'deny' };
  });
  contents.once('destroyed', () => authByContents.delete(contents.id));
}
async function openProxyBrowser({ id } = {}) {
  const existing = proxyBrowserWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.show(); existing.restore(); existing.focus();
    return snapshot();
  }
  const config = await prepareProxyBrowser(id);
  const { proxy, ses } = config;
  const win = await openFreeBrowser({ title: `Navegador \xb7 ${proxy.name}`, session: ses, startURL: 'https://www.google.com/', show: !smoke, preload: sitePreloadPath,
    register: (contents, createPopup) => registerFreeContents(contents, config, createPopup),
    onClose: () => { proxyBrowserWindows.delete(id); void ses.flushStorageData(); }
  });
  proxyBrowserWindows.set(id, win);
  store.log(`Navegador do proxy ${proxy.name} aberto.`);
  return snapshot();
}
function linkProxyBrowser(account) {
  if (!account.proxyId) throw new Error('Selecione uma proxy para esta conta.');
  const owner = store.data.accounts.find(item => item.id !== account.id && item.proxyId === account.proxyId && item.browserProfile === 'proxy');
  if (owner) throw new Error(`O navegador desta proxy já está vinculado a @${owner.handle || owner.name}. Abra o navegador desta conta para usar a mesma proxy com uma sessão separada.`);
  if (postingWorker.active.has(account.id)) throw new Error('Aguarde a publicação em andamento antes de trocar o perfil do navegador.');
  if (xAutomation?.owns(account.id) || xAutomation?.checking) throw new Error('Pare o aquecimento do X antes de trocar o perfil do navegador.');
  if (accountWindows.has(account.id)) throw new Error(`Feche a janela de ${account.name} antes de trocar o perfil do navegador.`);
  closeFreeAccountBrowsers(account.id);
  account.browserProfile = 'proxy';
  clearPrepared(account.id);
  store.log(`Navegador da proxy vinculado à conta ${account.name}.`);
}
function closeFreeAccountBrowsers(id) {
  for (const window of freeAccountWindows.get(id) || []) window.close();
}
async function ensureAccountBrowser(id, { loadHome = true, newWindow = false } = {}) {
  const account = getAccount(id);
  const proxyHasOwner = store.data.accounts.some(item => item.id !== id && item.proxyId === account.proxyId && item.browserProfile === 'proxy');
  if (account.proxyId && !account.registration && account.browserProfile !== 'proxy' && !proxyHasOwner) linkProxyBrowser(account);
  const windows = freeAccountWindows.get(id) || new Set();
  const existing = [...windows].findLast(window => !window.isDestroyed());
  if (!newWindow && existing) return existing;
  const config = await prepareAccount(id);
  const { proxy, ses } = config;
  const win = await openFreeBrowser({ title: `Navegador · ${account.name}${proxy ? ` · ${proxy.name}` : ' · Direta'}`, session: ses,
    startURL: 'https://www.google.com/', loadHome, newWindow, show: !smoke, preload: sitePreloadPath, register: (contents, createPopup) => registerFreeContents(contents, config, createPopup),
    onClose: () => {
      windows.delete(win);
      if (!windows.size && freeAccountWindows.get(id) === windows) freeAccountWindows.delete(id);
      void ses.flushStorageData();
    }
  });
  windows.add(win);
  freeAccountWindows.set(id, windows);
  store.log(`Navegador livre de ${account.name} aberto.`);
  return win;
}
async function openAccountBrowser(id) {
  const win = await ensureAccountBrowser(id);
  if (!smoke) { win.show(); win.restore(); win.focus(); }
  return snapshot();
}
async function prepareConnection(key, account, proxy) {
  if (prepared.has(key)) return prepared.get(key);
  const ses = session.fromPartition(key);
  configStealth(ses);
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => callback(allowInstagramNotifications(permission, details?.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowInstagramNotifications(permission, requestingOrigin));
  ses.on('will-download', event => event.preventDefault());
  let credentials = null;
  if (proxy?.credentials) {
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(proxy.credentials, 'base64'));
    credentials = JSON.parse(decrypted.result);
    if (decrypted.shouldReEncrypt) {
      proxy.credentials = (await safeStorage.encryptStringAsync(decrypted.result)).toString('base64');
      store.save();
    }
  }
  let proxyRules = proxy ? `${proxy.protocol}://${proxy.host}:${proxy.port}` : null;
  const browserConnection = key.startsWith('persist:account-') || key.startsWith('persist:proxy-browser-');
  if (browserConnection && (!proxy || ['http', 'https'].includes(proxy.protocol)) && tlsProxy.available) {
    tlsProxyReady ||= tlsProxy.init();
    if (await tlsProxyReady) {
      const upstream = proxy && { protocol: proxy.protocol, host: proxy.host, port: proxy.port,
        username: credentials?.username, password: credentials?.password };
      await tlsProxy.allocate(key, { upstream });
      proxyRules = tlsProxy.proxyRules(key);
      ses.setCertificateVerifyProc((request, callback) => tlsProxy.verifyCertificate(request, callback));
    }
  }
  await ses.setProxy(proxyRules ? { mode: 'fixed_servers', proxyRules, proxyBypassRules: '<-loopback>' } : { mode: 'direct' });
  await ses.closeAllConnections();
  const result = { account, proxy, credentials, ses };
  prepared.set(key, result);
  return result;
}
function matchesProxy(config, authInfo) {
  return config?.credentials && authInfo.isProxy && config.proxy.host.toLowerCase() === authInfo.host.toLowerCase() && config.proxy.port === authInfo.port;
}
app.on('login', (event, contents, details, authInfo, callback) => {
  event.preventDefault();
  const config = contents && authByContents.get(contents.id);
  if (matchesProxy(config, authInfo) && details.firstAuthAttempt) callback(config.credentials.username, config.credentials.password);
  else callback();
});
function safeError(error) {
  const code = String(error?.message || '').match(/ERR_[A-Z_]+/)?.[0];
  return code ? `Não foi possível carregar a página (${code}). Confira a conexão e o proxy.` : 'Não foi possível abrir a página. Confira a conexão e tente novamente.';
}
async function openAccount(id, testURL, { background = false } = {}) {
  const existing = accountWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (!background) { existing.show(); existing.restore(); existing.focus(); }
    return snapshot();
  }
  if (existing) accountWindows.delete(id);
  const config = await prepareAccount(id);
  const { account, proxy, ses } = config;
  const platform = accountPlatform(account);
  const title = accountTitle(account, platform, proxy);
  const win = new BrowserWindow({ width: 1100, height: 800, minWidth: 480, minHeight: 400, title, show: !smoke && !background, backgroundColor: '#ffffff', webPreferences: { preload: sitePreloadPath, session: ses, backgroundThrottling: false, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true } });
  accountWindows.set(id, win);
  authByContents.set(win.webContents.id, config);
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  win.webContents.on('before-input-event', (_event, input) => { if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools(); });
  injectStealth(win.webContents, account.fingerprint || null);
  const load = url => automation.bounded(win, 'abrir janela', 30000, () => win.loadURL(url)).catch(error => {
    lastErrors.set(id, safeError(error));
    store.log(`Falha ao abrir navegador de ${account.name}. Verifique a conexão.`);
    if (automation.execution.getStore()) throw error;
  });
  const navigation = [
    { label: `Entrar no ${platform.label}`, click: () => load(platform.login) },
    { label: platform.id === 'tiktok' ? 'For You' : 'Página inicial', click: () => load(platform.home) }
  ];
  if (account.handle) navigation.push({ label: 'Abrir perfil', click: () => load(platform.id === 'instagram' ? `https://www.instagram.com/${encodeURIComponent(account.handle)}/` : platform.id === 'x' ? `https://x.com/${encodeURIComponent(account.handle)}` : `https://www.tiktok.com/@${encodeURIComponent(account.handle)}`) });
  if (platform.id === 'tiktok') navigation.push({ label: 'Abrir alvo da campanha salva', click: () => { const c = store.data.campaign; if (c) load(targetURL(c)); } });
  navigation.push({ type: 'separator' }, { label: 'Voltar', click: () => { if (win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack(); } }, { label: 'Recarregar', click: () => win.webContents.reload() });
  win.refreshCampaignMenu = () => win.setMenu(Menu.buildFromTemplate([
    { label: 'Navegar', submenu: navigation },
    { label: 'Conta', submenu: [{ label: 'Fechar e preservar sessão', click: () => win.close() }] },
    ...(platform.id === 'tiktok' ? [{ label: automation.workers.get(id)?.paused ? 'Continuar esta conta' : 'Pausar esta conta', enabled: Boolean(automation.workers.get(id) && !automation.workers.get(id).done), click: () => automation.workers.get(id)?.paused ? automation.resumeAccount(id) : automation.pauseAccount(id) }, ...(automation.accountProgress.get(id)?.status === 'waiting' ? [{ label: 'Reiniciar ciclo', click: () => { void confirmRestartCycle(id); } }] : [])] : [])
  ]));
  win.refreshCampaignMenu();
  win.webContents.on('page-title-updated', event => { event.preventDefault(); win.setTitle(accountTitle(account, platform, proxy)); });
  const checkNavigation = (event, url) => { if (!url.startsWith('https://') && !url.startsWith('blob:') && !url.startsWith('data:')) event.preventDefault(); };
  win.webContents.on('will-navigate', checkNavigation);
  win.webContents.on('will-redirect', checkNavigation);
  win.webContents.setWindowOpenHandler(details => {
    // Allow same-site popups (Instagram Stories/Highlights modals)
    try {
      const target = new URL(details.url);
      const current = new URL(win.webContents.getURL());
      if (target.hostname === current.hostname || details.url === 'about:blank') {
        return { action: 'allow', overrideBrowserWindowOptions: { show: true, webPreferences: { preload: sitePreloadPath, session: ses, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true } } };
      }
    } catch {}
    store.log(`Popup externo bloqueado em ${account.name}: ${details.url?.slice(0, 80)}`);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', child => {
    injectStealth(child.webContents, account.fingerprint || null);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
  win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) lastErrors.set(id, safeError({ message: description }));
  });
  win.webContents.on('did-finish-load', () => lastErrors.delete(id));
  const contentsId = win.webContents.id;
  win.on('closed', () => { if (accountWindows.get(id) === win) accountWindows.delete(id); authByContents.delete(contentsId); ses.flushStorageData(); });
  store.log(`Navegador ${platform.label} aberto: ${account.name}. Autenticação ainda não verificada.`);
  const campaignURL = platform.id === 'tiktok' && typeof testURL === 'string' && /^https:\/\/www\.tiktok\.com\/(tag\/|search(?:\/video)?\?|foryou(?:[/?#]|$))/.test(testURL) ? testURL : null;
  await load(smoke ? (testURL || 'about:blank') : (campaignURL || (platform.id === 'x' || platform.id === 'instagram' ? platform.home : platform.login)));
  return snapshot();
}
async function testConnection(id, proxyOnly = false) {
  const key = `${proxyOnly ? 'proxy' : 'account'}:${id}`;
  if (busyConnections.has(key)) throw new Error('Um teste já está em andamento para esta conexão.');
  busyConnections.add(key);
  try {
    const config = await (proxyOnly ? prepareProxy(id) : prepareAccount(id));
    const started = Date.now();
    const ip = await probeConnection(config);
    const location = await lookupLocation(ip);
    const diagnostic = { ip, durationMs: Date.now() - started, at: new Date().toISOString(), location };
    config.account.diagnostic = diagnostic;
    if (proxyOnly) { delete config.account.testFailure; store.save(); }
    store.log(`Conexão verificada: ${config.account.name}. IP observado: ${ip}.`);
    return snapshot();
  } catch (error) {
    if (proxyOnly) {
      const proxy = store.data.proxies.find(item => item.id === id);
      if (proxy) { proxy.testFailure = { at: new Date().toISOString(), message: 'Falha no teste de conexão. Confira o proxy.' }; store.save(); }
    }
    throw error;
  } finally { busyConnections.delete(key); }
}
async function probeConnection(config) {
    return new Promise((resolve, reject) => {
      const request = net.request({ url: 'https://api.ipify.org?format=json', session: config.ses, redirect: 'error', cache: 'no-store' });
      let attempts = 0;
      const timer = setTimeout(() => { request.abort(); reject(new Error('O teste excedeu 15 segundos. Confira o proxy.')); }, 15000);
      request.on('login', (authInfo, callback) => { if (matchesProxy(config, authInfo) && attempts++ === 0) callback(config.credentials.username, config.credentials.password); else callback(); });
      request.on('error', error => {
        clearTimeout(timer);
        const code = String(error.message || '').match(/ERR_[A-Z_]+/)?.[0] || 'ERRO_DE_REDE';
        const messages = {
          ERR_PROXY_CONNECTION_FAILED: 'Não foi possível alcançar o proxy. Confira o servidor e a porta.',
          ERR_TUNNEL_CONNECTION_FAILED: 'O proxy recusou a conexão. Confira as credenciais e a liberação no fornecedor.',
          ERR_INVALID_AUTH_CREDENTIALS: 'O proxy recusou o usuário ou a senha.',
          ERR_PROXY_AUTH_REQUESTED: 'O proxy exige autenticação. Confira o usuário e a senha.',
          ERR_TIMED_OUT: 'O proxy demorou para responder. Tente novamente.',
          ERR_CONNECTION_RESET: 'A conexão foi interrompida. Tente novamente.',
          ERR_NAME_NOT_RESOLVED: 'Não foi possível localizar o servidor.'
        };
        store.log(`Teste de conexão falhou: ${code}.`);
        reject(new Error(`${messages[code] || 'Não foi possível concluir o teste de conexão.'} (${code})`));
      });
      request.on('response', response => {
        let body = '';
        response.on('data', chunk => { body += chunk; if (body.length > 8192) { request.abort(); clearTimeout(timer); reject(new Error('Resposta de diagnóstico inválida.')); } });
        response.on('error', () => { clearTimeout(timer); reject(new Error('Conexão interrompida durante o teste.')); });
        response.on('end', () => { clearTimeout(timer); try { const value = JSON.parse(body).ip; if (response.statusCode !== 200 || !isIP(value)) throw new Error(); resolve(value); } catch { reject(new Error('O serviço de diagnóstico não retornou um IP válido.')); } });
      });
      request.end();
    });
}
async function validateNewProxy(proxy, credentials) {
  const ses = session.fromPartition(`proxy-validation-${randomUUID()}`);
  await ses.setProxy({ mode: 'fixed_servers', proxyRules: `${proxy.protocol}://${proxy.host}:${proxy.port}`, proxyBypassRules: '<-loopback>' });
  try {
    const started = Date.now();
    const ip = await probeConnection({ proxy, credentials, ses });
    return { ip, durationMs: Date.now() - started, at: new Date().toISOString(), location: await lookupLocation(ip) };
  } finally { await ses.closeAllConnections(); }
}

async function bindInstagramAuthorization(id, result) {
  const account = getAccount(id);
  const selected = result.profile;
  const choice = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Confirmar perfil Instagram', message: `Conectar @${selected.username} a ${account.name}?`, detail: 'Este é o perfil autorizado diretamente pelo Instagram. Confira antes de vincular.', buttons: ['Vincular perfil', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true });
  if (choice.response !== 0) return { ...snapshot(), metaConnectionCancelled: true };
  const registered = String(account.handle || '').replace(/^@/, '').toLowerCase();
  if (registered && selected.username && registered !== selected.username.toLowerCase()) {
    const warning = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Perfis diferentes', message: `O cadastro é @${registered}, mas a Meta autorizou @${selected.username}.`, detail: 'Confira se esta é a conta correta antes de vinculá-la. A publicação usará o ID do perfil autorizado pela Meta.', buttons: ['Voltar', 'Vincular este perfil'], defaultId: 0, cancelId: 0, noLink: true });
    if (warning.response !== 1) return { ...snapshot(), metaConnectionCancelled: true };
  }
  await metaAuth.bind(id, selected);
  domain.applyInstagramIdentity(account, selected.username);
  store.log(`Instagram conectado: @${selected.username}.`);
  return snapshot();
}

const handlers = {
  ...creatorHandlers({ getStore: () => store, safeStorage, ensureFingerprint, ensureClosed, clearPrepared, snapshot,
    openSignup: async id => {
      const browser = await ensureAccountBrowser(id, { loadHome: false, newWindow: true });
      const contents = await browser.loadInitialPage(smoke ? 'about:blank' : instagramSignupURL);
      if (!smoke) {
        const secret = getAccount(id).creatorSecret;
        const decrypted = await safeStorage.decryptStringAsync(Buffer.from(secret, 'base64'));
        startInstagramSignupFill(contents, JSON.parse(decrypted.result));
      }
    }
  }),
  state: () => snapshot(),
  saveTikTokAnalyticsSettings: async input => { await tiktokAnalytics.configure(input); return snapshot(); },
  connectTikTokAnalytics: async id => {
    const account = getAccount(id); if (account.platform !== 'tiktok') throw new Error('Selecione uma conta TikTok.');
    const profile = await tiktokAnalytics.connect(id);
    const name = profile.username ? `@${profile.username}` : profile.displayName || profile.tokens.open_id;
    const choice = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Confirmar perfil TikTok', message: `Conectar ${name} a ${account.name}?`, detail: 'As métricas serão lidas do perfil autorizado pelo TikTok.', buttons: ['Vincular perfil', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true });
    if (choice.response !== 0) return snapshot();
    const registered = String(account.handle || '').replace(/^@/, '').toLowerCase();
    if (registered && profile.username && registered !== profile.username.toLowerCase()) {
      const warning = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Perfis diferentes', message: `O cadastro é @${registered}, mas o TikTok autorizou @${profile.username}.`, buttons: ['Voltar', 'Vincular este perfil'], defaultId: 0, cancelId: 0, noLink: true });
      if (warning.response !== 1) return snapshot();
    }
    await tiktokAnalytics.bind(id, profile); return snapshot();
  },
  disconnectTikTokAnalytics: id => { const account = getAccount(id); if (account.platform !== 'tiktok') throw new Error('Selecione uma conta TikTok.'); tiktokAnalytics.disconnect(id); return snapshot(); },
  refreshTikTokInsights: async accountIds => {
    const ids = [...new Set(Array.isArray(accountIds) ? accountIds : [])];
    const selected = ids.length ? ids.map(getAccount) : store.data.accounts.filter(account => account.platform === 'tiktok');
    let updated = 0, failed = 0; const failures = [];
    for (const account of selected) {
      if (account.platform !== 'tiktok' || !tiktokAnalytics.status(account.id).connected) continue;
      try { updated += await tiktokAnalytics.refresh(account.id); } catch (error) { failed++; failures.push(`${account.name}: ${error.message}`); }
    }
    return { state: snapshot(), updated, failed, failures };
  },
  saveMetaSettings: async input => { if (postingWorker.active.size) throw new Error('Aguarde as publicações em andamento antes de alterar a Meta.'); await metaAuth.configure(input); return snapshot(); },
  savePostingStorage: input => { if (postingWorker.active.size) throw new Error('Aguarde as publicações em andamento antes de alterar o Storage.'); postingStorage.configure(input); return snapshot(); },
  openPublishedReel: async id => { const item = postingPlan.db.prepare('SELECT permalink FROM items WHERE id=? AND status=?').get(id, 'published'); const url = item?.permalink ? new URL(item.permalink) : null; if (!url || url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname)) throw new Error('Link do Reel indisponível.'); await shell.openExternal(url.toString()); return true; },
  openPublishedFacebookReel: async id => { const item = postingPlan.db.prepare('SELECT facebook_permalink FROM items WHERE id=? AND status=?').get(id, 'published'); const url = item?.facebook_permalink ? new URL(item.facebook_permalink) : null; if (!url || url.protocol !== 'https:' || !['facebook.com', 'www.facebook.com'].includes(url.hostname)) throw new Error('Link do Reel no Facebook indisponível.'); await shell.openExternal(url.toString()); return true; },
  connectFacebook: async ({ proxyId = null } = {}) => {
    const proxy = proxyId ? store.data.proxies.find(item => item.id === proxyId) : null;
    if (proxyId && !proxy) throw new Error('Proxy não encontrada.');
    const connection = await prepareConnection(`persist:facebook-login-${proxyId || 'direct'}`, { platform: 'facebook' }, proxy);
    return facebookAuth.connect(connection);
  },
  copyFacebookLoginLink: async ({ proxyId = null } = {}) => {
    const proxy = proxyId ? store.data.proxies.find(item => item.id === proxyId) : null;
    if (proxyId && !proxy) throw new Error('Proxy não encontrada.');
    const connection = await prepareConnection(`persist:facebook-login-${proxyId || 'direct'}`, { platform: 'facebook' }, proxy);
    const { loginUrl, ...result } = await facebookAuth.startExternal(connection);
    clipboard.writeText(loginUrl);
    return result;
  },
  completeFacebookExternalLogin: ({ flowId, callbackUrl }) => facebookAuth.completeExternal(flowId, callbackUrl),
  bindFacebookPages: async ({ flowId, pageIds, proxyId = null, postingConnection }) => {
    const proxy = proxyId ? store.data.proxies.find(item => item.id === proxyId) : null;
    if (proxyId && !proxy) throw new Error('Proxy não encontrada.');
    const publicationRoute = domain.postingConnection(postingConnection, proxyId);
    const pages = facebookAuth.takePages(flowId, pageIds);
    for (const page of pages) {
      let account = store.data.accounts.find(item => item.platform === 'facebook' && item.facebookPageId === page.id);
      if (!account) { account = domain.account({ platform: 'facebook', name: page.name, proxyId, postingConnection: publicationRoute }, store.data.proxies); account.facebookPageId = page.id; store.data.accounts.push(account); }
      else { if (postingWorker.active.has(account.id)) throw new Error('Aguarde a publicação em andamento antes de mudar a conexão da Página.'); const proxyChanged = account.proxyId !== proxyId; if (proxyChanged) ensureClosed(account); account.name = page.name; account.proxyId = proxyId; account.postingConnection = publicationRoute; if (proxyChanged) clearPrepared(account.id); else prepared.delete(`persist:posting-account-${account.id}`); }
      await facebookAuth.bind(account.id, page);
    }
    store.save(); return snapshot();
  },
  disconnectFacebook: id => { const account = getAccount(id); if (account.platform !== 'facebook') throw new Error('Selecione uma Página Facebook.'); if (postingWorker.active.has(id)) throw new Error('Aguarde a publicação em andamento.'); postingPlan.pauseAccount(id); facebookAuth.disconnect(id); return snapshot(); },
  addFacebookPost: ({ accountId, type, file, caption, sourceItemId }) => { const account = getAccount(accountId); if (account.platform !== 'facebook') throw new Error('Selecione uma Página Facebook.'); postingPlan.addFacebook(accountId, { type, file, caption, sourceItemId }, account.name); return snapshot(); },
  queueFacebookFromInstagram: ({ itemId, accountId }) => {
    const source = postingPlan.db.prepare('SELECT * FROM items WHERE id=?').get(itemId);
    const page = getAccount(accountId);
    if (!source || getAccount(source.account_id).platform !== 'instagram' || page.platform !== 'facebook') throw new Error('Selecione um vídeo Instagram e uma Página Facebook.');
    if (!facebookAuth.status(page.id).connected) throw new Error('Reconecte a Página Facebook antes de enviar o vídeo.');
    postingPlan.addFacebook(page.id, { type: 'reel', file: source.file, caption: source.caption, sourceItemId: source.id }, page.name);
    return snapshot();
  },
  saveFacebookSchedule: ({ accountId, ...config }) => { const account = getAccount(accountId); if (account.platform !== 'facebook') throw new Error('Selecione uma Página Facebook.'); if (postingWorker.active.has(accountId)) throw new Error('Aguarde a publicação em andamento.'); postingPlan.configure(accountId, config); return snapshot(); },
  controlFacebookPosting: ({ accountId, status }) => {
    const account = getAccount(accountId);
    if (account.platform !== 'facebook') throw new Error('Selecione uma Página Facebook.');
    if (status === 'running' && !facebookAuth.status(accountId).connected) throw new Error('Conecte a Página Facebook.');
    if (status === 'running' && postingPlan.db.prepare("SELECT 1 FROM items WHERE account_id=? AND status='uncertain'").get(accountId)) throw new Error('Confira a postagem incerta antes de continuar.');
    if (status === 'running' && postingPlan.db.prepare("SELECT 1 FROM items WHERE account_id=? AND content_type='reel' AND status='queued'").get(accountId) && !postingStorage.info().configured) throw new Error('Configure o Storage para publicar Reels.');
    postingPlan.setStatus(accountId, status); if (status === 'running') void postingWorker.tick(); return snapshot();
  },
  retryFacebookPost: id => { const item = postingPlan.db.prepare('SELECT account_id FROM items WHERE id=?').get(id); if (!item || getAccount(item.account_id).platform !== 'facebook') throw new Error('Postagem Facebook não encontrada.'); if (postingWorker.active.has(item.account_id)) throw new Error('Aguarde a publicação em andamento.'); postingPlan.retryAttention(id); return snapshot(); },
  resolveFacebookUncertain: ({ id, outcome }) => { const item = postingPlan.db.prepare('SELECT account_id FROM items WHERE id=?').get(id); if (!item || getAccount(item.account_id).platform !== 'facebook') throw new Error('Postagem Facebook não encontrada.'); if (postingWorker.active.has(item.account_id)) throw new Error('Aguarde a publicação em andamento.'); postingPlan.resolveUncertain(id, outcome); return snapshot(); },
  refreshFacebookInsights: async accountId => {
    const account = getAccount(accountId);
    if (account.platform !== 'facebook' || !facebookAuth.status(accountId).connected) throw new Error('Conecte a Página Facebook.');
    const token = await facebookAuth.token(accountId), connection = await preparePostingAccount(accountId);
    const publisher = new MetaPublisher({ fetch: createProxyFetch(net, connection), version: 'v27.0' });
    const metrics = {};
    for (const metric of ['page_media_view', 'page_total_media_view_unique']) {
      try { const data = await publisher.callFacebook('GET', `${account.facebookPageId}/insights`, token, { metric, period: 'day', since: Math.floor((Date.now() - 30 * 86400000) / 1000), until: Math.floor(Date.now() / 1000) }); const values = (data.data || []).flatMap(row => row.values || []); metrics[metric] = values.length ? values.reduce((total, value) => total + Number(value.value || 0), 0) : null; }
      catch (error) { metrics[metric] = null; if ([190,102].includes(error.metaCode)) facebookAuth.markReconnect(accountId); }
    }
    postingPlan.db.prepare('INSERT INTO facebook_page_insights (account_id,media_views,unique_viewers,fetched_at) VALUES (?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET media_views=excluded.media_views,unique_viewers=excluded.unique_viewers,fetched_at=excluded.fetched_at').run(accountId, metrics.page_media_view, metrics.page_total_media_view_unique, new Date().toISOString());
    return snapshot();
  },
  postingProfilePicture: id => {
    const account = getAccount(id);
    const profile = metaAuth.status(id);
    if (account.platform !== 'instagram' || !profile.connected) return null;
    const key = `${profile.igId}:${profile.expiresAt}`;
    const cached = postingProfilePictures.get(id);
    if (cached?.key === key && cached.until > Date.now()) return cached.image;
    const entry = { key, until: Date.now() + 86400000 };
    entry.image = metaAuth.profilePicture(id).catch(() => null).then(image => {
      if (!image) entry.until = Date.now() + 300000;
      return image;
    });
    postingProfilePictures.set(id, entry);
    return entry.image;
  },
  videoThumbnail: async id => {
    const item = postingPlan.db.prepare('SELECT file FROM items WHERE id=?').get(id);
    if (!item?.file || !fs.existsSync(item.file)) return null;
    const stat = fs.statSync(item.file);
    const key = `${id}:${stat.mtimeMs}:${stat.size}`;
    if (thumbnailCache.has(key)) return thumbnailCache.get(key);
    try {
      const { stdout } = await execFileAsync(binaryPath('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', item.file, '-frames:v', '1', '-vf', 'scale=120:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { windowsHide: true, encoding: 'buffer', maxBuffer: 1024 * 1024, timeout: 8000 });
      const result = `data:image/jpeg;base64,${stdout.toString('base64')}`;
      if (thumbnailCache.size > 100) thumbnailCache.clear();
      thumbnailCache.set(key, result);
      return result;
    } catch { return null; }
  },
  postingCoverPreview: ({ accountId, full = false }) => {
    const account = getAccount(accountId);
    if (account.platform !== 'instagram') return null;
    const cover = postingPlan.mediaSettings(accountId).cover;
    if (!cover || !fs.existsSync(cover)) return null;
    const image = nativeImage.createFromPath(cover);
    if (!image.isEmpty()) return image.resize({ width: full ? 720 : 96, quality: 'good' }).toDataURL();
    const type = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }[path.extname(cover).toLowerCase()];
    return type ? `data:image/${type};base64,${fs.readFileSync(cover).toString('base64')}` : null;
  },
  instagramAccountInsights: async ({ accountIds, from, to }) => {
    const ids = [...new Set(accountIds || [])];
    for (const id of ids) if (getAccount(id).platform !== 'instagram') throw new Error('Selecione contas Instagram.');
    const result = postingPlan.accountInsights.query(ids, from, to);
    result.accounts = result.accounts.map(account => {
      const auth = metaAuth.status(account.account_id);
      return auth.connected && auth.insightsGranted ? account : { ...account, status: 'unavailable', message: 'Conecte a conta e autorize o acesso aos Insights.' };
    });
    return result;
  },
  instagramOfficialMetrics: async ({ accountIds, from, to, allMedia = false, mediaFrom }) => {
    const ids = [...new Set(accountIds || [])].filter(id => getAccount(id).platform==='instagram');
    const authorizedIds=ids.filter(id=>{const auth=metaAuth.status(id);return auth.connected&&auth.insightsGranted;});
    return { ...postingPlan.accountInsights.official(ids,from,to,{allMedia:Boolean(allMedia),mediaFrom}), history: ids.flatMap(id=>postingPlan.db.prepare('SELECT h.* FROM media_insight_history h JOIN items i ON i.id=h.item_id WHERE i.account_id=? AND h.fetched_at>=? AND h.fetched_at<=?').all(id,new Date(from).toISOString(),new Date(to).toISOString())), authorizedIds, collection: instagramCoordinator?.snapshot().active || instagramCoordinator?.snapshot().last, collections:instagramCoordinator?.snapshot(), requestedRange:{from,to}, accounts: ids.map(id=>({accountId:id,...postingPlan.accountInsights.status(id)})) };
  },
  refreshInstagramInsights: input => {
    const request={accountIds:[...new Set(Array.isArray(input)?input:input?.accountIds||[])],ranges:input?.ranges||[],force:Boolean(input?.force),selectionKey:String(input?.selectionKey||'')};
    if(!request.accountIds.length)throw new Error('Selecione ao menos uma conta Instagram.');
    for(const id of request.accountIds)if(getAccount(id).platform!=='instagram')throw new Error('Selecione apenas contas Instagram.');
    if(request.ranges.length>2)throw new Error('Até dois períodos por consulta.');
    for(const range of request.ranges)if(!Number.isFinite(range.from)||!Number.isFinite(range.to)||range.from>=range.to||range.to-range.from>90*86400000||range.to>Date.now())throw new Error('Período inválido.');
    return {...instagramCoordinator.submit(request),state:snapshot()};
  },
  connectMeta: async id => {
    const account = getAccount(id); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.');
    if (postingWorker.active.has(id)) throw new Error('Aguarde a publicação em andamento antes de reconectar.');
    postingPlan.pauseAccount(id);
    const result = await metaAuth.connect(id);
    return bindInstagramAuthorization(id, result);
  },
  startInstagramAccountLink: async input => {
    if (input?.platform !== 'instagram') throw new Error('Selecione Instagram para adicionar por link.');
    const draft = domain.account(input, store.data.proxies);
    ensureFingerprint(draft);
    if (input.postingSchedule) {
      if (input.postingSchedule.mode !== 'fixed') throw new Error('Horários de postagem inválidos.');
      validatePostingConfig(input.postingSchedule);
    }
    draft.browserProfile = draft.proxyId && !store.data.accounts.some(item => item.proxyId === draft.proxyId) ? 'proxy' : 'account';
    const proxy = draft.proxyId ? store.data.proxies.find(item => item.id === draft.proxyId) : null;
    const connection = await prepareConnection(`instagram-link-${draft.id}`, draft, proxy);
    const { loginUrl, expiresAt } = await metaAuth.startAutomatic(draft.id, connection);
    pendingInstagramLinks.set(draft.id, { draft, loginUrl, expiresAt, postingSchedule: input.postingSchedule || null, polling: false });
    clipboard.writeText(loginUrl);
    return { flowId: draft.id, expiresAt };
  },
  copyInstagramAccountLink: flowId => {
    const pending = pendingInstagramLinks.get(flowId);
    if (!pending || Date.now() >= Date.parse(pending.expiresAt)) throw new Error('O link expirou. Inicie outro cadastro.');
    clipboard.writeText(pending.loginUrl);
    return { expiresAt: pending.expiresAt };
  },
  pollInstagramAccountLink: async flowId => {
    const pending = pendingInstagramLinks.get(flowId);
    if (!pending) throw new Error('Este cadastro por link não está mais ativo.');
    if (pending.polling) return { status: 'pending' };
    pending.polling = true;
    try {
      const update = await metaAuth.pollAutomatic(flowId);
      if (update.status === 'pending') return update;
      if (pendingInstagramLinks.get(flowId) !== pending) throw new Error('Este cadastro foi cancelado.');
      const profile = update.result.profile;
      if (store.data.accounts.some(account => account.platform === 'instagram' && (metaAuth.status(account.id).igId === profile.igId || account.handle?.toLowerCase() === profile.username.toLowerCase()))) throw new Error('Este perfil Instagram já está cadastrado.');
      domain.applyInstagramIdentity(pending.draft, profile.username);
      try {
        await metaAuth.bind(flowId, profile);
        store.data.accounts.push(pending.draft);
        if (pending.postingSchedule) postingPlan.configure(flowId, pending.postingSchedule);
        store.log(`Instagram conectado por link: @${profile.username}.`);
      } catch (error) {
        store.data.accounts = store.data.accounts.filter(account => account.id !== flowId);
        postingPlan.db.prepare('DELETE FROM schedules WHERE account_id=?').run(flowId);
        metaAuth.disconnect(flowId);
        store.save();
        throw error;
      }
      return { status: 'connected', state: snapshot() };
    } catch (error) {
      if (!metaAuth.automatic.has(flowId)) return { status: 'failed', message: safeError(error) };
      throw error;
    } finally {
      pending.polling = false;
      if (!metaAuth.automatic.has(flowId)) { pendingInstagramLinks.delete(flowId); prepared.delete(`instagram-link-${flowId}`); }
    }
  },
  cancelInstagramAccountLink: flowId => {
    pendingInstagramLinks.delete(flowId);
    metaAuth.cancelAutomatic(flowId);
    prepared.delete(`instagram-link-${flowId}`);
    return true;
  },
  copyInstagramLoginLink: async id => {
    const account = getAccount(id); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.');
    if (postingWorker.active.has(id)) throw new Error('Aguarde a publicação em andamento antes de reconectar.');
    const { loginUrl, expiresAt } = await metaAuth.startExternal(id);
    clipboard.writeText(loginUrl);
    return { expiresAt };
  },
  completeInstagramExternalLogin: async ({ accountId, callbackUrl }) => {
    const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.');
    if (postingWorker.active.has(accountId)) throw new Error('Aguarde a publicação em andamento antes de reconectar.');
    postingPlan.pauseAccount(accountId);
    const result = await metaAuth.completeExternal(accountId, callbackUrl);
    return bindInstagramAuthorization(accountId, result);
  },
  disconnectMeta: id => { getAccount(id); if (postingWorker.active.has(id)) throw new Error('Aguarde a publicação em andamento antes de desconectar.'); postingPlan.pauseAccount(id); metaAuth.disconnect(id); return snapshot(); },
  savePostingSchedule: ({ accountId, ...config }) => { const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.'); if (postingWorker.active.has(accountId)) throw new Error('Aguarde a publicação em andamento antes de mudar os horários.'); postingPlan.configure(accountId, config); return snapshot(); },
  savePostingSchedules: ({ accountIds, config }) => {
    if (!Array.isArray(accountIds) || accountIds.length < 2 || new Set(accountIds).size !== accountIds.length) throw new Error('Selecione pelo menos duas contas diferentes.');
    for (const id of accountIds) {
      const account = getAccount(id);
      if (account.platform !== 'instagram') throw new Error('Selecione apenas contas Instagram.');
      if (postingWorker.active.has(id)) throw new Error('Aguarde a publicação em andamento antes de mudar os horários.');
    }
    postingPlan.configureBatch(accountIds, config);
    return snapshot();
  },
  previewPostingSchedule: ({ accountId, ...config }) => { const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.'); return postingPlan.preview(accountId, config); },
  addPostingVideo: async ({ accountId, file, caption }) => { const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.'); postingPlan.add(accountId, file, caption, account.name); return snapshot(); },
  savePostingMediaSettings: ({ accountId, facebookPageToken: _ignored, ...changes }) => { const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.'); if (changes.cover !== undefined && postingWorker.active.has(accountId)) throw new Error('Aguarde a publicação em andamento antes de alterar a capa.'); if (changes.crossPostFacebook) { const pageId = changes.facebookPageId || postingPlan.mediaSettings(accountId).facebook_page_id; if (!store.data.accounts.some(page => page.platform === 'facebook' && page.facebookPageId === pageId && facebookAuth.status(page.id).connected)) throw new Error('Conecte e selecione uma Página Facebook.'); } postingPlan.saveMediaSettings(accountId, changes); return snapshot(); },
  selectPostingFolder: ({ accountId, folder }) => { const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.'); postingPlan.saveMediaSettings(accountId, { folder }); const result = postingPlan.importFolder(accountId, account.name); return { ...snapshot(), importedCount: result.importedCount, skippedCount: result.skippedCount }; },
  importPostingFolder: ({ accountId }) => { const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.'); const result = postingPlan.importFolder(accountId, account.name); return { ...snapshot(), importedCount: result.importedCount, skippedCount: result.skippedCount }; },
  updatePostingCaptions: ({ accountIds, caption, onlyEmpty = false }) => {
    if (!Array.isArray(accountIds) || !accountIds.length) throw new Error('Selecione pelo menos uma conta Instagram.');
    for (const id of accountIds) if (getAccount(id).platform !== 'instagram') throw new Error('Selecione apenas contas Instagram.');
    const result = postingPlan.updateCaptions(accountIds, caption, onlyEmpty);
    return { ...snapshot(), updatedCount: result.updatedCount };
  },
  updatePostingVideo: ({ id, ...changes }) => { postingPlan.updateItem(id, changes); return snapshot(); },
  movePostingVideo: ({ id, direction }) => { postingPlan.move(id, direction); return snapshot(); },
  removePostingVideo: id => { postingPlan.remove(id); return snapshot(); },
  clearPostingQueue: ({ accountId }) => { const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.'); if (postingWorker.active.has(accountId)) throw new Error('Aguarde a postagem em andamento antes de limpar a fila.'); const result = postingPlan.clearQueue(accountId); return { ...snapshot(), removedCount: result.removedCount }; },
  retryPostingVideo: id => {
    const item = postingPlan.db.prepare('SELECT account_id FROM items WHERE id=?').get(id);
    if (!item) throw new Error('Vídeo não encontrado.');
    const account = getAccount(item.account_id);
    if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.');
    if (postingWorker.active.has(item.account_id)) throw new Error('Aguarde a publicação em andamento antes de tentar novamente.');
    postingPlan.retryAttention(id); return snapshot();
  },
  resolveUncertainPosting: ({ id, outcome }) => { const item = postingPlan.db.prepare('SELECT account_id FROM items WHERE id=?').get(id); if (!item) throw new Error('Vídeo não encontrado.'); if (postingWorker.active.has(item.account_id)) throw new Error('Aguarde a publicação em andamento.'); postingPlan.resolveUncertain(id, outcome); return snapshot(); },
  controlPosting: ({ accountId, status }) => { const account = getAccount(accountId); if (account.platform !== 'instagram') throw new Error('Selecione uma conta Instagram.'); if (status === 'running' && postingPlan.db.prepare("SELECT 1 FROM items WHERE account_id=? AND status='uncertain' LIMIT 1").get(accountId)) throw new Error('Confira o resultado incerto antes de continuar.'); if (status === 'running' && (!postingStorage.info().configured || !metaAuth.status(accountId).connected)) throw new Error('Configure o Storage e conecte a conta Meta antes de iniciar.'); postingPlan.setStatus(accountId, status); if (status === 'running') void postingWorker.tick(); return snapshot(); },
  startQueuedPostings: input => {
    const selected = Array.isArray(input?.accountIds) ? new Set(input.accountIds) : null;
    const queued = postingPlan.db.prepare("SELECT DISTINCT account_id FROM items WHERE queue_kind='account' AND status='queued'").all();
    const schedules = new Map(postingPlan.snapshot().schedules.map(schedule => [schedule.account_id, schedule]));
    const started = [], startedIds = [], skipped = [];
    for (const { account_id: id } of queued) {
      if (selected && !selected.has(id)) continue;
      const account = store.data.accounts.find(item => item.id === id);
      if (!account || account.platform !== 'instagram' || schedules.get(id)?.status === 'running') continue;
      try {
        if (postingPlan.db.prepare("SELECT 1 FROM items WHERE account_id=? AND status='uncertain' LIMIT 1").get(id)) throw new Error('Confira a publicação incerta.');
        if (!postingStorage.info().configured) throw new Error('Configure o Storage.');
        if (!metaAuth.status(id).connected) throw new Error('Conecte a conta Meta.');
        postingPlan.setStatus(id, 'running');
        started.push(account.handle ? `@${account.handle}` : account.name);
        startedIds.push(id);
      } catch (error) { skipped.push({ account: account.handle ? `@${account.handle}` : account.name, reason: error.message }); }
    }
    if (startedIds.length) { postingPlan.staggerStarts(startedIds); void postingWorker.tick(); }
    return { state: snapshot(), started, skipped };
  },
  openGeoSource: () => shell.openExternal('https://ipapi.is/'),
  saveAccountTag: input => {
    const tag = domain.accountTagDefinition(input);
    const key = value => value.toLocaleLowerCase('pt-BR');
    const originalName = String(input?.originalName || '').trim();
    const originalKey = key(originalName);
    const definitions = store.data.accountTags || [];
    const known = new Set([...definitions.map(item => key(item.name)), ...store.data.accounts.flatMap(account => domain.accountTags(account.tags).map(key))]);
    if (originalName && !known.has(originalKey)) throw new Error('Tag original não encontrada.');
    if (known.has(key(tag.name)) && (!originalName || key(tag.name) !== originalKey)) throw new Error('Já existe uma tag com esse nome. Selecione-a na lista.');
    store.data.accountTags = definitions.filter(item => key(item.name) !== originalKey || !originalName);
    store.data.accountTags.push(tag);
    if (originalName) for (const account of store.data.accounts) {
      if (!Array.isArray(account.tags)) continue;
      account.tags = account.tags.map(name => key(name) === originalKey ? tag.name : name);
    }
    store.log(`${originalName ? 'Tag atualizada' : 'Tag criada'}: ${tag.name}.`);
    return snapshot();
  },
  addAccount: input => {
    if (input.platform === 'facebook') throw new Error('Use Facebook → Postagens → Conectar Páginas para adicionar uma Página.');
    const account = domain.account(input, store.data.proxies);
    ensureFingerprint(account);
    if (input.postingSchedule) {
      if (account.platform !== 'instagram' || input.postingSchedule.mode !== 'fixed') throw new Error('Horários de postagem exigem uma conta Instagram.');
      validatePostingConfig(input.postingSchedule);
    }
    account.browserProfile = account.proxyId && !store.data.accounts.some(item => item.proxyId === account.proxyId) ? 'proxy' : 'account';
    store.data.accounts.push(account);
    if (input.postingSchedule) postingPlan.configure(account.id, input.postingSchedule);
    store.log(`Conta ${accountPlatform(account).label} cadastrada: ${account.name}.`); return snapshot();
  },
  editAccount: ({ id, postingSchedule, ...input }) => {
    const account = getAccount(id);
    if (postingWorker.active.has(id)) throw new Error('Aguarde a publicação em andamento antes de editar a conta.');
    if (xAutomation.owns(id) || xAutomation.checking) throw new Error('Pare o X antes de editar esta conta.');
    const changes = domain.accountChanges({ ...input, postingConnection: input.postingConnection ?? (input.proxyId ? account.postingConnection : 'direct') }, store.data.proxies);
    if (changes.platform !== account.platform && (changes.platform === 'facebook' || account.platform === 'facebook')) throw new Error('Páginas Facebook são vinculadas pelo login Facebook e não podem trocar de plataforma.');
    if (postingSchedule) {
      if (changes.platform !== 'instagram' || postingSchedule.mode !== 'fixed') throw new Error('Horários de postagem exigem uma conta Instagram.');
      validatePostingConfig(postingSchedule);
    }
    const platformChanged = changes.platform !== account.platform;
    if (changes.proxyId !== account.proxyId || platformChanged) { ensureClosed(account); clearPrepared(id); account.diagnostic = undefined; }
    else if (changes.postingConnection !== (account.postingConnection || (account.proxyId ? 'proxy' : 'direct'))) prepared.delete(`persist:posting-account-${id}`);
    if (changes.proxyId !== account.proxyId) changes.browserProfile = !account.registration && changes.proxyId && !store.data.accounts.some(item => item.id !== id && item.proxyId === changes.proxyId) ? 'proxy' : 'account';
    if (changes.name !== account.name) changes.nameAuto = false;
    Object.assign(account, changes);
    if (postingSchedule) postingPlan.configure(id, postingSchedule);
    if (platformChanged && changes.platform !== 'x' && store.data.xCampaign) store.data.xCampaign.accountIds = store.data.xCampaign.accountIds.filter(accountId => accountId !== id);
    if (platformChanged && changes.platform !== 'tiktok' && store.data.campaign?.accountIds.includes(id)) {
      store.data.campaign.accountIds = store.data.campaign.accountIds.filter(accountId => accountId !== id);
      if (!store.data.campaign.accountIds.length) store.data.campaign = null;
    }
    store.log(`Conta atualizada: ${account.name}.`);
    return snapshot();
  },
  useProxyBrowser: id => {
    const account = getAccount(id);
    if (account.browserProfile !== 'proxy') linkProxyBrowser(account);
    return snapshot();
  },
  deleteAccount: async input => {
    const id = typeof input === 'string' ? input : input?.id;
    const deleteLinkedProxy = typeof input === 'object' && input?.deleteProxy === true;
    const account = getAccount(id);
    if (postingWorker.active.has(id)) throw new Error('Aguarde a publicação em andamento antes de excluir a conta.');
    if (xAutomation.owns(id) || xAutomation.checking) throw new Error('Pare o X antes de excluir esta conta.');
    if (busyConnections.has(`account:${id}`)) throw new Error('Aguarde o fim do teste de conexão antes de excluir a conta.');
    const linkedProxy = deleteLinkedProxy ? store.data.proxies.find(item => item.id === account.proxyId) : null;
    if (deleteLinkedProxy) {
      if (!linkedProxy) throw new Error('Esta conta não possui uma proxy para excluir.');
      const otherAccounts = store.data.accounts.filter(item => item.id !== id && item.proxyId === linkedProxy.id);
      if (otherAccounts.length) throw new Error(`Esta proxy também é usada por ${otherAccounts.length} outra(s) conta(s). Exclua apenas a conta ou desvincule as demais antes de excluir as duas.`);
      if (busyConnections.has(`proxy:${linkedProxy.id}`)) throw new Error('Aguarde o fim do teste da proxy antes de excluir.');
    }
    if (!smoke) {
      const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: deleteLinkedProxy ? 'Excluir conta e proxy' : 'Excluir conta', message: deleteLinkedProxy ? `Excluir ${account.name} e a proxy ${linkedProxy.name}?` : `Excluir ${account.name}?`, detail: deleteLinkedProxy ? 'A conta, a configuração da proxy, as credenciais e os logins locais serão removidos. Os vídeos originais não serão apagados.' : account.browserProfile === 'proxy' ? 'O cadastro e o login salvo no navegador desta proxy serão removidos.' : 'O cadastro e o login salvo nesta conta serão removidos deste aplicativo.', buttons: ['Cancelar', deleteLinkedProxy ? 'Excluir conta e proxy' : 'Excluir conta'], defaultId: 0, cancelId: 0, noLink: true });
      if (result.response !== 1) return snapshot();
    }
    await postingWorker.cleanupAccount(id).catch(() => { throw new Error('Não foi possível remover os vídeos temporários desta conta no Supabase. Tente excluir após restabelecer a conexão.'); });
    const openWindow = accountWindows.get(id);
    if (openWindow) await new Promise(resolve => { openWindow.once('closed', resolve); openWindow.destroy(); });
    closeFreeAccountBrowsers(id);
    const ses = session.fromPartition(`persist:account-${id}`);
    await ses.clearData();
    await ses.clearAuthCache();
    await ses.flushStorageData();
    if (account.platform === 'tiktok') {
      const analyticsSession = session.fromPartition(`persist:tiktok-analytics-${id}`);
      await analyticsSession.clearData(); await analyticsSession.clearAuthCache(); await analyticsSession.flushStorageData();
      prepared.delete(`persist:tiktok-analytics-${id}`);
    }
    if ((account.browserProfile === 'proxy' || deleteLinkedProxy) && account.proxyId) {
      const proxyWindow = proxyBrowserWindows.get(account.proxyId);
      if (proxyWindow && !proxyWindow.isDestroyed()) await new Promise(resolve => { proxyWindow.once('closed', resolve); proxyWindow.destroy(); });
      const proxySession = session.fromPartition(`persist:proxy-browser-${account.proxyId}`);
      await proxySession.clearData();
      await proxySession.clearAuthCache();
      await proxySession.flushStorageData();
      prepared.delete(`persist:proxy-browser-${account.proxyId}`);
    }
    clearPrepared(id);
    lastErrors.delete(id);
    store.data.accounts = store.data.accounts.filter(item => item.id !== id);
    if (deleteLinkedProxy) {
      store.data.proxies = store.data.proxies.filter(item => item.id !== linkedProxy.id);
      prepared.delete(`proxy-test-${linkedProxy.id}`);
    }
    postingPlan.cancelAccount(id, account.name);
    metaAuth.disconnect(id);
    facebookAuth.disconnect(id);
    tiktokAnalytics.delete(id);
    postingStorage.clearAccount(id);
    if (store.data.xCampaign) store.data.xCampaign.accountIds = store.data.xCampaign.accountIds.filter(item => item !== id);
    if (store.data.campaign) store.data.campaign.accountIds = store.data.campaign.accountIds.filter(item => item !== id);
    store.log(deleteLinkedProxy ? `Conta ${account.name} e proxy ${linkedProxy.name} excluídos. Logins e credenciais locais removidos.` : `Conta excluída: ${account.name}. Login local removido.`);
    return snapshot();
  },
  addInstagramCreatorProxy: async ({ line, protocol = 'http' }) => {
    const parsed = require('./ui/proxy-format.js').parseProxyLine(line);
    const before = new Set(store.data.proxies.map(proxy => proxy.id));
    const next = await handlers.addProxy({ ...parsed, protocol, name: `Proxy ${parsed.host}:${parsed.port}`.slice(0, 120) });
    const created = next.proxies.find(proxy => !before.has(proxy.id));
    if (!created) throw new Error('Não foi possível identificar a proxy adicionada. Confira a lista de proxies.');
    return { state: next, proxyId: created.id };
  },
  addProxy: async input => {
    const parsed = domain.proxy(input);
    const { username, password, ...proxy } = parsed;
    if (username && !password) throw new Error('Informe a senha do proxy para validar as credenciais.');
    const credentials = username && password ? { username, password } : null;
    const diagnostic = await validateNewProxy(proxy, credentials);
    if (username || password) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('A proteção de credenciais do sistema está indisponível.');
      proxy.credentials = (await safeStorage.encryptStringAsync(JSON.stringify({ username, password }))).toString('base64');
    }
    proxy.diagnostic = diagnostic;
    store.data.proxies.push(proxy); store.log(`Proxy cadastrado: ${proxy.name}.`); return snapshot();
  },
  duplicateProxy: id => {
    const source = store.data.proxies.find(proxy => proxy.id === id);
    if (!source) throw new Error('Proxy não encontrado.');
    let number = 2, name;
    do { const suffix = ` (cópia ${number++})`; name = `${source.name.slice(0, 120 - suffix.length)}${suffix}`; }
    while (store.data.proxies.some(proxy => proxy.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')));
    const copy = { ...source, id: randomUUID(), name };
    delete copy.diagnostic;
    delete copy.testFailure;
    store.data.proxies.push(copy);
    store.log(`Proxy duplicado: ${copy.name}.`);
    return snapshot();
  },
  editProxy: async ({ id, ...input }) => {
    const existing = store.data.proxies.find(proxy => proxy.id === id);
    if (!existing) throw new Error('Proxy não encontrado.');
    if (busyConnections.has(`proxy:${id}`)) throw new Error('Aguarde o fim do teste antes de editar o proxy.');
    if (proxyBrowserWindows.has(id)) throw new Error('Feche o navegador deste proxy antes de editar a conexão.');
    const linked = store.data.accounts.filter(account => account.proxyId === id);
    if (linked.some(account => postingWorker.active.has(account.id))) throw new Error('Aguarde a publicação em andamento antes de editar o proxy.');
    linked.forEach(ensureClosed);
    const parsed = domain.proxy(input);
    const { username, password, ...changes } = parsed;
    if ((username || password) && (!username || !password)) throw new Error('Para trocar as credenciais, informe usuário e senha.');
    if (input.removeCredentials && (username || password)) throw new Error('Escolha entre remover ou substituir as credenciais.');
    if (parsed.protocol === 'socks5' && existing.credentials && !input.removeCredentials) throw new Error('Remova as credenciais salvas antes de usar SOCKS5.');
    if (input.removeCredentials) delete existing.credentials;
    else if (username && password) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('A proteção de credenciais do sistema está indisponível.');
      existing.credentials = (await safeStorage.encryptStringAsync(JSON.stringify({ username, password }))).toString('base64');
    }
    delete changes.id;
    Object.assign(existing, changes);
    existing.diagnostic = undefined;
    delete existing.testFailure;
    prepared.delete(`proxy-test-${id}`);
    prepared.delete(`persist:proxy-browser-${id}`);
    for (const account of linked) { clearPrepared(account.id); account.diagnostic = undefined; }
    store.log(`Proxy atualizado: ${existing.name}.`);
    return snapshot();
  },
  deleteProxy: async id => {
    const proxy = store.data.proxies.find(item => item.id === id);
    if (!proxy) throw new Error('Proxy não encontrado.');
    if (busyConnections.has(`proxy:${id}`)) throw new Error('Aguarde o fim do teste antes de excluir o proxy.');
    if (proxyBrowserWindows.has(id)) throw new Error('Feche o navegador deste proxy antes de excluir.');
    const linked = store.data.accounts.filter(account => account.proxyId === id);
    if (linked.length) throw new Error(`Este proxy está em uso por ${linked.length} conta(s). Edite essas contas e troque a conexão antes de excluir.`);
    if (!smoke) {
      const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Excluir proxy', message: `Excluir ${proxy.name}?`, detail: 'A configuração e as credenciais salvas serão removidas.', buttons: ['Cancelar', 'Excluir proxy'], defaultId: 0, cancelId: 0, noLink: true });
      if (result.response !== 1) return snapshot();
    }
    store.data.proxies = store.data.proxies.filter(item => item.id !== id);
    prepared.delete(`proxy-test-${id}`);
    prepared.delete(`persist:proxy-browser-${id}`);
    await session.fromPartition(`persist:proxy-browser-${id}`).clearStorageData();
    store.log(`Proxy excluído: ${proxy.name}.`);
    return snapshot();
  },
  saveCampaign: input => { if (automation.isActive()) throw new Error('Pare a campanha antes de alterar sua configuração.'); store.data.campaign = domain.campaign(input, store.data.accounts); store.log('Configuração da campanha salva. Nenhuma interação foi executada.'); return snapshot(); },
  saveXCampaign: input => {
    if (xAutomation.isActive() || xAutomation.checking) throw new Error('Pare o X antes de alterar sua configuração.');
    store.data.xCampaign = xCampaign(input, store.data.accounts); store.save(); return snapshot();
  },
  startXCampaign: () => { xAutomation.start(); return snapshot(); },
  pauseXCampaign: () => { xAutomation.pause(); return snapshot(); },
  resumeXCampaign: () => { xAutomation.resume(); return snapshot(); },
  stopXCampaign: () => { xAutomation.stop(); return snapshot(); },
  pauseXAccount: id => { xAutomation.pause(id); return snapshot(); },
  stopXAccount: id => { xAutomation.stopAccount(id); return snapshot(); },
  resumeXAccount: id => { xAutomation.resume(id); return snapshot(); },
  checkXCampaign: () => xAutomation.check(),
  openXAttempt: async id => {
    const attempt = store.data.xAttempts.find(a => a.id === id);
    if (!attempt || !postKey(attempt.url)) throw new Error('Post não encontrado.');
    const account = getAccount(attempt.accountId);
    if (account.platform !== 'x') throw new Error('A conta deste registro não pertence mais ao X.');
    if (xAutomation.isActive() || xAutomation.checking) throw new Error('Pare o X antes de abrir um post do histórico.');
    await openAccount(attempt.accountId);
    await accountWindows.get(attempt.accountId).loadURL(attempt.url); return snapshot();
  },
  startCampaign: async () => {
    const campaign = store.data.campaign;
    if (!campaign) throw new Error('Salve uma campanha antes de iniciar.');
    if (!smoke) {
      const targetLabel = campaign.targetType === 'foryou' ? 'Página principal — Para você' : campaign.targetType === 'hashtag' ? campaignTargets(campaign).map(item => `#${item}`).join(', ') : campaign.target;
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Iniciar campanha', message: `Publicar comentários na campanha “${campaign.name}”?`,
        detail: `Alvo: ${targetLabel}\nContas: ${campaign.accountIds.length} · Limite desta execução: ${campaign.sessionLimit}\n\nO navegador publicará os comentários salvos e aplicará curtidas ou favoritos conforme as porcentagens configuradas.`,
        buttons: ['Cancelar', 'Iniciar publicação'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (result.response !== 1) return snapshot();
    }
    for (const accountId of campaign.accountIds) {
      await openAccount(accountId, targetURL(campaign), { background: false });
    }
    automation.start(); return snapshot();
  },
  pauseCampaign: () => { automation.pause(); return snapshot(); },
  resumeCampaign: () => { automation.resume(); return snapshot(); },
  resumeAccount: id => { getAccount(id); automation.resumeAccount(id); return snapshot(); },
  pauseAccount: id => { getAccount(id); automation.pauseAccount(id); return snapshot(); },
  restartAccountCycle: id => confirmRestartCycle(id),
  stopCampaign: () => { automation.stop(); return snapshot(); },
  checkCampaign: async () => { await automation.check(); return snapshot(); },
  openAttempt: async id => {
    if (automation.isActive()) throw new Error('Pare a campanha antes de abrir outra página.');
    const attempt = store.data.attempts.find(item => item.id === id);
    if (!attempt || !videoKey(attempt.url)) throw new Error('Vídeo não encontrado no histórico.');
    await openAccount(attempt.accountId);
    await accountWindows.get(attempt.accountId).loadURL(attempt.url);
    return snapshot();
  },
  openAccount,
  openAccountBrowser,
  resetBrowserData: async id => {
    const account = getAccount(id);
    if (accountWindows.has(id)) throw new Error('Feche a janela da conta antes de limpar os dados.');
    closeFreeAccountBrowsers(id);
    const partitionKey = account.browserProfile === 'proxy' && account.proxyId
      ? `persist:proxy-browser-${account.proxyId}` : `persist:account-${id}`;
    const ses = session.fromPartition(partitionKey);
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    await ses.clearAuthCache();
    await ses.clearCache();
    clearPrepared(id);
    if (account.browserProfile === 'proxy' && account.proxyId) prepared.delete(`persist:proxy-browser-${account.proxyId}`);
    store.log(`Dados do navegador de ${account.name} limpos. Faça login novamente.`);
    return snapshot();
  },
  closeAccountBrowser: id => { getAccount(id); closeFreeAccountBrowsers(id); return snapshot(); },
  closeAccount: id => { getAccount(id); accountWindows.get(id)?.close(); return snapshot(); },
  testConnection,
  testProxy: id => testConnection(id, true),
  openProxyBrowser,
  closeProxyBrowser: id => { if (!store.data.proxies.some(proxy => proxy.id === id)) throw new Error('Proxy não encontrado.'); proxyBrowserWindows.get(id)?.close(); return snapshot(); },
  pickMediaVideos: async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Selecionar vídeos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Vídeos', extensions: ['mp4', 'mov', 'm4v', 'webm'] }] });
    return result.canceled ? [] : result.filePaths;
  },
  pickPostingVideoFolder: async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Selecionar pasta de vídeos para a conta', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  },
  pickMediaCover: async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Selecionar imagem de capa', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    return result.canceled ? null : result.filePaths[0];
  },
  pickMediaImages: async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Selecionar imagens para limpar metadados', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    return result.canceled ? [] : result.filePaths;
  },
  pickMediaOutput: async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Selecionar pasta de saída', properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  },
  startMediaJob: input => mediaProcessor.start(input),
  cancelMediaJob: () => ({ cancelled: mediaProcessor.cancel() }),
  inspectDownloadLinks: links => analyzeLinks(links),
  startDownloadJob: input => videoDownloader.start(input),
  cancelDownloadJob: () => ({ cancelled: videoDownloader.cancel() }),
  openMediaOutput: async directory => {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('Pasta de saída inválida.');
    const error = await shell.openPath(directory);
    if (error) throw new Error('Não foi possível abrir a pasta de saída.');
    return true;
  }
};

async function boot() {
  store = new Store(dataDir);
  // Migrate: ensure all existing accounts have a fingerprint profile
  let fingerprintsMigrated = 0;
  for (const acct of store.data.accounts) { if (ensureFingerprint(acct)) fingerprintsMigrated++; }
  if (fingerprintsMigrated) { store.save(); store.log(`Perfil de fingerprint gerado para ${fingerprintsMigrated} conta(s).`); }
  postingPlan = new PostingPlan(path.join(dataDir, 'postings.sqlite'));
  postingPlan.accountInsights = new InstagramAccountInsights(postingPlan.db);
  metaAuth = new MetaAuth({ getStorageSettings: () => postingStorage?.settings, directory: dataDir, safeStorage, BrowserWindow, net, getConnection: prepareAccount, parent: () => mainWindow, registerLoginWindow: (win, connection) => { const id = win.webContents.id; authByContents.set(id, connection); win.on('closed', () => authByContents.delete(id)); } });
  let refreshedNames = 0;
  for (const account of store.data.accounts) {
    if (account.platform !== 'instagram') continue;
    const authorized = metaAuth.status(account.id);
    if (!authorized.connected || !authorized.username) continue;
    const before = `${account.name}\0${account.handle || ''}\0${Boolean(account.nameAuto)}`;
    try { domain.applyInstagramIdentity(account, authorized.username); }
    catch { continue; }
    if (before !== `${account.name}\0${account.handle || ''}\0${Boolean(account.nameAuto)}`) refreshedNames++;
  }
  if (refreshedNames) store.log(`Nomes oficiais do Instagram atualizados em ${refreshedNames} conta(s).`);
  tiktokAnalytics = new TikTokAnalytics({ directory: dataDir, safeStorage, BrowserWindow, net, getConnection: prepareTikTokAnalyticsAccount, parent: () => mainWindow, registerLoginWindow: (win, connection) => { const id = win.webContents.id; authByContents.set(id, connection); win.on('closed', () => authByContents.delete(id)); } });
  postingStorage = new PostingStorage({ directory: dataDir, safeStorage, net });
  facebookAuth = new FacebookAuth({ directory: dataDir, safeStorage, BrowserWindow, net, getStorageSettings: () => postingStorage.settings, parent: () => mainWindow, registerLoginWindow: (win, connection) => { const id = win.webContents.id; authByContents.set(id, connection); win.on('closed', () => authByContents.delete(id)); } });
  for (const instagram of store.data.accounts.filter(account => account.platform === 'instagram')) {
    const legacy = postingPlan.mediaSettings(instagram.id);
    if (!legacy.facebook_page_id || !legacy.facebook_page_token) continue;
    let page = store.data.accounts.find(account => account.platform === 'facebook' && account.facebookPageId === legacy.facebook_page_id);
    const isNew = !page;
    if (isNew) { page = domain.account({ platform: 'facebook', name: `Página Facebook ${legacy.facebook_page_id}`, proxyId: instagram.proxyId }, store.data.proxies); page.facebookPageId = legacy.facebook_page_id; }
    try { await facebookAuth.migrateLegacy(page.id, legacy.facebook_page_id, legacy.facebook_page_token, page.name); }
    catch (error) { store.log(`Não foi possível proteger a credencial antiga da Página Facebook: ${error.message}`); continue; }
    if (isNew) { store.data.accounts.push(page); store.save(); }
    postingPlan.db.prepare('UPDATE posting_media_settings SET facebook_page_token=NULL WHERE account_id=?').run(instagram.id);
  }
  automation = new Automation({ store, getWindow: id => { const win = accountWindows.get(id); return win && !win.isDestroyed() ? win : undefined; }, openAccount, onChange: () => { refreshAccountTitles(); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:automation', snapshot()); } });
  xAutomation = new XAutomation({ store, getWindow: id => accountWindows.get(id), openAccount, onChange: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:x-automation', snapshot()); } });
  mainWindow = new BrowserWindow({ width: 1320, height: 920, minWidth: 560, minHeight: 600, show: !smoke && !xReadOnly, title: 'Comment Studio', backgroundColor: '#f5f7fa', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  postingWorker = new PostingWorker({ plan: postingPlan, storage: postingStorage, auth: metaAuth, facebookAuth, getFacebookTarget: pageId => store.data.accounts.find(a => a.platform === 'facebook' && a.facebookPageId === pageId && facebookAuth.status(a.id).connected), net, getConnection: preparePostingAccount, getAccount: id => store.data.accounts.find(a => a.id === id), onFailure: id => { if (id) lastErrors.set(id, 'Falha interna ao acessar a fila local. Reinicie o aplicativo antes de continuar.'); }, onChange: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:postings', snapshot()); } });
  mediaProcessor = new MediaProcessor({ onProgress: progress => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:media-progress', progress); } });
  videoDownloader = new VideoDownloader({ executable: app.isPackaged ? binaryPath('yt-dlp') : path.join(root, 'vendor', 'yt-dlp.exe'), onProgress: progress => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('studio:download-progress', progress);
    if (progress.status === 'file-complete') {
      try { refreshPostingFolders(progress.file); }
      catch (error) { console.error('Falha ao atualizar fila após download:', error); }
    }
  } });
  const collectInstagramInsights=createInstagramCollector({postingPlan,metaAuth,getAccount,preparePostingAccount,getAccounts:()=>store.data.accounts,makePublisher:connection=>new MetaPublisher({fetch:createProxyFetch(net,connection,{timeoutMs:30000}),version:metaAuth.settings().graphVersion})});
  instagramCoordinator=new InstagramInsightsCoordinator({db:postingPlan.db,collect:collectInstagramInsights,onProgress:progress=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('studio:insights-progress',progress);}});
  instagramCoordinator.resume();
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  let mutationQueue = Promise.resolve();
  for (const [method, handler] of Object.entries(handlers)) {
    ipcMain.handle(`studio:${method}`, async (event, payload) => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== homeURL) return { ok: false, error: 'Origem não autorizada.' };
      const run = async () => { try {
        if (automation.isActive() && ['editAccount', 'deleteAccount', 'editProxy', 'deleteProxy', 'saveCampaign', 'closeAccount', 'testConnection', 'testProxy', 'checkCampaign'].includes(method)) throw new Error('Pare a campanha antes de alterar contas ou proxies.');
        return { ok: true, value: await handler(payload) };
      } catch (error) { return { ok: false, error: ['openAccount', 'addProxy'].includes(method) && !(error instanceof Error) ? 'Falha na operação.' : (error.message || 'Falha na operação.') }; } };
      if (['state', 'instagramOfficialMetrics', 'refreshInstagramInsights', 'postingProfilePicture', 'postingCoverPreview', 'testConnection', 'testProxy', 'openGeoSource', 'pickMediaVideos', 'pickPostingVideoFolder', 'pickMediaCover', 'pickMediaImages', 'pickMediaOutput', 'startMediaJob', 'cancelMediaJob', 'inspectDownloadLinks', 'startDownloadJob', 'cancelDownloadJob', 'openMediaOutput'].includes(method)) return run();
      const result = mutationQueue.then(run); mutationQueue = result.then(() => undefined); return result;
    });
  }
  mainWindow.on('close', () => { instagramCoordinator?.stop(); clearInterval(postingFolderSyncTimer); xAutomation?.stop(); postingWorker?.stop(); mediaProcessor?.cancel(); videoDownloader?.cancel(); tlsProxy.stop(); for (const win of accountWindows.values()) win.close(); for (const id of freeAccountWindows.keys()) closeFreeAccountBrowsers(id); for (const win of proxyBrowserWindows.values()) win.close(); });
  await mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  if (!smoke && !xReadOnly) {
    const scan = () => {
      if (videoDownloader.running || mediaProcessor.running) return;
      try { refreshPostingFolders(); } catch (error) { console.error('Falha ao atualizar pastas de postagem:', error); }
    };
    scan();
    postingFolderSyncTimer = setInterval(scan, 5000);
  }
  if (!smoke && !xReadOnly) { mainWindow.show(); mainWindow.focus(); }
  if (xReadOnly) {
    const { XBrowser } = require('./x-browser.cjs');
    const driver = new XBrowser({ getWindow: id => accountWindows.get(id), openAccount: id => openAccount(id, undefined, { background: true }) });
    const results = [];
    for (const account of store.data.accounts.filter(a => a.platform === 'x')) {
      try {
        const page = await driver.search(account.id, 'tecnologia', 'latest');
        results.push({ ok: true, recognized: page.recognized, posts: page.posts.length, authenticated: Boolean(page.handle) });
      } catch (e) { results.push({ ok: false, reason: e.message }); }
    }
    fs.mkdirSync(path.join(root, '.smoke'), { recursive: true });
    fs.writeFileSync(path.join(root, '.smoke', 'x-live-readonly-result.json'), JSON.stringify({ at: new Date().toISOString(), readOnly: true, interactions: 0, results }, null, 2));
    for (const win of accountWindows.values()) win.webContents.session.flushStorageData();
    app.exit(results.length && results.every(r => r.ok) ? 0 : 1); return;
  }
  if (smoke) {
    try {
      await require('../tests/desktop.cjs').run({ mainWindow, handlers, prepareAccount, openAccount, dataDir, store, automation, dashboardOnly:dashboardSmoke });
      fs.writeFileSync(path.join(root, '.smoke', dashboardSmoke?'dashboard-integration-result.json':'result.json'), JSON.stringify({ ok: true, dataDir }, null, 2));
      app.exit(0);
    } catch (error) { fs.writeFileSync(path.join(root, '.smoke', 'result.json'), JSON.stringify({ ok: false, message: error.stack }, null, 2)); app.exit(1); }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.restore(); mainWindow?.focus(); });
  app.whenReady().then(boot).catch(error => { if (!smoke) dialog.showErrorBox('Não foi possível iniciar', error.message); console.error(error); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
