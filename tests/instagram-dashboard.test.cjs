const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const periods = require('../src/ui/instagram-periods.js');
const { InstagramAccountInsights } = require('../src/instagram-account-insights.cjs');
const { MetaPublisher } = require('../src/meta-publisher.cjs');

test('Brasília day does not change at UTC midnight and is independent of host timezone', () => {
  const now = Date.parse('2026-11-18T01:30:00Z');
  assert.equal(periods.dayKey(now), '2026-11-17');
  const [current, previous] = periods.ranges('today', '', '', now);
  assert.equal(new Date(current.from).toISOString(), '2026-11-17T03:00:00.000Z');
  assert.equal(current.to - current.from, previous.to - previous.from);
  assert.equal(periods.hour(now), 22);
});

test('custom dates include the final day, reject invalid dates and cross year boundaries', () => {
  const now = Date.parse('2027-01-03T12:00:00Z');
  const [range] = periods.ranges('custom', '2026-12-31', '2027-01-01', now);
  assert.equal(new Date(range.to).toISOString(), '2027-01-02T03:00:00.000Z');
  for (const [from,to] of [['2027-02-30','2027-02-30'],['2027-01-02','2027-01-01'],['2027-01-03','2027-01-04'],['2026-01-01','2027-01-01']]) assert.throws(() => periods.ranges('custom',from,to,now));
});

test('90-day history reaches selected old days and ignores aggregate totals as daily coverage', async () => {
  const db = new DatabaseSync(':memory:'), service = new InstagramAccountInsights(db);
  const now = Date.parse('2026-11-17T15:00:00Z'), ranges = periods.ranges('90','','',now);
  const from = ranges[0].from;
  service.saveMetrics('a',from,ranges[0].to,{views:100});
  const seen=[];
  const publisher={version:'v23.0',accountMetrics:async(_id,_token,start,end)=>{seen.push([start,end]);return {views:5};}};
  // Fill newer days so the selected distant day becomes the next missing day.
  for(let at=from+periods.DAY;at<periods.midnight(periods.dayKey(now));at+=periods.DAY)service.saveMetrics('a',at,at+periods.DAY,{views:1});
  await service.refresh('a','ig','token',publisher,()=>{},now,[ranges[0]]);
  assert.ok(seen.some(([at])=>at===from));
  assert.ok(seen.length<=6);
  const row=db.prepare('SELECT * FROM official_metric_windows WHERE start_at=? AND end_at=?').get(from,from+periods.DAY);
  assert.equal(row.requested_timezone,periods.timezone);
  assert.equal(row.graph_version,'v23.0');db.close();
});

test('transient Insights failures retry twice, limits and expired credentials do not', async () => {
  const waits=[],publisher=new MetaPublisher({fetch:()=>{},wait:async ms=>waits.push(ms)});
  let calls=0;
  const value=await publisher.retryInsights(async()=>{if(++calls<3)throw Object.assign(new Error('network'),{transient:true});return 42;});
  assert.equal(value,42);assert.deepEqual(waits,[1000,2000]);
  for(const code of [4,190]){calls=0;await assert.rejects(publisher.retryInsights(async()=>{calls++;throw Object.assign(new Error('blocked'),{metaCode:code,transient:true});}));assert.equal(calls,1);}
});

test('account totals preserve reported periods and do not treat a time-series point as a total',async()=>{
  const publisher=new MetaPublisher({fetch:()=>{}});
  publisher.call=async()=>({data:[
    {name:'views',period:'day',total_value:{value:42}},
    {name:'reach',period:'day',values:[{value:9,end_time:'2026-11-17T03:00:00Z'}]},
    {name:'total_interactions',period:'lifetime',total_value:{value:80}}
  ]});
  const result=await publisher.accountMetrics('id','token',1000,2000);
  assert.equal(result.views,42);assert.equal(result.evidence.views.status,'requested');
  assert.equal(result.reach,null);assert.equal(result.evidence.reach.status,'incompatible');
  assert.equal(result.total_interactions,null);
  publisher.call=async()=>({data:[{name:'views',period:'day',start_time:1,end_time:2,total_value:{value:7}}]});
  const confirmed=await publisher.accountMetrics('id','token',1000,2000);
  assert.equal(confirmed.evidence.views.status,'confirmed');assert.equal(confirmed.views,7);
});

