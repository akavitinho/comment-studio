const {insightsError}=require('./instagram-insights-errors.cjs');
function createInstagramCollector({postingPlan,metaAuth,getAccount,preparePostingAccount,makePublisher,getAccounts}) {
  return async function collectInstagramInsights(accountIds, context) {
      const ranges = !Array.isArray(accountIds) && Array.isArray(accountIds?.ranges) ? accountIds.ranges.slice(0,2) : [];
      for (const range of ranges) if (!Number.isFinite(range.from)||!Number.isFinite(range.to)||range.from>=range.to||range.to-range.from>90*86400000) throw new Error('Intervalo de Insights inválido (máximo 90 dias).');
      const requested = [...new Set(Array.isArray(accountIds) ? accountIds : accountIds?.accountIds || [])];
      for (const id of requested) if (getAccount(id).platform !== 'instagram') throw new Error('Selecione apenas contas Instagram.');
      const selected = requested.length ? requested : getAccounts().filter(account => account.platform === 'instagram').map(account => account.id);
      const items = selected.flatMap(id => postingPlan.accountInsights.selectMedia(id));
      const publishers = new Map();
      const failedAccounts = new Set();
      const failures = [], errors = []; let requestCount=0;
      const recordError=(id,error)=>{
        const issue={accountId:id,...insightsError(error)};errors.push(issue);
        if(['reconnect','permission'].includes(issue.kind))metaAuth.markReconnect(id);
        const saved=postingPlan.accountInsights.status(id);
        postingPlan.accountInsights.setStatus(id,saved?.status||'pending',saved?.breakdown,issue.retryAt,issue.message);
        failures.push((getAccounts().find(account=>account.id===id)?.name||'Conta')+': '+issue.message);
      };
      let updated = 0, withoutPermission = 0, failed = 0, processed = 0, accountDaysChecked = 0;
      let accountsProcessed = 0;
      const emitProgress = context.progress;
      let nextAccount = 0;
      const collectTotals = async () => {
        while (context.shouldContinue() && nextAccount < selected.length) {
        const id = selected[nextAccount++];
        if(!getAccounts().some(account=>account.id===id)){accountsProcessed++;continue;}
        const status=metaAuth.status(id);
        if (!status?.connected || !status.insightsGranted) { failures.push(`${getAccount(id).name}: reconecte a conta e autorize Insights.`);accountsProcessed++; emitProgress({phase:'official-ready',accountId:id,accountsProcessed,accountsTotal:selected.length}); continue; }
        const cooldown=postingPlan.accountInsights.status(id);
        if(cooldown?.retry_at>Date.now()){failedAccounts.add(id);failures.push(getAccount(id).name+': '+cooldown.message);accountsProcessed++;emitProgress({phase:'official-ready',accountId:id,accountsProcessed,accountsTotal:selected.length});continue;}
        try {
          const connection=await preparePostingAccount(id),token=await metaAuth.token(id,connection);
          const publisher=makePublisher(connection);
          const call=publisher.call.bind(publisher);publisher.call=(...args)=>{requestCount++;return call(...args);};
          publishers.set(id,{token,publisher});
          const options=postingPlan.accountInsights.metricOptions(id,publisher.version,'account');
          const primary=ranges[0];
          const fresh=primary&&postingPlan.db.prepare("SELECT fetched_at FROM official_account_metrics WHERE account_id=? AND start_at=? AND end_at<=? AND end_at>? AND metric='views' ORDER BY fetched_at DESC LIMIT 1").get(id,primary.from,primary.to,primary.to-15*60000);
          if (!(postingPlan.accountInsights.status(id)?.retry_at>Date.now()) && (accountIds?.force || !fresh || fresh.fetched_at<=Date.now()-15*60000)) for (const range of ranges) {
            if(!context.shouldContinue())break;
            const recent=postingPlan.db.prepare("SELECT fetched_at FROM official_account_metrics WHERE account_id=? AND start_at=? AND end_at=? AND metric='views'").get(id,range.from,range.to);
            if(!accountIds?.force && recent?.fetched_at>Date.now()-15*60000)continue;
            postingPlan.accountInsights.saveMetrics(id,range.from,range.to,await publisher.accountMetrics(status.igId,token,range.from,range.to,options),Date.now(),{timezone:"America/Sao_Paulo",graphVersion:publisher.version});
          }
        }catch(error){
          recordError(id,error);failedAccounts.add(id);
        }finally{accountsProcessed++;emitProgress({phase:'official-ready',accountId:id,accountsProcessed,accountsTotal:selected.length});}
        }
      };
      const totalsResults=await Promise.allSettled(Array.from({length:Math.min(2,selected.length)},()=>collectTotals()));
      const fatal=totalsResults.find(result=>result.status==='rejected');if(fatal)throw fatal.reason;
      emitProgress({phase:'totals-complete',accountsProcessed,accountsTotal:selected.length,failures:[...failures]});
      const collectBackground = async () => {
      emitProgress({phase:'background-start',accountsTotal:selected.length,reelsTotal:items.length});
      for (const id of selected) {
        if(!context.shouldContinue())break;
        if(failedAccounts.has(id))continue;
        const status = metaAuth.status(id);
        if (!status?.connected || !status.insightsGranted) continue;
        try {
          const {token,publisher}=publishers.get(id);
          await postingPlan.accountInsights.refresh(id, status.igId, token, publisher, progress => {
            accountDaysChecked++;
            emitProgress({ phase: 'accounts', ...progress });
          }, Date.now(), ranges, context.shouldContinue);
          if(!context.shouldContinue())break;
          const collectionStatus = postingPlan.accountInsights.status(id);
          if (collectionStatus?.retry_at > Date.now() && collectionStatus.message.startsWith('Coleta interrompida')) failedAccounts.add(id);
          if (!(collectionStatus?.retry_at > Date.now())) {
            const last=postingPlan.db.prepare('SELECT MAX(fetched_at) AS at FROM official_followers WHERE account_id=?').get(id);
            if (!last.at || last.at<Date.now()-3600000) {
              const profile=await publisher.call('GET',status.igId,token,{fields:'followers_count'});
              if (Number.isInteger(profile.followers_count)&&profile.followers_count>=0) postingPlan.db.prepare('INSERT INTO official_followers VALUES (?,?,?)').run(id,Date.now(),profile.followers_count);
            }
          }
        } catch (error) {
          recordError(id,error);failedAccounts.add(id);
        }
      }
      for (const item of items) {
        if(!context.shouldContinue())break;
        if (failedAccounts.has(item.account_id)) { failed++; processed++; if (processed % 5 === 0 || processed === items.length) emitProgress({ phase:'reels', processed, total:items.length, updated, failed, withoutPermission }); continue; }
        const account = getAccounts().find(value => value.id === item.account_id && value.platform === 'instagram');
        const status = account && metaAuth.status(item.account_id);
        if (!status?.connected || !status.insightsGranted) { withoutPermission++; processed++; if (processed % 5 === 0 || processed === items.length) emitProgress({ phase:'reels', processed, total:items.length, updated, failed, withoutPermission }); continue; }
        try {
          if (!publishers.has(item.account_id)) {
            const connection = await preparePostingAccount(item.account_id);
            const token = await metaAuth.token(item.account_id, connection);
            publishers.set(item.account_id, { token, publisher: makePublisher(connection) });
          }
          const { token, publisher } = publishers.get(item.account_id);
          const values = await publisher.mediaMetrics(item.media_id, token, postingPlan.accountInsights.metricOptions(item.account_id,publisher.version,'media'));
          postingPlan.accountInsights.saveMedia(item.id, values);
          postingPlan.accountInsights.attempted(item.id);
          postingPlan.saveInsights(item.id, item.media_id, values);
          updated++;
        } catch (error) {
          recordError(item.account_id,error);failedAccounts.add(item.account_id);
          failed++;
        }
        finally {
          processed++;
          if (processed % 5 === 0 || processed === items.length) emitProgress({ phase:'reels', processed, total: items.length, updated, failed, withoutPermission });
        }
      }
      return {checked:items.length,updated,withoutPermission,failed,failures,errors,requestCount,accountDaysChecked,accounts:selected.length,at:new Date().toISOString()};
      };
      return await collectBackground();
};
}
module.exports={createInstagramCollector};
