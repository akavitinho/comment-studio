// Read-only audit. Credentials are decrypted only in memory and never included in the report.
const {app,session,safeStorage,net}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createProxyFetch}=require('../src/proxy-fetch.cjs');
const root=path.join(__dirname,'..'),directory=path.join(root,'.local');
const output=path.join(root,'outputs','meta-insights-audit');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',directory);
app.setPath('sessionData',path.join(directory,'browser'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
 const auth=JSON.parse(fs.readFileSync(path.join(directory,'meta-auth.json'),'utf8'));
 const state=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8'));
 const db=new DatabaseSync(path.join(directory,'postings.sqlite'),{readOnly:true});
 const until=Math.floor(Date.now()/86400000)*86400,since=until-86400;
 const report={at:new Date().toISOString(),provider:auth.loginProvider,version:auth.graphVersion,period:{since,until,timezone:'UTC'},accounts:[]};
 const compat=process.argv.includes('--compat');
 const save=()=>fs.writeFileSync(path.join(output,compat?'compatibility.json':'audit.json'),JSON.stringify(report,null,2));
 for(const [id,saved] of (compat?Object.entries(auth.accounts).slice(0,1):Object.entries(auth.accounts))){
  const account=state.accounts.find(a=>a.id===id);if(!account)continue;
  const entry={id,username:saved.username,storedInsightsGranted:saved.insightsGranted,permissions:null,results:[]};report.accounts.push(entry);
  if(saved.needsReconnect||Date.parse(saved.expiresAt)<=Date.now()){entry.error='Reconexão necessária';save();continue;}
  try{
   const token=(await safeStorage.decryptStringAsync(Buffer.from(saved.token,'base64'))).result;
   const proxy=account.proxyId?state.proxies.find(p=>p.id===account.proxyId):null;
   if(account.proxyId&&!proxy)throw new Error('Proxy configurado não encontrado');
   const credentials=proxy?.credentials?JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(proxy.credentials,'base64'))).result):null;
   const ses=session.fromPartition(`audit-${id}`);
   await ses.setProxy(proxy?{mode:'fixed_servers',proxyRules:`${proxy.protocol}://${proxy.host}:${proxy.port}`,proxyBypassRules:'<-loopback>'}:{mode:'direct'});
   const fetch=createProxyFetch(net,{ses,proxy,credentials});
   async function query(route,params){
    const url=new URL(`https://graph.instagram.com/${auth.graphVersion}/${route}`);
    for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    const data=await response.json();
    if(data.error)return{ok:false,status:response.status,code:data.error.code,subcode:data.error.error_subcode,message:String(data.error.message||'').split(token).join('[REDACTED]'),transient:data.error.is_transient};
    return{ok:response.ok,status:response.status,data};
   }
   entry.permissions=await query('me/permissions',{});save();
   const specs=['views','reach','accounts_engaged','total_interactions','profile_views','follower_count','follows_and_unfollows'].map(metric=>({kind:'account',metric,route:`${saved.igId}/insights`,params:{metric,period:'day',metric_type:metric==='follower_count'?'time_series':'total_value',since,until}}));
   specs.push({kind:'profile',metric:'followers_count',route:saved.igId,params:{fields:'followers_count'}});
   const reel=db.prepare("SELECT media_id FROM items WHERE account_id=? AND status='published' AND media_id IS NOT NULL ORDER BY published_at DESC LIMIT 1").get(id);
   if(reel)for(const metric of ['views','reach','likes','comments','shares','saved','ig_reels_avg_watch_time','ig_reels_video_view_total_time'])specs.push({kind:'reel',metric,route:`${reel.media_id}/insights`,params:{metric}});
   if(compat){
    specs.length=0;const end=Math.floor(Date.now()/60000)*60;
    for(const [name,start,finish] of [['24h',end-86400,end],['partial',until,end],['previous',until-86400,end-86400]])specs.push({kind:'compatibility',metric:name,route:`${saved.igId}/insights`,params:{metric:'views,reach,accounts_engaged,total_interactions,profile_views',period:'day',metric_type:'total_value',since:start,until:finish}});
    if(reel)specs.push({kind:'compatibility',metric:'media-combined',route:`${reel.media_id}/insights`,params:{metric:'views,reach,likes,comments,shares,saved,ig_reels_avg_watch_time,ig_reels_video_view_total_time'}});
   }
   for(const spec of specs){
    const result=await query(spec.route,spec.params);
    entry.results.push({...spec,...result});save();
    if([4,17,32,190,613].includes(result.code)||result.status===429){entry.stopped='Limite ou autorização: consultas restantes suspensas';break;}
   }
  }catch(error){entry.error=error.message;}
  save();console.log(`${entry.username}: ${entry.results.filter(r=>r.ok).length}/${entry.results.length} solicitações aceitas`);
 }
 db.close();save();console.log('Auditoria salva em outputs/meta-insights-audit/audit.json');app.exit(0);
}).catch(()=>{console.error('Auditoria interrompida; consulte o relatório parcial, se disponível.');app.exit(1);});
