(function (scope) {
  const DAY = 86400000, timezone = 'America/Sao_Paulo';
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function parts(at) { return Object.fromEntries(formatter.formatToParts(at).filter(p => p.type !== 'literal').map(p => [p.type, p.value])); }
  function dayKey(at) { const p = parts(at); return `${p.year}-${p.month}-${p.day}`; }
  function midnight(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return NaN;
    const target = Date.parse(`${key}T00:00:00Z`);
    if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== key) return NaN;
    let at = target;
    for (let i = 0; i < 3; i++) { const p = parts(at); at += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); }
    return at;
  }
  function shift(key, days) { return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10); }
  function ranges(period, start, end, now = Date.now()) {
    now = Math.floor(now / 60000) * 60000;
    const today = dayKey(now);
    let from, to = now;
    if (period === 'custom') {
      from = midnight(start); const last = midnight(end);
      if (!Number.isFinite(from) || !Number.isFinite(last) || start > end || end > today) throw new Error('Selecione datas válidas, em ordem e sem dias futuros.');
      to = Math.min(now, midnight(shift(end, 1)));
    } else if (period === 'yesterday') { from = midnight(shift(today, -1)); to = midnight(today); }
    else if (period === '24h') from = now - DAY;
    else if (['today', '7', '30', '90'].includes(period)) from = midnight(shift(today, period === 'today' ? 0 : 1 - Number(period)));
    else throw new Error('Período inválido.');
    if (!(from < to) || to - from > 90 * DAY) throw new Error('Selecione um intervalo válido de até 90 dias.');
    const prior = period === 'today' ? { from: midnight(shift(today, -1)), to: midnight(shift(today, -1)) + to - from } : { from: from - (to - from), to: from };
    return [{ from, to }, prior];
  }
  const api = { DAY, timezone, dayKey, midnight, shift, ranges, hour: at => +parts(at).hour };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else scope.instagramPeriods = api;
})(typeof window === 'undefined' ? globalThis : window);
