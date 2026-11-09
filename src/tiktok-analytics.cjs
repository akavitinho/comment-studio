const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createProxyFetch } = require('./proxy-fetch.cjs');

const FIELDS = 'id,create_time,title,share_url,view_count,like_count,comment_count,share_count';
const SCOPES = 'user.info.basic,user.info.profile,video.list';
const CALLBACK = 'http://127.0.0.1:3455/callback/';

class TikTokAnalytics {
  constructor({ directory, safeStorage, BrowserWindow, net, getConnection, parent, registerLoginWindow = () => {} }) {
    this.file = path.join(directory, 'tiktok-analytics.json');
    this.safeStorage = safeStorage; this.BrowserWindow = BrowserWindow; this.net = net; this.getConnection = getConnection; this.parent = parent; this.registerLoginWindow = registerLoginWindow;
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { clientKey: '', clientSecret: '', accounts: {} };
    this.connecting = new Set();
    this.db = new DatabaseSync(path.join(directory, 'tiktok-analytics.sqlite'));
    this.db.exec(`CREATE TABLE IF NOT EXISTS videos (account_id TEXT NOT NULL, video_id TEXT NOT NULL, title TEXT, share_url TEXT, created_at TEXT, views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, fetched_at TEXT NOT NULL, PRIMARY KEY(account_id,video_id));
      CREATE TABLE IF NOT EXISTS history (account_id TEXT NOT NULL, video_id TEXT NOT NULL, views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, fetched_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS history_account_time ON history(account_id,fetched_at);`);
  }
  save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file); }
  async seal(value) { if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new Error('Proteção de credenciais do Windows indisponível.'); return (await this.safeStorage.encryptStringAsync(value)).toString('base64'); }
  async open(value) { return (await this.safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result; }
  settings() { return { clientKey: this.data.clientKey, configured: Boolean(this.data.clientKey && this.data.clientSecret), redirectUri: CALLBACK }; }
  async configure({ clientKey, clientSecret }) {
    const key = String(clientKey || '').trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new Error('Informe uma Client Key válida do TikTok for Developers.');
    if (key !== this.data.clientKey && Object.keys(this.data.accounts).length) throw new Error('Desconecte as contas TikTok antes de trocar a Client Key.');
    if (this.data.clientKey && key !== this.data.clientKey && !clientSecret) throw new Error('Ao trocar a Client Key, informe também o Client Secret do mesmo app e ambiente TikTok.');
    if (!clientSecret && !this.data.clientSecret) throw new Error('Informe o Client Secret do aplicativo TikTok.');
    if (clientSecret && (typeof clientSecret !== 'string' || clientSecret.length > 512)) throw new Error('Client Secret inválido.');
    this.data.clientKey = key;
    if (clientSecret) this.data.clientSecret = await this.seal(clientSecret);
    this.save(); return this.settings();
  }
  status(id) { const account = this.data.accounts[id]; return account ? { connected: !account.needsReconnect, needsReconnect: Boolean(account.needsReconnect), username: account.username, openId: account.openId, expiresAt: account.expiresAt } : { connected: false, needsReconnect: false }; }
  async request(connection, url, options) {
    const response = await createProxyFetch(this.net, connection)(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || (body.error && body.error !== 'ok' && body.error.code !== 'ok')) {
      const code = typeof body.error === 'string' ? body.error : body.error?.code;
      const logId = typeof body.log_id === 'string' ? body.log_id : body.error?.log_id;
      const safeLogId = /^[A-Za-z0-9_-]{8,100}$/.test(logId || '') ? ` ID de diagnóstico: ${logId}.` : '';
      const hint = code === 'invalid_client' ? ' Confira se a Client Key e o Client Secret pertencem ao mesmo app e ao mesmo ambiente (Sandbox ou Production).' : '';
      const error = new Error(`TikTok recusou a solicitação${code ? ` (${code})` : ''}.${hint}${safeLogId}`);
      error.code = code; throw error;
    }
    return body;
  }
  async tokenRequest(connection, fields) {
    return this.request(connection, 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: this.data.clientKey, client_secret: await this.open(this.data.clientSecret), ...fields }).toString() });
  }
  async connect(id) {
    if (!this.settings().configured) throw new Error('Configure a Client Key e o Client Secret do TikTok antes de conectar.');
    if (this.connecting.has(id)) throw new Error('Já existe um login TikTok em andamento para esta conta.');
    this.connecting.add(id);
    try {
      const connection = await this.getConnection(id);
      const state = randomBytes(24).toString('hex');
      const verifier = randomBytes(48).toString('hex');
      const challenge = createHash('sha256').update(verifier).digest('hex');
      const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
      for (const [key, value] of Object.entries({ client_key: this.data.clientKey, scope: SCOPES, response_type: 'code', redirect_uri: CALLBACK, state, code_challenge: challenge, code_challenge_method: 'S256' })) url.searchParams.set(key, value);
      const code = await new Promise((resolve, reject) => {
        const win = new this.BrowserWindow({ width: 600, height: 760, parent: this.parent(), title: 'Conectar métricas TikTok', webPreferences: { session: connection.ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
        this.registerLoginWindow(win, connection);
        let done = false;
        const finish = (error, value) => { if (done) return; done = true; clearTimeout(timeout); if (!win.isDestroyed()) win.close(); error ? reject(error) : resolve(value); };
        const timeout = setTimeout(() => finish(new Error('O login TikTok expirou. Tente novamente.')), 600000);
        const inspect = (event, target) => { let callback; try { callback = new URL(target); } catch { return; } if (callback.origin !== new URL(CALLBACK).origin || callback.pathname !== new URL(CALLBACK).pathname) return; event?.preventDefault?.(); if (callback.searchParams.get('state') !== state) return finish(new Error('Resposta de login TikTok inválida.')); const value = callback.searchParams.get('code'); finish(value ? null : new Error(callback.searchParams.get('error_description') || 'Login TikTok cancelado.'), value); };
        win.webContents.on('will-redirect', inspect); win.webContents.on('will-navigate', inspect); win.webContents.on('did-navigate', (_event, target) => inspect(null, target));
        win.on('closed', () => finish(new Error('Login TikTok cancelado.')));
        win.loadURL(url.toString()).catch(() => { if (!done) finish(new Error('Não foi possível abrir o login TikTok.')); });
      });
      const tokens = await this.tokenRequest(connection, { code, grant_type: 'authorization_code', redirect_uri: CALLBACK, code_verifier: verifier });
      if (!tokens.access_token || !tokens.refresh_token || !tokens.open_id || !String(tokens.scope || '').split(',').includes('video.list')) throw new Error('O TikTok não concedeu acesso aos vídeos públicos.');
      if (!(Number(tokens.expires_in) > 0) || !(Number(tokens.refresh_expires_in) > 0)) throw new Error('O TikTok não informou a validade da autorização.');
      const fields = String(tokens.scope).split(',').includes('user.info.profile') ? 'open_id,display_name,username' : 'open_id,display_name';
      const profile = await this.request(connection, `https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (profile.data?.user?.open_id !== tokens.open_id) throw new Error('O TikTok retornou uma identidade diferente da conta autorizada.');
      return { username: profile.data.user.username || '', displayName: profile.data.user.display_name || '', tokens };
    } finally { this.connecting.delete(id); }
  }
  async bind(id, profile) {
    if (Object.entries(this.data.accounts).some(([other, account]) => other !== id && account.openId === profile.tokens.open_id)) throw new Error('Este perfil TikTok já está conectado a outra conta.');
    const tokens = profile.tokens;
    this.data.accounts[id] = { openId: tokens.open_id, username: profile.username, accessToken: await this.seal(tokens.access_token), refreshToken: await this.seal(tokens.refresh_token), expiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString(), refreshExpiresAt: new Date(Date.now() + Number(tokens.refresh_expires_in) * 1000).toISOString() };
    this.save(); return this.status(id);
  }
  async accessToken(id, connection) {
    const account = this.data.accounts[id];
    if (!account || account.needsReconnect) throw new Error('Conecte a conta TikTok às métricas.');
    if (Date.parse(account.expiresAt) > Date.now() + 300000) return this.open(account.accessToken);
    if (Date.parse(account.refreshExpiresAt) <= Date.now()) { account.needsReconnect = true; this.save(); throw new Error('Autorização TikTok expirada. Reconecte a conta.'); }
    let tokens;
    try { tokens = await this.tokenRequest(connection, { grant_type: 'refresh_token', refresh_token: await this.open(account.refreshToken) }); }
    catch (error) { if (['invalid_grant', 'invalid_token'].includes(error.code)) { account.needsReconnect = true; this.save(); } throw error; }
    if (!tokens.access_token || !tokens.refresh_token || tokens.open_id !== account.openId || !(Number(tokens.expires_in) > 0) || !(Number(tokens.refresh_expires_in) > 0)) throw new Error('Renovação TikTok inválida. Reconecte a conta.');
    account.accessToken = await this.seal(tokens.access_token); account.refreshToken = await this.seal(tokens.refresh_token);
    account.expiresAt = new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString(); account.refreshExpiresAt = new Date(Date.now() + Number(tokens.refresh_expires_in) * 1000).toISOString(); this.save();
    return tokens.access_token;
  }
  async refresh(id) {
    const connection = await this.getConnection(id);
    const token = await this.accessToken(id, connection);
    const videos = await this.request(connection, `https://open.tiktokapis.com/v2/video/list/?fields=${FIELDS}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20 }) });
    if (!Array.isArray(videos.data?.videos)) throw new Error('O TikTok não retornou a lista de vídeos.');
    const at = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const upsert = this.db.prepare('INSERT INTO videos (account_id,video_id,title,share_url,created_at,views,likes,comments,shares,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,video_id) DO UPDATE SET title=excluded.title,share_url=excluded.share_url,views=excluded.views,likes=excluded.likes,comments=excluded.comments,shares=excluded.shares,fetched_at=excluded.fetched_at');
      const history = this.db.prepare('INSERT INTO history (account_id,video_id,views,likes,comments,shares,fetched_at) VALUES (?,?,?,?,?,?,?)');
      for (const video of videos.data.videos) {
        if (!/^\d+$/.test(String(video.id || ''))) continue;
        const createdAt = Number.isFinite(Number(video.create_time)) && Number(video.create_time) > 0 ? new Date(Number(video.create_time) * 1000).toISOString() : null;
        const values = [id, String(video.id), String(video.title || '').slice(0, 150), String(video.share_url || ''), createdAt, ...['view_count', 'like_count', 'comment_count', 'share_count'].map(key => video[key] !== null && video[key] !== undefined && Number.isFinite(Number(video[key])) ? Number(video[key]) : null), at];
        upsert.run(...values); history.run(id, values[1], ...values.slice(5, 9), at);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return videos.data.videos.length;
  }
  snapshot() { return { videos: this.db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all(), history: this.db.prepare('SELECT * FROM history ORDER BY fetched_at').all() }; }
  disconnect(id) { delete this.data.accounts[id]; this.save(); }
  delete(id) { this.disconnect(id); this.db.prepare('DELETE FROM videos WHERE account_id=?').run(id); this.db.prepare('DELETE FROM history WHERE account_id=?').run(id); }
}
module.exports = { TikTokAnalytics, CALLBACK };
