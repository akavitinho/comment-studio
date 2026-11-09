const path = require('node:path');
const { BrowserWindow, WebContentsView } = require('electron');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const auditURL = pathToFileURL(path.join(__dirname, 'ui', 'fingerprint-audit.html')).href;

const toolbarHeight = 116;
let hub = null;

function destination(input) {
  const value = String(input || '').trim();
  if (!value) return 'https://www.google.com/';
  if (/^audit(oria)?$/i.test(value) || value.toLowerCase() === 'fingerprint') return auditURL;
  if (value.length > 2048) throw new Error('Pesquisa ou endereço muito longo.');
  if (/^https:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password) throw new Error('Endereço inválido.');
    return url.href;
  }
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(value) && !/\s/.test(value)) return destination(`https://${value}`);
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function activeTab(current = hub) { return current?.tabs.find(tab => tab.id === current.activeId); }

function sendState(current, message) {
  if (!current || current.win.isDestroyed() || current.win.webContents.isDestroyed()) return;
  const tab = activeTab(current);
  const site = tab?.view.webContents;
  if (tab && message !== undefined) tab.message = message;
  current.win.webContents.send('free-browser:state', {
    url: site?.getURL() || '', title: site?.getTitle() || '',
    back: site?.navigationHistory.canGoBack() || false,
    forward: site?.navigationHistory.canGoForward() || false,
    loading: site?.isLoading() || false, message: tab?.message || '',
    activeId: current.activeId,
    tabs: current.tabs.map(item => ({ id: item.id, label: item.label, active: item.id === current.activeId }))
  });
}

function resize(current) {
  const tab = activeTab(current);
  if (!tab || current.win.isDestroyed()) return;
  const { width, height } = current.win.getContentBounds();
  tab.view.setBounds({ x: 0, y: toolbarHeight, width, height: Math.max(1, height - toolbarHeight) });
}

function activate(current, tab) {
  if (!tab || tab.closed || current.win.isDestroyed()) return;
  const previous = activeTab(current);
  if (previous && previous !== tab) current.win.contentView.removeChildView(previous.view);
  current.activeId = tab.id;
  tab.group.lastTabId = tab.id;
  if (previous !== tab) current.win.contentView.addChildView(tab.view);
  resize(current);
  sendState(current);
}

function closeTab(current, tab) {
  if (!tab || tab.closed) return;
  const wasActive = current.activeId === tab.id;
  if (wasActive && !current.win.isDestroyed()) current.win.contentView.removeChildView(tab.view);
  tab.closed = true;
  current.tabs = current.tabs.filter(item => item !== tab);
  tab.group.tabs.delete(tab);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (!tab.group.tabs.size && !tab.group.closed) { tab.group.closed = true; tab.group.onClose?.(); }
  if (wasActive) {
    current.activeId = '';
    const next = current.tabs.at(-1);
    if (next) activate(current, next);
  }
  if (!current.tabs.length && !current.win.isDestroyed()) current.win.close();
  else sendState(current);
}

function newTab(current) {
  const group = activeTab(current)?.group;
  if (!group) return;
  createTab(current, group, { label: `Nova aba · ${group.title}` });
  current.win.webContents.send('free-browser:focus-address');
}

function browserShortcut(current, event, input) {
  if (input.type !== 'keyDown' || current.win.isDestroyed()) return;
  const tab = activeTab(current);
  if (!tab) return;
  const key = String(input.key).toLowerCase();
  const command = input.control && !input.alt && !input.shift;
  const site = tab.view.webContents;
  if (command && key === 't') { event.preventDefault(); newTab(current); }
  else if (command && key === 'w') { event.preventDefault(); closeTab(current, tab); }
  else if (command && key === 'l') { event.preventDefault(); current.win.webContents.send('free-browser:focus-address'); }
  else if (command && key === 'r') { event.preventDefault(); site.reload(); }
  else if (input.alt && !input.control && key === 'left' && site.navigationHistory.canGoBack()) { event.preventDefault(); site.navigationHistory.goBack(); }
  else if (input.alt && !input.control && key === 'right' && site.navigationHistory.canGoForward()) { event.preventDefault(); site.navigationHistory.goForward(); }
}

async function loadTab(current, tab, input) {
  tab.message = '';
  try { await tab.view.webContents.loadURL(destination(input)); sendState(current); }
  catch (error) { const code = String(error.message).match(/ERR_[A-Z_]+/)?.[0]; if (code === 'ERR_ABORTED') { sendState(current); return; } tab.message = `Não foi possível abrir a página (${code || 'conexão indisponível'}).`; sendState(current); }
}

