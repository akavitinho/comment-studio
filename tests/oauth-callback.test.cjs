const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizationCode } = require('../src/oauth-callback.cjs');

const redirect = 'https://example.supabase.co/functions/v1/meta-callback';
const deadline = () => new Date(Date.now() + 60_000).toISOString();

test('accepts only the matching HTTPS callback with state and code', () => {
  assert.equal(authorizationCode(`${redirect}?code=ABCdef123456&state=login-1#_=_`, redirect, 'login-1', deadline()), 'ABCdef123456');
  for (const callback of [
    `http://example.supabase.co/functions/v1/meta-callback?code=ABCdef123456&state=login-1`,
    `https://other.supabase.co/functions/v1/meta-callback?code=ABCdef123456&state=login-1`,
    `${redirect}?code=ABCdef123456&state=login-2`,
    `${redirect}?code=ABCdef123456&state=login-1&state=login-2`,
    `${redirect}?state=login-1`,
  ]) assert.throws(() => authorizationCode(callback, redirect, 'login-1', deadline()));
  assert.throws(() => authorizationCode(`${redirect}?code=ABCdef123456&state=login-1`, redirect, 'login-1', new Date(Date.now() - 1000).toISOString()), /expirou/);
});
