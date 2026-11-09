(() => {
  const form = document.querySelector('#x-form');
  const field = key => form.elements.namedItem(key);
  const storage = field('hashtags'); storage.hidden = true; storage.required = false;
  const tags = element('div', 'target-tags'), entry = element('input');
  entry.type = 'text'; entry.placeholder = 'Adicionar hashtag'; entry.setAttribute('aria-label', 'Adicionar hashtag do X');
  const add = element('button', 'secondary', 'Adicionar'); add.type = 'button';
  const editor = element('div', 'target-editor'); editor.append(tags, entry, add); storage.after(editor);
  const items = () => [...new Set(storage.value.split(/[,\r\n]+/).map(s => s.trim().replace(/^#+/, '')).filter(Boolean))];
  function setItems(values) { storage.value = values.join(', '); storage.dispatchEvent(new Event('input', { bubbles: true })); }
  function addItems() {
    if (!entry.value.trim()) return;
    const values = [...new Set([...items(), ...entry.value.split(/[,\r\n]+/).map(s => s.trim().replace(/^#+/, '')).filter(Boolean)])];
    if (values.length > 20 || values.some(s => !/^[\p{L}\p{N}_]{1,100}$/u.test(s))) { notify('Use até 20 hashtags, sem espaços ou caracteres especiais.', true); return; }
    entry.value = ''; setItems(values); entry.focus();
  }
  add.addEventListener('click', addItems);
  entry.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addItems(); } });
  function summaryX() {
    tags.replaceChildren();
    items().forEach((value, index) => {
      const tag = element('span', 'target-tag'), remove = element('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Remover hashtag ${value}`);
      remove.addEventListener('click', () => setItems(items().filter((_, i) => i !== index)));
      tag.append(element('span', '', '#' + value), remove); tags.append(tag);
    });
    const count = field('comments').value.split(/\r?\n/).filter(s => s.trim()).length;
    $('#x-phrase-count').textContent = $('#x-summary-comments').textContent = `${count} frase${count === 1 ? '' : 's'}`;
    $('#x-summary-target').textContent = field('targetType').value === 'foryou' ? 'Página principal — Para você' : field('targetType').value === 'search' ? `${field('queries').value.split(/\r?\n/).filter(s => s.trim()).length} busca(s)` : items().length ? `${items().length} hashtag${items().length === 1 ? '' : 's'}` : 'Não definido';
    $('#x-summary-mode').textContent = field('mode').selectedOptions[0].textContent;
    $('#x-summary-accounts').textContent = form.querySelectorAll('[name=xAccountIds]:checked').length;
    $('#x-summary-wait').textContent = field('waitMin').value && field('waitMax').value ? `${field('waitMin').value} a ${field('waitMax').value} segundos` : 'Não definido';
  }
  let loaded = false, dirty = false, busy = false;
  const statusLabels = { idle: 'Parado', running: 'Em execução', paused: 'Pausado', stopping: 'Encerrando a ação atual…', attention: 'Precisa de atenção', waiting: 'Aguardando', recovering: 'Recuperando automaticamente', done: 'Encerrado' };
  function syncFields() {
    const type = field('targetType').value;
    $('#x-hashtag-field').hidden = $('#x-target-help').hidden = type !== 'hashtag';
    $('#x-query-field').hidden = type !== 'search'; field('queries').required = type === 'search';
    $('#x-search-order').hidden = type !== 'hashtag';
    field('search').disabled = type !== 'hashtag';
    $('#x-query-help').hidden = type !== 'search';
    $('#x-feed-help').hidden = type !== 'foryou';
    $('#x-target-switch').hidden = type === 'foryou';
    for (const key of ['targetSwitchMin', 'targetSwitchMax']) { field(key).disabled = type === 'foryou'; field(key).required = type !== 'foryou'; }
    field('targetSwitchMax').min = field('targetSwitchMin').value || 1;
 field('comments').required = field('mode').value !== 'like'; field('maxAgeMinutes').required = field('recent').checked; field('maxAgeMinutes').disabled = !field('recent').checked; }
  function refreshControls() {
    const active = ['running', 'paused', 'stopping'].includes(state.xAutomation?.status);
    $('#x-fields').disabled = active || busy;
    $('#x-start').hidden = active; $('#x-start').disabled = busy || dirty || !state.xCampaign;
    $('#x-check').disabled = busy || active || dirty || !state.xCampaign;
    $('#x-pause').hidden = !active; $('#x-stop').hidden = !active;
    $('#x-pause').disabled = busy || state.xAutomation?.status === 'stopping'; $('#x-stop').disabled = busy || state.xAutomation?.status === 'stopping';
    $('#x-pause').textContent = state.xAutomation?.status === 'paused' ? 'Continuar' : 'Pausar';
  }
  window.renderX = next => {
    const selected = new Set([...form.querySelectorAll('[name=xAccountIds]:checked')].map(n => n.value));
    const initial = !loaded;
    if (initial && next.xCampaign) {
      for (const [key, value] of Object.entries(next.xCampaign)) {
        const node = field(key); if (!node) continue;
        if (node.type === 'checkbox') node.checked = value;
        else node.value = Array.isArray(value) ? value.join(key === 'hashtags' ? ', ' : '\n') : value;
      }
    }
    if (initial && next.xCampaign) { field('targetSwitchMin').value = next.xCampaign.targetSwitchMin ?? 20; field('targetSwitchMax').value = next.xCampaign.targetSwitchMax ?? 20; }
    // Initial render may run before the asynchronous state request has completed.
    if (next.version) loaded = true;
    const picker = $('#x-accounts'); picker.replaceChildren();
    for (const account of next.accounts.filter(a => a.platform === 'x')) {
      const label = element('label', 'account-choice'), input = element('input');
      input.type = 'checkbox'; input.name = 'xAccountIds'; input.value = account.id;
      input.checked = initial ? Boolean(next.xCampaign?.accountIds.includes(account.id)) : selected.has(account.id);
      label.append(input, document.createTextNode(profileLabel(account))); picker.append(label);
    }
    if (!picker.children.length) picker.append(element('p', 'empty-inline', 'Cadastre uma conta X em Contas para começar.'));
    const run = next.xAutomation || { status: 'idle', accounts: [], used: 0, limit: 0 };
    $('#x-status').textContent = statusLabels[run.status]; $('#x-total').textContent = `${run.used} / ${run.limit || next.xCampaign?.sessionLimit || 0} ações nesta sessão`;
    const progress = $('#x-progress'); progress.replaceChildren();
    for (const account of run.accounts) {
      const card = element('article', 'x-progress-card');
      const savedAccount = next.accounts.find(a => a.id === account.accountId);
      card.append(element('strong', '', savedAccount ? profileLabel(savedAccount) : 'Conta removida'), element('p', '', `${statusLabels[account.status]} · ${account.likes} curtidas · ${account.replies} respostas`), element('p', 'help', account.message), element('p', 'help', `${account.recoveries || 0} recuperações · ${account.uncertain || 0} resultados incertos`));
      if (account.status !== 'done' && run.status !== 'idle') {
        card.append(actionButton('Abrir conta', () => window.studio.openAccount(account.accountId)), actionButton(['paused', 'attention'].includes(account.status) ? 'Continuar conta' : 'Pausar conta', () => ['paused', 'attention'].includes(account.status) ? window.studio.resumeXAccount(account.accountId) : window.studio.pauseXAccount(account.accountId)));
        card.append(actionButton('Parar conta', () => window.studio.stopXAccount(account.accountId)));
      }
      progress.append(card);
    }
    if (!dirty && next.xCampaign) $('#x-save-status').textContent = `Salva em ${formatDate(next.xCampaign.updatedAt)}`;
    syncFields(); summaryX(); refreshControls();
  };
  form.addEventListener('input', () => { dirty = true; $('#x-save-status').textContent = 'Alterações não salvas.'; syncFields(); summaryX(); refreshControls(); });
  async function call(fn) {
    busy = true; refreshControls();
    try { const result = await fn(); if (result?.accounts) { state = result; render(); } return result; }
    catch (e) { notify(e.message, true); return null; }
    finally { busy = false; refreshControls(); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (field('targetType').value === 'hashtag' && entry.value.trim()) { addItems(); if (entry.value.trim()) return; }
    const data = Object.fromEntries(new FormData(form)); data.recent = field('recent').checked; data.search = field('targetType').value === 'search' ? 'top' : field('search').value;
    data.accountIds = [...form.querySelectorAll('[name=xAccountIds]:checked')].map(n => n.value);
    if (await call(() => window.studio.saveXCampaign(data))) { dirty = false; window.renderX(state); notify('Configuração do X salva.'); }
  });
  $('#x-preview').addEventListener('click', () => { const texts = field('comments').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean); $('#x-preview-text').textContent = texts.length ? texts[Math.floor(Math.random() * texts.length)] : 'Insira uma resposta para visualizar.'; });
  $('#x-start').addEventListener('click', () => call(() => window.studio.startXCampaign()));
  $('#x-stop').addEventListener('click', () => call(() => window.studio.stopXCampaign()));
  $('#x-pause').addEventListener('click', () => call(() => state.xAutomation?.status === 'paused' ? window.studio.resumeXCampaign() : window.studio.pauseXCampaign()));
  $('#x-check').addEventListener('click', async () => {
    const results = await call(() => window.studio.checkXCampaign()); if (!results) return;
    const box = $('#x-check-results'); box.replaceChildren();
    for (const result of results) box.append(element('p', 'help', `${state.accounts.find(a => a.id === result.accountId)?.name}: ${result.ok ? '@' + result.handle + ' — acesso verificado, sem interações.' : result.message}`));
  });
  window.onXAutomation(next => { Object.assign(state, next); if (currentPage === 'history') render(); else window.renderX(state); });
  window.renderX(state);
})();
