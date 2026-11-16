'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const tls = require('node:tls');
const { TlsProxy } = require('../src/tls-proxy.cjs');

test('TLS proxy creates a private CA and trusts only its own leaf certificate', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-tls-'));
  const proxy = new TlsProxy({ dataDir });
  t.after(() => { proxy.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  if (!proxy.available) return t.skip('OpenSSL is unavailable');
  assert.equal(await proxy.init(), true);
  const leaf = proxy._certificate('example.test');
  const other = proxy._certificate('other.test');
  assert.ok(fs.existsSync(proxy.caKeyPath));
  if (process.platform !== 'win32') assert.equal(fs.statSync(proxy.caKeyPath).mode & 0o777, 0o600);
  const decisions = [];
  proxy.verifyCertificate({ hostname: 'example.test', certificate: { data: leaf.cert } }, value => decisions.push(value));
  proxy.verifyCertificate({ hostname: 'example.test', certificate: { data: other.cert } }, value => decisions.push(value));
  proxy.verifyCertificate({ hostname: 'unknown.test', certificate: { data: leaf.cert } }, value => decisions.push(value));
  assert.deepEqual(decisions, [0, -3, -3]);
  const allocated = await proxy.allocate('account-1');
  assert.match(proxy.proxyRules('account-1'), new RegExp(`:${allocated.port}$`));
  assert.equal((await proxy.allocate('account-1')).port, allocated.port);
  const origin = http.createServer((_request, response) => response.end('ok'));
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  t.after(() => origin.close());
  const body = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: allocated.port,
      path: `http://127.0.0.1:${origin.address().port}/`, agent: false }, response => {
      let value = '';
      response.on('data', chunk => { value += chunk; });
      response.on('end', () => resolve(value));
    }).on('error', reject);
  });
  assert.equal(body, 'ok');
  const upstream = http.createServer();
  upstream.on('connect', (_request, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.on('data', () => {}); // receive the origin-facing ClientHello
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const intercepted = await proxy.allocate('account-3', { upstream: {
    protocol: 'http', host: '127.0.0.1', port: upstream.address().port
  } });
  await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: intercepted.port,
      method: 'CONNECT', path: 'example.test:443', timeout: 5000 });
    request.on('connect', (_response, socket) => {
      const secure = tls.connect({ socket, servername: 'example.test', ca: proxy.caCert,
        ALPNProtocols: ['http/1.1'] });
      secure.once('secureConnect', () => { assert.equal(secure.authorized, true); secure.destroy(); resolve(); });
      secure.once('error', reject);
    });
    request.once('error', reject);
    request.end();
  });
  proxy.deallocate('account-1');
  assert.equal(proxy.proxyRules('account-1'), null);
});
