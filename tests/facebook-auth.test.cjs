const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FacebookAuth } = require('../src/facebook-auth.cjs');

test('external Facebook login validates the copied callback before Page selection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-facebook-external-'));
  const redirectUri = 'https://example.supabase.co/functions/v1/meta-callback';
  try {
    const auth = new FacebookAuth({ directory, safeStorage: {}, net: {}, getStorageSettings: () => ({ url: 'https://example.supabase.co' }), parent: () => null });
    auth.service = async (_connection, body) => {
      assert.equal(body.action, 'start');
      return { provider: 'facebook', appId: '123456789012345', redirectUri, state: 'facebook-state', expiresAt: new Date(Date.now() + 60_000).toISOString() };
    };
    let finished = 0;
    auth.finishAuthorization = async (_connection, flowId, started, code) => {
      finished++;
      assert.equal(started.state, 'facebook-state');
      assert.equal(code, 'facebook-one-time-code');
      return { flowId, pages: [{ id: '123', name: 'Minha Página' }] };
    };
    const started = await auth.startExternal({ ses: {} });
    assert.equal(new URL(started.loginUrl).hostname, 'www.facebook.com');
    await assert.rejects(auth.completeExternal(started.flowId, `${redirectUri}?state=wrong&code=facebook-one-time-code`), /outro login/);
    assert.equal(finished, 0);
    const result = await auth.completeExternal(started.flowId, `${redirectUri}?state=facebook-state&code=facebook-one-time-code`);
    assert.equal(result.pages[0].name, 'Minha Página');
    assert.equal(finished, 1);
    await assert.rejects(auth.completeExternal(started.flowId, `${redirectUri}?state=facebook-state&code=facebook-one-time-code`), /ativo/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
