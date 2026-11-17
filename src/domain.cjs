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
function accountTags(value) {
  if (value === undefined || value === null || value === '') return [];
  const raw = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(raw) || raw.some(tag => typeof tag !== 'string')) throw new Error('Informe as tags separadas por vírgula.');
  const tags = [];
  const seen = new Set();
  for (const entry of raw) {
    const tag = entry.trim().replace(/^#/, '').replace(/\s+/g, ' ');
    if (!tag) continue;
    if (tag.length > 40 || /[\u0000-\u001f\u007f,]/.test(tag)) throw new Error('Cada tag deve ter até 40 caracteres e não pode conter vírgula.');
    const key = tag.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) continue;
    seen.add(key); tags.push(tag);
    if (tags.length > 12) throw new Error('Adicione no máximo 12 tags por conta.');
  }
  return tags;
}
function accountTagDefinition(input) {
  const names = accountTags([input?.name]);
  if (names.length !== 1) throw new Error('Informe o nome da tag.');
  const color = String(input?.color || '');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Escolha uma cor válida para a tag.');
  return { name: names[0], color: color.toLowerCase() };
}
function postingConnection(value, proxyId) {
  const mode = value === undefined || value === null || value === '' ? (proxyId ? 'proxy' : 'direct') : value;
  if (!['proxy', 'direct'].includes(mode) || (mode === 'proxy' && !proxyId)) throw new Error('Escolha uma conexão de publicação válida para esta conta.');
  return mode;
}
function postingProxy(account, proxies) {
  if (postingConnection(account.postingConnection, account.proxyId) === 'direct') return null;
  const proxy = proxies.find(item => item.id === account.proxyId);
  if (!proxy) throw new Error('A proxy de publicação desta conta não foi encontrada.');
  return proxy;
}
function account(input, proxies) {
  const proxyId = input.proxyId || null;
  if (proxyId && !proxies.some(p => p.id === proxyId)) throw new Error('Proxy não encontrado.');
  const platform = input.platform || 'tiktok';
  if (!['tiktok', 'instagram', 'facebook', 'x'].includes(platform)) throw new Error('Plataforma inválida.');
  const id = randomUUID();
  const requestedName = String(input.name || '').trim();
  const handle = String(input.handle || '').trim().replace(/^@/, '').slice(0, 80);
  const nameAuto = platform === 'instagram' && (!requestedName || (handle && requestedName === handle) || /^(?:conta\d+|\d{1,3})$/i.test(requestedName));
  const name = nameAuto && !requestedName ? `Instagram ${id.slice(0, 8)}` : text(input.name, 'Nome da conta');
  return { id, platform, name, nameAuto, handle, proxyId, postingConnection: postingConnection(input.postingConnection, proxyId), tags: accountTags(input.tags), createdAt: new Date().toISOString() };
}
function accountChanges(input, proxies) {
  const proxyId = input.proxyId || null;
  if (proxyId && !proxies.some(p => p.id === proxyId)) throw new Error('Proxy não encontrado.');
  const platform = input.platform || 'tiktok';
  if (!['tiktok', 'instagram', 'facebook', 'x'].includes(platform)) throw new Error('Plataforma inválida.');
  return { platform, name: text(input.name, 'Nome da conta'), handle: String(input.handle || '').trim().replace(/^@/, '').slice(0, 80), proxyId, postingConnection: postingConnection(input.postingConnection, proxyId), ...(Object.hasOwn(input, 'tags') ? { tags: accountTags(input.tags) } : {}) };
}
function applyInstagramIdentity(account, username) {
  if (account.platform !== 'instagram' || typeof username !== 'string' || !/^[A-Za-z0-9._]{1,80}$/.test(username)) throw new Error('O Instagram retornou um usuário inválido.');
  const previousHandle = account.handle;
  const legacyName = account.nameAuto === undefined && ((previousHandle && account.name === previousHandle) || /^(?:conta\d+|\d{1,3})$/i.test(account.name));
  const followsHandle = Boolean(account.nameAuto || legacyName);
  account.handle = username;
  if (followsHandle) { account.name = username; account.nameAuto = true; }
  return account;
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
module.exports = { proxy, account, accountChanges, postingConnection, postingProxy, applyInstagramIdentity, accountTags, accountTagDefinition, campaign };
