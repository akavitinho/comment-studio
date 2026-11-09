const { contextBridge } = require('electron');
const account = { id: 'ig-test', platform: 'instagram', name: 'Perfil de teste', handle: 'perfil.teste', proxyId: null, open: false, meta: { connected: true, insightsGranted: true, username: 'perfil.teste', igId: '17840000000000000' } };
const linkedAccount = { id: 'x-test', platform: 'x', name: 'Clássico Criador', handle: 'criador.x', proxyId: 'proxy-test', open: false };
const snapshot = {
  accounts: [account, linkedAccount], proxies: [{ id: 'proxy-test', name: 'Proxy Brasil', protocol: 'http', host: '127.0.0.1', port: 8080, authenticated: true }], campaign: null, events: [], attempts: [], xAttempts: [], xCampaign: null,
  automation: { status: 'idle' }, xAutomation: { status: 'idle', accounts: [] },
  postings: {
    mediaSettings: [],
    schedules: [{ account_id: account.id, status: 'paused', next_at: '2026-11-05T15:00:00.000Z', config: { minMinutes: 60, maxMinutes: 120, startMinute: 540, endMinute: 1200, days: [0, 1, 2, 3, 4, 5, 6], timeZone: 'America/Sao_Paulo', dailyLimit: 2, firstAt: '2026-11-05T15:00:00.000Z' } }],
    insights: [], items: [
      { id: 'video-1', account_id: account.id, file: 'C:\\Videos\\meu-reel.mp4', caption: 'Legenda de teste', status: 'queued' },
      { id: 'video-attention', account_id: account.id, file: 'C:\\Videos\\falhou.mp4', caption: 'Outra legenda', status: 'attention', error: 'Proxy indisponível.' },
      { id: 'video-published', account_id: account.id, file: 'C:\\Videos\\publicado.mp4', caption: 'Publicado', status: 'published', media_id: '17840000000000001', permalink: 'https://www.instagram.com/reel/teste/' }
    ], attempts: []
  },
  metaSettings: { appId: '123456789012345', redirectUri: '', graphVersion: 'v23.0', secretConfigured: false },
  postingStorage: { configured: true, url: 'https://example.supabase.co', bucket: 'posting-videos' }, version: '0.2.5'
};
contextBridge.exposeInMainWorld('studio', {
  state: async () => snapshot,
  addAccount: async data => { snapshot.accounts.push({ ...data, id: `bulk-${snapshot.accounts.length}`, open: false, meta: { connected: false } }); return snapshot; },
  editAccount: async data => { Object.assign(snapshot.accounts.find(account => account.id === data.id), data); return snapshot; },
  addProxy: async data => { snapshot.proxies.push({ ...data, id: `proxy-${snapshot.proxies.length}`, authenticated: Boolean(data.username) }); return snapshot; },
  pickMediaVideos: async () => ['C:\\Videos\\mesmo-reel.mp4'],
  pickPostingVideoFolder: async () => 'C:\\Videos',
  pickMediaCover: async () => 'C:\\Capas\\capa.png',
  postingCoverPreview: async () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/+fQAAAAASUVORK5CYII=',
  savePostingMediaSettings: async ({ accountId, ...changes }) => {
    let settings = snapshot.postings.mediaSettings.find(row => row.account_id === accountId);
    if (!settings) { settings = { account_id: accountId, folder: null, cover: null }; snapshot.postings.mediaSettings.push(settings); }
    if (changes.videoOrder) { settings.video_order = changes.videoOrder; delete changes.videoOrder; }
    Object.assign(settings, changes); return snapshot;
  },
  selectPostingFolder: async ({ accountId, folder }) => {
    let settings = snapshot.postings.mediaSettings.find(row => row.account_id === accountId);
    if (!settings) { settings = { account_id: accountId, folder: null, cover: null }; snapshot.postings.mediaSettings.push(settings); }
    settings.folder = folder;
    for (const name of ['novo1.mp4', 'novo2.mp4']) snapshot.postings.items.push({ id: `folder-${snapshot.postings.items.length}`, account_id: accountId, file: `${folder}\\${name}`, caption: '', status: 'queued' });
    return { ...snapshot, importedCount: 2, skippedCount: 1 };
  },
  importPostingFolder: async () => ({ ...snapshot, importedCount: 2, skippedCount: 1 }),
  addPostingVideo: async ({ accountId, file, caption }) => { snapshot.postings.items.push({ id: `video-${snapshot.postings.items.length}`, account_id: accountId, file, caption, status: 'queued' }); return snapshot; },
  clearPostingQueue: async ({ accountId }) => { const before = snapshot.postings.items.length; snapshot.postings.items = snapshot.postings.items.filter(item => !(item.account_id === accountId && item.queue_kind !== 'shared' && item.status === 'queued')); const schedule = snapshot.postings.schedules.find(row => row.account_id === accountId); if (schedule) { schedule.status = 'stopped'; schedule.next_at = null; } return { ...snapshot, removedCount: before - snapshot.postings.items.length }; },
  savePostingSchedules: async ({ accountIds, config }) => { for (const accountId of accountIds) { const previous = snapshot.postings.schedules.find(schedule => schedule.account_id === accountId); if (previous) previous.config = { ...config }; else snapshot.postings.schedules.push({ account_id: accountId, config: { ...config }, status: 'stopped', next_at: null }); } return snapshot; },
  refreshInstagramInsights: async () => { snapshot.postings.insights = [{ item_id: 'video-published', views: 125, reach: 84, fetched_at: '2026-11-05T15:00:00.000Z' }]; return { state: snapshot, checked: 1, updated: 1, withoutPermission: 0, failed: 0 }; },
  retryPostingVideo: async id => { const item = snapshot.postings.items.find(video => video.id === id); if (!item || item.status !== 'attention') throw new Error('Vídeo não está em atenção.'); item.status = 'queued'; item.error = null; return snapshot; },
  controlPosting: async ({ accountId, status }) => { snapshot.postings.schedules.find(schedule => schedule.account_id === accountId).status = status; return snapshot; },
  startQueuedPostings: async () => { const started = []; for (const account of snapshot.accounts.filter(item => item.platform === 'instagram')) { if (!snapshot.postings.items.some(item => item.account_id === account.id && item.status === 'queued')) continue; const schedule = snapshot.postings.schedules.find(item => item.account_id === account.id); if (!schedule || schedule.status === 'running') continue; schedule.status = 'running'; started.push(`@${account.handle}`); } return { state: snapshot, started, skipped: [] }; },
  addSharedPostingVideos: async ({ accountIds, files, caption }) => {
    snapshot.postings.sharedSchedules ||= [];
    files.forEach((file, index) => {
      const accountId=accountIds[index%accountIds.length];
      snapshot.postings.items.push({ id: `shared-${snapshot.postings.items.length}`, account_id: accountId, queue_kind: 'shared', file, caption, status: 'queued', position: snapshot.postings.items.length, scheduled_at: '2026-11-07T22:43:00.000Z' });
      if(!snapshot.postings.sharedSchedules.some(row=>row.account_id===accountId))snapshot.postings.sharedSchedules.push({account_id:accountId,status:'stopped',next_at:'2026-11-07T22:43:00.000Z'});
    });
    return snapshot;
  },
  controlSharedPosting: async ({status,only}) => {
    snapshot.postings.sharedSchedules ||= [];
    for(const schedule of snapshot.postings.sharedSchedules)schedule.status=status;
    let pausedAccountQueues=0;
    if(only)for(const schedule of snapshot.postings.schedules)if(schedule.status==='running'){schedule.status='paused';pausedAccountQueues++;}
    return only?{...snapshot,pausedAccountQueues}:snapshot;
  },
  postingProfilePicture: async () => null,
  videoThumbnail: async () => null,
  instagramOfficialMetrics: async ({accountIds,from,to,allMedia}) => {
    const day=86400000,today=Math.floor(Date.now()/day)*day;
    const single=to-from<2*day,currentFrom=single?today:today-6*day;
    const priorTo=single?to-day:currentFrom;
    const values={views:125,reach:84,profile_views:12,total_interactions:27};
    const rows=[];
    for(const accountId of accountIds){
      if(accountId==='ig-missing')continue;
      for(const [metric,value] of Object.entries(values)){
        rows.push({account_id:accountId,start_at:currentFrom,end_at:to,metric,value,fetched_at:Date.now()});
        rows.push({account_id:accountId,start_at:from,end_at:priorTo,metric,value:Math.max(1,value-20),fetched_at:Date.now()-day});
      }
      for(let at=currentFrom;at<to;at+=day)for(const [metric,value] of Object.entries(values))rows.push({account_id:accountId,start_at:at,end_at:Math.min(at+day,to),metric,value:Math.round(value/7),fetched_at:Date.now()});
    }
    const media=['views','reach','likes','comments','shares','saved'].map((metric,index)=>({item_id:'video-published',account_id:'ig-test',caption:'Publicado',metric,value:[125,84,15,5,3,2][index],fetched_at:Date.now()}));
    return {metrics:rows,media,followers:accountIds.map(account_id=>({account_id,value:240,fetched_at:Date.now()})),authorizedIds:accountIds};
  }
});
for (const name of ['onAutomation', 'onXAutomation', 'onMediaProgress', 'onDownloadProgress', 'onPostings']) contextBridge.exposeInMainWorld(name, () => () => {});
