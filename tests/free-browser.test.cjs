const test = require('node:test');
const assert = require('node:assert/strict');
const { destination } = require('../src/free-browser.cjs');

test('free browser accepts searches and HTTPS addresses', () => {
  assert.equal(destination(''), 'https://www.google.com/');
  assert.equal(destination('instagram.com'), 'https://instagram.com/');
  assert.equal(destination('https://www.instagram.com/accounts/login/'), 'https://www.instagram.com/accounts/login/');
  assert.equal(destination('minha conta instagram'), 'https://www.google.com/search?q=minha%20conta%20instagram');
  assert.throws(() => destination('https://user:password@example.com'), /inválido/);
});
