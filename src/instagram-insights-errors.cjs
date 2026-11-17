function insightsError(error, now = Date.now()) {
  const code = Number(error.metaCode);
  if ([190,102].includes(code)) return { kind:'reconnect', message:'Reconecte a conta.', retryAt:0 };
  if (code === 200) return { kind:'permission', message:'Reconecte e autorize Insights.', retryAt:0 };
  if (error.retryAfterMinutes || [4,17,32,613,80002].includes(code) || error.httpStatus === 429)
    return { kind:'rate_limit', message:'Limite temporário. Dados preservados.', retryAt:now+(error.retryAfterMinutes||15)*60000 };
  if (/tempo limite/i.test(error.message)) return { kind:'timeout', message:'A conexão demorou demais. Dados preservados.', retryAt:now+15*60000 };
  if (error.transient || error.httpStatus >= 500 || /conexão|network|fetch failed/i.test(error.message))
    return { kind:'connection', message:'Falha de conexão. Dados preservados.', retryAt:now+15*60000 };
  if (code === 100 || code === 3006) return { kind:'unavailable', message:'Métrica indisponível para esta consulta.', retryAt:now+86400000 };
  return { kind:'unknown', message:'Falha na coleta. Tente novamente.', retryAt:now+15*60000 };
}
module.exports = { insightsError };
