(() => {
  const $ = selector => document.querySelector(selector);
  const el = (tag, label, className) => { const node = document.createElement(tag); if (label !== undefined) node.textContent = label; if (className) node.className = className; return node; };
  let current = { accounts: [], postings: { items: [], schedules: [] }, facebookMetrics: [] };
  let pending = null, selectedFile = '';
  const feedback = (message, error = false) => { const node = $('#facebook-feedback'); node.textContent = message; node.hidden = !message; node.classList.toggle('error', error); };
  const apply = next => { if (window.applyStudioState) window.applyStudioState(next); else window.renderFacebook(next); };
  const run = async action => { try { feedback(''); const next = await action(); if (next?.accounts) apply(next); return next; } catch (error) { feedback(error.message, true); return null; } };
  const button = (label, action, kind = 'secondary') => { const node = el('button', label, kind); node.type = 'button'; node.addEventListener('click', async () => { node.disabled = true; try { await run(action); } finally { node.disabled = false; } }); return node; };
  const pages = () => current.accounts.filter(account => account.platform === 'facebook');
  const selectOptions = (select, accounts) => { const saved = select.value; select.replaceChildren(...accounts.map(account => new Option(account.name, account.id))); if (accounts.some(account => account.id === saved)) select.value = saved; };
  $('#facebook-storage-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const next = await run(() => window.studio.savePostingStorage(Object.fromEntries(new FormData(form))));
    if (next) { form.elements.publishableKey.value = ''; feedback('Conexão Supabase salva.'); }
  });
  $('#facebook-connect').addEventListener('click', async () => {
    const result = await run(() => window.studio.connectFacebook({ proxyId: $('#facebook-login-proxy').value || null }));
    if (!result?.pages) return;
    pending = { flowId: result.flowId, proxyId: $('#facebook-login-proxy').value || null };
    const choices = $('#facebook-page-options'); choices.replaceChildren();
    for (const page of result.pages) { const label = el('label'); const check = el('input'); check.type = 'checkbox'; check.value = page.id; check.checked = true; label.append(check, document.createTextNode(` ${page.name}${page.insightsGranted ? '' : ' · métricas indisponíveis'}`)); choices.append(label); }
    $('#facebook-page-choice').hidden = false;
  });
  $('#facebook-bind').addEventListener('click', async () => {
    if (!pending) return;
    const pageIds = [...$('#facebook-page-options').querySelectorAll('input:checked')].map(input => input.value);
    const next = await run(() => window.studio.bindFacebookPages({ ...pending, pageIds }));
    if (next) { pending = null; $('#facebook-page-choice').hidden = true; feedback(`${pageIds.length} Página(s) conectada(s).`); }
  });
  $('#facebook-compose [name=type]').addEventListener('change', () => { selectedFile = ''; $('#facebook-file-name').textContent = 'Nenhum arquivo selecionado'; $('#facebook-file-row').hidden = $('#facebook-compose [name=type]').value === 'text'; });
  $('#facebook-pick-file').addEventListener('click', async () => {
    const type = $('#facebook-compose [name=type]').value;
    const files = await (type === 'reel' ? window.studio.pickMediaVideos() : window.studio.pickMediaImages());
    selectedFile = files.find(file => type === 'reel' ? /\.(mp4|mov)$/i.test(file) : /\.(jpe?g|png)$/i.test(file)) || '';
    $('#facebook-file-name').textContent = selectedFile ? selectedFile.split(/[\\/]/).pop() : 'Selecione MP4/MOV ou JPG/PNG';
  });
  $('#facebook-compose').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, type = form.elements.type.value;
    if (type !== 'text' && !selectedFile) { feedback('Escolha um arquivo válido.', true); return; }
    const next = await run(() => window.studio.addFacebookPost({ accountId: form.elements.accountId.value, type, file: selectedFile, caption: form.elements.caption.value }));
    if (next) { form.elements.caption.value = ''; selectedFile = ''; $('#facebook-file-name').textContent = 'Nenhum arquivo selecionado'; feedback('Postagem adicionada à fila.'); }
  });
  function loadSchedule() {
    const form = $('#facebook-schedule');
    const config = current.postings?.schedules?.find(row => row.account_id === form.elements.accountId.value)?.config;
    form.elements.times.value = config?.mode === 'fixed' ? config.times.join(', ') : '';
    form.elements.variationMinutes.value = config?.mode === 'fixed' ? String(config.variationMinutes) : '0';
    form.elements.timeZone.value = config?.timeZone || 'America/Sao_Paulo';
  }
  $('#facebook-schedule [name=accountId]').addEventListener('change', loadSchedule);
  $('#facebook-schedule').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget;
    const times = form.elements.times.value.split(',').map(value => value.trim()).filter(Boolean);
    const next = await run(() => window.studio.saveFacebookSchedule({ accountId: form.elements.accountId.value, mode: 'fixed', times, variationMinutes: Number(form.elements.variationMinutes.value), timeZone: form.elements.timeZone.value }));
    if (next) feedback('Horários salvos. Inicie a fila quando estiver pronta.');
  });
  $('#facebook-refresh').addEventListener('click', async () => {
    const node = $('#facebook-dashboard-feedback'); node.textContent = 'Consultando métricas oficiais…';
    for (const page of pages().filter(page => page.facebook?.connected && page.facebook?.insightsGranted)) await run(() => window.studio.refreshFacebookInsights(page.id));
    node.textContent = 'Consulta concluída. Métricas indisponíveis aparecem como —.';
  });
  function renderDashboard() {
    const items = current.postings?.items || [], ids = new Set(pages().map(page => page.id));
    const own = items.filter(item => ids.has(item.account_id));
    const metrics = $('#facebook-dashboard-metrics'); metrics.replaceChildren();
    for (const [label, count] of [['Páginas', ids.size], ['Pendentes', own.filter(item => item.status === 'queued').length], ['Publicadas', own.filter(item => item.status === 'published').length], ['Precisam de atenção', own.filter(item => ['attention', 'uncertain'].includes(item.status)).length]]) { const card = el('div', undefined, 'media-card'); card.append(el('strong', String(count)), el('span', label)); metrics.append(card); }
    const root = $('#facebook-dashboard-pages'); root.replaceChildren();
    for (const page of pages()) {
      const data = (current.facebookMetrics || []).find(row => row.account_id === page.id);
      const card = el('div', undefined, 'media-card'); card.append(el('h2', page.name), el('p', page.facebook?.connected ? 'Página conectada' : 'Reconexão necessária'));
      card.append(el('p', `Visualizações de mídia nos últimos 30 dias: ${data?.media_views == null ? '—' : Number(data.media_views).toLocaleString('pt-BR')}`));
      card.append(el('p', `Visualizadores únicos nos últimos 30 dias: ${data?.unique_viewers == null ? '—' : Number(data.unique_viewers).toLocaleString('pt-BR')}`));
      if (data?.fetched_at) card.append(el('small', `Leitura: ${new Date(data.fetched_at).toLocaleString('pt-BR')}`));
      root.append(card);
    }
  }
  function renderQueues() {
    const root = $('#facebook-queues'); root.replaceChildren();
    for (const page of pages()) {
      const schedule = current.postings?.schedules?.find(row => row.account_id === page.id);
      const items = (current.postings?.items || []).filter(item => item.account_id === page.id);
      const card = el('section', undefined, 'media-card facebook-page-card');
      card.append(el('h2', page.name), el('p', `${page.facebook?.connected ? 'Conectada' : 'Reconexão necessária'} · ${schedule?.status || 'Sem horários'} · ${items.filter(item => item.status === 'queued').length} pendente(s)`));
      if (schedule?.next_at) card.append(el('p', `Próxima postagem: ${new Date(schedule.next_at).toLocaleString('pt-BR')}`));
      const controls = el('div', undefined, 'posting-actions');
      if (schedule) controls.append(button('Iniciar', () => window.studio.controlFacebookPosting({ accountId: page.id, status: 'running' }), 'primary'), button('Pausar', () => window.studio.controlFacebookPosting({ accountId: page.id, status: 'paused' })), button('Parar', () => window.studio.controlFacebookPosting({ accountId: page.id, status: 'stopped' })));
      controls.append(button('Desconectar', () => window.studio.disconnectFacebook(page.id)));
      card.append(controls);
      for (const item of items) {
        const name = item.content_type === 'text' ? item.caption.slice(0, 80) : item.file.split(/[\\/]/).pop();
        const row = el('div', undefined, 'posting-item'); row.append(el('strong', name), el('span', ` · ${item.content_type} · ${item.status}`));
        if (item.error) row.append(el('p', item.error, 'record-error'));
        const actions = el('div', undefined, 'posting-actions');
        if (item.status === 'queued') actions.append(button('↑', () => window.studio.movePostingVideo({ id: item.id, direction: 'up' })), button('↓', () => window.studio.movePostingVideo({ id: item.id, direction: 'down' })), button('Remover', () => window.studio.removePostingVideo(item.id)));
        if (item.status === 'attention') actions.append(button('Tentar novamente', () => window.studio.retryFacebookPost(item.id)));
        if (item.status === 'uncertain') actions.append(button('Conferi: publicado', () => window.studio.resolveFacebookUncertain({ id: item.id, outcome: 'published' })), button('Conferi: não publicado', () => window.studio.resolveFacebookUncertain({ id: item.id, outcome: 'cancelled' })));
        if (item.facebook_permalink) actions.append(button('Abrir no Facebook', () => window.studio.openPublishedFacebookReel(item.id)));
        row.append(actions); card.append(row);
      }
      root.append(card);
    }
  }
  window.renderFacebook = state => {
    current = state;
    const storageForm = $('#facebook-storage-form');
    storageForm.elements.url.value = state.postingStorage?.url || '';
    $('#facebook-storage-status').textContent = state.postingStorage?.configured ? 'Conexão configurada. Para alterar a chave, informe a nova chave pública.' : 'Configure o projeto Supabase para conectar Páginas e publicar Reels.';
    const proxy = $('#facebook-login-proxy'), previous = proxy.value;
    proxy.replaceChildren(new Option('Direta', ''), ...(state.proxies || []).map(item => new Option(item.name, item.id)));
    proxy.value = previous;
    for (const form of [$('#facebook-compose'), $('#facebook-schedule')]) selectOptions(form.elements.accountId, pages());
    renderQueues(); renderDashboard();
  };
})();
