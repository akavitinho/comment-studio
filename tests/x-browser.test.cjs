const { test } = require('node:test');
const assert = require('node:assert/strict');
const { XBrowser } = require('../src/x-browser.cjs');

test('X waits for session navigation to hydrate after loading the search', async () => {
  let reads = 0;
  const url = 'https://x.com/search?q=%23teste&src=typed_query&f=live';
  const browser = new XBrowser({ openAccount: async () => {}, getWindow: () => ({ isDestroyed: () => false, loadURL: async value => assert.equal(value, url) }) });
  browser.page = async () => ++reads < 3
    ? { handle: null, recognized: false, url }
    : { handle: 'me', recognized: true, url, posts: [] };
  assert.equal((await browser.search('a', 'teste', 'latest')).handle, 'me');
  assert.equal(reads, 3);
});

test('X still stops at an explicit login or verification screen', async () => {
  const browser = new XBrowser({});
  browser.page = async () => ({ handle: null, attention: 'Faça login ou resolva a verificação na janela do X.' });
  await assert.rejects(browser.ready('a', () => true), /Faça login/);
});
