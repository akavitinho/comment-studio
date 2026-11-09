(function () {
  const root = document.querySelector('#posting-accounts');
  const tabButtons = [...document.querySelectorAll('[data-posting-tab]')];
  const tabPanels = Object.fromEntries(['queue', 'shared', 'schedule', 'settings'].map(name => [name, document.querySelector(`#posting-tab-${name}`)]));
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
  const sharedThumbnailObserver = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      sharedThumbnailObserver.unobserve(target);
      window.studio.videoThumbnail?.(target.dataset.itemId).then(image => {
        if (!image || !target.isConnected) return;
        const photo = make('img'); photo.alt = ''; photo.src = image;
        target.replaceChildren(photo);
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
  const sharedSelectedIds = new Set();
  let sharedSelectionInitialized = false;
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
    document.querySelector('#posting-overview').hidden = name === 'shared';
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
    const firstSelected = cards.find(card => selectedAccountIds.has(card.dataset.accountId));
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
      card.querySelector('.posting-programming').hidden = name !== 'schedule' || (count > 1 && card !== firstSelected);
      card.querySelector('.posting-shared-note').hidden = count < 2;
      card.querySelector('.posting-save-rhythm').textContent = count > 1 ? `Aplicar horários às ${count} contas` : 'Salvar ritmo';
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
    addAccountForm.elements.handle.focus();
  });
  const openProxyForm = (accountId = '', handle = '') => {
    if (!accountSetup.open) accountSetup.showModal();
    proxyTargetAccountId = accountId;
    addProxyForm.reset();
    addProxyForm.elements.name.value = handle.trim() ? `Proxy @${handle.trim().replace(/^@/, '')}` : 'Proxy Instagram';
    addProxyForm.hidden = false;
    addProxyForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    addProxyForm.elements.paste.focus();
  };
  document.querySelector('#posting-add-proxy').addEventListener('click', () => openProxyForm('', addAccountForm.elements.handle.value));
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
    const handle = addAccountForm.elements.handle.value.trim().replace(/^@/, '');
    if (!handle || /\s|@/.test(handle)) { showError(new Error('Informe um @ sem espaços.')); addAccountForm.elements.handle.focus(); return; }
    if ((window.postingState?.accounts || []).some(account => account.platform === 'instagram' && account.handle?.toLocaleLowerCase('pt-BR') === handle.toLocaleLowerCase('pt-BR'))) { showError(new Error(`@${handle} já está cadastrado.`)); return; }
    const previous = new Set((window.postingState?.accounts || []).map(account => account.id));
    submit.disabled = true;
    try {
      const next = await window.studio.addAccount({ platform: 'instagram', handle, name: handle, proxyId: proxySelect.value });
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
  const sharedAccounts = document.querySelector('#posting-shared-accounts');
  const sharedPicker = document.querySelector('#posting-shared-picker');
  const sharedAccountSearch = document.querySelector('#posting-shared-account-search');
  const sharedAccountCount = document.querySelector('#posting-shared-account-count');
  const sharedCards = document.querySelector('#posting-shared-cards');
  const sharedSummary = document.querySelector('#posting-shared-summary');
  const sharedOpen = new Set();
  const sharedShown = new Map();
  const sharedFeedback = document.querySelector('#posting-shared-feedback');
  const sharedAdd = document.querySelector('#posting-shared-add');
  const sharedStart = document.querySelector('#posting-shared-start');
  const sharedOnly = document.querySelector('#posting-shared-only');
  const sharedPause = document.querySelector('#posting-shared-pause');
  const sharedStop = document.querySelector('#posting-shared-stop');
  const saveSharedSelection = () => localStorage.setItem('comment-studio-shared-accounts',JSON.stringify([...sharedSelectedIds]));
  const filterSharedAccounts = () => {
    const query=sharedAccountSearch.value.trim().replace(/^@/,'').toLocaleLowerCase('pt-BR');
    let visible=0;
    for(const label of sharedAccounts.children){label.hidden=Boolean(query)&&!(label.dataset.search||'').includes(query);if(!label.hidden)visible++;}
    document.querySelector('#posting-shared-no-results').hidden=visible>0;
  };
  sharedAccountSearch.addEventListener('input',filterSharedAccounts);
  document.querySelector('#posting-shared-select-all').addEventListener('click',()=>{
    const configured=new Set((window.postingState?.postings?.schedules||[]).map(row=>row.account_id));
    for(const account of window.postingState?.accounts||[])if(account.platform==='instagram'&&configured.has(account.id))sharedSelectedIds.add(account.id);
    saveSharedSelection();renderShared(window.postingState);
  });
  document.querySelector('#posting-shared-clear').addEventListener('click',()=>{sharedSelectedIds.clear();saveSharedSelection();renderShared(window.postingState);});
  document.addEventListener('click',event=>{if(!sharedPicker.contains(event.target))sharedPicker.open=false;});
  sharedPicker.addEventListener('keydown',event=>{if(event.key==='Escape'){sharedPicker.open=false;sharedPicker.querySelector('summary').focus();}});
  const sharedApply = next => { if (window.applyStudioState) window.applyStudioState(next); else window.renderPostings(next); };
  async function sharedRun(action) {
    try {
      sharedFeedback.textContent='';
      const next=await action();
      if(next?.accounts)sharedApply(next);
      if(next?.pausedAccountQueues!==undefined)sharedFeedback.textContent=`Fila única ativa. ${next.pausedAccountQueues} ${next.pausedAccountQueues===1?'fila individual pausada':'filas individuais pausadas'}.`;
    }
    catch(error) { sharedFeedback.textContent=error.message; }
  }
  const sharedButton=(text,action,kind='secondary')=>{const el=make('button',text,kind);el.type='button';el.addEventListener('click',async()=>{el.disabled=true;try{await sharedRun(action);}finally{el.disabled=false;}});return el;};
  sharedAdd.addEventListener('click',async()=>{
    const accountIds=[...sharedSelectedIds];
    if(!accountIds.length){sharedFeedback.textContent='Selecione ao menos uma conta com horários configurados.';return;}
    sharedAdd.disabled=true;
    try {
      const files=await window.studio.pickMediaVideos();
      if(!files.length)return;
      sharedFeedback.textContent=`Validando ${files.length} vídeo(s)…`;
      const next=await window.studio.addSharedPostingVideos({accountIds,files,caption:document.querySelector('#posting-shared-caption').value});
      sharedApply(next);sharedFeedback.textContent=`${files.length} vídeo(s) distribuído(s) entre ${accountIds.length} conta(s).`;
    } catch(error){sharedFeedback.textContent=error.message;}
    finally{sharedAdd.disabled=false;}
  });
  sharedStart.addEventListener('click',()=>sharedRun(()=>window.studio.controlSharedPosting({status:'running'})));
  sharedOnly.addEventListener('click',()=>sharedRun(()=>window.studio.controlSharedPosting({status:'running',only:true})));
  sharedPause.addEventListener('click',()=>sharedRun(()=>window.studio.controlSharedPosting({status:'paused'})));
  sharedStop.addEventListener('click',()=>sharedRun(()=>window.studio.controlSharedPosting({status:'stopped'})));
  function renderShared(state) {
    const accounts=state.accounts.filter(account=>account.platform==='instagram');
    const schedules=new Map((state.postings?.schedules||[]).map(row=>[row.account_id,row]));
    const sharedSchedules=new Map((state.postings?.sharedSchedules||[]).map(row=>[row.account_id,row]));
    if(!sharedSelectionInitialized){let saved=null;try{saved=JSON.parse(localStorage.getItem('comment-studio-shared-accounts')||'null');}catch{}for(const account of accounts)if(schedules.has(account.id)&&(!Array.isArray(saved)||saved.includes(account.id)))sharedSelectedIds.add(account.id);sharedSelectionInitialized=true;}
    for(const id of [...sharedSelectedIds])if(!accounts.some(account=>account.id===id))sharedSelectedIds.delete(id);
    for(const avatar of sharedAccounts.querySelectorAll('.posting-avatar'))avatarObserver.unobserve(avatar);
    sharedAccounts.replaceChildren();
    if(!accounts.length)sharedAccounts.append(make('p','Adicione uma conta Instagram para usar a fila única.'));
    for(const account of accounts){
      const schedule=schedules.get(account.id);
      const label=make('label',undefined,'posting-shared-choice'),check=input('checkbox');
      label.dataset.search=(account.handle||account.name||'').toLocaleLowerCase('pt-BR');
      check.value=account.id;check.checked=sharedSelectedIds.has(account.id);check.disabled=!schedule;
      if(!schedule)label.title='Configure horários para selecionar esta conta.';
      check.addEventListener('change',()=>{
        if(check.checked)sharedSelectedIds.add(account.id);else sharedSelectedIds.delete(account.id);
        saveSharedSelection();renderShared(window.postingState);
        [...sharedAccounts.querySelectorAll('input[type=checkbox]')].find(node=>node.value===account.id)?.focus();
      });
      const avatar=make('span',(account.handle||account.name||'?').replace(/^@/,'').slice(0,1).toUpperCase(),'posting-avatar');
      avatar.dataset.accountId=account.id;
      if(account.meta?.connected)avatarObserver.observe(avatar);
      label.append(avatar,make('span',account.handle?'@'+account.handle:account.name),check);
      sharedAccounts.append(label);
    }
    sharedAccountCount.textContent=`${sharedSelectedIds.size} ${sharedSelectedIds.size===1?'conta selecionada':'contas selecionadas'}`;
    filterSharedAccounts();
    const allItems=(state.postings?.items||[]).filter(item=>item.queue_kind==='shared');
    const items=allItems.filter(item=>!['published','cancelled'].includes(item.status));
    const byAccount=new Map();
    for(const item of items){if(!byAccount.has(item.account_id))byAccount.set(item.account_id,[]);byAccount.get(item.account_id).push(item);}
    const participantIds=new Set([...sharedSelectedIds,...items.filter(item=>item.status!=='published').map(item=>item.account_id)]);
    const participants=accounts.filter(account=>participantIds.has(account.id));
    const pendingStatuses=new Set(['queued','uploading','processing','publishing','attention','uncertain']);
    const pending=items.filter(item=>pendingStatuses.has(item.status)).length;
    const sharedRunning=[...sharedSchedules.values()].some(row=>row.status==='running');
    const individualRunning=[...schedules.values()].some(row=>row.status==='running');
    document.querySelector('#posting-shared-mode-status').textContent=sharedRunning
      ? individualRunning?'Fila única e filas individuais em execução.':'Somente Fila única em execução.'
      : 'Fila única pausada ou parada.';
    const nextRows=participants.map(account=>({account,at:sharedSchedules.get(account.id)?.next_at,zone:schedules.get(account.id)?.config?.timeZone})).filter(row=>sharedSchedules.get(row.account.id)?.status==='running'&&row.at&&(byAccount.get(row.account.id)||[]).some(item=>item.status==='queued')).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
    sharedSummary.replaceChildren();
    for(const [value,label] of [[pending,'Vídeos pendentes'],[participants.length,'Contas participantes'],[nextRows[0]?zoneDate(nextRows[0].at,nextRows[0].zone):'—','Próxima publicação']]){
      const tile=make('div',undefined,'posting-shared-stat');tile.append(make('strong',String(value)),make('span',label));sharedSummary.append(tile);
    }
    const hasQueued=items.some(item=>item.status==='queued');
    const hasPaused=[...sharedSchedules.values()].some(row=>row.status==='paused');
    sharedStart.textContent=hasPaused?'Continuar':sharedRunning?'Em execução':'Iniciar fila';
    sharedStart.disabled=!hasQueued||(sharedRunning&&!hasPaused);
    sharedOnly.disabled=sharedStart.disabled;
    sharedPause.disabled=![...sharedSchedules.values()].some(row=>row.status==='running');
    sharedStop.disabled=![...sharedSchedules.values()].some(row=>row.status!=='stopped');
    sharedCards.replaceChildren();
    if(!participants.length){sharedCards.append(make('p','Selecione contas com horários configurados e adicione vídeos.','help'));return;}
    participants.sort((a,b)=>{
      const left=sharedSchedules.get(a.id)?.next_at,right=sharedSchedules.get(b.id)?.next_at;
      return (left?Date.parse(left):Infinity)-(right?Date.parse(right):Infinity)||(a.handle||a.name).localeCompare(b.handle||b.name);
    });
    const labels={queued:'Na fila',uploading:'Preparando',processing:'Preparando',publishing:'Publicando',published:'Publicado',attention:'Precisa de atenção',uncertain:'Conferir publicação'};
    const renderVideo=(item,zone)=>{
      const row=make('div',undefined,'posting-shared-video');
      const thumb=make('div','▶','posting-shared-thumb');thumb.dataset.itemId=item.id;sharedThumbnailObserver.observe(thumb);
      const body=make('div',undefined,'posting-shared-video-body');
      body.append(make('strong',item.file.split(/[\\/]/).pop()),make('small',`${labels[item.status]||item.status}${item.scheduled_at?` · previsto: ${zoneDate(item.scheduled_at,zone)}`:''}${item.published_at?` · publicado: ${zoneDate(item.published_at,zone)}`:''}`));
      if(item.error)body.append(make('small',item.error,'record-error'));
      const tools=make('details',undefined,'posting-shared-video-tools'),heading=make('summary','Opções');tools.append(heading);
      const actions=make('div',undefined,'posting-actions');
      if(item.status==='queued'){
        const caption=input('text',item.caption);caption.maxLength=2200;tools.append(field('Legenda',caption));
        actions.append(sharedButton('Salvar legenda',()=>window.studio.updatePostingVideo({id:item.id,caption:caption.value})),sharedButton('↑',()=>window.studio.movePostingVideo({id:item.id,direction:'up'})),sharedButton('↓',()=>window.studio.movePostingVideo({id:item.id,direction:'down'})),sharedButton('Remover',()=>window.studio.removePostingVideo(item.id),'danger'));
      }
      if(item.status==='attention')actions.append(sharedButton('Tentar novamente',()=>window.studio.retryPostingVideo(item.id)));
      if(item.status==='uncertain')actions.append(sharedButton('Conferi: publicado',()=>window.studio.resolveUncertainPosting({id:item.id,outcome:'published'})),sharedButton('Conferi: não publicado',()=>window.studio.resolveUncertainPosting({id:item.id,outcome:'cancelled'})));
      if(item.permalink)actions.append(sharedButton('Abrir Reel',()=>window.studio.openPublishedReel(item.id)));
      tools.append(actions);if(actions.childElementCount)body.append(tools);
      row.append(thumb,body);return row;
    };
    for(const account of participants){
      const schedule=schedules.get(account.id),shared=sharedSchedules.get(account.id),zone=schedule?.config?.timeZone;
      const videos=(byAccount.get(account.id)||[]).sort((a,b)=>(Date.parse(a.scheduled_at||a.published_at||a.created_at)||0)-(Date.parse(b.scheduled_at||b.published_at||b.created_at)||0)||a.position-b.position);
      const remaining=videos.filter(item=>pendingStatuses.has(item.status)).length,published=allItems.filter(item=>item.account_id===account.id&&item.status==='published').length;
      const attention=videos.some(item=>['attention','uncertain'].includes(item.status))||Boolean(account.error)||!account.meta?.connected;
      const stateLabel=attention?'Atenção':shared?.status==='running'?'Ativa':'Pausada';
      const card=make('details',undefined,'posting-shared-account');card.open=sharedOpen.has(account.id);
      card.addEventListener('toggle',()=>{if(card.open)sharedOpen.add(account.id);else sharedOpen.delete(account.id);});
      const head=make('summary',undefined,'posting-shared-account-head');
      const identity=make('div',undefined,'posting-shared-identity');
      const avatar=make('span',(account.handle||account.name||'?').slice(0,1).toUpperCase(),'posting-avatar posting-shared-avatar');avatar.dataset.accountId=account.id;avatarObserver.observe(avatar);
      const names=make('div');names.append(make('strong',account.handle?'@'+account.handle:account.name));identity.append(avatar,names);
      head.append(identity,make('span',stateLabel,`posting-shared-state ${attention?'attention':shared?.status==='running'?'running':'paused'}`));
      const nextAt=remaining?shared?.next_at:null;
      const next=make('div',undefined,'posting-shared-next');
      const nextLabel=shared?.status==='running'&&!attention?'Próxima publicação':'Próxima previsão';
      const nextValue=make('strong',nextAt?zoneTime(nextAt,zone):'—');
      if(nextAt){nextValue.title=zoneDate(nextAt,zone);nextValue.setAttribute('aria-label',`${nextLabel}: ${zoneDate(nextAt,zone)}. ${shared?.status==='running'&&!attention?'':'Horário sujeito à retomada ou resolução de pendências.'}`);}
      next.append(make('small',nextLabel),nextValue);head.append(next);
      const counts=make('div',undefined,'posting-shared-counts');counts.append(make('span',`Vídeos pendentes: ${remaining}`),make('span',`Publicados: ${published}`));head.append(counts);
      const track=make('div',undefined,'posting-shared-progress');track.setAttribute('role','progressbar');track.setAttribute('aria-label',`Progresso de ${account.handle||account.name}`);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');const progress=remaining+published?Math.round(published/(remaining+published)*100):0;track.setAttribute('aria-valuenow',String(progress));const fill=make('span');fill.style.width=`${progress}%`;track.append(fill);head.append(track,make('span','Ver vídeos programados','posting-shared-expand'));
      card.append(head);
      const list=make('div',undefined,'posting-shared-videos');
      const appendPage=()=>{const shown=sharedShown.get(account.id)||30;for(const item of videos.slice(list.querySelectorAll('.posting-shared-video').length,shown))list.append(renderVideo(item,zone));more.hidden=shown>=videos.length;};
      const more=make('button','Carregar mais vídeos','secondary');more.type='button';more.addEventListener('click',()=>{sharedShown.set(account.id,(sharedShown.get(account.id)||30)+30);appendPage();});
      if(card.open)appendPage();else card.addEventListener('toggle',()=>{if(card.open&&!list.querySelector('.posting-shared-video'))appendPage();});
      if(!videos.length)list.append(make('p','Nenhum vídeo destinado a esta conta.','help'));
      list.append(more);card.append(list);sharedCards.append(card);
    }
  }
  window.renderPostings = state => {
    window.postingState = state;
    avatarObserver.disconnect();
    sharedThumbnailObserver.disconnect();
    const itemsByAccount = new Map();
    for (const item of state.postings?.items || []) {
      if (item.queue_kind === 'shared') continue;
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
    proxySelect.replaceChildren(new Option('Conexão direta', ''), ...state.proxies.map(proxy => new Option(proxy.name, proxy.id)));
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
      choice.append(check, make('span', account.handle ? `@${account.handle}` : account.name));
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
      profile.append(make('h2', account.handle ? `@${account.handle}` : account.name), make('p', `Instagram · ${metaLabel}`, `posting-profile-status${needsAttention(account) ? ' needs-attention' : ''}`));
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
      card.append(mediaSection);
      const programming = make('section', undefined, 'posting-section posting-programming');
      programming.append(make('h3', 'Programação'));
      programming.append(make('p', 'A mesma configuração será aplicada às contas selecionadas. Cada conta mantém sua própria fila e recebe horários separados por pelo menos 5 minutos.', 'posting-shared-note'));
      programming.append(make('p', 'Iniciar espera pelo menos 5 minutos. Continuar mantém o horário salvo se ainda estiver no futuro; se venceu, espera 5 minutos. Depois de publicar, vale o intervalo mínimo e máximo.', 'help'));
      const form = make('form'); form.className = 'posting-form';
      const min = input('number', config.minMinutes), max = input('number', config.maxMinutes), start = input('time', clock(config.startMinute)), end = input('time', clock(config.endMinute));
      min.min = max.min = 1; min.max = max.max = 10080; start.required = end.required = true;
      const unit = make('select'); unit.append(new Option('Minutos', 'minutes'), new Option('Horas', 'hours'));
      if (config.intervalUnit === 'hours') { unit.value = 'hours'; min.value = String(config.minMinutes / 60); max.value = String(config.maxMinutes / 60); }
      unit.addEventListener('change', () => {
        const toHours = unit.value === 'hours';
        min.value = String(Number(min.value) * (toHours ? 1 / 60 : 60));
        max.value = String(Number(max.value) * (toHours ? 1 / 60 : 60));
        min.min = max.min = toHours ? String(1 / 60) : '1'; min.max = max.max = toHours ? '168' : '10080';
        min.step = max.step = toHours ? 'any' : '1';
      });
      if (unit.value === 'hours') { min.min = max.min = String(1 / 60); min.max = max.max = '168'; min.step = max.step = 'any'; }
      const timezone = input('text', config.timeZone), daily = input('number', config.dailyLimit), first = input('datetime-local'); daily.min = 0; daily.max = 100;
      if (config.firstAt) first.value = firstInZone(config.firstAt, config.timeZone);
      form.append(field('Unidade do intervalo', unit), make('span', '', 'posting-unit-spacer'), field('Intervalo mínimo', min), field('Intervalo máximo', max), field('Das', start), field('Até', end), field('Fuso horário', timezone), field('Limite diário (0 = sem limite)', daily), field('Primeira publicação (opcional)', first));
      const days = make('div', undefined, 'posting-days');
      ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].forEach((name, day) => { const check = input('checkbox'); check.checked = config.days.includes(day); check.value = day; days.append(field(name, check)); });
      form.append(field('Dias permitidos', days));
      const values = () => ({ accountId: account.id, minMinutes: Math.round(Number(min.value) * (unit.value === 'hours' ? 60 : 1)), maxMinutes: Math.round(Number(max.value) * (unit.value === 'hours' ? 60 : 1)), intervalUnit: unit.value, startMinute: minutes(start.value), endMinute: minutes(end.value), timeZone: timezone.value, dailyLimit: daily.value, firstAt: first.value ? zonedToIso(first.value, timezone.value) : undefined, days: [...days.querySelectorAll('input:checked')].map(x => Number(x.value)) });
      const save = make('button', 'Salvar ritmo', 'primary posting-save-rhythm'); save.type = 'submit'; form.append(save);
      const preview = make('div', undefined, 'posting-preview');
      form.append(button('Prévia dos horários', async () => { const times = await window.studio.previewPostingSchedule(values()); preview.replaceChildren(make('strong', selectedAccountIds.size > 1 ? 'Estimativa do ritmo; os horários de cada conta aparecem após salvar' : 'Estimativa com o ponto médio do intervalo')); for (const time of times) preview.append(make('p', zoneDate(time, timezone.value))); }));
      if (scheduleConfirmation?.sourceAccountId === account.id) {
        const confirmation = make('div', undefined, 'posting-schedule-confirmation');
        confirmation.setAttribute('role', 'status');
        confirmation.setAttribute('aria-live', 'polite');
        confirmation.append(make('strong', `✓ Horários aplicados a ${scheduleConfirmation.accountIds.length} ${scheduleConfirmation.accountIds.length === 1 ? 'conta' : 'contas'}.`));
        for (const entry of scheduleConfirmation.entries) confirmation.append(make('span', entry));
        confirmation.append(make('small', 'A fila não foi iniciada. Use Iniciar ou Continuar na aba Fila para publicar.'));
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
        heading.append(identity);
        const actions = make('div', undefined, 'posting-item-quick-actions');
        if (item.permalink) actions.append(button('Abrir Reel', () => window.studio.openPublishedReel(item.id)));
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
    renderShared(state);
    showTab(activeTab);
  };
  window.onPostings(snapshot => { if (window.applyStudioState) window.applyStudioState(snapshot); else window.renderPostings(snapshot); });
})();
