const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const { PostingStorage } = require('../src/posting-storage.cjs');

test('video upload reports the Electron network code for a proxy failure', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-upload-error-'));
  try {
    const file = path.join(directory, 'video.mp4');
    fs.writeFileSync(file, 'sample video');
    const net = { request() {
      const request = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('net::ERR_CONNECTION_RESET')); } });
      request.setHeader = () => {};
      return request;
    } };
    const storage = new PostingStorage({ directory, net });
    storage.settings = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
    storage.session = async () => ({ client: {}, session: { access_token: 'test', user: { id: 'user' } } });
    await assert.rejects(storage.upload('account', { ses: {}, proxy: { host: 'proxy' }, credentials: null }, file), error =>
      error.proxyFailure === true && error.message.includes('ERR_CONNECTION_RESET'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
