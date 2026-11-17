const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {app,BrowserWindow}=require('electron');
fs.mkdirSync(path.join(__dirname,'..','.smoke'),{recursive:true});

app.setPath('userData',path.join(__dirname,'..','.smoke','dashboard-ui-data'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{offscreen:true,preload:path.join(__dirname,'postings-ui-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
  try{
    await win.loadFile(path.join(__dirname,'..','src','ui','index.html'));
    const initial=await win.webContents.executeJavaScript(`(async()=>{
      if(!document.body.dataset.ready)await new Promise(resolve=>{const timer=setInterval(()=>{if(document.body.dataset.ready){clearInterval(timer);resolve();}},25);});
      document.querySelector('.nav-group[data-platform="instagram"] button').click();
      document.querySelector('[data-page=dashboard]').click();
      await new Promise(resolve=>setTimeout(resolve,250));
      return {title:document.querySelector('[data-panel=dashboard] h1').textContent,cards:document.querySelectorAll('.official-card').length,views:document.querySelector('.official-card strong')?.textContent,chart:!!document.querySelector('.official-graph svg'),activity:!!document.querySelector('.official-activity'),ranking:!!document.querySelector('.official-ranking'),reels:document.querySelectorAll('.official-reel').length,queue:!!document.querySelector('.official-queue'),oldHidden:getComputedStyle(document.querySelector('#dashboard-metrics')).display==='none'};
    })()`);
    assert.equal(initial.title,'Dashboard Instagram');
    assert.equal(initial.cards,5);assert.equal(initial.views,'125');
    assert.equal(initial.chart,true);assert.equal(initial.activity,true);assert.equal(initial.ranking,true);assert.equal(initial.reels,1);assert.equal(initial.queue,true);assert.equal(initial.oldHidden,true);
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('.official-ranking .account-tag')?.textContent"),'#Contas antigas');
    assert.equal(await win.webContents.executeJavaScript("document.querySelector('.official-ranking .account-tag')?.style.getPropertyValue('--tag-color')"),'#cc3366');
    const collection=await win.webContents.executeJavaScript(`(async()=>{
      window.instagramDashboard.setAuto(false);await window.testInsights.configure(true);
      const button=document.querySelector('#dashboard-refresh-insights');button.click();
      await new Promise(resolve=>setTimeout(resolve,120));
      const busy=button.disabled;button.click();
      const calls=await window.testInsights.calls();
      await window.testInsights.emit({platform:'instagram',refreshId:'test-refresh',phase:'background-complete',updated:1,checked:1,failures:[]});
      await new Promise(resolve=>setTimeout(resolve,120));
      return {busy,calls,finished:!button.disabled};
    })()`);
    assert.deepEqual(collection,{busy:true,calls:1,finished:true});
    const stable=await win.webContents.executeJavaScript(`(async()=>{
      const card=document.querySelector('.official-rank-row'),reel=document.querySelector('.official-reel');
      await new Promise(resolve=>setTimeout(resolve,120));
      const imagesLoaded=Boolean(reel.querySelector('.official-reel-thumb img'));
      const original=await window.studio.state();
      window.applyStudioState(original);
      await new Promise(resolve=>setTimeout(resolve,180));
      const unchanged=card===document.querySelector('.official-rank-row')&&reel===document.querySelector('.official-reel');
      window.applyStudioState({...original,postings:{...original.postings,items:original.postings.items.map(item=>item.id==='video-published'?{...item,caption:'Legenda atualizada'}:item)}});
      await new Promise(resolve=>setTimeout(resolve,180));
      return {imagesLoaded,unchanged,imagesKept:Boolean(reel.querySelector('.official-reel-thumb img')),changed:reel!==document.querySelector('.official-reel')};
    })()`);
    assert.deepEqual(stable,{imagesLoaded:true,unchanged:true,imagesKept:true,changed:true});
    const partial=await win.webContents.executeJavaScript(`(async()=>{
      const original=await window.studio.state();
      window.applyStudioState({...original,accounts:[...original.accounts,{...original.accounts[0],id:'ig-missing',handle:'sem-dados',tags:[]}]});
      await new Promise(resolve=>setTimeout(resolve,220));
      const result={value:document.querySelector('.official-card strong')?.textContent,coverage:document.querySelector('.official-card small')?.textContent,quality:document.querySelector('.official-quality')?.textContent,accounts:[...document.querySelector('#dashboard-account').options].map(option=>option.value),selected:document.querySelector('#dashboard-account').value};
      const tag=document.querySelector('#dashboard-tag');tag.value='contas antigas';tag.dispatchEvent(new Event('change'));
      await new Promise(resolve=>setTimeout(resolve,220));
      result.taggedAccounts=[...document.querySelector('#dashboard-account').options].map(option=>option.value);
      result.taggedRanking=document.querySelector('.official-ranking .account-tag')?.textContent;
      tag.value='all';tag.dispatchEvent(new Event('change'));
      window.applyStudioState(original);
      await new Promise(resolve=>setTimeout(resolve,220));
      return result;
    })()`);
    assert.deepEqual(partial,{value:'125',coverage:'Parcial: 1 de 2 contas',quality:'Parcial',accounts:['all','ig-test','ig-missing'],selected:'all',taggedAccounts:['all','ig-test'],taggedRanking:'#Contas antigas'});
    const today=await win.webContents.executeJavaScript(`(async()=>{
      const period=document.querySelector('#dashboard-period');period.value='today';period.dispatchEvent(new Event('change'));
      await new Promise(resolve=>setTimeout(resolve,180));
      const root=document.querySelector('.official-dashboard');
      return {compact:!!root.querySelector('.official-day-view'),line:!!root.querySelector('.official-graph svg'),value:root.querySelector('.official-day-view strong')?.textContent,quality:root.querySelector('.official-quality')?.textContent,technical:!!root.querySelector('.official-details')};
    })()`);
    assert.deepEqual(today,{compact:true,line:true,value:'125',quality:'Parcial',technical:true});
    const sort=await win.webContents.executeJavaScript(`(async()=>{
      const select=document.querySelector('.official-reels select');select.value='interactions';select.dispatchEvent(new Event('change'));
      await new Promise(resolve=>setTimeout(resolve,180));
      return {selected:select.value,stats:document.querySelector('.official-reel-stats')?.textContent,button:document.querySelector('.official-reel-footer button')?.textContent};
    })()`);
    assert.equal(sort.selected,'interactions');assert.match(sort.stats,/Curtidas 15/);assert.equal(sort.button,'Mostrar menos');
    const activity=await win.webContents.executeJavaScript(`(async()=>{
      const original=await window.studio.state(),now=Date.now();
      const item={...original.postings.items.find(row=>row.id==='video-published'),published_at:new Date(now-1800000).toISOString()};
      window.applyStudioState({...original,postings:{...original.postings,items:original.postings.items.map(row=>row.id===item.id?item:row),insightHistory:[
        {item_id:item.id,fetched_at:new Date(now-1200000).toISOString(),views:10},
        {item_id:item.id,fetched_at:new Date(now-600000).toISOString(),views:18}
      ]}});
      document.querySelector('#dashboard-period').value='7';document.querySelector('#dashboard-period').dispatchEvent(new Event('change'));
      await new Promise(resolve=>setTimeout(resolve,250));
      return {chart:!!document.querySelector('.official-activity svg'),summary:document.querySelector('.official-activity .official-chart-note')?.textContent,posted:[...document.querySelectorAll('.official-card')].find(card=>card.textContent.includes('Reels publicados'))?.querySelector('strong')?.textContent};
    })()`);
    assert.equal(activity.chart,true);assert.match(activity.summary,/1 Reel publicado/);assert.equal(activity.posted,'1');
    const navigation=await win.webContents.executeJavaScript(`(async()=>{
      const periodBefore=document.querySelector('#dashboard-period').value;
      document.querySelector('.nav-group[data-platform="x"] button').click();
      await new Promise(resolve=>setTimeout(resolve,180));
      const x={selected:localStorage.getItem('comment-studio-active-platform'),title:document.querySelector('[data-panel="dashboard"] h1').textContent,count:document.querySelector('#account-count').textContent,instagramVisible:!document.querySelector('.official-dashboard').hidden,networkSubitems:document.querySelectorAll('.nav-group .nav-item').length,xCampaignVisible:!document.querySelector('.nav-general [data-page="x"]').hidden};
      document.querySelector('.nav-general [data-page="x"]').click();
      x.xCampaignOpened=!document.querySelector('[data-panel="x"]').hidden;
      document.querySelector('[data-page="postings"]').click();
      x.postings=document.querySelector('#postings-unavailable')?.textContent;
      document.querySelector('.nav-group[data-platform="instagram"] button').click();
      await new Promise(resolve=>setTimeout(resolve,180));
      x.instagramTitle=document.querySelector('[data-panel="dashboard"] h1').textContent;
      x.instagramPanelHidden=document.querySelector('.official-dashboard').hidden;
      x.instagramCampaignSoon=!document.querySelector('#campaigns-unavailable-nav').hidden;
      x.periodBefore=periodBefore;x.periodAfter=document.querySelector('#dashboard-period').value;
      x.notice=document.querySelector('#notice').hidden?'':document.querySelector('#notice').textContent;
      x.instagramPostings=(()=>{document.querySelector('[data-page="postings"]').click();return document.querySelector('[data-panel="postings"]').classList.contains('unavailable');})();
      document.querySelector('[data-page="dashboard"]').click();
      await new Promise(resolve=>setTimeout(resolve,180));
      x.returnTitle=document.querySelector('[data-panel="dashboard"] h1').textContent;
      x.returnPanelHidden=document.querySelector('.official-dashboard').hidden;
      return x;
    })()`);
    assert.equal(navigation.selected,'x');assert.match(navigation.title,/Twitter/);assert.equal(navigation.count,'1');assert.equal(navigation.instagramVisible,false);assert.equal(navigation.networkSubitems,0);assert.equal(navigation.xCampaignVisible,true);assert.equal(navigation.xCampaignOpened,true);assert.match(navigation.postings,/ainda não estão disponíveis/);assert.equal(navigation.instagramPostings,false);assert.equal(navigation.instagramTitle,'Dashboard Instagram',JSON.stringify(navigation));assert.equal(navigation.instagramPanelHidden,false);assert.equal(navigation.instagramCampaignSoon,true);assert.equal(navigation.returnTitle,'Dashboard Instagram',JSON.stringify(navigation));assert.equal(navigation.returnPanelHidden,false);assert.equal(navigation.periodBefore,'7');assert.equal(navigation.periodAfter,'7');
    await new Promise(resolve=>setTimeout(resolve,220));
    await win.webContents.executeJavaScript("document.querySelector('.nav-group[data-platform=\"instagram\"] button').click();document.querySelector('[data-page=dashboard]').click();window.scrollTo(0,0)");
    win.webContents.invalidate();
    await new Promise(resolve=>setTimeout(resolve,80));
    fs.writeFileSync(path.join(__dirname,'..','.smoke','dashboard-wide.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("const detail=document.querySelector('.official-activity').closest('details');detail.open=true;document.querySelector('.official-activity').scrollIntoView({block:'start'})");
    win.webContents.invalidate();
    await new Promise(resolve=>setTimeout(resolve,80));
    fs.writeFileSync(path.join(__dirname,'..','.smoke','dashboard-activity.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript('window.scrollTo(0,0)');
    const wide=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.official-cards')).gridTemplateColumns.split(' ').length");
    win.setSize(850,900);
    await new Promise(resolve=>setTimeout(resolve,120));
    fs.writeFileSync(path.join(__dirname,'..','.smoke','dashboard-narrow.png'),(await win.webContents.capturePage()).toPNG());
    const narrow=await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.official-cards')).gridTemplateColumns.split(' ').length");
    assert.ok(narrow<wide,`Grade não reduziu: ${wide} → ${narrow}`);
    const general=await win.webContents.executeJavaScript(`(async()=>{
      const original=await window.studio.state(),at=new Date().toISOString();
      window.applyStudioState({...original,accounts:original.accounts.map(account=>account.platform==='instagram'?{...account,proxyId:'ig-only'}:account),proxies:[...original.proxies,{id:'ig-only',name:'Proxy IG',protocol:'http',host:'127.0.0.2',port:8081},{id:'unused',name:'Proxy livre',protocol:'http',host:'127.0.0.3',port:8082}],attempts:[{id:'tt-attempt',accountName:'TikTok',status:'sent',at}],xAttempts:[{id:'x-attempt',accountName:'X',status:'confirmed',action:'like',at}]});
      document.querySelector('.nav-group[data-platform="x"] button').click();
      document.querySelector('[data-page="accounts"]').click();
      const accounts=document.querySelector('#account-list').textContent;
      document.querySelector('[data-page="proxies"]').click();
      const proxies=[...document.querySelectorAll('#proxy-list .proxy-card h3')].map(node=>node.textContent);
      document.querySelector('[data-page="history"]').click();
      const history=document.querySelector('#history-list').textContent;
      downloadState.links=[{platform:'Instagram',label:'Instagram Reels',url:'https://www.instagram.com/reel/test/'},{platform:'YouTube',label:'YouTube',url:'https://www.youtube.com/watch?v=sample123'}];
      downloadState.totalFound=2;mediaState.outputDir='C:\\Teste';renderMedia();
      const media={blocked:document.querySelector('#download-start').disabled,message:document.querySelector('#download-link-list').textContent};
      window.applyStudioState(original);document.querySelector('.nav-group[data-platform="instagram"] button').click();
      return {accounts,proxies,history,media};
    })()`);
    assert.match(general.accounts,/Clássico Criador/);assert.doesNotMatch(general.accounts,/Perfil de teste/);
    assert.deepEqual(general.proxies,['Proxy Brasil','Proxy livre']);
    assert.match(general.history,/X/);assert.doesNotMatch(general.history,/TikTok|Instagram/);
    assert.equal(general.media.blocked,true);assert.match(general.media.message,/Selecione essa rede/);assert.doesNotMatch(general.media.message,/Instagram Reels/);
    const tiktok=await win.webContents.executeJavaScript(`(()=>{document.querySelector('.nav-group[data-platform="tiktok"] button').click();const title=document.querySelector('[data-panel="dashboard"] h1').textContent,visible=!document.querySelector('.nav-general [data-page="campaign"]').hidden;document.querySelector('.nav-general [data-page="campaign"]').click();const campaignOpened=!document.querySelector('[data-panel="campaign"]').hidden;document.querySelector('[data-page="postings"]').click();return {title,visible,campaignOpened,unavailable:!document.querySelector('#postings-unavailable').hidden};})()`);
    assert.match(tiktok.title,/TikTok/);assert.equal(tiktok.visible,true);assert.equal(tiktok.campaignOpened,true);assert.equal(tiktok.unavailable,true);
    await win.webContents.executeJavaScript("document.querySelector('.nav-group[data-platform=\"x\"] button').click()");
    await win.webContents.reloadIgnoringCache();
    const restored=await win.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<80&&(!document.body.dataset.ready||!document.body.dataset.dashboardReady);i++)await new Promise(resolve=>setTimeout(resolve,25));
      return {platform:localStorage.getItem('comment-studio-active-platform'),selected:document.querySelector('.nav-group.selected-platform')?.dataset.platform,title:document.querySelector('[data-panel="dashboard"] h1').textContent,count:document.querySelector('#account-count').textContent};
    })()`);
    assert.equal(restored.platform,'x');assert.equal(restored.selected,'x');assert.match(restored.title,/Twitter/);assert.equal(restored.count,'1');
    fs.writeFileSync(path.join(__dirname,'..','.smoke','dashboard-ui-result.txt'),'passed');
    console.log('Dashboard oficial: cards, evolução diária, atividade horária, ranking, Reels e fila passaram.');
  }catch(error){fs.mkdirSync(path.join(__dirname,'..','.smoke'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','.smoke','dashboard-ui-result.txt'),String(error.stack||error));console.error('Dashboard oficial UI falhou:',error);process.exitCode=1;}
  finally{win.destroy();app.exit(process.exitCode||0);}
}).catch(error=>{console.error(error);app.exit(1);});
