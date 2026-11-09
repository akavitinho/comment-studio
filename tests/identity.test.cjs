const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Automation } = require('../src/automation.cjs');

// Unit fixtures supply DOM nodes/geometry. The production identity functions and
// evaluate serialization run unchanged. Rendered HTML coverage is in page-controls.cjs.
function fixture(handle, author = 'metropolesoficial') {
  const bounds = { top: 20, bottom: 60, left: 10, right: 100, width: 90, height: 40 };
  const node = (value, region, label = 'Perfil', e2e = 'nav-profile') => ({
    href: `https://www.tiktok.com/@${value}`, dataset: { e2e }, textContent: label,
    getAttribute: () => label, getBoundingClientRect: () => bounds,
    closest: selector => region && selector.includes(region) ? {} : null
  });
  const profile = node(handle, null);
  const creator = node(author, 'main', 'Perfil', 'profile-icon');
  const comment = node('g1', '[data-e2e="comment-list"]');
  const recommendation = node('g1', '[class*="DivRecommendList"]');
  const navigation = { closest: () => null, querySelectorAll: () => [profile, creator, comment, recommendation] };
  const nestedNavigation = { closest: selector => selector.includes('main') ? {} : null, querySelectorAll: () => [creator] };
  const location = new URL(`https://www.tiktok.com/@${author}/video/123`);
  const page = { navigation, profile, creator, roots: [navigation, nestedNavigation], canonical: { href: location.href }, location };
  const context = vm.createContext({
    URL, location, innerHeight: 800, innerWidth: 1100,
    getComputedStyle: node => ({ display: node.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
    document: { querySelectorAll: () => page.roots, querySelector: () => page.canonical }
  });
  page.win = { isDestroyed: () => false, webContents: { executeJavaScript: script => Promise.resolve(vm.runInContext(script, context)) } };
  return page;
}
function runner() {
  const messages = [];
  return { messages, automation: new Automation({ store: { data: {}, log: message => messages.push(message) } }) };
}
const account = { id: 'ana', name: 'Ana Julia', handle: 'anajulia' };

test('production identity excludes news creators, commenters and recommendations', async () => {
  for (const author of ['metropolesoficial', 'g1']) {
    const page = fixture('anajulia', author);
    const { automation } = runner();
    const result = await automation.isOwnAccountVideo(page.win, account, page.location.href);
    assert.equal(result.own, false);
    assert.deepEqual(Array.from(result.handles), ['anajulia']);
    assert.equal(result.source, 'session-navigation');
  }
});
test('production identity recognizes own video and falls back only when navigation is unresolved', async () => {
  const page = fixture('anajulia', 'anajulia');
  const { automation } = runner();
  assert.equal((await automation.isOwnAccountVideo(page.win, account, page.location.href)).own, true);
  page.roots = [];
  const result = await automation.isOwnAccountVideo(page.win, account, page.location.href);
  assert.equal(result.own, true); assert.equal(result.source, 'configured-handle');
  const unknown = await automation.isOwnAccountVideo(page.win, { ...account, handle: '' }, page.location.href);
  assert.equal(unknown.own, false); assert.equal(unknown.source, 'unresolved');
});
test('numeric author requires a canonical alias for that exact current video', async () => {
  const page = fixture('anajulia', '7594962761973826580');
  const { automation } = runner();
  assert.equal((await automation.isOwnAccountVideo(page.win, account, page.location.href)).own, false);
  page.canonical.href = 'https://www.tiktok.com/@anajulia/video/123';
  assert.equal((await automation.isOwnAccountVideo(page.win, account, page.location.href)).own, true);
  page.canonical.href = 'https://www.tiktok.com/@anajulia/video/456';
  assert.equal((await automation.isOwnAccountVideo(page.win, account, page.location.href)).own, false);
  page.canonical.href = 'https://untrusted.test/@anajulia/video/123';
  assert.equal((await automation.isOwnAccountVideo(page.win, account, page.location.href)).own, false);
  page.canonical.href = 'https://www.tiktok.com/@anajulia/video/123';
  const videoURL = page.location.href;
  page.location.pathname = '/foryou';
  assert.equal((await automation.isOwnAccountVideo(page.win, account, videoURL)).own, false, 'canonical stale in feed is ignored');
});
test('sessions remain independent and changed login or reopened window cannot reuse old identity', async () => {
  const one = fixture('anajulia', 'anajulia');
  const two = fixture('outra', 'anajulia');
  const { automation } = runner();
  assert.equal((await automation.isOwnAccountVideo(one.win, account, one.location.href)).own, true);
  assert.equal((await automation.isOwnAccountVideo(two.win, account, two.location.href)).own, false);
  one.profile.href = 'https://www.tiktok.com/@outra';
  assert.equal((await automation.isOwnAccountVideo(one.win, account, one.location.href)).own, false);
  one.profile.hidden = true;
  assert.equal((await automation.isOwnAccountVideo(one.win, account, one.location.href)).source, 'configured-handle');
  const reopened = fixture('nova', 'anajulia');
  assert.equal((await automation.isOwnAccountVideo(reopened.win, account, reopened.location.href)).own, false);
});
test('ambiguous navigation falls back to configured handle rather than choosing a creator', async () => {
  const page = fixture('anajulia', 'metropolesoficial');
  const other = fixture('outra');
  page.roots.push(other.navigation);
  const { automation } = runner();
  const result = await automation.isOwnAccountVideo(page.win, account, page.location.href);
  assert.equal(result.source, 'configured-handle'); assert.equal(result.own, false);
});
