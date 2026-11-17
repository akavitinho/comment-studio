function authorizationCode(callbackUrl, redirectUri, expectedState, expiresAt) {
  if (typeof callbackUrl !== 'string' || callbackUrl.length > 8192) throw new Error('Cole a URL completa de retorno do login.');
  let actual, expected;
  try { actual = new URL(callbackUrl.trim()); expected = new URL(redirectUri); }
  catch { throw new Error('URL de retorno inválida. Copie a barra de endereço completa do Dolphin.'); }
  if (actual.protocol !== 'https:' || actual.username || actual.password || actual.origin !== expected.origin || actual.pathname !== expected.pathname) throw new Error('A URL não corresponde ao retorno configurado para este login.');
  if (actual.searchParams.getAll('state').length !== 1 || actual.searchParams.get('state') !== expectedState) throw new Error('Este retorno pertence a outro login. Copie o link gerado para esta conta.');
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline) || Date.now() >= deadline) throw new Error('O link de conexão expirou. Gere um novo link.');
  const code = actual.searchParams.get('code');
  if (!code || !/^[A-Za-z0-9_-]{8,4096}$/.test(code)) throw new Error('O retorno ainda não contém um código de autorização válido. Termine o login no Dolphin.');
  return code;
}
module.exports = { authorizationCode };
