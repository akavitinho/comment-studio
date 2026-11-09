const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const { createProxyFetch } = require('./proxy-fetch.cjs');

class PostingStorage {
  constructor({ directory, safeStorage, net }) {
    this.settingsFile = path.join(directory, 'posting-storage.json');
    this.sessionFile = path.join(directory, 'posting-storage-sessions.json');
    this.safeStorage = safeStorage; this.net = net;
    this.settings = fs.existsSync(this.settingsFile) ? JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')) : null;
    this.sessions = fs.existsSync(this.sessionFile) ? JSON.parse(fs.readFileSync(this.sessionFile, 'utf8')) : {};
  }
  info() { return { configured: Boolean(this.settings), url: this.settings?.url || '', bucket: 'posting-videos' }; }
  configure({ url, publishableKey }) {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || parsed.pathname !== '/') throw new Error('Informe a URL HTTPS do projeto Supabase.');
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(String(publishableKey || ''))) throw new Error('Informe a chave pública do projeto Supabase.');
    this.settings = { url: parsed.origin, publishableKey: String(publishableKey) };
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings), { mode: 0o600 });
    return this.info();
  }
  client(connection) {
    if (!this.settings) throw new Error('Configure o projeto Supabase em Postagens.');
    return createClient(this.settings.url, this.settings.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: createProxyFetch(this.net, connection) } });
  }
  async session(accountId, connection) {
    const client = this.client(connection);
    let data;
    if (this.sessions[accountId]) {
      if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new Error('Proteção do Windows indisponível.');
      const raw = (await this.safeStorage.decryptStringAsync(Buffer.from(this.sessions[accountId], 'base64'))).result;
      const previous = JSON.parse(raw);
      data = await client.auth.setSession({ access_token: previous.access_token, refresh_token: previous.refresh_token });
    } else data = await client.auth.signInAnonymously();
    if (data.error || !data.data?.session?.access_token) throw new Error(data.error?.message || 'Não foi possível autenticar no Storage. Confira o proxy e habilite login anônimo no Supabase.');
    const session = data.data.session;
    if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new Error('Proteção do Windows indisponível.');
    this.sessions[accountId] = (await this.safeStorage.encryptStringAsync(JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }))).toString('base64');
    fs.writeFileSync(this.sessionFile, JSON.stringify(this.sessions), { mode: 0o600 });
    return { client, session };
  }
  async upload(accountId, connection, file) {
    if (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Arquivo de vídeo não encontrado.');
    const { client, session } = await this.session(accountId, connection);
    const ext = path.extname(file).toLowerCase();
    if (!['.mp4', '.mov'].includes(ext)) throw new Error('Use um arquivo MP4 ou MOV.');
    const objectPath = `${session.user.id}/${accountId}/${randomUUID()}${ext}`;
    const url = `${this.settings.url}/storage/v1/object/posting-videos/${objectPath}`;
    const request = this.net.request({ method: 'POST', url, session: connection.ses, redirect: 'error', cache: 'no-store' });
    request.setHeader('Authorization', `Bearer ${session.access_token}`);
    request.setHeader('apikey', this.settings.publishableKey);
    request.setHeader('Content-Type', ext === '.mov' ? 'video/quicktime' : 'video/mp4');
    request.chunkedEncoding = true;
    request.on('login', (info, callback) => { if (connection.credentials && info.isProxy && connection.proxy && info.host.toLowerCase() === connection.proxy.host.toLowerCase() && info.port === connection.proxy.port) callback(connection.credentials.username, connection.credentials.password); else callback(); });
    await new Promise((resolve, reject) => {
      let settled = false; const finish = error => { if (settled) return; settled = true; error ? reject(error) : resolve(); };
      const stream = fs.createReadStream(file);
      stream.on('error', () => { request.abort(); finish(new Error('Não foi possível ler o vídeo.')); });
      request.on('response', response => { let body = ''; response.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) request.abort(); }); response.on('end', () => { if (response.statusCode >= 400) finish(new Error('O Storage recusou o vídeo. Confira o bucket privado e as regras de acesso.')); else finish(); }); });
      request.on('error', error => { const failure = new Error(`Falha ao enviar o vídeo pela ${connection.proxy ? 'conexão com proxy' : 'conexão direta'} da conta (${error.code || 'erro de rede'}).`); failure.proxyFailure = Boolean(connection.proxy); finish(failure); });
      stream.pipe(request);
    });
    let signed;
    try {
      signed = await client.storage.from('posting-videos').createSignedUrl(objectPath, 3600);
      if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message || 'Não foi possível criar URL temporária para a Meta.');
    } catch (error) {
      await this.remove(client, objectPath).catch(() => { error.orphanPath = objectPath; });
      throw error;
    }
    return { client, objectPath, signedUrl: signed.data.signedUrl };
  }
  async remove(client, objectPath) { if (objectPath) { const result = await client.storage.from('posting-videos').remove([objectPath]); if (result.error) throw result.error; } }
  clearAccount(accountId) { delete this.sessions[accountId]; fs.writeFileSync(this.sessionFile, JSON.stringify(this.sessions), { mode: 0o600 }); }
}
module.exports = { PostingStorage };
