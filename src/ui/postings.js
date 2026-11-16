(function () {
  const root = document.querySelector('#posting-accounts');
  const tabButtons = [...document.querySelectorAll('[data-posting-tab]')];
  const tabPanels = Object.fromEntries(['queue', 'schedule', 'settings'].map(name => [name, document.querySelector(`#posting-tab-${name}`)]));
  const accountSetup = document.querySelector('#posting-account-setup');
  const accountPicker = document.querySelector('#posting-account-picker');
  const accountChoices = document.querySelector('#posting-account-choices');
  const accountSummary = document.querySelector('#posting-account-summary');
  const accountFilter = document.querySelector('#posting-account-filter');
  const accountSearch = document.querySelector('#posting-account-search');
  const accountScope = document.querySelector('#posting-account-scope');
  const accountCount = document.querySelector('#posting-account-count');
  function filterAccountChoices() {
    const query = accountSearch.value.trim().replace(/^@/, '').toLocaleLowerCase('pt-BR');
    let matches = 0;
    for (const choice of accountChoices.children) {
      choice.hidden = !choice.dataset.search.includes(query);
      if (!choice.hidden) matches++;
    }
    document.querySelector('#posting-account-no-results').hidden = matches > 0;
  }
  function closeAccountFilter(restoreFocus = false) {
    if (!accountFilter.open) return;
    accountFilter.open = false;
    if (restoreFocus) accountFilter.querySelector('summary').focus();
  }
  accountSearch.addEventListener('input', filterAccountChoices);
  document.querySelector('#posting-account-done').addEventListener('click', () => closeAccountFilter(true));
  document.addEventListener('click', event => {
    if (!accountFilter.contains(event.target)) closeAccountFilter();
  });
  accountFilter.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !accountFilter.open) return;
    event.preventDefault();
    closeAccountFilter(true);
  });
  const selectionEmpty = document.querySelector('#posting-selection-empty');
  const addAccountForm = document.querySelector('#posting-account-form');
  const addProxyForm = document.querySelector('#posting-new-proxy-form');
  const proxySelect = document.querySelector('#posting-account-proxy');
  const startAll = document.querySelector('#posting-start-all');
  const startSelected = document.querySelector('#posting-start-selected');
  const search = document.querySelector('#posting-search');
  const statusFilter = document.querySelector('#posting-status-filter');
  const sort = document.querySelector('#posting-sort');
  let starting = false;
  let startable = new Set();
  const avatarObserver = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      avatarObserver.unobserve(target);
      window.studio.postingProfilePicture?.(target.dataset.accountId).then(image => {
        if (!image || !target.isConnected) return;
        const photo = make('img'); photo.alt = ''; photo.src = image;
        photo.addEventListener('load', () => target.replaceChildren(photo), { once: true });
      }).catch(() => {});
    }
  });
  const queueReady = document.querySelector('#posting-queue-ready');
  let activeTab = 'queue';
  const selectedAccountIds = new Set();
  const queueOpen = new Map();
  const itemOpen = new Map();
  const folderImports = new Map();
  let selectionInitialized = false;
  let proxyTargetAccountId = '';
  let scheduleConfirmation = null;
  const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
  const showError = error => {
    const status = document.querySelector(accountSetup.open ? '#posting-setup-feedback' : '#posting-feedback');
    status.replaceChildren(document.createTextNode(error.message));
    if (/Prepare em Mídia|Use um vídeo MP4|Arquivo de vídeo/i.test(error.message)) {
      const prepare = make('button', 'Abrir Mídia', 'secondary'); prepare.type = 'button';
      prepare.addEventListener('click', () => document.querySelector('[data-page="media"]')?.click());
      status.append(document.createTextNode(' '), prepare);
    }
    status.hidden = false;
  };
  const clearError = () => {
    for (const status of document.querySelectorAll('#posting-feedback, #posting-setup-feedback')) {
      status.hidden = true;
      status.replaceChildren();
    }
  };
  const updateBatchControls = () => {
    startAll.hidden = !startable.size;
    startAll.disabled = starting || !startable.size;
    const count = [...selectedAccountIds].filter(id => startable.has(id)).length;
    startSelected.hidden = count < 2 || count === startable.size;
    startSelected.disabled = starting;
  };
  async function startBatch(accountIds) {
    if (starting) return;
    starting = true;
    updateBatchControls();
    try {
      const result = await window.studio.startQueuedPostings(accountIds ? { accountIds } : undefined);
      if (window.applyStudioState) window.applyStudioState(result.state); else window.renderPostings(result.state);
      const parts = [];
      if (result.started.length) parts.push(`${result.started.length} ${result.started.length === 1 ? 'fila iniciada' : 'filas iniciadas'}: ${result.started.join(', ')}.`);
      if (result.skipped.length) parts.push(`Precisam de ajuste: ${result.skipped.map(item => `${item.account} (${item.reason})`).join('; ')}.`);
      const feedback = document.querySelector('#posting-feedback');
      feedback.textContent = parts.join(' ') || 'Nenhuma fila pendente para iniciar.';
      feedback.hidden = false;
    } catch (error) { showError(error); }
    finally { starting = false; updateBatchControls(); }
  }
  startAll.addEventListener('click', () => startBatch());
  startSelected.addEventListener('click', () => startBatch([...selectedAccountIds]));
  const input = (type, value) => { const el = make('input'); el.type = type; if (value !== undefined) el.value = value; return el; };
  const field = (label, el) => { const node = make('label', label); node.append(el); return node; };
  const button = (text, run, kind = 'secondary') => { const el = make('button', text, kind); el.type = 'button'; el.addEventListener('click', async () => { el.disabled = true; try { const next = await run(); if (next?.accounts) { window.postingState = next; window.renderPostings(next); } } catch (error) { showError(error); } finally { el.disabled = false; } }); return el; };
  const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const zoneDate = (value, timeZone = 'America/Sao_Paulo') => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone });
  const accountLabel = account => account.name && account.name !== account.handle ? account.name : account.handle ? `@${account.handle}` : account.name || 'Conta';
  const proxyLabel = (proxy, accounts) => {
    const linked = accounts.filter(account => account.proxyId === proxy.id);
    return linked.length === 1 && linked[0].platform === 'instagram' && linked[0].handle ? `Proxy @${linked[0].handle}` : proxy.name;
  };
  const zoneTime = (value, timeZone = 'America/Sao_Paulo') => new Date(value).toLocaleTimeString('pt-BR', { timeZone, timeStyle: 'short' });
  const zoneParts = (date, timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  function nextPublication(value, timeZone) {
    if (!value) return 'Não programada';
    const date = new Date(value);
    const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short' });
    if (localDay.format(date) !== localDay.format(new Date())) return zoneDate(value, timeZone);
    return `Hoje, ${date.toLocaleTimeString('pt-BR', { timeZone, timeStyle: 'short' })}`;
  }
  const firstInZone = (value, timeZone) => { const part = zoneParts(new Date(value), timeZone); return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`; };
  const showTab = (name, accountId) => {
    if (name !== activeTab) closeAccountFilter();
    activeTab = name;
    if (accountId !== undefined) { selectedAccountIds.clear(); selectedAccountIds.add(accountId); scheduleConfirmation = null; }
    for (const button of tabButtons) {
      const selected = button.dataset.postingTab === name;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const [key, panel] of Object.entries(tabPanels)) panel.hidden = key !== name;
    if (name === 'queue' || name === 'schedule') tabPanels[name].append(root);
    const cards = [...root.querySelectorAll('.posting-card[data-account-id]')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    const filtering = ['queue', 'schedule'].includes(name);
    accountPicker.hidden = !filtering || cards.length === 0 || (cards.length === 1 && selectedAccountIds.size === 1);
    const count = selectedAccountIds.size;
    accountSummary.textContent = `${count} ${count === 1 ? 'conta selecionada' : 'contas selecionadas'}`;
    const totalAccounts = accountChoices.childElementCount;
    accountScope.textContent = count && count === totalAccounts ? 'Todas as contas' : count ? `${count} de ${totalAccounts} contas` : 'Nenhuma conta marcada';
    accountCount.textContent = `${count} de ${totalAccounts} selecionadas`;
    if (accountPicker.hidden) closeAccountFilter();
    for (const choice of accountChoices.querySelectorAll('input[type=checkbox]')) choice.checked = selectedAccountIds.has(choice.value);
    selectionEmpty.hidden = !filtering || count > 0;
    const confirmedSelection = scheduleConfirmation?.accountIds.join('|') === [...selectedAccountIds].join('|');
    const query = search.value.trim().replace(/^@/, '').toLocaleLowerCase('pt-BR');
    const statusOrder = { running: 0, paused: 1, stopped: 2 };
    const compare = {
      next: (a, b) => Number(a.dataset.next) - Number(b.dataset.next),
      pending: (a, b) => Number(b.dataset.pending) - Number(a.dataset.pending),
      status: (a, b) => statusOrder[a.dataset.status] - statusOrder[b.dataset.status]
    };
    if (name === 'queue') cards.sort(compare[sort.value]);
    const archived = root.querySelector('.posting-archived');
    const displayed = [...root.querySelectorAll('.posting-card[data-account-id]')];
    if (cards.some((card, index) => card !== displayed[index])) for (const card of cards) root.insertBefore(card, archived);
    let visible = 0;
    for (const card of cards) {
      const matchesStatus = !statusFilter.value || (statusFilter.value === 'attention' ? card.dataset.attention === 'true' : statusFilter.value === card.dataset.status);
      card.hidden = !selectedAccountIds.has(card.dataset.accountId) || (name === 'queue' && (!card.dataset.search.includes(query) || !matchesStatus));
      if (!card.hidden) visible++;
      card.querySelector('.posting-media-settings').hidden = name !== 'queue';
      card.querySelector('.posting-programming').hidden = name !== 'schedule';
      card.querySelector('.posting-batch-note').hidden = count < 2;
      card.querySelector('.posting-save-rhythm').textContent = count > 1 ? `Aplicar horários às ${count} contas` : 'Salvar horários';
      const confirmation = card.querySelector('.posting-schedule-confirmation');
      if (confirmation) confirmation.hidden = !confirmedSelection || card.dataset.accountId !== scheduleConfirmation.sourceAccountId;
      card.querySelector('.posting-list').hidden = name !== 'queue';
      card.querySelector('.posting-execution').hidden = name !== 'queue';
    }
    if (archived) archived.hidden = name !== 'queue';
    document.querySelector('#posting-filter-empty').hidden = name !== 'queue' || !count || visible > 0;
    updateBatchControls();
  };
  search.addEventListener('input', () => showTab(activeTab));
  for (const field of [statusFilter, sort]) field.addEventListener('change', () => showTab(activeTab));
  tabButtons.forEach((button, index) => button.addEventListener('click', () => showTab(button.dataset.postingTab)));
  document.querySelector('#posting-close-setup').addEventListener('click', () => accountSetup.close());
  accountSetup.addEventListener('close', () => {
    addProxyForm.hidden = true;
    addProxyForm.reset();
    proxyTargetAccountId = '';
    clearError();
  });
  document.querySelector('#posting-add-account-shortcut').addEventListener('click', () => {
    showTab('queue');
    if (!accountSetup.open) accountSetup.showModal();
    addAccountForm.elements.name.focus();
  });
  const openProxyForm = (accountId = '', name = '') => {
    if (!accountSetup.open) accountSetup.showModal();
    proxyTargetAccountId = accountId;
    addProxyForm.reset();
    addProxyForm.elements.name.value = name.trim() ? `Proxy ${name.trim().replace(/^@/, '')}` : 'Proxy Instagram';
    addProxyForm.hidden = false;
    addProxyForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    addProxyForm.elements.paste.focus();
  };
  document.querySelector('#posting-add-proxy').addEventListener('click', () => openProxyForm('', addAccountForm.elements.name.value));
  document.querySelector('#posting-new-proxy-cancel').addEventListener('click', () => { addProxyForm.hidden = true; addProxyForm.reset(); proxyTargetAccountId = ''; });
  addProxyForm.elements.paste.addEventListener('input', () => {
    addProxyForm.elements.paste.setCustomValidity('');
    if (!addProxyForm.elements.paste.value.trim()) return;
    try {
      const parsed = window.parseProxyLine(addProxyForm.elements.paste.value);
      for (const [key, value] of Object.entries(parsed)) addProxyForm.elements.namedItem(key).value = value;
    } catch (error) { addProxyForm.elements.paste.setCustomValidity(error.message); }
  });
  addProxyForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter || addProxyForm.querySelector('button[type=submit]');
    const data = Object.fromEntries(new FormData(addProxyForm));
    if (data.paste?.trim()) {
      try { Object.assign(data, window.parseProxyLine(data.paste)); }
      catch (error) { showError(error); return; }
    }
    delete data.paste;
    submit.disabled = true;
    try {
      const previous = new Set((window.postingState?.proxies || []).map(proxy => proxy.id));
      const next = await window.studio.addProxy(data);
      const created = next.proxies.find(proxy => !previous.has(proxy.id));
      if (!created) throw new Error('A proxy foi salva, mas não apareceu na lista. Atualize o estado.');
      window.applyStudioState(next);
      const target = proxyTargetAccountId ? [...root.querySelectorAll('.posting-card')].find(card => card.dataset.accountId === proxyTargetAccountId)?.querySelector('.posting-account-connection select') : proxySelect;
      if (target) target.value = created.id;
      if (proxyTargetAccountId) accountSetup.close();
      addProxyForm.hidden = true; addProxyForm.reset(); proxyTargetAccountId = '';
    } catch (error) { showError(error); }
    finally { submit.disabled = false; }
  });
  addAccountForm.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter || addAccountForm.querySelector('button[type=submit]');
    const name = addAccountForm.elements.name.value.trim();
    if (name.length > 120) { showError(new Error('O nome da conta deve ter até 120 caracteres.')); addAccountForm.elements.name.focus(); return; }
    const previous = new Set((window.postingState?.accounts || []).map(account => account.id));
    submit.disabled = true;
    try {
      const next = await window.studio.addAccount({ platform: 'instagram', name, proxyId: proxySelect.value });
      const created = next.accounts.find(account => !previous.has(account.id));
      if (!created) throw new Error('A conta foi salva, mas não apareceu na lista. Atualize o estado.');
      selectedAccountIds.clear(); selectedAccountIds.add(created.id);
      search.value = ''; statusFilter.value = '';
      window.applyStudioState(next);
      addAccountForm.reset();
      document.querySelector('#posting-feedback').hidden = true;
    } catch (error) { showError(error); }
    finally { submit.disabled = false; }
  });
  document.querySelector('.posting-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabButtons.findIndex(button => button.dataset.postingTab === activeTab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length;
    tabButtons[next].focus();
    showTab(tabButtons[next].dataset.postingTab);
  });
  document.querySelector('#posting-select-all').addEventListener('click', () => {
    scheduleConfirmation = null;
    selectedAccountIds.clear();
    for (const choice of accountChoices.querySelectorAll('input[type=checkbox]')) selectedAccountIds.add(choice.value);
    showTab(activeTab);
  });
  document.querySelector('#posting-clear-selection').addEventListener('click', () => { scheduleConfirmation = null; selectedAccountIds.clear(); showTab(activeTab); });
  accountChoices.addEventListener('change', event => {
    if (!event.target.matches('input[type=checkbox]')) return;
    scheduleConfirmation = null;
    if (event.target.checked) selectedAccountIds.add(event.target.value);
    else selectedAccountIds.delete(event.target.value);
    showTab(activeTab);
  });
  const zonedToIso = (value, timeZone) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) throw new Error('Primeiro horário inválido.');
    const target = Date.UTC(...match.slice(1).map(Number).map((part, index) => index === 1 ? part - 1 : part));
    let candidate = target;
    for (let attempt = 0; attempt < 4; attempt++) {
      const part = zoneParts(new Date(candidate), timeZone);
      const observed = Date.UTC(Number(part.year), Number(part.month) - 1, Number(part.day), Number(part.hour), Number(part.minute));
      if (observed === target) return new Date(candidate).toISOString();
      candidate += target - observed;
    }
    throw new Error('Esse horário não existe no fuso escolhido. Selecione outro horário.');
  };
  const settingsForm = document.querySelector('#meta-settings-form');
  const storageForm = document.querySelector('#posting-storage-form');
  storageForm.addEventListener('submit', async event => {
    event.preventDefault(); const submit = storageForm.querySelector('button[type=submit]'); submit.disabled = true;
    try { const next = await window.studio.savePostingStorage(Object.fromEntries(new FormData(storageForm))); window.renderPostings(next); }
    catch (error) { showError(error); }
    finally { submit.disabled = false; }
  });
  settingsForm.addEventListener('submit', async event => {
    event.preventDefault(); const submit = settingsForm.querySelector('button[type=submit]'); submit.disabled = true;
    try {
      const next = await window.studio.saveMetaSettings(Object.fromEntries(new FormData(settingsForm)));
      window.renderPostings(next);
    } catch (error) { showError(error); }
    finally { submit.disabled = false; }
  });
  window.renderPostings = state => {
    window.postingState = state;
    avatarObserver.disconnect();
    const itemsByAccount = new Map();
    for (const item of state.postings?.items || []) {
      if (item.queue_kind === 'shared' && !['attention', 'uncertain'].includes(item.status)) continue;
      if (!itemsByAccount.has(item.account_id)) itemsByAccount.set(item.account_id, []);
      itemsByAccount.get(item.account_id).push(item);
    }
    const isPending = item => ['queued', 'uploading', 'processing', 'publishing'].includes(item.status);
    const isAttention = item => ['attention', 'uncertain'].includes(item.status);
    const schedules = new Map((state.postings?.schedules || []).map(item => [item.account_id, item]));
    const mediaSettings = new Map((state.postings?.mediaSettings || []).map(item => [item.account_id, item]));
    const accounts = state.accounts.filter(a => a.platform === 'instagram');
    const needsAttention = account => !account.meta?.connected || Boolean(account.error) || (itemsByAccount.get(account.id) || []).some(isAttention);
    startable = new Set(accounts.filter(account => {
      const schedule = schedules.get(account.id);
      const videos = itemsByAccount.get(account.id) || [];
      return state.postingStorage?.configured && account.meta?.connected && schedule && schedule.status !== 'running'
        && videos.some(item => item.status === 'queued') && !videos.some(item => item.status === 'uncertain');
    }).map(account => account.id));
    queueReady.textContent = startable.size ? `${startable.size} filas prontas para iniciar` : 'Nenhuma fila pronta para iniciar';
    const summary = document.querySelector('#posting-overview');
    summary.replaceChildren();
    for (const [label, count] of [
      ['Contas Instagram', accounts.length],
      ['Filas em execução', accounts.filter(account => schedules.get(account.id)?.status === 'running').length],
      ['Vídeos pendentes', accounts.reduce((total, account) => total + (itemsByAccount.get(account.id) || []).filter(isPending).length, 0)],
      ['Contas com atenção', accounts.filter(needsAttention).length]
    ]) {
      const tile = make('div', undefined, 'posting-overview-tile');
      tile.append(make('span', label), make('strong', count.toLocaleString('pt-BR')));
      summary.append(tile);
    }
    const selectedProxy = proxySelect.value;
    proxySelect.replaceChildren(new Option('Conexão direta', ''), ...state.proxies.map(proxy => new Option(proxyLabel(proxy, state.accounts), proxy.id)));
    proxySelect.value = selectedProxy;
    if (state.metaSettings) {
      settingsForm.elements.appId.value = state.metaSettings.appId || '';
      settingsForm.elements.redirectUri.value = state.postingStorage?.url ? `${state.postingStorage.url}/functions/v1/meta-callback` : '';
      settingsForm.elements.graphVersion.value = state.metaSettings.graphVersion || 'v23.0';
    }
    settingsForm.querySelector('button[type=submit]').disabled = !state.postingStorage?.configured;
    if (state.postingStorage?.url) storageForm.elements.url.value = state.postingStorage.url;
    root.replaceChildren();
    const available = new Set(accounts.map(account => account.id));
    for (const id of selectedAccountIds) if (!available.has(id)) selectedAccountIds.delete(id);
    if (!selectionInitialized && accounts.length) { selectedAccountIds.add(accounts[0].id); selectionInitialized = true; }
    accountChoices.replaceChildren();
    for (const account of accounts) {
      const choice = make('label', undefined, 'posting-account-choice');
      choice.dataset.search = `${account.name || ''} ${account.handle || ''}`.toLocaleLowerCase('pt-BR');
      const check = input('checkbox'); check.value = account.id; check.checked = selectedAccountIds.has(account.id);
      choice.append(check, make('span', accountLabel(account)));
      accountChoices.append(choice);
    }
    filterAccountChoices();
    if (!accounts.length) root.append(make('p', 'Adicione uma conta Instagram para montar a fila.', 'media-card'));
    for (const [index, account] of accounts.entries()) {
      const schedule = schedules.get(account.id);
      const videos = itemsByAccount.get(account.id) || [];
      const media = mediaSettings.get(account.id) || { folder: null, cover: null };
      const config = schedule?.config || { minMinutes: 60, maxMinutes: 120, startMinute: 540, endMinute: 1200, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo', dailyLimit: 0 };
      const card = make('article', undefined, 'media-card posting-card');
      card.dataset.accountId = account.id;
      card.dataset.index = String(index);
      card.dataset.search = `${account.handle || ''} ${account.name}`.toLocaleLowerCase('pt-BR');
      card.dataset.status = schedule?.status || 'stopped';
      card.dataset.next = String(Date.parse(schedule?.next_at) || Infinity);
      card.dataset.pending = String(videos.filter(isPending).length);
      card.dataset.attention = String(needsAttention(account));
      const metaLabel = account.meta?.needsReconnect ? 'Precisa reconectar' : account.meta?.connected ? 'Pronta para publicar' : 'Meta não conectada';
      const header = make('div', undefined, 'posting-header');
      const identity = make('div', undefined, 'posting-identity');
      const avatar = make('span', (account.handle || account.name).replace(/^@/, '').slice(0, 2).toUpperCase(), 'posting-avatar');
      avatar.setAttribute('aria-hidden', 'true');
      avatar.dataset.accountId = account.id;
      if (account.meta?.connected) avatarObserver.observe(avatar);
      const profile = make('div');
      profile.append(make('h2', accountLabel(account)), make('p', `Instagram${account.handle && account.name !== account.handle ? ` · @${account.handle}` : ''} · ${metaLabel}`, `posting-profile-status${needsAttention(account) ? ' needs-attention' : ''}`));
      identity.append(avatar, profile);
      header.append(identity);
      const next = make('div', undefined, 'posting-next');
      next.append(make('span', 'Próxima publicação'), make('strong', nextPublication(schedule?.next_at, config.timeZone)));
      header.append(next);
      card.append(header);
      const mediaSection = make('section', undefined, 'posting-section posting-media-settings');
      const coverOption = make('div', undefined, 'posting-media-cover');
      coverOption.append(make('span', 'Capa dos Reels', 'posting-media-label'));
      const coverRow = make('div', undefined, 'posting-media-cover-row');
      if (media.cover) {
        const preview = make('button', 'Carregando capa…', 'posting-cover-preview');
        preview.type = 'button';
        preview.disabled = true;
        preview.setAttribute('aria-label', 'Ver capa selecionada');
        coverRow.append(preview);
        window.studio.postingCoverPreview({ accountId: account.id }).then(src => {
          if (!preview.isConnected) return;
          if (!src) {
            preview.textContent = 'Sem prévia';
            coverOption.querySelector('.posting-cover-confirmation').textContent = 'Não foi possível abrir a capa. Use Trocar para selecionar o arquivo novamente.';
            coverOption.classList.add('posting-cover-unavailable');
            return;
          }
          const image = make('img'); image.src = src; image.alt = '';
          preview.replaceChildren(image); preview.disabled = false;
          preview.addEventListener('click', async () => {
            const dialog = make('dialog', undefined, 'posting-cover-dialog');
            const full = make('img'); full.src = src; full.alt = `Capa selecionada: ${media.cover.split(/[\\/]/).pop()}`;
            const close = make('button', 'Fechar', 'secondary'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
            dialog.append(full, close); dialog.addEventListener('close', () => dialog.remove(), { once: true });
            document.body.append(dialog); dialog.showModal();
            try { const image = await window.studio.postingCoverPreview({ accountId: account.id, full: true }); if (image && dialog.open) full.src = image; } catch { /* Keep the small preview available. */ }
          });
        }).catch(() => {
          if (!preview.isConnected) return;
          preview.textContent = 'Sem prévia';
          coverOption.querySelector('.posting-cover-confirmation').textContent = 'Não foi possível abrir a capa. Use Trocar para selecionar o arquivo novamente.';
          coverOption.classList.add('posting-cover-unavailable');
        });
      }
      const coverValue = make('strong', media.cover ? media.cover.split(/[\\/]/).pop() : 'Sem capa', 'posting-media-value');
      coverValue.title = media.cover || 'Os vídeos serão preparados sem imagem inicial.';
      coverRow.append(coverValue);
      const coverActions = make('div', undefined, 'posting-media-cover-actions');
      coverActions.append(button(media.cover ? 'Trocar' : '+ Adicionar', async () => {
        const cover = await window.studio.pickMediaCover();
        if (cover) return window.studio.savePostingMediaSettings({ accountId: account.id, cover });
      }));
      if (media.cover) coverActions.append(button('Remover', () => window.studio.savePostingMediaSettings({ accountId: account.id, cover: null })));
      coverRow.append(coverActions);
      coverOption.append(coverRow);
      if (media.cover) coverOption.append(make('small', 'Capa selecionada para esta conta · clique na miniatura para ampliar', 'posting-cover-confirmation'));
      mediaSection.append(coverOption);
      const source = make('div', undefined, 'posting-media-source');
      source.append(make('span', 'Pasta de vídeos', 'posting-media-label'));
      const sourceRow = make('div', undefined, 'posting-media-source-row');
      const sourceInfo = make('div', undefined, 'posting-media-source-info');
      sourceInfo.append(make('strong', media.folder ? media.folder.split(/[\\/]/).pop() : 'Nenhuma pasta selecionada', 'posting-media-value'));
      if (media.folder) sourceInfo.append(make('small', media.folder, 'posting-media-path'));
      sourceRow.append(sourceInfo);
      sourceRow.append(button(media.folder ? 'Trocar pasta' : 'Escolher pasta', async () => {
        const folder = await window.studio.pickPostingVideoFolder();
        if (!folder) return;
        const result = await window.studio.selectPostingFolder({ accountId: account.id, folder });
        folderImports.set(account.id, result.importedCount ? `${result.importedCount} adicionados · ${result.skippedCount} já na fila` : result.skippedCount ? `${result.skippedCount} já na fila` : 'Nenhum MP4 ou MOV nesta pasta');
        return result;
      }));
      source.append(sourceRow);
      if (media.folder) source.append(make('small', 'Novos MP4 e MOV nesta pasta entram automaticamente na fila.', 'posting-media-path'));
      if (folderImports.has(account.id)) source.append(make('p', folderImports.get(account.id), 'posting-media-feedback'));
      mediaSection.append(source);
      const orderField = make('label', undefined, 'posting-video-order');
      orderField.append(make('span', 'Ordem dos vídeos', 'posting-media-label'));
      const videoOrder = make('select');
      videoOrder.setAttribute('aria-label', `Ordem dos vídeos de ${account.handle ? `@${account.handle}` : account.name}`);
      videoOrder.append(new Option('Sequência', 'sequence'), new Option('Aleatório', 'random'));
      videoOrder.value = media.video_order || 'sequence';
      videoOrder.addEventListener('change', async () => {
        videoOrder.disabled = true;
        try {
          const next = await window.studio.savePostingMediaSettings({ accountId: account.id, videoOrder: videoOrder.value });
          clearError();
          if (window.applyStudioState) window.applyStudioState(next); else window.renderPostings(next);
        } catch (error) { videoOrder.value = media.video_order || 'sequence'; showError(error); }
        finally { videoOrder.disabled = false; }
      });
      orderField.append(videoOrder, make('small', 'Sequência segue a ordem da fila. Aleatório sorteia um vídeo pendente a cada postagem.', 'posting-media-path'));
      mediaSection.append(orderField);

      // Cross-posting Facebook
      const fbCross = make('div', undefined, 'posting-facebook-cross');
      const fbTitle = make('span', 'Cross-posting no Facebook', 'posting-media-label');
      const fbToggleRow = make('label', undefined, 'posting-fb-toggle');
      const fbCheck = make('input');
      fbCheck.type = 'checkbox';
      fbCheck.checked = Boolean(media.cross_post_facebook);
      fbToggleRow.append(fbCheck, make('span', ' Publicar Reels também na Página do Facebook'));

      const fbBox = make('div', undefined, 'posting-fb-box');
      fbBox.hidden = !fbCheck.checked;

      const fbPageIdLabel = make('label', undefined, 'posting-fb-field');
      fbPageIdLabel.append(make('span', 'Página conectada:'));
      const fbPageSelect = make('select');
      const connectedPages = state.accounts.filter(page => page.platform === 'facebook' && page.facebook?.connected);
      fbPageSelect.append(new Option('Selecione uma Página', ''));
      for (const page of connectedPages) fbPageSelect.append(new Option(page.name, page.facebookPageId));
      fbPageSelect.value = media.facebook_page_id || '';
      fbPageIdLabel.append(fbPageSelect);

      const fbSaveBtn = button('Salvar configuração Facebook', async () => {
        fbSaveBtn.disabled = true;
        try {
          const next = await window.studio.savePostingMediaSettings({
            accountId: account.id,
            crossPostFacebook: fbCheck.checked,
            facebookPageId: fbPageSelect.value
          });
          clearError();
          if (window.applyStudioState) window.applyStudioState(next); else window.renderPostings(next);
        } catch (error) { showError(error); }
        finally { fbSaveBtn.disabled = false; }
      });

      fbCheck.addEventListener('change', () => {
        fbBox.hidden = !fbCheck.checked;
        if (!fbCheck.checked) {
          fbSaveBtn.click();
        }
      });

      fbBox.append(fbPageIdLabel, fbSaveBtn, make('small', 'O Reel publicado no Instagram entra na fila própria da Página Facebook selecionada.', 'posting-media-path'));
      fbCross.append(fbTitle, fbToggleRow, fbBox);
      mediaSection.append(fbCross);

      card.append(mediaSection);
      const programming = make('section', undefined, 'posting-section posting-programming');
      programming.append(make('h3', 'Programação'));
      programming.append(make('p', 'A mesma configuração será aplicada às contas selecionadas. Cada conta mantém sua própria fila e recebe horários separados por pelo menos 5 minutos.', 'posting-batch-note'));
      if (schedule && config.mode !== 'fixed') programming.append(make('p', 'Esta conta ainda usa a agenda antiga. Ela continua funcionando até você salvar os novos horários abaixo.', 'posting-legacy-note'));
      const form = make('form'); form.className = 'posting-form posting-fixed-form';
      const configuredTimes = config.mode === 'fixed' ? [...config.times] : [];
      const times = make('div', undefined, 'posting-time-list');
      const countLabel = make('strong', '', 'posting-time-count');
      const refreshTimes = () => {
        configuredTimes.sort(); times.replaceChildren();
        for (const time of configuredTimes) {
          const chip = make('span', undefined, 'posting-time-chip');
          const remove = make('button', '×', 'posting-time-remove'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remover horário ' + time);
          remove.addEventListener('click', () => { configuredTimes.splice(configuredTimes.indexOf(time), 1); refreshTimes(); form.dispatchEvent(new Event('change')); });
          chip.append(make('span', time), remove); times.append(chip);
        }
        countLabel.textContent = configuredTimes.length + (configuredTimes.length === 1 ? ' postagem por dia' : ' postagens por dia');
      };
      const addRow = make('div', undefined, 'posting-time-add');
      const timeInput = input('time', '16:00'); timeInput.setAttribute('aria-label', 'Novo horário');
      const addTime = make('button', '+ Adicionar horário', 'secondary'); addTime.type = 'button';
      addTime.addEventListener('click', () => {
        const value = timeInput.value;
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) { showError(new Error('Escolha um horário válido.')); return; }
        if (configuredTimes.includes(value)) { showError(new Error('Este horário já foi adicionado.')); return; }
        configuredTimes.push(value); refreshTimes(); clearError(); form.dispatchEvent(new Event('change'));
      });
      timeInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTime.click(); } });
      addRow.append(timeInput, addTime);
      const variation = input('number', config.mode === 'fixed' ? config.variationMinutes : 0);
      variation.min = '0'; variation.max = '1439'; variation.step = '1'; variation.required = true;
      const timezone = input('text', config.timeZone || 'America/Sao_Paulo'); timezone.required = true;
      const zoneDetails = make('details', undefined, 'posting-time-zone');
      zoneDetails.append(make('summary', 'Fuso horário: ' + timezone.value), field('Fuso horário da conta', timezone));
      timezone.addEventListener('input', () => { zoneDetails.querySelector('summary').textContent = 'Fuso horário: ' + timezone.value; });
      const values = () => ({ accountId: account.id, mode: 'fixed', times: [...configuredTimes], variationMinutes: Number(variation.value), timeZone: timezone.value });
      const save = make('button', 'Salvar horários', 'primary posting-save-rhythm'); save.type = 'submit';
      const preview = make('div', undefined, 'posting-preview');
      form.append(make('h4', 'Horários de postagem'), countLabel, times, addRow, field('Variação aleatória (± minutos)', variation), zoneDetails, save);
      refreshTimes();
      form.append(button('Prévia dos horários', async () => {
        const ids = [...selectedAccountIds];
        const current = values();
        const saved = ids.every(id => {
          const own = state.postings?.schedules.find(item => item.account_id === id)?.config;
          return own?.mode === 'fixed' && own.variationMinutes === current.variationMinutes && own.timeZone === current.timeZone && JSON.stringify(own.times) === JSON.stringify([...current.times].sort());
        });
        preview.replaceChildren(make('strong', saved ? 'Horários efetivos salvos para cada conta.' : 'Prévia estimada dos horários centrais. A variação e a separação entre contas são definidas ao salvar.'));
        for (const [index, id] of ids.entries()) {
          const selected = state.accounts.find(item => item.id === id);
          const name = selected?.handle ? `@${selected.handle}` : selected?.name || 'Conta';
          const planned = await window.studio.previewPostingSchedule({ ...current, accountId: id });
          for (const time of planned) preview.append(make('p', `${name}: ${zoneDate(Date.parse(time) + (saved ? 0 : index * 5 * 60000), timezone.value)}`));
        }
      }));
      if (scheduleConfirmation?.sourceAccountId === account.id) {
        const confirmation = make('div', undefined, 'posting-schedule-confirmation');
        confirmation.setAttribute('role', 'status');
        confirmation.setAttribute('aria-live', 'polite');
        confirmation.append(make('strong', `✓ Horários aplicados a ${scheduleConfirmation.accountIds.length} ${scheduleConfirmation.accountIds.length === 1 ? 'conta' : 'contas'}.`));
        for (const entry of scheduleConfirmation.entries) confirmation.append(make('span', entry));
        confirmation.append(make('small', 'Se a fila estiver parada ou pausada, use Iniciar ou Continuar na aba Fila.'));
        form.append(confirmation);
      }
      form.append(preview);
      const clearConfirmation = () => { clearError(); scheduleConfirmation = null; form.querySelector('.posting-schedule-confirmation')?.remove(); };
      form.addEventListener('input', clearConfirmation);
      form.addEventListener('change', clearConfirmation);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const previousLabel = save.textContent;
        save.disabled = true;
        save.textContent = 'Aplicando horários…';
        scheduleConfirmation = null;
        form.querySelector('.posting-schedule-confirmation')?.remove();
        try {
          const data = values(); const ids = [...selectedAccountIds];
          const next = ids.length > 1 ? await window.studio.savePostingSchedules({ accountIds: ids, config: data }) : await window.studio.savePostingSchedule(data);
          const entries = ids.map(id => {
            const selected = next.accounts.find(item => item.id === id);
            const schedule = next.postings?.schedules.find(item => item.account_id === id);
            const handle = selected?.handle ? `@${selected.handle}` : selected?.name || 'Conta';
            return `${handle}: ${schedule?.next_at ? `próximo horário salvo ${zoneDate(schedule.next_at, data.timeZone)}` : 'horário definido ao iniciar'}`;
          });
          scheduleConfirmation = { sourceAccountId: account.id, accountIds: ids, entries };
          clearError(); window.renderPostings(next);
        } catch (error) { showError(error); }
        finally { save.disabled = false; save.textContent = previousLabel; }
      });
      programming.append(form); card.append(programming);
      const list = make('details', undefined, 'posting-section posting-list');
      list.open = queueOpen.has(account.id) ? queueOpen.get(account.id) : false;
      list.addEventListener('toggle', () => queueOpen.set(account.id, list.open));
      const queueVideos = videos.filter(item => !['published', 'cancelled'].includes(item.status));
      const pending = queueVideos.filter(isPending).length;
      const attention = queueVideos.filter(isAttention).length;
      const queueSummary = make('summary', undefined, 'posting-queue-summary');
      const queueTitle = make('div', undefined, 'posting-queue-title');
      queueTitle.append(make('h3', `${queueVideos.length} ${queueVideos.length === 1 ? 'vídeo' : 'vídeos'}`), make('span', 'Ver fila', 'posting-queue-total'));
      const queueCounts = make('div', undefined, 'posting-queue-counts');
      queueCounts.append(make('span', `${pending} ${pending === 1 ? 'pendente' : 'pendentes'}`));
      if (attention) queueCounts.append(make('span', `${attention} ${attention === 1 ? 'precisa' : 'precisam'} de atenção`, 'posting-queue-attention'));
      queueSummary.append(queueTitle, queueCounts);
      list.append(queueSummary);
      for (const item of queueVideos) {
        const filename = item.file.split(/[\\/]/).pop();
        const row = make('div', undefined, `posting-item posting-item-${item.status}`);
        const heading = make('div', undefined, 'posting-item-heading');
        const identity = make('div', undefined, 'posting-item-identity');
        identity.append(make('strong', filename));
        const statusLabel = { queued: 'Na fila', uploading: 'Enviando', processing: 'Processando', publishing: 'Publicando', published: 'Publicado', attention: 'Precisa de atenção', uncertain: 'Conferir publicação', cancelled: 'Cancelado' }[item.status] || item.status;
        identity.append(make('span', statusLabel, `posting-item-status posting-item-status-${item.status}`));
        if (item.queue_kind === 'shared') identity.append(make('small', 'Da antiga Fila única', 'help'));
        heading.append(identity);
        const actions = make('div', undefined, 'posting-item-quick-actions');
        const availablePages = state.accounts.filter(page => page.platform === 'facebook' && page.facebook?.connected);
        if (availablePages.length && item.file) {
          const destination = make('select');
          for (const page of availablePages) destination.append(new Option(page.name, page.id));
          actions.append(destination, button('Postar no Facebook', () => window.studio.queueFacebookFromInstagram({ itemId: item.id, accountId: destination.value })));
        }
        if (item.permalink) actions.append(button('Abrir Reel', () => window.studio.openPublishedReel(item.id)));
        if (item.facebook_permalink) actions.append(button('Abrir Facebook', () => window.studio.openPublishedFacebookReel(item.id)));
        if (item.facebook_error) actions.append(make('small', `Facebook: ${item.facebook_error}`, 'posting-media-feedback'));
        if (item.status === 'attention') {
          actions.append(button('Tentar novamente', () => window.studio.retryPostingVideo(item.id)));
        }
        const caption = input('text', item.caption); caption.maxLength = 2200; caption.readOnly = item.status !== 'queued';
        const details = make('div', undefined, 'posting-item-details');
        details.id = `posting-item-details-${item.id}`;
        details.hidden = !itemOpen.get(item.id);
        details.append(field('Legenda', caption));
        if (item.status === 'uncertain') {
          details.append(make('p', 'Confira o perfil Instagram antes de decidir. O aplicativo não reenviará este vídeo automaticamente.'));
          const review = make('div', undefined, 'posting-actions');
          review.append(button('Conferi: foi publicado', () => window.studio.resolveUncertainPosting({ id: item.id, outcome: 'published' })), button('Conferi: não foi publicado', () => window.studio.resolveUncertainPosting({ id: item.id, outcome: 'cancelled' })));
          details.append(review);
        }
        if (item.status === 'queued') {
          const editActions = make('div', undefined, 'posting-actions');
          const moveUp = button('↑', () => window.studio.movePostingVideo({ id: item.id, direction: 'up' }));
          const moveDown = button('↓', () => window.studio.movePostingVideo({ id: item.id, direction: 'down' }));
          moveUp.setAttribute('aria-label', `Mover ${filename} para cima`);
          moveDown.setAttribute('aria-label', `Mover ${filename} para baixo`);
          editActions.append(button('Salvar legenda', () => window.studio.updatePostingVideo({ id: item.id, caption: caption.value })), moveUp, moveDown, button('Remover', () => window.studio.removePostingVideo(item.id), 'danger'));
          details.append(editActions);
        }
        if (item.status === 'attention') details.append(make('p', 'Corrija o problema e tente novamente. O vídeo volta à fila; a conta só publica após você clicar em Continuar.', 'posting-attention-note'));
        if (item.status === 'queued' || item.status === 'uncertain' || item.caption || item.status === 'attention') {
          const toggle = make('button', item.status === 'queued' ? 'Editar' : 'Detalhes', 'posting-item-toggle');
          toggle.type = 'button';
          toggle.setAttribute('aria-expanded', String(!details.hidden));
          toggle.setAttribute('aria-controls', details.id);
          toggle.addEventListener('click', () => { details.hidden = !details.hidden; itemOpen.set(item.id, !details.hidden); toggle.setAttribute('aria-expanded', String(!details.hidden)); toggle.textContent = details.hidden ? item.status === 'queued' ? 'Editar' : 'Detalhes' : 'Recolher'; });
          if (!details.hidden) toggle.textContent = 'Recolher';
          actions.append(toggle);
        }
        heading.append(actions);
        row.append(heading);
        if (item.error) row.append(make('p', item.error, 'posting-item-error record-error'));
        row.append(details);
        list.append(row);
      }
      const controls = make('div', undefined, 'posting-actions');
      const queuedCount = videos.filter(item => item.status === 'queued').length;
      if (queuedCount) controls.append(button(`Limpar fila (${queuedCount})`, () => {
        if (!window.confirm(`Remover ${queuedCount} vídeo(s) aguardando postagem desta conta?`)) return;
        return window.studio.clearPostingQueue({ accountId: account.id });
      }, 'danger'));
      if (queuedCount && accounts.length > 1) {
        const destination = make('select'); for (const target of accounts.filter(a => a.id !== account.id)) destination.append(new Option(target.name, target.id));
        controls.append(destination, button('Copiar fila para conta', async () => { let next; for (const item of videos.filter(i => i.status === 'queued')) next = await window.studio.addPostingVideo({ accountId: destination.value, file: item.file, caption: item.caption }); return next; }));
      }
      if (controls.childNodes.length) list.append(controls);
      card.append(list);
      const execution = make('section', undefined, 'posting-section posting-execution');
      const executionInfo = make('div', undefined, 'posting-execution-info');
      executionInfo.append(make('p', schedule?.status === 'running' ? 'Fila em execução' : schedule?.status === 'paused' ? 'Fila pausada' : 'Fila parada', 'posting-execution-state'));
      execution.append(executionInfo);
      const run = make('div', undefined, 'posting-actions');
      if (!account.meta?.connected) run.append(button('Reconectar Instagram', () => window.studio.connectMeta(account.id)));
      if (schedule?.status === 'running') run.append(button('Pausar', () => window.studio.controlPosting({ accountId: account.id, status: 'paused' })));
      else if (schedule?.status === 'paused' || videos.some(item => item.status === 'queued')) run.append(button(schedule?.status === 'paused' ? 'Continuar' : 'Iniciar fila', () => window.studio.controlPosting({ accountId: account.id, status: 'running' }), 'primary'));
      if (schedule?.status && schedule.status !== 'stopped') run.append(button('Parar fila', () => window.studio.controlPosting({ accountId: account.id, status: 'stopped' }), 'danger'));
      execution.append(run); card.insertBefore(execution, list);
      root.append(card);
    }
    showTab(activeTab);
  };
  window.onPostings(snapshot => { if (window.applyStudioState) window.applyStudioState(snapshot); else window.renderPostings(snapshot); });
})();
