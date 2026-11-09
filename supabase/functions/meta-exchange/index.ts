// Exchange a one-time Facebook Login code on the server. Tokens are returned
// directly to the desktop installation and are never stored by this function.
import { createClient } from 'npm:@supabase/supabase-js@2';
const APP_ID = Deno.env.get('CLUBXONE_APP_ID') || '';
const REDIRECT_URI = `${Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')}/functions/v1/meta-callback`;
const GRAPH_VERSION = 'v23.0';
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const reply = (status: number, value: Record<string, unknown>) => new Response(JSON.stringify(value), { status, headers });
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
async function key(secret: string) { return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function hashState(state: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(state))), byte => byte.toString(16).padStart(2, '0')).join(''); }
function database() {
  const url = Deno.env.get('SUPABASE_URL');
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
  if (!url || !secret) throw new Error('database_unavailable');
  return createClient(url, secret, { auth: { persistSession: false } });
}
async function graph(url: URL) {
  const response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, redirect: 'error' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const message = String(data.error?.message || '').toLowerCase();
    const reason = /client secret|app secret|application secret/.test(message) ? 'Segredo do ClubXone recusado. Confira o App Secret salvo no Supabase.'
      : /redirect_uri|redirect uri|redirect url/.test(message) ? 'A Meta recusou a URL de retorno usada na troca do código.'
      : /code.*expired|expired.*code/.test(message) ? 'O código de autorização expirou. Inicie outro login.'
      : /code.*used|used.*code/.test(message) ? 'O código de autorização já foi utilizado. Inicie outro login.'
      : 'A Meta recusou a troca do token.';
    const code = Number.isInteger(data.error?.code) ? data.error.code : 0;
    const subcode = Number.isInteger(data.error?.error_subcode) ? data.error.error_subcode : 0;
    throw new Error(`${reason} (Meta ${code}/${subcode}, HTTP ${response.status})`);
  }
  return data;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  if (Number(request.headers.get('content-length') || 0) > 8192) return reply(413, { error: 'Solicitação muito grande.' });
  const secret = Deno.env.get('CLUBXONE_APP_SECRET');
  if (!secret || !/^\d{8,25}$/.test(APP_ID)) return reply(503, { error: 'Configure CLUBXONE_APP_ID e CLUBXONE_APP_SECRET nos segredos da função Supabase.' });
  let body: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 8192) return reply(413, { error: 'Solicitação muito grande.' }); body = JSON.parse(raw); }
  catch { return reply(400, { error: 'Solicitação inválida.' }); }
  const accountId = String(body.accountId || '');
  const installId = String(body.installId || '');
  if (!/^[a-f0-9-]{16,64}$/i.test(accountId) || !/^[a-f0-9]{32,64}$/i.test(installId)) return reply(400, { error: 'Identidade local inválida.' });
  const hmac = await key(secret);
  if (body.action === 'start') {
    const now = Math.floor(Date.now() / 1000);
    const payload = { accountId, installId, nonce: crypto.randomUUID(), exp: now + 600 };
    const encoded = base64url(encoder.encode(JSON.stringify(payload)));
    const signature = base64url(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encoder.encode(encoded))));
    const state = `${encoded}.${signature}`;
    try {
      const db = database();
      await db.from('meta_oauth_flows').delete().lt('expires_at', new Date().toISOString());
      const { error } = await db.from('meta_oauth_flows').insert({ state_hash: await hashState(state), account_id: accountId, install_id: installId, expires_at: new Date(payload.exp * 1000).toISOString() });
      if (error) throw error;
    } catch { return reply(503, { error: 'Registro temporário do login indisponível. Tente novamente.' }); }
    return reply(200, { state, appId: APP_ID, redirectUri: REDIRECT_URI, expiresAt: new Date(payload.exp * 1000).toISOString() });
  }
  if (body.action !== 'exchange' || !/^[A-Za-z0-9_-]{8,4096}$/.test(String(body.code || ''))) return reply(400, { error: 'Código de autorização inválido.' });
  let stage = 'validar estado';
  try {
    const [encoded, signature, extra] = String(body.state || '').split('.');
    if (!encoded || !signature || extra || encoded.length > 1024 || signature.length > 128) throw new Error('state');
    const valid = await crypto.subtle.verify('HMAC', hmac, decode(signature), encoder.encode(encoded));
    if (!valid) throw new Error('state');
    const state = JSON.parse(new TextDecoder().decode(decode(encoded)));
    if (state.accountId !== accountId || state.installId !== installId || !Number.isInteger(state.exp) || state.exp < Date.now() / 1000 || state.exp > Date.now() / 1000 + 600) throw new Error('state');
    stage = 'consumir estado';
    const { data, error } = await database().from('meta_oauth_flows').delete().eq('state_hash', await hashState(String(body.state))).eq('account_id', accountId).eq('install_id', installId).gt('expires_at', new Date().toISOString()).select('state_hash').maybeSingle();
    if (error || !data) throw new Error('state_used');
    const first = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    first.search = new URLSearchParams({ client_id: APP_ID, client_secret: secret, redirect_uri: REDIRECT_URI, code: String(body.code) }).toString();
    stage = 'trocar código';
    const short = await graph(first);
    const second = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    second.search = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: secret, fb_exchange_token: short.access_token }).toString();
    stage = 'estender token';
    const long = await graph(second);
    return reply(200, { accessToken: long.access_token, expiresIn: long.expires_in || null });
  } catch (error) {
    const detail = error instanceof Error && /\(Meta \d+\/\d+, HTTP \d+\)$/.test(error.message) ? error.message : 'Autorização expirada, já consumida ou serviço indisponível. Inicie outro login.';
    return reply(400, { error: `Falha ao ${stage}: ${detail}` });
  }
});
