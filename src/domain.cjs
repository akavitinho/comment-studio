const { randomUUID } = require('node:crypto');
function text(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label}: preencha até ${max} caracteres.`);
  return value.trim();
}
function number(value, label, min, max) {
  const n = Number(value);
  if (value === '' || !Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: use um inteiro entre ${min} e ${max}.`);
  return n;
}
function proxy(input) {
  const protocol = input.protocol;
  if (!['http', 'https', 'socks5'].includes(protocol)) throw new Error('Protocolo de proxy inválido.');
  const host = text(input.host, 'Servidor', 253).toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') || host.startsWith('.') || host.endsWith('.')) throw new Error('Informe somente o IP ou domínio do proxy, sem URL, caminho ou credenciais.');
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  if (username.length > 512 || password.length > 1024) throw new Error('Credenciais de proxy muito longas.');
  if (password && !username) throw new Error('Informe o usuário do proxy.');
  if (protocol === 'socks5' && (username || password)) throw new Error('Nesta versão, SOCKS5 aceita somente conexão sem usuário e senha.');
  return { id: randomUUID(), name: text(input.name, 'Nome'), protocol, host, port: number(input.port, 'Porta', 1, 65535), username, password };
}
function account(input, proxies) {
  const proxyId = input.proxyId || null;
  if (proxyId && !proxies.some(p => p.id === proxyId)) throw new Error('Proxy não encontrado.');
  const platform = input.platform || 'tiktok';
  if (!['tiktok', 'instagram', 'x'].includes(platform)) throw new Error('Plataforma inválida.');
  return { id: randomUUID(), platform, name: text(input.name, 'Nome da conta'), handle: String(input.handle || '').trim().replace(/^@/, '').slice(0, 80), proxyId, createdAt: new Date().toISOString() };
}
function accountChanges(input, proxies) {
  const proxyId = input.proxyId || null;
  if (proxyId && !proxies.some(p => p.id === proxyId)) throw new Error('Proxy não encontrado.');
  const platform = input.platform || 'tiktok';
  if (!['tiktok', 'instagram', 'x'].includes(platform)) throw new Error('Plataforma inválida.');
  return { platform, name: text(input.name, 'Nome da conta'), handle: String(input.handle || '').trim().replace(/^@/, '').slice(0, 80), proxyId };
}
function campaign(input, accounts) {
  const targetType = input.targetType;
  if (!['hashtag', 'search', 'foryou'].includes(targetType)) throw new Error('Alvo inválido.');
  let target = targetType === 'foryou' ? 'Para você' : text(input.target, 'Hashtag ou busca', 500);
  let targets = [];
  if (targetType === 'hashtag') {
    targets = [...new Set(target.split(/[\s,;]+/).map(item => item.replace(/^#+/, '').trim()).filter(Boolean))];
    if (!targets.length || targets.length > 20 || targets.some(item => !/^[\p{L}\p{N}_]+$/u.test(item))) throw new Error('Informe até 20 hashtags, separadas por vírgula ou uma por linha.');
    target = targets.join(', ');
  } else if (targetType === 'search') {
    targets = [...new Set(target.split(/\r?\n/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    if (!targets.length || targets.length > 20) throw new Error('Informe até 20 buscas, uma palavra ou frase por linha.');
    target = targets.join('\n');
  } else {
    targets = ['Para você'];
  }
  const comments = String(input.comments || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!comments.length || comments.length > 100 || comments.some(s => s.length > 500)) throw new Error('Insira de 1 a 100 frases, com até 500 caracteres por frase. O limite de publicação será validado na integração.');
  const accountIds = Array.isArray(input.accountIds) ? [...new Set(input.accountIds)] : [];
  if (!accountIds.length || accountIds.some(id => !accounts.some(a => a.id === id && (a.platform || 'tiktok') === 'tiktok'))) throw new Error('Selecione pelo menos uma conta TikTok cadastrada.');
  if (targetType === 'foryou' && accountIds.length !== 1) throw new Error('O modo Página principal — Para você usa uma conta por campanha.');
  const waitMin = number(input.waitMin, 'Espera mínima', 1, 3600);
  const waitMax = number(input.waitMax, 'Espera máxima', waitMin, 3600);
  const targetSwitchMin = number(input.targetSwitchMin === undefined ? 15 : input.targetSwitchMin, 'Troca mínima de alvo', 1, 1000);
  const targetSwitchMax = number(input.targetSwitchMax === undefined ? 20 : input.targetSwitchMax, 'Troca máxima de alvo', targetSwitchMin, 1000);
  const legacyInteraction = input.engagementPercent === undefined ? 35 : input.engagementPercent;
  return {
    id: 'draft', name: text(input.name, 'Nome da campanha'), targetType, target, targets, targetSwitchMin, targetSwitchMax, comments, accountIds,
    random: Boolean(input.random), watchSeconds: number(input.watchSeconds, 'Tempo no vídeo', 0, 600),
    waitMin, waitMax, skipPercent: number(input.skipPercent, 'Chance de pular', 0, 100),
    sessionLimit: number(input.sessionLimit, 'Limite da sessão', 1, 10000), hourlyLimit: number(input.hourlyLimit, 'Limite por hora', 1, 1000),
    like: Boolean(input.like), favorite: Boolean(input.favorite),
    likePercent: number(input.likePercent === undefined ? legacyInteraction : input.likePercent, 'Chance de curtir', 0, 100),
    favoritePercent: number(input.favoritePercent === undefined ? legacyInteraction : input.favoritePercent, 'Chance de favoritar', 0, 100),
    updatedAt: new Date().toISOString()
  };
}
module.exports = { proxy, account, accountChanges, campaign };