function createTab(current, group, { label, webPreferences, url, deferActivate = false } = {}) {
  const view = new WebContentsView({ webPreferences: {
    ...(webPreferences || {}), preload: group.preload, session: group.session, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true
  } });
  const tab = { id: randomUUID(), label: label || group.title, group, view, closed: false, message: '' };
  current.tabs.push(tab); group.tabs.add(tab);
  const site = view.webContents;
  group.register(site, url => { const t = createTab(current, group, { label: `Nova aba · ${group.title}`, url }); activate(current, t); });
  const update = () => {
    if (tab.closed) return;
    const title = site.getTitle().trim();
    if (title) tab.label = `${title.slice(0, 28)} · ${group.title}`;
    sendState(current);
  };
  for (const event of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated']) site.on(event, update);
  site.on('did-start-navigation', (_event, _url, _inPage, isMainFrame) => { if (isMainFrame) { tab.message = ''; sendState(current); } });
  site.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    const networkCode = String(description).match(/ERR_[A-Z_]+/)?.[0];
    tab.message = `A página não carregou (${networkCode || `erro ${code}`}). Confira a conexão e o proxy.`;
    sendState(current);
  });
  site.on('before-input-event', (event, input) => browserShortcut(current, event, input));
  site.once('destroyed', () => { if (!tab.closed) closeTab(current, tab); });
  if (deferActivate) setImmediate(() => { if (!tab.closed) activate(current, tab); });
  else activate(current, tab);
  if (url) void loadTab(current, tab, url);
  return tab;
}

function createHub(show) {
  const win = new BrowserWindow({ width: 1140, height: 820, minWidth: 560, minHeight: 400,
    title: 'Navegador · Comment Studio', show, backgroundColor: '#f7f7f8',
    webPreferences: { preload: path.join(__dirname, 'free-browser-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  const current = { win, tabs: [], activeId: '' };
  hub = current;
  win.setMenu(null);
  win.on('resize', () => resize(current));
  win.webContents.on('before-input-event', (event, input) => browserShortcut(current, event, input));
  win.webContents.on('ipc-message', (_event, channel, value) => {
    const tab = activeTab(current);
    if (channel === 'free-browser:select-tab') { activate(current, current.tabs.find(item => item.id === value)); return; }
    if (channel === 'free-browser:close-tab') { closeTab(current, current.tabs.find(item => item.id === value)); return; }
    if (!tab) return;
    const site = tab.view.webContents;
    if (channel === 'free-browser:new-tab') newTab(current);
    if (channel === 'free-browser:navigate') void loadTab(current, tab, value);
    if (channel === 'free-browser:back' && site.navigationHistory.canGoBack()) site.navigationHistory.goBack();
    if (channel === 'free-browser:forward' && site.navigationHistory.canGoForward()) site.navigationHistory.goForward();
    if (channel === 'free-browser:reload') site.reload();
    if (channel === 'free-browser:home') void loadTab(current, tab, tab.group.startURL);
  });
  win.on('closed', () => {
    for (const tab of [...current.tabs]) {
      tab.closed = true; tab.group.tabs.delete(tab);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      if (!tab.group.tabs.size && !tab.group.closed) { tab.group.closed = true; tab.group.onClose?.(); }
    }
    current.tabs = [];
    if (hub === current) hub = null;
  });
  current.ready = win.loadFile(path.join(__dirname, 'ui', 'free-browser.html')).then(() => sendState(current));
  return current;
}

async function openFreeBrowser({ title, session, startURL, register, onClose, show = true, preload } = {}) {
  const current = hub && !hub.win.isDestroyed() ? hub : createHub(show);
  await current.ready;
  const group = { title, session, startURL, register, onClose, preload, tabs: new Set(), lastTabId: '', closed: false };
  const tab = createTab(current, group, { label: title, url: startURL });
  const handle = {
    get window() { return current.win; },
    get site() { return current.tabs.find(item => item.id === group.lastTabId)?.view.webContents; },
    get view() { return current.tabs.find(item => item.id === group.lastTabId)?.view; },
    isDestroyed: () => group.closed || current.win.isDestroyed(),
    show: () => { if (!current.win.isDestroyed()) { current.win.show(); activate(current, current.tabs.find(item => item.id === group.lastTabId) || [...group.tabs][0]); } },
    restore: () => { if (!current.win.isDestroyed() && current.win.isMinimized()) current.win.restore(); },
    focus: () => { if (!current.win.isDestroyed()) { activate(current, current.tabs.find(item => item.id === group.lastTabId) || [...group.tabs][0]); current.win.focus(); } },
    close: () => { for (const item of [...group.tabs]) closeTab(current, item); },
    destroy: () => { for (const item of [...group.tabs]) closeTab(current, item); }
  };
  if (show) { current.win.show(); activate(current, tab); current.win.focus(); }
  return handle;
}

module.exports = { openFreeBrowser, destination };
