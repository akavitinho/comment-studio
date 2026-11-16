'use strict';

// HTTPS CONNECT interception for account browser sessions. The Go helper uses
// uTLS for the origin-facing ClientHello; OpenSSL remains a fallback.
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { UtlsBridge } = require('./utls-bridge.cjs');

const TLS_PROFILES = [
  { id: 'chrome-120', ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256' },
  { id: 'chrome-131', ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384' },
  { id: 'chrome-133', ciphers: 'TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305' }
];

function findOpenSSL() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe', 'C:\\Program Files (x86)\\Git\\mingw64\\bin\\openssl.exe', 'openssl']
    : ['openssl'];
  for (const candidate of candidates) {
    try { execFileSync(candidate, ['version'], { stdio: 'pipe', timeout: 5000 }); return candidate; }
    catch { /* try the next installation */ }
  }
  return null;
}

function authority(value) {
  const match = /^([^:\s/]+):(\d{1,5})$/.exec(value || '');
  if (!match || !/^[a-z0-9.-]+$/i.test(match[1]) || match[1].includes('..')) return null;
  const port = Number(match[2]);
  return port >= 1 && port <= 65535 ? { host: match[1].toLowerCase(), port } : null;
}

class TlsProxy {
  constructor({ dataDir, helperPath = null, openssl = findOpenSSL() }) {
    this.caDir = path.join(dataDir, 'tls-proxy-ca');
    this.caKeyPath = path.join(this.caDir, 'ca.key');
    this.caCertPath = path.join(this.caDir, 'ca.crt');
    this.openssl = openssl;
    this.bridge = new UtlsBridge(helperPath);
    this.certCache = new Map();
    this.accounts = new Map();
    this.caCert = null;
  }

  get available() { return Boolean(this.openssl); }

  async init() {
    if (!this.available) return false;
    fs.mkdirSync(this.caDir, { recursive: true });
    if (!fs.existsSync(this.caKeyPath) || !fs.existsSync(this.caCertPath)) {
      execFileSync(this.openssl, ['req', '-new', '-x509', '-nodes', '-days', '3650',
        '-keyout', this.caKeyPath, '-out', this.caCertPath, '-subj', '/CN=Comment Studio Local CA',
        '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
        '-addext', 'basicConstraints=critical,CA:TRUE',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'pipe', timeout: 15000 });
    }
    fs.chmodSync(this.caKeyPath, 0o600);
    this.caCert = fs.readFileSync(this.caCertPath, 'utf8');
    return true;
  }

  _certificate(host) {
    const cached = this.certCache.get(host);
    if (cached && cached.expires > Date.now()) return cached;
    const work = fs.mkdtempSync(path.join(this.caDir, 'cert-'));
    try {
      const keyPath = path.join(work, 'key.pem');
      const csrPath = path.join(work, 'request.pem');
      const certPath = path.join(work, 'cert.pem');
      const extPath = path.join(work, 'extensions.txt');
      const san = net.isIP(host) ? `IP:${host}` : `DNS:${host}`;
      fs.writeFileSync(extPath, `basicConstraints=critical,CA:FALSE\nsubjectAltName=${san}\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`);
      execFileSync(this.openssl, ['req', '-new', '-nodes', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
        '-keyout', keyPath, '-out', csrPath, '-subj', `/CN=${host}`], { stdio: 'pipe', timeout: 10000 });
      execFileSync(this.openssl, ['x509', '-req', '-in', csrPath, '-CA', this.caCertPath, '-CAkey', this.caKeyPath,
        '-CAcreateserial', '-days', '2', '-extfile', extPath, '-out', certPath], { stdio: 'pipe', timeout: 10000 });
      const key = fs.readFileSync(keyPath, 'utf8');
      const cert = fs.readFileSync(certPath, 'utf8');
      const result = { cert, context: tls.createSecureContext({ key, cert: cert + this.caCert }), expires: Date.now() + 24 * 3600 * 1000 };
      this.certCache.set(host, result);
      return result;
    } finally { fs.rmSync(work, { recursive: true, force: true }); }
  }

  // Trust only the exact leaf certificate created for this host. Other Chromium
  // verification results remain untouched, including a revoked remote cert.
  verifyCertificate(request, callback) {
    const cached = this.certCache.get(request.hostname?.toLowerCase());
    if (cached && cached.expires > Date.now() && request.certificate?.data) {
      try {
        if (new crypto.X509Certificate(request.certificate.data).raw.equals(new crypto.X509Certificate(cached.cert).raw)) {
          callback(0); return;
        }
      } catch { /* leave Chromium's result in place */ }
    }
    callback(-3);
  }

  async allocate(key, { upstream = null } = {}) {
    if (!this.caCert) throw new Error('TLS proxy não inicializado.');
    if (this.accounts.has(key)) return this.accounts.get(key);
    const profile = TLS_PROFILES[crypto.createHash('sha256').update(key).digest()[0] % TLS_PROFILES.length];
    const useUtls = this.bridge.available && Boolean(await this.bridge.start());
    const sockets = new Set();
    const server = http.createServer((req, res) => this._http(req, res, upstream));
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.on('connect', (req, client, head) => { void this._connect(req, client, head, profile, upstream, useUtls); });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
    } catch (error) { server.close(); throw error; }
    const info = { server, sockets, port: server.address().port, profile: useUtls ? profile.id : `openssl-${profile.id}` };
    this.accounts.set(key, info);
    return info;
  }

  async _connect(req, client, head, profile, upstream, useUtls) {
    const target = authority(req.url);
    if (!target || target.port !== 443) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    let remote;
    try {
      const leaf = this._certificate(target.host);
      remote = useUtls ? await this.bridge.connect(target, upstream, profile.id) : await this._tunnel(target, upstream);
      if (client.destroyed) { remote.destroy(); return; }
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) client.unshift(head);
      const localTLS = new tls.TLSSocket(client, { isServer: true, secureContext: leaf.context, ALPNProtocols: ['http/1.1'] });
      const destination = useUtls ? remote : tls.connect({ socket: remote,
        servername: net.isIP(target.host) ? undefined : target.host,
        ciphers: profile.ciphers, minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'], rejectUnauthorized: true });
      localTLS.on('error', () => destination.destroy());
      destination.on('error', () => localTLS.destroy());
      localTLS.on('close', () => destination.destroy());
      destination.on('close', () => localTLS.destroy());
      localTLS.pipe(destination).pipe(localTLS);
    } catch { remote?.destroy(); if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); }
  }

  _http(req, res, upstream) {
    let url;
    try { url = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
    if (url.protocol !== 'http:') { res.writeHead(400); res.end(); return; }
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const viaProxy = upstream && ['http', 'https'].includes(upstream.protocol);
    const transport = viaProxy && upstream.protocol === 'https' ? require('node:https') : http;
    if (viaProxy && upstream.username) headers['proxy-authorization'] = 'Basic ' + Buffer.from(`${upstream.username}:${upstream.password || ''}`).toString('base64');
    const options = viaProxy
      ? { host: upstream.host, port: upstream.port, path: url.href, method: req.method, headers }
      : { host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers };
    const outgoing = transport.request(options, incoming => { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); });
    outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    outgoing.setTimeout(15000, () => outgoing.destroy(new Error('HTTP timeout')));
    req.pipe(outgoing);
  }

  _tunnel(target, upstream) {
    if (!upstream) return new Promise((resolve, reject) => {
      const socket = net.connect(target.port, target.host);
      socket.once('connect', () => { socket.setTimeout(0); resolve(socket); });
      socket.once('error', reject);
      socket.setTimeout(15000, () => socket.destroy(new Error('Connection timeout')));
    });
    if (!['http', 'https'].includes(upstream.protocol)) throw new Error('Tipo de proxy upstream incompatível.');
    const requestModule = upstream.protocol === 'https' ? require('node:https') : http;
    return new Promise((resolve, reject) => {
      const headers = { Host: `${target.host}:${target.port}` };
      if (upstream.username) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${upstream.username}:${upstream.password || ''}`).toString('base64');
      const request = requestModule.request({ host: upstream.host, port: upstream.port, method: 'CONNECT',
        path: `${target.host}:${target.port}`, headers, timeout: 15000 });
      request.on('connect', (response, socket, head) => {
        if (response.statusCode !== 200) { socket.destroy(); reject(new Error(`Upstream CONNECT: ${response.statusCode}`)); return; }
        if (head.length) socket.unshift(head);
        socket.setTimeout(0);
        resolve(socket);
      });
      request.on('timeout', () => request.destroy(new Error('Upstream timeout')));
      request.on('error', reject);
      request.end();
    });
  }

  proxyRules(key) {
    const info = this.accounts.get(key);
    return info ? `http://127.0.0.1:${info.port}` : null;
  }

  deallocate(key) {
    const info = this.accounts.get(key);
    if (!info) return;
    this.accounts.delete(key);
    for (const socket of info.sockets) socket.destroy();
    info.server.close();
  }

  stop() { for (const key of [...this.accounts.keys()]) this.deallocate(key); this.bridge.stop(); }
}

module.exports = { TlsProxy, TLS_PROFILES };
