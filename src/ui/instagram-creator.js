(() => {
  const $ = selector => document.querySelector(selector);
  const form = $('#creator-form');
  const field = name => form.elements.namedItem(name);
  let id = null, key = crypto.randomUUID(), status = 'draft', busy = false, dirty = false;
  const labels = { draft: 'Rascunho salvo', awaiting: 'Aguardando conclusão no Instagram', completed: 'Conclusão confirmada por você' };
  function feedback(text, error = false) { $('#creator-feedback').textContent = text; $('#creator-feedback').dataset.error = String(error); }
  function connectionStatus(text, connected = false) {
    const message = $('#creator-connection');
    message.textContent = text;
    message.classList.toggle('is-connected', connected);
  }
  function showConnectedProxy(proxy) {
    const diagnostic = proxy?.diagnostic;
    if (!diagnostic?.ip) {
      connectionStatus('Teste de conexão concluído.', true);
      return;
    }
    connectionStatus(`Conectada · IP ${diagnostic.ip} · ${formatLocation(diagnostic.location)}`, true);
  }
  // Populate day (1-31) and year (13-100 years ago) selects
  const daySelect = field('birthDay');
  const yearSelect = field('birthYear');
  if (daySelect.options.length <= 1) for (let d = 1; d <= 31; d++) daySelect.append(new Option(String(d), String(d)));
  if (yearSelect.options.length <= 1) { const thisYear = new Date().getFullYear(); for (let y = thisYear - 18; y >= thisYear - 30; y--) yearSelect.append(new Option(String(y), String(y))); }
  function preview() {
    $('#creator-preview-name').textContent = field('fullName').value.trim() || 'Seu próximo perfil';
    $('#creator-preview-handle').textContent = `@${field('handle').value.replace(/^@/, '') || 'usuario'}`;
    $('#creator-avatar').textContent = field('fullName').value.trim().charAt(0).toUpperCase() || '＋';
    $('#creator-stage').textContent = id ? labels[status] : 'Novo rascunho';
    const step = !id ? 1 : status === 'draft' ? 2 : status === 'awaiting' ? 3 : 4;
    document.querySelectorAll('[data-step]').forEach(node => { node.classList.toggle('current', +node.dataset.step === step); node.classList.toggle('done', +node.dataset.step < step); });
    $('#creator-completion').hidden = status !== 'awaiting';
    $('#creator-complete').disabled = busy || !$('#creator-confirm').checked;
    $('#creator-test-proxy').disabled = busy || !field('proxyId').value;
  }
  function controls() {
    form.querySelectorAll('input,select,button').forEach(node => { node.disabled = busy || status === 'completed'; });
    $('#creator-new').disabled = busy;
    document.querySelectorAll('#creator-list button').forEach(node => { node.disabled = busy; });
    preview();
  }
  async function run(fn) {
    if (busy) return;
    busy = true; controls();
    try { await fn(); } catch (error) { feedback(error.message, true); }
    finally { busy = false; controls(); }
  }
  function reset() {
    form.reset(); id = null; key = crypto.randomUUID(); status = 'draft'; dirty = false;
    field('password').type = 'password'; $('#creator-reveal').textContent = 'Mostrar'; $('#creator-reveal').setAttribute('aria-pressed', 'false');
    connectionStatus('Nenhuma proxy selecionada.');
    $('#creator-proxy-feedback').textContent = '';
    controls(); feedback('Prepare um perfil para começar.'); field('fullName').focus();
  }
  function mayDiscard() { return !dirty || window.confirm('Há alterações não salvas neste perfil. Descartar essas alterações?'); }
  function changed() { dirty = true; $('#creator-confirm').checked = false; preview(); }
  form.addEventListener('input', event => { if (event.target.id !== 'creator-confirm') changed(); });
  $('#creator-new').addEventListener('click', () => { if (mayDiscard()) reset(); });
  async function generate(part) {
    const startsNewDraft = !part && Boolean(id);
    if (startsNewDraft && !mayDiscard()) return;
    await run(async () => {
      const generated = await window.studio.generateInstagramProfile({ name: part === 'handle' ? field('fullName').value : '' });
      if (startsNewDraft) {
        const proxyId = field('proxyId').value;
        const niche = field('niche').value;
        const connection = $('#creator-connection');
        const connectionText = connection.textContent;
        const isConnected = connection.classList.contains('is-connected');
        reset();
        field('proxyId').value = proxyId;
        field('niche').value = niche;
        connectionStatus(connectionText, isConnected);
      }
      for (const name of part ? [part] : ['fullName', 'handle', 'password']) field(name).value = generated[name];
      if (!part && generated.birthDate) { field('birthMonth').value = String(generated.birthDate.month); field('birthDay').value = String(generated.birthDate.day); field('birthYear').value = String(generated.birthDate.year); }
      changed(); feedback(startsNewDraft ? 'Novo perfil preparado. O cadastro abrirá com uma sessão própria.' : 'Sugestão preparada. Revise os dados antes de salvar.');
    });
  }
  $('#creator-generate').addEventListener('click', () => generate());
  $('#creator-handle-generate').addEventListener('click', () => generate('handle'));
  $('#creator-password-generate').addEventListener('click', () => generate('password'));
  $('#creator-reveal').addEventListener('click', () => {
    const show = field('password').type === 'password'; field('password').type = show ? 'text' : 'password';
    $('#creator-reveal').textContent = show ? 'Ocultar' : 'Mostrar'; $('#creator-reveal').setAttribute('aria-pressed', String(show));
  });
  document.querySelectorAll('[data-creator-copy]').forEach(button => button.addEventListener('click', () => run(async () => {
    const value = field(button.dataset.creatorCopy).value;
    if (!value) throw new Error('Preencha o campo antes de copiar.');
    await navigator.clipboard.writeText(value); feedback(button.dataset.creatorCopy === 'password' ? 'Senha copiada.' : 'Nome de usuário copiado.');
  })));
  field('proxyId').addEventListener('change', () => {
    $('#creator-proxy-paste').value = '';
    $('#creator-proxy-feedback').textContent = '';
    connectionStatus(field('proxyId').value ? 'Proxy selecionada. Teste a conexão antes de abrir o cadastro.' : 'Conexão direta · IP do notebook.');
    changed();
  });
  $('#creator-test-proxy').addEventListener('click', () => run(async () => {
    const proxyId = field('proxyId').value;
    feedback('Testando a conexão da proxy…');
    connectionStatus('Testando a conexão…');
    let next;
    try { next = await window.studio.testProxy(proxyId); }
    catch (error) { connectionStatus('Falha no teste da proxy.'); throw error; }
    window.applyStudioState(next);
    const proxy = next.proxies.find(item => item.id === proxyId);
    showConnectedProxy(proxy);
    feedback('Proxy testada com sucesso.');
  }));
  $('#creator-manage-proxies').addEventListener('click', () => $('[data-page="proxies"]').click());
  $('#creator-accounts').addEventListener('click', () => $('[data-page="accounts"]').click());
  async function addPastedProxy() {
    const paste = $('#creator-proxy-paste');
    const message = $('#creator-proxy-feedback');
    const line = paste.value.trim();
    if (!line) throw new Error('Cole a proxy que deseja adicionar.');
    message.dataset.error = 'false'; message.textContent = 'Testando a conexão e salvando a proxy…';
    try {
      const result = await window.studio.addInstagramCreatorProxy({ line, protocol: $('#creator-proxy-protocol').value });
      window.applyStudioState(result.state);
      field('proxyId').value = result.proxyId;
      paste.value = '';
      const proxy = result.state.proxies.find(item => item.id === result.proxyId);
      showConnectedProxy(proxy);
      message.textContent = 'Proxy adicionada e selecionada. O cadastro será aberto com essa conexão.';
      changed(); feedback('Proxy pronta. Clique em Salvar e abrir cadastro para continuar.');
    } catch (error) {
      message.dataset.error = 'true';
      message.textContent = `Proxy não adicionada: ${error.message} Corrija os dados e tente novamente.`;
      throw error;
    }
  }
  $('#creator-add-proxy').addEventListener('click', () => run(addPastedProxy));
  $('#creator-proxy-paste').addEventListener('paste', event => {
    if (busy || status === 'completed') return;
    event.preventDefault();
    $('#creator-proxy-paste').value = event.clipboardData.getData('text').trim();
    changed(); void run(addPastedProxy);
  });
  $('#creator-proxy-paste').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void run(addPastedProxy); }
  });
  async function save() {
    if ($('#creator-proxy-paste').value.trim()) await addPastedProxy();
    const birthDate = { month: Number(field('birthMonth').value) || 0, day: Number(field('birthDay').value) || 0, year: Number(field('birthYear').value) || 0 };
    const input = Object.fromEntries(['fullName', 'handle', 'password', 'email', 'name', 'niche', 'proxyId'].map(name => [name, field(name).value]));
    input.birthDate = birthDate;
    const result = await window.studio.saveInstagramDraft({ ...input, id, key });
    id = result.accountId; dirty = false;
    window.applyStudioState(result.state);
    feedback('Rascunho salvo neste computador.');
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (form.reportValidity()) void run(save); });
  $('#creator-open').addEventListener('click', () => {
    if (!form.reportValidity()) return;
    void run(async () => {
      await save(); feedback('Abrindo a sessão da conta…');
      const next = await window.studio.openInstagramSignup(id);
      window.applyStudioState(next); feedback('Cadastro aberto. Conclua na janela do Instagram e confirme abaixo.');
    });
  });
  $('#creator-confirm').addEventListener('change', preview);
  $('#creator-complete').addEventListener('click', () => run(async () => {
    if (!$('#creator-confirm').checked) return;
    if (dirty) await save();
    const next = await window.studio.completeInstagramDraft({ id, confirmed: true });
    window.applyStudioState(next); field('password').value = ''; field('email').value = ''; dirty = false;
    feedback('Conclusão registrada. A conta está disponível em Minhas contas.');
  }));
  window.renderInstagramCreator = next => {
    const selected = field('proxyId').value;
    field('proxyId').replaceChildren(new Option('Conexão direta · IP do notebook', ''), ...next.proxies.map(proxy => new Option(proxy.name, proxy.id)));
    if (selected && !next.proxies.some(proxy => proxy.id === selected)) {
      field('proxyId').append(new Option('Proxy removida · escolha outra conexão', selected));
    }
    field('proxyId').value = selected;
    const current = next.accounts.find(account => account.id === id);
    if (id && !current) reset();
    else if (current) status = current.registration.status;
    const list = $('#creator-list'); list.replaceChildren();
    const accounts = next.accounts.filter(account => account.platform === 'instagram' && account.registration).slice().reverse();
    if (!accounts.length) { const empty = document.createElement('p'); empty.className = 'help'; empty.textContent = 'Nenhum cadastro preparado ainda. Seu primeiro perfil começa acima.'; list.append(empty); }
    for (const account of accounts) {
      const row = document.createElement('article'); row.className = 'creator-row';
      const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = `${account.name} · @${account.handle}`;
      const detail = document.createElement('small'); detail.textContent = `${labels[account.registration.status]} · ${account.registration.niche}`; copy.append(title, detail);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.disabled = busy;
      button.textContent = account.registration.status === 'completed' ? 'Ver conta' : 'Retomar';
      button.addEventListener('click', () => {
        if (account.registration.status === 'completed') { $('#account-search').value = account.handle; $('#account-search').dispatchEvent(new Event('input')); $('[data-page="accounts"]').click(); return; }
        if (!mayDiscard()) return;
        void run(async () => {
          const draft = await window.studio.loadInstagramDraft(account.id);
          form.reset(); id = draft.id; key = draft.key; status = draft.status;
          $('#creator-proxy-feedback').textContent = '';
          for (const name of ['fullName', 'handle', 'password', 'email', 'name', 'niche', 'proxyId']) field(name).value = draft[name] || '';
          if (draft.birthDate) { field('birthMonth').value = String(draft.birthDate.month); field('birthDay').value = String(draft.birthDate.day); field('birthYear').value = String(draft.birthDate.year); }
          field('password').type = 'password'; $('#creator-reveal').textContent = 'Mostrar'; $('#creator-reveal').setAttribute('aria-pressed', 'false');
          connectionStatus(draft.proxyId ? 'Proxy salva neste rascunho.' : 'Conexão direta · IP do notebook.');
          dirty = false; preview(); feedback('Rascunho carregado. Você pode continuar de onde parou.'); form.scrollIntoView({ block: 'start' });
        });
      });
      row.append(copy, button); list.append(row);
    }
    controls();
  };
  preview();
})();
