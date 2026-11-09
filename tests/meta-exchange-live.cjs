// Safe live probe: uses an invalid OAuth code and never publishes media.
const { randomUUID, randomBytes } = require('node:crypto');
const endpoint = process.env.STUDIO_SUPABASE_URL ? `${process.env.STUDIO_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/meta-exchange` : '';
if (!endpoint) throw new Error('Configure STUDIO_SUPABASE_URL para executar este diagnóstico.');
async function send(body) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
(async () => {
  const accountId = randomUUID(), installId = randomBytes(24).toString('hex');
  const started = await send({ action: 'start', accountId, installId });
  if (started.status !== 200 || !started.data.state) throw new Error(`Início do login falhou (${started.status}).`);
  const input = { action: 'exchange', accountId, installId, state: started.data.state, code: 'invalid-code-for-safe-probe' };
  const first = await send(input);
  const replay = await send(input);
  if (first.status !== 400 || replay.status !== 400 || first.data.accessToken || replay.data.accessToken) throw new Error('O serviço aceitou um código inválido ou retornou token.');
  if (!/^Falha ao trocar código:.*\(Meta \d+\/\d+, HTTP \d+\)$/.test(first.data.error || '')) throw new Error('Diagnóstico da troca de código ausente no serviço implantado.');
  if (!/^Falha ao consumir estado:/.test(replay.data.error || '')) throw new Error('A reutilização não foi bloqueada antes da chamada à Meta.');
  console.log(JSON.stringify({ start: started.status, invalidCode: first.status, replay: replay.status, accountId }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
