'use strict';
const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

class UtlsBridge {
  constructor(binary) {
    this.binary = binary;
    this.token = crypto.randomBytes(32).toString('hex');
    this.child = null;
    this.port = null;
    this.starting = null;
  }

  get available() { return Boolean(this.binary && fs.existsSync(this.binary)); }

  start() {
    if (this.port) return Promise.resolve(this.port);
    if (this.starting) return this.starting;
    if (!this.available) return Promise.resolve(null);
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(this.binary, [], {
        windowsHide: true, stdio: ['ignore', 'pipe', process.env.COMMENT_STUDIO_TLS_DEBUG === '1' ? 'inherit' : 'ignore'],
        env: { ...process.env, COMMENT_STUDIO_TLS_TOKEN: this.token }
      });
      this.child = child;
      let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('uTLS helper startup timeout')); }, 10000);
      const fail = error => { clearTimeout(timer); this.child = null; reject(error); };
      child.once('error', fail);
      child.once('exit', code => {
        this.port = null;
        if (this.child === child) this.child = null;
        if (this.starting) fail(new Error(`uTLS helper exited (${code})`));
      });
      child.stdout.on('data', chunk => {
        output += chunk.toString('utf8');
        if (output.length > 128) { child.kill(); fail(new Error('Invalid uTLS helper output')); return; }
        const match = /^READY (\d+)\r?\n/.exec(output);
        if (!match) return;
        clearTimeout(timer);
        this.port = Number(match[1]);
        resolve(this.port);
      });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async connect(target, upstream, profile) {
    const port = await this.start();
    if (!port) throw new Error('uTLS helper indisponível.');
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1');
      const timer = setTimeout(() => socket.destroy(new Error('uTLS handshake timeout')), 25000);
      let response = '';
      const fail = error => { clearTimeout(timer); socket.destroy(); reject(error); };
      socket.once('error', fail);
      socket.once('close', () => fail(new Error('uTLS handshake failed')));
      socket.once('connect', () => socket.write(JSON.stringify({ token: this.token, host: target.host,
        port: target.port, profile, upstream }) + '\n'));
      const read = chunk => {
        response += chunk.toString('latin1');
        if (response.length > 1024) { fail(new Error('Invalid uTLS response')); return; }
        const end = response.indexOf('\n');
        if (end < 0) return;
        if (response.slice(0, end) !== 'OK') { fail(new Error(`uTLS connection failed: ${response.slice(0, end)}`)); return; }
        clearTimeout(timer);
        socket.off('data', read);
        socket.off('error', fail);
        socket.removeAllListeners('close');
        const remaining = Buffer.from(response.slice(end + 1), 'latin1');
        if (remaining.length) socket.unshift(remaining);
        resolve(socket);
      };
      socket.on('data', read);
    });
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.port = null;
  }
}

module.exports = { UtlsBridge };
