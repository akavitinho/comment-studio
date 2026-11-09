const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const backgroundInput = require('./background-input.cjs');
const pageControls = require('./page-controls.cjs');
const { commentOpenPoint, clickCommentTab, inspectIdentity, inspectVideoAliases } = pageControls;
const pagePrelude = Object.entries(pageControls).map(([name, fn]) => `const ${name} = ${fn.toString()};`).join('\n');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function videoKey(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/@[^/]+\/video\/(\d+)(?:\/)?$/);
    return url.protocol === 'https:' && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && match ? match[1] : null;
  } catch { return null; }
}
function videoAuthor(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/@([^/]+)\/video\/\d+(?:\/)?$/);
    return url.protocol === 'https:' && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}
function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@+/, '').normalize('NFKC').toLocaleLowerCase();
}
function isOwnVideo(url, handles) {
  const author = normalizeHandle(videoAuthor(url));
  return Boolean(author) && handles.some(handle => normalizeHandle(handle) === author);
}
function campaignTargets(campaign) {
  if (campaign.targetType === 'foryou') return [campaign.target];
  if (Array.isArray(campaign.targets) && campaign.targets.length) return campaign.targets;
  if (campaign.targetType === 'search') return String(campaign.target || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  return String(campaign.target || '').split(/[\s,;]+/).map(item => item.replace(/^#+/, '')).filter(Boolean);
}
function targetURL(campaign, targetIndex = 0) {
  const target = campaignTargets(campaign)[targetIndex] || campaignTargets(campaign)[0] || campaign.target;
  return campaign.targetType === 'foryou'
    ? 'https://www.tiktok.com/foryou'
    : campaign.targetType === 'hashtag'
    ? `https://www.tiktok.com/tag/${encodeURIComponent(target)}`
    : `https://www.tiktok.com/search/video?q=${encodeURIComponent(target)}`;
}
function discoverVideos(sourceURL) {
  const expected = new URL(sourceURL);
  const actual = new URL(location.href);
  const path = value => value.replace(/\/$/, '');
  if (actual.origin !== expected.origin || path(actual.pathname) !== path(expected.pathname)
    || (expected.pathname.startsWith('/search') && actual.searchParams.get('q') !== expected.searchParams.get('q'))) {
    throw new Error('A página saiu da hashtag ou busca selecionada. Nenhum vídeo foi coletado.');
  }
  // Collect only result cards, never links from the video viewer or its sidebar.
  const selector = expected.pathname.startsWith('/tag/')
    ? '[data-e2e="challenge-item"], [data-e2e="challenge-item-list"], [data-e2e="challenge-item-list-container"]'
    : expected.pathname === '/search' || expected.pathname === '/search/video'
    ? '[data-e2e="search_top-item"], [data-e2e="search-video-item"], [data-e2e="search_video-item"], [data-e2e="search-video-container"]'
    : '[data-e2e="recommend-list-item-container"]';
  const excluded = 'aside, nav, [role="dialog"], [data-e2e="browse-video"], [data-e2e="related-video"], [class*="DivBrowserModeContainer"], [class*="DivRecommendList"]';
  const links = [];
  const cards = [...document.querySelectorAll(selector)];
  for (const card of cards) {
    if (card.closest(excluded)) continue;
    for (const anchor of card.querySelectorAll('a[href*="/video/"]')) {
      if (anchor.closest(excluded) || !anchor.getClientRects().length) continue;
      const style = getComputedStyle(anchor);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      links.push(anchor.href);
    }
  }
  const empty = [...document.querySelectorAll('[data-e2e="search-empty"], [data-e2e="challenge-empty"], [role="status"]')].some(node => /no results|nenhum resultado|no videos|nenhum vídeo/i.test(node.textContent || ''));
  return { urls: [...new Set(links)].slice(0, 100), recognized: links.length > 0 || empty, empty };
}
function scrollPage() { window.scrollBy(0, Math.max(window.innerHeight, 700)); }
function searchResultPoint(url) {
  const id = new URL(url).pathname.match(/\/video\/(\d+)/)?.[1];
  const cards = document.querySelectorAll('[data-e2e="search_top-item"], [data-e2e="search-video-item"], [data-e2e="search_video-item"], [data-e2e="search-video-container"]');
  for (const card of cards) {
    if (card.closest('aside, nav, [role="dialog"], [data-e2e="browse-video"], [class*="DivBrowserModeContainer"]')) continue;
    for (const link of card.querySelectorAll('a[href*="/video/"]')) {
      if (new URL(link.href).pathname.match(/\/video\/(\d+)/)?.[1] !== id) continue;
      link.scrollIntoView({ block: 'center', behavior: 'instant' });
      if (!pageVisible(link)) continue;
      const r = link.getBoundingClientRect();
      return { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) };
    }
  }
  return null;
}
function trackPlayback() {
  const videos = [...document.querySelectorAll('video')].map(video => {
    const r = video.getBoundingClientRect();
    return { video, area: Math.max(0, Math.min(r.right, innerWidth) - Math.max(0, r.left)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(0, r.top)) };
  }).filter(item => item.area > 0).sort((a, b) => b.area - a.area);
  const video = videos[0]?.video;
  if (!video) return false;
  const previous = window.__commentStudioPlayback;
  if (previous?.video === video && previous.path === location.pathname) return true;
  if (typeof previous?.cleanup === 'function') previous.cleanup();
  const state = { video, path: location.pathname, completed: video.ended, lastTime: video.currentTime };
  const complete = () => { state.completed = true; video.pause(); };
  const observe = () => {
    const wrapped = Number.isFinite(video.duration) && state.lastTime >= video.duration - 1.5 && video.currentTime < state.lastTime - 1;
    if (video.ended || wrapped) complete();
    state.lastTime = video.currentTime;
  };
  video.loop = false;
  video.addEventListener('ended', complete);
  video.addEventListener('timeupdate', observe);
  state.cleanup = () => { video.removeEventListener('ended', complete); video.removeEventListener('timeupdate', observe); };
  window.__commentStudioPlayback = state;
  return true;
}
function playbackFinished() {
  const state = window.__commentStudioPlayback;
  return Boolean(state && state.path === location.pathname && (state.completed || state.video.ended));
}
function activeFeedVideo() {
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const item = [...document.querySelectorAll('video')]
    .filter(visible)
    .map(video => ({ video, rect: video.getBoundingClientRect() }))
    .map(item => ({ ...item, area: Math.max(0, Math.min(item.rect.right, innerWidth) - Math.max(item.rect.left, 0)) * Math.max(0, Math.min(item.rect.bottom, innerHeight) - Math.max(item.rect.top, 0)) }))
    .filter(item => item.area > 0)
    .sort((a, b) => b.area - a.area)[0];
  if (!item) return { ready: false, url: null };
  const video = item.video;
  const scope = video.closest('[data-e2e="recommend-list-item-container"], article, [class*="DivItemContainer"], [class*="DivVideoContainer"], [class*="DivBrowserModeContainer"]') || video.parentElement?.parentElement;
  const direct = video.closest('a[href*="/video/"]') || scope?.querySelector('a[href*="/video/"]');
  const candidates = direct ? [direct] : [...document.querySelectorAll('a[href*="/video/"]')];
  const anchor = candidates.find(link => {
    if (direct === link) return true;
    const parent = link.closest('[data-e2e="recommend-list-item-container"], article, [class*="DivItemContainer"], [class*="DivVideoContainer"], [class*="DivBrowserModeContainer"]');
    if (scope && parent === scope) return true;
    const rect = link.getBoundingClientRect();
    return rect.left < item.rect.right && rect.right > item.rect.left && rect.top < item.rect.bottom && rect.bottom > item.rect.top;
  });
  const current = /\/@[^/]+\/video\/\d+/.test(location.pathname) ? location.href : null;
  return { ready: true, url: current || anchor?.href };
}
function nextFeedPoint() {
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const exact = [...document.querySelectorAll('button[data-e2e="arrow-down"], button[data-e2e="browse-next"], button[data-e2e*="next-video" i]')].find(visible);
  const semantic = exact || [...document.querySelectorAll('button,[role="button"]')].find(element => {
    if (!visible(element)) return false;
    const hint = `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`.toLocaleLowerCase();
    return /(next|down|próximo|seguinte|baixo)/.test(hint);
  });
  if (!semantic) return null;
  const rect = semantic.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}
function inspectVideo(allowFeed = false) {
  const { editor, post, tab, disabled } = commentControls();
  const editorReady = Boolean(editor && exposeControl(editor));
  const feedVideo = allowFeed && [...document.querySelectorAll('video')].some(video => {
    const rect = video.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const video = /\/@[^/]+\/video\/\d+/.test(location.pathname) || feedVideo;
  const reason = !video ? 'O vídeo esperado não está aberto.'
    : !tab && !editorReady ? 'A aba Comentários não foi encontrada.'
    : tab?.getAttribute('aria-selected') === 'false' && !editorReady ? 'A aba Comentários não abriu.'
    : !editorReady ? 'O campo de comentário não ficou visível.' : null;
  return { origin: location.origin, editor: editorReady, post: Boolean(post), disabled, reason, login: Boolean(document.querySelector('a[href*="/login"]')), video };
}
function inspectSkippableContent() {
  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const active = [...document.querySelectorAll('video')]
    .filter(visible)
    .map(video => ({ video, rect: video.getBoundingClientRect() }))
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.video;
  const scope = active?.closest('[data-e2e="recommend-list-item-container"], article, [class*="DivItemContainer"], [class*="DivVideoContainer"], [class*="DivBrowserModeContainer"]') || active?.parentElement?.parentElement;
  const lines = String(scope?.innerText || '').split(/\r?\n/).map(line => line.trim().toLocaleLowerCase()).filter(Boolean);
  const pathname = String(location.pathname || '').toLowerCase();
  const liveBadge = Boolean(scope?.querySelector('[data-e2e*="live" i], [class*="live-badge" i], a[href$="/live"], a[href*="/live?"]'));
  const isLive = /\/live(?:\/|$)/.test(pathname) || (liveBadge && lines.some(line => /^(live|ao vivo|en vivo)$/.test(line)));
  const adBadge = Boolean(scope?.querySelector('[data-e2e*="ad-" i], [class*="ad-badge" i], [class*="sponsor" i]'));
  const isAd = adBadge || lines.some(line => /^(sponsored|patrocinado|patrocinada|publicidade|anúncio|advertisement|promoted|promovido|promovida|ad|إعلان|مموّل)$/.test(line));
  return { skip: isLive || isAd, reason: isLive ? 'live' : isAd ? 'advertisement' : null };
}
function inspectChallenge() {
  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 20 && rect.height > 20;
  };
  const selectors = [
    '#captcha_container', '[id*="captcha" i]', '[class*="captcha" i]', '[data-e2e*="captcha" i]',
    '[class*="verify" i][class*="modal" i]', '[class*="secsdk-captcha" i]'
  ];
  const container = selectors.some(selector => [...document.querySelectorAll(selector)].some(visible));
  const frame = [...document.querySelectorAll('iframe')].some(item => {
    const hint = `${item.src} ${item.title} ${item.name}`.toLowerCase();
    return visible(item) && /(captcha|verify|challenge)/.test(hint);
  });
  const text = String(document.body?.innerText || '').toLocaleLowerCase().replace(/\s+/g, ' ');
  const instruction = [
    'arraste o controle deslizante', 'encaixar o quebra-cabeça', 'drag the slider',
    'complete the puzzle', 'slide to fit', 'verificação de segurança', 'security verification'
  ].some(phrase => text.includes(phrase));
  return { detected: container || frame || instruction, kind: instruction ? 'slider' : 'verification' };
}
function visiblePoint(selector) {
  const element = [...document.querySelectorAll(selector)].find(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  });
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}
function focusComment() {
  const { editor } = commentControls();
  if (!editor) return { ready: false, reason: 'O campo de comentário mudou ou não está disponível.' };
  if ((editor.innerText || editor.value || '').trim()) return { ready: false, reason: 'Já existe um texto no campo de comentário. Limpe o rascunho antes de iniciar.' };
  const point = exposeControl(editor);
  return point ? { ready: true, point } : { ready: false, reason: 'O campo de comentário está encoberto.' };
}
function inspectDraft(text) {
  const { editor, post } = commentControls();
  return { matches: (editor?.innerText || editor?.value || '').trim() === text, enabled: Boolean(post && !post.matches('[disabled], [aria-disabled="true"]')) };
}
function postPoint() {
  const { post } = commentControls();
  if (!post || post.matches('[disabled], [aria-disabled="true"]')) return { ready: false, reason: 'O TikTok não habilitou o envio.' };
  const point = exposeControl(post);
  return point ? { ready: true, point } : { ready: true, dom: true };
}
function submitPost(text) {
  const { editor, post } = commentControls();
  if ((editor?.innerText || editor?.value || '').trim() !== text || !post || post.matches('[disabled], [aria-disabled="true"]')) return false;
  post.click();
  return true;
}
function inspectAnyDraft() {
  const { editor } = commentControls();
  return Boolean((editor?.innerText || editor?.value || '').trim());
}
function verifyComment(text) {
  const items = commentControls().scope?.querySelectorAll('[data-e2e="comment-text"], [data-e2e="comment-level-1"]') || [];
  return [...items].filter(item => item.textContent?.trim() === text).length;
}
function inspectSubmission(text) {
  const { editor, post, scope } = commentControls();
  const value = (editor?.innerText || editor?.value || '').trim();
  const items = scope?.querySelectorAll('[data-e2e="comment-text"], [data-e2e="comment-level-1"]') || [];
  const count = [...items].filter(item => item.textContent?.trim() === text).length;
  return {
    count,
    draftEmpty: Boolean(editor) && value === '',
    draftMatches: value === text,
    enabled: Boolean(post && !post.matches('[disabled], [aria-disabled="true"]'))
  };
}
function holdActiveVideo() {
  const visible = video => {
    const style = getComputedStyle(video);
    const rect = video.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const video = [...document.querySelectorAll('video')]
    .filter(visible)
    .map(item => ({ item, rect: item.getBoundingClientRect() }))
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.item;
  if (!video) return false;
  const previous = window.__commentStudioVideoHold;
  if (previous?.video === video) { video.pause(); return true; }
  if (previous?.video && previous.keepPaused) previous.video.removeEventListener('play', previous.keepPaused);
  const wasPlaying = !video.paused && !video.ended;
  const keepPaused = () => video.pause();
  video.loop = false;
  video.pause();
  video.addEventListener('play', keepPaused);
  window.__commentStudioVideoHold = { video, keepPaused, wasPlaying };
  return true;
}
function releaseActiveVideo(resume = false) {
  const state = window.__commentStudioVideoHold;
  if (!state?.video) return false;
  state.video.removeEventListener('play', state.keepPaused);
  window.__commentStudioVideoHold = null;
  if (resume && state.wasPlaying && !state.video.ended) state.video.play().catch(() => {});
  else state.video.pause();
  return true;
}
function inspectEngagement(kind) {
  const selectors = kind === 'like' ? ['[data-e2e="browse-like-icon"]', '[data-e2e="like-icon"]'] : ['[data-e2e="browse-save-icon"]', '[data-e2e="favorite-icon"]'];
  const icon = selectors.flatMap(selector => [...document.querySelectorAll(selector)]).find(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  });
  const button = icon?.closest('button,[role="button"]');
  if (!button || button.disabled || button.closest('[aria-disabled="true"]')) return { state: 'unavailable' };
  const selected = button.getAttribute('aria-pressed');
  const label = (button.getAttribute('aria-label') || '').toLowerCase();
  let state = selected === 'true' ? 'on' : selected === 'false' ? 'off' : 'unknown';
  if (kind === 'favorite' && state === 'unknown') {
    const color = button.querySelector('svg')?.getAttribute('color')?.toLowerCase().replace(/\s/g, '');
    // This TikTok layout keeps the same aria-label after saving; its bookmark changes color.
    if (color === '#face15' || /^(remover dos favoritos|remove from favorites)/.test(label)) state = 'on';
    else if (color === 'rgba(255,255,255,.9)' && /^(adicionar aos favoritos|add to favorites)/.test(label)) state = 'off';
  }
  const r = (button.querySelector('button') || button).getBoundingClientRect();
  return { state, point: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } };
}
class Automation {
  constructor({ store, getWindow, openAccount, onChange }) {
    this.store = store;
    this.getWindow = getWindow;
    this.openAccount = openAccount;
    this.onChange = onChange || (() => {});
    this.current = { status: 'idle', posted: 0, scanned: 0, message: 'Pronto para iniciar.' };
    this.stopRequested = false;
    this.pauseWaiters = new Set();
    this.confirmingCount = 0;
    this.reservedPosts = 0;
    this.phraseIndex = 0;
    this.phraseDeck = [];
    this.lastPhraseIndex = null;
    this.challengeAccounts = new Map();
    this.attentionAccounts = new Map();
    this.attentionWaiters = new Map();
    this.identities = new WeakMap();
    this.accountProgress = new Map();
    this.execution = new AsyncLocalStorage();
    this.workers = new Map();
    this.ownedDrafts = new Map();
    this.hourlyCycleBaseline = new Map();
    store.data.attempts ||= [];
  }
  snapshot() {
    const challenges = [...this.challengeAccounts.values()];
    const result = { ...this.current, challenges, attentionAccounts: [...this.attentionAccounts.values()], accountProgress: [...this.accountProgress.values()] };
    if (challenges.length) {
      const names = challenges.map(item => item.accountName).join(', ');
      result.message = `Resolva a verificação do TikTok na janela de ${names}. A conta continuará automaticamente.`;
    }
    return result;
  }
  isActive() { return ['running', 'pausing', 'paused'].includes(this.current.status); }
  setAccountSource(accountId, campaign, index = 0) {
    const previous = this.accountProgress.get(accountId);
    this.accountProgress.set(accountId, { ...previous, accountId, posted: previous?.posted || 0, targetType: campaign.targetType, target: campaignTargets(campaign)[index] || campaign.target });
  }
  workerStatus(ctx, status, reason = '') {
    if (!ctx) return;
    const progress = this.accountProgress.get(ctx.id) || { accountId: ctx.id, posted: 0 };
    Object.assign(progress, { status, reason, stage: ctx.stage, stageStartedAt: ctx.stageStartedAt, generation: ctx.generation, videoId: ctx.state?.pending?.videoId });
    this.accountProgress.set(ctx.id, progress); this.onChange();
  }
  pauseAccount(id) {
    const ctx = this.workers.get(id);
    if (ctx && !ctx.done) { ctx.paused = true; this.workerStatus(ctx, ctx.confirming ? 'pausing' : 'paused'); }
    return this.snapshot();
  }
  async bounded(win, stage, ms, operation) {
    const ctx = this.execution.getStore();
    const generation = ctx?.generation;
    if (ctx) { ctx.stage = stage; ctx.stageStartedAt = new Date().toISOString(); this.workerStatus(ctx, ctx.paused ? 'paused' : 'running'); }
    const label = ctx ? this.store.data.accounts.find(a => a.id === ctx.id)?.name || ctx.id : 'Verificação';
    this.store.log(`Etapa iniciada: ${label} · ${stage} · vídeo ${ctx?.state?.pending?.videoId || '—'}.`);
    let timer;
    try {
      const result = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (ctx) { ctx.generation++; ctx.needsRecovery = true; }
          try { if (!win.isDestroyed()) win.destroy(); } catch {}
          reject(new Error(`Tempo excedido na etapa ${stage} (${ms / 1000}s).`));
        }, ms);
      })]);
      if (ctx && generation !== ctx.generation) throw new Error('Resposta de janela anterior descartada.');
      this.store.log(`Etapa concluída: ${label} · ${stage}.`);
      return result;
    } finally { clearTimeout(timer); }
  }
  update(patch) {
    Object.assign(this.current, patch);
    if (this.current.posted >= this.sessionLimit) { this.releaseAttention(); this.releasePausedWorkers(); }
    if (this.current.status === 'pausing') this.current.message = 'Pausando após a etapa atual…';
    this.onChange();
  }
  releaseAttention() {
    for (const release of this.attentionWaiters.values()) release();
    this.attentionWaiters.clear();
    this.attentionAccounts.clear();
  }
  pause() {
    if (this.current.status === 'running' && !this.stopRequested) {
      this.pauseRequested = true;
      this.update({ status: 'pausing' });
    }
    return this.snapshot();
  }
  resume() {
    if (['paused', 'pausing'].includes(this.current.status) && !this.stopRequested) {
      this.pauseRequested = false;
      this.update({ status: 'running', message: 'Continuando campanha…' });
      this.releasePausedWorkers();
      this.store.log('Campanha retomada.');
    }
    return this.snapshot();
  }
  releasePausedWorkers() {
    for (const ctx of this.workers.values()) ctx.release?.();
    for (const release of this.pauseWaiters) release();
    this.pauseWaiters.clear();
  }
  resumeAccount(accountId) {
    const ctx = this.workers.get(accountId);
    if (ctx && !ctx.done && !this.stopRequested) { ctx.paused = false; ctx.release?.(); this.workerStatus(ctx, 'running'); }
    const release = this.attentionWaiters.get(accountId);
    if (!release || this.stopRequested) return this.snapshot();
    this.attentionWaiters.delete(accountId);
    this.attentionAccounts.delete(accountId);
    release();
    this.onChange();
    return this.snapshot();
  }
  async requireAttention(account, pending, reason) {
    this.workerStatus(this.execution.getStore(), 'attention', reason);
    if (this.current.posted >= this.sessionLimit) return;
    const resumed = new Promise(resolve => this.attentionWaiters.set(account.id, resolve));
    this.attentionAccounts.set(account.id, { accountId: account.id, accountName: account.name, videoId: pending?.videoId, reason });
    this.store.log(`Conta em atenção: ${account.name} · vídeo ${pending?.videoId || '—'} · ${reason}`);
    this.onChange();
    await resumed;
    await this.checkpoint();
  }
  isConfirming() { return this.confirmingCount > 0 || this.confirming === true; }
  async checkpoint() {
    if (this.stopRequested) throw new Error('Execução interrompida.');
    const ctx = this.execution.getStore();
    while (ctx?.paused && !ctx.confirming && !this.stopRequested && this.current.posted < this.sessionLimit) {
      this.workerStatus(ctx, 'paused');
      await new Promise(resolve => { ctx.release = resolve; });
    }
    if (this.pauseRequested && !this.isConfirming()) {
      const resumed = new Promise(resolve => this.pauseWaiters.add(resolve));
      this.update({ status: 'paused', message: 'Campanha pausada. Clique em Continuar.' });
      this.store.log('Campanha pausada. Progresso preservado.');
      await resumed;
    }
    if (this.stopRequested) throw new Error('Execução interrompida.');
  }
  async wait(ms) {
    let remaining = ms;
    while (remaining > 0) {
      await this.checkpoint();
      const step = Math.min(250, remaining);
      await pause(step);
      remaining -= step;
    }
    await this.checkpoint();
  }
  async resolveChallenge(win, account) {
    let challenge = await this.evaluate(win, inspectChallenge);
    if (!challenge?.detected) return false;
    const accountId = account?.id || 'unknown';
    const accountName = account?.name || 'Conta';
    const firstNotice = !this.challengeAccounts.has(accountId);
    this.challengeAccounts.set(accountId, { accountId, accountName, kind: challenge.kind });
    if (firstNotice) {
      this.store.log(`Verificação humana solicitada pelo TikTok: ${accountName}. Resolva na janela da conta.`);
      this.onChange();
      try {
        if (typeof win.show === 'function') win.show();
        if (typeof win.focus === 'function') win.focus();
      } catch {}
    }
    try {
      while (challenge?.detected) {
        await this.wait(1000);
        challenge = await this.evaluate(win, inspectChallenge);
      }
    } finally {
      this.challengeAccounts.delete(accountId);
      this.onChange();
    }
    this.store.log(`Verificação concluída: ${accountName}. Automação retomada para essa conta.`);
    this.update({ message: `${accountName}: verificação concluída. Retomando…` });
    return true;
  }
  async evaluate(win, fn, arg) {
    await this.checkpoint();
    if (!win || win.isDestroyed()) throw new Error('A janela da conta foi fechada.');
    const argument = JSON.stringify(arg) ?? 'undefined';
    const script = `(() => { ${pagePrelude} try { return { studioResult: true, ok: true, value: (${fn.toString()})(${argument}) }; } catch (error) { return { studioResult: true, ok: false, error: String(error?.message || error) }; } })()`;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.bounded(win, fn.name || 'leitura', 15000, () => win.webContents.executeJavaScript(script));
        if (!result?.studioResult) throw new Error('A página não retornou uma resposta válida.');
        if (!result.ok) throw new Error(result.error || 'Erro desconhecido na página.');
        return result.value;
      } catch (error) {
        lastError = error;
        const transient = /Script failed to execute|context.*destroyed|frame.*removed|Render frame/i.test(String(error?.message || error));
        if (!transient || attempt === 2) break;
        await this.wait(400 * (attempt + 1));
      }
    }
    throw new Error(`Falha na etapa ${fn.name || 'da página'}: ${lastError?.message || 'o TikTok não respondeu'}`);
  }
  async load(win, url) {
    await this.checkpoint();
    if (!win || win.isDestroyed()) throw new Error('A janela da conta foi fechada.');
    try { await this.bounded(win, 'navegação', 30000, () => win.loadURL(url)); }
    catch (error) {
      if (error.code !== -3 && !/ERR_ABORTED|\(-3\)/.test(String(error.message))) throw error;
      await this.wait(1200);
      if (win.webContents.getURL() !== url) await this.bounded(win, 'navegação', 30000, () => win.loadURL(url));
    }
    if (!win.webContents.getURL().startsWith('https://www.tiktok.com/')) throw new Error('O TikTok redirecionou a página. Abra a conta e confirme o login.');
    await this.wait(2200);
  }
  async discover(win, campaign, account, excluded = new Set(), targetIndex = 0) {
    const sourceURL = targetURL(campaign, targetIndex);
    if (campaign.targetType === 'search') await this.restoreSearch(win, campaign, targetIndex);
    else if (win.webContents.getURL() !== sourceURL) await this.load(win, sourceURL);
    const collected = [];
    let recognized = false;
    const rounds = campaign.targetType === 'foryou' ? Math.min(12, 4 + Math.ceil(excluded.size / 4)) : 4;
    for (let attempt = 0; attempt < rounds; attempt++) {
      await this.resolveChallenge(win, account);
      const result = await this.evaluate(win, discoverVideos, sourceURL);
      recognized ||= result.recognized;
      const urls = result.urls.filter(url => {
        const key = videoKey(url);
        return key && !excluded.has(key) && !collected.some(item => videoKey(item) === key);
      });
      collected.push(...urls);
      if (collected.length && campaign.targetType !== 'foryou') return collected;
      await this.evaluate(win, scrollPage);
      await this.wait(1500);
    }
    if (collected.length) return collected;
    if (!recognized) throw new Error('Estrutura dos resultados não reconhecida. Confira a página da busca.');
    this.store.log(`Lista de resultados vazia: ${account.name} · origem ${campaign.targetType} · ${campaignTargets(campaign)[targetIndex]}.`);
    return [];
  }
  async restoreSearch(win, campaign, targetIndex = 0) {
    const source = targetURL(campaign, targetIndex);
    const matches = () => {
      try { const current = new URL(win.webContents.getURL()); return current.origin === 'https://www.tiktok.com' && current.pathname === '/search/video' && current.searchParams.get('q') === campaignTargets(campaign)[targetIndex]; }
      catch { return false; }
    };
    if (matches()) return;
    const history = win.webContents.navigationHistory;
    for (let attempt = 0; attempt < 4 && history?.canGoBack(); attempt++) {
      await this.checkpoint(); history.goBack(); await this.wait(1000);
      if (matches()) return;
    }
    await this.load(win, source);
  }
  async openSearchVideo(win, campaign, account, url, targetIndex = 0) {
    const expected = videoKey(url);
    if (videoKey(win.webContents.getURL()) === expected) return;
    if (videoKey(win.webContents.getURL())) {
      if (await this.evaluate(win, inspectAnyDraft)) {
        if (!await this.discardOwnedDraft(win, account.id)) throw new Error('Há um rascunho não reconhecido como criado pelo app. Confira antes de avançar.');
      }
      const point = await this.evaluate(win, nextFeedPoint);
      if (point) await backgroundInput.click(win, point);
      else await backgroundInput.pressKey(win, 'ArrowDown', 40);
      for (let poll = 0; poll < 8; poll++) {
        await this.wait(500);
        if (videoKey(win.webContents.getURL()) === expected) return;
      }
      // Never interact with an uncollected recommendation reached by the arrow.
    }
    await this.restoreSearch(win, campaign, targetIndex);
    for (let scroll = 0; scroll < 12; scroll++) {
      await this.resolveChallenge(win, account);
      const point = await this.evaluate(win, searchResultPoint, url);
      if (point) {
        await backgroundInput.click(win, point);
        for (let poll = 0; poll < 15; poll++) {
          await this.wait(500);
          if (videoKey(win.webContents.getURL()) === expected) return;
        }
        // Some search layouts play the card in place instead of opening its video page.
        break;
      }
      await this.evaluate(win, scrollPage); await this.wait(750);
    }
    // The collected URL is still the exact video we intend to process. Opening it
    // directly also gives the comment editor a stable page when search uses an
    // in-place player or changes the result layout.
    await this.load(win, url);
  }
  async openComments(win, account, allowFeed = false, maxAttempts = 40) {
    let page;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.resolveChallenge(win, account);
      page = await this.evaluate(win, inspectVideo, allowFeed);
      if (page.disabled || (page.video && page.editor)) return page;
      if (attempt % 4 === 0) {
        // A tab may be visible while its click point is covered by TikTok's player.
        // Use the tab's own handler first, then retry with browser input later.
        await this.evaluate(win, clickCommentTab);
      } else if (attempt % 4 === 2) {
        const point = await this.evaluate(win, commentOpenPoint);
        if (point) await backgroundInput.click(win, point);
      }
      await this.wait(750);
    }
    return await this.evaluate(win, inspectVideo, allowFeed);
  }
  async advanceForYou(win, account, previousVideoId) {
    await this.resolveChallenge(win, account);
    try { await backgroundInput.pressKey(win, 'Escape', 27); } catch {}
    await this.wait(250);
    const point = await this.evaluate(win, nextFeedPoint);
    if (point) await backgroundInput.click(win, point);
    else await backgroundInput.pressKey(win, 'ArrowDown', 40);
    for (let check = 0; check < 12; check++) {
      await this.wait(500);
      await this.resolveChallenge(win, account);
      const active = await this.evaluate(win, activeFeedVideo);
      if (active.url && videoKey(active.url) !== previousVideoId) return active;
      if (check === 5) await backgroundInput.pressKey(win, 'ArrowDown', 40);
    }
    throw new Error('Não foi possível avançar no feed Para você. Abra a janela e confira se a página principal está visível.');
  }
  async waitForPlayback(win, seconds, account) {
    let remaining = seconds * 1000;
    while (remaining > 0) {
      await this.resolveChallenge(win, account);
      await this.evaluate(win, trackPlayback);
      if (await this.evaluate(win, playbackFinished)) return 'ended';
      const step = Math.min(250, remaining);
      await this.wait(step);
      remaining -= step;
    }
    return 'interval';
  }
  async isOwnAccountVideo(win, account, url) {
    const identity = await this.evaluate(win, inspectIdentity);
    const handles = identity.handles.length === 1 ? identity.handles : account.handle ? [normalizeHandle(account.handle)] : [];
    const source = identity.handles.length === 1 ? 'session-navigation' : handles.length ? 'configured-handle' : 'unresolved';
    const signature = JSON.stringify({ handles, source });
    if (this.identities.get(win) !== signature) {
      this.identities.set(win, signature);
      this.store.log(`Identidade: ${account.name} · vídeo ${videoKey(url)} · ${source === 'session-navigation' ? 'navegação da sessão' : handles.length ? 'identidade não detectada; usando cadastro' : 'identidade não detectada e cadastro sem @'} · @${handles[0] || 'não informado'}.`);
    }
    const aliases = await this.evaluate(win, inspectVideoAliases, videoKey(url));
    return { own: [url, ...aliases].some(candidate => isOwnVideo(candidate, handles)), author: videoAuthor(url), handles, source };
  }
  async assertActiveVideo(win, forYou, videoId) {
    await this.checkpoint();
    const active = forYou ? (await this.evaluate(win, activeFeedVideo)).url : win.webContents.getURL();
    if (videoKey(active) !== videoId) throw new Error('O vídeo mudou. A ação foi interrompida antes do clique.');
  }
  async engage(win, kind, account) {
    await this.resolveChallenge(win, account);
    const before = await this.evaluate(win, inspectEngagement, kind);
    if (before.state === 'on') return 'já ativado';
    if (before.state !== 'off') return before.state === 'unavailable' ? 'indisponível' : 'estado incerto';
    await backgroundInput.click(win, before.point);
    for (let check = 0; check < 6; check++) {
      await this.wait(500);
      await this.resolveChallenge(win, account);
      if ((await this.evaluate(win, inspectEngagement, kind)).state === 'on') return 'confirmado';
    }
    return 'não confirmado';
  }
  attemptsFor(accountId, videoId) { return this.store.data.attempts.some(item => item.accountId === accountId && item.videoId === videoId); }
  hourlyCount(accountId) {
    const cutoff = Date.now() - 3600000;
    return this.store.data.attempts.filter(item => item.accountId === accountId && !this.hourlyCycleBaseline.get(accountId)?.has(item.id) && Date.parse(item.at) >= cutoff && ['pending', 'sent', 'unknown'].includes(item.status)).length;
  }
  restartAccountCycle(accountId) {
    if (this.accountProgress.get(accountId)?.status !== 'waiting' || !this.isActive() || this.stopRequested) return false;
    this.hourlyCycleBaseline.set(accountId, new Set(this.store.data.attempts.filter(item => item.accountId === accountId).map(item => item.id)));
    this.store.log(`Novo ciclo autorizado pelo usuário: ${this.store.data.accounts.find(a => a.id === accountId)?.name || accountId}. Histórico de envios preservado.`);
    this.resumeAccount(accountId);
    return true;
  }
  hourlyResumeAt(accountId, limit, now = Date.now()) {
    const times = this.store.data.attempts.filter(item => item.accountId === accountId && !this.hourlyCycleBaseline.get(accountId)?.has(item.id) && ['pending', 'sent', 'unknown'].includes(item.status))
      .map(item => Date.parse(item.at)).filter(time => time >= now - 3600000).sort((a, b) => a - b);
    return times.length < limit ? now : times[times.length - limit] + 3600001;
  }
  async discardOwnedDraft(win, accountId) {
    const draft = this.ownedDrafts.get(accountId);
    if (!draft || videoKey(win.webContents.getURL()) !== draft.videoId) return false;
    if (!(await this.evaluate(win, inspectDraft, draft.phrase)).matches) return false;
    await this.load(win, draft.url);
    if (await this.evaluate(win, inspectAnyDraft)) return false;
    this.ownedDrafts.delete(accountId);
    this.store.log(`Rascunho do app descartado sem reenviar: ${accountId} · vídeo ${draft.videoId}.`);
    return true;
  }
  record(accountId, videoId, url) {
    const attempt = { id: randomUUID(), accountId, videoId, url, at: new Date().toISOString(), status: 'pending' };
    this.store.data.attempts.unshift(attempt);
    this.store.data.attempts = this.store.data.attempts.slice(0, 2000);
    this.store.save();
    return attempt;
  }
  start() {
    if (this.isActive()) throw new Error('Já existe uma campanha em execução. Use Continuar para retomar.');
    const campaign = this.store.data.campaign;
    if (!campaign?.accountIds?.length || !campaign.comments?.length) throw new Error('Salve uma campanha com conta e comentário antes de iniciar.');
    if (campaign.accountIds.some(id => !this.store.data.accounts.some(a => a.id === id && (a.platform || 'tiktok') === 'tiktok'))) throw new Error('A campanha contém uma conta removida ou que não é TikTok. Salve a configuração novamente.');
    this.stopRequested = false;
    this.sessionLimit = campaign.sessionLimit;
    this.accountProgress.clear();
    for (const id of campaign.accountIds) this.setAccountSource(id, campaign);
    this.pauseRequested = false;
    this.confirming = false;
    this.confirmingCount = 0;
    this.reservedPosts = 0;
    this.phraseIndex = 0;
    this.phraseDeck = [];
    this.lastPhraseIndex = null;
    this.challengeAccounts.clear();
    this.attentionAccounts.clear();
    this.attentionWaiters.clear();
    this.pauseWaiters.clear();
    this.update({ status: 'running', posted: 0, scanned: 0, message: 'Preparando contas…', startedAt: new Date().toISOString() });
    this.store.log(`Campanha iniciada: ${campaign.name}.`);
    void this.run(structuredClone(campaign)).catch(error => {
      this.confirming = false;
      this.confirmingCount = 0;
      this.reservedPosts = 0;
      this.challengeAccounts.clear();
      this.releasePausedWorkers();
      const stopped = this.stopRequested;
      this.update({ status: stopped ? 'stopped' : 'error', message: stopped ? 'Execução interrompida.' : error.message });
      this.store.log(stopped ? 'Campanha interrompida.' : `Campanha interrompida: ${error.message}`);
    });
    return this.snapshot();
  }
  stop() { if (this.isActive()) { this.stopRequested = true; this.pauseRequested = false; this.releaseAttention(); this.update({ status: 'running', message: 'Parando após a etapa atual…' }); this.releasePausedWorkers(); } return this.snapshot(); }
  async check() {
    if (this.isActive()) throw new Error('Pare a campanha antes de verificar o acesso.');
    const campaign = this.store.data.campaign;
    if (!campaign?.accountIds?.length) throw new Error('Salve uma campanha com uma conta antes de verificar.');
    this.stopRequested = false;
    const accountId = campaign.accountIds[0];
    const account = this.store.data.accounts.find(a => a.id === accountId);
    if (!account) throw new Error('A conta selecionada não foi encontrada.');
    if (!this.getWindow(accountId)) await this.openAccount(accountId, targetURL(campaign), { background: true });
    const win = this.getWindow(accountId);
    let selectedURL;
    if (campaign.targetType === 'foryou') {
      if (!win.webContents.getURL().startsWith(targetURL(campaign))) await this.load(win, targetURL(campaign));
      const active = await this.evaluate(win, activeFeedVideo);
      if (!active.ready || !videoKey(active.url)) throw new Error('A página principal Para você não mostrou um vídeo reconhecível. Confira o login e tente novamente.');
    } else {
      const urls = await this.discover(win, campaign, account);
      if (!urls.length) throw new Error('A busca não retornou vídeos novos para verificar.');
      selectedURL = urls[0];
      if (campaign.targetType === 'search') await this.openSearchVideo(win, campaign, account, urls[0]);
      else await this.load(win, urls[0]);
    }
    await this.resolveChallenge(win, account);
    const activeURL = campaign.targetType === 'foryou' ? (await this.evaluate(win, activeFeedVideo)).url : win.webContents.getURL();
    const identity = await this.isOwnAccountVideo(win, account, activeURL);
    let page = await this.openComments(win, account, campaign.targetType === 'foryou', campaign.targetType === 'search' ? 12 : 40);
    if (campaign.targetType === 'search' && !page.disabled && (!page.video || !page.editor)) {
      await this.load(win, selectedURL);
      await this.resolveChallenge(win, account);
      page = await this.openComments(win, account, false, 12);
    }
    if (page.origin !== 'https://www.tiktok.com' || !page.video || !page.editor) throw new Error('Vídeo encontrado, mas o campo de comentário não está disponível. Confira o login.');
    this.update({ message: `Acesso verificado com ${account.name}. Editor disponível · identidade: ${identity.handles.map(handle => '@' + handle).join(', ') || 'não detectada'} (${identity.source}).` });
    this.store.log(`Acesso verificado: ${account.name} · vídeo ${videoKey(activeURL)} · identidade ${identity.source} · próprio ${identity.own ? 'sim' : 'não'}. Nenhum comentário, curtida ou favorito enviado.`);
    return this.snapshot();
  }
  hasCapacity(campaign) { return this.current.posted + this.reservedPosts < campaign.sessionLimit; }
  reservePost(campaign) {
    if (!this.hasCapacity(campaign)) return false;
    this.reservedPosts++;
    return true;
  }
  releasePost() { this.reservedPosts = Math.max(0, this.reservedPosts - 1); }
  shouldEngage(campaign, kind, roll = Math.random() * 100) {
    const percent = campaign[`${kind}Percent`] ?? campaign.engagementPercent ?? 0;
    return Boolean(campaign[kind]) && roll < percent;
  }
  nextPhrase(campaign, random = Math.random) {
    const comments = campaign.comments || [];
    if (!comments.length) throw new Error('Nenhum comentário foi configurado.');
    if (!campaign.random) return comments[this.phraseIndex++ % comments.length];
    if (!this.phraseDeck.length) {
      this.phraseDeck = comments.map((_, index) => index);
      for (let index = this.phraseDeck.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1));
        [this.phraseDeck[index], this.phraseDeck[swap]] = [this.phraseDeck[swap], this.phraseDeck[index]];
      }
      if (this.phraseDeck.length > 1 && this.phraseDeck[0] === this.lastPhraseIndex) {
        const different = this.phraseDeck.findIndex(index => index !== this.lastPhraseIndex);
        [this.phraseDeck[0], this.phraseDeck[different]] = [this.phraseDeck[different], this.phraseDeck[0]];
      }
    }
    const selected = this.phraseDeck.shift();
    this.lastPhraseIndex = selected;
    return comments[selected];
  }
  async runAccount(accountId, campaign, workerState = {}) {
    const account = this.store.data.accounts.find(a => a.id === accountId);
    const seen = workerState.seen ||= new Set();
    const queue = workerState.queue ||= [];
    const deferred = workerState.deferred ||= [];
    workerState.targetIndex ??= 0;
    workerState.videosOnTarget ??= 0;
    workerState.emptyTargets ??= 0;
    workerState.commentFailures ??= 0;
    const hashtagTargets = campaign.targetType !== 'foryou' ? campaignTargets(campaign) : [];
    const switchMin = Number.isInteger(campaign.targetSwitchMin) ? campaign.targetSwitchMin : 15;
    const switchMax = Number.isInteger(campaign.targetSwitchMax) ? campaign.targetSwitchMax : 20;
    const drawSwitchLimit = () => switchMin + Math.floor(Math.random() * (switchMax - switchMin + 1));
    workerState.switchLimit ??= hashtagTargets.length > 1 ? drawSwitchLimit() : Infinity;
    const switchHashtag = () => {
      workerState.targetIndex = (workerState.targetIndex + 1) % hashtagTargets.length;
      this.setAccountSource(accountId, campaign, workerState.targetIndex);
      workerState.videosOnTarget = 0;
      workerState.switchLimit = drawSwitchLimit();
      queue.length = 0;
      const label = campaign.targetType === 'search' ? `Busca: ${hashtagTargets[workerState.targetIndex]}` : `Hashtag: #${hashtagTargets[workerState.targetIndex]}`;
      this.store.log(`${label} · ${account.name} · próxima troca após ${workerState.switchLimit} vídeo(s).`);
      this.update({ message: `${account.name}: mudando para ${label}…` });
    };
    const completePending = () => { if (workerState.pending) seen.add(workerState.pending.videoId); workerState.pending = null; };
    while (this.hasCapacity(campaign)) {
      await this.checkpoint();
      this.setAccountSource(accountId, campaign, workerState.targetIndex);
      if (this.hourlyCount(accountId) >= campaign.hourlyLimit) {
        const until = this.hourlyResumeAt(accountId, campaign.hourlyLimit);
        this.workerStatus(this.execution.getStore(), 'waiting', `Limite por hora: retomada após ${new Date(until).toLocaleTimeString('pt-BR')}`);
        await this.wait(Math.min(1000, Math.max(1, until - Date.now())));
        continue;
      }
      this.update({ message: `Contas trabalhando em paralelo · ${account.name}: buscando vídeos…`, accountName: account.name });
      if (!this.getWindow(accountId)) await this.openAccount(accountId, targetURL(campaign, workerState.targetIndex), { background: false });
      const win = this.getWindow(accountId);
      const forYou = campaign.targetType === 'foryou';
      const advance = async previousId => {
        if (workerState.feedRecovery) {
          await this.load(win, targetURL(campaign)); workerState.feedRecovery = false;
        } else await this.advanceForYou(win, account, previousId);
      };
      if (!workerState.pending && forYou && deferred.length && !workerState.commentFailures) workerState.pending = deferred.shift();
      let url;
      let videoId;
      if (workerState.pending) {
        ({ url, videoId } = workerState.pending);
        if (forYou && videoKey((await this.evaluate(win, activeFeedVideo)).url) !== videoId) {
          // Reopen only the exact pending video, never its author's profile.
          await this.load(win, url);
          workerState.feedRecovery = true;
          workerState.feedStarted = true;
        }
      } else if (forYou) {
        if (!workerState.feedStarted) { await this.load(win, targetURL(campaign)); workerState.feedStarted = true; }
        await this.resolveChallenge(win, account);
        const active = await this.evaluate(win, activeFeedVideo);
        const content = await this.evaluate(win, inspectSkippableContent);
        if (content.skip) {
          const label = content.reason === 'live' ? 'LIVE' : 'publicidade';
          this.update({ scanned: this.current.scanned + 1, message: `${account.name}: ${label} detectada. Indo para o próximo vídeo…` });
          this.store.log(`${label === 'LIVE' ? 'LIVE ignorada' : 'Publicidade ignorada'} no Para você · ${account.name}.`);
          await advance(videoKey(active.url));
          continue;
        }
        if (!active.ready || !videoKey(active.url)) throw new Error('A página principal Para você não mostrou um vídeo reconhecível. Confira o login e tente novamente.');
        url = active.url;
        videoId = videoKey(url);
        if (seen.has(videoId)) { this.store.log(`Vídeo já processado: ${account.name} · vídeo ${videoId}.`); await advance(videoId); continue; }
      } else {
        if (hashtagTargets.length > 1 && workerState.videosOnTarget >= workerState.switchLimit && !deferred.length) switchHashtag();
        if (!queue.length) {
          const excluded = new Set([...seen, ...deferred.map(item => item.videoId)]);
          const fresh = await this.discover(win, campaign, account, excluded, workerState.targetIndex);
          if (!fresh.length && !deferred.length && hashtagTargets.length > 1 && workerState.emptyTargets < hashtagTargets.length - 1) {
            workerState.emptyTargets++;
            switchHashtag();
            continue;
          }
          workerState.emptyTargets = 0;
          queue.push(...fresh.filter(item => !excluded.has(videoKey(item))));
        }
        if (!queue.length && deferred.length) workerState.pending = deferred.shift();
        url = workerState.pending?.url || queue.shift();
        if (!url) { const ctx = this.execution.getStore(); if (ctx) ctx.reason = 'Fila de resultados esgotada'; return; }
        videoId = videoKey(url);
        if (!workerState.pending) workerState.videosOnTarget++;
      }
      if (!workerState.pending) {
        workerState.pending = { url, videoId, targetIndex: workerState.targetIndex, skip: null, failures: 0 };
        this.update({ scanned: this.current.scanned + 1, message: `Contas trabalhando em paralelo · ${account.name}: abrindo vídeo…` });
      }
      if (this.attemptsFor(accountId, videoId)) {
        this.store.log(`Vídeo já processado: ${account.name} · vídeo ${videoId}.`);
        completePending();
        if (forYou) await advance(videoId);
        continue;
      }
      if (campaign.targetType === 'search') await this.openSearchVideo(win, campaign, account, url, workerState.targetIndex);
      else if (!forYou) await this.load(win, url);
      await this.resolveChallenge(win, account);
      const ownership = await this.isOwnAccountVideo(win, account, url);
      if (ownership.source === 'unresolved') {
        await this.requireAttention(account, workerState.pending, 'Identidade não detectada. Confira o login ou pare a campanha e informe o @ no cadastro.');
        continue;
      }
      if (ownership.own) {
        workerState.commentFailures = 0;
        this.store.log(`Vídeo próprio ignorado: @${ownership.author} · ${account.name} · vídeo ${videoId} · identidade ${ownership.source || 'cadastro'}.`);
        completePending();
        this.update({ message: `${account.name}: vídeo do próprio perfil. Indo para o próximo…` });
        if (forYou) await advance(videoId);
        continue;
      }
      await this.evaluate(win, trackPlayback);
      let page = await this.openComments(win, account, forYou, campaign.targetType === 'search' ? 12 : 40);
      if (campaign.targetType === 'search' && !page.disabled && (!page.video || !page.editor)) {
        this.store.log(`Editor indisponível no visualizador da busca: ${account.name} · vídeo ${videoId}. Abrindo a página do vídeo.`);
        await this.load(win, url);
        await this.resolveChallenge(win, account);
        const directOwnership = await this.isOwnAccountVideo(win, account, url);
        if (directOwnership.own || directOwnership.source === 'unresolved') {
          await this.requireAttention(account, workerState.pending, 'Confira a identidade da conta na página do vídeo e clique em Continuar.');
          continue;
        }
        await this.evaluate(win, trackPlayback);
        page = await this.openComments(win, account, false, 12);
      }
      if (page.disabled) {
        this.store.log(`Comentários desativados: ${account.name} · vídeo ${videoId}.`);
        workerState.commentFailures = 0;
        completePending();
        if (forYou) await advance(videoId);
        continue;
      }
      if (page.origin !== 'https://www.tiktok.com' || !page.video || !page.editor) {
        workerState.commentFailures++;
        const reason = page.reason || 'O painel de comentários não ficou disponível.';
        this.store.log(`Falha ao abrir comentários: ${account.name} · vídeo ${videoId} · ${reason} · ${workerState.commentFailures} falha(s) seguida(s).`);
        if (campaign.targetType === 'search') {
          completePending();
          this.update({ message: `${account.name}: ${reason} Pulando o vídeo…` });
          if (workerState.commentFailures % 3 === 0) this.store.log(`Editor ainda indisponível para ${account.name}; seguindo para outro resultado da busca.`);
          continue;
        }
        workerState.pending.editorFailures = (workerState.pending.editorFailures || 0) + 1;
        if (!forYou && workerState.pending.editorFailures < 2) {
          deferred.push(workerState.pending);
          workerState.pending = null;
        } else {
          this.store.log(`Vídeo ignorado após duas tentativas sem editor: ${account.name} · vídeo ${videoId}.`);
          completePending();
        }
        if (forYou) await advance(videoId);
        continue;
      }
      if (campaign.targetType !== 'search') workerState.commentFailures = 0;
      this.update({ message: `Contas trabalhando em paralelo · ${account.name}: assistindo…` });
      await this.waitForPlayback(win, campaign.watchSeconds, account);
      const activeVideoId = forYou ? videoKey((await this.evaluate(win, activeFeedVideo)).url) : videoKey(win.webContents.getURL());
      if (activeVideoId !== videoId) throw new Error('A página do vídeo mudou durante a execução.');
      workerState.pending.skip ??= Math.random() * 100 < campaign.skipPercent;
      if (workerState.pending.skip) {
        this.store.log(`Vídeo ignorado por sorteio de ${campaign.skipPercent}%: ${account.name} · vídeo ${videoId}.`);
        workerState.commentFailures = 0;
        completePending();
        if (forYou) await advance(videoId);
        continue;
      }
      if (!this.reservePost(campaign)) return;
      let confirming = false;
      let videoHeld = false;
      let commentVerified = false;
      let attempt;
      let preSubmitFailure;
      try {
        await this.resolveChallenge(win, account);
        const phrase = workerState.pending.phrase ||= this.nextPhrase(campaign);
        const before = await this.evaluate(win, verifyComment, phrase);
        await this.assertActiveVideo(win, forYou, videoId);
        videoHeld = await this.evaluate(win, holdActiveVideo);
        const existingDraft = await this.evaluate(win, inspectDraft, phrase);
        if (!existingDraft.matches) {
          const focus = await this.evaluate(win, focusComment);
          if (!focus.ready) throw new Error(focus.reason);
          await this.assertActiveVideo(win, forYou, videoId);
          await backgroundInput.click(win, focus.point);
          await this.wait(250);
          await this.assertActiveVideo(win, forYou, videoId);
          await backgroundInput.insertText(win, phrase);
          this.ownedDrafts.set(accountId, { videoId, url, phrase });
        }
        await this.wait(600);
        const draft = await this.evaluate(win, inspectDraft, phrase);
        if (!draft.matches || !draft.enabled) throw new Error('O TikTok não aceitou o texto no campo. Confira a janela da conta.');
        videoHeld = await this.evaluate(win, holdActiveVideo);
        const videoBeforeSubmit = forYou ? videoKey((await this.evaluate(win, activeFeedVideo)).url) : videoKey(win.webContents.getURL());
        if (videoBeforeSubmit !== videoId) throw new Error('O vídeo mudou antes do envio. O comentário não foi publicado.');
        await this.checkpoint();
        await this.assertActiveVideo(win, forYou, videoId);
        const submitIdentity = await this.isOwnAccountVideo(win, account, url);
        if (submitIdentity.own || submitIdentity.source === 'unresolved') throw new Error('Identidade mudou ou não foi detectada antes do envio. Confira a conta.');
        this.confirmingCount++;
        confirming = true;
        this.update({ message: `Contas trabalhando em paralelo · ${account.name}: publicando…` });
        const result = await this.evaluate(win, postPoint);
        if (!result.ready) throw new Error(result.reason);
        await this.assertActiveVideo(win, forYou, videoId);
        attempt = this.record(accountId, videoId, url);
        const context = this.execution.getStore();
        if (context) context.confirming = true;
        if (result.dom) {
          if (!await this.evaluate(win, submitPost, phrase)) throw new Error('O botão Enviar não aceitou o clique.');
        } else await backgroundInput.click(win, result.point);
        let verified = false;
        for (let check = 0; check < 12; check++) {
          await this.wait(1200);
          await this.resolveChallenge(win, account);
          const currentVideoId = forYou ? videoKey((await this.evaluate(win, activeFeedVideo)).url) : videoKey(win.webContents.getURL());
          if (currentVideoId !== videoId) {
            attempt.status = 'unknown';
            this.store.save();
            throw new Error('O vídeo mudou durante o envio. A tentativa foi guardada e esse vídeo será ignorado.');
          }
          const submission = await this.evaluate(win, inspectSubmission, phrase);
          if (submission.draftEmpty && submission.count > before) { verified = true; break; }
        }
        if (!verified) { attempt.status = 'unknown'; this.store.save(); throw new Error('O envio foi acionado, mas não foi possível confirmar o comentário. A tentativa foi guardada para conferência.'); }
        commentVerified = true;
        this.ownedDrafts.delete(accountId);
        workerState.commentFailures = 0;
        attempt.status = 'sent'; this.store.save();
        const progress = this.accountProgress.get(accountId);
        if (progress) progress.posted++;
        this.update({ posted: this.current.posted + 1, message: `Comentário confirmado com ${account.name}.` });
        this.store.log(`Comentário confirmado: ${account.name} · vídeo ${videoId}.`);
        completePending();
      } catch (error) {
        if (attempt?.status === 'pending') { attempt.status = 'unknown'; this.store.save(); }
        if (campaign.targetType === 'search' && !attempt && /campo de comentário|botão Enviar|habilitou o envio|texto no campo|rascunho/i.test(error.message)) preSubmitFailure = error;
        else throw error;
      } finally {
        const context = this.execution.getStore();
        if (context) context.confirming = false;
        if (videoHeld) {
          try { await this.evaluate(win, releaseActiveVideo, commentVerified); } catch {}
        }
        if (confirming) this.confirmingCount = Math.max(0, this.confirmingCount - 1);
        this.releasePost();
      }
      if (preSubmitFailure) {
        workerState.commentFailures++;
        this.store.log(`Comentário não enviado: ${account.name} · vídeo ${videoId} · ${preSubmitFailure.message} · ${workerState.commentFailures}/3.`);
        if (await this.evaluate(win, inspectAnyDraft)) {
          if (await this.discardOwnedDraft(win, accountId)) {
            workerState.pending.draftRecoveries = (workerState.pending.draftRecoveries || 0) + 1;
            if (workerState.pending.draftRecoveries >= 2) {
              this.store.log(`Vídeo ignorado após duas falhas antes do envio: ${account.name} · vídeo ${videoId}.`);
              completePending();
            }
            continue;
          }
          await this.requireAttention(account, workerState.pending, 'O comentário ficou como rascunho e não foi enviado. Confira o botão Enviar ou limpe o rascunho antes de continuar.');
          workerState.commentFailures = 0;
          continue;
        }
        completePending();
        this.update({ message: `${account.name}: ${preSubmitFailure.message} Pulando o vídeo…` });
        if (workerState.commentFailures >= 3) {
          this.store.log(`Campo ou botão de envio indisponível em três vídeos para ${account.name}; seguindo para outro resultado.`);
          workerState.commentFailures = 0;
        }
        continue;
      }
      await this.checkpoint();
      for (const kind of ['like', 'favorite']) {
        if (this.shouldEngage(campaign, kind)) {
          await this.assertActiveVideo(win, forYou, videoId);
          const result = await this.engage(win, kind, account);
          this.store.log(`${kind === 'like' ? 'Curtir' : 'Favoritar'}: ${result} · ${account.name}.`);
        }
      }
      if (this.hasCapacity(campaign)) {
        const seconds = campaign.waitMin + Math.floor(Math.random() * (campaign.waitMax - campaign.waitMin + 1));
        this.update({ message: `${account.name}: aguardando ${seconds}s para o próximo vídeo…` });
        const reason = await this.waitForPlayback(win, seconds, account);
        if (reason === 'ended') this.update({ message: `${account.name}: vídeo encerrado. Indo para o próximo…` });
        if (forYou) await advance(videoId);
      }
    }
  }
  async runAccountRecovering(accountId, campaign) {
    if (!this.execution.getStore()) {
      if (this.workers.has(accountId) && !this.workers.get(accountId).done) throw new Error('Conta já está em execução.');
      const ctx = { id: accountId, generation: 0, paused: false, confirming: false, done: false };
      this.workers.set(accountId, ctx);
      return this.execution.run(ctx, async () => {
        try { return await this.runAccountRecovering(accountId, campaign); }
        finally { ctx.done = true; this.workerStatus(ctx, this.stopRequested ? 'stopped' : 'completed', ctx.reason || 'Execução encerrada'); }
      });
    }
    const account = this.store.data.accounts.find(item => item.id === accountId);
    const workerState = { seen: new Set() };
    const ctx = this.execution.getStore(); ctx.state = workerState;
    let recoveryCount = 0;
    let failuresWithoutProgress = 0;
    while (this.hasCapacity(campaign)) {
      try {
        await this.runAccount(accountId, campaign, workerState);
        return null;
      } catch (error) {
        if (this.stopRequested) throw error;
        const pending = workerState.pending;
        if (ctx.needsRecovery) {
          ctx.needsRecovery = false;
          const posted = this.accountProgress.get(accountId)?.posted || 0;
          if (posted !== ctx.lastPosted) { recoveryCount = 0; ctx.lastPosted = posted; }
          if (pending && this.attemptsFor(accountId, pending.videoId)) { workerState.seen.add(pending.videoId); workerState.pending = null; }
          this.store.log(`Timeout: ${account.name} · ${ctx.stage} · geração ${ctx.generation}.`);
          const delay = [2000, 5000, 10000, 20000, 40000, 60000][Math.min(recoveryCount, 5)];
          this.workerStatus(ctx, 'recovering', `Reabrindo navegador em ${delay / 1000}s`);
          this.store.log(`Recuperação automática: ${account.name} · reabertura em ${delay / 1000}s.`);
          recoveryCount++;
          await this.wait(delay);
          continue;
        }
        failuresWithoutProgress = pending ? ++pending.failures : failuresWithoutProgress + 1;
        this.store.log(`Falha de carregamento ou execução: ${account?.name || 'Conta'} · vídeo ${pending?.videoId || '—'} · ${error.message}`);
        if (pending && this.attemptsFor(accountId, pending.videoId)) {
          workerState.seen.add(pending.videoId);
          workerState.pending = null;
          failuresWithoutProgress = 0;
        } else if (failuresWithoutProgress >= 3) {
          const win = this.getWindow?.(accountId);
          if (win && !win.isDestroyed()) win.destroy();
          this.workerStatus(ctx, 'recovering', 'Reabrindo navegador após falhas repetidas');
          this.store.log(`Recuperação automática: ${account.name} · navegador reiniciado após falhas repetidas.`);
          if (pending) pending.failures = 0;
          failuresWithoutProgress = 0;
        }
        this.update({ message: `${account?.name || 'Conta'}: retomando a etapa pendente…` });
        await this.wait(Math.min(5000, 1000 * failuresWithoutProgress));
      }
    }
    return null;
  }
  async run(campaign) {
    this.sessionLimit = campaign.sessionLimit;
    const results = await Promise.all(campaign.accountIds.map(async accountId => {
      try { return await this.runAccountRecovering(accountId, campaign); }
      catch (error) {
        if (this.stopRequested) throw error;
        const account = this.store.data.accounts.find(item => item.id === accountId);
        this.store.log(`Conta interrompida: ${account?.name || 'Conta'} · ${error.message}`);
        return { accountId, error };
      }
    }));
    const failures = results.filter(Boolean);
    this.challengeAccounts.clear();
    this.releaseAttention();
    if (failures.length === campaign.accountIds.length && !this.current.posted) throw failures[0].error;
    const detail = failures.length ? ` · ${failures.length} conta(s) exigem atenção` : '';
    this.update({ status: 'completed', message: this.current.posted ? `${this.current.posted} comentário(s) confirmado(s)${detail}.` : 'Sem vídeos novos ou limite por hora atingido.' });
    this.store.log(`Campanha finalizada: ${this.current.posted} comentário(s) confirmado(s)${detail}.`);
  }
}
module.exports = { Automation, videoKey, videoAuthor, isOwnVideo, targetURL, campaignTargets, discoverVideos, trackPlayback, playbackFinished, inspectEngagement, inspectChallenge, inspectSkippableContent, inspectVideo, activeFeedVideo };
