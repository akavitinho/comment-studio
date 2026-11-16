'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const source = path.join(root, 'go', 'tls-helper');
const output = path.join(root, 'vendor', process.platform === 'win32' ? 'tls-helper.exe' : 'tls-helper');
const go = process.env.GO_BIN || 'go';

try {
  execFileSync(go, ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'],
    { cwd: source, stdio: 'inherit', windowsHide: true });
  console.log(`uTLS helper built: ${output}`);
} catch (error) {
  console.error('Não foi possível compilar o helper uTLS. Instale Go ou informe GO_BIN com o caminho do go.exe.');
  process.exitCode = error.status || 1;
}
