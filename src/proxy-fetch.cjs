function createProxyFetch(net, connection) {
  return async (input, init = {}) => {
    const source = new Request(input, init);
    const request = net.request({ method: source.method, url: source.url, session: connection.ses, redirect: 'error', cache: 'no-store' });
    for (const [key, value] of source.headers) request.setHeader(key, value);
    request.on('login', (info, callback) => {
      if (connection.credentials && info.isProxy && connection.proxy && info.host.toLowerCase() === connection.proxy.host.toLowerCase() && info.port === connection.proxy.port) callback(connection.credentials.username, connection.credentials.password);
      else callback();
    });
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => { request.abort(); reject(new Error('Tempo limite da conexão da conta.')); }, 60000);
      request.on('response', response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) request.abort(); else chunks.push(chunk); });
        response.on('end', () => { clearTimeout(timer); const headers = new Headers(); for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, String(value)); resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers })); });
      });
      request.on('error', () => { clearTimeout(timer); reject(new Error(connection.proxy ? 'Conexão pelo proxy da conta falhou. Confira o proxy.' : 'Conexão direta da conta falhou.')); });
      try { const body = await source.arrayBuffer(); if (body.byteLength) request.write(Buffer.from(body)); request.end(); }
      catch { clearTimeout(timer); request.abort(); reject(new Error('Não foi possível preparar a solicitação.')); }
    });
  };
}
module.exports = { createProxyFetch };
