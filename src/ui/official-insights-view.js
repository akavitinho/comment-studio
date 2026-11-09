(() => {
  const dashboard=document.querySelector('[data-panel="dashboard"]');
  const panel=element('div','official-dashboard');
  document.querySelector('#dashboard-metrics').before(panel);
  const original=renderDashboard,DAY=86400000;
  const labels={views:'Visualizações',reach:'Alcance',profile_views:'Visitas ao perfil',total_interactions:'Interações'};
  const icons={views:'◉',reach:'◎',profile_views:'◇',total_interactions:'✦',followers:'♙'};
  const number=value=>value==null?'—':Number(value).toLocaleString('pt-BR');
  const dateTime=at=>new Date(at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  const shortDay=at=>new Date(at).toLocaleDateString('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit'});
  const aggregate=(rows,ids,range,key)=>window.dashboardAnalytics.officialAggregate(rows,ids,range,key);
  let ticket=0,metric='views',compare=true,rangeKey='',rangeNow=0,displayKey='',reelSort='views',reelAll=null,reelVisible=5,legacyOpen=false;
  function ranges(){
    const period=document.querySelector('#dashboard-period').value;
    const key=[period,document.querySelector('#dashboard-from').value,document.querySelector('#dashboard-to').value,document.querySelector('#dashboard-compare-from')?.value,document.querySelector('#dashboard-compare-to')?.value].join(':');
    if(key!==rangeKey){rangeKey=key;rangeNow=Math.floor(Date.now()/60000)*60000;}
    const now=rangeNow,today=Math.floor(now/DAY)*DAY;
    let from,to;
    if(period==='custom'){from=Date.parse(`${document.querySelector('#dashboard-from').value}T00:00:00Z`);to=Math.min(now,Date.parse(`${document.querySelector('#dashboard-to').value}T00:00:00Z`)+DAY);}
    else if(period==='yesterday'){from=today-DAY;to=today;}
    else if(period==='24h'){from=now-DAY;to=now;}
    else{from=today-(period==='today'?0:Number(period)-1)*DAY;to=now;}
    let prior=period==='today'?{from:from-DAY,to:to-DAY}:{from:from-(to-from),to:from};
    const customFrom=Date.parse(document.querySelector('#dashboard-compare-from')?.value||''),customTo=Date.parse(document.querySelector('#dashboard-compare-to')?.value||'');
    if(Number.isFinite(customFrom)&&Number.isFinite(customTo)&&customFrom<customTo&&customTo<=from)prior={from:customFrom,to:customTo};
    return [{from,to},prior];
  }
  window.instagramOfficialRanges=ranges;
  document.querySelector('#dashboard-refresh-insights').addEventListener('click',()=>{rangeKey='';ranges();},true);
  const photoObserver=new IntersectionObserver(entries=>{
    for(const {target,isIntersecting} of entries){if(!isIntersecting)continue;photoObserver.unobserve(target);
      window.studio.postingProfilePicture?.(target.dataset.accountId).then(src=>{if(!src||!target.isConnected)return;const img=element('img');img.src=src;img.alt='';target.replaceChildren(img);}).catch(()=>{});
    }
  });
  function portrait(account){
    const avatar=element('span','official-avatar',(account.handle||account.name||'?').replace(/^@/,'').slice(0,1).toUpperCase());
    avatar.dataset.accountId=account.id;
    if(account.meta?.connected)photoObserver.observe(avatar);
    return avatar;
  }
  function status(root,rows,ids,result,range,cached){
    const views=aggregate(rows,ids,range,'views');
    const coverageComplete=views.count===ids.length&&result.authorizedIds.length===ids.length;
    const partialDay=range.to%DAY!==0;
    const quality=!views.count?'Indisponível':coverageComplete&&!partialDay?'Completo':'Parcial';
    const latest=views.latest.length?Math.min(...views.latest):null;
    const bar=element('div','official-status');
    bar.append(element('span',`official-quality quality-${quality.toLowerCase()}`,quality),element('span','',latest?`Atualizado em ${dateTime(latest)}`:'Sem coleta para este período'));
    if(cached)bar.append(element('span','official-stale','Exibindo a última coleta salva'));
    if(quality==='Parcial')bar.append(element('span','official-warning',coverageComplete?'O último dia do período ainda é parcial.':'Algumas contas não têm dados compatíveis neste período.'));
    root.append(bar);
  }
  function cards(root,rows,ids,current,prior,followers){
    const grid=element('div','official-cards');
    for(const key of Object.keys(labels)){
      if(key==='profile_views'&&!rows.some(row=>ids.includes(row.account_id)&&row.metric===key))continue;
      const data=aggregate(rows,ids,current,key),before=aggregate(rows,ids,prior,key);
      const delta=current.to-current.from!==prior.to-prior.from||data.value==null||before.value==null?null:window.dashboardAnalytics.comparisonVariation(data.value,before.value);
      const card=element('div','official-card');
      const heading=element('div','official-card-heading');const icon=element('span','official-icon',icons[key]);icon.setAttribute('aria-hidden','true');
      heading.append(icon,element('span','',labels[key]));card.append(heading,element('strong','',number(data.value??data.partialValue)));
      card.append(element('small','',delta==null?(data.value==null?(data.count?`Parcial: ${data.count} de ${ids.length} contas`:'Indisponível neste período'):'Sem comparação válida'):`${delta>=0?'↑':'↓'} ${Math.abs(delta).toLocaleString('pt-BR',{maximumFractionDigits:1})}% vs. período anterior`));
      if(data.value==null&&data.count)card.title=`${data.count} de ${ids.length} contas com dados; total indisponível.`;
      grid.append(card);
    }
    if(followers.length){
      const latest=ids.map(id=>followers.filter(row=>row.account_id===id).sort((a,b)=>b.fetched_at-a.fetched_at)[0]);
      const complete=ids.length&&latest.every(Boolean);
      const total=complete?latest.reduce((sum,row)=>sum+row.value,0):null;
      const card=element('div','official-card'),heading=element('div','official-card-heading');
      const icon=element('span','official-icon',icons.followers);icon.setAttribute('aria-hidden','true');heading.append(icon,element('span','','Seguidores'));
      card.append(heading,element('strong','',number(total)),element('small','',complete?(ids.length>1?'Soma por conta · última leitura':'Última leitura disponível'):'Dados incompletos'));
      if(complete)card.title=`Seguidores consultados em ${dateTime(Math.min(...latest.map(row=>row.fetched_at)))}. ${ids.length>1?'A soma não representa pessoas únicas.':''}`;
      grid.append(card);
    }
    root.append(grid);
  }
  function graph(root,rows,ids,current,prior){
    const section=element('section','dashboard-panel official-graph');
    const head=element('div','official-section-head'),title=element('div');
    title.append(element('h2','','Evolução do Instagram'));
    const select=element('select');select.setAttribute('aria-label','Métrica da evolução');
    for(const [key,label] of Object.entries(labels))if(key==='views'||rows.some(row=>ids.includes(row.account_id)&&row.metric===key))select.append(new Option(label,key));
    if(![...select.options].some(option=>option.value===metric))metric='views';
    select.value=metric;select.onchange=()=>{metric=select.value;renderDashboard();};
    head.append(title,select);section.append(head);
    const controls=element('div','official-graph-controls'),toggle=element('label');const input=element('input');input.type='checkbox';input.checked=compare;
    input.onchange=()=>{compare=input.checked;renderDashboard();};toggle.append(input,document.createTextNode('Comparar período anterior'));controls.append(toggle);section.append(controls);
    const currentTotal=aggregate(rows,ids,current,metric),previousTotal=aggregate(rows,ids,prior,metric);
    const delta=current.to-current.from!==prior.to-prior.from||currentTotal.value==null||previousTotal.value==null?null:window.dashboardAnalytics.comparisonVariation(currentTotal.value,previousTotal.value);
    const days=Math.ceil((current.to-current.from)/DAY);
    if(days<=1||document.querySelector('#dashboard-period').value==='24h'){
      const compact=element('div','official-day-view');
      compact.append(element('span','',days===1?'Total diário da Meta':'Total do intervalo da Meta'),element('strong','',number(currentTotal.value??currentTotal.partialValue)),element('small','',currentTotal.value==null&&currentTotal.count?`Parcial: ${currentTotal.count} de ${ids.length} contas`:delta==null?'Sem comparação compatível':`${delta>=0?'+':''}${delta.toLocaleString('pt-BR',{maximumFractionDigits:1})}% vs. período anterior`));
      section.append(compact,element('p','official-chart-note','A API não forneceu pontos horários para este total.'));root.append(section);return;
    }
    const points=[];for(let at=current.from;at<current.to;at+=DAY){const data=aggregate(rows,ids,{from:at,to:Math.min(at+DAY,current.to)},metric);points.push({at,value:data.value??data.partialValue,count:data.count});}
    const before=[];for(let at=prior.from;at<prior.to;at+=DAY){const data=aggregate(rows,ids,{from:at,to:Math.min(at+DAY,prior.to)},metric);before.push({at,value:data.value??data.partialValue,count:data.count});}
    if(!points.some(point=>point.value!=null)){section.append(element('div','dashboard-empty','Sem evolução diária disponível para este período.'));root.append(section);return;}
    const legend=element('div','official-legend');legend.append(element('span','official-legend-current','Período atual'));
    if(compare&&before.some(point=>point.value!=null))legend.append(element('span','official-legend-prior','Período anterior'));
    section.append(legend);
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 760 205');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Evolução diária de ${labels[metric]}`);
    const node=(tag,attrs)=>{const item=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))item.setAttribute(key,value);svg.append(item);return item;};
    const max=Math.max(1,...points.map(point=>point.value||0),...(compare?before.map(point=>point.value||0):[]));
    for(let i=0;i<4;i++){const y=20+i*45;node('line',{x1:48,x2:735,y1:y,y2:y,class:'insights-grid'});node('text',{x:42,y:y+4,'text-anchor':'end',class:'insights-axis'}).textContent=number(Math.round(max*(3-i)/3));}
    const x=index=>48+index/Math.max(1,points.length-1)*687;
    const summary=element('p','official-point-summary','Passe o mouse ou use Tab para ver um dia.');summary.setAttribute('aria-live','polite');
    const draw=(series,priorLine)=>{
      let segment=[];const flush=()=>{if(segment.length>1)node('polyline',{points:segment.join(' '),fill:'none',stroke:priorLine?'#85818e':'#ad86df','stroke-width':2.5,'stroke-dasharray':priorLine?'5 5':'none'});segment=[];};
      series.forEach((point,index)=>{if(point.value==null){flush();return;}const y=155-point.value/max*135;segment.push(`${x(index)},${y}`);
        const message=`${priorLine?'Período anterior':'Período atual'} · ${shortDay(point.at)} · ${number(point.value)} ${labels[metric].toLowerCase()}${point.count<ids.length?` · parcial: ${point.count} de ${ids.length} contas`:''}`;
        const dot=node('circle',{cx:x(index),cy:y,r:4,fill:priorLine?'#85818e':'#ad86df',tabindex:0,'aria-label':message});
        dot.addEventListener('pointerenter',()=>{summary.textContent=message;});dot.addEventListener('focus',()=>{summary.textContent=message;});
      });flush();
    };
    if(compare&&prior.to-prior.from===current.to-current.from&&before.length===points.length)draw(before,true);
    draw(points,false);
    points.forEach((point,index)=>{if(index%Math.max(1,Math.ceil(points.length/6))===0||index===points.length-1)node('text',{x:x(index),y:187,'text-anchor':'middle',class:'insights-axis'}).textContent=shortDay(point.at);});
    section.append(svg,summary);
    if(points.some(point=>point.value!=null&&point.count<ids.length))section.append(element('p','official-chart-note','Alguns pontos somam apenas as contas com dados no dia; confira a cobertura ao selecionar cada ponto.'));
    root.append(section);
  }
  function ranking(root,rows,ids,current){
    const section=element('section','dashboard-panel official-ranking'),head=element('div','official-section-head');
    head.append(element('h2','','Contas com melhor desempenho'),element('small','',`Ordenadas por ${labels[metric].toLowerCase()}`));section.append(head);
    if(ids.length===1){
      const account=state.accounts.find(row=>row.id===ids[0]);
      if(account){const identity=element('div','official-rank-row');identity.append(portrait(account),element('strong','',profileLabel(account)),element('span','','Conta selecionada'));section.append(identity);}
      const monitored=(state.postings?.items||[]).filter(item=>item.account_id===ids[0]&&item.status==='published'&&item.media_id).length;
      section.append(element('p','official-subtle',`${monitored} Reels publicados pelo Comment Studio disponíveis para monitoramento.`));root.append(section);return;
    }
    const ranked=ids.map(id=>({account:state.accounts.find(row=>row.id===id),views:aggregate(rows,[id],current,'views').value,reach:aggregate(rows,[id],current,'reach').value,value:aggregate(rows,[id],current,metric).value})).filter(row=>row.account).sort((a,b)=>(b.value??-1)-(a.value??-1));
    const max=Math.max(1,...ranked.map(row=>row.value||0));
    if(!ranked.length)section.append(element('div','dashboard-empty','Nenhuma conta selecionada.'));
    for(const row of ranked){
      const line=element('div','official-rank-row');line.append(portrait(row.account),element('strong','',profileLabel(row.account)));
      const stats=element('span','official-rank-stats',`${number(row.views)} visualizações · ${number(row.reach)} alcance`);line.append(stats);
      const value=element('b','',number(row.value));value.title=labels[metric];line.append(value);
      const bar=element('div','official-rank-meter'),fill=element('span');fill.style.width=`${row.value==null?0:Math.max(2,row.value/max*100)}%`;bar.append(fill);line.append(bar);section.append(line);
    }
    root.append(section);
  }
  function mediaGroups(media,ids){
    const grouped=new Map();
    for(const row of media){if(!ids.includes(row.account_id))continue;
      if(!grouped.has(row.item_id))grouped.set(row.item_id,{...row,values:{}});
      grouped.get(row.item_id).values[row.metric]=row.value;
    }
    return [...grouped.values()].filter(row=>Object.values(row.values).some(value=>value!=null));
  }
  function reels(root,result,ids,current,prior,sequence){
    const section=element('section','dashboard-panel official-reels'),head=element('div','official-section-head');
    const heading=element('div');heading.append(element('h2','','Melhores Reels'),element('small','official-subtle','Acumulado da última leitura de cada Reel'));
    head.append(heading);
    const select=element('select');select.setAttribute('aria-label','Ordenar Reels');
    select.append(new Option('Visualizações','views'),new Option('Alcance','reach'),new Option('Interações disponíveis','interactions'));select.value=reelSort;
    const items=state.postings?.items||[];
    const body=element('div','official-reel-grid'),foot=element('div','official-reel-footer');
    const allButton=element('button','text-button','Ver todos');allButton.type='button';foot.append(allButton);
    head.append(select);section.append(head,body,foot);root.append(section);
    let media=reelAll||result.media;
    const interaction=row=>['likes','comments','shares','saved'].map(key=>row.values[key]).filter(value=>value!=null).reduce((sum,value)=>sum+Number(value),0);
    async function loadAll(){
      if(reelAll)return;
      allButton.disabled=true;allButton.textContent='Carregando…';
      try{const data=await window.studio.instagramOfficialMetrics({accountIds:ids,from:prior.from,to:current.to,allMedia:true});if(sequence!==ticket)return;reelAll=data.media;media=reelAll;}
      catch(error){allButton.textContent=error.message;allButton.disabled=false;return;}
      allButton.disabled=false;
    }
    function draw(){
      const available=mediaGroups(media,ids);
      for(const option of select.options){const key=option.value;option.disabled=Boolean(reelAll)&&(key==='reach'?!available.some(row=>row.values.reach!=null):key==='interactions'?!available.some(row=>['likes','comments','shares','saved'].some(metric=>row.values[metric]!=null)):false);}
      if(select.selectedOptions[0]?.disabled){reelSort='views';select.value='views';}
      const score=row=>reelSort==='interactions'?interaction(row):row.values[reelSort];
      const sorted=available.filter(row=>reelSort==='interactions'?['likes','comments','shares','saved'].some(key=>row.values[key]!=null):score(row)!=null).sort((a,b)=>(score(b)||0)-(score(a)||0));
      body.replaceChildren();
      if(!sorted.length)body.append(element('div','dashboard-empty','Nenhum Reel com essa métrica disponível.'));
      for(const video of sorted.slice(0,reelVisible)){
        const item=items.find(row=>row.id===video.item_id),account=state.accounts.find(row=>row.id===video.account_id);
        const card=element('article','official-reel'),thumb=element('div','official-reel-thumb','▶');
        const info=element('div','official-reel-body');
        info.append(element('strong','',video.caption||item?.file?.split(/[\\/]/).pop()||'Reel'),element('span','',account?profileLabel(account):'Conta'));
        const stats=element('div','official-reel-stats');
        for(const [key,label] of [['views','Visualizações'],['reach','Alcance'],['likes','Curtidas'],['comments','Comentários'],['shares','Compartilhamentos'],['saved','Salvamentos']])
          if(video.values[key]!=null)stats.append(element('span','',`${label} ${number(video.values[key])}`));
        if(video.values.ig_reels_avg_watch_time!=null)stats.append(element('span','',`Tempo médio ${(video.values.ig_reels_avg_watch_time/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} s`));
        info.append(stats);card.append(thumb,info);body.append(card);
        window.studio.videoThumbnail?.(video.item_id).then(src=>{if(!src||!thumb.isConnected)return;const image=element('img');image.src=src;image.alt='';thumb.replaceChildren(image);}).catch(()=>{});
      }
      allButton.hidden=!sorted.length;
      allButton.textContent=reelAll?(reelVisible<sorted.length?'Mostrar mais':'Mostrar menos'):'Ver todos';
    }
    select.onchange=async()=>{reelSort=select.value;reelVisible=5;if(reelSort!=='views')await loadAll();if(sequence===ticket)draw();};
    allButton.onclick=async()=>{if(!reelAll){await loadAll();reelVisible=30;}else reelVisible=reelVisible<mediaGroups(media,ids).length?reelVisible+30:5;if(sequence===ticket)draw();};
    draw();
  }
  function queue(root,ids,current){
    const section=element('section','dashboard-panel official-queue'),head=element('div','official-section-head');
    head.append(element('h2','','Fila de publicações'));
    const link=element('button','text-button','Ver fila →');link.type='button';link.onclick=()=>document.querySelector('#dashboard-view-queue').click();head.append(link);section.append(head);
    const items=(state.postings?.items||[]).filter(item=>ids.includes(item.account_id));
    const pending=items.filter(item=>['queued','uploading','processing','publishing'].includes(item.status)).length;
    const published=items.filter(item=>item.status==='published'&&Date.parse(item.published_at)>=current.from&&Date.parse(item.published_at)<current.to).length;
    const attention=new Set(items.filter(item=>['attention','uncertain'].includes(item.status)).map(item=>item.account_id));
    for(const account of state.accounts)if(ids.includes(account.id)&&(account.error||account.meta?.needsReconnect))attention.add(account.id);
    const strip=element('div','official-queue-stats');
    for(const [value,label] of [[pending,'Vídeos pendentes'],[published,'Publicados no período'],[attention.size,'Contas com atenção']]){const stat=element('div');stat.append(element('strong','',number(value)),element('span','',label));strip.append(stat);}
    section.append(strip);root.append(section);
  }
  renderDashboard=()=>{
    original();
    const instagram=document.querySelector('#dashboard-platform').value==='instagram';
    dashboard.classList.toggle('official-instagram',instagram);dashboard.classList.toggle('official-show-reels',instagram&&legacyOpen);panel.hidden=!instagram;
    for(const id of ['dashboard-start-time','dashboard-end-time','dashboard-group']){const field=document.getElementById(id);field.disabled=instagram;field.closest('label').hidden=instagram;}
    for(const selector of ['#dashboard-metrics','.dashboard-network-analysis','.analytics-panel','.dashboard-analysis-bottom','.insights-queue-panel'])
      for(const node of dashboard.querySelectorAll(selector))node.hidden=instagram;
    const sequence=++ticket;if(!instagram)return;
    dashboard.querySelector('h1').textContent='Dashboard Instagram';
    const refreshStatus=document.querySelector('#dashboard-refresh-status'),refreshDetail=refreshStatus.textContent;
    refreshStatus.title=refreshDetail;
    refreshStatus.textContent=dashboardRefreshing?'Atualizando métricas…':dashboardBackgroundRefreshing?'Atualizando Reels…':refreshDetail;
    const [current,prior]=ranges();
    if(!Number.isFinite(current.from)||!Number.isFinite(current.to)||current.from>=current.to){panel.replaceChildren(element('p','dashboard-empty','Selecione um período válido.'));return;}
    const ids=state.accounts.filter(account=>account.platform==='instagram'&&dashboardAccountMatches(account.id,'instagram')).map(account=>account.id);
    const key=`${ids.join(',')}:${current.from}:${current.to}`;
    if(key!==displayKey){panel.replaceChildren(element('p','official-loading','Carregando dados salvos…'));displayKey=key;reelAll=null;reelVisible=5;}
    window.studio.instagramOfficialMetrics({accountIds:ids,from:prior.from,to:current.to}).then(result=>{
      if(sequence!==ticket)return;
      const display=window.dashboardAnalytics.officialDisplayRange(result.metrics,ids,current,prior,document.querySelector('#dashboard-period').value);
      const shown=display.current;
      const customComparison=document.querySelector('#dashboard-compare-from')?.value&&document.querySelector('#dashboard-compare-to')?.value;
      const shownPrior=customComparison?prior:display.prior;
      photoObserver.disconnect();panel.replaceChildren();
      status(panel,result.metrics,ids,result,shown,display.cached);
      cards(panel,result.metrics,ids,shown,shownPrior,result.followers||[]);
      graph(panel,result.metrics,ids,shown,shownPrior);
      ranking(panel,result.metrics,ids,shown);
      reels(panel,result,ids,shown,shownPrior,sequence);
      queue(panel,ids,shown);
      const technical=element('details','official-details');technical.append(element('summary','','Sobre os dados'));
      const views=aggregate(result.metrics,ids,shown,'views');
      technical.append(element('p','','Os totais da conta incluem todos os formatos autorizados. As métricas dos Reels são individuais. O alcance de contas diferentes pode incluir as mesmas pessoas.'));
      technical.append(element('p','',`Cobertura de visualizações: ${views.count} de ${ids.length} contas. Períodos informados pela Meta em UTC; não há série horária para totais diários.`));
      panel.append(technical);
      const legacy=element('button','text-button official-legacy-toggle',legacyOpen?'Ocultar análises dos Reels monitorados':'Ver análises dos Reels monitorados');
      legacy.type='button';legacy.setAttribute('aria-expanded',String(legacyOpen));
      legacy.onclick=()=>{legacyOpen=!legacyOpen;dashboard.classList.toggle('official-show-reels',legacyOpen);legacy.setAttribute('aria-expanded',String(legacyOpen));legacy.textContent=legacyOpen?'Ocultar análises dos Reels monitorados':'Ver análises dos Reels monitorados';};
      panel.append(legacy);
    }).catch(error=>{if(sequence===ticket)panel.replaceChildren(element('p','dashboard-empty',error.message));});
  };
  const firstRender=setInterval(()=>{
    if(!document.body.dataset.ready)return;
    clearInterval(firstRender);
    renderDashboard();
  },25);
  setTimeout(()=>clearInterval(firstRender),30000);
})();
