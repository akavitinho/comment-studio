// Self-contained: serialized into the isolated account page. Never accepts script text.
function xPage(operation = 'inspect', args = {}) {
  const visible = node => Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  const key = href => { try { const u = new URL(href, location.href); return u.origin === 'https://x.com' ? u.pathname.match(/^\/(\w+)\/status\/(\d+)\/?$/) : null; } catch { return null; } };
  const point = node => {
    if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return null;
    node.scrollIntoView({ block: 'center', inline: 'center' });
    if (!visible(node)) return null;
    const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    return node.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  };
  const handle = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href')?.match(/^\/(\w+)\/?$/)?.[1] || null;
  const alerts = [...document.querySelectorAll('[role="alert"], [data-testid="toast"]')].filter(visible).map(n => n.textContent).join(' ');
  let attention = null;
  if (/\/i\/flow\/login|\/account\/access/.test(location.pathname) || visible(document.querySelector('input[autocomplete="username"]'))) attention = 'Faça login ou resolva a verificação na janela do X.';
  if ([...document.querySelectorAll('iframe')].some(n => /captcha|arkose|challenge/i.test(n.src) && visible(n))) attention = 'Resolva o desafio manualmente na janela do X.';
  if (/rate limit|temporarily locked|suspended|unusual activity|try again later|limite|suspens|atividade incomum|tente novamente mais tarde|not allowed|não permitido/i.test(alerts)) attention = 'O X restringiu a interação. Confira a janela antes de continuar.';
  const articles = [...document.querySelectorAll('article[data-testid="tweet"]')].filter(visible);
  const posts = articles.flatMap(article => {
    const time = article.querySelector('time');
    const anchor = time?.closest('a');
    const match = key(anchor?.href);
    if (!match) return [];
    return [{ id: match[2], author: match[1], url: `https://x.com/${match[1]}/status/${match[2]}`, at: time.getAttribute('datetime'),
      ad: Boolean(article.closest('[data-testid="placementTracking"]') || article.querySelector('[data-testid="placementTracking"], [data-testid="promotedIndicator"]')) || [...article.querySelectorAll('span')].some(n => /^(Promoted|Ad|Promovido|Publicidade|Anúncio)$/.test(n.textContent.trim())),
      liked: Boolean(article.querySelector('[data-testid="unlike"]')), text: article.querySelector('[data-testid="tweetText"]')?.textContent || '' }];
  });
  const article = articles.find(node => key(node.querySelector('time')?.closest('a')?.href)?.[2] === args.id);
  const feedTab = [...document.querySelectorAll('[role="tab"]')].find(n => visible(n) && /^(For you|Para voc[eê])$/i.test(n.textContent.trim()));
  const feedSelected = Boolean(feedTab && feedTab.getAttribute('aria-selected') === 'true');
  if (operation === 'feedTab') return point(feedTab);
  if (operation === 'point') return point(article?.querySelector(`[data-testid="${args.action === 'like' ? 'like' : 'reply'}"]`));
  if (operation === 'editor' || operation === 'send' || operation === 'diagnoseEditor' || operation === 'selectOwnedDraft' || operation === 'focusEditor') {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const matchesTarget = scope => {
      const links = [...scope.querySelectorAll('a[href]')];
      const parentLinks = links.map(a => key(a.href)).filter(Boolean);
      if (parentLinks.some(match => match[2] === args.id)) return true;
      // Some reply previews omit the parent's permalink. Bind the composer to
      // the author AND exact text captured from the target before opening it.
      // An explicit link to a different parent must never use this fallback.
      if (parentLinks.length || !args.parentText || !args.author) return false;
      const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
      const texts = [...scope.querySelectorAll('[data-testid="tweetText"]')].filter(visible);
      const author = links.some(a => { try { const u = new URL(a.href); return u.origin === 'https://x.com' && u.pathname.toLowerCase().replace(/\/$/, '') === '/' + args.author.toLowerCase(); } catch { return false; } }) || [...scope.querySelectorAll('span')].some(n => normalize(n.textContent).toLowerCase() === '@' + args.author.toLowerCase());
      return author && texts.length === 1 && normalize(texts[0].textContent) === normalize(args.parentText);
    };
    let dialog = dialogs.find(matchesTarget);
    // Narrow windows use a full-page composer instead of role=dialog.
    // Only accept it on a compose route (or the exact target post), with
    // explicit evidence of the parent post and exactly one visible editor.
    if (!dialog && !dialogs.length && (/^\/compose\/(post|tweet)\/?$/.test(location.pathname) || key(location.href)?.[2] === args.id)) {
      const main = document.querySelector('main');
      if (main && matchesTarget(main) && [...main.querySelectorAll('[contenteditable="true"][data-testid^="tweetTextarea_"]')].filter(visible).length === 1) dialog = main;
    }
    const editors = dialog ? [...dialog.querySelectorAll('[contenteditable="true"][data-testid^="tweetTextarea_"]')].filter(visible) : [];
    const editor = editors.length === 1 ? editors[0] : null;
    if (operation === 'focusEditor') {
      if (!editor || !point(editor)) return false;
      editor.focus();
      return editor === document.activeElement || editor.contains(document.activeElement);
    }
    if (operation === 'diagnoseEditor') return { dialogs: dialogs.length, matched: Boolean(dialog), editors: editors.length, totalEditors: [...document.querySelectorAll('[contenteditable="true"][data-testid^="tweetTextarea_"]')].filter(visible).length, point: Boolean(point(editor)), focused: Boolean(editor && (editor === document.activeElement || editor.contains(document.activeElement))), draftLength: editor?.textContent?.length || 0 };
    if (!dialog) return null;
    if (operation === 'selectOwnedDraft') {
      if (!editor || editor.textContent !== args.text || !point(editor)) return false;
      editor.focus();
      const range = document.createRange(); range.selectNodeContents(editor);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return true;
    }
    if (operation === 'editor') return { point: point(editor), text: editor?.textContent || '', focused: Boolean(editor && (editor === document.activeElement || editor.contains(document.activeElement))) };
    if (!editor || editor.textContent !== args.text) return null;
    return point(dialog.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
  }
  if (operation === 'scroll') { window.scrollBy(0, Math.max(600, innerHeight * 0.8)); return true; }
  const empty = [...document.querySelectorAll('[data-testid="emptyState"]')].some(visible);
  return { handle, attention, posts, empty, feedSelected, dialogOpen: [...document.querySelectorAll('[role="dialog"]')].some(visible), recognized: Boolean(handle && (posts.length || empty)), url: location.href };
}
module.exports = { xPage };
