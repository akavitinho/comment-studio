const assert = require('node:assert/strict');
const { BrowserWindow } = require('electron');
const input = require('../src/background-input.cjs');
exports.run = async () => {
  const win = new BrowserWindow({ show: false, width: 600, height: 400, webPreferences: { backgroundThrottling: false, sandbox: true, nodeIntegration: false, contextIsolation: true } });
  try {
    await win.loadURL('data:text/html,' + encodeURIComponent('<input id="editor" onkeydown="document.body.dataset.key=event.key" style="position:absolute;left:20px;top:20px;width:220px;height:40px"><button style="position:absolute;left:20px;top:100px;width:150px;height:40px" onclick="document.body.dataset.clicked=\'yes\'">Confirmar</button>'));
    for (const mode of ['hidden', 'minimized']) {
      if (mode === 'minimized') { win.showInactive(); win.minimize(); await new Promise(resolve => setTimeout(resolve, 300)); }
      const focused = BrowserWindow.getFocusedWindow();
      await input.click(win, { x: 50, y: 40 });
      await input.insertText(win, mode);
      await input.pressKey(win, 'ArrowDown', 40);
      await input.click(win, { x: 50, y: 120 });
      assert.equal(await win.webContents.executeJavaScript('document.querySelector("input").value'), mode);
      assert.equal(await win.webContents.executeJavaScript('document.body.dataset.clicked'), 'yes');
      assert.equal(await win.webContents.executeJavaScript('document.body.dataset.key'), 'ArrowDown');
      assert.equal(BrowserWindow.getFocusedWindow(), focused, 'input must not steal OS focus');
      if (mode === 'hidden') assert.equal(win.isVisible(), false);
      else assert.equal(win.isMinimized(), true);
      await win.webContents.executeJavaScript('document.querySelector("input").value="";delete document.body.dataset.clicked');
    }
  } finally { win.destroy(); }
};
