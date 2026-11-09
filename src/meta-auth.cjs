const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createProxyFetch } = require('./proxy-fetch.cjs');
const REQUIRED_PERMISSIONS = ['instagram_business_basic', 'instagram_business_content_publish'];
const INSIGHTS_PERMISSION = 'instagram_business_manage_insights';
const serviceUrl = (storage, name) => storage?.url ? `${storage.url}/functions/v1/${name}` : '';
function missingPermissions(grants) {
  const granted = new Set((grants?.data || []).filter(permission => permission.status === 'granted').map(permission => permission.permission));
  return REQUIRED_PERMISSIONS.filter(permission => !granted.has(permission));
}

class MetaAuth {
  constructor({ directory, safeStorage, BrowserWindow, net, getConnection, parent, registerLoginWindow = () => {}, getStorageSettings = () => null, requestService = null }) {
    this.file = path.join(directory, 'meta-auth.json');
    this.safeStorage = safeStorage; this.BrowserWindow = BrowserWindow; this.net = net; this.getConnection = getConnection; this.parent = parent;
    this.getStorageSettings = getStorageSettings;
    this.requestService = requestService;
    this.registerLoginWindow = registerLoginWindow;
    this.connecting = new Set();
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { appId: '', redirectUri: '', graphVersion: 'v23.0', accounts: {} };
    let updated = false;
    if (!this.data.installId) { this.data.installId = randomBytes(24).toString('hex'); updated = true; }
    if (this.data.loginProvider !== 'instagram') {
      this.data.loginProvider = 'instagram'; this.data.appId = '';
      for (const account of Object.values(this.data.accounts)) account.needsReconnect = true;
      updated = true;
    }
    if (!this.data.redirectUri && this.getStorageSettings()?.url) { this.data.redirectUri = serviceUrl(this.getStorageSettings(), 'meta-callback'); updated = true; }
    if (this.data.secret !== undefined) { delete this.data.secret; updated = true; }
    if (updated) this.save();
  }
  async seal(value) {
    if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new Error('Proteção de credenciais do Windows indisponível.');
    return (await this.safeStorage.encryptStringAsync(value)).toString('base64');
  }
  async open(value) { return (await this.safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result; }
  save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file); }
  status(accountId) { const a = this.data.accounts[accountId]; return a ? { connected: !a.needsReconnect, needsReconnect: Boolean(a.needsReconnect), insightsGranted: Boolean(a.insightsGranted), igId: a.igId, username: a.username, expiresAt: a.expiresAt } : { connected: false, needsReconnect: false, insightsGranted: false }; }
  settings() { return { appId: this.data.appId, redirectUri: this.data.redirectUri || serviceUrl(this.getStorageSettings(), 'meta-callback'), graphVersion: this.data.graphVersion }; }
  async configure({ appId, redirectUri, graphVersion }) {
    if (appId && !/^\d{8,25}$/.test(String(appId))) throw new Error('Informe o ID numérico do aplicativo Instagram.');
    const url = new URL(String(redirectUri || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Informe uma URL HTTPS de retorno da Meta sem parâmetros.');
    const expected = serviceUrl(this.getStorageSettings(), 'meta-callback');
    if (!expected || url.toString() !== expected) throw new Error('Configure o Storage e use a URL de retorno do mesmo projeto Supabase.');
    if (!/^v\d+\.0$/.test(String(graphVersion || 'v23.0'))) throw new Error('Versão da Graph API inválida.');
    if (this.data.appId && this.data.appId !== String(appId) && Object.keys(this.data.accounts).length) throw new Error('Desconecte os perfis Meta antes de trocar o app.');
    this.data.appId = String(appId); this.data.redirectUri = url.toString(); this.data.graphVersion = graphVersion || 'v23.0'; delete this.data.configId; this.save();
    return this.settings();
  }
  async graph(connection, route, token, fields) {
    const url = new URL(`https://graph.instagram.com/${this.data.graphVersion}/${route}`);
    if (fields) url.searchParams.set('fields', fields);
    const response = await createProxyFetch(this.net, connection)(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => { throw new Error('Resposta inválida da Meta.'); });
    if (!response.ok || data.error) throw new Error(`A Meta recusou a solicitação${Number.isInteger(data.error?.code) ? ` (código ${data.error.code})` : ''}.`);
    return data;
  }
  async service(connection, body) {
    if (this.requestService) return this.requestService(connection, { ...body, installId: this.data.installId });
    const storage = this.getStorageSettings();
    if (!storage?.url || !storage.publishableKey?.startsWith('sb_publishable_') || this.data.redirectUri !== serviceUrl(storage, 'meta-callback')) throw new Error('Configure o Storage e o login Instagram com o mesmo projeto Supabase.');
    const response = await createProxyFetch(this.net, connection)(serviceUrl(storage, 'instagram-exchange'), { method: 'POST', headers: { apikey: storage.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, installId: this.data.installId }) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 404 && data.code === 'NOT_FOUND') throw new Error('O serviço de login Instagram ainda não foi publicado no Supabase.');
    if (!response.ok) throw new Error(String(data.error || 'Serviço de autorização Meta indisponível.'));
    return data;
  }
  async connect(accountId) {
    if (this.connecting.has(accountId)) throw new Error('Já existe um login Meta em andamento para esta conta. Conclua ou feche a janela atual.');
    this.connecting.add(accountId);
    try { return await this.connectOnce(accountId); }
    finally { this.connecting.delete(accountId); }
  }
  async connectOnce(accountId) {
    if (!this.data.redirectUri) throw new Error('Configure o retorno do Instagram antes de conectar a conta.');
    const connection = await this.getConnection(accountId);
    const started = await this.service(connection, { action: 'start', accountId });
    if (!/^\d{8,25}$/.test(String(started.appId || '')) || started.provider !== 'instagram' || started.redirectUri !== this.data.redirectUri || typeof started.state !== 'string') throw new Error('Configuração do ClubXone não corresponde ao serviço de autorização.');
    this.data.appId = started.appId; this.save();
    const nonce = started.state;
    const login = new URL('https://www.instagram.com/oauth/authorize');
    login.searchParams.set('force_authentication', '1');
    login.searchParams.set('client_id', this.data.appId); login.searchParams.set('redirect_uri', this.data.redirectUri); login.searchParams.set('state', nonce); login.searchParams.set('response_type', 'code'); login.searchParams.set('scope', [...REQUIRED_PERMISSIONS, INSIGHTS_PERMISSION].join(','));
    const code = await new Promise((resolve, reject) => {
      const win = new this.BrowserWindow({ width: 600, height: 760, parent: this.parent(), title: 'Conectar Instagram', webPreferences: { session: connection.ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      this.registerLoginWindow(win, connection);
      let done = false;
      const deadline = Number.isFinite(Date.parse(started.expiresAt)) ? Date.parse(started.expiresAt) : Date.now() + 600000;
      if (deadline <= Date.now()) { win.close(); reject(new Error('O login Meta expirou. Tente novamente.')); return; }
      const timeout = setTimeout(() => finish(new Error('O login Meta expirou. Tente novamente.')), deadline - Date.now());
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(timeout); if (!win.isDestroyed()) win.close(); error ? reject(error) : resolve(value); };
      const inspect = (event, target) => { try { const url = new URL(target), expected = new URL(this.data.redirectUri); if (url.origin !== expected.origin || url.pathname !== expected.pathname) return; event?.preventDefault?.(); if (url.searchParams.get('state') !== nonce) throw new Error('Resposta de login não corresponde à conta iniciada.'); const value = url.searchParams.get('code'); if (!value) throw new Error(url.searchParams.get('error_description') || 'Login Meta cancelado.'); finish(null, value); } catch (error) { finish(error); } };
      win.webContents.on('will-redirect', inspect); win.webContents.on('will-navigate', inspect); win.webContents.on('did-navigate', (_event, target) => inspect(null, target));
      win.on('closed', () => finish(new Error('Login Meta cancelado.')));
      win.loadURL(login.toString()).catch(() => { if (!done) finish(new Error('Não foi possível abrir o login Meta.')); });
    });
    const exchanged = await this.service(connection, { action: 'exchange', accountId, state: nonce, code });
    if (typeof exchanged.accessToken !== 'string' || !exchanged.accessToken) throw new Error('O serviço Meta não retornou uma autorização.');
    const userToken = exchanged.accessToken;
    const granted = Array.isArray(exchanged.permissions) ? exchanged.permissions : [];
    const missing = REQUIRED_PERMISSIONS.filter(permission => !granted.includes(permission));
    if (missing.length) throw new Error(`O Instagram não concedeu: ${missing.join(', ')}. Reconecte e autorize a publicação.`);
    const profile = await this.graph(connection, 'me', userToken, 'user_id,username,account_type');
    const igId = String(profile.user_id || '');
    if (!/^\d+$/.test(igId) || !profile.username) throw new Error('O Instagram não retornou a identidade do perfil autorizado.');
    if (!['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(profile.account_type)) throw new Error('Publicação automática exige conta Instagram profissional: Criador ou Empresa.');
    const expiresIn = Number(exchanged.expiresIn);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('O Instagram não informou a validade da autorização.');
    return { connection, profile: { igId, username: profile.username, token: userToken, provider: 'instagram', permissions: granted, insightsGranted: granted.includes(INSIGHTS_PERMISSION), expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), refreshedAt: new Date().toISOString() } };
  }
  async bind(accountId, profile) {
    if ([...Object.entries(this.data.accounts)].some(([id, a]) => id !== accountId && a.igId === profile.igId)) throw new Error('Este perfil Instagram já está conectado a outra conta.');
    this.data.accounts[accountId] = { provider: 'instagram', igId: profile.igId, username: profile.username, permissions: Array.isArray(profile.permissions) ? profile.permissions : null, insightsGranted: Boolean(profile.insightsGranted), expiresAt: profile.expiresAt, refreshedAt: profile.refreshedAt, token: await this.seal(profile.token) }; this.save(); return this.status(accountId);
  }
  async profilePicture(accountId) {
    const account = this.data.accounts[accountId];
    if (!account?.token || account.needsReconnect || account.provider !== 'instagram' || !(Date.parse(account.expiresAt) > Date.now())) return null;
    const connection = await this.getConnection(accountId);
    const profile = await this.graph(connection, 'me', await this.open(account.token), 'profile_picture_url');
    if (!profile.profile_picture_url) return null;
    const url = new URL(profile.profile_picture_url);
    if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) return null;
    const response = await createProxyFetch(this.net, connection)(url);
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) return null;
    const image = Buffer.from(await response.arrayBuffer());
    return image.length && image.length <= 512 * 1024 ? `data:${type};base64,${image.toString('base64')}` : null;
  }
  async token(accountId) {
    const account = this.data.accounts[accountId];
    if (!account?.token || account.needsReconnect || account.provider !== 'instagram') throw new Error('Reconecte esta conta ao Instagram.');
    if (!account.expiresAt || Date.parse(account.expiresAt) <= Date.now()) { this.markReconnect(accountId); throw new Error('Autorização Instagram expirada. Reconecte a conta.'); }
    let token = await this.open(account.token);
    if (Date.parse(account.expiresAt) - Date.now() < 7 * 86400000) {
      const connection = await this.getConnection(accountId);
      const url = new URL('https://graph.instagram.com/refresh_access_token');
      url.searchParams.set('grant_type', 'ig_refresh_token'); url.searchParams.set('access_token', token);
      const response = await createProxyFetch(this.net, connection)(url);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token || !(Number(data.expires_in) > 0)) { this.markReconnect(accountId); throw new Error('Não foi possível renovar a autorização Instagram. Reconecte a conta.'); }
      token = data.access_token;
      account.token = await this.seal(token); account.expiresAt = new Date(Date.now() + Number(data.expires_in) * 1000).toISOString(); account.refreshedAt = new Date().toISOString(); this.save();
    }
    return token;
  }
  markReconnect(accountId) { if (this.data.accounts[accountId]) { this.data.accounts[accountId].needsReconnect = true; this.save(); } }
  disconnect(accountId) { delete this.data.accounts[accountId]; this.save(); return this.status(accountId); }
}
module.exports = { MetaAuth, missingPermissions };
