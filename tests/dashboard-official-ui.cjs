const assert=require('node:assert/strict');
const path=require('node:path');
const {app,BrowserWindow}=require('electron');

app.setPath('userData',path.join(__dirname,'..','.smoke','dashboard-ui-data'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{preload:path.join(__dirname,'postings-ui-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
  try{
    await win.loadFile(path.join(__dirname,'..','src','ui','index.html'));
    const initial=await win.webContents.executeJavaScript(`(async()=>{
      if(!document.body.dataset.ready)await new Promise(resolve=>{const timer=setInterval(()=>{if(document.body.dataset.ready){clearInterval(timer);resolve();}},25);});
      document.querySelector('[data-page=dashboard]').click();
      await new Promise(resolve=>setTimeout(resolve,250));
      return {title:document.querySelector('[data-panel=dashboard] h1').textContent,cards:document.querySelectorAll('.official-card').length,views:document.querySelector('.official-card strong')?.textContent,chart:!!document.querySelector('.official-graph svg'),ranking:!!document.querySelector('.official-ranking'),reels:document.querySelectorAll('.official-reel').length,queue:!!document.querySelector('.official-queue'),oldHidden:getComputedStyle(document.querySelector('#dashboard-metrics')).display==='none'};
    })()`);
    assert.equal(initial.title,'Dashboard Instagram');
    assert.equal(initial.cards,5);assert.equal(initial.views,'125');
    assert.equal(initial.chart,true);assert.equal(initial.ranking,true);assert.equal(initial.reels,1);assert.equal(initial.queue,true);assert.equal(initial.oldHidden,true);
    const partial=await win.webContents.executeJavaScript(`(async()=>{
      const original=await window.studio.state();
      window.applyStudioState({...original,accounts:[...original.accounts,{...original.accounts[0],id:'ig-missing',handle:'sem-dados'}]});
      await new Promise(resolve=>setTimeout(resolve,220));
      const result={value:document.querySelector('.official-card strong')?.textContent,coverage:document.querySelector('.official-card small')?.textContent,quality:document.querySelector('.official-quality')?.textContent,accounts:[...document.querySelector('#dashboard-account').options].map(option=>option.value),selected:document.querySelector('#dashboard-account').value};
      window.applyStudioState(original);
      await new Promise(resolve=>setTimeout(resolve,220));
      return result;
    })()`);
    assert.deepEqual(partial,{value:'125',coverage:'Parcial: 1 de 2 contas',quality:'Parcial',accounts:['all','ig-test','ig-missing'],selected:'all'});
    const today=await win.webContents.executeJavaScript(`(async()=>{
      const period=document.querySelector('#dashboard-period');period.value='today';period.dispatchEvent(new Event('change'));
      await new Promise(resolve=>setTimeout(resolve,180));
      const root=document.querySelector('.official-dashboard');
      return {compact:!!root.querySelector('.official-day-view'),line:!!root.querySelector('.official-graph svg'),value:root.querySelector('.official-day-view strong')?.textContent,quality:root.querySelector('.official-quality')?.textContent,technical:!!root.querySelector('.official-details')};
    })()`);
    assert.deepEqual(today,{compact:true,line:false,value:'125',quality:'Parcial',technical:true});
    const sort=await win.webContents.executeJavaScript(`(async()=>{
      const select=document.querySelector('.official-reels select');select.value='interactions';select.dispatchEvent(new Event('change'));
      await new Promise(resolve=>setTimeout(resolve,180));
      return {selected:select.value,stats:document.querySelector('.official-reel-stats')?.textContent,button:document.querySelector('.official-reel-footer button')?.textContent};
    })()`);
    assert.equal(sort.selected,'interactions');assert.match(sort.stats,/Curtidas 15/);assert.equal(sort.button,'Mostrar menos');
    const legacy=await win.webContents.executeJavaScript(`(()=>{
      const button=document.querySelector('.official-legacy-toggle');
      const chart=document.querySelector('.dashboard-network-analysis');
      const before=getComputedStyle(chart).display;
      button.click();const open=getComputedStyle(chart).display;
      button.click();return {before,open,closed:getComputedStyle(chart).display};
    })()`);
    assert.equal(legacy.before,'none');assert.notEqual(legacy.open,'none');assert.equal(legacy.closed,'none');
    const wide=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.official-cards')).gridTemplateColumns.split(' ').length");
    win.setSize(850,900);
    await new Promise(resolve=>setTimeout(resolve,120));
    const narrow=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.official-cards')).gridTemplateColumns.split(' ').length");
    assert.ok(narrow<wide,`Grade não reduziu: ${wide} → ${narrow}`);
    console.log('Dashboard oficial: cards, evolução diária, dia compacto, ranking, Reels e fila passaram.');
  }catch(error){console.error('Dashboard oficial UI falhou:',error);process.exitCode=1;}
  finally{win.destroy();app.exit(process.exitCode||0);}
}).catch(error=>{console.error(error);app.exit(1);});
