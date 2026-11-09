const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TikTokAnalytics } = require('../src/tiktok-analytics.cjs');

test('TikTok metrics save real readings and rotate the refresh token', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-analytics-'));
  let analytics;
  try {
    const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) };
    analytics = new TikTokAnalytics({ directory, safeStorage, BrowserWindow: class {}, net: {}, getConnection: async () => ({ ses: {} }), parent: () => null });
    await analytics.configure({ clientKey: 'testclientkey', clientSecret: 'test-secret' });
    await analytics.bind('account-1', { username: 'creator', tokens: { open_id: 'open-1', access_token: 'old-access', refresh_token: 'old-refresh', scope: 'video.list', expires_in: 1, refresh_expires_in: 3600 } });
    analytics.tokenRequest = async (_connection, fields) => {
      assert.equal(fields.refresh_token, 'old-refresh');
      return { open_id: 'open-1', access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 7200, refresh_expires_in: 3600 };
    };
    let views = 100;
    analytics.request = async (_connection, url, options) => {
      assert.match(url, /\/v2\/video\/list\/\?/);
      assert.equal(options.headers.Authorization, 'Bearer new-access');
      return { data: { videos: [{ id: '123', create_time: 1760000000, title: 'Exemplo', share_url: 'https://www.tiktok.com/@creator/video/123', view_count: views, like_count: 10, comment_count: 2, share_count: 1 }] }, error: { code: 'ok' } };
    };
    assert.equal(await analytics.refresh('account-1'), 1);
    views = 125;
    assert.equal(await analytics.refresh('account-1'), 1);
    const state = analytics.snapshot();
    assert.equal(state.videos[0].views, 125);
    assert.deepEqual(state.history.map(point => point.views), [100, 125]);
    assert.equal(await analytics.open(analytics.data.accounts['account-1'].refreshToken), 'new-refresh');
    analytics.delete('account-1');
    assert.equal(analytics.snapshot().videos.length, 0);
    assert.equal(analytics.snapshot().history.length, 0);
  } finally { analytics?.db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('changing TikTok Client Key requires the matching Client Secret', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-analytics-'));
  let analytics;
  try {
    const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(value), decryptStringAsync: async value => ({ result: value.toString() }) };
    analytics = new TikTokAnalytics({ directory, safeStorage, BrowserWindow: class {}, net: {}, getConnection: async () => ({ ses: {} }), parent: () => null });
    await analytics.configure({ clientKey: 'productionkey', clientSecret: 'production-secret' });
    await assert.rejects(analytics.configure({ clientKey: 'sandboxkey', clientSecret: '' }), /mesmo app e ambiente/);
    assert.equal(analytics.settings().clientKey, 'productionkey');
  } finally { analytics?.db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
