(() => {
  const dashboard = document.querySelector('[data-panel="dashboard"]');
  const control = element('label', 'dashboard-sort-label', 'Visão do Instagram');
  const view = element('select'); view.id = 'dashboard-instagram-view';
  view.append(new Option('Totais da conta', 'accounts'), new Option('Reels monitorados', 'reels'));
  control.append(view); dashboard.querySelector('.dashboard-toolbar').append(control);
  const panel = element('section', 'dashboard-panel account-insights-panel');
  document.querySelector('#dashboard-metrics').before(panel);
  const original = renderDashboard;
  let request = 0;
  const DAY = 86400000;
  const number = value => value.toLocaleString('pt-BR');
  const utcDay = at => new Date(at).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  view.addEventListener('change', () => renderDashboard());
  function range() {
    const period = document.querySelector('#dashboard-period').value;
    const today = Math.floor(Date.now() / DAY) * DAY;
    if (period === 'custom') return { from: Date.parse(`${document.querySelector('#dashboard-from').value}T00:00:00Z`), to: Date.parse(`${document.querySelector('#dashboard-to').value}T00:00:00Z`) + DAY - 1 };
    if (period === 'yesterday') return { from: today - DAY, to: today - 1 };
    return { from: today - (period === 'today' ? 0 : Number(period) - 1) * DAY, to: today + DAY - 1 };
  }
  function draw(rows, ids, dates, reels) {
    panel.replaceChildren(element('h2', '', reels ? 'Visualizações dos Reels — totais da conta' : 'Visualizações do Instagram — todos os formatos'));
    panel.append(element('p', 'help', 'Dias em UTC · Inclui conteúdo publicado fora do aplicativo. O dia atual é parcial e a Meta pode revisar os valores.'));
    const { days, total, complete, delta } = window.dashboardAnalytics.accountDailySummary(rows, ids, dates.from, dates.to, reels);
    for (const day of days) day.posts = (state.postings?.items || []).filter(item => ids.includes(item.account_id) && item.status === 'published' && Date.parse(item.published_at) >= day.at && Date.parse(item.published_at) < day.at + DAY).length;
    panel.append(element('strong', 'account-insights-total', total == null ? 'Indisponível' : number(total)), element('p', 'help', complete ? 'Cobertura completa no período' : 'Total parcial · cobertura incompleta ou dia em andamento'));
    const latest = rows.filter(row => row.start_at >= dates.from && row.start_at <= dates.to).map(row => row.fetched_at);
    panel.append(element('p', 'help', latest.length ? `Última coleta: ${new Date(Math.max(...latest)).toLocaleString('pt-BR')}` : 'Aguardando uma resposta válida da Meta. Use Atualizar métricas.'));
    panel.append(element('p', 'help', delta == null ? 'Sem comparação · são necessários períodos completos com a mesma cobertura.' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs. ${utcDay(dates.from - days.length * DAY)} a ${utcDay(dates.from - DAY)}`));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 900 240'); svg.setAttribute('aria-label', 'Visualizações diárias e Reels registrados pelo aplicativo');
    const add = (tag, attrs) => { const node = document.createElementNS(ns, tag); for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value); svg.append(node); return node; };
    const max = Math.max(1,...days.map(day => day.value || 0)), maxPosts = Math.max(1,...days.map(day => day.posts));
    const x = index => 65 + index / Math.max(1, days.length - 1) * 760;
    for (let i=0;i<=4;i++) {
      const y=25+i*40;
      add('line',{x1:65,x2:825,y1:y,y2:y,class:'insights-grid'});
      add('text',{x:57,y:y+4,'text-anchor':'end',class:'insights-axis'}).textContent=number(Math.round(max*(4-i)/4));
      add('text',{x:835,y:y+4,class:'insights-axis'}).textContent=number(Math.round(maxPosts*(4-i)/4));
    }
    let segment=[];
    const flush=()=>{ if(segment.length) add('polyline',{points:segment.join(' '),fill:'none',stroke:'#ad86df','stroke-width':2.5}); segment=[]; };
    days.forEach((day,index)=>{ if(day.value==null){flush();return;} segment.push(`${x(index)},${185-day.value/max*160}`); }); flush();
    add('polyline',{points:days.map((day,index)=>`${x(index)},${185-day.posts/maxPosts*160}`).join(' '),fill:'none',stroke:'#48c7b2','stroke-width':2.5});
    days.forEach((day,index)=>{
      if(day.value!=null) { const point=add('circle',{cx:x(index),cy:185-day.value/max*160,r:4,fill:'#ad86df',tabindex:0,'aria-label':`${utcDay(day.at)}: ${number(day.value)} visualizações, ${day.coverage}/${ids.length} contas`}); const title=document.createElementNS(ns,'title'); title.textContent=point.getAttribute('aria-label'); point.append(title); }
      if(index%Math.max(1,Math.ceil(days.length/6))===0) add('text',{x:x(index),y:215,'text-anchor':'middle',class:'insights-axis'}).textContent=utcDay(day.at).slice(0,5);
    });
    panel.append(element('p','help','Lilás / eixo esquerdo: visualizações · Verde / eixo direito: Reels registrados pelo aplicativo'),svg);
    const table=element('table','analytics-heatmap');
    const header=table.createTHead().insertRow(); for(const title of ['Dia (UTC)','Visualizações','Contas','Reels no app','Estado']) header.append(element('th','',title));
    const body=table.createTBody(); for(const day of days) { const row=body.insertRow(); for(const value of [utcDay(day.at),day.value==null?'Indisponível':number(day.value),`${day.coverage}/${ids.length}`,day.posts,day.complete?'Completo':'Parcial / indisponível']) row.append(element('td','',String(value))); }
    const scroll=element('div','analytics-table-scroll'); scroll.append(table); panel.append(scroll);
  }
  renderDashboard = () => {
    const totalsRequested = document.querySelector('#dashboard-platform').value === 'instagram' && view.value === 'accounts';
    const hourlyOption = document.querySelector('#dashboard-period option[value="24h"]');
    hourlyOption.disabled = totalsRequested;
    if (totalsRequested && document.querySelector('#dashboard-period').value === '24h') document.querySelector('#dashboard-period').value = 'today';
    original();
    const instagram=document.querySelector('#dashboard-platform').value==='instagram';
    control.hidden=!instagram;
    const totals=instagram && view.value==='accounts'; panel.hidden=!totals;
    for(const selector of ['#dashboard-metrics','.dashboard-network-analysis','.analytics-panel','.dashboard-analysis-bottom']) for(const node of dashboard.querySelectorAll(selector)) if(totals) node.hidden=true;
    if(!totals) document.querySelector('#dashboard-metrics').hidden=false;
    for(const id of ['dashboard-start-time','dashboard-end-time','dashboard-group']) document.getElementById(id).disabled=totals;
    const ticket=++request;
    if(!totals) {
      if(instagram) document.querySelector('#dashboard-reels-count').textContent=`Reels monitorados · ${(state.postings?.insights||[]).filter(row=>(state.postings?.items||[]).some(item=>item.id===row.item_id&&dashboardAccountMatches(item.account_id,'instagram'))).length} vídeos com leitura registrada`;
      return;
    }
    const dates=range();
    if(!Number.isFinite(dates.from)||!Number.isFinite(dates.to)||dates.from>dates.to){panel.replaceChildren(element('p','help','Selecione um período válido.'));return;}
    const ids=state.accounts.filter(account=>account.platform==='instagram'&&dashboardAccountMatches(account.id,'instagram')).map(account=>account.id);
    panel.replaceChildren(element('p','help','Carregando totais por conta…'));
    const from=dates.from-(dates.to-dates.from+1);
    window.studio.instagramAccountInsights({accountIds:ids,from,to:dates.to}).then(result=>{
      if(ticket!==request)return;
      const relevant=result.rows.filter(row=>row.start_at>=from&&row.start_at<=dates.to);
      const reels=ids.length>0&&result.accounts.every(account=>account.breakdown)&&relevant.length>0&&relevant.every(row=>row.reels!=null);
      draw(relevant,ids,dates,reels);
      for(const account of result.accounts){const profile=state.accounts.find(a=>a.id===account.account_id);panel.append(element('p','help',`${profile?profileLabel(profile):'Conta'} · ${account.status==='supported'?'Dados disponíveis':account.status==='unavailable'?'Indisponível':'Em preparação'} · Histórico: ${account.historyDays}/31 dias${account.message?` · ${account.message}`:''}`));}
    }).catch(error=>{if(ticket===request)panel.replaceChildren(element('p','help',error.message));});
  };
})();
