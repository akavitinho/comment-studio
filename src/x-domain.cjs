function xCampaign(input, accounts) {
  const integer = (key, min, max, fallback) => {
    const value = input[key] === undefined ? fallback : input[key];
    if (value === '' || value == null || !Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`Valor inválido: ${key} (${min} a ${max}).`);
    return Number(value);
  };
  const targetType = input.targetType || 'hashtag';
  if (!['hashtag', 'search', 'foryou'].includes(targetType)) throw new Error('Origem do X inválida.');
  const hashtags = targetType === 'hashtag' ? [...new Set(String(input.hashtags || '').split(/[,\r\n]+/).map(s => s.trim().replace(/^#+/, '').normalize('NFKC').toLowerCase()).filter(Boolean))] : [];
  if (targetType === 'hashtag' && (!hashtags.length || hashtags.length > 20 || hashtags.some(s => !/^[\p{L}\p{N}_]{1,100}$/u.test(s)))) throw new Error('Informe até 20 hashtags, separadas por vírgula ou linha.');
  const queries = targetType === 'search' ? [...new Set(String(input.queries || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean))] : [];
  if (targetType === 'search' && (!queries.length || queries.length > 20 || queries.some(s => s.length > 500))) throw new Error('Informe até 20 palavras ou frases, uma busca por linha, com até 500 caracteres cada.');
  if (!['like', 'reply', 'both'].includes(input.mode)) throw new Error('Modo do X inválido.');
  if (!['latest', 'top'].includes(input.search)) throw new Error('Ordenação inválida.');
  const accountIds = [...new Set(Array.isArray(input.accountIds) ? input.accountIds : [])];
  if (!accountIds.length || accountIds.some(id => !accounts.some(a => a.id === id && a.platform === 'x'))) throw new Error('Selecione contas do X cadastradas.');
  const comments = [...new Set(String(input.comments || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
  if ((input.mode !== 'like' && !comments.length) || comments.length > 100 || comments.some(s => [...s].length > 280)) throw new Error('Use de 1 a 100 respostas, com até 280 caracteres cada.');
  const waitMin = integer('waitMin', 1, 3600);
  const targetSwitchMin = targetType === 'foryou' ? 20 : integer('targetSwitchMin', 1, 1000, 20);
  const targetSwitchMax = targetType === 'foryou' ? 20 : integer('targetSwitchMax', targetSwitchMin, 1000, 20);
  return { mode: input.mode, search: targetType === 'search' ? 'top' : input.search, targetType, hashtags, queries, accountIds, comments,
    targetSwitchMin, targetSwitchMax,
    recent: Boolean(input.recent), maxAgeMinutes: input.recent ? integer('maxAgeMinutes', 1, 10080) : 50,
    waitMin, waitMax: integer('waitMax', waitMin, 3600), hourlyLimit: integer('hourlyLimit', 1, 1000),
    sessionLimit: integer('sessionLimit', 1, 10000), updatedAt: new Date().toISOString() };
}
function postKey(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['x.com', 'www.x.com'].includes(u.hostname) ? u.pathname.match(/^\/\w+\/status\/(\d+)\/?$/)?.[1] || null : null; } catch { return null; }
}
function searchURL(tag, order, targetType = 'hashtag') { return targetType === 'foryou' ? 'https://x.com/home' : `https://x.com/search?q=${encodeURIComponent(targetType === 'search' ? `${tag} filter:media` : '#' + tag)}&src=typed_query${targetType !== 'search' && order === 'latest' ? '&f=live' : ''}`; }
function xTargets(config) { return config.targetType === 'foryou' ? ['Para você'] : config.targetType === 'search' ? config.queries : config.hashtags; }
function eligible(post, handle, config, now = Date.now()) {
  if (!postKey(post.url) || post.ad || !handle || post.author.toLowerCase() === handle.toLowerCase()) return false;
  const time = Date.parse(post.at);
  return !config.recent || (Number.isFinite(time) && time <= now && now - time <= config.maxAgeMinutes * 60000);
}
class ReplyBag {
  constructor(comments, random = Math.random) { this.comments = comments; this.random = random; this.bag = []; this.last = null; }
  next() {
    if (!this.bag.length) {
      this.bag = [...this.comments];
      for (let i = this.bag.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; }
      if (this.bag.length > 1 && this.bag[this.bag.length - 1] === this.last) [this.bag[0], this.bag[this.bag.length - 1]] = [this.bag[this.bag.length - 1], this.bag[0]];
    }
    return this.last = this.bag.pop();
  }
}
module.exports = { xCampaign, postKey, searchURL, xTargets, eligible, ReplyBag };
