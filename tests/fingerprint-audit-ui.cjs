const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const { stealthPatchSource } = require('../src/stealth-preload.cjs');

app.setPath('userData', path.join(__dirname, '..', '.smoke', 'fingerprint-audit-ui'));
app.whenReady().then(async () => {
  let win;
  try {
    const ses = session.fromPartition('persist:fingerprint-audit-ui');
    ses.setUserAgent(ses.getUserAgent().replace(/ Electron\/[\d.]+/g, ''));
    win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('dom-ready', () => { void win.webContents.executeJavaScript(stealthPatchSource()); });
    await win.loadFile(path.join(__dirname, '..', 'src', 'ui', 'fingerprint-audit.html'));
    await new Promise(resolve => setTimeout(resolve, 500));
    const result = await win.webContents.executeJavaScript(`({
      app: Boolean(window.chrome?.app), csi: typeof window.chrome?.csi,
      loadTimes: typeof window.chrome?.loadTimes,
      summary: document.querySelector('#summary').textContent,
      differences: [...document.querySelectorAll('#results .test:has(.fail)')].map(row => row.textContent.trim())
    })`);
    assert.deepEqual({ app: result.app, csi: result.csi, loadTimes: result.loadTimes }, { app: true, csi: 'function', loadTimes: 'function' });
    assert.doesNotMatch(result.summary, /softban|falha.s. crítica/i);
    assert.deepEqual(result.differences, []);
    console.log('Fingerprint audit: partial chrome object completed; summary calibrated.', result.differences);
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win?.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error); app.exit(1); });
