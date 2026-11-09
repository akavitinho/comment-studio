// Public OAuth return page. The desktop app intercepts this URL before navigation.
// It never receives or stores the authorization code or app secret.
Deno.serve((request: Request) => {
  if (request.method !== 'GET') {
    return new Response('Not found', { status: 404 });
  }
  return new Response('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Comment Studio</title><body><h1>Volte ao Comment Studio</h1><p>O retorno do login foi recebido. Se o aplicativo não continuar, feche esta página e tente novamente.</p></body></html>', {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
