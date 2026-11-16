import { createClient } from 'npm:@supabase/supabase-js@2';
const VERSION = 'v27.0';
const REDIRECT_URI = `${Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')}/functions/v1/meta-callback`;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const reply = (status: number, value: Record<string, unknown>) => new Response(JSON.stringify(value), { status, headers });
const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const hmac = (secret: string) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
function database() {
  const url = Deno.env.get('SUPABASE_URL');
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
  if (!url || !secret) throw new Error('Banco indisponível.');
  return createClient(url, secret, { auth: { persistSession: false } });
}
async function exchange(url: URL) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('A Meta recusou a autorização Facebook.');
  return data;
}
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  if (Number(request.headers.get('content-length') || 0) > 8192) return reply(413, { error: 'Solicitação muito grande.' });
  const appId = Deno.env.get('FACEBOOK_APP_ID');
  const secret = Deno.env.get('FACEBOOK_APP_SECRET');
  if (!/^\d{8,25}$/.test(appId || '') || !secret) return reply(503, { error: 'Configure FACEBOOK_APP_ID e FACEBOOK_APP_SECRET no Supabase.' });
  let body: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 8192) return reply(413, { error: 'Solicitação muito grande.' }); body = JSON.parse(raw); }
  catch { return reply(400, { error: 'Solicitação inválida.' }); }
  const accountId = String(body.accountId || ''), installId = String(body.installId || '');
  if (!/^[a-f0-9-]{16,64}$/i.test(accountId) || !/^[a-f0-9]{32,64}$/i.test(installId)) return reply(400, { error: 'Identidade local inválida.' });
  const key = await hmac(secret);
  if (body.action === 'start') {
    const payload = { provider: 'facebook', appId, accountId, installId, nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 600 };
    const encoded = b64(encoder.encode(JSON.stringify(payload)));
    const state = `${encoded}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(encoded))))}`;
    try {
      const { error } = await database().from('meta_oauth_flows').insert({ state_hash: await hash(state), account_id: accountId, install_id: installId, expires_at: new Date(payload.exp * 1000).toISOString() });
      if (error) throw error;
    } catch { return reply(503, { error: 'Registro temporário do login indisponível.' }); }
    return reply(200, { state, provider: 'facebook', appId, redirectUri: REDIRECT_URI, expiresAt: new Date(payload.exp * 1000).toISOString() });
  }
  if (body.action !== 'exchange' || !/^[A-Za-z0-9_-]{8,4096}$/.test(String(body.code || ''))) return reply(400, { error: 'Código de autorização inválido.' });
  try {
    const [encoded, signature, extra] = String(body.state || '').split('.');
    if (!encoded || !signature || extra || encoded.length > 1024 || signature.length > 128 || !await crypto.subtle.verify('HMAC', key, unb64(signature), encoder.encode(encoded))) throw new Error('state');
    const state = JSON.parse(new TextDecoder().decode(unb64(encoded)));
    if (state.provider !== 'facebook' || state.appId !== appId || state.accountId !== accountId || state.installId !== installId || state.exp < Date.now() / 1000 || state.exp > Date.now() / 1000 + 600) throw new Error('state');
    const { data, error } = await database().from('meta_oauth_flows').delete().eq('state_hash', await hash(String(body.state))).eq('account_id', accountId).eq('install_id', installId).gt('expires_at', new Date().toISOString()).select('state_hash').maybeSingle();
    if (error || !data) throw new Error('state_used');
    const shortUrl = new URL(`https://graph.facebook.com/${VERSION}/oauth/access_token`);
    shortUrl.search = new URLSearchParams({ client_id: appId!, client_secret: secret, redirect_uri: REDIRECT_URI, code: String(body.code) }).toString();
    const short = await exchange(shortUrl);
    const longUrl = new URL(`https://graph.facebook.com/${VERSION}/oauth/access_token`);
    longUrl.search = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId!, client_secret: secret, fb_exchange_token: short.access_token }).toString();
    const long = await exchange(longUrl);
    return reply(200, { accessToken: long.access_token, graphVersion: VERSION });
  } catch { return reply(400, { error: 'Autorização Facebook expirada, já utilizada ou recusada. Inicie outro login.' }); }
});
