const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PostingPlan,parts}=require('../src/posting-plan.cjs');

test('fila única distribui 50 vídeos entre 12 contas e preserva os horários do executor',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shared-'));
  let plan=new PostingPlan(path.join(dir,'postings.sqlite'));
  try{
    const ids=Array.from({length:12},(_,i)=>`account-${String(i).padStart(2,'0')}`);
    const config={minMinutes:20,maxMinutes:20,startMinute:0,endMinute:1440,days:[0,1,2,3,4,5,6],timeZone:'America/Sao_Paulo',dailyLimit:0};
    ids.forEach(id=>plan.configure(id,config));
    const files=Array.from({length:50},(_,i)=>path.join(dir,`reel-${String(i).padStart(2,'0')}.mp4`));files.forEach(file=>fs.writeFileSync(file,'x'));
    plan.addShared(ids,files,'');plan.setSharedStatus('running',ids);
    let items=plan.snapshot().items.filter(row=>row.queue_kind==='shared');
    assert.equal(items.length,50);assert.equal(new Set(items.map(row=>row.id)).size,50);
    assert.equal(new Set(items.map(row=>row.account_id)).size,12);
    for(const schedule of plan.snapshot().sharedSchedules){
      const first=items.filter(item=>item.account_id===schedule.account_id).sort((a,b)=>a.position-b.position)[0];
      assert.equal(schedule.next_at,first.scheduled_at);
      assert.ok(plan.dueShared(new Date(first.scheduled_at)).some(row=>row.account_id===schedule.account_id));
    }
    const before=plan.snapshot().sharedSchedules.find(row=>row.account_id===ids[0]).next_at;
    plan.configure(ids[0],{...config,firstAt:new Date(Date.now()+86400000).toISOString()});
    const after=plan.snapshot().sharedSchedules.find(row=>row.account_id===ids[0]).next_at;
    assert.ok(Date.parse(after)>Date.parse(before));
    const removed=items.find(row=>row.account_id===ids[0]);
    plan.remove(removed.id);assert.equal(plan.snapshot().items.filter(row=>row.queue_kind==='shared').length,49);
    const extra=[path.join(dir,'extra-1.mp4'),path.join(dir,'extra-2.mp4')];extra.forEach(file=>fs.writeFileSync(file,'x'));
    plan.addShared(ids,extra,'');assert.equal(plan.snapshot().items.filter(row=>row.queue_kind==='shared').length,51);
    const ordered=plan.snapshot().items.filter(item=>item.queue_kind==='shared'&&item.status==='queued').sort((a,b)=>a.position-b.position);
    const moved=ordered[1];plan.move(moved.id,'up');
    assert.ok(plan.db.prepare('SELECT position FROM items WHERE id=?').get(moved.id).position<plan.db.prepare('SELECT position FROM items WHERE id=?').get(ordered[0].id).position);
    const planned=plan.db.prepare("SELECT id,scheduled_at FROM items WHERE queue_kind='shared' AND status='queued' ORDER BY id").all();
    plan.setSharedStatus('paused');assert.ok(plan.snapshot().sharedSchedules.every(row=>row.status==='paused'));
    plan.setSharedStatus('running',ids);
    assert.deepEqual(plan.db.prepare("SELECT id,scheduled_at FROM items WHERE queue_kind='shared' AND status='queued' ORDER BY id").all(),planned);
    const published=plan.snapshot().items.find(row=>row.queue_kind==='shared'&&row.status==='queued');
    plan.phase(published.id,'published',{mediaId:'media-1'});plan.advance(published.account_id,'shared',new Date(published.scheduled_at));
    assert.equal(plan.snapshot().items.filter(row=>row.queue_kind==='shared'&&row.status==='published').length,1);
    const attention=plan.snapshot().items.find(row=>row.queue_kind==='shared'&&row.status==='queued');
    plan.phase(attention.id,'attention',{error:'Falha de publicação'});plan.pauseAccount(attention.account_id,'shared');
    assert.equal(plan.snapshot().items.filter(row=>row.queue_kind==='shared'&&row.status==='attention').length,1);
    const persisted=plan.db.prepare("SELECT id,scheduled_at FROM items WHERE queue_kind='shared' AND status='queued' ORDER BY id").all();
    plan.close();plan=new PostingPlan(path.join(dir,'postings.sqlite'));
    assert.deepEqual(plan.db.prepare("SELECT id,scheduled_at FROM items WHERE queue_kind='shared' AND status='queued' ORDER BY id").all(),persisted);
    assert.ok(plan.snapshot().sharedSchedules.every(row=>row.status!=='running'));
  }finally{try{plan.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});}
});

