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
