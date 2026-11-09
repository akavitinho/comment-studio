const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1280, height: 820, webPreferences: { preload: path.join(__dirname, 'postings-ui-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  try {
    await window.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      const added = await window.studio.addAccount({ platform: 'instagram', handle: 'segundo.perfil', name: 'segundo.perfil', proxyId: '' });
      const second = added.accounts.find(account => account.handle === 'segundo.perfil');
      await window.studio.savePostingSchedules({ accountIds: ['ig-test', second.id], config: (await window.studio.state()).postings.schedules[0].config });
      window.applyStudioState(await window.studio.addPostingVideo({ accountId: second.id, file: 'C:\\Videos\\segundo-reel.mp4', caption: '' }));
      document.querySelector('[data-page=accounts]').click();
      const chips = [...document.querySelectorAll('.account-queue-chip')].map(chip => chip.textContent);
      const play = document.querySelector('.account-card[data-account-id="ig-test"] .account-queue-play')?.getAttribute('aria-label');
      document.querySelector('[data-page=postings]').click();
      const before = { label: document.querySelector('#posting-queue-ready').textContent, disabled: document.querySelector('#posting-start-all').disabled };
      document.querySelector('#posting-start-all').click();
      await new Promise(resolve => setTimeout(resolve, 80));
      return { chips, play, before, statuses: (await window.studio.state()).postings.schedules.map(schedule => schedule.status), feedback: document.querySelector('#posting-feedback').textContent, disabled: document.querySelector('#posting-start-all').disabled };
    })()`);
    assert.deepEqual(result.chips, ['1 vídeo na fila', '1 vídeo na fila']);
    assert.equal(result.play, 'Iniciar fila de @perfil.teste');
    assert.deepEqual(result.before, { label: '2 contas com filas pendentes', disabled: false });
    assert.deepEqual(result.statuses, ['running', 'running']);
    assert.match(result.feedback, /2 filas iniciadas/);
    assert.equal(result.disabled, true);
    console.log('Fila coletiva e sinalização em Contas: OK.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error); app.exit(1); });
