(() => {
  const dashboard=document.querySelector('[data-panel="dashboard"]');
  const panel=element('div','official-dashboard');
  document.querySelector('#dashboard-metrics').before(panel);
  const DAY=86400000,periods=window.instagramPeriods;
  document.querySelector(".dashboard-toolbar").append(element("span","official-timezone","Horário de Brasília"));
  const labels={views:'Visualizações',reach:'Alcance',total_interactions:'Interações'};
  const icons={views:'◉',reach:'◎',profile_views:'◇',total_interactions:'✦',followers:'♙'};
  const number=value=>value==null?'—':Number(value).toLocaleString('pt-BR');
  const dateTime=at=>new Date(at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:periods.timezone});
  const shortDay=at=>new Date(at).toLocaleDateString('pt-BR',{timeZone:periods.timezone,day:'2-digit',month:'2-digit'});
  const aggregate=(rows,ids,range,key)=>window.dashboardAnalytics.officialAggregate(rows,ids,range,key,false);
  let ticket=0,metric='views',compare=true,rangeNow=0,rangeLocalDay='',displayKey='',renderKey='',reelSort='views',reelAll=null,reelVisible=5,activityDay='',activityExpanded=false;
  const localDay=()=>periods.dayKey(Date.now());
  const controller=new window.InstagramDashboardController({api:window.studio,onChange:()=>{if(activePlatform==='instagram'&&!dashboard.hidden)renderDashboard();}});
  let autoEnabled=localStorage.getItem('comment-studio-instagram-auto')!=='false';
  window.instagramDashboard={controller,refresh:force=>controller.refresh(force),setAuto:enabled=>{autoEnabled=enabled;localStorage.setItem('comment-studio-instagram-auto',String(enabled));renderDashboard();if(enabled)window.scheduleInstagramRefresh();}};
  window.onInsightsProgress?.(progress=>{if(progress.platform==='instagram')controller.accept(progress);});
  const accountPhotos=new Map(),reelThumbnails=new Map();
  function cachedImage(cache,id,target,load){
    let entry=cache.get(id);
    if(entry?.src){const img=element('img');img.alt='';img.src=entry.src;target.replaceChildren(img);return;}
    if(!entry){
      entry={src:null,promise:null};cache.set(id,entry);
      entry.promise=Promise.resolve().then(load).then(src=>{
        if(!src){cache.delete(id);return null;}
        entry.src=src;
        if(cache.size>150)cache.delete(cache.keys().next().value);
        return src;
      }).catch(()=>{cache.delete(id);return null;});
    }
    entry.promise.then(src=>{
      if(!src||!target.isConnected)return;
      const img=element('img');img.alt='';
      img.onload=()=>{if(target.isConnected)target.replaceChildren(img);};
      img.src=src;
    });
  }
  function ranges(){
    rangeNow=Math.floor(Date.now()/60000)*60000;rangeLocalDay=localDay();
    try { const result=periods.ranges(document.querySelector('#dashboard-period').value,document.querySelector('#dashboard-from').value,document.querySelector('#dashboard-to').value,rangeNow); document.querySelector('#dashboard-invalid-range').hidden=true;return result; }
    catch(error){const notice=document.querySelector('#dashboard-invalid-range');notice.hidden=false;notice.textContent=error.message;return [{from:NaN,to:NaN},{from:NaN,to:NaN}];}
  }
  function activityRange(){return ranges()[0];}
  window.instagramOfficialRanges=ranges;
  document.querySelector('#dashboard-refresh-insights').addEventListener('click',()=>{ranges();},true);
  const progressLabel=()=>controller.label();
  const photoObserver=new IntersectionObserver(entries=>{
    for(const {target,isIntersecting} of entries){if(!isIntersecting)continue;photoObserver.unobserve(target);
      cachedImage(accountPhotos,target.dataset.accountId,target,()=>window.studio.postingProfilePicture?.(target.dataset.accountId));
    }
  });
  function portrait(account){
    const avatar=element('span','official-avatar',(account.handle||account.name||'?').replace(/^@/,'').slice(0,1).toUpperCase());
    avatar.dataset.accountId=account.id;
    if(account.meta?.connected){
      if(accountPhotos.get(account.id)?.src)cachedImage(accountPhotos,account.id,avatar);
      else photoObserver.observe(avatar);
    }
    return avatar;
  }
  function status(root,rows,ids,result,range,cached,requested){
    const views=aggregate(rows,ids,range,'views');
    const coverageComplete=views.count===ids.length&&result.authorizedIds.length===ids.length;
    const partialDay=range.to>periods.midnight(periods.dayKey(Date.now()));
    const quality=!views.count?'Indisponível':coverageComplete&&!partialDay?'Completo':'Parcial';
    const latest=views.latest.length?Math.min(...views.latest):null;
    const bar=element('div','official-status');
    bar.append(element('span',`official-quality quality-${quality.toLowerCase()}`,quality));
    if(cached){
      const previous=`coleta de ${dateTime(range.from)} a ${dateTime(range.to)}`;
      bar.append(element('span','official-stale',requested.from>=range.to?`Sem dados de ${shortDay(requested.from)}; exibindo ${previous}`:`Exibindo ${previous}`));
    }
    if(quality==='Parcial')bar.append(element('span','official-warning',coverageComplete?'Hoje ainda está em andamento.':'Há contas sem dados no período.'));
    bar.append(element('span','','Consulta: '+dateTime(range.from)+' → '+dateTime(range.to)));
    for(const account of result.accounts||[]){if(!account.message&&!account.retry_at)continue;const name=state.accounts.find(row=>row.id===account.accountId);bar.append(element('span','official-warning',(name?profileLabel(name):'Conta')+': '+(account.message||'Aguardando nova tentativa')+(account.retry_at>Date.now()?' Próxima tentativa: '+dateTime(account.retry_at):'')));}
    const disconnected=ids.filter(id=>!result.authorizedIds.includes(id));
    if(disconnected.length){const button=element('button','text-button','Revisar '+disconnected.length+' conta(s)');button.type='button';button.onclick=()=>{document.querySelector('#account-platform-filter').value='instagram';document.querySelector('#account-status-filter').value='all';document.querySelector('#account-search').value='';renderAccounts();page('accounts');};bar.append(button);}
    const issues=(result.collection?.failures||[]);if(issues.length){const details=element('details','official-details');details.append(element('summary','',issues.length+' falha(s) na última coleta'));for(const issue of issues)details.append(element('p','',issue));bar.append(details);}
    root.append(bar);
  }
  function cards(root,rows,ids,current,prior,followers,requested){
    const grid=element('div','official-cards');
    for(const key of Object.keys(labels)){
      if(key==='profile_views'&&!rows.some(row=>ids.includes(row.account_id)&&row.metric===key))continue;
      const data=aggregate(rows,ids,current,key),before=aggregate(rows,ids,prior,key);
      const delta=current.to-current.from!==prior.to-prior.from||data.value==null||before.value==null?null:window.dashboardAnalytics.comparisonVariation(data.value,before.value);
      const card=element('div','official-card');
      const heading=element('div','official-card-heading');const icon=element('span','official-icon',icons[key]);icon.setAttribute('aria-hidden','true');
      heading.append(icon,element('span','',labels[key]));card.append(heading,element('strong','',number(data.value??data.partialValue)));
      card.append(element('small','',delta==null?(data.value==null?(data.count?`Parcial: ${data.count} de ${ids.length} contas`:'Sem dados'):'Sem comparação'):`${delta>=0?'↑':'↓'} ${Math.abs(delta).toLocaleString('pt-BR',{maximumFractionDigits:1})}% vs. período anterior`));
      if(data.value==null&&data.count)card.title=`${data.count} de ${ids.length} contas com dados; total indisponível.`;
      if(data.latest.length)card.title+=(card.title?' · ':'')+'Coleta: '+dateTime(Math.min(...data.latest));
      grid.append(card);
    }
    const secondary=element('div','official-secondary');
    if(followers.length){
      const latest=ids.map(id=>followers.filter(row=>row.account_id===id).sort((a,b)=>b.fetched_at-a.fetched_at)[0]);
      const complete=ids.length&&latest.every(Boolean);
      const available=latest.filter(Boolean);
      const total=available.length?available.reduce((sum,row)=>sum+row.value,0):null;
      const card=element('div','official-card'),heading=element('div','official-card-heading');
      const icon=element('span','official-icon',icons.followers);icon.setAttribute('aria-hidden','true');heading.append(icon,element('span','','Seguidores'));
      card.append(heading,element('strong','',number(total)),element('small','',complete?(ids.length>1?'Soma por conta · última leitura':'Última leitura disponível'):`Parcial: ${available.length} de ${ids.length} contas`));
      if(complete)card.title=`Seguidores consultados em ${dateTime(Math.min(...latest.map(row=>row.fetched_at)))}. ${ids.length>1?'A soma não representa pessoas únicas.':''}`;
      secondary.append(card);
    }
    const posted=(state.postings?.items||[]).filter(item=>ids.includes(item.account_id)&&item.status==='published'&&Date.parse(item.published_at)>=requested.from&&Date.parse(item.published_at)<requested.to).length;
    const postCard=element('div','official-card');
    const postHeading=element('div','official-card-heading');postHeading.append(element('span','official-icon','▣'),element('span','','Reels publicados'));
    postCard.append(postHeading,element('strong','',number(posted)),element('small','','Publicados pelo Studio'));
    secondary.append(postCard);
    root.append(grid,secondary);
  }
  function graph(root,rows,ids,current,prior,cached=false){
    const section=element('section','dashboard-panel official-graph');
    const head=element('div','official-section-head'),title=element('div');
    title.append(element('h2','','Evolução diária'));
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
      compact.append(element('span','',document.querySelector('#dashboard-period').value==='today'?(cached?'Último dia disponível · UTC':'Hoje · última leitura por conta'):days===1?'Total diário da Meta':'Total do intervalo da Meta'),element('strong','',number(currentTotal.value??currentTotal.partialValue)),element('small','',currentTotal.value==null&&currentTotal.count?`Parcial: ${currentTotal.count} de ${ids.length} contas`:delta==null?'Sem comparação compatível':`${delta>=0?'+':''}${delta.toLocaleString('pt-BR',{maximumFractionDigits:1})}% vs. período anterior`));
      const value=currentTotal.value??currentTotal.partialValue;
      if(value!=null){
        const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
        svg.setAttribute('viewBox','0 0 760 80');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${labels[metric]}: ${number(value)} no dia`);
        const line=document.createElementNS(ns,'line');for(const [key,val] of Object.entries({x1:24,x2:736,y1:49,y2:49,stroke:'#85818e','stroke-width':1}))line.setAttribute(key,val);svg.append(line);
        const point=document.createElementNS(ns,'circle');for(const [key,val] of Object.entries({cx:380,cy:49,r:6,fill:'#ad86df'}))point.setAttribute(key,val);svg.append(point);
        const label=document.createElementNS(ns,'text');for(const [key,val] of Object.entries({x:380,y:29,'text-anchor':'middle',fill:'#ad86df','font-size':16}))label.setAttribute(key,val);label.textContent=number(value);svg.append(label);
        section.append(svg);
      }
      section.append(compact,element('p','official-chart-note','Total oficial da conta por intervalo solicitado em Brasília. A Meta não forneceu pontos horários para este total.'));root.append(section);return;
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
    const summary=element('p','official-point-summary','Selecione um ponto para ver o dia.');summary.setAttribute('aria-live','polite');
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
  function activity(root,ids,current,history=state.postings?.insightHistory||[]){
    const section=element('section','dashboard-panel official-activity');
    const head=element('div','official-section-head');
    head.append(element('h2','','Atividade dos Reels por hora'));
    const days=[];const end=periods.midnight(periods.dayKey(current.to-1));
    for(let at=+end;at+DAY>current.from&&days.length<90;){days.push(at);at=periods.midnight(periods.shift(periods.dayKey(at),-1));}
    const items=(state.postings?.items||[]).filter(item=>ids.includes(item.account_id));
    const itemIds=new Set(items.map(item=>item.id));
    const nextDay=at=>periods.midnight(periods.shift(periods.dayKey(at),1));
    const key=periods.dayKey;
    if(!days.some(at=>key(at)===activityDay)){
      const active=days.find(at=>items.some(item=>item.status==='published'&&Date.parse(item.published_at)>=at&&Date.parse(item.published_at)<nextDay(at))||history.some(point=>itemIds.has(point.item_id)&&Date.parse(point.fetched_at)>=at&&Date.parse(point.fetched_at)<nextDay(at)));
      activityDay=key(active??days[0]??current.from);
    }
    const select=element('select');select.setAttribute('aria-label','Dia da atividade por hora');
    for(const at of days)select.append(new Option(new Date(at).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:periods.timezone}),key(at)));
    select.value=activityDay;select.onchange=()=>{activityDay=select.value;renderKey='';renderDashboard();};head.append(select);section.append(head);
    const day=days.find(at=>key(at)===activityDay)??days[0];
    if(day==null){section.append(element('p','dashboard-empty','Nenhum dia neste período.'));root.append(section);return;}
    const next=nextDay(day);
    const hours=window.dashboardAnalytics.instagramHourlyActivity(items,history,ids,Math.max(day,current.from),Math.min(+next,current.to),periods.hour);
    const totalPosts=hours.reduce((sum,hour)=>sum+hour.published,0),measured=hours.filter(hour=>hour.views!=null).length,totalViews=hours.reduce((sum,hour)=>sum+(hour.views??0),0);
    const summary=element('p','official-chart-note',`${totalPosts} Reel${totalPosts===1?'':'s'} publicado${totalPosts===1?'':'s'} · ${measured} hora${measured===1?'':'s'} com ganho medido · ${number(totalViews)} views observadas`);section.append(summary);
    if(!totalPosts&&!measured){section.append(element('p','dashboard-empty','Sem publicações ou duas leituras de um mesmo Reel neste dia.'));root.append(section);return;}
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 900 235');svg.setAttribute('role','img');svg.setAttribute('aria-label','Reels publicados e ganhos de views observados por hora');
    const node=(tag,attrs)=>{const value=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [name,entry] of Object.entries(attrs))value.setAttribute(name,entry);svg.append(value);return value;};
    const maxPosts=Math.max(1,...hours.map(hour=>hour.published)),maxViews=Math.max(1,...hours.map(hour=>hour.views||0));
    let segment=[];const flush=()=>{if(segment.length>1)node('polyline',{points:segment.join(' '),fill:'none',stroke:'#5cc6bc','stroke-width':2.5});segment=[];};
    hours.forEach((hour,index)=>{if(hour.views==null){flush();return;}segment.push(`${39+index*35},${173-hour.views/maxViews*112}`);});flush();
    for(let index=0;index<24;index++){
      const hour=hours[index],x=39+index*35;
      if(hour.published)node('rect',{x:x-8,y:173-hour.published/maxPosts*112,width:16,height:hour.published/maxPosts*112,rx:3,fill:'#ad86df'});
      if(hour.views!=null)node('circle',{cx:x,cy:173-hour.views/maxViews*112,r:4,fill:'#5cc6bc'});
      if(index%3===0)node('text',{x,y:203,'text-anchor':'middle',class:'insights-axis'}).textContent=`${String(index).padStart(2,'0')}h`;
      const hit=node('rect',{x:x-15,y:30,width:30,height:153,fill:'transparent',tabindex:0,'aria-label':`${String(index).padStart(2,'0')}h: ${hour.published} Reels publicados; ${hour.views==null?'sem ganho medido':`${number(hour.views)} views observadas em ${hour.intervals} intervalo(s)`}`});
      hit.addEventListener('focus',()=>{detail.textContent=hit.getAttribute('aria-label');});hit.addEventListener('pointerenter',()=>{detail.textContent=hit.getAttribute('aria-label');});
    }
    const legend=element('div','official-legend');legend.append(element('span','official-legend-current','Reels publicados'),element('span','official-legend-views','Ganhos de views observados'));section.append(legend,svg);
    const detail=element('p','official-point-summary','Passe o mouse ou use Tab para ver cada hora.');detail.setAttribute('aria-live','polite');section.append(detail);
    section.append(element('p','official-chart-note','Publicações usam o horário de Brasília. Os ganhos são atribuídos à hora da leitura final e não indicam quando cada view ocorreu. Ausência de leituras aparece sem ponto.'));
    root.append(section);
  }
  function rankIdentity(account){
    const identity=element('div','official-rank-identity');
    identity.append(element('strong','',profileLabel(account)));
    const tags=accountTagGroup(account);if(tags)identity.append(tags);
    return identity;
  }
  function ranking(root,rows,ids,current){
    const section=element('section','dashboard-panel official-ranking'),head=element('div','official-section-head');
    head.append(element('h2','','Desempenho por conta'),element('small','',`Ordenadas por ${labels[metric].toLowerCase()}`));section.append(head);
    if(ids.length===1){
      const account=state.accounts.find(row=>row.id===ids[0]);
      if(account){const identity=element('div','official-rank-row');identity.append(portrait(account),rankIdentity(account),element('span','','Conta selecionada'));section.append(identity);}
      const monitored=(state.postings?.items||[]).filter(item=>item.account_id===ids[0]&&item.status==='published'&&item.media_id).length;
      section.append(element('p','official-subtle',`${monitored} Reels publicados pelo Comment Studio disponíveis para monitoramento.`));root.append(section);return;
    }
    const ranked=ids.map(id=>({account:state.accounts.find(row=>row.id===id),views:aggregate(rows,[id],current,'views').value,reach:aggregate(rows,[id],current,'reach').value,value:aggregate(rows,[id],current,metric).value})).filter(row=>row.account).sort((a,b)=>(b.value??-1)-(a.value??-1));
    const max=Math.max(1,...ranked.map(row=>row.value||0));
    if(!ranked.length)section.append(element('div','dashboard-empty','Nenhuma conta selecionada.'));
    for(const row of ranked){
      const line=element('div','official-rank-row');line.append(portrait(row.account),rankIdentity(row.account));
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
    const heading=element('div');heading.append(element('h2','','Melhores Reels'),element('small','official-subtle','Publicados no período · acumulado'));
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
      try{const data=await window.studio.instagramOfficialMetrics({accountIds:ids,from:prior.from,to:current.to,mediaFrom:current.from,allMedia:true});if(sequence!==ticket||activePlatform!=='instagram')return;reelAll=data.media;media=reelAll;}
      catch(error){allButton.textContent=error.message;allButton.disabled=false;return;}
      allButton.disabled=false;
    }
    function draw(){
      const available=mediaGroups(media,ids).filter(row=>Date.parse(row.published_at)>=current.from&&Date.parse(row.published_at)<current.to);
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
        cachedImage(reelThumbnails,`${video.item_id}:${item?.file||''}`,thumb,()=>window.studio.videoThumbnail?.(video.item_id));
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
  window.renderInstagramDashboard=()=>{
    const instagram=activePlatform==='instagram';
    const wasHidden=panel.hidden;
    dashboard.classList.toggle('official-instagram',instagram);panel.hidden=!instagram;
    for(const id of ['dashboard-start-time','dashboard-end-time','dashboard-group']){const field=document.getElementById(id);field.disabled=instagram;field.closest('label').hidden=instagram;}
    for(const selector of ['#dashboard-metrics','.dashboard-network-analysis','.analytics-panel','.dashboard-analysis-bottom','.insights-queue-panel','.dashboard-campaign-panel','.dashboard-hourly-panel','#dashboard-tiktok-panel'])
      for(const node of dashboard.querySelectorAll(selector))node.hidden=instagram;
    dashboard.querySelector('.dashboard-filter-details').hidden=true;
    const sequence=++ticket;if(!instagram)return;
    for(const node of dashboard.querySelectorAll('#dashboard-compare-from,#dashboard-compare-to'))node.closest('label').hidden=true;
    renderDashboardFilters('instagram');
    dashboard.querySelector('h1').textContent='Dashboard Instagram';
    document.querySelector('#dashboard-tiktok-settings').hidden=true;
    document.querySelector('#dashboard-refresh-insights').hidden=false;
    const autoButton=document.querySelector('#dashboard-auto-refresh');autoButton.hidden=false;autoButton.setAttribute('aria-pressed',String(autoEnabled));autoButton.textContent=autoEnabled?'Auto: 15 min':'Auto: desligado';
    const refreshStatus=document.querySelector('#dashboard-refresh-status');refreshStatus.hidden=false;
    refreshStatus.textContent=progressLabel()||'Carregando métricas salvas…';
    refreshStatus.title=refreshStatus.textContent;
    const [current,prior]=ranges();
    document.querySelector('#dashboard-refresh-insights').disabled=true;
    if(!Number.isFinite(current.from)||!Number.isFinite(current.to)||current.from>=current.to){renderKey='';panel.replaceChildren(element('p','dashboard-empty','Selecione um período válido.'));return;}
    const localRange=current;
    const ids=state.accounts.filter(account=>account.platform==='instagram'&&dashboardAccountMatches(account.id,'instagram')).map(account=>account.id);
    const selectionKey=JSON.stringify([ids.slice().sort(),document.querySelector('#dashboard-period').value,document.querySelector('#dashboard-from').value,document.querySelector('#dashboard-to').value,localDay()]);
    controller.select(selectionKey,{accountIds:ids,ranges:[current,prior]});
    document.querySelector('#dashboard-refresh-insights').disabled=controller.busy||!state.accounts.some(account=>ids.includes(account.id)&&account.meta?.connected&&account.meta?.insightsGranted);
    const key=selectionKey; // Moving end-of-period must not blank the cached screen.
    if(key!==displayKey||wasHidden){panel.replaceChildren(element('p','official-loading','Carregando dados salvos…'));displayKey=key;renderKey='';reelAll=null;reelVisible=5;}
    controller.read({accountIds:ids,from:prior.from,to:current.to,mediaFrom:current.from}).then(result=>{
      if(!result||sequence!==ticket||activePlatform!=='instagram')return;
      document.querySelector('#dashboard-refresh-insights').disabled=controller.busy||!ids.some(id=>result.authorizedIds.includes(id));
      const candidates=result.metrics.filter(row=>ids.includes(row.account_id)&&row.metric==='views'&&row.start_at===current.from&&row.end_at<=current.to&&row.end_at>periods.midnight(periods.dayKey(current.to-1)));
      const end=candidates.length?Math.max(...candidates.map(row=>row.end_at)):current.to;
      const shownRange={from:current.from,to:end};
      const display={current:shownRange,prior:end===current.to?prior:document.querySelector('#dashboard-period').value==='today'?{from:shownRange.from-DAY,to:shownRange.to-DAY}:{from:shownRange.from-(shownRange.to-shownRange.from),to:shownRange.from},cached:end!==current.to};
      const shown=display.current;window.scheduleInstagramRefresh();
      result.collection=controller.collection;
      const lastOfficial=aggregate(result.metrics,ids,shown,'views').latest.sort((a,b)=>b-a)[0];
      refreshStatus.textContent=progressLabel()|| (lastOfficial?`Última coleta da conta: ${dateTime(lastOfficial)}`:'Sem coleta da conta neste período');
      refreshStatus.title=refreshStatus.textContent;
      const shownPrior=display.prior;
      const accounts=state.accounts.filter(account=>ids.includes(account.id)).map(account=>[account.id,account.handle,account.name,accountTags(account),account.meta?.connected,account.meta?.needsReconnect,account.error]);
      const postings=(state.postings?.items||[]).filter(item=>ids.includes(item.account_id)).map(item=>[item.id,item.account_id,item.status,item.published_at,item.file,item.caption]);
      const nextRenderKey=JSON.stringify([result.evidence,result.accounts,result.collection?.failures,key,shown,shownPrior,localRange,metric,compare,display.cached,result.metrics,result.media,result.followers,result.authorizedIds,accounts,postings,result.history??state.postings?.insightHistory]);
      if(nextRenderKey===renderKey)return;
      renderKey=nextRenderKey;
      photoObserver.disconnect();panel.replaceChildren();
      status(panel,result.metrics,ids,result,shown,display.cached,current);
      cards(panel,result.metrics,ids,shown,shownPrior,result.followers||[],localRange);
      graph(panel,result.metrics,ids,shown,shownPrior,display.cached);
      const details=element('details','official-details');details.open=activityExpanded;details.ontoggle=()=>{activityExpanded=details.open;};details.append(element('summary','','Atividade dos Reels por hora'));activity(details,ids,localRange,result.history);panel.append(details);
      ranking(panel,result.metrics,ids,shown);
      reels(panel,result,ids,shown,shownPrior,sequence);
      queue(panel,ids,localRange);
      const technical=element('details','official-details');technical.append(element('summary','','Sobre os dados'));
      const views=aggregate(result.metrics,ids,shown,'views');
      technical.append(element('p','','Os totais da conta incluem todos os formatos autorizados. As métricas dos Reels são individuais. O alcance de contas diferentes pode incluir as mesmas pessoas.'));
      technical.append(element('p','',`Cobertura de visualizações: ${views.count} de ${ids.length} contas. Períodos solicitados em Brasília. Registros legados incompatíveis não são apresentados como dados deste período.`));
      technical.append(element('p','','Reels recentes: coleta a cada hora; antigos: diariamente. Os valores são acumulados. Coletas diárias são intervalos solicitados à Meta; não representam distribuição horária de visualizações.'));
      if(result.metrics.some(row=>!row.requested_timezone))technical.append(element('p','','Há registros legados sem informação de fuso da consulta.'));
      const incompatible=(result.evidence||[]).filter(row=>row.status==='incompatible');
      if(incompatible.length)technical.append(element('p','','A Meta retornou '+incompatible.length+' métrica(s) com formato ou período diferente. Esses valores não entram nos totais.'));
      panel.append(technical);
    }).catch(error=>{if(sequence===ticket&&activePlatform==='instagram'){renderKey='';refreshStatus.textContent='Falha ao carregar dados salvos: '+error.message;}});
  };
  let autoTimer=null,lastAutoKey='',lastAutoAt=0;
  window.scheduleInstagramRefresh=()=>{
    clearTimeout(autoTimer);
    autoTimer=setTimeout(()=>{
      if(dashboard.hidden||activePlatform!=='instagram'||!autoEnabled)return;
      const [range]=ranges();if(!Number.isFinite(range.from))return;
      const ids=state.accounts.filter(account=>account.platform==='instagram'&&dashboardAccountMatches(account.id,'instagram')).map(account=>account.id).sort();
      const key=JSON.stringify([ids,document.querySelector('#dashboard-period').value,document.querySelector('#dashboard-from').value,document.querySelector('#dashboard-to').value,localDay()]);
      if(key===lastAutoKey&&Date.now()-lastAutoAt<15*60000)return;
      if(controller.busy||(controller.lastRequestedKey===controller.selectionKey&&Date.now()-controller.lastRequestedAt<15*60000))return;
      const button=document.querySelector('#dashboard-refresh-insights');if(button.disabled)return;
      lastAutoKey=key;lastAutoAt=Date.now();controller.refresh(false);
    },400);
  };
  const firstRender=setInterval(()=>{
    if(!document.body.dataset.ready)return;
    clearInterval(firstRender);
    renderDashboard();document.body.dataset.dashboardReady='true';window.scheduleInstagramRefresh();
  },25);
  setTimeout(()=>clearInterval(firstRender),30000);
  document.querySelector('[data-page="dashboard"]').addEventListener('click',()=>{if(!dashboard.hidden){renderDashboard();window.scheduleInstagramRefresh();}});
  setInterval(()=>{
    if(!document.body.dataset.ready)return;
    const now=Date.now();
    if(localDay()===rangeLocalDay&&Math.floor(now/DAY)===Math.floor(rangeNow/DAY)){window.scheduleInstagramRefresh();return;}
    if(dashboard.hidden||document.querySelector('#dashboard-platform').value!=='instagram')return;
    renderDashboard();
    if(autoEnabled)window.scheduleInstagramRefresh();
  },60000);
})();
