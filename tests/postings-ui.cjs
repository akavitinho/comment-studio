const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const output = path.join(__dirname, '..', '.smoke'); fs.mkdirSync(output, { recursive: true });
  const window = new BrowserWindow({ show: false, width: 1320, height: 920, webPreferences: { preload: path.join(__dirname, 'postings-ui-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
    await window.webContents.executeJavaScript("document.querySelector('[data-page=postings]').click()");
    await window.webContents.executeJavaScript("new Promise(resolve => { if (document.body.dataset.ready) resolve(); else setTimeout(resolve, 200); })");
    const status = await window.webContents.executeJavaScript("({ready:document.body.dataset.ready, cards:document.querySelectorAll('.posting-card').length, text:document.querySelector('#posting-accounts').textContent, first:document.querySelector('.posting-form input[type=datetime-local]')?.value})");
    assert.equal(status.ready, 'true', JSON.stringify(status)); assert.equal(status.cards, 1, JSON.stringify(status));
    assert.match(status.text, /@perfil\.teste/); assert.match(status.text, /Conexão direta/); assert.equal(status.first, '2026-11-05T12:00');
    const dashboard = await window.webContents.executeJavaScript(`(async () => { document.querySelector('[data-page=dashboard]').click(); const initial = [...document.querySelectorAll('.dashboard-insight-metric strong')].map(node => node.textContent); document.querySelector('#dashboard-refresh-insights').click(); await new Promise(resolve => setTimeout(resolve, 40)); const result = { title: document.querySelector('#breadcrumb').textContent, metrics: [...document.querySelectorAll('.dashboard-metric strong')].map(node => node.textContent), reel: document.querySelector('#dashboard-reels').textContent, initial, insights: [...document.querySelectorAll('.dashboard-insight-metric strong')].map(node => node.textContent) }; document.querySelector('[data-page=postings]').click(); return result; })()`);
    assert.equal(dashboard.title, 'Dashboard');
    assert.deepEqual(dashboard.metrics, ['1', '1', '1', '1']);
    assert.match(dashboard.reel, /publicado\.mp4/);
    assert.deepEqual(dashboard.initial, ['—', '—']);
    assert.deepEqual(dashboard.insights, ['125', '84']);
    const queue = await window.webContents.executeJavaScript(`(async () => {
      let list = document.querySelector('.posting-list');
      const initial = { open: list.open, summary: list.querySelector('summary').textContent, segments: [...list.querySelectorAll('.posting-queue-progress span')].map(segment => segment.style.flexGrow) };
      list.querySelector('summary').click(); await new Promise(resolve => setTimeout(resolve, 0));
      window.renderPostings(window.postingState); list = document.querySelector('.posting-list');
      const keptOpen = list.open;
      list.querySelector('summary').click(); await new Promise(resolve => setTimeout(resolve, 0));
      window.renderPostings(window.postingState);
      return { initial, keptOpen, keptClosed: !document.querySelector('.posting-list').open };
    })()`);
    assert.deepEqual(queue, { initial: { open: false, summary: '2 vídeosVer fila1 pendente1 precisa de atenção', segments: [] }, keptOpen: true, keptClosed: true });
    const postingTabs = await window.webContents.executeJavaScript(`(() => {
      const select = name => document.querySelector('[data-posting-tab=' + name + ']').click();
      const visible = selector => { const element = document.querySelector(selector); return Boolean(element) && !element.hidden && !element.closest('[hidden]'); };
      const selected = () => document.querySelector('[data-posting-tab][aria-selected=true]')?.dataset.postingTab;
      const initial = { selected: selected(), queue: visible('.posting-list'), schedule: visible('.posting-programming') };
      const card = document.querySelector('#posting-tab-queue .posting-card');
      const accounts = { selected: selected(), connection: Boolean(card?.querySelector('.posting-account-details')), queue: Boolean(card?.querySelector('.posting-list')) };
      select('schedule'); const schedule = { selected: selected(), form: visible('.posting-form'), queue: visible('.posting-list') };
      select('settings'); const settings = { selected: selected(), meta: visible('#meta-settings-form'), account: visible('.posting-card') };
      select('queue'); const restored = { selected: selected(), queue: visible('.posting-list'), execution: visible('.posting-execution') };
      return { initial, accounts, schedule, settings, restored };
    })()`);
    assert.deepEqual(postingTabs, {
      initial: { selected: 'queue', queue: true, schedule: false },
      accounts: { selected: 'queue', connection: false, queue: true },
      schedule: { selected: 'schedule', form: true, queue: false },
      settings: { selected: 'settings', meta: true, account: false },
      restored: { selected: 'queue', queue: true, execution: true }
    });
    const menu = await window.webContents.executeJavaScript("(async()=>{const groups=[...document.querySelectorAll('.nav-group')];groups[1].querySelector('summary').click();await new Promise(resolve=>setTimeout(resolve,0));const opened=groups.map(group=>group.open);groups[2].querySelector('summary').click();await new Promise(resolve=>setTimeout(resolve,0));return {opened,restored:groups.map(group=>group.open)}})()");
    assert.deepEqual(menu.opened, [false, true, false]);
    assert.deepEqual(menu.restored, [false, false, true]);
    const rapidMenu = await window.webContents.executeJavaScript("(()=>{const groups=[...document.querySelectorAll('.nav-group')];groups[1].querySelector('summary').click();groups[2].querySelector('summary').click();return groups.map(group=>group.open)})()");
    assert.deepEqual(rapidMenu, [false, false, true]);
    const collapsed = await window.webContents.executeJavaScript("(()=>{document.querySelector('.sidebar').style.transition='none';document.querySelector('.workspace').style.transition='none';document.querySelector('#sidebar-collapse').click();return {collapsed:document.body.classList.contains('sidebar-collapsed'),stored:localStorage.getItem('comment-studio-sidebar-collapsed'),width:Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),general:document.querySelector('.nav-general-title').tagName}})()");
    assert.equal(collapsed.collapsed, true);
    assert.equal(collapsed.stored, 'true');
    assert.equal(collapsed.width, 74);
    assert.equal(collapsed.general, 'P');
    await new Promise(resolve => setTimeout(resolve, 240));
    fs.writeFileSync(path.join(output, 'sidebar-collapsed.png'), (await window.webContents.capturePage()).toPNG());
    const expanded = await window.webContents.executeJavaScript("(()=>{document.querySelectorAll('.nav-group')[1].querySelector('summary').click();return {collapsed:document.body.classList.contains('sidebar-collapsed'),stored:localStorage.getItem('comment-studio-sidebar-collapsed'),groups:[...document.querySelectorAll('.nav-group')].map(group=>group.open)}})()");
    assert.deepEqual(expanded, { collapsed: false, stored: 'false', groups: [false, true, false] });
    const history = await window.webContents.executeJavaScript(`(() => {
      const original = { events: state.events, attempts: state.attempts, xAttempts: state.xAttempts };
      state.events = Array.from({ length: 23 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 5, 12, i)).toISOString(), message: 'Atividade ' + i }));
      state.attempts = [{ id: 'test-attempt', at: new Date(Date.UTC(2026, 10, 5, 13)).toISOString(), accountName: 'Perfil de teste', status: 'sent' }];
      state.xAttempts = [];
      renderHistory();
      const first = { count: document.querySelectorAll('.history-row').length, summary: document.querySelector('#history-summary').textContent, first: document.querySelector('.history-row').textContent };
      document.querySelector('#history-next').click();
      const second = document.querySelector('#history-page-label').textContent;
      document.querySelector('[data-history-filter=actions]').click();
      const actions = { count: document.querySelectorAll('.history-row').length, nextDisabled: document.querySelector('#history-next').disabled, text: document.querySelector('.history-row').textContent };
      state.events = original.events; state.attempts = original.attempts; state.xAttempts = original.xAttempts;
      document.querySelector('[data-history-filter=all]').click();
      return { first, second, actions };
    })()`);
    assert.equal(history.first.count, 10);
    assert.match(history.first.summary, /1–10 de 25/);
    assert.match(history.first.first, /Comentário · Confirmado/);
    assert.equal(history.second, 'Página 2 de 3');
    assert.equal(history.actions.count, 1);
    assert.equal(history.actions.nextDisabled, true);
    assert.match(history.actions.text, /Perfil de teste/);
    await window.webContents.executeJavaScript(`(() => {
      window.__historyFixture = { events: state.events, attempts: state.attempts };
      state.events = Array.from({ length: 12 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 5, 12, i)).toISOString(), message: 'Configuração atualizada para o perfil ' + i }));
      state.attempts = [{ id: 'visual-attempt', at: new Date(Date.UTC(2026, 10, 5, 13)).toISOString(), accountName: 'Perfil de teste', status: 'sent' }];
      document.querySelector('[data-page=history]').click(); renderHistory();
    })()`);
    await new Promise(resolve => setTimeout(resolve, 120));
    fs.writeFileSync(path.join(output, 'history-populated.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("state.events=window.__historyFixture.events;state.attempts=window.__historyFixture.attempts;delete window.__historyFixture;renderHistory()");
    const proxySearch = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-page=proxies]').click();
      const search = document.querySelector('#proxy-search');
      const find = value => { search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })); return { profiles: document.querySelector('#proxy-profile-results').textContent, proxies: document.querySelector('#proxy-list').textContent }; };
      return { direct: find('perfil.teste'), linked: find('classico'), missing: find('sem resultado') };
    })()`);
    assert.match(proxySearch.direct.profiles, /Conexão direta/);
    assert.match(proxySearch.linked.profiles, /Proxy Brasil/);
    assert.match(proxySearch.linked.proxies, /Clássico Criador|criador.x/);
    assert.match(proxySearch.missing.proxies, /Nenhum proxy encontrado/);
    await window.webContents.executeJavaScript("document.querySelector('[data-page=postings]').click()");
    await window.webContents.executeJavaScript("setTheme('light'); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await new Promise(resolve => setTimeout(resolve, 220));
    const lightNav = await window.webContents.executeJavaScript("({sidebar:getComputedStyle(document.querySelector('.sidebar')).backgroundColor,active:getComputedStyle(document.querySelector('.sidebar .nav-item.active')).backgroundColor,nav:getComputedStyle(document.querySelector('.nav-general .nav-item')).color})");
    assert.deepEqual(lightNav, { sidebar: 'rgb(255, 255, 255)', active: 'rgb(240, 234, 248)', nav: 'rgb(76, 71, 83)' });
    fs.writeFileSync(path.join(output, 'postings-light.png'), (await window.webContents.capturePage()).toPNG());
    for (const tab of ['queue', 'schedule', 'settings']) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-posting-tab=${tab}]').click()`);
      await new Promise(resolve => setTimeout(resolve, 180));
      fs.writeFileSync(path.join(output, `postings-${tab}-light.png`), (await window.webContents.capturePage()).toPNG());
    }
    await window.webContents.executeJavaScript("document.querySelector('[data-posting-tab=queue]').click()");
    for (const name of ['campaign', 'x', 'accounts', 'proxies', 'media', 'history']) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-page=${name}]').click()`);
      await new Promise(resolve => setTimeout(resolve, 120));
      await window.webContents.capturePage();
      fs.writeFileSync(path.join(output, `${name}-light.png`), (await window.webContents.capturePage()).toPNG());
    }
    await window.webContents.executeJavaScript("document.querySelector('[data-page=postings]').click()");
    window.setSize(600, 760);
    await new Promise(resolve => setTimeout(resolve, 160));
    for (const name of ['campaign', 'x', 'accounts', 'proxies', 'media', 'history', 'postings']) {
      const size = await window.webContents.executeJavaScript(`(()=>{document.querySelector('[data-page=${name}]').click();return {scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}})()`);
      assert.ok(size.scroll <= size.client, `light compact ${name}: ${JSON.stringify(size)}`);
    }
    fs.writeFileSync(path.join(output, 'postings-light-compact.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(1320, 920);
    await new Promise(resolve => setTimeout(resolve, 160));
    await window.webContents.executeJavaScript("setTheme('dark'); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await new Promise(resolve => setTimeout(resolve, 220));
    const darkNav = await window.webContents.executeJavaScript("({sidebar:getComputedStyle(document.querySelector('.sidebar')).backgroundColor,active:getComputedStyle(document.querySelector('.sidebar .nav-item.active')).backgroundColor,nav:getComputedStyle(document.querySelector('.nav-general .nav-item')).color})");
    assert.deepEqual(darkNav, { sidebar: 'rgb(34, 33, 40)', active: 'rgb(52, 45, 64)', nav: 'rgb(210, 206, 216)' });
    fs.writeFileSync(path.join(output, 'postings-dark.png'), (await window.webContents.capturePage()).toPNG());
    for (const tab of ['queue', 'schedule', 'settings']) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-posting-tab=${tab}]').click()`);
      await new Promise(resolve => setTimeout(resolve, 180));
      fs.writeFileSync(path.join(output, `postings-${tab}-dark.png`), (await window.webContents.capturePage()).toPNG());
    }
    await window.webContents.executeJavaScript("document.querySelector('[data-posting-tab=queue]').click()");
    await window.webContents.executeJavaScript("(() => { document.querySelector('[data-page=proxies]').click(); const search=document.querySelector('#proxy-search'); search.value='classico'; search.dispatchEvent(new Event('input',{bubbles:true})); })()");
    await new Promise(resolve => setTimeout(resolve, 220));
    fs.writeFileSync(path.join(output, 'proxies-dark.png'), (await window.webContents.capturePage()).toPNG());
    for (const name of ['campaign', 'x', 'accounts', 'media', 'history']) {
      await window.webContents.executeJavaScript(`document.querySelector('[data-page=${name}]').click()`);
      await new Promise(resolve => setTimeout(resolve, 120));
      fs.writeFileSync(path.join(output, `${name}-dark.png`), (await window.webContents.capturePage()).toPNG());
    }
    window.setSize(600, 760);
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const overflow = await window.webContents.executeJavaScript("({scroll:document.documentElement.scrollWidth, client:document.documentElement.clientWidth, elements:[...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > document.documentElement.clientWidth+2).slice(0,8).map(el=>el.tagName+'.'+el.className)})");
    assert.ok(overflow.scroll <= overflow.client, JSON.stringify(overflow));
    fs.writeFileSync(path.join(output, 'proxies-compact.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.querySelector('[data-page=postings]').click()");
    await new Promise(resolve => setTimeout(resolve, 220));
    const postingsOverflow = await window.webContents.executeJavaScript("({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})");
    assert.ok(postingsOverflow.scroll <= postingsOverflow.client, JSON.stringify(postingsOverflow));
    fs.writeFileSync(path.join(output, 'postings-compact.png'), (await window.webContents.capturePage()).toPNG());
    for (const tab of ['queue', 'schedule', 'settings']) {
      const size = await window.webContents.executeJavaScript(`(() => { document.querySelector('[data-posting-tab=${tab}]').click(); return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }; })()`);
      assert.ok(size.scroll <= size.client, `compact ${tab}: ${JSON.stringify(size)}`);
    }
    await window.webContents.executeJavaScript("document.querySelector('[data-posting-tab=queue]').click()");
    for (const page of ['campaign', 'x', 'accounts', 'proxies', 'media', 'history', 'postings']) {
      const size = await window.webContents.executeJavaScript(`(() => { document.querySelector('[data-page=${page}]').click(); return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }; })()`);
      assert.ok(size.scroll <= size.client, `${page}: ${JSON.stringify(size)}`);
    }
    const compactRows = await window.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('.posting-list'); list.open = true;
      const published = [...list.querySelectorAll('.posting-item')].find(row => row.classList.contains('posting-item-published'));
      const queued = [...list.querySelectorAll('.posting-item')].find(row => row.classList.contains('posting-item-queued'));
      const attention = [...list.querySelectorAll('.posting-item')].find(row => row.classList.contains('posting-item-attention'));
      const initial = { publishedCollapsed: published.querySelector('.posting-item-details').hidden, reelAction: !![...published.querySelectorAll('.posting-item-quick-actions button')].find(button => button.textContent === 'Abrir Reel'), queuedCollapsed: queued.querySelector('.posting-item-details').hidden, attentionVisible: !!attention.querySelector('.posting-item-error') && !!attention.querySelector('.posting-item-quick-actions button') };
      queued.querySelector('.posting-item-toggle').click();
      return { ...initial, queuedExpanded: !queued.querySelector('.posting-item-details').hidden, accessible: queued.querySelector('.posting-item-toggle').getAttribute('aria-expanded') === 'true' };
    })()`);
    assert.deepEqual(compactRows, { publishedCollapsed: true, reelAction: true, queuedCollapsed: true, attentionVisible: true, queuedExpanded: true, accessible: true });
    await window.webContents.executeJavaScript("document.querySelector('.posting-item').scrollIntoView({ block: 'center' })");
    fs.writeFileSync(path.join(output, 'postings-list-compact.png'), (await window.webContents.capturePage()).toPNG());
    const retry = await window.webContents.executeJavaScript(`(async () => {
      const item = [...document.querySelectorAll('.posting-item')].find(row => row.textContent.includes('falhou.mp4'));
      const action = [...item.querySelectorAll('button')].find(button => button.textContent === 'Tentar novamente');
      const before = Boolean(action) && item.textContent.includes('Precisa de atenção');
      action.click(); await new Promise(resolve => setTimeout(resolve, 20));
      const updated = [...document.querySelectorAll('.posting-item')].find(row => row.textContent.includes('falhou.mp4'));
      return { before, queued: updated.textContent.includes('Na fila'), paused: document.querySelector('.posting-execution-state').textContent.includes('pausada') };
    })()`);
    assert.deepEqual(retry, { before: true, queued: true, paused: true });
    const bulk = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-page=accounts]').click();
      document.querySelector('#open-bulk-accounts').click();
      document.querySelector('#bulk-handles').value = '@perfil.um\\n@perfil.dois\\n@perfil.tres';
      document.querySelector('#bulk-handles').dispatchEvent(new Event('input', { bubbles: true }));
      const automaticCount = document.querySelector('#bulk-count-preview').textContent;
      const rows = [...document.querySelectorAll('.bulk-account-row')];
      rows[1].querySelector('.bulk-proxy-select').value = 'proxy-test';
      rows[2].querySelector('button').click();
      const proxyForm = document.querySelector('#bulk-proxy-form');
      proxyForm.elements.host.value = 'proxy.example.com';
      proxyForm.elements.port.value = '8080';
      proxyForm.querySelector('button[type=submit]').click();
      await new Promise(resolve => setTimeout(resolve, 80));
      const newProxy = rows[2].querySelector('.bulk-proxy-select').value;
      document.querySelector('#bulk-save').click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = await window.studio.state();
      return { count: rows.length, automaticCount, nameFields: document.querySelectorAll('#account-form [name=name], #posting-account-form [name=name], .bulk-name').length,
        prepared: rows.map(row => row.querySelector('.bulk-handle').value), newProxy,
        saved: result.accounts.filter(account => account.id.startsWith('bulk-')).map(account => ({ handle: account.handle, name: account.name, proxyId: account.proxyId, platform: account.platform })),
        statuses: rows.map(row => row.querySelector('.bulk-row-status').textContent), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    })()`);
    assert.equal(bulk.count, 3);
    assert.equal(bulk.automaticCount, '3 perfis informados');
    assert.equal(bulk.nameFields, 0);
    assert.deepEqual(bulk.prepared, ['perfil.um', 'perfil.dois', 'perfil.tres']);
    assert.equal(bulk.newProxy, 'proxy-1');
    assert.deepEqual(bulk.saved, [
      { handle: 'perfil.um', name: 'perfil.um', proxyId: '', platform: 'instagram' },
      { handle: 'perfil.dois', name: 'perfil.dois', proxyId: 'proxy-test', platform: 'instagram' },
      { handle: 'perfil.tres', name: 'perfil.tres', proxyId: 'proxy-1', platform: 'instagram' }
    ]);
    assert.deepEqual(bulk.statuses, ['Cadastrada', 'Cadastrada', 'Cadastrada']);
    assert.equal(bulk.overflow, false);
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { window.scrollTo(0, 0); resolve(); })))');
    fs.writeFileSync(path.join(output, 'accounts-bulk-compact.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript("document.querySelector('#close-bulk-accounts').click()");
    const postingAccount = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-page=postings]').click();
      document.querySelector('#posting-add-account-shortcut').click();
      const form = document.querySelector('#posting-account-form');
      form.elements.handle.value = '@novo.direto'; form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 70));
      form.elements.handle.value = '@novo.proxy'; form.elements.proxyId.value = 'proxy-test'; form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 70));
      form.elements.handle.value = '@novo.criado';
      document.querySelector('#posting-add-proxy').click();
      const proxyForm = document.querySelector('#posting-new-proxy-form');
      proxyForm.elements.host.value = 'novo.proxy.local'; proxyForm.elements.port.value = '8080'; proxyForm.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 70));
      const selectedProxy = form.elements.proxyId.value;
      const overflowWithProxy = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      form.requestSubmit(); await new Promise(resolve => setTimeout(resolve, 70));
      const result = await window.studio.state();
      return { selectedTab: document.querySelector('[data-posting-tab=queue]').getAttribute('aria-selected'), selectedProxy,
        accounts: result.accounts.filter(account => account.handle?.startsWith('novo.')).map(account => ({ handle: account.handle, name: account.name, proxyId: account.proxyId })),
        selectedAccount: document.querySelector('#posting-account-choices input:checked')?.value,
        overflowWithProxy };
    })()`);
    assert.equal(postingAccount.selectedTab, 'true');
    assert.equal(postingAccount.selectedProxy, 'proxy-2');
    assert.deepEqual(postingAccount.accounts, [
      { handle: 'novo.direto', name: 'novo.direto', proxyId: '' }, { handle: 'novo.proxy', name: 'novo.proxy', proxyId: 'proxy-test' }, { handle: 'novo.criado', name: 'novo.criado', proxyId: 'proxy-2' }
    ]);
    assert.equal(postingAccount.selectedAccount, 'bulk-7');
    assert.equal(postingAccount.overflowWithProxy, false);
    const existingConnection = await window.webContents.executeJavaScript(`(async () => {
      let card = [...document.querySelectorAll('.posting-card')].find(item => item.dataset.accountId === 'ig-test');
      const controls = () => card.querySelector('.posting-account-connection');
      controls().querySelector('select').value = 'proxy-test';
      [...controls().querySelectorAll('button')].find(button => button.textContent === 'Salvar conexão').click();
      await new Promise(resolve => setTimeout(resolve, 70));
      card = [...document.querySelectorAll('.posting-card')].find(item => item.dataset.accountId === 'ig-test');
      const savedExisting = (await window.studio.state()).accounts.find(account => account.id === 'ig-test').proxyId;
      [...card.querySelectorAll('.posting-account-connection button')].find(button => button.textContent === '+ Nova proxy').click();
      const form = document.querySelector('#posting-new-proxy-form');
      form.elements.host.value = 'mais.proxy.local'; form.elements.port.value = '8081'; form.requestSubmit();
      await new Promise(resolve => setTimeout(resolve, 70));
      card = [...document.querySelectorAll('.posting-card')].find(item => item.dataset.accountId === 'ig-test');
      const selectedNew = card.querySelector('.posting-account-connection select').value;
      [...card.querySelectorAll('.posting-account-connection button')].find(button => button.textContent === 'Salvar conexão').click();
      await new Promise(resolve => setTimeout(resolve, 70));
      return { savedExisting, selectedNew, savedNew: (await window.studio.state()).accounts.find(account => account.id === 'ig-test').proxyId,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    })()`);
    assert.deepEqual(existingConnection, { savedExisting: 'proxy-test', selectedNew: 'proxy-3', savedNew: 'proxy-3', overflow: false });
    const multiAccount = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-posting-tab=queue]').click();
      const visible = () => [...document.querySelectorAll('.posting-card[data-account-id]')].filter(card => !card.hidden).map(card => card.dataset.accountId);
      const initial = visible();
      const extra = [...document.querySelectorAll('#posting-account-choices input')].find(input => input.value === 'ig-test');
      extra.checked = true; extra.dispatchEvent(new Event('change', { bubbles: true }));
      const queue = { ids: visible(), summary: document.querySelector('#posting-account-summary').textContent };
      document.querySelector('[data-posting-tab=schedule]').click(); const schedule = visible();
      document.querySelector('#posting-clear-selection').click();
      const cleared = { ids: visible(), prompt: !document.querySelector('#posting-selection-empty').hidden };
      document.querySelector('#posting-select-all').click(); const all = visible();
      return { initial, queue, schedule, cleared, all, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    })()`);
    assert.deepEqual(multiAccount.initial, ['bulk-7']);
    assert.deepEqual(multiAccount.queue, { ids: ['ig-test', 'bulk-7'], summary: '2 contas selecionadas' });
    assert.deepEqual(multiAccount.schedule, ['ig-test', 'bulk-7']);
    assert.deepEqual(multiAccount.cleared, { ids: [], prompt: true });
    assert.equal(multiAccount.all.length, 7);
    assert.equal(multiAccount.overflow, false);
    const sharedSchedule = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('#posting-clear-selection').click();
      for (const id of ['ig-test', 'bulk-7']) {
        const choice = [...document.querySelectorAll('#posting-account-choices input')].find(input => input.value === id);
        choice.checked = true; choice.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const form = [...document.querySelectorAll('.posting-card[data-account-id]')].find(card => card.dataset.accountId === 'ig-test').querySelector('.posting-form');
      const label = form.querySelector('.posting-save-rhythm').textContent;
      const note = !form.closest('.posting-programming').querySelector('.posting-shared-note').hidden;
      form.querySelector('input[type=number]').value = '35';
      const times = [...form.querySelectorAll('input[type=time]')]; times[0].value = '09:00'; times[1].value = '23:40';
      form.querySelectorAll('input[type=number]')[2].value = '100';
      form.requestSubmit(); await new Promise(resolve => setTimeout(resolve, 70));
      const schedules = (await window.studio.state()).postings.schedules.filter(schedule => ['ig-test', 'bulk-7'].includes(schedule.account_id));
      const confirmation = document.querySelector('.posting-schedule-confirmation');
      return { label, note, count: schedules.length, min: schedules.map(schedule => schedule.config.minMinutes), windows: schedules.map(schedule => [schedule.config.startMinute, schedule.config.endMinute, Number(schedule.config.dailyLimit)]), errorHidden: document.querySelector('#posting-feedback').hidden, confirmed: Boolean(confirmation) && !confirmation.hidden && /Horários aplicados a 2 contas/.test(confirmation.textContent) && /A fila não foi iniciada/.test(confirmation.textContent) };
    })()`);
    assert.deepEqual(sharedSchedule, { label: 'Aplicar horários às 2 contas', note: true, count: 2, min: [35, 35], windows: [[540, 1420, 100], [540, 1420, 100]], errorHidden: true, confirmed: true });
    const singleAccount = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-page=accounts]').click();
      const form = document.querySelector('#account-form');
      form.elements.platform.value = 'x'; form.elements.handle.value = '@conta.nova'; form.requestSubmit(form.querySelector('button[type=submit]'));
      await new Promise(resolve => setTimeout(resolve, 70));
      const saved = (await window.studio.state()).accounts.find(account => account.handle === 'conta.nova');
      return { handle: saved?.handle, name: saved?.name, visible: [...document.querySelectorAll('#account-list h3')].some(node => node.textContent === '@conta.nova') };
    })()`);
    assert.deepEqual(singleAccount, { handle: 'conta.nova', name: 'conta.nova', visible: true });
    console.log('Postings UI: light, dark and compact fixtures passed.');
  } catch (error) { console.error(`Postings UI failed: ${error.message}`); process.exitCode = 1; }
  finally { window.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error.message); app.exit(1); });
