const test = require('node:test');
const assert = require('node:assert/strict');
const { hourlyLeaders, seriesBuckets, publicationBuckets, comparisonRange, comparisonVariation } = require('../src/ui/dashboard-analytics.js');

test('percentage variation requires a positive comparable baseline', () => {
  assert.equal(comparisonVariation(24, 18).toFixed(1), '33.3');
  assert.equal(comparisonVariation(0, 18), -100);
  assert.equal(comparisonVariation(24, 0), null);
  assert.equal(comparisonVariation(null, 18), null);
});

test('today compares the same local hours yesterday; other periods use the preceding duration', () => {
  const today = { from: +new Date(2026, 10, 7, 0), to: +new Date(2026, 10, 7, 10, 30) };
  assert.deepEqual(comparisonRange(today, 'today'), { from: +new Date(2026, 10, 6, 0), to: +new Date(2026, 10, 6, 10, 30) });
  const yesterday = { from: +new Date(2026, 10, 6, 0), to: +new Date(2026, 10, 6, 23, 59, 59, 999) };
  assert.deepEqual(comparisonRange(yesterday, 'yesterday'), { from: yesterday.from - 86400000, to: yesterday.from - 1 });
  assert.deepEqual(comparisonRange(today, 'today', '2026-11-01T08:00', '2026-11-01T12:00'), {
    from: +new Date(2026, 10, 1, 8), to: +new Date(2026, 10, 1, 12)
  });
});

test('counts only confirmed Reels in their publication bucket and selected period', () => {
  const at = hour => new Date(2026, 10, 5, hour, 10).toISOString();
  const items = [
    { status: 'published', published_at: at(9) },
    { status: 'published', published_at: at(9) },
    { status: 'published', published_at: at(10) },
    { status: 'queued', published_at: at(9) },
    { status: 'published', published_at: at(8) },
    { status: 'published', published_at: 'invalid' }
  ];
  assert.deepEqual(publicationBuckets(items, { from: Date.parse(at(9)), to: Date.parse(at(10)) }, '1'), [
    [+new Date(2026, 10, 5, 9), 2],
    [+new Date(2026, 10, 5, 10), 1]
  ]);
});

test('hourly chart keeps measured zero, skips missing metrics and does not distribute a gain to earlier buckets', () => {
  const at = hour => new Date(2026, 10, 5, hour, 10).toISOString();
  const points = [{ fetched_at: at(7), views: 10 }, { fetched_at: at(8), views: 20 },
    { fetched_at: at(9), views: null }, { fetched_at: at(10), views: 20 }, { fetched_at: at(11), views: 34 }];
  const range = { from: Date.parse(at(8)), to: Date.parse(at(11)) };
  assert.deepEqual(seriesBuckets([points], 'views', range, '1'), [
    [+new Date(2026, 10, 5, 10), 0],
    [+new Date(2026, 10, 5, 11), 14]
  ]);
});

test('ranks accounts by observed view growth in the hour of the final reading', () => {
  const series = [
    { platform: 'instagram', accountId: 'a', accountName: '@ana', videoId: 'v1', videoTitle: 'Reel A', points: [
      { fetched_at: '2026-11-05T18:10:00Z', views: 10 }, { fetched_at: '2026-11-05T19:05:00Z', views: 45 }
    ] },
    { platform: 'instagram', accountId: 'b', accountName: '@bia', videoId: 'v2', videoTitle: 'Reel B', points: [
      { fetched_at: '2026-11-05T18:12:00Z', views: 5 }, { fetched_at: '2026-11-05T19:08:00Z', views: 80 }
    ] }
  ];
  const hours = hourlyLeaders(series, Date.parse('2026-11-05T18:00:00Z'), Date.parse('2026-11-05T20:00:00Z'));
  assert.equal(hours.length, 1);
  assert.equal(hours[0].total, 110);
  assert.deepEqual(hours[0].accounts.map(account => [account.name, account.views]), [['@bia', 75], ['@ana', 35]]);
  assert.equal(hours[0].videos[0].title, 'Reel B');
  assert.equal(hours[0].earliest, Date.parse('2026-11-05T18:10:00Z'));
});

test('does not invent hourly growth from one reading, unavailable metrics or long gaps', () => {
  const make = (id, points) => ({ platform: 'instagram', accountId: id, accountName: id, videoId: id, videoTitle: id, points });
  const series = [
    make('single', [{ fetched_at: '2026-11-05T19:00:00Z', views: 40 }]),
    make('missing', [{ fetched_at: '2026-11-05T18:00:00Z', views: null }, { fetched_at: '2026-11-05T19:00:00Z', views: 10 }]),
    make('gap', [{ fetched_at: '2026-11-04T18:00:00Z', views: 0 }, { fetched_at: '2026-11-05T19:00:00Z', views: 100 }]),
    make('reset', [{ fetched_at: '2026-11-05T18:00:00Z', views: 20 }, { fetched_at: '2026-11-05T19:00:00Z', views: 10 }])
  ];
  assert.equal(hourlyLeaders(series, Date.parse('2026-11-05T18:00:00Z'), Date.parse('2026-11-05T20:00:00Z')).length, 0);
});

test('keeps Instagram and TikTok leaders separate in the all-platform view', () => {
  const points = [{ fetched_at: '2026-11-05T18:00:00Z', views: 10 }, { fetched_at: '2026-11-05T19:00:00Z', views: 25 }];
  const series = ['instagram', 'tiktok'].map(platform => ({ platform, accountId: platform, accountName: platform, videoId: 'v', videoTitle: 'Vídeo', points }));
  const hours = hourlyLeaders(series, Date.parse('2026-11-05T18:00:00Z'), Date.parse('2026-11-05T20:00:00Z'));
  assert.equal(hours.length, 2);
  assert.deepEqual(hours.map(hour => hour.platform).sort(), ['instagram', 'tiktok']);
  assert.equal(hours.every(hour => hour.total === 15), true);
});
