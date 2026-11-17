'use strict';

const signupURL = 'https://www.instagram.com/accounts/emailsignup/';
const signupPath = '^/accounts/(?:emailsignup|signup)(?:/|$)';

function isInstagramSignup(value) {
  try {
    const url = new URL(value);
    return ['https://www.instagram.com', 'https://instagram.com'].includes(url.origin) && new RegExp(signupPath).test(url.pathname);
  } catch { return false; }
}

function fillSignup(profile, pathPattern, expiresAt) {
  if (!['https://www.instagram.com', 'https://instagram.com'].includes(location.origin) || !new RegExp(pathPattern).test(location.pathname)) return;
  const task = Symbol.for('comment-studio.instagram-signup-fill');
  if (window[task]?.expiresAt === expiresAt) return;
  window[task]?.stop();
  const touched = new WeakSet();
  const filled = new WeakSet();
  const handleAttempts = new WeakMap();
  const monthNames = [
    'janeiro january', 'fevereiro february', 'marco march', 'abril april',
    'maio may', 'junho june', 'julho july', 'agosto august',
    'setembro september', 'outubro october', 'novembro november', 'dezembro december'
  ];
  const visible = field => field.getClientRects().length > 0 && getComputedStyle(field).visibility === 'visible';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f\u200b-\u200f\ufeff]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const handleLabel = /^(?:nome de usuario|nome de utilizador|user ?name|usuario|utilizador|ig username|ig user name|screen name|handle)$/;
  const labelText = label => {
    const copy = label.cloneNode(true);
    for (const control of copy.querySelectorAll('input, select, textarea, button')) control.remove();
    return copy.textContent;
  };
  const describe = field => {
    const referencedLabels = (field.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(labelText);
    const labels = Array.from(field.labels || [], labelText);
    const nearbyLabels = [];
    let wrapper = field.parentElement;
    for (let depth = 0; depth < 4 && wrapper; depth++, wrapper = wrapper.parentElement) {
      if (wrapper.querySelectorAll('input:not([type="hidden"]), select, [role="combobox"], [aria-haspopup="listbox"]').length !== 1) break;
      nearbyLabels.push(normalize(labelText(wrapper)));
    }
    return [field.name, field.id, field.autocomplete, field.title, field.getAttribute('aria-label'), field.getAttribute('placeholder'), ...referencedLabels, ...labels].map(normalize)
      .concat(nearbyLabels.filter(value => /^(nome de usuario|nome de utilizador|username|nome completo|full name|numero de celular ou email|mobile number or email)(?: \1)?$/.test(value)));
  };
  const matches = (descriptions, pattern) => descriptions.some(value => pattern.test(value));
  function hasNearbyHandleLabel(field) {
    let wrapper = field;
    for (let depth = 0; depth < 5 && wrapper.parentElement; depth++, wrapper = wrapper.parentElement) {
      if (wrapper !== field && wrapper.querySelectorAll('input:not([type="hidden"])').length !== 1) break;
      const previous = wrapper.previousElementSibling;
      if (previous && !previous.matches('input, select, button') && !previous.querySelector('input, select, button') && handleLabel.test(normalize(previous.textContent))) return true;
      if (wrapper === field) continue;
      for (const label of wrapper.querySelectorAll('label, span, div, p')) {
        if (!label.querySelector('input, select, button') && handleLabel.test(normalize(label.textContent))) return true;
      }
    }
    return false;
  }
  function datePart(description) {
    if (matches(description, /\b(?:month|mes|bdaymonth)\b/)) return 'month';
    if (matches(description, /\b(?:day|dia|bdayday)\b/)) return 'day';
    if (matches(description, /\b(?:year|ano|bdayyear)\b/)) return 'year';
    return null;
  }
  function optionMatches(option, part, value) {
    const month = part === 'month' ? monthNames[value - 1].split(' ') : [];
    const labels = [option.textContent, option.getAttribute('aria-label')].map(normalize).filter(Boolean);
    if (part === 'month' && labels.some(label => /^[a-z]+$/.test(label))) {
      return labels.some(label => month.some(name => label === name || label === name.slice(0, 3)));
    }
    return [...labels, option.value, option.getAttribute('data-value')].some(raw => {
      const text = normalize(raw);
      return text && Number(text) === value;
    });
  }
  const listboxSelector = '[role="listbox"], [role="menu"]';
  const menuSelector = '[role="combobox"], [aria-haspopup="listbox"], button, [role="button"]';
  let openMenu;
  function selectDateMenu(menu, part, value) {
    if (!openMenu) {
      const before = new Set(Array.from(document.querySelectorAll(listboxSelector)).filter(visible));
      openMenu = { menu, part, value, before, deadline: Date.now() + 2500 };
      if (menu.getAttribute('aria-expanded') !== 'true') menu.click();
    }
    const ids = [menu.getAttribute('aria-controls'), menu.getAttribute('aria-owns')].filter(Boolean).flatMap(value => value.split(/\s+/));
    const owned = ids.map(id => document.getElementById(id)).filter(node => node && visible(node));
    const newLists = Array.from(document.querySelectorAll(listboxSelector)).filter(node => visible(node) && !openMenu.before.has(node));
    const list = owned[0] || (newLists.length === 1 ? newLists[0] : null);
    const option = list && Array.from(list.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], button, li[data-value]'))
      .find(item => visible(item) && !item.disabled && item.getAttribute('aria-disabled') !== 'true' && optionMatches(item, part, value));
    if (option) {
      option.click();
    } else if (Date.now() < openMenu.deadline && menu.isConnected) {
      return;
    } else if (menu.getAttribute('aria-expanded') === 'true') {
      menu.click();
    }
    filled.add(menu);
    openMenu = undefined;
  }
  function setValue(field, value, prototype) {
    if (field.value === value) { filled.add(field); return; }
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    if (field.value === value) filled.add(field);
  }
  function fill() {
    if (Date.now() >= expiresAt || !new RegExp(pathPattern).test(location.pathname)) { stop(); return; }
    for (const field of document.querySelectorAll('input, select')) {
      if (touched.has(field) || filled.has(field) || field.disabled || field.readOnly || !visible(field)) continue;
      const description = describe(field);
      if (field instanceof HTMLSelectElement) {
        const date = profile.birthDate;
        if (!date) continue;
        const part = datePart(description);
        if (!part) continue;
        const option = Array.from(field.options).find(item => !item.disabled && item.value && optionMatches(item, part, date[part]));
        if (option) setValue(field, option.value, HTMLSelectElement.prototype);
      } else if (!field.value && ['text', 'search', 'email', 'tel', 'password'].includes(field.type)) {
        let value;
        let isHandle = false;
        if (matches(description, /\b(?:confirm|re ?enter|repetir|confirmar|confirmation)\b/)) continue;
        if (field.type === 'email' || matches(description, /\b(?:e ?mail|emailorphone|emailorusername|mobile ?number|telefone|celular)\b/)) value = profile.email;
        else if (field.type === 'password' || matches(description, /\b(?:password|senha)\b/)) value = profile.password;
        else if (matches(description, /\b(?:user ?name|usuario|nome de utilizador|screen name)\b/) || hasNearbyHandleLabel(field)) {
          isHandle = true;
          value = profile.handle;
        }
        else if (matches(description, /^(?:name|nome)$|\b(?:full ?name|nome completo)\b/)) value = profile.fullName;
        if (value) {
          if (isHandle) {
            const attempts = handleAttempts.get(field) || 0;
            if (attempts >= 3) continue;
            handleAttempts.set(field, attempts + 1);
          }
          field.focus({ preventScroll: true });
          if (!field.value) setValue(field, value, HTMLInputElement.prototype);
          field.blur();
          // Some versions replace the value asynchronously during username validation.
          if (isHandle) filled.delete(field);
        }
      }
    }
    if (!profile.birthDate) return;
    if (openMenu) {
      const { menu, part, value } = openMenu;
      selectDateMenu(menu, part, value);
      return;
    }
    for (const menu of document.querySelectorAll(menuSelector)) {
      if (filled.has(menu) || touched.has(menu) || menu.matches('input, select, :disabled, [aria-disabled="true"]') || !visible(menu)) continue;
      const part = datePart([normalize(menu.textContent), ...describe(menu)].filter(text => /^(?:birthday )?(?:day|dia|month|mes|year|ano)$/.test(text)));
      if (!part) continue;
      selectDateMenu(menu, part, profile.birthDate[part]);
      break;
    }
  }
  const remember = event => {
    if (!event.isTrusted) return;
    touched.add(event.target);
    const menu = event.target.closest?.(menuSelector);
    if (menu) touched.add(menu);
  };
  function stop() {
    clearInterval(timer);
    document.removeEventListener('input', remember, true);
    document.removeEventListener('change', remember, true);
    document.removeEventListener('click', remember, true);
    delete window[task];
  }
  document.addEventListener('input', remember, true);
  document.addEventListener('change', remember, true);
  document.addEventListener('click', remember, true);
  // Signup may show the birth date only after the user advances from the first form.
  const timer = setInterval(fill, 500);
  window[task] = { expiresAt, stop };
  fill();
}

const active = new WeakMap();
function startInstagramSignupFill(contents, profile) {
  active.get(contents)?.();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const { fullName, handle, email, password, birthDate } = profile;
  const script = `(${fillSignup.toString()})(${JSON.stringify({ fullName, handle, email, password, birthDate })}, ${JSON.stringify(signupPath)}, ${expiresAt})`;
  const inject = () => {
    if (!contents.isDestroyed() && isInstagramSignup(contents.getURL())) {
      void contents.executeJavaScript(script).catch(() => {});
    }
  };
  const stop = () => {
    clearTimeout(timeout);
    contents.removeListener('did-finish-load', inject);
    contents.removeListener('did-navigate-in-page', onInPage);
    contents.removeListener('destroyed', stop);
    active.delete(contents);
  };
  const onInPage = (_event, _url, isMainFrame) => { if (isMainFrame) inject(); };
  const timeout = setTimeout(stop, expiresAt - Date.now());
  timeout.unref();
  active.set(contents, stop);
  contents.on('did-finish-load', inject);
  contents.on('did-navigate-in-page', onInPage);
  contents.once('destroyed', stop);
  inject();
}

module.exports = { signupURL, isInstagramSignup, fillSignup, startInstagramSignupFill };
