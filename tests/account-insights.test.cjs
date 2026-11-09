const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {InstagramAccountInsights,DAY,dayStart}=require('../src/instagram-account-insights.cjs');
const {MetaPublisher}=require('../src/meta-publisher.cjs');
const now=Date.UTC(2026,10,7,12);
test('dashboard totals require full matching coverage and never compare a partial day',()=>{
 const {accountDailySummary}=require('../src/ui/dashboard-analytics.js');
 const start=dayStart(now)-DAY;
 const row=(id,at,views)=>({account_id:id,start_at:at,end_at:at+DAY,fetched_at:at+DAY,views,reels:null});
 const rows=[row('a',start,20),row('b',start,30),row('a',start-DAY,10),row('b',start-DAY,15)];
 assert.equal(accountDailySummary(rows,['a','b'],start,start).delta,100);
 assert.equal(accountDailySummary(rows,['a','b','c'],start,start).delta,null);
 assert.equal(accountDailySummary(rows,['a','b'],start,start,true).total,null);
 rows[0].end_at=start+1000;
 assert.equal(accountDailySummary(rows,['a','b'],start,start).delta,null);
 assert.equal(accountDailySummary(rows,['a','b'],start,start).total,50);
});
test('account response preserves explicit interval, all formats and Reel breakdown',async()=>{
 const api=new MetaPublisher({fetch:async(url,options)=>{
  assert.equal(url.searchParams.get('metric_type'),'total_value');
  assert.equal(url.searchParams.has('access_token'),false);
  return {ok:true,json:async()=>({data:[{name:'views',period:'day',total_value:{value:90,breakdowns:[{dimension_keys:['media_product_type'],results:[{dimension_values:['REELS'],value:60},{dimension_values:['STORY'],value:30}]}]}}]})};
 }});
 assert.deepEqual(await api.accountInsights('id','token',now-DAY,now),{views:90,reels:60,from:now-DAY,to:now,period:'day',timezone:'UTC'});
});
test('daily revisions upsert, backfill is bounded and resumes from persisted history',async()=>{
 const db=new DatabaseSync(':memory:'), service=new InstagramAccountInsights(db); let calls=0,value=10;
 const api={accountInsights:async(id,token,from,to)=>{calls++;return {from,to,views:value,reels:null,timezone:'UTC'};}};
 await service.refresh('a','ig','token',api,()=>{},now);
 assert.equal(calls,6); value=20;
 const resumed=new InstagramAccountInsights(db);
 await resumed.refresh('a','ig','token',api,()=>{},now+60000);
 const result=resumed.query(['a'],now-30*DAY,now);
 assert.equal(calls,12); assert.equal(result.rows.length,9);
 assert.equal(result.rows.find(row=>row.start_at===dayStart(now)).views,20);
 assert.equal(result.rows.find(row=>row.start_at===dayStart(now)).end_at,now+60000);
 db.close();
});
test('temporary errors retain data and capability and enforce retry delay',async()=>{
 const db=new DatabaseSync(':memory:'), service=new InstagramAccountInsights(db);
 service.save('a',{from:dayStart(now),to:now,views:5,reels:null,timezone:'UTC'},now);
 service.setStatus('a','supported',false);
 let calls=0;const api={accountInsights:async()=>{calls++;throw Object.assign(new Error('limit'),{metaCode:4,retryAfterMinutes:30});}};
 await assert.rejects(service.refresh('a','ig','token',api,()=>{},now));
 await service.refresh('a','ig','token',api,()=>{},now+60000);
 assert.equal(calls,1);assert.equal(service.status('a').status,'supported');
 assert.equal(service.query(['a'],now,now).rows[0].views,5);db.close();
});
test('all eligible Reels are selected and read frequency survives service recreation',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE items(id TEXT,account_id TEXT,media_id TEXT,published_at TEXT,status TEXT)');
 for(let i=0;i<50;i++)db.prepare('INSERT INTO items VALUES (?,?,?,?,?)').run(String(i),'a',String(i),new Date(now-(i<25?1:10)*DAY).toISOString(),'published');
 let service=new InstagramAccountInsights(db);
 const first=service.selectMedia('a',now);assert.equal(first.length,50);assert.equal(first.filter(row=>Date.parse(row.published_at)<now-7*DAY).length,25);
 first.forEach(row=>service.attempted(row.id,now));service=new InstagramAccountInsights(db);
 const second=service.selectMedia('a',now+1000);
 assert.equal(second.length,0);
 assert.equal(service.selectMedia('a',now+3600001).length,25);
 assert.equal(service.selectMedia('a',now+DAY+1).length,50);db.close();
});
test('missing optional metrics do not cause historical view days to be fetched again',async()=>{
 const db=new DatabaseSync(':memory:'),service=new InstagramAccountInsights(db),dates=[];
 const api={version:'v23.0',accountMetrics:async(_id,_token,from)=>{dates.push(from);return {views:10,reach:null,accounts_engaged:null,total_interactions:null,profile_views:null};}};
 await service.refresh('a','ig','token',api,()=>{},now);
 const first=new Set(dates);assert.equal(first.size,6);
 dates.length=0;
 await service.refresh('a','ig','token',api,()=>{},now+60000);
 assert.equal(dates.filter(from=>first.has(from)).length,3);
 db.close();
});
