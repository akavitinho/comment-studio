const test = require('node:test');
const assert = require('node:assert/strict');
const { windowTitle } = require('../src/window-title.cjs');
const account = { name: 'Ana Julia' };
const platform = { id: 'tiktok', label: 'TikTok' };
test('title displays confirmed count and all campaign sources', () => {
  for (const [targetType, source] of [['search', 'Busca: zangi'], ['hashtag', 'Hashtag: #zangi'], ['foryou', 'Para você']]) {
    const title = windowTitle(account, platform, null, { posted: 12, targetType, target: 'zangi' }, 'paused');
    assert.ok(title.includes(`12 enviados · ${source} · Pausada`));
  }
  assert.match(windowTitle(account, platform), /0 enviados · Navegação livre/);
  assert.doesNotMatch(windowTitle(account, { id: 'x', label: 'X' }), /enviados/);
});
