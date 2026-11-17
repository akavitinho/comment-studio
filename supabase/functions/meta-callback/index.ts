// Public OAuth callback. Automatic Instagram flows relay a short-lived encrypted
// code to the initiating installation; existing manual flows keep their return page.
import { createClient } from 'npm:@supabase/supabase-js@2';

const encoder = new TextEncoder();
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const signingKey = (secret: string) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
async function relayKey(secret: string) { const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(`comment-studio:instagram-oauth-relay:${secret}`)); return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']); }
async function encryptCode(code: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await relayKey(secret), encoder.encode(code)));
  return { code_ciphertext: encode(ciphertext), code_iv: encode(iv) };
}
function database() {
  const url = Deno.env.get('SUPABASE_URL');
  const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
  if (!url || !secret) throw new Error('database_unavailable');
  return createClient(url, secret, { auth: { persistSession: false } });
}
const headers = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
};
const page = (message: string, status = 200) => new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Comment Studio</title><body><h1>${message}</h1><p>Volte ao Comment Studio para continuar.</p></body></html>`, { status, headers });

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET') return new Response('Not found', { status: 404 });
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  if (!state) return page('Volte ao Comment Studio');
  let payload: Record<string, unknown>;
  const secret = Deno.env.get('INSTAGRAM_APP_SECRET');
  const appId = Deno.env.get('INSTAGRAM_APP_ID');
  try {
    const [encoded, signature, extra] = state.split('.');
    if (!encoded || !signature || extra || encoded.length > 1024 || signature.length > 128) throw new Error('state');
    payload = JSON.parse(new TextDecoder().decode(decode(encoded)));
    if (payload.provider !== 'instagram' || payload.appId !== appId || payload.auto !== true) return page('Volte ao Comment Studio');
    if (!secret || !await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), encoder.encode(encoded))) throw new Error('state');
    if (typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) || payload.exp <= Date.now() / 1000 || payload.exp > Date.now() / 1000 + 600) throw new Error('state');
  } catch { return page('Retorno de login inválido', 400); }
  const code = url.searchParams.get('code') || '';
  const cancelled = Boolean(url.searchParams.get('error'));
  if (!cancelled && !/^[A-Za-z0-9_-]{8,4096}$/.test(code)) return page('Autorização incompleta', 400);
  try {
    const stateHash = await hash(state);
    const values = cancelled ? { oauth_error: 'cancelled' } : await encryptCode(code, secret!);
    const { data, error } = await database().from('meta_oauth_flows').update(values)
      .eq('state_hash', stateHash).eq('account_id', payload.accountId).eq('install_id', payload.installId)
      .gt('expires_at', new Date().toISOString()).not('poll_secret_hash', 'is', null)
      .is('code_ciphertext', null).is('oauth_error', null).select('state_hash').maybeSingle();
    if (error || !data) return page('Este login expirou ou já foi concluído', 400);
    const projectUrl = Deno.env.get('SUPABASE_URL');
    if (!projectUrl) throw new Error('project_url_unavailable');
    const clean = new URL('/functions/v1/meta-callback', projectUrl);
    clean.searchParams.set('completed', cancelled ? '0' : '1');
    return new Response(null, { status: 303, headers: { ...headers, Location: clean.toString() } });
  } catch { return page('Não foi possível concluir o retorno. Atualize esta página para tentar novamente.', 503); }
});
