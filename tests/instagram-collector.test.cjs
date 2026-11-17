const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {InstagramAccountInsights}=require('../src/instagram-account-insights.cjs');
const {createInstagramCollector}=require('../src/instagram-insights-collector.cjs');
const {insightsError}=require('../src/instagram-insights-errors.cjs');
const periods=require('../src/ui/instagram-periods.js');

function fixture(accountMetrics){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE items(id TEXT,account_id TEXT,media_id TEXT,published_at TEXT,status TEXT)');
  const accountInsights=new InstagramAccountInsights(db),accounts=['a','b','c'].map(id=>({id,name:id,platform:'instagram'}));
  const plan={db,accountInsights,saveInsights:()=>{}};
  const collector=createInstagramCollector({postingPlan:plan,metaAuth:{status:()=>({connected:true,insightsGranted:true,igId:'ig'}),token:async()=> 'secret',markReconnect:()=>{}},getAccount:id=>accounts.find(a=>a.id===id),getAccounts:()=>accounts,preparePostingAccount:async id=>({id}),safeError:e=>e.message,
    makePublisher:({id})=>({version:'v23.0',call:async()=>({followers_count:10}),accountMetrics:(...args)=>accountMetrics(id,...args),mediaMetrics:async()=>({views:1})})});
  return {db,accountInsights,collector};
}

test('real collection phases isolate one account failure and cap concurrency at two',async()=>{
  let active=0,max=0;const calls=[];
  const f=fixture(async(id)=>{active++;max=Math.max(max,active);calls.push(id);await new Promise(resolve=>setTimeout(resolve,3));active--;if(id==='b')throw Object.assign(new Error('rate'),{metaCode:80002});return {views:1};});
  const result=await f.collector({accountIds:['a','b','c'],ranges:periods.ranges('today','','')},{refreshId:'test',shouldContinue:()=>true,progress:()=>{}});
  assert.equal(max,2);assert.ok(calls.includes('c'));assert.equal(result.errors[0].kind,'rate_limit');
  assert.ok(f.accountInsights.status('b').retry_at>Date.now());
  assert.ok(f.db.prepare("SELECT COUNT(*) n FROM official_account_metrics WHERE account_id='c'").get().n>0);f.db.close();
});

test('changing selection stops old requests after completed results have been saved',async()=>{
  let keepGoing=true;const calls=[];
  const f=fixture(async id=>{calls.push(id);keepGoing=false;return {views:9};});
  await f.collector({accountIds:['a','b','c'],ranges:periods.ranges('today','','')},{refreshId:'test',shouldContinue:()=>keepGoing,progress:()=>{}});
  assert.ok(calls.length<=2);assert.equal(calls.includes('c'),false);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM official_account_metrics').get().n,calls.length);f.db.close();
});

test('cooldown skips network and preserves previous data',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return {views:2};});
  f.accountInsights.saveMetrics('a',1000,2000,{views:7});
  f.accountInsights.setStatus('a','supported',false,Date.now()+60000,'Limite temporário');
  const result=await f.collector({accountIds:['a'],ranges:[{from:1000,to:2000}],force:true},{refreshId:'test',shouldContinue:()=>true,progress:()=>{}});
  assert.equal(calls,0);assert.equal(result.failures.length,1);assert.equal(f.db.prepare('SELECT value FROM official_account_metrics').get().value,7);f.db.close();
});

test('errors distinguish permission, reconnect, timeout and temporary limits',()=>{
  assert.equal(insightsError({metaCode:200}).kind,'permission');assert.equal(insightsError({metaCode:190}).kind,'reconnect');
  assert.equal(insightsError({message:'Tempo limite da conexão da conta.'}).kind,'timeout');
  assert.equal(insightsError({retryAfterMinutes:2},0).retryAt,120000);
});
