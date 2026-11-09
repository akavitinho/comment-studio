const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const campaignForm = $('#campaign-form');
const targetStorage = campaignForm.elements.target;
targetStorage.hidden = true;
targetStorage.required = false;
const targetTags = element('div', 'target-tags');
const targetEntry = element('input');
targetEntry.type = 'text'; targetEntry.maxLength = 500;
targetEntry.setAttribute('aria-label', 'Adicionar palavra, frase ou hashtag');
const targetAdd = element('button', 'secondary', 'Adicionar'); targetAdd.type = 'button';
const targetEditor = element('div', 'target-editor');
targetEditor.append(targetTags, targetEntry, targetAdd);
targetStorage.after(targetEditor);
function targetItems() {
  return [...new Set(targetStorage.value.split(campaignForm.elements.targetType.value === 'hashtag' ? /[\s,;]+/ : /\r?\n/).map(value => value.trim().replace(campaignForm.elements.targetType.value === 'hashtag' ? /^#+/ : /^$/, '')).filter(Boolean))];
}
function saveTargetItems(items) {
  targetStorage.value = items.join(campaignForm.elements.targetType.value === 'hashtag' ? ', ' : '\n');
  targetStorage.dispatchEvent(new Event('input', { bubbles: true }));
}
function addTargetItem() {
  const value = targetEntry.value.trim();
  if (!value) return;
  const added = campaignForm.elements.targetType.value === 'hashtag' ? value.split(/[\s,;]+/).map(item => item.replace(/^#+/, '')).filter(Boolean) : value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  const items = [...new Set([...targetItems(), ...added])];
  if (items.length > 20 || items.join('\n').length > 500) { notify('Use até 20 itens e 500 caracteres no total.', true); return; }
  targetEntry.value = ''; saveTargetItems(items); targetEntry.focus();
}
targetAdd.addEventListener('click', addTargetItem);
targetEntry.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTargetItem(); } });
function renderTargetTags() {
  targetTags.replaceChildren();
  const items = targetItems();
  items.forEach((value, index) => {
    const tag = element('span', 'target-tag');
    tag.append(element('span', '', campaignForm.elements.targetType.value === 'hashtag' ? '#' + value : value));
    const remove = element('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Remover ${value}`);
    remove.addEventListener('click', () => saveTargetItems(items.filter((_, i) => i !== index)));
    tag.append(remove); targetTags.append(tag);
  });
  targetEntry.placeholder = campaignForm.elements.targetType.value === 'hashtag' ? 'Adicionar hashtag' : 'Adicionar palavra ou frase';
}
let state = { accounts: [], proxies: [], campaign: null, events: [] };
let campaignDirty = false;
let currentPage = 'dashboard';
let historyFilter = 'all';
let historyPage = 1;
let historyPageSize = 10;
let dashboardRefreshing = false;
let dashboardBackgroundRefreshing = false;
let dashboardCompletedRefreshId = '';
let dashboardAutoTimer = null;
let dashboardAutoRun = false;
let dashboardRefreshMessage = '';
const pageNames = { dashboard: 'Dashboard', campaign: 'Campanha TikTok', x: 'Campanha Twitter (X)', accounts: 'Contas', proxies: 'Proxies', media: 'Preparar mídia', postings: 'Postagens Instagram', history: 'Histórico' };
const accountForm = $('#account-form');
const proxyForm = $('#proxy-form');
const bulkRows = $('#bulk-account-rows');
const bulkProxyForm = $('#bulk-proxy-form');
const bulkDialog = $('#bulk-accounts-dialog');
const collapsedAccountGroups = new Set();
let bulkProxyTarget = null;
const mediaForm = $('#media-form');
const mediaState = { videos: [], images: [], cover: null, outputDir: null, running: false };
const downloadState = { links: [], ignoredCount: 0, totalFound: 0, running: false, analysisError: null };
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-pressed', String(theme === 'dark'));
  $('#theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
  $('.theme-label').textContent = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
  localStorage.setItem('comment-studio-theme', theme);
}
setTheme(localStorage.getItem('comment-studio-theme') === 'light' ? 'light' : 'dark');
$('#theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  $('#sidebar-collapse').setAttribute('aria-expanded', String(!collapsed));
  $('#sidebar-collapse').setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
  localStorage.setItem('comment-studio-sidebar-collapsed', String(collapsed));
}
setSidebarCollapsed(localStorage.getItem('comment-studio-sidebar-collapsed') === 'true');
$('#sidebar-collapse').addEventListener('click', () => setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed')));
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function notify(message, error = false) {
  $('#notice span').textContent = message;
  $('#notice').classList.toggle('error', error);
  $('#notice').hidden = false;
  window.scrollTo({ top: 0 });
}
$('#notice button').addEventListener('click', () => { $('#notice').hidden = true; });
function updateGroupLabels() {
  $$('.nav-group').forEach(group => group.querySelector('summary').setAttribute('aria-label', `${group.open ? 'Fechar' : 'Abrir'} ${group.querySelector('.nav-group-label').textContent}`));
}
function page(name) {
  if (!pageNames[name]) return;
  currentPage = name;
  const selectedNav = document.querySelector(`[data-page="${name}"]`);
  if (selectedNav?.closest('.nav-group')) {
    const activeGroup = selectedNav.closest('.nav-group');
    $$('.nav-group').forEach(group => { group.open = group === activeGroup; });
  } else if (selectedNav?.closest('.nav-general')) $$('.nav-group').forEach(group => { group.open = false; });
  updateGroupLabels();
  $$('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
  $$('[data-page]').forEach(button => { const active = button.dataset.page === name; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#breadcrumb').textContent = pageNames[name];
  $('#notice').hidden = true;
  window.scrollTo({ top: 0 });
}
$$('[data-page]').forEach(button => button.addEventListener('click', () => page(button.dataset.page)));
$$('.nav-group').forEach(group => group.querySelector('summary').addEventListener('click', event => {
  event.preventDefault();
  if (document.body.classList.contains('sidebar-collapsed')) {
    setSidebarCollapsed(false);
    $$('.nav-group').forEach(other => { other.open = other === group; });
    updateGroupLabels();
    return;
  }
  const open = !group.open;
  $$('.nav-group').forEach(other => { other.open = other === group && open; });
  updateGroupLabels();
}));
updateGroupLabels();
$$('[data-go]').forEach(button => button.addEventListener('click', () => page(button.dataset.go)));
$('.brand').addEventListener('click', event => { event.preventDefault(); if (document.body.classList.contains('sidebar-collapsed')) setSidebarCollapsed(false); else page('dashboard'); });
function empty(title, detail, symbol) { const node = element('div', 'empty-state'); node.append(element('span', 'empty-symbol', symbol), element('h2', '', title), element('p', '', detail)); return node; }
function formatDate(value) { return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function fileName(value) { return String(value || '').split(/[\\/]/).pop(); }
function platformName(value) { return value === 'instagram' ? 'Instagram' : value === 'x' ? 'Twitter (X)' : 'TikTok'; }
function profileLabel(account) { return account.handle ? `@${account.handle}` : account.name; }
function platformIcon(value) {
  const platform = ['instagram', 'x'].includes(value) ? value : 'tiktok';
  const icon = element('span', `platform-icon platform-${platform}`);
  const image = element('img'); image.src = `icons/${platform}.svg`; image.alt = '';
  icon.append(image);
  icon.dataset.platform = platform;
  icon.setAttribute('aria-hidden', 'true');
  icon.title = platformName(platform);
  return icon;
}
const accountPhotoObserver = new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    accountPhotoObserver.unobserve(target);
    window.studio.postingProfilePicture?.(target.dataset.accountId).then(photo => {
      if (!photo || !target.isConnected) return;
      const image = element('img', 'account-profile-photo');
      image.alt = '';
      image.addEventListener('load', () => target.replaceChildren(image), { once: true });
      image.src = photo;
    }).catch(() => {});
  }
});
function notifyBulk(message, error = false) {
  if (!bulkDialog.open) return notify(message, error);
  const feedback = $('#bulk-feedback');
  feedback.textContent = message;
  feedback.classList.toggle('record-error', error);
  feedback.hidden = false;
  feedback.scrollIntoView({ block: 'nearest' });
}
$('#open-bulk-accounts').addEventListener('click', () => {
  bulkDialog.showModal();
  $('#bulk-handles').focus();
});
$('#close-bulk-accounts').addEventListener('click', () => bulkDialog.close());
async function action(button, fn, success) {
  const previous = button.textContent;
  button.disabled = true; button.textContent = 'Aguarde…';
  try { const result = await fn(); if (result?.accounts) { state = result; render(); } if (success) notify(success); return true; }
  catch (error) { notify(error.message, true); return false; }
  finally { button.disabled = false; button.textContent = previous; }
}
function actionButton(label, fn, kind = 'secondary') { const button = element('button', kind, label); button.type = 'button'; button.addEventListener('click', () => action(button, fn)); return button; }
function refreshBulkProxyOptions() {
  for (const select of bulkRows.querySelectorAll('.bulk-proxy-select')) {
    const selected = select.value;
    select.replaceChildren(new Option('Conexão direta', ''), ...state.proxies.map(proxy => new Option(proxy.name, proxy.id)));
    select.value = selected;
  }
}
function prepareBulkAccounts() {
  const handles = $('#bulk-handles').value.split(/[\r\n,;]+/).map(value => value.trim().replace(/^@/, '')).filter(Boolean);
  const count = handles.length;
  const previousProxies = new Map([...bulkRows.querySelectorAll('.bulk-account-row')].map(row => [row.querySelector('.bulk-handle').value, row.querySelector('.bulk-proxy-select').value]));
  bulkRows.replaceChildren();
  bulkProxyForm.hidden = true; bulkProxyTarget = null;
  $('#bulk-save').hidden = !count || count > 50;
  $('#bulk-progress').textContent = '';
  if (!count || count > 50) return;
  for (let index = 0; index < count; index++) {
    const row = element('div', 'bulk-account-row');
    row.append(element('span', 'bulk-row-number', String(index + 1).padStart(2, '0')));
    const handleLabel = element('label', '', '@ do perfil');
    const handle = element('input'); handle.type = 'text'; handle.maxLength = 80; handle.value = handles[index]; handle.className = 'bulk-handle'; handle.readOnly = true;
    handleLabel.append(handle);
    const proxyLabel = element('label', '', 'Conexão');
    const select = element('select', 'bulk-proxy-select'); select.setAttribute('aria-label', `Conexão do perfil ${index + 1}`); proxyLabel.append(select);
    const addProxy = element('button', 'secondary', '+ Nova proxy'); addProxy.type = 'button';
    addProxy.addEventListener('click', () => {
      bulkProxyTarget = select; bulkProxyForm.reset();
      bulkProxyForm.elements.name.value = handle.value.trim() ? `Proxy @${handle.value.trim().replace(/^@/, '')}` : `Proxy do perfil ${index + 1}`;
      bulkProxyForm.hidden = false; bulkProxyForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      bulkProxyForm.elements.paste.focus();
    });
    row.append(handleLabel, proxyLabel, addProxy, element('small', 'bulk-row-status', 'Pendente'));
    bulkRows.append(row);
  }
  refreshBulkProxyOptions();
  for (const row of bulkRows.querySelectorAll('.bulk-account-row')) row.querySelector('.bulk-proxy-select').value = previousProxies.get(row.querySelector('.bulk-handle').value) || '';
  $('#bulk-progress').textContent = `${count} ${count === 1 ? 'perfil' : 'perfis'} para cadastrar`;
}
$('#bulk-handles').addEventListener('input', () => {
  $('#bulk-feedback').hidden = true;
  const count = $('#bulk-handles').value.split(/[\r\n,;]+/).map(value => value.trim().replace(/^@/, '')).filter(Boolean).length;
  $('#bulk-count-preview').textContent = count > 50 ? `${count} perfis informados · máximo de 50` : count ? `${count} ${count === 1 ? 'perfil informado' : 'perfis informados'}` : 'Nenhum perfil informado';
  prepareBulkAccounts();
});
$('#bulk-proxy-cancel').addEventListener('click', () => { bulkProxyForm.hidden = true; bulkProxyTarget = null; bulkProxyForm.reset(); });
bulkProxyForm.elements.paste.addEventListener('input', event => {
  const input = event.currentTarget; input.setCustomValidity('');
  if (!input.value.trim()) return;
  try {
    const parsed = window.parseProxyLine(input.value);
    for (const [key, value] of Object.entries(parsed)) bulkProxyForm.elements.namedItem(key).value = value;
  } catch (error) { input.setCustomValidity(error.message); }
});
bulkProxyForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter || bulkProxyForm.querySelector('button[type=submit]');
  if (!bulkProxyTarget) { notifyBulk('Escolha o perfil para esta proxy.', true); return; }
  const data = formData(bulkProxyForm);
  if (data.paste?.trim()) {
    try { Object.assign(data, window.parseProxyLine(data.paste)); }
    catch (error) { notifyBulk(error.message, true); return; }
  }
  delete data.paste;
  submit.disabled = true;
  try {
    const existing = new Set(state.proxies.map(proxy => proxy.id));
    const next = await window.studio.addProxy(data);
    const created = next.proxies.find(proxy => !existing.has(proxy.id));
    if (!created) throw new Error('A proxy foi salva, mas não apareceu na lista. Atualize o estado.');
    state = next; render(); bulkProxyTarget.value = created.id;
    bulkProxyForm.hidden = true; bulkProxyTarget = null; bulkProxyForm.reset();
    notifyBulk(`Proxy ${created.name} cadastrada e selecionada para o perfil.`);
  } catch (error) { notifyBulk(error.message, true); }
  finally { submit.disabled = false; }
});
$('#bulk-save').addEventListener('click', async event => {
  const rows = [...bulkRows.querySelectorAll('.bulk-account-row')].filter(row => row.dataset.created !== 'true');
  if (!rows.length) return;
  const platform = $('#bulk-platform').value;
  const seen = new Set(state.accounts.filter(account => (account.platform || 'tiktok') === platform).map(account => account.handle?.toLocaleLowerCase('pt-BR')).filter(Boolean));
  const pending = [];
  for (const row of rows) {
    const handle = row.querySelector('.bulk-handle').value.trim().replace(/^@/, '');
    const name = handle;
    const proxyId = row.querySelector('.bulk-proxy-select').value;
    if (!handle || handle.length > 80 || /\s|@/.test(handle)) { notifyBulk('Preencha cada @ sem espaços.', true); row.querySelector('.bulk-handle').focus(); return; }
    if (seen.has(handle.toLocaleLowerCase('pt-BR'))) { notifyBulk(`@${handle} já está cadastrado ou repetido nesta lista.`, true); row.querySelector('.bulk-handle').focus(); return; }
    seen.add(handle.toLocaleLowerCase('pt-BR'));
    pending.push({ row, data: { platform, name, handle, proxyId } });
  }
  const save = event.currentTarget; save.disabled = true;
  let created = 0;
  try {
    for (const [index, item] of pending.entries()) {
      $('#bulk-progress').textContent = `Cadastrando ${index + 1} de ${pending.length}…`;
      const next = await window.studio.addAccount(item.data);
      state = next; render(); created++;
      item.row.dataset.created = 'true';
      item.row.querySelectorAll('input, select, button').forEach(control => { control.disabled = true; });
      item.row.querySelector('.bulk-row-status').textContent = 'Cadastrada';
    }
    $('#bulk-progress').textContent = `${created} ${created === 1 ? 'perfil cadastrado' : 'perfis cadastrados'}`;
    save.hidden = true;
    notifyBulk('Perfis cadastrados. Conecte ou abra cada conta para autorizar o acesso.');
  } catch (error) {
    $('#bulk-progress').textContent = `${created} cadastrado(s); ${pending.length - created} pendente(s)`;
    notifyBulk(`Cadastro interrompido: ${error.message}`, true);
  } finally { save.disabled = false; }
});
function formatLocation(location) {
  if (!location) return 'Localização indisponível';
  return [location.city, location.region !== location.city ? location.region : null, location.country].filter(Boolean).join(', ') || 'Localização indisponível';
}
function attribution(location) {
  if (!location) return null;
  const source = element('p', 'geo-source', location.network ? `Rede: ${location.network} · Estimativa: ` : 'Estimativa: ');
  const link = element('a', '', 'ipapi.is'); link.href = 'https://ipapi.is/';
  link.addEventListener('click', event => { event.preventDefault(); window.studio.openGeoSource().catch(error => notify(error.message, true)); });
  source.append(link);
  return source;
}
function resetAccountForm() {
  accountForm.reset(); accountForm.elements.id.value = '';
  $('#account-form-title').textContent = 'Adicionar conta';
  $('#account-submit').textContent = 'Adicionar conta';
  $('#account-connection-type').value = 'direct'; syncAccountConnectionType();
  if ($('#account-dialog').open) $('#account-dialog').close();
}
function syncAccountConnectionType() {
  const proxy = $('#account-connection-type').value === 'proxy';
  $('#account-proxy-field').hidden = $('#account-proxy-help').hidden = !proxy;
  $('#proxy-select').required = proxy;
  if (!proxy) $('#proxy-select').value = '';
}
$('#account-connection-type').addEventListener('change', syncAccountConnectionType);
$('#open-account-form').addEventListener('click', () => { resetAccountForm(); $('#account-dialog').showModal(); accountForm.elements.handle.focus(); });
$('#account-dialog-close').addEventListener('click', resetAccountForm);
$('#account-dialog').addEventListener('click', event => { if (event.target === $('#account-dialog')) resetAccountForm(); });
$('#account-dialog').addEventListener('close', () => { if (accountForm.elements.id.value) resetAccountForm(); });
function editAccount(account) {
  page('accounts');
  accountForm.elements.id.value = account.id;
  accountForm.elements.platform.value = account.platform || 'tiktok';
  accountForm.elements.handle.value = account.handle || '';
  $('#account-connection-type').value = account.proxyId ? 'proxy' : 'direct'; syncAccountConnectionType();
  accountForm.elements.proxyId.value = account.proxyId || '';
  $('#account-form-title').textContent = `Editar ${profileLabel(account)}`;
  $('#account-submit').textContent = 'Salvar alterações';
  if (!$('#account-dialog').open) $('#account-dialog').showModal();
  accountForm.elements.handle.focus();
}
function resetProxyForm() {
  proxyForm.reset(); proxyForm.elements.id.value = '';
  proxyPaste.setCustomValidity(''); suggestedProxyName = '';
  $('#proxy-paste-status').textContent = '';
  $('#proxy-form-error').hidden = true;
  for (const button of proxyForm.querySelectorAll('[data-reveal]')) { const input = button.dataset.reveal === 'proxy-paste' ? proxyPaste : proxyForm.elements.password; input.type = 'password'; button.textContent = 'Mostrar'; }
  $('#proxy-form-title').textContent = 'Adicionar proxy';
  $('#proxy-submit').textContent = 'Salvar proxy';
  $('#remove-credentials-row').hidden = true;
  $('#proxy-credential-help').textContent = 'Credenciais protegidas pelo Windows. SOCKS5 sem autenticação nesta versão.';
  if ($('#proxy-dialog').open) $('#proxy-dialog').close();
}
function editProxy(proxy) {
  page('proxies'); resetProxyForm();
  for (const key of ['id', 'name', 'protocol', 'host', 'port']) proxyForm.elements.namedItem(key).value = proxy[key];
  $('#proxy-form-title').textContent = `Editar ${proxy.name}`;
  $('#proxy-submit').textContent = 'Salvar alterações';
  $('#remove-credentials-row').hidden = !proxy.authenticated;
  $('#proxy-credential-help').textContent = proxy.authenticated ? 'Deixe usuário e senha vazios para manter os atuais. A edição exige fechar as janelas das contas vinculadas.' : 'SOCKS5 sem autenticação nesta versão.';
  $('#proxy-dialog').showModal();
  proxyForm.elements.name.focus();
}
$('#cancel-account-edit').addEventListener('click', resetAccountForm);
$('#cancel-proxy-edit').addEventListener('click', resetProxyForm);
$('#open-proxy-form').addEventListener('click', () => { resetProxyForm(); $('#proxy-dialog').showModal(); proxyForm.elements.name.focus(); });
$('#proxy-dialog-close').addEventListener('click', resetProxyForm);
$('#proxy-dialog').addEventListener('click', event => { if (event.target === $('#proxy-dialog')) resetProxyForm(); });
$('#proxy-dialog').addEventListener('close', () => { if (proxyForm.elements.id.value) resetProxyForm(); });
proxyForm.querySelectorAll('[data-reveal]').forEach(button => button.addEventListener('click', () => {
  const input = button.dataset.reveal === 'proxy-paste' ? proxyPaste : proxyForm.elements.password;
  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Mostrar' : 'Ocultar';
  button.setAttribute('aria-label', `${input.type === 'password' ? 'Mostrar' : 'Ocultar'} ${button.dataset.reveal === 'proxy-paste' ? 'proxy' : 'senha'}`);
}));
const proxySearch = $('#proxy-search');
const normalizedSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const proxyTestsRunning = new Set();
let proxyTestingAll = false;
let proxyView = 'proxy';
function proxyStatus(proxy) { return proxyTestsRunning.has(proxy.id) ? 'verifying' : proxy.testFailure ? 'problem' : proxy.diagnostic ? 'active' : 'untested'; }
async function testProxyOne(id, silent = false) {
  if (proxyTestsRunning.has(id)) return false;
  proxyTestsRunning.add(id); renderProxies();
  try { state = await window.studio.testProxy(id); render(); if (!silent) notify('Conexão testada.'); return true; }
  catch (error) { try { state = await window.studio.state(); render(); } catch {} if (!silent) notify(error.message, true); return false; }
  finally { proxyTestsRunning.delete(id); renderProxies(); }
}
proxySearch.addEventListener('input', renderProxies);
for (const id of ['proxy-protocol-filter', 'proxy-status-filter', 'proxy-usage-filter', 'proxy-sort']) $(`#${id}`).addEventListener('change', renderProxies);
$$('[data-proxy-view]').forEach(button => button.addEventListener('click', () => { proxyView = button.dataset.proxyView; $$('[data-proxy-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); renderProxies(); }));
$('#test-all-proxies').addEventListener('click', async event => {
  const button = event.currentTarget, ids = state.proxies.map(proxy => proxy.id);
  if (!ids.length || proxyTestingAll) return;
  proxyTestingAll = true; button.disabled = true; let passed = 0;
  try {
    for (let index = 0; index < ids.length; index++) { button.textContent = `Testando ${index + 1}/${ids.length}…`; if (await testProxyOne(ids[index], true)) passed++; }
    notify(`${passed} de ${ids.length} conexões testadas com sucesso${passed < ids.length ? ` · ${ids.length - passed} com falha` : ''}.`);
  } finally { proxyTestingAll = false; button.textContent = 'Testar conexões'; button.disabled = !state.proxies.length; }
});
function renderProxies() {
  const query = normalizedSearch(proxySearch.value.trim().replace(/^@/, ''));
  const matches = value => normalizedSearch(value).includes(query);
  const overview = $('#proxy-overview'); overview.replaceChildren();
  const lastTest = state.proxies.flatMap(proxy => [proxy.diagnostic?.at, proxy.testFailure?.at].filter(Boolean)).sort().at(-1);
  for (const [label, value, note] of [
    ['Total de proxies', state.proxies.length, 'Cadastrados'],
    ['Funcionando', state.proxies.filter(proxy => proxyStatus(proxy) === 'active').length, 'No último teste'],
    ['Com falha', state.proxies.filter(proxy => proxyStatus(proxy) === 'problem').length, 'No último teste'],
    ['Contas vinculadas', state.accounts.filter(account => account.proxyId).length, 'Usando proxy'],
    ['Último teste', lastTest ? formatDate(lastTest) : '—', lastTest ? 'Data e horário' : 'Ainda não realizado']
  ]) { const card = element('div', 'proxy-stat'); card.append(element('span', '', label), element('strong', '', String(value)), element('small', '', note)); overview.append(card); }
  $('#test-all-proxies').disabled = !state.proxies.length || proxyTestingAll;
  const profileResults = $('#proxy-profile-results'); profileResults.replaceChildren();
  const matchingAccounts = query && proxyView === 'proxy' ? state.accounts.filter(account => matches(account.name) || matches(account.handle)) : [];
  profileResults.hidden = !matchingAccounts.length;
  if (matchingAccounts.length) {
    profileResults.append(element('h2', '', 'Contas encontradas'));
    for (const account of matchingAccounts) {
      const proxy = state.proxies.find(item => item.id === account.proxyId);
      const row = element('div', 'proxy-profile-row'), info = element('div');
      info.append(element('strong', '', profileLabel(account)), element('span', '', `${platformName(account.platform || 'tiktok')} · ${proxy ? proxy.name : 'Conexão direta'}`));
      const edit = element('button', 'secondary', 'Editar conexão'); edit.type = 'button'; edit.addEventListener('click', () => editAccount(account));
      row.append(info, edit); profileResults.append(row);
    }
  }
  const list = $('#proxy-list');
  const expanded = new Set([...list.querySelectorAll('.proxy-card:has(.proxy-details[open])')].map(card => card.dataset.proxyId));
  list.replaceChildren();
  const protocol = $('#proxy-protocol-filter').value, status = $('#proxy-status-filter').value, usage = $('#proxy-usage-filter').value, sort = $('#proxy-sort').value;
  const visible = state.proxies.filter(proxy => {
    const linked = state.accounts.filter(account => account.proxyId === proxy.id);
    return (!query || [proxy.name, proxy.host, `${proxy.host}:${proxy.port}`, ...linked.flatMap(account => [account.name, account.handle])].some(matches))
      && (protocol === 'all' || proxy.protocol === protocol)
      && (status === 'all' || proxyStatus(proxy) === status)
      && (usage === 'all' || (usage === 'linked' ? linked.length > 0 : linked.length === 0));
  });
  visible.sort((a, b) => sort === 'recent' ? (Date.parse(b.testFailure?.at || b.diagnostic?.at) || 0) - (Date.parse(a.testFailure?.at || a.diagnostic?.at) || 0) : sort === 'latency' ? (a.diagnostic?.durationMs ?? Infinity) - (b.diagnostic?.durationMs ?? Infinity) : sort === 'usage' ? state.accounts.filter(account => account.proxyId === b.id).length - state.accounts.filter(account => account.proxyId === a.id).length : a.name.localeCompare(b.name, 'pt-BR'));
  if (proxyView === 'account') {
    const matching = state.accounts.filter(account => {
      const proxy = state.proxies.find(item => item.id === account.proxyId);
      return (!query || [account.name, account.handle, proxy?.name, proxy?.host].some(matches)) && (protocol === 'all' || proxy?.protocol === protocol) && (status === 'all' || (proxy && proxyStatus(proxy) === status)) && (usage === 'all' || (usage === 'linked' ? Boolean(proxy) : !proxy));
    }).sort((a, b) => profileLabel(a).localeCompare(profileLabel(b), 'pt-BR'));
    $('#proxy-search-count').textContent = `${matching.length} conta${matching.length === 1 ? '' : 's'}`;
    if (!matching.length) list.append(empty('Nenhuma conta encontrada', 'Ajuste os filtros ou cadastre uma conta.', '◎'));
    for (const account of matching) {
      const proxy = state.proxies.find(item => item.id === account.proxyId);
      const row = element('article', 'proxy-account-row');
      const identity = element('div', 'proxy-account-identity'); identity.append(platformIcon(account.platform || 'tiktok'));
      const name = element('div'); name.append(element('strong', '', profileLabel(account)), element('small', '', platformName(account.platform || 'tiktok'))); identity.append(name);
      const connection = element('div', 'proxy-account-connection'); connection.append(element('strong', '', proxy?.name || 'Conexão direta'), element('small', '', proxy ? `${proxy.protocol.toUpperCase()} · ${proxyStatus(proxy) === 'active' ? 'Funcionando no último teste' : proxyStatus(proxy) === 'problem' ? 'Falha no último teste' : 'Não testado'}` : 'Sem proxy'));
      const edit = element('button', 'secondary', 'Editar conexão'); edit.type = 'button'; edit.addEventListener('click', () => editAccount(account));
      row.append(identity, connection, edit); list.append(row);
    }
    return;
  }
  $('#proxy-search-count').textContent = `${visible.length} proxy${visible.length === 1 ? '' : 's'}`;
  if (!visible.length) list.append(empty(state.proxies.length ? 'Nenhum proxy encontrado' : 'Nenhum proxy cadastrado', state.proxies.length ? 'Ajuste a busca ou os filtros.' : 'Adicione um proxy para começar.', '⇄'));
  for (const proxy of visible) list.append(proxyCard(proxy, expanded.has(proxy.id)));
}
function proxyCard(proxy, expanded) {
  const linked = state.accounts.filter(account => account.proxyId === proxy.id);
  const owner = linked.find(account => account.browserProfile === 'proxy');
  const status = proxyStatus(proxy);
  const labels = { active: 'Funcionando', problem: 'Falha na conexão', untested: 'Não testado', verifying: 'Verificando…' };
  const card = element('article', 'record proxy-card'); card.dataset.proxyId = proxy.id;
  const header = element('div', 'proxy-card-header');
  const identity = element('div', 'proxy-card-identity'); identity.append(element('h3', '', proxy.name), element('span', '', `${proxy.host}:${proxy.port} · ${proxy.protocol.toUpperCase()}`)); header.append(identity);
  header.append(element('span', `proxy-status proxy-status-${status}`, labels[status])); card.append(header);
  const summary = element('div', 'proxy-card-summary');
  summary.append(element('span', '', `${linked.length} conta${linked.length === 1 ? '' : 's'} vinculada${linked.length === 1 ? '' : 's'}`));
  if (linked.length) { const profiles = element('div', 'proxy-card-profiles'); for (const account of linked.slice(0, 3)) profiles.append(element('span', '', `${platformName(account.platform || 'tiktok')} · ${profileLabel(account)}`)); if (linked.length > 3) profiles.append(element('span', '', `+${linked.length - 3}`)); summary.append(profiles); }
  if (owner) summary.append(element('span', 'proxy-owner', `Navegador: ${profileLabel(owner)}`));
  card.append(summary);
  if (proxy.diagnostic) { const performance = element('div', 'proxy-card-performance'); performance.append(element('span', '', `IP ${proxy.diagnostic.ip}`), element('span', '', formatLocation(proxy.diagnostic.location)), element('span', '', `${proxy.diagnostic.durationMs} ms`)); if (proxy.diagnostic.location?.network) performance.append(element('span', '', proxy.diagnostic.location.network)); card.append(performance); }
  const footer = element('div', 'proxy-card-footer');
  const test = element('button', 'secondary', status === 'verifying' ? 'Verificando…' : 'Testar conexão'); test.type = 'button'; test.disabled = status === 'verifying'; test.addEventListener('click', () => testProxyOne(proxy.id)); footer.append(test);
  const menu = element('details', 'account-more proxy-more'); const trigger = element('summary', '', '⋮'); trigger.setAttribute('aria-label', `Ações de ${proxy.name}`); trigger.title = 'Ações'; menu.append(trigger);
  const options = element('div', 'account-more-menu');
  const add = (label, fn, danger = false) => { const button = actionButton(label, fn, danger ? 'account-menu-danger' : ''); button.addEventListener('click', () => { menu.open = false; }); options.append(button); };
  add(proxy.browserOpen ? 'Focar navegador' : 'Abrir navegador', () => window.studio.openProxyBrowser({ id: proxy.id }));
  if (proxy.browserOpen) add('Fechar navegador', () => window.studio.closeProxyBrowser(proxy.id));
  add('Duplicar proxy', () => window.studio.duplicateProxy(proxy.id));
  const edit = element('button', '', 'Editar proxy'); edit.type = 'button'; edit.addEventListener('click', () => { menu.open = false; editProxy(proxy); }); options.append(edit);
  add('Excluir proxy', async () => { const result = await window.studio.deleteProxy(proxy.id); if (result.proxies.every(item => item.id !== proxy.id) && proxyForm.elements.id.value === proxy.id) resetProxyForm(); return result; }, true);
  menu.append(options); footer.append(menu); card.append(footer);
  const details = element('details', 'proxy-details'); details.open = expanded; details.append(element('summary', '', 'Ver detalhes'));
  const content = element('div', 'proxy-details-content');
  content.append(element('p', '', `Servidor: ${proxy.host} · Porta: ${proxy.port} · Protocolo: ${proxy.protocol.toUpperCase()}`));
  content.append(element('p', '', `Autenticação: ${proxy.authenticated ? 'credenciais protegidas pelo Windows' : 'sem usuário e senha'}.`));
  content.append(element('p', '', owner ? `Navegador da proxy associado a ${profileLabel(owner)}. As demais contas mantêm sessões próprias.` : 'Navegador da proxy sem conta associada.'));
  if (linked.length) for (const account of linked) content.append(element('p', '', `${platformName(account.platform || 'tiktok')} · ${profileLabel(account)} · ${account.browserProfile === 'proxy' ? 'sessão compartilhada' : 'sessão própria'}`));
  else content.append(element('p', '', 'Nenhuma conta vinculada.'));
  if (proxy.diagnostic) { content.append(element('p', '', `Último teste bem sucedido: ${formatDate(proxy.diagnostic.at)} · IP ${proxy.diagnostic.ip} · ${formatLocation(proxy.diagnostic.location)} · ${proxy.diagnostic.durationMs} ms`)); const source = attribution(proxy.diagnostic.location); if (source) content.append(source); }
  if (proxy.testFailure) content.append(element('p', 'record-error', `${proxy.testFailure.message} · ${formatDate(proxy.testFailure.at)}`));
  if (!proxy.diagnostic && !proxy.testFailure) content.append(element('p', '', 'Conexão ainda não testada.'));
  details.append(content); card.append(details);
  return card;
}
function render() {
  window.renderX?.(state);
  window.renderPostings?.(state);
  $('#account-count').textContent = state.accounts.length;
  $('#workspace-account-count').textContent = state.accounts.length;
  const selected = new Set($$('input[name=accountIds]:checked').map(input => input.value));
  const picker = $('#campaign-accounts'); picker.replaceChildren();
  const tiktokAccounts = state.accounts.filter(account => (account.platform || 'tiktok') === 'tiktok');
  if (!tiktokAccounts.length) picker.append(element('p', 'empty-inline', 'Adicione uma conta TikTok para montar a campanha.'));
  for (const account of tiktokAccounts) {
    const label = element('label', 'account-choice'); const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'accountIds'; input.value = account.id; input.checked = selected.has(account.id);
    label.append(input, document.createTextNode(profileLabel(account))); picker.append(label);
  }
  const oldProxy = $('#proxy-select').value;
  $('#proxy-select').replaceChildren(new Option('Conexão direta', ''));
  for (const proxy of state.proxies) $('#proxy-select').append(new Option(proxy.name, proxy.id));
  $('#proxy-select').value = oldProxy;
  refreshBulkProxyOptions();
  renderAccounts();
  renderProxies();
  renderHistory();
  renderDashboard();
  summary();
  renderAutomation();
}
window.applyStudioState = next => { state = next; render(); };
function accountConnectionStatus(account) {
  if (account.error || account.meta?.needsReconnect) return 'problem';
  if ((account.platform || 'tiktok') !== 'instagram') return 'unknown';
  return account.meta?.connected ? 'connected' : 'disconnected';
}
function renderAccounts() {
  accountPhotoObserver.disconnect();
  const overview = $('#account-overview'); overview.replaceChildren();
  const statuses = state.accounts.map(accountConnectionStatus);
  const stats = [
    ['Total de contas', state.accounts.length, 'Cadastradas'],
    ['Conectadas', statuses.filter(value => value === 'connected').length, 'Meta autorizada'],
    ['Desconectadas', statuses.filter(value => value === 'disconnected').length, 'Instagram sem autorização'],
    ['Navegadores abertos', state.accounts.filter(account => account.open || account.browserOpen).length, 'Janelas ativas'],
    ['Com problemas', statuses.filter(value => value === 'problem').length, 'Exigem atenção']
  ];
  for (const [label, value, note] of stats) { const card = element('div', 'account-stat'); card.append(element('span', '', label), element('strong', '', String(value)), element('small', '', note)); overview.append(card); }
  const query = normalizedSearch($('#account-search').value.trim().replace(/^@/, ''));
  const platformFilter = $('#account-platform-filter').value;
  const connectionFilter = $('#account-connection-filter').value;
  const proxyFilter = $('#account-proxy-filter');
  const previousProxy = proxyFilter.value;
  proxyFilter.replaceChildren(new Option('Todas', 'all'), ...state.proxies.map(proxy => new Option(proxy.name, proxy.id)));
  proxyFilter.value = state.proxies.some(proxy => proxy.id === previousProxy) ? previousProxy : 'all';
  const statusFilter = $('#account-status-filter').value;
  const sort = $('#account-sort').value;
  const visible = state.accounts.filter(account => {
    const platform = account.platform || 'tiktok';
    return (!query || [account.name, account.handle].some(value => normalizedSearch(value).includes(query)))
      && (platformFilter === 'all' || platform === platformFilter)
      && (connectionFilter === 'all' || (connectionFilter === 'proxy' ? Boolean(account.proxyId) : !account.proxyId))
      && (proxyFilter.value === 'all' || account.proxyId === proxyFilter.value)
      && (statusFilter === 'all' || accountConnectionStatus(account) === statusFilter);
  });
  const list = $('#account-list');
  const expanded = new Set([...list.querySelectorAll('.account-card:has(.account-details[open])')].map(card => card.dataset.accountId));
  list.replaceChildren();
  if (!visible.length) { list.append(empty(state.accounts.length ? 'Nenhuma conta encontrada' : 'Nenhuma conta cadastrada', state.accounts.length ? 'Ajuste a busca ou os filtros.' : 'Adicione uma conta para começar.', '◎')); return; }
  const groups = sort === 'platform' ? ['instagram', 'tiktok', 'x'] : ['tiktok', 'instagram', 'x'];
  for (const platform of groups) {
    const accounts = visible.filter(account => (account.platform || 'tiktok') === platform);
    if (!accounts.length) continue;
    accounts.sort((a, b) => sort === 'recent' ? (Date.parse(b.createdAt || b.created_at) || 0) - (Date.parse(a.createdAt || a.created_at) || 0) : sort === 'name-desc' ? profileLabel(b).localeCompare(profileLabel(a), 'pt-BR') : profileLabel(a).localeCompare(profileLabel(b), 'pt-BR'));
    const group = element('details', 'account-group');
    group.open = !collapsedAccountGroups.has(platform);
    group.addEventListener('toggle', () => {
      if (!group.isConnected) return;
      if (group.open) collapsedAccountGroups.delete(platform);
      else collapsedAccountGroups.add(platform);
    });
    const heading = element('summary', 'account-group-heading');
    heading.append(element('strong', '', platformName(platform)), element('span', '', `${accounts.length} conta${accounts.length === 1 ? '' : 's'}`));
    group.append(heading);
    const grid = element('div', 'account-grid');
    for (const account of accounts) grid.append(accountCard(account, expanded.has(account.id)));
    group.append(grid); list.append(group);
  }
}
function accountCard(account, expanded) {
  const platformId = account.platform || 'tiktok';
  const platform = platformName(platformId);
  const proxy = state.proxies.find(item => item.id === account.proxyId);
  const proxyBrowserOwner = proxy && state.accounts.find(item => item.id !== account.id && item.proxyId === proxy.id && item.browserProfile === 'proxy');
  const status = accountConnectionStatus(account);
  const queued = platformId === 'instagram' ? (state.postings?.items || []).filter(item => item.account_id === account.id && item.queue_kind !== 'shared' && item.status === 'queued').length : 0;
  const schedule = state.postings?.schedules?.find(item => item.account_id === account.id);
  const card = element('article', 'record account-card'); card.dataset.accountId = account.id;
  const top = element('div', 'account-card-top');
  const identity = element('div', 'account-card-identity');
  const avatar = platformIcon(platformId);
  avatar.classList.add('account-avatar');
  if (platformId === 'instagram' && account.meta?.connected) {
    avatar.dataset.accountId = account.id;
    accountPhotoObserver.observe(avatar);
  }
  identity.append(avatar);
  const title = element('div'); title.append(element('h3', '', profileLabel(account)), element('span', '', platform)); identity.append(title); top.append(identity);
  const menu = element('details', 'account-more');
  const trigger = element('summary', '', '⋮'); trigger.setAttribute('aria-label', `Ações de ${profileLabel(account)}`); trigger.title = 'Ações'; menu.append(trigger);
  const menuContent = element('div', 'account-more-menu');
  const addAction = (label, fn, danger = false) => { const button = actionButton(label, fn, danger ? 'account-menu-danger' : ''); button.addEventListener('click', () => { menu.open = false; }); menuContent.append(button); };
  addAction(account.browserOpen ? 'Focar navegador' : 'Abrir navegador livre', () => window.studio.openAccountBrowser(account.id));
  addAction(account.open ? 'Focar janela da automação' : `Abrir ${platform} para automação`, () => window.studio.openAccount(account.id));
  if (account.open) addAction('Fechar janela da automação', () => window.studio.closeAccount(account.id));
  if (account.browserOpen) addAction('Fechar navegador livre', () => window.studio.closeAccountBrowser(account.id));
  addAction('Testar conexão', () => window.studio.testConnection(account.id));
  if (proxy && account.browserProfile !== 'proxy' && !proxyBrowserOwner) addAction('Usar navegador da proxy', () => window.studio.useProxyBrowser(account.id));
  if (platformId === 'instagram') {
    addAction(account.meta?.connected || account.meta?.needsReconnect ? 'Reconectar Instagram' : 'Conectar Instagram', () => window.studio.connectMeta(account.id));
    if (account.meta?.connected || account.meta?.needsReconnect) addAction('Desconectar Instagram', () => window.studio.disconnectMeta(account.id));
  }
  if (platformId === 'tiktok') {
    addAction(account.tiktokAnalytics?.connected || account.tiktokAnalytics?.needsReconnect ? 'Reconectar métricas TikTok' : 'Conectar métricas TikTok', () => window.studio.connectTikTokAnalytics(account.id));
    if (account.tiktokAnalytics?.connected || account.tiktokAnalytics?.needsReconnect) addAction('Desconectar métricas TikTok', () => window.studio.disconnectTikTokAnalytics(account.id));
  }
  const edit = element('button', '', 'Editar conta'); edit.type = 'button'; edit.addEventListener('click', () => { menu.open = false; editAccount(account); }); menuContent.append(edit);
  addAction('Excluir conta', async () => { const result = await window.studio.deleteAccount(account.id); if (result.accounts.every(item => item.id !== account.id) && accountForm.elements.id.value === account.id) resetAccountForm(); return result; }, true);
  menu.append(menuContent);
  const topActions = element('div', 'account-card-actions');
  if (queued && schedule?.status !== 'running') {
    const play = actionButton('▶', () => window.studio.controlPosting({ accountId: account.id, status: 'running' }), 'account-queue-play');
    play.setAttribute('aria-label', `Iniciar fila de ${profileLabel(account)}`);
    play.title = `Iniciar fila de ${profileLabel(account)}`;
    topActions.append(play);
  }
  topActions.append(menu); top.append(topActions); card.append(top);
  const summary = element('div', 'account-card-summary');
  const browserOpen = account.open || account.browserOpen;
  summary.append(element('span', `account-card-status${browserOpen ? ' is-open' : ''}`, browserOpen ? 'Navegador aberto' : 'Navegador fechado'));
  summary.append(element('span', 'account-card-status', proxy ? `Proxy · ${proxy.name}` : 'Conexão direta'));
  if (status !== 'unknown') summary.append(element('span', `account-card-status status-${status}`, status === 'connected' ? 'Meta autorizada' : status === 'disconnected' ? 'Meta não autorizada' : 'Precisa de atenção'));
  if (queued) summary.append(element('span', 'account-chip account-queue-chip', `${queued} ${queued === 1 ? 'vídeo' : 'vídeos'} na fila${schedule?.status === 'running' ? ' · ativa' : ''}`));
  card.append(summary);
  const details = element('details', 'account-details'); details.open = expanded;
  const detailsSummary = element('summary', '', 'Ver detalhes'); details.append(detailsSummary);
  const content = element('div', 'account-details-content');
  content.append(element('p', '', `Conexão: ${proxy ? `${proxy.name} (${proxy.protocol?.toUpperCase() || 'Proxy'})` : 'Direta'}`));
  content.append(element('p', '', `Sessão: ${account.browserProfile === 'proxy' ? 'compartilhada com o navegador desta proxy' : 'própria desta conta'}. Janela da automação ${account.open ? 'aberta' : 'fechada'}; navegador livre ${account.browserOpen ? 'aberto' : 'fechado'}.`));
  if (proxyBrowserOwner && account.browserProfile !== 'proxy') content.append(element('p', '', `Outra conta usa o navegador da proxy; o login de ${profileLabel(account)} permanece separado.`));
  if (platformId === 'instagram') content.append(element('p', '', `Meta: ${account.meta?.needsReconnect ? 'reconexão necessária' : account.meta?.connected ? `autorizada para @${account.meta.username || account.meta.igId}` : 'não autorizada'}. Insights ${account.meta?.insightsGranted ? 'autorizados' : 'não autorizados'}.`));
  else if (platformId === 'tiktok') content.append(element('p', '', `Métricas TikTok: ${account.tiktokAnalytics?.needsReconnect ? 'reconexão necessária' : account.tiktokAnalytics?.connected ? `autorizadas para @${account.tiktokAnalytics.username || account.tiktokAnalytics.openId}` : 'não autorizadas'}. O login da automação é independente.`));
  else content.append(element('p', '', 'O aplicativo não confirma o login desta plataforma pela janela aberta.'));
  if (account.diagnostic) { content.append(element('p', 'diagnostic', `Último teste: IP ${account.diagnostic.ip} · ${account.diagnostic.durationMs} ms · ${formatLocation(account.diagnostic.location)} · ${formatDate(account.diagnostic.at)}`)); const source = attribution(account.diagnostic.location); if (source) content.append(source); }
  else content.append(element('p', '', 'Conexão ainda não testada nesta conta.'));
  if (account.error) content.append(element('p', 'record-error', account.error));
  details.append(content); card.append(details);
  return card;
}
for (const id of ['account-search', 'account-platform-filter', 'account-connection-filter', 'account-status-filter', 'account-proxy-filter', 'account-sort']) $(`#${id}`).addEventListener(id === 'account-search' ? 'input' : 'change', renderAccounts);
const dashboardComparedAccounts = new Map();
function dashboardAccountMatches(id, platform = $('#dashboard-platform').value) {
  const single = $('#dashboard-account').value;
  if (single !== 'all') return id === single;
  const compared = dashboardComparedAccounts.get(platform);
  return !compared?.size || compared.has(id);
}
$('#dashboard-compare-accounts').addEventListener('change', event => {
  if (!event.target.matches('input[type="checkbox"]')) return;
  const platform = $('#dashboard-platform').value;
  const checked = new Set([...$('#dashboard-compare-accounts').querySelectorAll(':checked')].map(input => input.value));
  dashboardComparedAccounts.set(platform, checked);
  $('#dashboard-account').value = 'all';
  renderDashboard();
});
function renderDashboard() {
  const platform = $('#dashboard-platform').value;
  const accountFilter = $('#dashboard-account');
  const previousAccount = accountFilter.value;
  const accounts = state.accounts.filter(account => platform === 'all' || account.platform === platform);
  accountFilter.replaceChildren(new Option('Todas as contas', 'all'), ...accounts.map(account => new Option(`${platformName(account.platform)} · ${profileLabel(account)}`, account.id)));
  accountFilter.value = accounts.some(account => account.id === previousAccount) ? previousAccount : 'all';
  const compared = dashboardComparedAccounts.get(platform);
  if (compared) for (const id of compared) if (!accounts.some(account => account.id === id)) compared.delete(id);
  const comparison = $('#dashboard-compare-accounts');
  const choices = [...comparison.querySelectorAll('input')];
  if (choices.length !== accounts.length || accounts.some((account, index) => choices[index].value !== account.id)) {
    comparison.replaceChildren(...accounts.map(account => {
      const label = element('label');
      const input = element('input');
      input.type = 'checkbox'; input.value = account.id;
      label.append(input, document.createTextNode(profileLabel(account)));
      return label;
    }));
  }
  for (const input of comparison.querySelectorAll('input')) input.checked = accountFilter.value === 'all' && Boolean(compared?.has(input.value));
  comparison.parentElement.querySelector('summary').textContent = accountFilter.value === 'all' && compared?.size ? `Comparar contas · ${compared.size}` : 'Comparar contas';
  const accountIds = new Set(accounts.filter(account => dashboardAccountMatches(account.id, platform)).map(account => account.id));
  const dates = dashboardDates();
  const inPeriod = value => { const ms = Date.parse(value); return Number.isFinite(ms) && ms >= dates.from && ms <= dates.to; };
  const items = (state.postings?.items || []).filter(item => accountIds.has(item.account_id));
  const published = items.filter(item => item.status === 'published' && inPeriod(item.published_at));
  const pending = items.filter(item => ['queued', 'uploading', 'processing', 'publishing'].includes(item.status) && inPeriod(item.created_at));
  const attention = items.filter(item => ['attention', 'uncertain'].includes(item.status) && inPeriod(item.created_at));
  const accountAttention = new Set(accounts.filter(account => accountIds.has(account.id) && (account.error || account.meta?.needsReconnect)).map(account => account.id));
  for (const entry of state.automation?.attentionAccounts || []) if (accountIds.has(entry.accountId)) accountAttention.add(entry.accountId);
  for (const entry of state.xAutomation?.accounts || []) if (accountIds.has(entry.accountId) && entry.status === 'attention') accountAttention.add(entry.accountId);
  const insights = new Map((state.postings?.insights || []).map(entry => [entry.item_id, entry]));
  const histories = new Map();
  const allHistories = new Map();
  for (const point of state.postings?.insightHistory || []) {
    if (!items.some(item => item.id === point.item_id)) continue;
    if (!allHistories.has(point.item_id)) allHistories.set(point.item_id, []);
    allHistories.get(point.item_id).push(point);
    if (!inPeriod(point.fetched_at)) continue;
    if (!histories.has(point.item_id)) histories.set(point.item_id, []);
    histories.get(point.item_id).push(point);
  }
  const growth = (series, key) => {
    let total = 0, count = 0;
    for (const points of series.values()) {
      const changes = window.dashboardAnalytics.observedChanges(points, key, dates);
      if (!changes.length) continue;
      total += changes.reduce((sum, change) => sum + change.value, 0);
      count++;
    }
    return { total, count };
  };
  const views = growth(histories, 'views'), reach = growth(histories, 'reach');
  const tiktokPoints = new Map(), allTiktokPoints = new Map();
  for (const point of state.tiktokInsights?.history || []) {
    if (!accountIds.has(point.account_id)) continue;
    const key = `${point.account_id}:${point.video_id}`;
    const normalized = { ...point, reach: null, engagement: ['likes', 'comments', 'shares'].every(field => point[field] !== null && point[field] !== undefined && Number.isFinite(Number(point[field]))) ? Number(point.likes) + Number(point.comments) + Number(point.shares) : null };
    if (!allTiktokPoints.has(key)) allTiktokPoints.set(key, []);
    allTiktokPoints.get(key).push(normalized);
    if (inPeriod(point.fetched_at)) { if (!tiktokPoints.has(key)) tiktokPoints.set(key, []); tiktokPoints.get(key).push(normalized); }
  }
  const tiktokViews = growth(tiktokPoints, 'views'), tiktokEngagement = growth(tiktokPoints, 'engagement');
  const tiktokPublished = (state.tiktokInsights?.videos || []).filter(video => accountIds.has(video.account_id) && inPeriod(video.created_at));
  const active = new Set((state.postings?.schedules || []).filter(schedule => schedule.status === 'running').map(schedule => schedule.account_id));
  if (['running', 'pausing'].includes(state.automation?.status)) for (const progress of state.automation?.accountProgress || []) if (progress.status !== 'paused') active.add(progress.accountId);
  if (state.xAutomation?.status === 'running') for (const progress of state.xAutomation?.accounts || []) if (!['done', 'paused'].includes(progress.status)) active.add(progress.accountId);
  const activeCount = [...active].filter(id => accountIds.has(id)).length;
  const metrics = $('#dashboard-metrics'); metrics.replaceChildren();
  for (const [label, value, note, tone] of [
    ['Novas visualizações no período', (platform === 'tiktok' ? tiktokViews : views).count ? (platform === 'tiktok' ? tiktokViews : views).total.toLocaleString('pt-BR') : '—', (platform === 'tiktok' ? tiktokViews : views).count ? `Ganhos entre leituras · ${(platform === 'tiktok' ? tiktokViews : views).count} vídeo(s)` : 'Aguardando duas leituras reais', 'accent'],
    [platform === 'tiktok' ? 'Interações TikTok' : 'Alcance por Reel', (platform === 'tiktok' ? tiktokEngagement : reach).count ? (platform === 'tiktok' ? tiktokEngagement : reach).total.toLocaleString('pt-BR') : '—', (platform === 'tiktok' ? tiktokEngagement : reach).count ? platform === 'tiktok' ? 'Curtidas + comentários + compartilhamentos' : `Soma por Reel · ${reach.count} medido(s)` : 'Aguardando duas leituras reais', 'accent'],
    ['Vídeos publicados', platform === 'tiktok' ? tiktokPublished.length : published.length, platform === 'tiktok' ? 'Vídeos públicos no período' : 'Confirmados no período', 'neutral'],
    ['Contas ativas', activeCount, 'Em execução agora', 'neutral'],
    ['Publicações pendentes', pending.length, 'Adicionadas no período', 'neutral'],
    ['Precisam de atenção', attention.length + accountAttention.size, `${attention.length} publicação(ões) · ${accountAttention.size} conta(s)`, attention.length || accountAttention.size ? 'danger' : 'neutral']
  ]) { const card = element('div', `dashboard-metric tone-${tone}`); card.append(element('span', '', label), element('strong', '', String(value)), element('small', '', note)); metrics.append(card); }
  const recentWithMedia = (state.postings?.items || []).filter(item => item.status === 'published' && item.media_id);
  const canRefreshInstagram = accounts.some(account => account.platform === 'instagram' && accountIds.has(account.id) && account.meta?.connected && account.meta?.insightsGranted);
  const canRefreshTikTok = accounts.some(account => account.platform === 'tiktok' && accountIds.has(account.id) && account.tiktokAnalytics?.connected);
  const canRefresh = canRefreshInstagram || canRefreshTikTok;
  $('#dashboard-refresh-insights').disabled = !canRefresh || dashboardRefreshing;
  const eligible = items.filter(item => item.status === 'published' && item.media_id).length;
  $('#dashboard-insights-note').textContent = platform === 'tiktok' ? 'As métricas do TikTok aparecem no painel abaixo. O alcance não é fornecido pela Display API.' : platform === 'x' ? 'O X ainda não fornece Insights de vídeos ao Comment Studio.' : !eligible ? 'Nenhum Reel publicado com ID da Meta neste filtro.' : `${[...histories.values()].filter(points => points.length).length} de ${eligible} Reels com leitura neste período. Todos os Reels publicados pelo Comment Studio são coletados em segundo plano: recentes a cada hora e antigos até uma vez por dia. O alcance somado por Reel não representa pessoas únicas.`;
  const readingMaps = platform === 'tiktok' ? [tiktokPoints] : platform === 'all' ? [histories, tiktokPoints] : [histories];
  const latestReading = readingMaps.flatMap(map => [...map.values()].flat()).map(point => Date.parse(point.fetched_at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (!dashboardRefreshing) $('#dashboard-refresh-status').textContent = dashboardRefreshMessage || (latestReading ? `Última leitura neste filtro: ${formatDate(new Date(latestReading).toISOString())}` : 'Sem leitura neste filtro');
  $('#dashboard-chart-title').textContent = platform === 'tiktok' ? 'Evolução dos vídeos TikTok' : 'Evolução dos Reels Instagram';
  document.querySelector('[data-chart-metric="reach"]').disabled = platform === 'tiktok';
  if (platform === 'tiktok' && document.querySelector('[data-chart-metric="reach"][aria-pressed="true"]')) { document.querySelector('[data-chart-metric="views"]').setAttribute('aria-pressed', 'true'); document.querySelector('[data-chart-metric="reach"]').setAttribute('aria-pressed', 'false'); }
  renderDashboardChart(platform === 'tiktok' ? tiktokPoints : histories, platform === 'tiktok' ? allTiktokPoints : allHistories, dates, platform, items);
  renderDashboardPlatforms(items, histories);
  renderDashboardVideos(published, insights);
  renderDashboardQueue(items);
  renderTikTokDashboard(accountIds, dates);
  renderDashboardHourly(accountIds, dates, platform, allHistories, allTiktokPoints, items);
  renderCampaignAnalytics(accountIds, dates, platform);
}
function renderCampaignAnalytics(accountIds, dates, platform) {
  const rows = (state.campaignAnalytics || []).filter(row => accountIds.has(row.accountId) && (platform === 'all' || row.platform === platform) && Date.parse(row.hour) >= dates.from && Date.parse(row.hour) <= dates.to);
  const totals = { comments: 0, replies: 0, likes: 0, uncertain: 0 };
  const accounts = new Map();
  for (const row of rows) {
    for (const key of Object.keys(totals)) totals[key] += Number(row[key] || 0);
    const id = `${row.platform}:${row.accountId}`;
    if (!accounts.has(id)) accounts.set(id, { ...row, comments: 0, replies: 0, likes: 0, uncertain: 0 });
    const account = accounts.get(id);
    for (const key of Object.keys(totals)) account[key] += Number(row[key] || 0);
  }
  const stats = $('#dashboard-campaign-stats'); stats.replaceChildren();
  const actionMetrics = platform === 'tiktok'
    ? [['comments', 'Comentários TikTok']]
    : [['replies', 'Respostas X'], ['likes', 'Curtidas X']];
  const actionSummary = row => actionMetrics.map(([key, label]) => `${row[key]} ${label.toLocaleLowerCase('pt-BR')}`).join(' · ');
  for (const [key, label] of [...actionMetrics, ['uncertain', 'A conferir']]) {
    const card = element('div', 'dashboard-campaign-stat'); card.append(element('span', '', label), element('strong', '', totals[key].toLocaleString('pt-BR'))); stats.append(card);
  }
  const root = $('#dashboard-campaign-accounts'); root.replaceChildren();
  const hours = $('#dashboard-campaign-hours'); hours.replaceChildren();
  const ranking = [...accounts.values()].sort((a, b) => (b.comments + b.replies + b.likes) - (a.comments + a.replies + a.likes)).slice(0, 8);
  if (!ranking.length) { root.append(element('p', 'dashboard-empty', 'Nenhuma ação de campanha confirmada neste filtro.')); return; }
  for (const row of ranking) {
    const account = state.accounts.find(item => item.id === row.accountId);
    const line = element('div', 'dashboard-campaign-row');
    line.append(element('strong', '', account ? profileLabel(account) : 'Conta removida'));
    line.append(element('span', '', `${actionSummary(row)}${row.uncertain ? ` · ${row.uncertain} a conferir` : ''}`));
    root.append(line);
  }
  const hourly = new Map();
  for (const row of rows) {
    const key = row.hour;
    if (!hourly.has(key)) hourly.set(key, { comments: 0, replies: 0, likes: 0 });
    const total = hourly.get(key);
    for (const type of Object.keys(total)) total[type] += Number(row[type] || 0);
  }
  for (const [at, counts] of [...hourly].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8)) {
    const line = element('div', 'dashboard-campaign-hour');
    line.append(element('strong', '', `${new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit' })}h`), element('span', '', actionSummary(counts)));
    hours.append(line);
  }
}
function renderDashboardHourly(accountIds, dates, platform, instagramHistory, tiktokHistory, items) {
  const series = [];
  const itemById = new Map(items.map(item => [item.id, item]));
  if (platform === 'all' || platform === 'instagram') for (const [id, points] of instagramHistory) {
    const item = itemById.get(id);
    if (!item) continue;
    const account = state.accounts.find(value => value.id === item.account_id);
    series.push({ platform: 'instagram', accountId: item.account_id, accountName: account ? profileLabel(account) : item.account_name || 'Conta removida', videoId: id, videoTitle: fileName(item.file), points });
  }
  if (platform === 'all' || platform === 'tiktok') {
    const videos = new Map((state.tiktokInsights?.videos || []).filter(video => accountIds.has(video.account_id)).map(video => [`${video.account_id}:${video.video_id}`, video]));
    for (const [key, points] of tiktokHistory) {
      const video = videos.get(key), first = points[0];
      if (!first) continue;
      const account = state.accounts.find(value => value.id === first.account_id);
      series.push({ platform: 'tiktok', accountId: first.account_id, accountName: account ? profileLabel(account) : 'Conta removida', videoId: first.video_id, videoTitle: video?.title || `Vídeo ${first.video_id}`, points });
    }
  }
  const buckets = window.dashboardAnalytics.hourlyLeaders(series, dates.from, dates.to);
  const root = $('#dashboard-hourly'); root.replaceChildren();
  $('#dashboard-hourly-coverage').textContent = buckets.length ? `${buckets.length} hora(s) com leituras` : 'Sem intervalos medidos';
  if (!buckets.length) { root.append(element('p', 'dashboard-empty', platform === 'x' ? 'O X ainda não fornece métricas de vídeos.' : 'Faça pelo menos duas atualizações reais dos mesmos vídeos para comparar as contas por hora de leitura.')); return; }
  for (const bucket of buckets.slice(0, 8)) {
    const leader = bucket.accounts[0], video = bucket.videos[0];
    const row = element('div', 'dashboard-hour-row');
    const hour = new Date(bucket.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit' });
    const time = element('strong', 'dashboard-hour-time', `${hour}h`);
    const detail = element('div', 'dashboard-hour-detail');
    detail.append(element('strong', '', leader?.name || 'Conta indisponível'), element('span', '', `${platformName(bucket.platform)} · +${Number(leader?.views || 0).toLocaleString('pt-BR')} views · Vídeo líder: ${video?.title || '—'}`));
    detail.append(element('small', '', `Leituras entre ${formatDate(new Date(bucket.earliest).toISOString())} e ${formatDate(new Date(bucket.latest).toISOString())} · ${bucket.intervals} intervalo(s) medido(s)`));
    row.append(time, detail, element('strong', 'dashboard-hour-total', `+${bucket.total.toLocaleString('pt-BR')}`)); root.append(row);
  }
}
function renderTikTokDashboard(accountIds, dates) {
  const panel = $('#dashboard-tiktok-panel');
  panel.hidden = ![...accountIds].some(id => state.accounts.some(account => account.id === id && account.platform === 'tiktok'));
  if (panel.hidden) return;
  const videos = (state.tiktokInsights?.videos || []).filter(video => accountIds.has(video.account_id));
  const history = (state.tiktokInsights?.history || []).filter(point => accountIds.has(point.account_id) && Date.parse(point.fetched_at) >= dates.from && Date.parse(point.fetched_at) <= dates.to);
  const byVideo = new Map();
  for (const point of history) { const key = `${point.account_id}:${point.video_id}`; if (!byVideo.has(key)) byVideo.set(key, []); byVideo.get(key).push(point); }
  const deltas = { views: null, likes: null, comments: null, shares: null, measured: 0 };
  for (const points of byVideo.values()) {
    let measured = false;
    for (const key of ['views', 'likes', 'comments', 'shares']) {
      const changes = window.dashboardAnalytics.observedChanges(points, key, dates);
      if (!changes.length) continue;
      deltas[key] = (deltas[key] ?? 0) + changes.reduce((sum, point) => sum + point.value, 0);
      measured = true;
    }
    if (measured) deltas.measured++;
  }
  const measures = [['views', 'visualizações'], ['likes', 'curtidas'], ['comments', 'comentários'], ['shares', 'compartilhamentos']];
  const metricText = (values, prefix = '') => measures.map(([key, label]) => `${values[key] == null ? '—' : prefix + Number(values[key]).toLocaleString('pt-BR')} ${label}`).join(' · ');
  $('#dashboard-tiktok-summary').textContent = deltas.measured ? `Crescimento observado no período · ${deltas.measured} vídeo(s): ${metricText(deltas, '+')}` : 'Aguardando duas leituras reais dos mesmos vídeos neste período.';
  const list = $('#dashboard-tiktok-videos'); list.replaceChildren();
  if (!videos.length) { list.append(element('p', 'dashboard-empty', 'Conecte uma conta TikTok e atualize as métricas para ver seus vídeos públicos.')); return; }
  for (const video of [...videos].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8)) {
    const account = state.accounts.find(item => item.id === video.account_id);
    const row = element('div', 'dashboard-video-row');
    const details = element('div', 'dashboard-video-details');
    details.append(element('strong', '', video.title || `Vídeo ${video.video_id}`), element('span', '', `${account ? profileLabel(account) : 'Conta removida'} · ${formatDate(video.created_at)}`), element('small', '', `Acumulado na leitura de ${formatDate(video.fetched_at)} · ${metricText(video)}`));
    row.append(details); list.append(row);
  }
}
function dashboardDates() {
  const period = $('#dashboard-period').value;
  const now = new Date();
  let start = new Date(now), end = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'custom') {
    const from = $('#dashboard-from').value, to = $('#dashboard-to').value;
    start = new Date(`${from}T00:00:00`);
    end = new Date(`${to}T23:59:59.999`);
  } else if (period === 'yesterday') {
    end = new Date(+start - 1);
    start.setDate(start.getDate() - 1);
  } else if (period === '24h') {
    start = new Date(+now - 86400000);
  } else if (period !== 'today') {
    start.setDate(start.getDate() - Number(period) + 1);
  }
  const fromTime = $('#dashboard-start-time').value, toTime = $('#dashboard-end-time').value;
  if (fromTime) start.setHours(...fromTime.split(':').map(Number), 0, 0);
  if (toTime) end.setHours(...toTime.split(':').map(Number), 59, 999);
  const valid = Number.isFinite(+start) && Number.isFinite(+end) && +start <= +end;
  $('#dashboard-invalid-range').hidden = valid;
  return valid ? { from: +start, to: +end } : { from: Infinity, to: -Infinity };
}
function renderDashboardChart(histories, allHistories, dates, platform) {
  const root = $('#dashboard-chart'); root.replaceChildren();
  const key = document.querySelector('[data-chart-metric][aria-pressed="true"]').dataset.chartMetric;
  const comparison = $('#dashboard-comparison');
  if (key === 'engagement' && platform !== 'tiktok') { root.append(element('p', 'dashboard-empty', 'Engajamento ainda não está disponível para os Reels Instagram.')); comparison.textContent = ''; return; }
  const previousFrom = dates.from - (dates.to - dates.from) - 1, previousTo = dates.from - 1;
  let current = 0, previous = 0, common = 0;
  for (const points of allHistories.values()) {
    const delta = (from, to) => { const valid = points.filter(point => { const at = Date.parse(point.fetched_at); return at >= from && at <= to && point[key] !== null; }); return valid.length >= 2 ? Math.max(0, Number(valid.at(-1)[key]) - Number(valid[0][key])) : null; };
    const a = delta(dates.from, dates.to), b = delta(previousFrom, previousTo);
    if (a !== null && b !== null) { current += a; previous += b; common++; }
  }
  comparison.textContent = common ? `Comparação com período anterior · ${common} Reel(s) em ambos: +${current.toLocaleString('pt-BR')} agora, +${previous.toLocaleString('pt-BR')} antes${previous > 0 ? ` (${((current - previous) / previous * 100).toFixed(1)}%)` : ''}.` : 'Comparação com o período anterior: faltam leituras suficientes dos mesmos Reels nos dois intervalos.';
  const days = new Map();
  for (const points of histories.values()) for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1][key], current = points[i][key];
    if (previous === null || current === null) continue;
    const day = new Date(points[i].fetched_at).toLocaleDateString('sv-SE');
    days.set(day, (days.get(day) || 0) + Math.max(0, current - previous));
  }
  if (!days.size) { root.append(element('p', 'dashboard-empty', 'São necessárias pelo menos duas consultas reais no período para mostrar a evolução.')); return; }
  const values = [...days].sort((a, b) => a[0].localeCompare(b[0]));
  const max = Math.max(...values.map(([, value]) => value), 1);
  const bars = element('div', 'dashboard-bars');
  for (const [day, value] of values) {
    const column = element('div', 'dashboard-bar-column');
    const bar = element('div', 'dashboard-bar'); bar.style.height = `${Math.max(4, value / max * 100)}%`;
    bar.title = `${new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR')}: +${value.toLocaleString('pt-BR')}`;
    column.append(element('strong', '', `+${value.toLocaleString('pt-BR')}`), bar, element('span', '', new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })));
    bars.append(column);
  }
  root.append(bars);
}
function renderDashboardPlatforms(items, histories) {
  const root = $('#dashboard-platforms'); root.replaceChildren();
  for (const platform of ['instagram', 'tiktok', 'x']) {
    if ($('#dashboard-platform').value !== 'all' && $('#dashboard-platform').value !== platform) continue;
    const accounts = state.accounts.filter(account => account.platform === platform && ($('#dashboard-account').value === 'all' || account.id === $('#dashboard-account').value));
    const section = element('div', 'dashboard-platform-row');
    const title = element('div', 'dashboard-platform-title'); title.append(platformIcon(platform), element('strong', '', platformName(platform)), element('small', '', `${accounts.length} conta(s)`)); section.append(title);
    if (platform === 'instagram') {
      const totals = { views: 0, reach: 0 }, coverage = { views: 0, reach: 0 };
      for (const item of items) for (const key of ['views', 'reach']) {
        const valid = (histories.get(item.id) || []).filter(point => point[key] !== null);
        if (valid.length >= 2) { totals[key] += Math.max(0, Number(valid.at(-1)[key]) - Number(valid[0][key])); coverage[key]++; }
      }
      const summary = element('p', 'dashboard-platform-data', coverage.views || coverage.reach ? `+${coverage.views ? totals.views.toLocaleString('pt-BR') : '—'} visualizações · +${coverage.reach ? totals.reach.toLocaleString('pt-BR') : '—'} de alcance por Reel no período` : 'Sem crescimento mensurável neste período'); section.append(summary);
    } else section.append(element('p', 'dashboard-platform-data', platform === 'tiktok' ? 'Métricas no painel Vídeos TikTok' : 'Insights de vídeos ainda indisponíveis'));
    root.append(section);
  }
}
function renderDashboardVideos(published, insights) {
  const root = $('#dashboard-reels'); root.replaceChildren();
  const key = $('#dashboard-sort').value;
  const sorted = [...published].sort((a, b) => (insights.get(b.id)?.[key] ?? -1) - (insights.get(a.id)?.[key] ?? -1));
  $('#dashboard-reels-count').textContent = `${sorted.length} publicado(s) no período`;
  if (!sorted.length) { root.append(element('p', 'dashboard-empty', 'Nenhum Reel publicado neste período.')); return; }
  for (const item of sorted.slice(0, 8)) {
    const row = element('div', 'dashboard-video-row');
    const thumb = element('div', 'dashboard-thumb', '▶'); thumb.setAttribute('aria-hidden', 'true'); row.append(thumb);
    window.studio.videoThumbnail(item.id).then(data => { if (data && thumb.isConnected) { thumb.textContent = ''; const image = element('img'); image.src = data; image.alt = ''; thumb.append(image); } }).catch(() => {});
    const account = state.accounts.find(value => value.id === item.account_id);
    const details = element('div', 'dashboard-video-details'); details.append(element('strong', '', fileName(item.file)), element('span', '', `Instagram · ${account ? profileLabel(account) : item.account_name || 'Conta removida'} · ${formatDate(item.published_at)}`));
    const insight = insights.get(item.id);
    details.append(element('small', '', insight ? `${insight.views === null ? '—' : Number(insight.views).toLocaleString('pt-BR')} visualizações · ${insight.reach === null ? '—' : Number(insight.reach).toLocaleString('pt-BR')} de alcance acumulado · ${formatDate(insight.fetched_at)}` : 'Métricas ainda não consultadas'));
    row.append(details);
    if (item.permalink) row.append(actionButton('Abrir', () => window.studio.openPublishedReel(item.id)));
    root.append(row);
  }
}
function renderDashboardQueue(items) {
  const root = $('#dashboard-queue'); root.replaceChildren();
  const schedules = new Map((state.postings?.schedules || []).map(schedule => [schedule.account_id, schedule]));
  const order = { attention: 0, uncertain: 0, publishing: 1, processing: 1, uploading: 1, queued: 2 };
  const visible = items.filter(item => !['published', 'cancelled'].includes(item.status)).sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)).slice(0, 8);
  if (!visible.length) { root.append(element('p', 'dashboard-empty', 'Nenhuma publicação pendente para estas contas.')); return; }
  for (const item of visible) {
    const account = state.accounts.find(value => value.id === item.account_id);
    const row = element('div', 'dashboard-queue-row');
    const details = element('div', 'dashboard-video-details'); details.append(element('strong', '', `${item.queue_kind === 'shared' ? 'Fila única · ' : ''}${fileName(item.file)}`), element('span', '', account ? profileLabel(account) : item.account_name || 'Conta removida'));
    const status = { queued: 'Na fila', uploading: 'Enviando', processing: 'Processando', publishing: 'Publicando', published: 'Publicado', attention: 'Precisa de atenção', uncertain: 'Conferir resultado', cancelled: 'Cancelado' }[item.status] || item.status;
    const side = element('div', 'dashboard-queue-side'); side.append(element('span', `dashboard-status status-${item.status}`, status));
    const schedule = schedules.get(item.account_id);
    side.append(element('small', '', item.status === 'queued' && schedule?.next_at ? `Próximo horário da conta: ${formatDate(schedule.next_at)}` : '—'));
    row.append(details, side); root.append(row);
  }
}
for (const id of ['dashboard-platform', 'dashboard-account', 'dashboard-period', 'dashboard-from', 'dashboard-to', 'dashboard-sort', 'dashboard-start-time', 'dashboard-end-time', 'dashboard-group']) $(`#${id}`).addEventListener('change', () => {
  dashboardRefreshMessage = '';
  if (id === 'dashboard-account') dashboardComparedAccounts.delete($('#dashboard-platform').value);
  if (id === 'dashboard-period' && $('#dashboard-period').value === 'custom' && !$('#dashboard-from').value && !$('#dashboard-to').value) {
    const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const from = new Date(); from.setDate(from.getDate() - 6);
    $('#dashboard-from').value = localDate(from); $('#dashboard-to').value = localDate(new Date());
  }
  $('#dashboard-custom-dates').hidden = $('#dashboard-period').value !== 'custom'; renderDashboard();
});
$$('[data-chart-metric]').forEach(button => button.addEventListener('click', () => { $$('[data-chart-metric]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); renderDashboard(); }));
$('#dashboard-view-queue').addEventListener('click', () => { page('postings'); document.querySelector('[data-posting-tab="queue"]')?.click(); });
$('#dashboard-refresh-insights').addEventListener('click', async event => {
  const button = event.currentTarget;
  dashboardRefreshing = true; button.disabled = true; button.textContent = 'Atualizando totais…';
  const status = $('#dashboard-refresh-status'); status.textContent = 'Consultando métricas…';
  let instagramRefreshId = null;
  let instagramAlreadyRunning = false;
  try {
    const platform = $('#dashboard-platform').value;
    const messages = [];
    if ((platform === 'all' || platform === 'instagram') && state.accounts.some(item => item.platform === 'instagram' && dashboardAccountMatches(item.id, platform) && item.meta?.connected && item.meta?.insightsGranted)) {
      const ids = state.accounts.filter(item => item.platform === 'instagram' && dashboardAccountMatches(item.id, platform)).map(item => item.id);
      const result = await window.studio.refreshInstagramInsights(window.instagramOfficialRanges ? { accountIds: ids, ranges: window.instagramOfficialRanges() } : ids); state = result.state;
      instagramRefreshId = result.refreshId || null;
      instagramAlreadyRunning = Boolean(result.alreadyRunning);
      dashboardBackgroundRefreshing = Boolean(result.backgroundActive) && result.refreshId !== dashboardCompletedRefreshId;
      messages.push(result.alreadyRunning ? 'Instagram: coleta em segundo plano já em andamento' : `Instagram: totais consultados em ${result.totalsSucceeded}/${result.accounts} conta(s)${result.failures?.length ? ` · ${result.failures.join('; ')}` : ''}`);
    }
    if ((platform === 'all' || platform === 'tiktok') && state.accounts.some(item => item.platform === 'tiktok' && dashboardAccountMatches(item.id, platform) && item.tiktokAnalytics?.connected)) {
      const ids = state.accounts.filter(item => item.platform === 'tiktok' && dashboardAccountMatches(item.id, platform)).map(item => item.id);
      const result = await window.studio.refreshTikTokInsights(ids); state = result.state;
      messages.push(`${result.updated} vídeo(s) TikTok atualizado(s)${result.failures?.length ? ` · ${result.failures.join('; ')}` : ''}`);
    }
    render();
    if (!instagramRefreshId || instagramRefreshId !== dashboardCompletedRefreshId) dashboardRefreshMessage = `${instagramAlreadyRunning ? 'Coleta em andamento' : dashboardBackgroundRefreshing ? 'Coleta principal concluída · histórico e Reels em segundo plano' : 'Atualizado agora'} · ${messages.join(' · ')}`;
    if (!dashboardAutoRun) notify(messages.join(' · ') + '.');
  } catch (error) {
    dashboardRefreshMessage = `Falha na atualização: ${error.message}`;
    if (!dashboardAutoRun) notify(error.message, true);
  }
  finally { dashboardRefreshing = false; dashboardAutoRun = false; button.textContent = 'Atualizar métricas'; renderDashboard(); }
});
function setDashboardAutoRefresh(enabled, runNow = false) {
  if (dashboardAutoTimer) clearInterval(dashboardAutoTimer);
  dashboardAutoTimer = null;
  const button = $('#dashboard-auto-refresh');
  button.setAttribute('aria-pressed', String(enabled));
  button.textContent = enabled ? 'Auto: a cada hora' : 'Auto: desligado';
  localStorage.setItem('comment-studio-dashboard-auto-refresh', String(enabled));
  if (enabled) {
    dashboardAutoTimer = setInterval(() => {
      const refresh = $('#dashboard-refresh-insights');
      if (!dashboardRefreshing && !refresh.disabled) { dashboardAutoRun = true; refresh.click(); }
    }, 60 * 60 * 1000);
    if (runNow && !dashboardRefreshing && !$('#dashboard-refresh-insights').disabled) { dashboardAutoRun = true; $('#dashboard-refresh-insights').click(); }
  }
}
$('#dashboard-auto-refresh').addEventListener('click', () => setDashboardAutoRefresh($('#dashboard-auto-refresh').getAttribute('aria-pressed') !== 'true', true));
setDashboardAutoRefresh(localStorage.getItem('comment-studio-dashboard-auto-refresh') === 'true');
window.onInsightsProgress?.(progress => {
  if (progress.platform !== 'instagram') return;
  if (progress.phase === 'official-ready') { renderDashboard(); $('#dashboard-refresh-status').textContent = `Totais oficiais: ${progress.accountsProcessed}/${progress.accountsTotal} contas`; return; }
  if (progress.phase === 'background-start') { dashboardBackgroundRefreshing = true; $('#dashboard-refresh-status').textContent = 'Totais disponíveis · consultando histórico em segundo plano'; return; }
  if (progress.phase === 'accounts') { renderDashboard(); $('#dashboard-refresh-status').textContent = `Histórico: ${progress.completed}/${progress.total} dias desta conta`; return; }
  if (progress.phase === 'reels') { if (progress.processed === progress.total || progress.processed % 5 === 0) renderDashboard(); $('#dashboard-refresh-status').textContent = `Reels: ${progress.processed}/${progress.total} consultados em segundo plano`; return; }
  if (progress.phase === 'background-complete') {
    dashboardCompletedRefreshId = progress.refreshId || '';
    dashboardBackgroundRefreshing = false;
    dashboardRefreshMessage = `${progress.failures?.length ? 'Coleta parcial' : 'Coleta concluída'} · ${progress.accountDaysChecked || 0} dias e ${progress.updated || 0}/${progress.checked || 0} Reels consultados${progress.failures?.length ? ` · ${progress.failures.join('; ')}` : ''}`;
    renderDashboard(); $('#dashboard-refresh-status').textContent = dashboardRefreshMessage;
  }
});
$('#dashboard-tiktok-settings').addEventListener('click', () => {
  const settings = state.tiktokAnalyticsSettings || {};
  const form = $('#tiktok-analytics-form'); form.elements.clientKey.value = settings.clientKey || ''; form.elements.clientSecret.value = '';
  $('#tiktok-analytics-redirect').value = settings.redirectUri || '';
  $('#tiktok-analytics-dialog').showModal();
});
$('#tiktok-analytics-close').addEventListener('click', () => $('#tiktok-analytics-dialog').close());
$('#tiktok-analytics-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { state = await window.studio.saveTikTokAnalyticsSettings(Object.fromEntries(new FormData(event.currentTarget))); $('#tiktok-analytics-dialog').close(); render(); notify('Configuração TikTok salva. Conecte as contas em Contas.'); }
  catch (error) { notify(error.message, true); }
});
function renderHistory() {
  const actionEntries = [...(state.attempts || []).map(item => ({ ...item, platform: 'tiktok' })), ...(state.xAttempts || []).map(item => ({ ...item, platform: 'x' }))].map(item => ({ type: 'actions', at: item.at, item }));
  const eventEntries = (state.events || []).map(item => ({ type: 'events', at: item.at, item }));
  const accountIds = new Set(state.accounts.map(account => account.id));
  const postingAttempts = new Map();
  for (const attempt of state.postings?.attempts || []) if (!postingAttempts.has(attempt.item_id)) postingAttempts.set(attempt.item_id, attempt.at);
  const postingEntries = (state.postings?.items || []).filter(item => ['published', 'cancelled'].includes(item.status) || !accountIds.has(item.account_id)).map(item => ({
    type: 'postings', item, at: item.status === 'published' ? item.published_at || item.created_at : postingAttempts.get(item.id) || item.created_at
  }));
  const entries = [
    ...(['all', 'actions'].includes(historyFilter) ? actionEntries : []),
    ...(['all', 'events'].includes(historyFilter) ? eventEntries : []),
    ...(['all', 'postings'].includes(historyFilter) ? postingEntries : [])
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  const totalPages = Math.max(1, Math.ceil(entries.length / historyPageSize));
  historyPage = Math.min(historyPage, totalPages);
  const first = (historyPage - 1) * historyPageSize;
  const visible = entries.slice(first, first + historyPageSize);
  const list = $('#history-list'); list.replaceChildren();
  if (!visible.length) list.append(element('li', 'history-empty', historyFilter === 'actions' ? 'Nenhuma ação registrada.' : historyFilter === 'events' ? 'Nenhuma atividade registrada.' : historyFilter === 'postings' ? 'Nenhuma postagem concluída.' : 'Nenhum registro ainda.'));
  for (const entry of visible) {
    const row = element('li', 'history-row');
    const time = element('time', 'history-time', Number.isFinite(Date.parse(entry.at)) ? new Date(entry.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Data indisponível');
    if (entry.at) time.dateTime = entry.at;
    const body = element('div', 'history-detail');
    if (entry.type === 'actions') {
      const attempt = entry.item;
      const isX = attempt.platform === 'x';
      const labels = isX ? { confirmed: 'Confirmado', unknown: 'Resultado incerto', pending: 'Confirmando', failed: 'Falha antes do envio', skipped: 'Já curtido' } : { sent: 'Confirmado', unknown: 'Conferir no vídeo', pending: 'Conferir no vídeo', 'not-sent': 'Não enviado' };
      const kind = isX ? (attempt.action === 'like' ? 'Curtida' : 'Resposta') : 'Comentário';
      body.append(element('span', 'history-kind', `Ação · ${isX ? 'X' : 'TikTok'}`), element('strong', '', `${kind} · ${labels[attempt.status] || attempt.status}`), element('p', '', attempt.accountName || 'Conta removida'));
      if (attempt.message) body.append(element('p', 'history-message', attempt.message));
      row.append(time, body, actionButton(isX ? 'Abrir post' : 'Abrir vídeo', () => isX ? window.studio.openXAttempt(attempt.id) : window.studio.openAttempt(attempt.id)));
    } else if (entry.type === 'postings') {
      const item = entry.item;
      const account = state.accounts.find(account => account.id === item.account_id);
      const accountName = item.account_name || (account ? profileLabel(account) : 'Conta removida');
      const filename = item.file.split(/[\\/]/).pop();
      const statusLabel = { published: 'Publicado', cancelled: 'Cancelado', attention: 'Precisa de atenção', uncertain: 'Resultado incerto', queued: 'Cancelado com a conta' }[item.status] || item.status;
      body.append(element('span', 'history-kind', `Postagem · Instagram${item.queue_kind === 'shared' ? ' · Fila única' : ''}`), element('strong', '', `${filename} · ${statusLabel}`), element('p', '', accountName));
      if (item.error) body.append(element('p', 'history-message', item.error));
      row.append(time, body);
      if (item.status === 'published' && item.permalink) row.append(actionButton('Abrir Reel', () => window.studio.openPublishedReel(item.id)));
    } else {
      body.append(element('span', 'history-kind', 'Atividade'), element('strong', '', entry.item.message));
      row.append(time, body);
    }
    list.append(row);
  }
  $$('.history-filters button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyFilter === historyFilter)));
  $('#history-summary').textContent = entries.length ? `Exibindo ${first + 1}–${first + visible.length} de ${entries.length} registro${entries.length === 1 ? '' : 's'}` : 'Nenhum registro encontrado';
  $('#history-page-label').textContent = `Página ${historyPage} de ${totalPages}`;
  $('#history-prev').disabled = historyPage <= 1;
  $('#history-next').disabled = historyPage >= totalPages;
}
function renderAutomation() {
  $('.sidebar-footer small').textContent = `Versão ${state.version || '—'}`;
  let attentionList = $('#account-attention');
  if (!attentionList) {
    attentionList = element('div', 'record-list'); attentionList.id = 'account-attention';
    $('#run-progress').after(attentionList);
  }
  attentionList.replaceChildren();
  attentionList.hidden = !state.automation?.attentionAccounts?.length;
  attentionList.setAttribute('aria-live', 'polite');
  for (const item of state.automation?.attentionAccounts || []) {
    const row = element('div', 'record');
    row.append(element('strong', '', item.accountName), element('p', '', item.reason));
    if (item.videoId) row.append(element('small', '', `Vídeo pendente: ${item.videoId}`));
    row.append(actionButton('Abrir conta', () => window.studio.openAccount(item.accountId)));
    row.append(actionButton('Continuar', () => window.studio.resumeAccount(item.accountId), 'primary'));
    attentionList.append(row);
  }
  const run = state.automation || { status: 'idle', posted: 0, scanned: 0, message: '' };
  const running = ['running', 'pausing', 'paused'].includes(run.status);
  let workers = $('#account-workers');
  if (!workers) { workers = element('div', 'record-list'); workers.id = 'account-workers'; attentionList.after(workers); }
  workers.replaceChildren();
  for (const progress of run.accountProgress || []) {
    const row = element('div', 'record');
    const labels = { waiting: 'Aguardando limite', running: 'Em execução', paused: 'Pausada', pausing: 'Pausando', recovering: 'Recuperando', attention: 'Atenção', completed: 'Concluída', stopped: 'Parada' };
    row.append(element('strong', '', state.accounts.find(a => a.id === progress.accountId)?.name || 'Conta'), element('p', '', `${labels[progress.status] || 'Preparando'} · ${progress.posted || 0} enviados`));
    if (progress.reason) row.append(element('small', '', progress.reason));
    if (running && !['completed', 'stopped'].includes(progress.status)) {
      const paused = ['paused', 'pausing', 'attention'].includes(progress.status);
      row.append(actionButton(paused ? 'Continuar esta conta' : 'Pausar esta conta', () => paused ? window.studio.resumeAccount(progress.accountId) : window.studio.pauseAccount(progress.accountId)));
      if (progress.status === 'waiting') row.append(actionButton('Reiniciar ciclo', () => window.studio.restartAccountCycle(progress.accountId), 'primary'));
    }
    workers.append(row);
  }
  const challenged = Boolean(run.challenges?.length);
  const needsAttention = Boolean(run.attentionAccounts?.length);
  const labels = { idle: 'Pronto para começar', running: 'Campanha em andamento', pausing: 'Pausando campanha', paused: 'Campanha pausada', completed: 'Campanha concluída', stopped: 'Campanha parada', error: 'Ação necessária' };
  $('#run-heading').textContent = challenged ? 'Verificação necessária' : needsAttention ? 'Conta precisa de atenção' : labels[run.status] || labels.idle;
  $('#run-heading').closest('.summary-note').classList.toggle('attention', challenged || needsAttention);
  $('#run-status').textContent = challenged ? `Resolva a verificação na janela: ${run.challenges.map(item => item.accountName).join(', ')}.` : campaignDirty ? 'Salve as alterações antes de iniciar.' : (!state.campaign ? 'Salve a campanha para iniciar.' : run.message || 'Pronto para iniciar.');
  $('#run-progress').hidden = !running && !run.posted && !run.scanned;
  $('#run-progress').textContent = `${run.posted || 0} confirmado(s) · ${run.scanned || 0} vídeo(s) aberto(s)`;
  $('#start-campaign').disabled = running || !state.campaign || campaignDirty;
  $('#start-campaign').hidden = running;
  $('#start-campaign').textContent = 'Iniciar campanha';
  $('#pause-campaign').hidden = !running;
  $('#pause-campaign').disabled = run.status === 'pausing';
  $('#pause-campaign').textContent = run.status === 'paused' ? 'Continuar' : run.status === 'pausing' ? 'Pausando…' : 'Pausar';
  $('#check-campaign').disabled = running || !state.campaign || campaignDirty;
  $('#stop-campaign').hidden = !running;
}
function summary() {
  const f = campaignForm.elements;
  const phrases = f.comments.value.split(/\r?\n/).filter(line => line.trim()).length;
  const targetType = f.targetType.value;
  const hashtag = targetType === 'hashtag';
  const foryou = targetType === 'foryou';
  $('#target-field').hidden = foryou;
  $('#target-row').classList.toggle('foryou', foryou);
  $('#hashtag-switch').hidden = foryou;
  f.target.required = false;
  renderTargetTags();
  $('#target-label').textContent = hashtag ? 'Hashtags' : 'Palavras ou frases';
  f.target.placeholder = hashtag ? 'Ex.: futebol, esportes, brasileirão' : 'zangi\namizade online\nconhecer pessoas';
  $('#target-mode-help').hidden = false;
  $('#target-mode-help').textContent = foryou
    ? 'Usa os vídeos recomendados da página principal “Para você”, não os vídeos do seu perfil.'
    : 'Digite e pressione Enter ou Adicionar. Alterna na ordem das tags, usando o intervalo abaixo.';
  $('#summary-name').textContent = f.name.value.trim() || 'Campanha sem nome';
  const hashtagValues = f.target.value.split(/[\s,;]+/).map(value => value.replace(/^#+/, '')).filter(Boolean);
  const searchCount = new Set(f.target.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)).size;
  $('#summary-target').textContent = foryou ? 'Página principal · Para você' : f.target.value.trim() ? (hashtag ? `${hashtagValues.length} hashtag${hashtagValues.length === 1 ? '' : 's'}` : `${searchCount} busca${searchCount === 1 ? '' : 's'}`) : 'Não definido';
  $('#summary-accounts').textContent = $$('input[name=accountIds]:checked').length;
  const phraseText = `${phrases} frase${phrases === 1 ? '' : 's'}`;
  $('#phrase-count').textContent = phraseText; $('#summary-comments').textContent = phraseText;
  $('#summary-watch').textContent = `${f.watchSeconds.value || '0'} segundos`;
  $('#summary-order').textContent = f.random.checked ? 'Aleatória' : 'Sequencial';
  $('#campaign-footnote').textContent = foryou ? 'O app usa os recomendados da página principal e publica os comentários salvos.' : 'Verificar acesso abre um vídeo sem publicar. Iniciar publica os comentários salvos.';
}
campaignForm.addEventListener('input', () => { campaignDirty = true; summary(); renderAutomation(); $('#save-status').textContent = 'Alterações ainda não salvas'; });
campaignForm.addEventListener('change', () => { campaignDirty = true; summary(); renderAutomation(); $('#save-status').textContent = 'Alterações ainda não salvas'; });
function formData(form) { const data = Object.fromEntries(new FormData(form)); for (const input of form.querySelectorAll('input[type=checkbox]')) { if (input.name !== 'accountIds') data[input.name] = input.checked; } return data; }
campaignForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (campaignForm.elements.targetType.value !== 'foryou' && targetEntry.value.trim()) {
    addTargetItem();
    if (targetEntry.value.trim()) return;
  }
  const data = formData(campaignForm); data.accountIds = $$('input[name=accountIds]:checked').map(input => input.value);
  const ok = await action(event.submitter, () => window.studio.saveCampaign(data), 'Configuração salva. Nenhuma interação foi executada.');
  if (ok) { campaignDirty = false; $('#save-status').textContent = `Salva em ${formatDate(state.campaign.updatedAt)}`; renderAutomation(); }
});
$('#start-campaign').addEventListener('click', async event => {
  const button = event.currentTarget;
  await action(button, () => window.studio.startCampaign());
  renderAutomation();
});
$('#stop-campaign').addEventListener('click', async event => {
  const button = event.currentTarget;
  await action(button, () => window.studio.stopCampaign());
  renderAutomation();
});
$('#pause-campaign').addEventListener('click', async event => {
  await action(event.currentTarget, () => state.automation?.status === 'paused' ? window.studio.resumeCampaign() : window.studio.pauseCampaign());
  renderAutomation();
});
$('#check-campaign').addEventListener('click', async event => {
  const button = event.currentTarget;
  await action(button, () => window.studio.checkCampaign(), 'Acesso verificado. Nenhuma interação foi executada.');
  renderAutomation();
});
window.onAutomation(next => { state.automation = next.automation; state.events = next.events; state.attempts = next.attempts; if (currentPage === 'history') render(); else renderAutomation(); });
function renderMedia() {
  const busy = mediaState.running || downloadState.running;
  const list = $('#media-video-list'); list.replaceChildren();
  if (!mediaState.videos.length) list.append(element('p', '', 'Nenhum vídeo selecionado.'));
  else mediaState.videos.forEach((video, index) => {
    const row = element('div', 'media-file');
    row.append(element('span', '', fileName(video)), element('small', '', `${index + 1} de ${mediaState.videos.length}`));
    list.append(row);
  });
  const imgList = $('#media-image-list'); imgList.replaceChildren();
  if (!mediaState.images.length) imgList.append(element('p', '', 'Nenhuma imagem selecionada.'));
  else mediaState.images.forEach((image, index) => {
    const row = element('div', 'media-file');
    row.append(element('span', '', fileName(image)), element('small', '', `${index + 1} de ${mediaState.images.length}`));
    imgList.append(row);
  });
  $('#media-cover-value').textContent = mediaState.cover ? fileName(mediaState.cover) : 'Sem capa — somente limpeza de metadados';
  $('#media-remove-cover').hidden = !mediaState.cover || busy;
  $('#cover-duration-row').hidden = !mediaState.cover;
  $('#media-output-value').textContent = mediaState.outputDir || 'Nenhuma pasta selecionada';
  $('#download-output-value').textContent = mediaState.outputDir || 'Nenhuma pasta selecionada';
  const linkList = $('#download-link-list'); linkList.replaceChildren();
  if (downloadState.analysisError) linkList.append(element('span', 'download-link error', downloadState.analysisError));
  else if (!downloadState.totalFound) linkList.append(element('p', '', 'Nenhum link informado.'));
  else {
    const groups = new Map();
    downloadState.links.forEach(item => groups.set(item.label, (groups.get(item.label) || 0) + 1));
    const platforms = [...groups].map(([label, count]) => label === 'Instagram Reels' ? `${count} Reel${count === 1 ? '' : 's'} do Instagram` : `${count} ${label}`).join(' · ');
    const ignored = downloadState.ignoredCount ? ` · ${downloadState.ignoredCount} ignorado${downloadState.ignoredCount === 1 ? '' : 's'}` : '';
    const count = downloadState.links.length;
    linkList.append(element('p', 'download-summary', `${count} link${count === 1 ? '' : 's'} válido${count === 1 ? '' : 's'}${platforms ? ` · ${platforms}` : ''}${ignored}`));
  }
  $('#media-start').disabled = busy || (!mediaState.videos.length && !mediaState.images.length) || !mediaState.outputDir;
  $('#download-start').disabled = busy || !downloadState.links.length || !mediaState.outputDir;
  $('#download-links').disabled = busy;
  $('#download-pick-output').disabled = busy;
  $('#media-pick-videos').disabled = busy;
  $('#media-pick-images').disabled = busy;
  $('#media-pick-cover').disabled = busy;
  $('#media-pick-output').disabled = busy;
  mediaForm.elements.coverSeconds.disabled = busy;
  $('#media-cancel').hidden = !mediaState.running;
  $('#download-cancel').hidden = !downloadState.running;
}
async function chooseMedia(button, picker, apply) {
  const label = button.textContent; button.disabled = true; button.textContent = 'Aguarde…';
  try { const value = await picker(); if (value && (!Array.isArray(value) || value.length)) apply(value); renderMedia(); }
  catch (error) { notify(error.message, true); }
  finally { button.textContent = label; renderMedia(); }
}
$('#media-pick-videos').addEventListener('click', event => chooseMedia(event.currentTarget, () => window.studio.pickMediaVideos(), value => { mediaState.videos = value; }));
$('#media-pick-images').addEventListener('click', event => chooseMedia(event.currentTarget, () => window.studio.pickMediaImages(), value => { mediaState.images = value; }));
$('#media-pick-cover').addEventListener('click', event => chooseMedia(event.currentTarget, () => window.studio.pickMediaCover(), value => { mediaState.cover = value; }));
$('#media-remove-cover').addEventListener('click', () => { mediaState.cover = null; renderMedia(); });
$('#media-pick-output').addEventListener('click', event => chooseMedia(event.currentTarget, () => window.studio.pickMediaOutput(), value => { mediaState.outputDir = value; }));
$('#download-pick-output').addEventListener('click', event => chooseMedia(event.currentTarget, () => window.studio.pickMediaOutput(), value => { mediaState.outputDir = value; }));
let linkAnalysisTimer;
let linkAnalysisVersion = 0;
$('#download-links').addEventListener('input', event => {
  clearTimeout(linkAnalysisTimer);
  const value = event.currentTarget.value;
  const version = ++linkAnalysisVersion;
  if (!value.trim()) { downloadState.links = []; downloadState.ignoredCount = 0; downloadState.totalFound = 0; downloadState.analysisError = null; renderMedia(); return; }
  linkAnalysisTimer = setTimeout(async () => {
    try { const result = await window.studio.inspectDownloadLinks(value); if (version === linkAnalysisVersion) { downloadState.links = result.links; downloadState.ignoredCount = result.ignoredCount; downloadState.totalFound = result.totalFound; downloadState.analysisError = null; } }
    catch (error) { if (version === linkAnalysisVersion) { downloadState.links = []; downloadState.ignoredCount = 0; downloadState.totalFound = 0; downloadState.analysisError = error.message; } }
    if (version === linkAnalysisVersion) renderMedia();
  }, 300);
});
$('#download-start').addEventListener('click', async () => {
  if (!downloadState.links.length || !mediaState.outputDir) { notify('Informe os links e escolha a pasta para downloads.', true); return; }
  downloadState.running = true; renderMedia();
  $('#download-progress').hidden = false; $('#download-progress progress').value = 0;
  $('#download-progress-label').textContent = 'Iniciando downloads…'; $('#download-progress-percent').textContent = '0%';
  try {
    const result = await window.studio.startDownloadJob({ links: downloadState.links.map(item => item.url), outputDir: mediaState.outputDir });
    mediaState.videos = [...new Set([...mediaState.videos, ...result.files])];
    const message = result.failures.length ? `${result.files.length} baixado(s); ${result.failures.length} falharam.` : `${result.files.length} vídeo(s) baixado(s) e adicionados à lista.`;
    $('#download-progress-label').textContent = message;
    notify(message, Boolean(result.failures.length && !result.files.length));
  } catch (error) {
    $('#download-progress-label').textContent = error.message === 'Downloads cancelados.' ? 'Downloads cancelados' : 'Falha nos downloads';
    notify(error.message, error.message !== 'Downloads cancelados.');
  } finally { downloadState.running = false; renderMedia(); }
});
$('#download-cancel').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await window.studio.cancelDownloadJob(); }
  catch (error) { notify(error.message, true); }
  finally { event.currentTarget.disabled = false; }
});
mediaForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!mediaState.videos.length && !mediaState.images.length || !mediaState.outputDir) { notify('Selecione os arquivos e a pasta de saída.', true); return; }
  mediaState.running = true; renderMedia();
  $('#media-progress').hidden = false; $('#media-progress progress').value = 0;
  $('#media-progress-label').textContent = 'Preparando mídia…'; $('#media-progress-percent').textContent = '0%';
  $('#media-open-output').hidden = true;
  try {
    const result = await window.studio.startMediaJob({ videos: mediaState.videos, images: mediaState.images, cover: mediaState.cover, outputDir: mediaState.outputDir, coverSeconds: Number(mediaForm.elements.coverSeconds.value) });
    mediaState.videos = []; mediaState.images = [];
    $('#media-progress-label').textContent = `${result.outputs.length} arquivo(s) preparado(s)`;
    $('#media-open-output').hidden = false;
    notify('Mídia preparada. Os arquivos originais foram removidos após a conclusão.');
  } catch (error) {
    $('#media-progress-label').textContent = error.message === 'Processamento cancelado.' ? 'Processamento cancelado' : 'Falha no processamento';
    notify(error.message, error.message !== 'Processamento cancelado.');
  } finally { mediaState.running = false; renderMedia(); }
});
$('#media-cancel').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try { await window.studio.cancelMediaJob(); }
  catch (error) { notify(error.message, true); }
  finally { event.currentTarget.disabled = false; }
});
$('#media-open-output').addEventListener('click', event => action(event.currentTarget, () => window.studio.openMediaOutput(mediaState.outputDir)));
window.onMediaProgress(progress => {
  $('#media-progress').hidden = false;
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
  $('#media-progress progress').value = percent;
  $('#media-progress-percent').textContent = `${percent}%`;
  if (progress.file) $('#media-progress-label').textContent = `${progress.index} de ${progress.total} · ${fileName(progress.file)}`;
});
window.onDownloadProgress(progress => {
  $('#download-progress').hidden = false;
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
  $('#download-progress progress').value = percent;
  $('#download-progress-percent').textContent = `${percent}%`;
  if (progress.platform) {
    const detail = progress.status === 'file-error' ? 'falhou' : progress.speed ? `${progress.speed}${progress.eta ? ` · ${progress.eta} restantes` : ''}` : 'preparando';
    $('#download-progress-label').textContent = `${progress.index} de ${progress.total} · ${progress.platform} · ${detail}`;
  }
});
accountForm.addEventListener('submit', async event => {
  event.preventDefault(); const data = formData(event.target); const editing = Boolean(data.id);
  data.handle = String(data.handle || '').trim().replace(/^@/, '');
  if (!data.handle || data.handle.length > 80 || /\s|@/.test(data.handle)) { notify('Informe um @ sem espaços e com até 80 caracteres.', true); accountForm.elements.handle.focus(); return; }
  if (state.accounts.some(account => account.id !== data.id && (account.platform || 'tiktok') === data.platform && account.handle?.toLocaleLowerCase('pt-BR') === data.handle.toLocaleLowerCase('pt-BR'))) { notify(`@${data.handle} já está cadastrado nesta rede.`, true); accountForm.elements.handle.focus(); return; }
  data.name = data.handle;
  const platform = platformName(data.platform);
  if (await action(event.submitter, () => editing ? window.studio.editAccount(data) : window.studio.addAccount(data), editing ? 'Conta atualizada.' : `Conta cadastrada. Abra o ${platform} para fazer o login.`)) resetAccountForm();
});
const proxyPaste = $('#proxy-paste');
let suggestedProxyName = '';
proxyPaste.addEventListener('input', () => {
  proxyPaste.setCustomValidity('');
  $('#proxy-paste-status').textContent = '';
  if (!proxyPaste.value.trim()) return;
  try {
    const parsed = window.parseProxyLine(proxyPaste.value);
    for (const [key, value] of Object.entries(parsed)) proxyForm.elements.namedItem(key).value = value;
    const name = proxyForm.elements.namedItem('name');
    if (!name.value || name.value === suggestedProxyName) {
      suggestedProxyName = `Proxy ${parsed.host}:${parsed.port}`;
      name.value = suggestedProxyName;
    }
    $('#proxy-paste-status').textContent = 'Dados preenchidos. Pode salvar.';
  } catch (error) {
    proxyPaste.setCustomValidity(error.message);
    $('#proxy-paste-status').textContent = error.message;
  }
});
proxyForm.addEventListener('submit', async event => {
  event.preventDefault();
  const data = formData(event.target);
  const editing = Boolean(data.id);
  $('#proxy-form-error').hidden = true;
  if (proxyPaste.value.trim()) {
    try { Object.assign(data, window.parseProxyLine(proxyPaste.value)); }
    catch (error) { $('#proxy-form-error').textContent = error.message; $('#proxy-form-error').hidden = false; return; }
  }
  const button = event.submitter || $('#proxy-submit'); button.disabled = true; const previous = button.textContent; button.textContent = editing ? 'Salvando…' : 'Testando e salvando…';
  try { state = await (editing ? window.studio.editProxy(data) : window.studio.addProxy(data)); render(); resetProxyForm(); notify(editing ? 'Proxy atualizado.' : 'Proxy testado e salvo.'); }
  catch (error) { $('#proxy-form-error').textContent = error.message; $('#proxy-form-error').hidden = false; }
  finally { button.disabled = false; if ($('#proxy-dialog').open) button.textContent = previous; }
});
$('#refresh-accounts').addEventListener('click', event => action(event.currentTarget, () => window.studio.state()));
$('#refresh-history').addEventListener('click', event => action(event.currentTarget, () => window.studio.state()));
$$('.history-filters button').forEach(button => button.addEventListener('click', () => { historyFilter = button.dataset.historyFilter; historyPage = 1; renderHistory(); }));
$('#history-page-size').addEventListener('change', event => { historyPageSize = Number(event.currentTarget.value); historyPage = 1; renderHistory(); });
$('#history-prev').addEventListener('click', () => { if (historyPage > 1) { historyPage--; renderHistory(); } });
$('#history-next').addEventListener('click', () => { historyPage++; renderHistory(); });
async function initialize() {
  try {
    state = await window.studio.state(); render();
    if (state.campaign) {
      for (const [key, value] of Object.entries(state.campaign)) {
        const field = campaignForm.elements.namedItem(key);
        if (key === 'accountIds') { $$('input[name=accountIds]').forEach(input => { input.checked = value.includes(input.value); }); }
        else if (field) { if (field.type === 'checkbox') field.checked = value; else field.value = Array.isArray(value) ? value.join('\n') : value; }
      }
      if (state.campaign.likePercent === undefined) campaignForm.elements.likePercent.value = state.campaign.engagementPercent ?? 35;
      if (state.campaign.favoritePercent === undefined) campaignForm.elements.favoritePercent.value = state.campaign.engagementPercent ?? 20;
      $('#save-status').textContent = `Salva em ${formatDate(state.campaign.updatedAt)}`;
    }
    summary(); renderMedia(); document.body.dataset.ready = 'true';
  } catch (error) { notify(`Não foi possível carregar os dados: ${error.message}`, true); }
}
initialize();
