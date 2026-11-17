const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { createProxyFetch } = require('./proxy-fetch.cjs');
const { authorizationCode } = require('./oauth-callback.cjs');

const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement', 'read_insights'];
class FacebookAuth {
  constructor({ directory, safeStorage, BrowserWindow, net, getStorageSettings, parent, registerLoginWindow = () => {} }) {
    Object.assign(this, { safeStorage, BrowserWindow, net, getStorageSettings, parent, registerLoginWindow });
    this.file = path.join(directory, 'facebook-auth.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { installId: randomBytes(24).toString('hex'), pages: {} };
    if (!this.data.installId) { this.data.installId = randomBytes(24).toString('hex'); this.save(); }
    this.pending = new Map();
    this.external = new Map();
  }
  save() { fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data), { mode: 0o600 }); fs.renameSync(`${this.file}.tmp`, this.file); }
  async seal(value) {
    if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new Error('Proteção de credenciais do Windows indisponível.');
    return (await this.safeStorage.encryptStringAsync(value)).toString('base64');
  }
  async open(value) { return (await this.safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result; }
  status(accountId) {
    const page = this.data.pages[accountId];
    return page ? { connected: !page.needsReconnect, needsReconnect: Boolean(page.needsReconnect), pageId: page.pageId, name: page.name, insightsGranted: Boolean(page.insightsGranted) } : { connected: false };
  }
  async token(accountId) {
    const page = this.data.pages[accountId];
    if (!page?.token || page.needsReconnect) throw new Error('Reconecte a Página do Facebook.');
    return this.open(page.token);
  }
  markReconnect(accountId) { if (this.data.pages[accountId]) { this.data.pages[accountId].needsReconnect = true; this.save(); } }
  disconnect(accountId) { delete this.data.pages[accountId]; this.save(); }
  async bind(accountId, page) {
    if (!/^\d+$/.test(page.id) || !page.access_token || !page.tasks?.some(task => ['CREATE_CONTENT', 'PROFILE_PLUS_CREATE_CONTENT'].includes(task))) throw new Error('A Página não autorizou criação de conteúdo.');
    this.data.pages[accountId] = { pageId: page.id, name: page.name, token: await this.seal(page.access_token), insightsGranted: page.tasks.some(task => ['ANALYZE', 'PROFILE_PLUS_ANALYZE'].includes(task)), needsReconnect: false };
    this.save(); return this.status(accountId);
  }
  async migrateLegacy(accountId, pageId, token, name) {
    if (this.data.pages[accountId]) return;
    this.data.pages[accountId] = { pageId, name, token: await this.seal(token), insightsGranted: false, needsReconnect: false };
    this.save();
  }
  async service(connection, body) {
    const storage = this.getStorageSettings();
    if (!storage?.url || !storage.publishableKey) throw new Error('Configure o Storage antes de conectar o Facebook.');
    const response = await createProxyFetch(this.net, connection)(`${storage.url}/functions/v1/facebook-exchange`, { method: 'POST', headers: { apikey: storage.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, installId: this.data.installId }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data.error || 'Serviço de login Facebook indisponível.'));
    return data;
  }
  async beginAuthorization(connection) {
    const flowId = randomUUID();
    const started = await this.service(connection, { action: 'start', accountId: flowId });
    const expectedRedirect = `${this.getStorageSettings()?.url || ''}/functions/v1/meta-callback`;
    if (!/^\d{8,25}$/.test(String(started.appId || '')) || started.provider !== 'facebook' || typeof started.state !== 'string' || started.redirectUri !== expectedRedirect) throw new Error('Configuração do login Facebook inválida.');
    const login = new URL('https://www.facebook.com/dialog/oauth');
    for (const [key, value] of Object.entries({ client_id: started.appId, redirect_uri: started.redirectUri, state: started.state, response_type: 'code', scope: SCOPES.join(',') })) login.searchParams.set(key, value);
    return { flowId, started, login };
  }
  async startExternal(connection) {
    const { flowId, started, login } = await this.beginAuthorization(connection);
    const expiresAt = started.expiresAt || new Date(Date.now() + 600000).toISOString();
    if (!(Date.parse(expiresAt) > Date.now())) throw new Error('O link de conexão expirou. Gere um novo link.');
    this.external.set(flowId, { connection, started, expiresAt });
    return { flowId, loginUrl: login.toString(), expiresAt };
  }
  async completeExternal(flowId, callbackUrl) {
    const pending = this.external.get(flowId);
    if (!pending) throw new Error('Este link de conexão não está mais ativo. Gere outro link.');
    const code = authorizationCode(callbackUrl, pending.started.redirectUri, pending.started.state, pending.expiresAt);
    this.external.delete(flowId);
    return this.finishAuthorization(pending.connection, flowId, pending.started, code);
  }
  async connect(connection) {
    const { flowId, started, login } = await this.beginAuthorization(connection);
    const code = await new Promise((resolve, reject) => {
      const win = new this.BrowserWindow({ width: 620, height: 780, parent: this.parent(), title: 'Conectar Facebook', webPreferences: { session: connection.ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      this.registerLoginWindow(win, connection);
      let finished = false;
      const done = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); if (!win.isDestroyed()) win.close(); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => done(new Error('O login Facebook expirou.')), 600000);
      const inspect = (event, target) => { try { const url = new URL(target), expected = new URL(started.redirectUri); if (url.origin !== expected.origin || url.pathname !== expected.pathname) return; event?.preventDefault?.(); if (url.searchParams.get('state') !== started.state) throw new Error('Resposta de login inválida.'); const value = url.searchParams.get('code'); if (!value) throw new Error('Login Facebook cancelado.'); done(null, value); } catch (error) { done(error); } };
      win.webContents.on('will-redirect', inspect); win.webContents.on('will-navigate', inspect); win.webContents.on('did-navigate', (_event, target) => inspect(null, target));
      win.on('closed', () => done(new Error('Login Facebook cancelado.')));
      win.loadURL(login.toString()).catch(() => done(new Error('Não foi possível abrir o login Facebook.')));
    });
    return this.finishAuthorization(connection, flowId, started, code);
  }
  async finishAuthorization(connection, flowId, started, code) {
    const exchanged = await this.service(connection, { action: 'exchange', accountId: flowId, state: started.state, code });
    if (!exchanged.accessToken) throw new Error('O Facebook não retornou autorização.');
    const fetch = createProxyFetch(this.net, connection);
    const pages = [];
    let next = new URL(`https://graph.facebook.com/${exchanged.graphVersion || 'v27.0'}/me/accounts?fields=id,name,access_token,tasks&limit=100`);
    for (let i = 0; next && i < 10; i++) {
      const response = await fetch(next, { headers: { Authorization: `Bearer ${exchanged.accessToken}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error('Não foi possível consultar as Páginas autorizadas.');
      pages.push(...(data.data || []).filter(page => page.access_token && page.tasks?.some(task => ['CREATE_CONTENT', 'PROFILE_PLUS_CREATE_CONTENT'].includes(task))));
      next = data.paging?.next ? new URL(data.paging.next) : null;
      if (next && next.hostname !== 'graph.facebook.com') throw new Error('Paginação de Páginas inválida.');
    }
    if (!pages.length) throw new Error('Nenhuma Página com permissão de publicação foi encontrada.');
    this.pending.set(flowId, { pages, expires: Date.now() + 600000 });
    return { flowId, pages: pages.map(({ id, name, tasks }) => ({ id, name, insightsGranted: tasks.some(task => ['ANALYZE', 'PROFILE_PLUS_ANALYZE'].includes(task)) })) };
  }
  takePages(flowId, pageIds) {
    const pending = this.pending.get(flowId); this.pending.delete(flowId);
    if (!pending || pending.expires < Date.now()) throw new Error('Seleção de Páginas expirada. Conecte novamente.');
    const selected = [...new Set(pageIds)].map(id => pending.pages.find(page => page.id === id));
    if (!selected.length || selected.some(page => !page)) throw new Error('Selecione Páginas autorizadas.');
    return selected;
  }
}
module.exports = { FacebookAuth, SCOPES };
