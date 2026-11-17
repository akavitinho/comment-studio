const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { preload: path.join(__dirname, 'postings-ui-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = () => new Promise(resolve => setTimeout(resolve, 80));
      await wait();
      document.querySelector('[data-page=postings]').click();
      const next = await window.studio.addAccount({ platform: 'instagram', handle: 'segundo', name: 'Segundo' });
      const second = next.accounts.find(account => account.handle === 'segundo');
      window.applyStudioState(await window.studio.addPostingVideo({ accountId: second.id, file: 'segundo.mp4', caption: '' }));
      const form = document.querySelector('#posting-caption-form');
      const text = document.querySelector('#posting-caption-text');
      const mode = document.querySelector('#posting-caption-mode');
      const scope = document.querySelector('#posting-caption-scope');
      const apply = document.querySelector('#posting-caption-apply');
      const set = (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); };
      const counts = () => document.querySelector('#posting-caption-targets').textContent;
      const captions = async () => Object.fromEntries((await window.studio.state()).postings.items.map(item => [item.id, item.caption]));
      document.querySelector('#posting-bulk-caption').open = true;
      const emptyDisabled = apply.disabled;
      set(text, 'Legenda igual 🎬\\n#reels');
      const allCount = counts();
      set(mode, 'empty');
      const emptyCount = counts();
      form.requestSubmit(); await wait();
      const first = await captions();
      const emptyResult = document.querySelector('#posting-caption-feedback').textContent;
      set(mode, 'replace');
      set(scope, 'selected');
      // Select just the original account using the actual account filter.
      document.querySelector('#posting-account-filter').open = true;
      for (const choice of document.querySelectorAll('#posting-account-choices input[type=checkbox]')) {
        if (choice.checked !== (choice.value === 'ig-test')) choice.click();
      }
      const selectedCount = counts();
      set(text, 'Somente selecionada');
      form.requestSubmit(); await wait();
      const selected = await captions();
      set(scope, 'all'); set(text, 'Final para todos');
      form.requestSubmit(); await wait();
      const final = await captions();
      const feedback = document.querySelector('#posting-caption-feedback').textContent;
      set(text, '   ');
      return { emptyDisabled, allCount, emptyCount, first, emptyResult, selectedCount, selected, final, feedback, blankDisabled: apply.disabled, secondItem: Object.keys(final).find(id => !['video-1', 'video-attention', 'video-published', 'old-shared-uncertain'].includes(id)) };
    })()`);
    assert.equal(result.emptyDisabled, true);
    assert.match(result.allCount, /^2 vídeos/);
    assert.match(result.emptyCount, /^1 vídeo/);
    assert.equal(result.first['video-1'], 'Legenda de teste');
    assert.equal(result.first[result.secondItem], 'Legenda igual 🎬\n#reels');
    assert.equal(result.emptyResult, 'Legenda aplicada a 1 vídeo.');
    assert.match(result.selectedCount, /^1 vídeo/);
    assert.equal(result.selected['video-1'], 'Somente selecionada');
    assert.equal(result.selected[result.secondItem], result.first[result.secondItem]);
    assert.equal(result.final['video-1'], 'Final para todos');
    assert.equal(result.final[result.secondItem], 'Final para todos');
    assert.equal(result.final['video-attention'], 'Outra legenda');
    assert.equal(result.final['video-published'], 'Publicado');
    assert.equal(result.feedback, 'Legenda aplicada a 2 vídeos.');
    assert.equal(result.blankDisabled, true);
    console.log('Legenda em lote: todas, selecionadas, sem legenda e estados protegidos OK.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error); app.exit(1); });
