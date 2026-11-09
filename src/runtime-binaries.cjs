const fs = require('node:fs');
const path = require('node:path');

function binaryPath(name) {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  const bundled = path.join(process.resourcesPath || '', 'bin', file);
  return fs.existsSync(bundled) ? bundled : name;
}

module.exports = { binaryPath };