test('atraso real desloca o horário da próxima execução da fila única',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shared-delay-'));const plan=new PostingPlan(path.join(dir,'postings.sqlite'));
  try{
    const config={minMinutes:20,maxMinutes:20,startMinute:0,endMinute:1440,days:[0,1,2,3,4,5,6],timeZone:'America/Sao_Paulo'};
    plan.configure('a',config);const files=['a.mp4','b.mp4'].map(name=>path.join(dir,name));files.forEach(file=>fs.writeFileSync(file,'x'));
    plan.addShared(['a'],files,'');plan.setSharedStatus('running',['a']);
    const items=plan.snapshot().items.sort((a,b)=>a.position-b.position),first=items[0],oldNext=items[1].scheduled_at;
    const finished=new Date(Date.parse(first.scheduled_at)+15*60000);
    plan.phase(first.id,'published',{mediaId:'media-a'});plan.db.prepare('UPDATE items SET published_at=? WHERE id=?').run(finished.toISOString(),first.id);
    plan.advance('a','shared',finished);
    const next=plan.db.prepare('SELECT scheduled_at FROM items WHERE id=?').get(items[1].id).scheduled_at;
    assert.ok(Date.parse(next)>Date.parse(oldNext));assert.equal(next,plan.snapshot().sharedSchedules[0].next_at);
    assert.equal(plan.dueShared(new Date(Date.parse(next)-60000)).length,0);
    assert.equal(plan.dueShared(new Date(next)).length,1);
  }finally{plan.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('horários salvos conservam o instante e cada conta interpreta seu fuso',()=>{
  const instant='2026-11-07T02:30:00.000Z';
  assert.equal(parts(new Date(instant),'America/Sao_Paulo').date,'2026-11-06');
  assert.equal(parts(new Date(instant),'Asia/Tokyo').date,'2026-11-07');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shared-zone-'));const plan=new PostingPlan(path.join(dir,'postings.sqlite'));
  try{
    const base={minMinutes:20,maxMinutes:20,startMinute:0,endMinute:1440,days:[0,1,2,3,4,5,6]};
    plan.configure('br',{...base,timeZone:'America/Sao_Paulo'});plan.configure('jp',{...base,timeZone:'Asia/Tokyo'});
    const files=['br.mp4','jp.mp4'].map(name=>path.join(dir,name));files.forEach(file=>fs.writeFileSync(file,'x'));
    plan.addShared(['br'],[files[0]],'');plan.addShared(['jp'],[files[1]],'');
    plan.db.prepare("UPDATE items SET scheduled_at=? WHERE queue_kind='shared'").run(instant);
    assert.ok(plan.snapshot().items.every(row=>row.scheduled_at===instant));
  }finally{plan.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('modo somente Fila única pausa filas individuais sem remover seus vídeos',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shared-only-'));
  let plan=new PostingPlan(path.join(dir,'postings.sqlite'));
  try{
    const config={minMinutes:20,maxMinutes:20,startMinute:0,endMinute:1440,days:[0,1,2,3,4,5,6],timeZone:'America/Sao_Paulo'};
    for(const id of ['a','b'])plan.configure(id,config);
    const files=['a.mp4','b.mp4','shared-a.mp4','shared-b.mp4'].map(name=>path.join(dir,name));
    files.forEach(file=>fs.writeFileSync(file,'x'));
    plan.add('a',files[0],'');plan.add('b',files[1],'');
    plan.setStatus('a','running');plan.setStatus('b','running');
    plan.addShared(['a','b'],files.slice(2),'');
    assert.equal(plan.activateSharedOnly(['a','b']),2);
    let state=plan.snapshot();
    assert.ok(state.schedules.every(row=>row.status==='paused'));
    assert.ok(state.sharedSchedules.every(row=>row.status==='running'));
    assert.equal(state.items.filter(row=>row.queue_kind==='account'&&row.status==='queued').length,2);
    assert.equal(state.items.filter(row=>row.queue_kind==='shared'&&row.status==='queued').length,2);
    assert.equal(plan.due(new Date(Date.now()+86400000)).length,0);
    plan.close();plan=new PostingPlan(path.join(dir,'postings.sqlite'));
    state=plan.snapshot();
    assert.ok(state.schedules.every(row=>row.status==='paused'));
    assert.equal(state.items.filter(row=>row.queue_kind==='account'&&row.status==='queued').length,2);
  }finally{try{plan.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});}
});

test('erro ao ativar somente Fila única não pausa parcialmente as filas individuais',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shared-only-error-'));const plan=new PostingPlan(path.join(dir,'postings.sqlite'));
  try{
    const config={minMinutes:20,maxMinutes:20,startMinute:0,endMinute:1440,days:[0,1,2,3,4,5,6],timeZone:'America/Sao_Paulo'};
    plan.configure('a',config);
    const file=path.join(dir,'a.mp4');fs.writeFileSync(file,'x');
    plan.add('a',file,'');plan.setStatus('a','running');
    plan.addShared(['a'],[file],'');
    assert.throws(()=>plan.activateSharedOnly(['a','missing']),/Configure os horários/);
    assert.equal(plan.snapshot().schedules.find(row=>row.account_id==='a').status,'running');
    assert.equal(plan.snapshot().sharedSchedules.find(row=>row.account_id==='a').status,'stopped');
  }finally{plan.close();fs.rmSync(dir,{recursive:true,force:true});}
});
