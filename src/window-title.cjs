function windowTitle(account, platform, proxy, progress, status) {
  const base = `${account.name} — ${platform.label}`;
  const source = progress?.targetType === 'foryou' ? 'Para você'
    : progress?.targetType === 'search' ? `Busca: ${progress.target}`
    : progress?.targetType === 'hashtag' ? `Hashtag: #${progress.target}` : 'Navegação livre';
  const effective = status === 'paused' ? status : progress?.status || status;
  const labels = { waiting: 'Aguardando limite', paused: 'Pausada', pausing: 'Pausando', stopped: 'Parada', completed: 'Concluída', recovering: 'Recuperando', attention: 'Atenção' };
  const state = labels[effective] ? ` · ${labels[effective]}` : '';
  const campaign = platform.id === 'tiktok' ? ` — ${progress?.posted || 0} enviados · ${source}${progress ? state : ''}` : '';
  return `${base}${campaign} — ${proxy ? proxy.name : 'Conexão direta'} | Comment Studio`;
}
module.exports = { windowTitle };
