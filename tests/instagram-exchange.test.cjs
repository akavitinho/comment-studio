const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

// Execute the actual Edge Function with simulated Meta and database services.
function harness(responses) {
  let handler, graphCalls = 0;
  const rows = new Map();
  const database = { from() { return {
    async insert(row) { rows.set(row.state_hash, row); return { error: null }; },
    delete() {
      const filters = {};
      return {
        async lt() { return { error: null }; },
        eq(key, value) { filters[key] = value; return this; },
        gt() { return this; },
        select() { return this; },
        async maybeSingle() {
          const row = rows.get(filters.state_hash);
          const matches = row && Object.entries(filters).every(([key, value]) => row[key] === value);
          if (matches) rows.delete(filters.state_hash);
          return { data: matches ? row : null, error: null };
        }
      };
    }
  }; } };
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/instagram-exchange/index.ts'), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2';", '');
  vm.runInNewContext(stripTypeScriptTypes(source), {
    createClient: () => database,
    Deno: { env: { get: name => ({ INSTAGRAM_APP_SECRET: 'test-secret', INSTAGRAM_APP_ID: '123456789012345', SUPABASE_URL: 'https://example.test', SUPABASE_SECRET_KEYS: '{"default":"test-key"}' })[name] }, serve: fn => { handler = fn; } },
    crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, Response, AbortSignal, btoa, atob,
    fetch: async (url, options) => {
      if (!graphCalls) { assert.equal(url.href, 'https://api.instagram.com/oauth/access_token'); assert.equal(options.method, 'POST'); assert.equal(options.body.get('grant_type'), 'authorization_code'); assert.equal(options.body.get('client_id'), '123456789012345'); }
      else { assert.equal(url.origin + url.pathname, 'https://graph.instagram.com/access_token'); assert.equal(url.searchParams.get('grant_type'), 'ig_exchange_token'); }
      const result = responses[graphCalls++]; return new Response(JSON.stringify(result.body), { status: result.status }); }
  });
  const identity = { accountId: '00000000-0000-4000-8000-000000000001', installId: 'a'.repeat(48) };
  return {
    calls: () => graphCalls,
    async send(body) {
      const response = await handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify({ ...identity, ...body }) }));
      return { status: response.status, data: await response.json() };
    }
  };
}

test('exchange identifies rejected secret without exposing raw Meta error and rejects replay', async () => {
  const app = harness([{ status: 400, body: { error: { message: 'Invalid client secret: sensitive-value', code: 1, error_subcode: 2 } } }]);
  const started = await app.send({ action: 'start' });
  assert.equal(started.status, 200);
  const input = { action: 'exchange', state: started.data.state, code: 'test-code-123' };
  const result = await app.send(input);
  assert.equal(result.status, 400);
  assert.match(result.data.error, /Falha ao trocar código: Segredo do aplicativo Instagram recusado/);
  assert.match(result.data.error, /Meta 1\/2, HTTP 400/);
  assert.equal(JSON.stringify(result).includes('sensitive-value'), false);
  assert.match((await app.send(input)).data.error, /Falha ao consumir estado/);
  assert.equal(app.calls(), 1);
});

test('extension failure never returns the short token or raw error', async () => {
  const app = harness([
    { status: 200, body: { access_token: 'sensitive-short-token', permissions: ['instagram_business_basic', 'instagram_business_content_publish'] } },
    { status: 400, body: { error: { message: 'unknown sensitive-short-token', code: 190 } } }
  ]);
  const started = await app.send({ action: 'start' });
  const result = await app.send({ action: 'exchange', state: started.data.state, code: 'test-code-123' });
  assert.match(result.data.error, /Falha ao estender token/);
  assert.equal(JSON.stringify(result).includes('sensitive-short-token'), false);
  assert.equal(result.data.accessToken, undefined);
});

test('successful exchange returns the extended token once', async () => {
  const app = harness([
    { status: 200, body: { data: [{ access_token: 'short-token', permissions: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'] }] } },
    { status: 200, body: { access_token: 'long-token', expires_in: 5000 } }
  ]);
  const started = await app.send({ action: 'start' });
  const input = { action: 'exchange', state: started.data.state, code: 'test-code-123' };
  assert.deepEqual(await app.send(input), { status: 200, data: { accessToken: 'long-token', expiresIn: 5000, permissions: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'] } });
  assert.equal((await app.send(input)).status, 400);
  assert.equal(app.calls(), 2);
});
