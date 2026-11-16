'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const tls = require('node:tls');
const net = require('node:net');
const { TlsProxy } = require('../src/tls-proxy.cjs');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-utls-live-'));
  const proxy = new TlsProxy({ dataDir, helperPath: path.join(__dirname, '..', 'vendor', 'tls-helper.exe') });
  let upstream;
  try {
    assert.equal(await proxy.init(), true);
    if (process.env.TLS_LIVE_UPSTREAM === '1') {
      upstream = http.createServer();
      upstream.on('connect', (request, client, head) => {
        const remote = net.connect(443, 'example.com', () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) remote.write(head);
          client.pipe(remote).pipe(client);
        });
        remote.on('error', () => client.destroy());
      });
      await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    }
    const info = await proxy.allocate('account-live', { upstream: upstream && {
      protocol: 'http', host: '127.0.0.1', port: upstream.address().port
    } });
    assert.match(info.profile, /^chrome-/);
    const status = await new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: info.port, method: 'CONNECT',
        path: 'example.com:443', timeout: 20000 });
      request.once('connect', (response, socket) => {
        assert.equal(response.statusCode, 200);
        const secure = tls.connect({ socket, servername: 'example.com', ca: proxy.caCert,
          ALPNProtocols: ['http/1.1'] });
        secure.setTimeout(20000, () => secure.destroy(new Error('Response timeout')));
        secure.once('secureConnect', () => {
          assert.equal(secure.authorized, true);
          secure.write('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
        });
        let header = '';
        secure.on('data', chunk => {
          header += chunk.toString('utf8');
          if (header.includes('\r\n')) { resolve(header.split('\r\n')[0]); secure.destroy(); }
        });
        secure.once('error', reject);
      });
      request.once('error', reject);
      request.end();
    });
    assert.match(status, /^HTTP\/1\.1 200 /);
    console.log(`${info.profile}: ${status}`);
  } finally {
    proxy.stop();
    upstream?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
