const assert = require('node:assert/strict');
const { test } = require('node:test');
const { allowInstagramNotifications } = require('../src/site-permissions.cjs');

test('only Instagram HTTPS notifications receive permission', () => {
  assert.equal(allowInstagramNotifications('notifications', 'https://www.instagram.com/'), true);
  assert.equal(allowInstagramNotifications('notifications', 'https://instagram.com/direct/'), true);
  assert.equal(allowInstagramNotifications('notifications', 'https://other.example/'), false);
  assert.equal(allowInstagramNotifications('notifications', 'https://www.instagram.com.other.example/'), false);
  assert.equal(allowInstagramNotifications('notifications', 'http://www.instagram.com/'), false);
  assert.equal(allowInstagramNotifications('geolocation', 'https://www.instagram.com/'), false);
  assert.equal(allowInstagramNotifications('notifications', ''), false);
});
