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

test('media and clipboard permissions allowed for Instagram Stories', () => {
  assert.equal(allowInstagramNotifications('media', 'https://www.instagram.com/'), true);
  assert.equal(allowInstagramNotifications('clipboard-read', 'https://www.instagram.com/'), true);
  assert.equal(allowInstagramNotifications('clipboard-sanitized-write', 'https://instagram.com/'), true);
  assert.equal(allowInstagramNotifications('fullscreen', 'https://www.instagram.com/stories/'), true);
  assert.equal(allowInstagramNotifications('pointerLock', 'https://www.instagram.com/'), true);
  assert.equal(allowInstagramNotifications('fileSystem', 'https://www.instagram.com/'), true);
  assert.equal(allowInstagramNotifications('storage-access', 'https://www.instagram.com/'), true);
});

test('TikTok receives same permissions as Instagram', () => {
  assert.equal(allowInstagramNotifications('notifications', 'https://www.tiktok.com/'), true);
  assert.equal(allowInstagramNotifications('media', 'https://www.tiktok.com/'), true);
  assert.equal(allowInstagramNotifications('clipboard-read', 'https://tiktok.com/'), true);
  assert.equal(allowInstagramNotifications('geolocation', 'https://www.tiktok.com/'), false);
});

test('unknown permissions still denied for Instagram', () => {
  assert.equal(allowInstagramNotifications('geolocation', 'https://www.instagram.com/'), false);
  assert.equal(allowInstagramNotifications('camera', 'https://www.instagram.com/'), false);
  assert.equal(allowInstagramNotifications('microphone', 'https://www.instagram.com/'), false);
});
