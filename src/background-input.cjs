// Input is delivered to this webContents only; no OS focus or remote debugging port.
async function command(win, method, params) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) throw new Error('A janela da conta foi fechada.');
  const channel = win.webContents.debugger;
  if (!channel.isAttached()) channel.attach('1.3');
  let timer;
  try {
    return await Promise.race([
      channel.sendCommand(method, params),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('O navegador não respondeu à ação em segundo plano.')), 8000); })
    ]);
  } finally { clearTimeout(timer); }
}
async function click(win, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0) throw new Error('Controle fora da área do navegador.');
  const params = { x: point.x, y: point.y, button: 'left', clickCount: 1 };
  await command(win, 'Input.dispatchMouseEvent', { ...params, type: 'mousePressed', buttons: 1 });
  await command(win, 'Input.dispatchMouseEvent', { ...params, type: 'mouseReleased', buttons: 0 });
}
async function insertText(win, text) {
  await command(win, 'Input.insertText', { text });
}
async function pressKey(win, key, keyCode) {
  const params = { key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await command(win, 'Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' });
  await command(win, 'Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
}
module.exports = { click, insertText, pressKey };
