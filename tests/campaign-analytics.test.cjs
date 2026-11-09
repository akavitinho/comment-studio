const test = require('node:test');
const assert = require('node:assert/strict');
const { campaignAnalytics } = require('../src/campaign-analytics.cjs');

test('counts only confirmed campaign actions and keeps uncertain results separate', () => {
  const now = Date.parse('2026-11-05T20:00:00Z');
  const at = '2026-11-05T19:15:00Z';
  const result = campaignAnalytics({
    attempts: [
      { accountId: 't', at, status: 'sent' }, { accountId: 't', at, status: 'unknown' },
      { accountId: 't', at, status: 'not-sent' }
    ],
    xAttempts: [
      { accountId: 'x', at, status: 'confirmed', action: 'reply' },
      { accountId: 'x', at, status: 'confirmed', action: 'like' },
      { accountId: 'x', at, status: 'skipped', action: 'like' },
      { accountId: 'x', at, status: 'unknown', action: 'reply' }
    ]
  }, now);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(row => [row.platform, row.comments, row.replies, row.likes, row.uncertain]), [['tiktok', 1, 0, 0, 1], ['x', 0, 1, 1, 1]]);
});
