const test = require('node:test');
const assert = require('node:assert/strict');
const { hourlyLeaders, seriesBuckets, publicationBuckets, instagramHourlyActivity, comparisonRange, comparisonVariation, officialAggregate, officialDisplayRange } = require('../src/ui/dashboard-analytics.js');

test('Instagram hourly activity keeps real posting hours and only measured Reel gains', () => {
  const at = (day, hour) => new Date(2026, 10, day, hour, 10).toISOString();
  const items = [
    { id: 'one', account_id: 'ig', status: 'published', published_at: at(5, 9) },
    { id: 'two', account_id: 'ig', status: 'published', published_at: at(5, 9) },
    { id: 'other', account_id: 'other', status: 'published', published_at: at(5, 10) }
  ];
  const history = [
    { item_id: 'one', fetched_at: at(4, 23), views: 10 },
    { item_id: 'one', fetched_at: at(5, 10), views: 15 },
    { item_id: 'one', fetched_at: at(5, 11), views: 15 },
    { item_id: 'two', fetched_at: at(5, 10), views: 8 },
    { item_id: 'other', fetched_at: at(5, 9), views: 1 },
    { item_id: 'other', fetched_at: at(5, 10), views: 100 }
  ];
  const result = instagramHourlyActivity(items, history, ['ig'], +new Date(2026, 10, 5), +new Date(2026, 10, 6));
  assert.equal(result[9].published, 2);
  assert.equal(result[9].views, null);
  assert.equal(result[10].views, 5);
  assert.equal(result[11].views, 0);
  assert.equal(result[11].intervals, 1);
  assert.equal(result.reduce((total, hour) => total + hour.published, 0), 2);
});

test('today does not relabel yesterday after the local day changes', () => {
  const day = 86400000, current = { from: day, to: day + 3600000 }, prior = { from: 0, to: 3600000 };
  const rows = ['a', 'b'].map(account_id => ({ account_id, metric: 'views', start_at: 0, end_at: day, value: 10 }));
  assert.deepEqual(officialDisplayRange(rows, ['a', 'b'], current, prior, 'today', '1970-1-2'), {
    current, prior, cached: false
  });
  assert.equal(officialAggregate(rows, ['a', 'b'], current, 'views').value, null);
  rows.push({ account_id: 'a', metric: 'views', start_at: day, end_at: current.to, value: 2 });
  assert.deepEqual(officialDisplayRange(rows, ['a', 'b'], current, prior, 'today', '1970-1-2'), { current, prior, cached: false });
  rows.push({ account_id: 'b', metric: 'views', start_at: day, end_at: current.to, value: 3 });
  assert.deepEqual(officialDisplayRange(rows, ['a', 'b'], current, prior, 'today', '1970-1-2'), { current, prior, cached: false });
});

test('today shows the last UTC collection when it is still the same local day', () => {
  const day = 86400000;
  const current = { from: Date.UTC(2026, 10, 11), to: Date.UTC(2026, 10, 11, 1, 21) };
  const prior = { from: current.from - day, to: current.to - day };
  const rows = ['a', 'b'].map(account_id => ({ account_id, metric: 'views', start_at: prior.from, end_at: current.from, value: account_id === 'a' ? 20 : 30, fetched_at: current.to - 60000 }));
  const display = officialDisplayRange(rows, ['a', 'b', 'c'], current, prior, 'today', '2026-11-10');
  assert.deepEqual(display, { current: { from: prior.from, to: current.from }, prior: { from: prior.from - day, to: prior.from }, cached: true });
  assert.deepEqual(officialAggregate(rows, ['a', 'b', 'c'], display.current, 'views', true), {
    value: null, partialValue: 50, count: 2, latest: [current.to - 60000, current.to - 60000]
  });
  assert.deepEqual(officialDisplayRange(rows, ['a', 'b', 'c'], current, prior, 'today', '2026-11-11'), { current, prior, cached: false });
  rows.push({ account_id: 'a', metric: 'views', start_at: current.from, end_at: current.to, value: 5 });
  assert.deepEqual(officialDisplayRange(rows, ['a', 'b', 'c'], current, prior, 'today', '2026-11-10'), { current, prior, cached: false });
});

test('today sums the latest reading of each account even when collection times differ', () => {
  const day = 86400000, current = { from: day, to: day + 3600000 };
  const rows = [
    { account_id: 'a', metric: 'views', start_at: 0, end_at: day, value: 900, fetched_at: day },
    { account_id: 'a', metric: 'views', start_at: day, end_at: day + 1200000, value: 10, fetched_at: day + 1200000 },
    { account_id: 'a', metric: 'views', start_at: day, end_at: day + 2400000, value: 25, fetched_at: day + 2400000 },
    { account_id: 'b', metric: 'views', start_at: day, end_at: day + 2100000, value: 15, fetched_at: day + 2100000 },
    { account_id: 'b', metric: 'views', start_at: day, end_at: day + 4200000, value: 30, fetched_at: day + 4200000 }
  ];
  assert.deepEqual(officialAggregate(rows, ['a', 'b'], current, 'views', true), {
    value: 40, partialValue: 40, count: 2, latest: [day + 2400000, day + 2100000]
  });
  assert.equal(officialAggregate(rows, ['a', 'b', 'c'], current, 'views', true).value, null);
  assert.equal(officialAggregate(rows, ['a', 'b', 'c'], current, 'views', true).partialValue, 40);
});

test('official dashboard prefers a recent complete seven-day collection to an old single day', () => {
  const day = 86400000, current = { from: 7 * day, to: 13 * day + 3600000 };
  const rows = ['a', 'b'].flatMap(account_id => [
    { account_id, metric: 'views', start_at: 6 * day, end_at: 13 * day, value: 40 },
    { account_id, metric: 'views', start_at: 7 * day, end_at: 8 * day, value: 5 }
  ]);
  assert.deepEqual(officialDisplayRange(rows, ['a', 'b'], current, { from: 0, to: 7 * day }, '7').current, { from: 6 * day, to: 13 * day });
});

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
