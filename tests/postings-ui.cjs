const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { preload: path.join(__dirname, 'postings-ui-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
    await window.webContents.executeJavaScript("document.querySelector('[data-page=postings]').click()");
    await window.webContents.executeJavaScript("new Promise(resolve => { if (document.body.dataset.ready) resolve(); else setTimeout(resolve, 250); })");
    const result = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-posting-tab=schedule]').click();
      const legacy = document.querySelector('.posting-legacy-note')?.textContent.includes('agenda antiga');
      const uncertainVisible = document.querySelector('.posting-list')?.textContent.includes('antigo.mp4');
      const sharedAbsent = !document.querySelector('[data-posting-tab=shared]');
      const form = document.querySelector('.posting-form');
      const field = form.querySelector('input[type=time]');
      field.value = '16:00'; form.querySelector('.posting-time-add button').click();
      field.value = '19:00'; field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const beforeRemove = form.querySelector('.posting-time-count').textContent;
      form.querySelector('.posting-time-remove').click();
      const afterRemove = form.querySelector('.posting-time-count').textContent;
      field.value = '16:00'; form.querySelector('.posting-time-add button').click();
      form.querySelector('input[type=number]').value = '15';
      [...form.querySelectorAll('button')].find(button => button.textContent === 'Prévia dos horários').click();
      await new Promise(resolve => setTimeout(resolve, 30));
      const preview = form.querySelector('.posting-preview').textContent;
      form.requestSubmit(); await new Promise(resolve => setTimeout(resolve, 90));
      const config = (await window.studio.state()).postings.schedules[0].config;
      const confirmation = document.querySelector('.posting-schedule-confirmation')?.textContent;
      const savedForm = document.querySelector('.posting-form');
      [...savedForm.querySelectorAll('button')].find(button => button.textContent === 'Prévia dos horários').click();
      await new Promise(resolve => setTimeout(resolve, 30));
      const savedPreview = savedForm.querySelector('.posting-preview').textContent;
      const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      return { legacy, uncertainVisible, sharedAbsent, beforeRemove, afterRemove, preview, savedPreview, config, confirmed: confirmation?.includes('Horários aplicados a 1 conta'), overflow };
    })()`);
    assert.equal(result.legacy, true);
    assert.equal(result.uncertainVisible, true);
    assert.equal(result.sharedAbsent, true);
    assert.equal(result.beforeRemove, '2 postagens por dia');
    assert.equal(result.afterRemove, '1 postagem por dia');
    assert.match(result.preview, /@perfil\.teste/);
    assert.match(result.savedPreview, /Horários efetivos salvos/);
    assert.deepEqual(result.config, { mode: 'fixed', times: ['16:00', '19:00'], variationMinutes: 15, timeZone: 'America/Sao_Paulo' });
    assert.equal(result.confirmed, true);
    assert.equal(result.overflow, false);
    window.setSize(1600, 900);
    await new Promise(resolve => setTimeout(resolve, 120));
    const grid = await window.webContents.executeJavaScript(`(async () => {
      const original = await window.studio.state();
      const extra = ['dois', 'tres'].map((name, index) => ({ ...original.accounts[0], id: 'ig-grid-' + index, name, handle: name }));
      window.applyStudioState({ ...original, accounts: [...original.accounts, ...extra] });
      document.querySelector('#posting-select-all').click();
      const root = document.querySelector('#posting-tab-schedule .posting-accounts');
      const cards = [...root.querySelectorAll('.posting-card:not([hidden])')];
      const columns = getComputedStyle(root).gridTemplateColumns.split(' ').length;
      const allEditable = cards.every(card => !card.querySelector('.posting-programming').hidden);
      window.applyStudioState(original);
      return { cards: cards.length, columns, allEditable };
    })()`);
    assert.deepEqual(grid, { cards: 3, columns: 3, allEditable: true });
    window.setSize(600, 760);
    await new Promise(resolve => setTimeout(resolve, 120));
    const compactOverflow = await window.webContents.executeJavaScript('document.documentElement.scrollWidth > document.documentElement.clientWidth');
    assert.equal(compactOverflow, false);
    console.log('Postings UI: fixed daily schedule passed.');
  } catch (error) { console.error('Postings UI failed:', error.message); process.exitCode = 1; }
  finally { window.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error.message); app.exit(1); });