test('incompatible API periods cannot revive an older cached value for the same request',async()=>{
  const db=new DatabaseSync(':memory:'),service=new InstagramAccountInsights(db);
  db.exec('CREATE TABLE items(id TEXT,account_id TEXT,media_id TEXT,caption TEXT,published_at TEXT,status TEXT)');
  service.saveMetrics('a',1000,2000,{views:100});
  const publisher=new MetaPublisher({fetch:()=>{}});
  publisher.call=async()=>({data:[{name:'views',period:'day',start_time:0,end_time:2,total_value:{value:150}}]});
  service.saveMetrics('a',1000,2000,await publisher.accountMetrics('id','token',1000,2000));
  const stored=service.official(['a'],1000,2000);
  assert.equal(stored.metrics.length,0);assert.equal(stored.evidence.find(row=>row.metric==='views').reportedFrom,0);
  assert.equal(db.prepare('SELECT value FROM official_account_metrics').get().value,100);db.close();
});

test('history interruption commits completed days and can continue later',async()=>{
  const db=new DatabaseSync(':memory:'),service=new InstagramAccountInsights(db);
  let keepGoing=true,calls=0;
  const now=Date.parse('2026-11-17T12:00:00Z');
  const api={version:'v23.0',accountMetrics:async()=>{calls++;return {views:1};}};
  await service.refresh('a','ig','token',api,()=>{keepGoing=false;},now,[],()=>keepGoing);
  assert.equal(calls,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM official_account_metrics').get().n,1);
  await service.refresh('a','ig','token',api,()=>{},now);
  assert.ok(calls>1);db.close();
});

test('Reel ranking applies publication dates before the top-five limit',()=>{
  const db=new DatabaseSync(':memory:'),service=new InstagramAccountInsights(db);
  db.exec('CREATE TABLE items(id TEXT,account_id TEXT,media_id TEXT,caption TEXT,published_at TEXT,status TEXT)');
  const insert=db.prepare('INSERT INTO items VALUES(?,?,?,?,?,?)');
  for(let index=0;index<7;index++){
    const id='old-'+index;insert.run(id,'a',id,id,'2026-10-01T12:00:00.000Z','published');service.saveMedia(id,{views:999});
  }
  insert.run('recent','a','recent','Recent','2026-11-17T12:00:00.000Z','published');service.saveMedia('recent',{views:1});
  const range={from:Date.parse('2026-11-17T03:00:00Z'),to:Date.parse('2026-11-18T03:00:00Z')};
  const result=service.official(['a'],range.from-86400000,range.to,{mediaFrom:range.from});
  assert.deepEqual(result.media.map(row=>row.item_id),['recent']);db.close();
});

test('failed metric write rolls back both value and period evidence',()=>{
  const db=new DatabaseSync(':memory:'),service=new InstagramAccountInsights(db);
  service.saveMetrics('a',1000,2000,{views:7});
  db.exec("CREATE TRIGGER reject_window BEFORE UPDATE ON official_metric_windows BEGIN SELECT RAISE(FAIL,'fixture failure'); END");
  const values={views:100};Object.defineProperty(values,'evidence',{value:{views:{status:'confirmed'}}});
  assert.throws(()=>service.saveMetrics('a',1000,2000,values),/fixture failure/);
  assert.equal(db.prepare('SELECT value FROM official_account_metrics').get().value,7);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM official_metric_evidence').get().n,0);db.close();
});

test('additive migration preserves legacy metrics and backs up existing disk databases once', () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'studio-insights-'));
  const file=path.join(folder,'test.sqlite');const db=new DatabaseSync(file);
  db.exec('CREATE TABLE official_account_metrics(account_id TEXT,start_at INTEGER,end_at INTEGER,metric TEXT,value REAL,fetched_at INTEGER,PRIMARY KEY(account_id,start_at,end_at,metric)); INSERT INTO official_account_metrics VALUES(\'a\',0,86400000,\'views\',7,1)');
  new InstagramAccountInsights(db);new InstagramAccountInsights(db);
  assert.equal(db.prepare('SELECT value FROM official_account_metrics').get().value,7);
  assert.equal(fs.readdirSync(folder).filter(name=>name.endsWith('.bak')).length,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM official_metric_windows').get().n,0);
  db.close();fs.rmSync(folder,{recursive:true,force:true});
});
