(function (scope) {
  function hourlyLeaders(series, from, to, maxGapHours = 1.5) {
    const hours = new Map();
    for (const entry of series) {
      const points = [...entry.points].sort((a, b) => Date.parse(a.fetched_at) - Date.parse(b.fetched_at));
      for (let index = 1; index < points.length; index++) {
        const first = points[index - 1], last = points[index];
        const start = Date.parse(first.fetched_at), end = Date.parse(last.fetched_at);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < from || end > to || (end - start) > maxGapHours * 3600000) continue;
        if (first.views == null || last.views == null || !Number.isFinite(Number(first.views)) || !Number.isFinite(Number(last.views))) continue;
        const gain = Number(last.views) - Number(first.views);
        if (gain < 0) continue;
        const hour = new Date(end); hour.setMinutes(0, 0, 0);
        const key = `${entry.platform}:${hour.getTime()}`;
        if (!hours.has(key)) hours.set(key, { platform: entry.platform, at: hour.getTime(), total: 0, accounts: new Map(), videos: new Map(), intervals: 0, earliest: start, latest: end });
        const bucket = hours.get(key);
        bucket.total += gain; bucket.intervals++; bucket.earliest = Math.min(bucket.earliest, start); bucket.latest = Math.max(bucket.latest, end);
        const accountKey = `${entry.platform}:${entry.accountId}`;
        const account = bucket.accounts.get(accountKey) || { id: entry.accountId, name: entry.accountName, platform: entry.platform, views: 0 };
        account.views += gain; bucket.accounts.set(accountKey, account);
        const videoKey = `${accountKey}:${entry.videoId}`;
        const video = bucket.videos.get(videoKey) || { id: entry.videoId, title: entry.videoTitle, accountId: entry.accountId, platform: entry.platform, views: 0 };
        video.views += gain; bucket.videos.set(videoKey, video);
      }
    }
    return [...hours.values()].sort((a, b) => b.at - a.at).map(bucket => ({
      ...bucket,
      accounts: [...bucket.accounts.values()].sort((a, b) => b.views - a.views),
      videos: [...bucket.videos.values()].sort((a, b) => b.views - a.views)
    }));
  }
  function observedChanges(points, metric, { from, to }) {
    const readings = points.map(point => ({ at: Date.parse(point.fetched_at), value: point[metric] }))
      .filter(({ at, value }) => at >= from && at <= to && value != null && Number.isFinite(Number(value)))
      .sort((a, b) => a.at - b.at);
    const changes = [];
    for (let i = 1; i < readings.length; i++) {
      const previous = readings[i - 1], current = readings[i];
      if (current.at <= previous.at || Number(current.value) < Number(previous.value)) continue;
      changes.push({ at: current.at, from: previous.at, value: current.value - previous.value });
    }
    return changes;
  }
  function bucketTime(at, group) {
    const date = new Date(at);
    date.setMinutes(0, 0, 0);
    if (group === 'week') {
      date.setHours(0);
      date.setDate(date.getDate() - (date.getDay() + 6) % 7);
    } else {
      const hours = Number(group);
      date.setHours(Math.floor(date.getHours() / hours) * hours);
    }
    return +date;
  }
  function seriesBuckets(series, metric, dates, group) {
    const buckets = new Map();
    for (const points of series) for (const change of observedChanges(points, metric, dates)) {
      const key = bucketTime(change.at, group);
      buckets.set(key, (buckets.get(key) || 0) + change.value);
    }
    return [...buckets].sort((a, b) => a[0] - b[0]);
  }
  function publicationBuckets(items, dates, group) {
    const buckets = new Map();
    for (const item of items) {
      const at = Date.parse(item.published_at);
      if (item.status !== 'published' || !Number.isFinite(at) || at < dates.from || at > dates.to) continue;
      const key = bucketTime(at, group);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return [...buckets].sort((a, b) => a[0] - b[0]);
  }
  function comparisonRange(dates, period, customFrom, customTo) {
    const from = Date.parse(customFrom || ''), to = Date.parse(customTo || '');
    if (Number.isFinite(from) && Number.isFinite(to) && from <= to) return { from, to };
    if (period === 'today') {
      const start = new Date(dates.from), end = new Date(dates.to);
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      return { from: +start, to: +end };
    }
    const duration = dates.to - dates.from + 1;
    return { from: dates.from - duration, to: dates.from - 1 };
  }
  function comparisonVariation(current, previous) {
    return Number.isFinite(current) && Number.isFinite(previous) && previous > 0 ? (current - previous) / previous * 100 : null;
  }
  function accountDailySummary(rows, ids, from, to, reels = false) {
    const day = 86400000, days = [];
    const selected = rows.filter(row => ids.includes(row.account_id));
    for (let at = from; at <= to; at += day) {
      const entries = selected.filter(row => row.start_at === at && (!reels || row.reels != null));
      const value = entries.length ? entries.reduce((sum, row) => sum + (reels ? row.reels : row.views), 0) : null;
      const complete = ids.length > 0 && entries.length === ids.length && entries.every(row => row.end_at >= at + day && row.fetched_at >= at + day);
      days.push({ at, value, coverage: entries.length, complete });
    }
    const known = days.filter(entry => entry.value != null);
    const total = known.length ? known.reduce((sum, entry) => sum + entry.value, 0) : null;
    const complete = days.length > 0 && days.every(entry => entry.complete);
    const before = selected.filter(row => row.start_at >= from - days.length * day && row.start_at < from);
    const beforeComplete = before.length === ids.length * days.length && before.every(row => row.end_at >= row.start_at + day && row.fetched_at >= row.start_at + day && (!reels || row.reels != null));
    const previous = before.reduce((sum, row) => sum + (reels ? row.reels : row.views), 0);
    return { days, total, complete, delta: complete && beforeComplete ? comparisonVariation(total, previous) : null };
  }
  function officialAggregate(rows, ids, range, key) {
    const entries=ids.map(id=>rows.find(row=>row.account_id===id&&row.start_at===range.from&&row.end_at===range.to&&row.metric===key&&row.value!=null&&Number.isFinite(Number(row.value))));
    const valid=entries.filter(Boolean);
    const partialValue=valid.length?valid.reduce((sum,row)=>sum+Number(row.value),0):null;
    return { value:ids.length&&valid.length===ids.length?partialValue:null,partialValue,count:valid.length,latest:valid.map(row=>row.fetched_at) };
  }
  function officialDisplayRange(rows, ids, current, prior, period) {
    const views=rows.filter(row=>ids.includes(row.account_id)&&row.metric==='views'&&row.start_at===current.from&&row.end_at<=current.to);
    const ends=[...new Set(views.map(row=>row.end_at))].sort((a,b)=>b-a);
    const complete=ends.find(end=>ids.length&&ids.every(id=>views.some(row=>row.account_id===id&&row.end_at===end)));
    const end=complete||ends[0]||current.to;
    const shown={from:current.from,to:end};
    const shownPrior=end===current.to?prior:period==='today'?{from:shown.from-86400000,to:end-86400000}:{from:shown.from-(end-shown.from),to:shown.from};
    return { current:shown, prior:shownPrior, cached:end!==current.to };
  }
  const api = { hourlyLeaders, observedChanges, seriesBuckets, publicationBuckets, bucketTime, comparisonRange, comparisonVariation, accountDailySummary, officialAggregate, officialDisplayRange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.dashboardAnalytics = api;
})(typeof window === 'undefined' ? globalThis : window);
