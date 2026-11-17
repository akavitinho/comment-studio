const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

function harness() {
  const rows = new Map();
  const database = { from() { return {
    async insert(row) { rows.set(row.state_hash, row); return { error: null }; },
    delete() { return query('delete'); },
    update(values) { return query('update', values); },
    select() { return query('select'); },
  }; } };
  function query(kind, values = {}) {
    const filters = [];
    return {
      async lt() { return { error: null }; },
      eq(column, value) { filters.push(row => row[column] === value); return this; },
      gt(column, value) { filters.push(row => row[column] > value); return this; },
      not(column, _operator, value) { filters.push(row => row[column] !== value && row[column] !== undefined); return this; },
      is(column, value) { filters.push(row => (row[column] ?? null) === value); return this; },
      select() { return this; },
      async maybeSingle() {
        const row = [...rows.values()].find(item => filters.every(filter => filter(item)));
        if (!row) return { data: null, error: null };
        if (kind === 'delete') rows.delete(row.state_hash);
        if (kind === 'update') Object.assign(row, values);
        return { data: { ...row }, error: null };
      }
    };
  }
  const env = { INSTAGRAM_APP_SECRET: 'test-secret', INSTAGRAM_APP_ID: '123456789012345', SUPABASE_URL: 'https://example.test', SUPABASE_SECRET_KEYS: '{"default":"test-key"}' };
  const handlers = {};
  for (const name of ['instagram-exchange', 'meta-callback']) {
    const context = { createClient: () => database, Deno: { env: { get: key => env[key] }, serve: handler => { handlers[name] = handler; } }, crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, Request, Response, AbortSignal, btoa, atob,
      fetch: async url => new Response(JSON.stringify(url.hostname === 'api.instagram.com' ? { access_token: 'short-token', permissions: ['instagram_business_basic', 'instagram_business_content_publish'] } : { access_token: 'long-token', expires_in: 5000 }), { status: 200 }) };
    const source = fs.readFileSync(path.join(__dirname, `../supabase/functions/${name}/index.ts`), 'utf8').replace("import { createClient } from 'npm:@supabase/supabase-js@2';", '');
    vm.runInNewContext(stripTypeScriptTypes(source), context);
  }
  const identity = { accountId: '00000000-0000-4000-8000-000000000001', installId: 'a'.repeat(48) };
  return {
    rows,
    async exchange(body) { const response = await handlers['instagram-exchange'](new Request('https://example.test/functions/v1/instagram-exchange', { method: 'POST', body: JSON.stringify({ ...identity, ...body }) })); return { status: response.status, data: await response.json() }; },
    callback(state, code = 'one-time-code', cancelled = false) { return handlers['meta-callback'](new Request(`https://example.test/meta-callback?state=${encodeURIComponent(state)}&${cancelled ? 'error=access_denied' : `code=${encodeURIComponent(code)}`}`)); }
  };
}

test('Dolphin callback completes only the initiating automatic login', async () => {
  const app = harness();
  const pollSecret = 'b'.repeat(64);
  const started = await app.exchange({ action: 'start', autoConnect: true, pollSecret });
  assert.equal(started.status, 200);
  const state = started.data.state;
  assert.equal((await app.exchange({ action: 'status', state, pollSecret })).data.status, 'pending');
  assert.equal((await app.exchange({ action: 'status', state, pollSecret: 'c'.repeat(64) })).status, 400);
  const callback = await app.callback(state);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), 'https://example.test/functions/v1/meta-callback?completed=1');
  assert.equal(JSON.stringify([...app.rows.values()]).includes('one-time-code'), false);
  assert.equal((await app.exchange({ action: 'status', state, pollSecret })).data.status, 'ready');
  const result = await app.exchange({ action: 'exchange_auto', state, pollSecret });
  assert.equal(result.data.accessToken, 'long-token');
  assert.equal((await app.exchange({ action: 'exchange_auto', state, pollSecret })).status, 400);
});

test('manual Instagram callback keeps its existing return page', async () => {
  const app = harness();
  const started = await app.exchange({ action: 'start' });
  const callback = await app.callback(started.data.state);
  assert.equal(callback.status, 200);
  assert.equal(app.rows.size, 1);
});

test('Facebook callback remains available to the existing Page login', async () => {
  const app = harness();
  const payload = Buffer.from(JSON.stringify({ provider: 'facebook', appId: '987654321098765', auto: false })).toString('base64url');
  const callback = await app.callback(`${payload}.facebook-signature`);
  assert.equal(callback.status, 200);
});

test('cancelled or expired links never exchange an Instagram code', async () => {
  const app = harness();
  const pollSecret = 'd'.repeat(64);
  const cancelled = await app.exchange({ action: 'start', autoConnect: true, pollSecret });
  assert.equal((await app.callback(cancelled.data.state, '', true)).status, 303);
  assert.equal((await app.exchange({ action: 'status', state: cancelled.data.state, pollSecret })).data.status, 'cancelled');
  assert.equal((await app.exchange({ action: 'exchange_auto', state: cancelled.data.state, pollSecret })).status, 400);
  const expired = await app.exchange({ action: 'start', autoConnect: true, pollSecret });
  for (const row of app.rows.values()) if (row.expires_at !== undefined && row.code_ciphertext === undefined && row.state_hash !== undefined) row.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await app.callback(expired.data.state)).status, 400);
});
