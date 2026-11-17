const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { MetaAuth, missingPermissions } = require('../src/meta-auth.cjs');
const storage = () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' });

test('pronto para teste no app Meta não substitui permissões concedidas no login', () => {
  const grants = { data: [{ permission: 'instagram_business_basic', status: 'granted' }, { permission: 'instagram_business_content_publish', status: 'declined' }] };
  assert.deepEqual(missingPermissions(grants), ['instagram_business_content_publish']);
});

test('Meta app secret is removed from legacy local state and tokens stay protected', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-meta-'));
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => Buffer.from(`sealed:${value}`),
    decryptStringAsync: async value => ({ result: value.toString().replace(/^sealed:/, '') })
  };
  fs.writeFileSync(path.join(directory, 'meta-auth.json'), JSON.stringify({ appId: '', redirectUri: '', graphVersion: 'v23.0', secret: 'legacy-encrypted-secret', accounts: {} }));
  const auth = new MetaAuth({ directory, safeStorage, getStorageSettings: storage });
  await auth.configure({ provider: 'instagram', appId: '123456789012345', redirectUri: 'https://example.supabase.co/functions/v1/meta-callback', graphVersion: 'v23.0' });
  await auth.bind('account-a', { id: 'page-1', name: 'Page', igId: 'ig-1', username: 'creator', token: 'page-token' });
  const raw = fs.readFileSync(path.join(directory, 'meta-auth.json'), 'utf8');
  assert.equal(raw.includes('legacy-encrypted-secret'), false);
  assert.equal(auth.settings().secretConfigured, undefined);
  assert.equal(raw.includes('page-token'), false);
  assert.equal(JSON.stringify(auth.status('account-a')).includes('token'), false);
  auth.markReconnect('account-a');
  assert.equal(auth.status('account-a').needsReconnect, true);
  assert.equal(auth.status('account-a').connected, false);
  await assert.rejects(() => auth.bind('account-b', { id: 'page-2', name: 'Other', igId: 'ig-1', username: 'creator', token: 'other-token' }), /outra conta/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('login binds signed state to the account and exchanges code through the service', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-meta-flow-'));
  const calls = [];
  class LoginWindow extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.closed = false; }
    isDestroyed() { return this.closed; }
    close() { this.closed = true; this.emit('closed'); }
    async loadURL(url) {
      const login = new URL(url);
      assert.equal(login.searchParams.get('state'), 'signed-state');
      assert.equal(login.searchParams.has('config_id'), false);
      assert.equal(login.hostname, 'www.instagram.com');
      assert.equal(login.searchParams.get('force_authentication'), '1');
      assert.equal(login.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights');
      setImmediate(() => this.webContents.emit('will-redirect', { preventDefault() {} }, `${login.searchParams.get('redirect_uri')}?state=signed-state&code=one-time-code`));
    }
  }
  try {
    const auth = new MetaAuth({
      directory, safeStorage: {}, BrowserWindow: LoginWindow, net: {}, getConnection: async () => ({ ses: {} }), parent: () => null, getStorageSettings: storage,
      requestService: async (_connection, body) => {
        calls.push(body);
        if (body.action === 'start') return { provider: 'instagram', appId: '123456789012345', redirectUri: 'https://example.supabase.co/functions/v1/meta-callback', state: 'signed-state' };
        return { accessToken: 'long-user-token', expiresIn: 5184000, permissions: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'] };
      }
    });
    await auth.configure({ provider: 'instagram', appId: '123456789012345', redirectUri: 'https://example.supabase.co/functions/v1/meta-callback' });
    auth.graph = async (_connection, route, token) => {
      assert.equal(token, 'long-user-token');
      assert.equal(route, 'me');
      return { user_id: '17841400000000001', username: 'creator', account_type: 'BUSINESS' };
    };
    const result = await auth.connect('00000000-0000-4000-8000-000000000001');
    assert.equal(result.profile.igId, '17841400000000001');
    assert.equal(result.profile.username, 'creator');
    assert.equal(result.profile.insightsGranted, true);
    assert.deepEqual(calls.map(call => call.action), ['start', 'exchange']);
    assert.equal(calls[0].installId, calls[1].installId);
    assert.equal(calls[1].state, 'signed-state');
    assert.equal(calls[1].code, 'one-time-code');
    assert.equal(fs.readFileSync(path.join(directory, 'meta-auth.json'), 'utf8').includes('long-user-token'), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('external Instagram login accepts only the callback for the copied link', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-meta-external-'));
  const redirectUri = 'https://example.supabase.co/functions/v1/meta-callback';
  const calls = [];
  try {
    const auth = new MetaAuth({ directory, safeStorage: {}, getConnection: async () => ({ ses: {} }), getStorageSettings: storage,
      requestService: async (_connection, body) => {
        calls.push(body);
        if (body.action === 'start') return { provider: 'instagram', appId: '123456789012345', redirectUri, state: 'signed-external-state', expiresAt: new Date(Date.now() + 60_000).toISOString() };
        return { accessToken: 'long-user-token', expiresIn: 5184000, permissions: ['instagram_business_basic', 'instagram_business_content_publish'] };
      } });
    auth.graph = async () => ({ user_id: '17841400000000001', username: 'creator', account_type: 'BUSINESS' });
    const started = await auth.startExternal('account-a');
    assert.equal(new URL(started.loginUrl).hostname, 'www.instagram.com');
    assert.equal(new URL(started.loginUrl).searchParams.has('force_authentication'), false);
    await assert.rejects(auth.completeExternal('account-a', `${redirectUri}?state=wrong&code=one-time-code`), /outro login/);
    assert.equal(calls.length, 1);
    const result = await auth.completeExternal('account-a', `${redirectUri}?state=signed-external-state&code=one-time-code`);
    assert.equal(result.profile.username, 'creator');
    assert.deepEqual(calls.map(call => call.action), ['start', 'exchange']);
    await assert.rejects(auth.completeExternal('account-a', `${redirectUri}?state=signed-external-state&code=one-time-code`), /Gere primeiro/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('automatic Instagram login waits for Dolphin and exchanges without a pasted URL', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-meta-automatic-'));
  const calls = [];
  let ready = false;
  try {
    const auth = new MetaAuth({ directory, safeStorage: {}, getStorageSettings: storage,
      requestService: async (_connection, body) => {
        calls.push(body);
        if (body.action === 'start') return { provider: 'instagram', appId: '123456789012345', redirectUri: 'https://example.supabase.co/functions/v1/meta-callback', state: 'signed-automatic-state', expiresAt: new Date(Date.now() + 60_000).toISOString() };
        if (body.action === 'status') return { status: ready ? 'ready' : 'pending' };
        return { accessToken: 'long-user-token', expiresIn: 5184000, permissions: ['instagram_business_basic', 'instagram_business_content_publish'] };
      } });
    auth.graph = async () => ({ user_id: '17841400000000001', username: 'creator', account_type: 'BUSINESS' });
    const connection = { ses: {} };
    const started = await auth.startAutomatic('account-a', connection);
    assert.equal(new URL(started.loginUrl).searchParams.get('state'), 'signed-automatic-state');
    assert.equal(new URL(started.loginUrl).searchParams.has('force_authentication'), false);
    assert.equal(calls[0].autoConnect, true);
    assert.match(calls[0].pollSecret, /^[a-f0-9]{64}$/);
    assert.equal((await auth.pollAutomatic('account-a')).status, 'pending');
    ready = true;
    const finished = await auth.pollAutomatic('account-a');
    assert.equal(finished.result.profile.username, 'creator');
    assert.deepEqual(calls.map(call => call.action), ['start', 'status', 'status', 'exchange_auto']);
    assert.equal(calls[0].pollSecret, calls[3].pollSecret);
    await assert.rejects(auth.pollAutomatic('account-a'), /não está mais ativo/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('expired OAuth state closes login before opening Facebook', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-meta-expired-'));
  let closed = false, loaded = false;
  class LoginWindow extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); }
    isDestroyed() { return closed; }
    close() { closed = true; }
    async loadURL() { loaded = true; }
  }
  try {
    const auth = new MetaAuth({ directory, safeStorage: {}, BrowserWindow: LoginWindow, getConnection: async () => ({ ses: {} }), parent: () => null, getStorageSettings: storage,
      requestService: async () => ({ provider: 'instagram', appId: '123456789012345', redirectUri: 'https://example.supabase.co/functions/v1/meta-callback', state: 'expired', expiresAt: new Date(Date.now() - 1000).toISOString() }) });
    await assert.rejects(auth.connect('00000000-0000-4000-8000-000000000001'), /expirou/);
    assert.equal(closed, true);
    assert.equal(loaded, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('não abre dois logins Meta ao mesmo tempo para a mesma conta', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-meta-single-'));
  let rejectFirst;
  try {
    const auth = new MetaAuth({ directory, safeStorage: {}, getConnection: async () => ({ ses: {} }), getStorageSettings: storage,
      requestService: async () => new Promise((_resolve, reject) => { rejectFirst = reject; }) });
    const first = auth.connect('00000000-0000-4000-8000-000000000001');
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(auth.connect('00000000-0000-4000-8000-000000000001'), /em andamento/);
    rejectFirst(new Error('Login cancelado no teste.'));
    await assert.rejects(first, /cancelado/);
    assert.equal(auth.connecting.size, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
