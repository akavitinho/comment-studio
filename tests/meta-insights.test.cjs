const test = require('node:test');
const assert = require('node:assert/strict');
const { MetaPublisher } = require('../src/meta-publisher.cjs');

test('Instagram insights read views and reach without exposing the token in the URL', async () => {
  const publisher = new MetaPublisher({ fetch: async (url, options) => {
    assert.equal(url.toString(), 'https://graph.instagram.com/v23.0/17840000000000001/insights?metric=views%2Creach');
    assert.equal(options.headers.Authorization, 'Bearer protected-token');
    return { ok: true, json: async () => ({ data: [
      { name: 'views', total_value: { value: 125 } },
      { name: 'reach', values: [{ value: 84 }] }
    ] }) };
  } });
  assert.deepEqual(await publisher.insights('17840000000000001', 'protected-token'), { views: 125, reach: 84 });
});

test('Facebook Reels flow initializes upload, uploads by URL and finishes publication', async () => {
  const calls = [];
  const publisher = new MetaPublisher({
    fetch: async (url, options) => {
      calls.push({ url: url.toString(), options });
      if (url.toString().includes('/video_reels') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        if (body.upload_phase === 'start') {
          return { ok: true, json: async () => ({ video_id: 'fb-vid-123', upload_url: 'https://rupload.facebook.com/video-upload/fb-vid-123' }) };
        }
        if (body.upload_phase === 'finish') {
          return { ok: true, json: async () => ({ success: true, id: 'fb-vid-123' }) };
        }
      }
      if (url.toString().includes('rupload.facebook.com')) {
        assert.equal(options.headers.file_url, 'https://storage.example.org/signed.mp4');
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url.toString().includes('/fb-vid-123')) {
        return { ok: true, json: async () => ({ id: 'fb-vid-123', permalink_url: 'https://www.facebook.com/reel/fb-vid-123' }) };
      }
      throw new Error(`Chamada inesperada: ${url}`);
    }
  });

  const result = await publisher.publishFacebookReel('page-456', 'page-token', 'https://storage.example.org/signed.mp4', 'Minha legenda');
  assert.equal(result.videoId, 'fb-vid-123');
  assert.equal(result.permalink, 'https://www.facebook.com/reel/fb-vid-123');
  assert.equal(calls.length, 4);
});
