const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

function binaryPath(name) {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  const bundled = process.resourcesPath && path.join(process.resourcesPath, 'bin', file);
  if (bundled && fs.existsSync(bundled)) return bundled;

  const staged = path.join(__dirname, '..', 'build', 'runtime', file);
  if (fs.existsSync(staged)) return staged;

  if (electron.app?.isPackaged) {
    throw new Error(`${file} não foi encontrado na instalação do Comment Studio. Reinstale o aplicativo com o instalador completo.`);
  }
  return name;
}

module.exports = { binaryPath };
