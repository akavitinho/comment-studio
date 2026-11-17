const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function run({ mainWindow, handlers, dataDir }) {
  const evaluate = code => mainWindow.webContents.executeJavaScript(code);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const settled = async () => {
    for (let i = 0; i < 100; i++) { await wait(50); if (await evaluate(`!document.querySelector('#creator-new').disabled`)) return; }
    throw new Error('Creator operation timed out');
  };
  await evaluate(`document.querySelector('[data-platform="instagram"] button').click(); document.querySelector('[data-page="creator"]').click()`);
  assert.equal(await evaluate(`!document.querySelector('[data-panel="creator"]').hidden`), true);
  await evaluate(`document.querySelector('#creator-generate').click()`); await settled();
  assert.equal(await evaluate(`document.querySelector('#creator-form [name="fullName"]').value.length > 0 && document.querySelector('#creator-password').type === 'password'`), true);
  await evaluate(`document.querySelector('#creator-save').click()`); await settled();
  const account = handlers.state().accounts.find(item => item.registration);
  assert.ok(account, await evaluate(`document.querySelector('#creator-feedback').textContent`));
  assert.equal(account.registration.status, 'draft'); assert.equal(account.creatorSecret, undefined);
  await evaluate(`document.querySelector('#creator-save').click()`); await settled();
  assert.equal(handlers.state().accounts.filter(item => item.registration).length, 1);
  await evaluate(`document.querySelector('#creator-open').click()`); await settled();
  const opened = handlers.state().accounts.find(item => item.id === account.id);
  assert.equal(opened.registration.status, 'awaiting');
  assert.equal(opened.browserOpen, true, 'registration opens in Navegador livre');
  assert.equal(opened.open, false, 'registration does not open the automation window');
  const browsers = () => require('electron').BrowserWindow.getAllWindows().filter(win => win.webContents.getURL().endsWith('/free-browser.html'));
  const [browser] = browsers();
  assert.ok(browser);
  const countTabs = () => browser.webContents.executeJavaScript(`document.querySelectorAll('#tabs [role="tab"]').length`);
  assert.equal(await countTabs(), 1);
  await handlers.openAccountBrowser(account.id);
  assert.equal(browsers().length, 1, 'opening the account can focus the existing browser');
  await evaluate(`document.querySelector('#creator-open').click()`); await settled();
  assert.equal(browsers().length, 2, 'opening signup again creates another browser window');
  assert.equal(await countTabs(), 1, 'the previous browser keeps its own tab');
  assert.equal(await evaluate(`!document.querySelector('#creator-completion').hidden && document.querySelector('#creator-complete').disabled`), true);
  await handlers.closeAccountBrowser(account.id);
  assert.equal(handlers.state().accounts.find(item => item.id === account.id).browserOpen, false);
  mainWindow.setSize(1320, 1000); await wait(150);
  fs.writeFileSync(path.join(dataDir, 'instagram-creator.png'), (await mainWindow.webContents.capturePage()).toPNG());
  for (const width of [1000, 760, 560]) {
    mainWindow.setSize(width, 900); await wait(100);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, `creator no overflow at ${width}`);
    if (width === 560) fs.writeFileSync(path.join(dataDir, 'instagram-creator-compact.png'), (await mainWindow.webContents.capturePage()).toPNG());
  }
  mainWindow.setSize(1320, 920);
  await evaluate(`document.querySelector('#creator-new').click(); document.querySelector('#creator-list button').click()`); await settled();
  assert.equal(await evaluate(`document.querySelector('#creator-password').value.length === 18 && document.querySelector('#creator-password').type === 'password'`), true, 'encrypted password resumes through IPC');
  await evaluate(`document.querySelector('#creator-confirm').click(); document.querySelector('#creator-complete').click()`); await settled();
  assert.equal(handlers.state().accounts.find(item => item.id === account.id).registration.status, 'completed');
  assert.equal(await evaluate(`document.querySelector('#creator-password').value`), '');
  await evaluate(`document.querySelector('#creator-list button').click()`);
  await evaluate(`Array.from(document.querySelectorAll('#account-list .account-more-menu button')).find(button => button.textContent === 'Dados do cadastro').click()`);
  for (let i = 0; i < 50 && await evaluate(`document.querySelector('#instagram-registration-fields').hidden`); i++) await wait(50);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#instagram-registration-fields input'), field => ({ type: field.type, length: field.value.length }))`), [
    { type: 'text', length: account.name.length }, { type: 'text', length: account.handle.length },
    { type: 'text', length: 0 }, { type: 'password', length: 18 }, { type: 'text', length: 10 }
  ]);
  await evaluate(`document.querySelector('#instagram-registration-details button[aria-pressed]').click()`);
  assert.equal(await evaluate(`document.querySelector('#instagram-registration-details button[aria-pressed]').getAttribute('aria-pressed')`), 'true');
  await evaluate(`document.querySelector('#instagram-registration-details').close()`); await wait(100);
  assert.equal(await evaluate(`document.querySelector('#instagram-registration-fields').childElementCount`), 0);
  await evaluate(`document.querySelector('[data-platform="tiktok"] button').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-page="creator"]').hidden && document.querySelector('[data-panel="creator"]').hidden`), true);
  await handlers.deleteAccount(account.id);
  await evaluate(`(async () => { window.applyStudioState(await window.studio.state()); document.querySelector('[data-platform="instagram"] button').click(); })()`);
}
module.exports = { run };
