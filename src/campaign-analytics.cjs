function campaignAnalytics(data, now = Date.now()) {
  const cutoff = now - 91 * 86400000;
  const buckets = new Map();
  const record = (attempt, platform, kind) => {
    const at = Date.parse(attempt.at);
    if (!Number.isFinite(at) || at < cutoff || at > now || !attempt.accountId) return;
    const hour = Math.floor(at / 3600000) * 3600000;
    const key = `${platform}:${attempt.accountId}:${hour}`;
    if (!buckets.has(key)) buckets.set(key, { platform, accountId: attempt.accountId, hour: new Date(hour).toISOString(), comments: 0, replies: 0, likes: 0, uncertain: 0 });
    buckets.get(key)[kind]++;
  };
  for (const attempt of data.attempts || []) {
    if (attempt.status === 'sent') record(attempt, 'tiktok', 'comments');
    else if (['pending', 'unknown'].includes(attempt.status)) record(attempt, 'tiktok', 'uncertain');
  }
  for (const attempt of data.xAttempts || []) {
    if (attempt.status === 'confirmed' && attempt.action === 'reply') record(attempt, 'x', 'replies');
    else if (attempt.status === 'confirmed' && attempt.action === 'like') record(attempt, 'x', 'likes');
    else if (['pending', 'unknown'].includes(attempt.status)) record(attempt, 'x', 'uncertain');
  }
  return [...buckets.values()].sort((a, b) => b.hour.localeCompare(a.hour));
}
module.exports = { campaignAnalytics };
