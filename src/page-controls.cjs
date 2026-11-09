// These helpers are serialized together into the account renderer; no Node APIs.
function pageVisible(node) {
  if (!node) return false;
  const r = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0
    && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
}
function controlPoint(node) {
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const x = Math.round((Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2);
  const y = Math.round((Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2);
  if (!pageVisible(node) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
  if (document.elementFromPoint) {
    const hit = document.elementFromPoint(x, y);
    const editorRoot = node.isContentEditable ? node.closest('[data-e2e="comment-input"], [class*="DraftEditor-root"]') || node.parentElement?.parentElement : null;
    if (hit && hit !== node && !node.contains(hit) && !editorRoot?.contains(hit)) return null;
  }
  return { x, y };
}
function exposeControl(node) {
  if (!node) return null;
  if (controlPoint(node)) return controlPoint(node);
  for (let parent = node.parentElement; parent && !['BODY', 'HTML'].includes(parent.tagName); parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!/(auto|scroll)/.test(style.overflowY || '') || parent.scrollHeight <= parent.clientHeight) continue;
    const item = node.getBoundingClientRect();
    const area = parent.getBoundingClientRect();
    if (item.bottom > area.bottom) parent.scrollTop += item.bottom - area.bottom + 12;
    else if (item.top < area.top) parent.scrollTop -= area.top - item.top + 12;
    break;
  }
  return controlPoint(node);
}
function activeVideoScope() {
  const videos = [...document.querySelectorAll('video')].filter(pageVisible);
  videos.sort((a, b) => {
    const area = node => { const r = node.getBoundingClientRect(); return (Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * (Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); };
    return area(b) - area(a);
  });
  const video = videos[0];
  // TikTok can keep the video element transparent or outside the viewport while
  // the video page and its comment panel are already visible.
  if (!video) return /\/@[^/]+\/video\/\d+/.test(location.pathname) ? document.body : null;
  // The player itself may carry browse-video. The editor often lives in a sibling panel.
  const ancestors = [];
  for (let node = video.parentElement; node && !['BODY', 'HTML'].includes(node.tagName); node = node.parentElement) ancestors.push(node);
  const panelSelector = '[data-e2e="comment-input"], [data-e2e="comment-disabled"], [data-e2e="comment-empty"], [data-e2e="comment-tab"], [data-e2e="comments"], [role="tab"]';
  return ancestors.find(node => node.querySelector(panelSelector))
    || ancestors.find(node => node.matches('main, [role="main"], [role="dialog"], [class*="DivBrowserModeContainer"]'))
    || ancestors.find(node => node.matches('article, [data-e2e="recommend-list-item-container"]'))
    || (/\/@[^/]+\/video\/\d+/.test(location.pathname) ? document.body : null);
}
function commentControls() {
  const scope = activeVideoScope();
  if (!scope) return { scope: null, editor: null, post: null, tab: null, icon: null, disabled: false };
  const first = selector => [...scope.querySelectorAll(selector)].find(pageVisible);
  const available = node => {
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
  };
  const editor = [...scope.querySelectorAll('[data-e2e="comment-input"] [contenteditable], [data-e2e="comment-input"][contenteditable], [role="textbox"][contenteditable], textarea[data-e2e*="comment"]')]
    .find(node => available(node) && (node.isContentEditable || node.tagName === 'TEXTAREA')) || null;
  const post = [...scope.querySelectorAll('[data-e2e="comment-post"], button[data-e2e*="comment-post"]')].find(available) || null;
  const exactCommentLabel = node => /^(comentários|comments)(\s*\d+)?$/i.test((node.textContent || '').trim());
  const tabs = [...scope.querySelectorAll('[role="tab"], button, [data-e2e="comment-tab"], [data-e2e="comments"], div, span')]
    .filter(node => available(node) && pageVisible(node) && exactCommentLabel(node));
  const tab = tabs.find(node => node.matches('button, [role="tab"]'))
    || tabs.find(node => getComputedStyle(node).cursor === 'pointer')
    || tabs.sort((a, b) => {
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      return ar.width * ar.height - br.width * br.height;
    })[0] || null;
  const icon = first('[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"]');
  // Do not mistake text written by a commenter for a disabled-comments notice.
  const notices = [...scope.querySelectorAll('[data-e2e="comment-disabled"], [data-e2e="comment-empty"], [role="status"]')].filter(pageVisible);
  const disabled = notices.some(node => /comentários (estão )?desativados|comments (are |have been )?(turned off|disabled)/i.test(node.textContent));
  return { scope, editor, post, tab, icon, disabled };
}
function commentOpenPoint() {
  const { tab, icon } = commentControls();
  const node = tab || icon;
  const point = exposeControl(node);
  if (point || !tab || !pageVisible(tab) || !document.elementFromPoint) return point;
  const r = tab.getBoundingClientRect();
  const x = Math.round((r.left + r.right) / 2), y = Math.round((r.top + r.bottom) / 2);
  const hit = document.elementFromPoint(x, y);
  if (hit?.contains(tab) && /^(comentários|comments)(\s*\d+)?$/i.test((hit.textContent || '').trim())) return { x, y };
  return null;
}
function clickCommentTab() {
  const { tab, icon } = commentControls();
  const node = tab || icon;
  if (!node || !pageVisible(node)) return false;
  const target = node.closest('button, [role="tab"], [role="button"], [data-e2e="comment-tab"]') || node;
  if (target.matches('[disabled], [aria-disabled="true"]')) return false;
  target.click();
  return true;
}
function inspectIdentity() {
  const excluded = 'main, [role="main"], article, [role="dialog"], [data-e2e="browse-video"], [data-e2e="comment-list"], [data-e2e="comment-level-1"], [data-e2e="related-video"], [class*="DivRecommendList"], [data-e2e="recommend-list-item-container"]';
  const roots = [...document.querySelectorAll('nav, [role="navigation"], [data-e2e="side-nav"], [class*="DivSideNavContainer"]')].filter(root => !root.closest(excluded));
  const candidates = roots.flatMap(root => [...root.querySelectorAll('a[href]')]);
  const handles = new Set();
  for (const link of candidates) {
    if (!pageVisible(link) || link.closest(excluded)) continue;
    const label = (link.getAttribute('aria-label') || link.getAttribute('title') || link.textContent || '').trim();
    if (link.dataset.e2e !== 'nav-profile' && !/^(perfil|profile|meu perfil|your profile)$/i.test(label)) continue;
    try {
      const url = new URL(link.href, location.origin);
      const match = url.pathname.match(/^\/@([^/]+)\/?$/);
      if (url.origin === location.origin && match) handles.add(decodeURIComponent(match[1]).toLowerCase());
    } catch {}
  }
  return { handles: handles.size === 1 ? [...handles] : [], source: handles.size === 1 ? 'session-navigation' : 'unresolved' };
}
function inspectVideoAliases(expectedId) {
  // A stale canonical on the feed or another video is not evidence of an alias.
  if (location.pathname.match(/\/video\/(\d+)\/?$/)?.[1] !== expectedId) return [];
  const urls = [location.href, document.querySelector('link[rel="canonical"]')?.href];
  return urls.filter(value => {
    try { const url = new URL(value); return url.origin === location.origin && url.pathname.match(/\/video\/(\d+)\/?$/)?.[1] === expectedId; }
    catch { return false; }
  });
}
module.exports = { pageVisible, controlPoint, exposeControl, activeVideoScope, commentControls, commentOpenPoint, clickCommentTab, inspectIdentity, inspectVideoAliases };
