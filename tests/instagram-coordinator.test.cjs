const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {InstagramInsightsCoordinator}=require('../src/instagram-insights-coordinator.cjs');
const {InstagramDashboardController}=require('../src/ui/instagram-dashboard-controller.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const request=id=>({accountIds:[id],ranges:[{from:1000,to:2000}],selectionKey:id});

test('coordinator deduplicates requests and prioritizes only the newest pending filter',async()=>{
  const db=new DatabaseSync(':memory:'),gate=deferred(),calls=[],events=[];
  const coordinator=new InstagramInsightsCoordinator({db,onProgress:p=>events.push(p),collect:async(req,ctx)=>{
    calls.push(req.selectionKey);if(req.selectionKey==='a'){await gate.promise;assert.equal(ctx.shouldContinue(),false);}return {updated:1};
  }});
  const first=coordinator.submit(request('a'));assert.equal(coordinator.submit(request('a')).refreshId,first.refreshId);
  await tick();coordinator.submit(request('b'));coordinator.submit(request('c'));
  gate.resolve();await tick();await tick();
  assert.deepEqual(calls,['a','c']);assert.ok(events.some(p=>p.phase==='superseded'));
  assert.equal(coordinator.snapshot().last.selectionKey,'c');assert.equal(coordinator.snapshot().last.status,'complete');db.close();
});

test('interrupted collection resumes from a persisted request without reviving completed jobs',async()=>{
  const db=new DatabaseSync(':memory:'),gate=deferred();
  const first=new InstagramInsightsCoordinator({db,collect:()=>gate.promise});first.submit(request('a'));await tick();first.stop();gate.resolve({});await first.running;
  const resumed=[];const second=new InstagramInsightsCoordinator({db,collect:async req=>{resumed.push(req.selectionKey);return {};}});
  assert.equal(second.snapshot().recoverable,true);second.resume();await second.running;
  assert.deepEqual(resumed,['a']);assert.equal(new InstagramInsightsCoordinator({db,collect:async()=>{}}).snapshot().recoverable,false);db.close();
});

test('failed collector releases the queue and the latest selection still runs',async()=>{
  const db=new DatabaseSync(':memory:'),gate=deferred(),calls=[];
  const coordinator=new InstagramInsightsCoordinator({db,collect:async req=>{calls.push(req.selectionKey);if(req.selectionKey==='a'){await gate.promise;throw new Error('offline');}return {};}});
  coordinator.submit(request('a'));await tick();coordinator.submit(request('b'));gate.resolve();await tick();await tick();
  assert.deepEqual(calls,['a','b']);assert.equal(coordinator.snapshot().last.status,'complete');db.close();
});

test('renderer ignores stale reads, stale progress and responses after leaving Instagram',async()=>{
  const reads=[];const controller=new InstagramDashboardController({api:{instagramOfficialMetrics:()=>{const d=deferred();reads.push(d);return d.promise;}}});
  controller.select('a',request('a'));const a=controller.read({});controller.select('b',request('b'));const b=controller.read({});
  reads[1].resolve({value:'b'});assert.equal((await b).value,'b');reads[0].resolve({value:'a'});assert.equal(await a,null);
  controller.accept({refreshId:'old',selectionKey:'a',phase:'started',sequence:1});assert.equal(controller.busy,false);
  controller.accept({refreshId:'new',selectionKey:'b',phase:'background-complete',sequence:4});
  controller.accept({refreshId:'new',selectionKey:'b',phase:'started',sequence:1});assert.equal(controller.busy,false);
  const hidden=controller.read({});controller.deactivate();reads[2].resolve({value:'hidden'});assert.equal(await hidden,null);
});

test('completion arriving before acknowledgement never leaves renderer stuck updating',async()=>{
  let controller;
  controller=new InstagramDashboardController({api:{refreshInstagramInsights:async req=>{
    controller.accept({refreshId:'job',selectionKey:req.selectionKey,phase:'background-complete',sequence:3});
    return {refreshId:'job',selectionKey:req.selectionKey,backgroundActive:true};
  }}});
  controller.select('a',request('a'));await controller.refresh();assert.equal(controller.busy,false);assert.equal(controller.label(),'Atualização concluída');
});

test('filter change can queue its request while previous acknowledgement is outstanding',async()=>{
  const pending=[];const controller=new InstagramDashboardController({api:{refreshInstagramInsights:req=>{const d=deferred();pending.push({req,...d});return d.promise;}}});
  controller.select('a',request('a'));const a=controller.refresh();controller.select('b',request('b'));const b=controller.refresh();
  pending[1].resolve({refreshId:'b',selectionKey:'b',queued:true});await b;
  pending[0].resolve({refreshId:'a',selectionKey:'a'});await a;
  assert.equal(controller.collection.refreshId,'b');assert.equal(controller.busy,true);
});
