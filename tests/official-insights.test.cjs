const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {MetaPublisher}=require('../src/meta-publisher.cjs');
const {InstagramAccountInsights}=require('../src/instagram-account-insights.cjs');
const {officialAggregate,officialDisplayRange}=require('../src/ui/dashboard-analytics.js');
test('dashboard keeps latest complete saved window while new accounts arrive',()=>{
 const rows=[
  {account_id:'a',metric:'views',start_at:0,end_at:10,value:5},
  {account_id:'b',metric:'views',start_at:0,end_at:10,value:7},
  {account_id:'a',metric:'views',start_at:0,end_at:20,value:8}
 ];
 const prior={from:-20,to:0};
 assert.deepEqual(officialDisplayRange(rows,['a','b'],{from:0,to:20},prior,'today'),{current:{from:0,to:10},prior:{from:-86400000,to:10-86400000},cached:true});
 rows.push({account_id:'b',metric:'views',start_at:0,end_at:20,value:9});
 assert.deepEqual(officialDisplayRange(rows,['a','b'],{from:0,to:20},prior,'today'),{current:{from:0,to:20},prior,cached:false});
});
test('period reach requires an exact official query, not summed daily reach',()=>{
 const rows=[{account_id:'a',metric:'reach',start_at:0,end_at:10,value:50,fetched_at:20},{account_id:'a',metric:'reach',start_at:10,end_at:20,value:60,fetched_at:20}];
 assert.equal(officialAggregate(rows,['a'],{from:0,to:20},'reach').value,null);
 rows.push({account_id:'a',metric:'reach',start_at:0,end_at:20,value:70,fetched_at:20});
 assert.equal(officialAggregate(rows,['a'],{from:0,to:20},'reach').value,70);
 assert.equal(officialAggregate(rows,['a','b'],{from:0,to:20},'reach').value,null);
 assert.deepEqual(officialAggregate(rows,['a','b'],{from:0,to:20},'reach').partialValue,70);
});
test('null never becomes zero, real zero is retained and revisions replace only matching periods',()=>{
 const db=new DatabaseSync(':memory:'),store=new InstagramAccountInsights(db);
 store.saveMetrics('a',0,10,{views:9,reach:null},10);
 store.saveMetrics('a',0,10,{views:0,reach:2},20);
 store.saveMetrics('a',0,20,{views:8,reach:3},30);
 const rows=db.prepare('SELECT * FROM official_account_metrics').all();
 assert.equal(rows.length,4);assert.equal(officialAggregate(rows,['a'],{from:0,to:10},'views').value,0);
 store.saveMetrics('a',0,10,{views:null},40);assert.equal(db.prepare("SELECT fetched_at FROM official_account_metrics WHERE metric='views' AND end_at=10").get().fetched_at,20);db.close();
});
test('dashboard loads five leading Reels first and all saved Reels on request',()=>{
 const db=new DatabaseSync(':memory:'),store=new InstagramAccountInsights(db);
 db.exec("CREATE TABLE items (id TEXT PRIMARY KEY,account_id TEXT,status TEXT,media_id TEXT,caption TEXT,published_at TEXT)");
 for(let i=0;i<7;i++){
  const id=`reel-${i}`;
  db.prepare('INSERT INTO items VALUES (?,?,?,?,?,?)').run(id,'a','published',id,id,'2026-11-07T12:00:00Z');
  store.saveMedia(id,i===6?{reach:100}:{views:100-i,reach:50-i});
 }
 const initial=store.official(['a'],0,100);
 assert.equal(new Set(initial.media.map(row=>row.item_id)).size,5);
 assert.equal(initial.media.some(row=>row.item_id==='reel-6'),false);
 const all=store.official(['a'],0,100,{allMedia:true});
 assert.equal(new Set(all.media.map(row=>row.item_id)).size,7);
 assert.equal(all.media.some(row=>row.item_id==='reel-6'&&row.metric==='reach'),true);
 db.close();
});
test('combined metrics isolate unsupported fields and preserve empty values',async()=>{
 const publisher=new MetaPublisher({fetch:async()=>{}});let count=0;
 publisher.call=async(_method,_route,_token,params)=>{count++;if(params.metric.includes(',')||params.metric==='profile_views')throw Object.assign(new Error('unsupported'),{metaCode:100});return {data:[{name:params.metric,total_value:params.metric==='reach'?{}:{value:0}}]};};
 const values=await publisher.accountMetrics('id','secret',0,86400000);
 assert.equal(values.profile_views,null);assert.equal(values.reach,null);assert.equal(values.views,0);assert.equal(count,6);
});
test('temporary failures are not multiplied into metric by metric retries',async()=>{
 const publisher=new MetaPublisher({fetch:async()=>{}});let count=0;
 publisher.call=async()=>{count++;throw Object.assign(new Error('rate'),{metaCode:4,transient:true});};
 await assert.rejects(publisher.mediaMetrics('id','secret'));assert.equal(count,1);
});
test('explicitly unsupported account metric is persisted per account and API version',async()=>{
 const db=new DatabaseSync(':memory:'),store=new InstagramAccountInsights(db),calls=[];
 const publisher=new MetaPublisher({fetch:async()=>{},version:'v23.0'});
 publisher.call=async(_method,_route,_token,params)=>{
  calls.push(params.metric);
  if(params.metric.split(',').includes('profile_views'))throw Object.assign(new Error('invalid'),{metaCode:100,metaMessage:'profile_views is an unsupported metric'});
  return {data:params.metric.split(',').map(name=>({name,total_value:{value:4}}))};
 };
 const first=await publisher.accountMetrics('ig','token',0,86400000,store.metricOptions('a','v23.0','account'));
 assert.equal(first.profile_views,null);assert.equal(first.views,4);
 calls.length=0;
 const second=await publisher.accountMetrics('ig','token',86400000,2*86400000,store.metricOptions('a','v23.0','account'));
 assert.equal(second.profile_views,null);assert.deepEqual(calls,['views,reach,accounts_engaged,total_interactions']);
 assert.equal(store.metricOptions('a','v24.0','account').unsupported.size,0);
 db.close();
});
test('generic metric error and temporary errors do not record unsupported capability',async()=>{
 const db=new DatabaseSync(':memory:'),store=new InstagramAccountInsights(db),calls=[];
 const publisher=new MetaPublisher({fetch:async()=>{}});
 publisher.call=async(_method,_route,_token,params)=>{calls.push(params.metric);if(params.metric==='profile_views')throw Object.assign(new Error('generic'),{metaCode:100,metaMessage:'Invalid parameter'});if(params.metric.includes(',')&&params.metric.includes('profile_views'))throw Object.assign(new Error('generic'),{metaCode:100});return {data:params.metric.split(',').map(name=>({name,total_value:{value:1}}))};};
 assert.equal((await publisher.accountMetrics('ig','token',0,86400000,store.metricOptions('a','v23.0','account'))).profile_views,null);
 assert.equal(store.metricOptions('a','v23.0','account').unsupported.size,0);
 calls.length=0;
 await publisher.accountMetrics('ig','token',86400000,2*86400000,store.metricOptions('a','v23.0','account'));
 assert.deepEqual(calls,['views,reach,accounts_engaged,total_interactions']);
 db.close();
});
