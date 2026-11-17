const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'postings-ui-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'ui', 'index.html'));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const state = await window.studio.state();
      state.accounts.push({ id: 'fb-test', platform: 'facebook', name: 'Página de teste', facebookPageId: '123', proxyId: null, facebook: { connected: true, insightsGranted: true } });
      state.postings.schedules.push({ account_id: 'fb-test', status: 'paused', next_at: null, config: { mode: 'fixed', times: ['16:00'], variationMinutes: 0, timeZone: 'America/Sao_Paulo' } });
      state.postings.items.push({ id: 'fb-post', account_id: 'fb-test', file: '', caption: 'Texto de teste', content_type: 'text', status: 'queued' });
      state.facebookMetrics = [{ account_id: 'fb-test', media_views: 10, unique_viewers: 8, fetched_at: new Date().toISOString() }];
      window.applyStudioState(state);
      document.querySelector('[data-platform=facebook] button').click();
      const dashboard = !document.querySelector('[data-panel=facebook-dashboard]').hidden && document.querySelector('#facebook-dashboard-pages').textContent.includes('10');
      document.querySelector('[data-page=postings]').click();
      const postings = !document.querySelector('[data-panel=facebook-postings]').hidden && document.querySelector('#facebook-queues').textContent.includes('Texto de teste') && document.querySelector('#facebook-compose [name=accountId]').value === 'fb-test';
      const loginProxy = document.querySelector('#facebook-login-proxy'); loginProxy.value = 'proxy-test'; loginProxy.dispatchEvent(new Event('change'));
      const postingConnection = document.querySelector('#facebook-posting-connection'); postingConnection.value = 'direct';
      const routeChoice = !postingConnection.querySelector('[value=proxy]').disabled && postingConnection.value === 'direct';
      document.querySelector('[data-platform=instagram] button').click(); document.querySelector('[data-page=postings]').click();
      const handoff = document.querySelector('[data-panel=postings]').textContent.includes('Postar no Facebook');
      return { dashboard, postings, handoff, routeChoice };
    })()`);
    assert.deepEqual(result, { dashboard: true, postings: true, handoff: true, routeChoice: true });
    console.log('Facebook navigation and independent queue passed.');
  } catch (error) { console.error('Facebook UI failed:', error); process.exitCode = 1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error); app.exit(1); });
