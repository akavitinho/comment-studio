(function (root) {
  function parseProxyLine(value) {
    const line = String(value || '').trim();
    const match = /^([^:\s/]+):(\d+)(?::([^:\r\n]+):([^\r\n]+))?$/.exec(line);
    if (!match || !/^[a-zA-Z0-9.-]+$/.test(match[1]) || match[1].includes('..') || match[1].startsWith('.') || match[1].endsWith('.')) {
      throw new Error('Use IP:porta:usuário:senha ou IP:porta.');
    }
    const port = Number(match[2]);
    if (port < 1 || port > 65535) throw new Error('A porta deve estar entre 1 e 65535.');
    return { host: match[1].toLowerCase(), port, username: match[3] || '', password: match[4] || '' };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseProxyLine };
  else root.parseProxyLine = parseProxyLine;
})(globalThis);
