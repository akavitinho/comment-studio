/* Dashboard presentation. Integrations and stored readings remain in app.js. */
(() => {
  const dashboard = document.querySelector('[data-panel="dashboard"]');
  dashboard.classList.add('insights-clean');
  const details = element('dialog', 'insights-dialog');
  const close = element('button', 'secondary', 'Fechar'); close.type = 'button'; close.onclick = () => details.close();
  details.append(close); dashboard.append(details);
  const hourlyPanel = dashboard.querySelector('.dashboard-hourly-panel');
  details.append(hourlyPanel);
  const technical = element('details', 'insights-technical');
  technical.append(element('summary', '', 'Sobre os dados'));
  for (const selector of ['#dashboard-insights-note', '#dashboard-comparison']) technical.append(dashboard.querySelector(selector));
  details.append(technical);
  const actions = element('details', 'insights-actions'); actions.append(element('summary', '', 'Opções ⋮'));
  const menu = element('div', 'insights-action-menu');
  for (const id of ['dashboard-tiktok-settings', 'dashboard-auto-refresh']) menu.append(document.getElementById(id));
  const inspect = element('button', 'secondary', 'Detalhes dos Insights'); inspect.type = 'button'; inspect.onclick = () => details.showModal(); menu.append(inspect); actions.append(menu);
  document.querySelector('.dashboard-refresh-actions').append(actions);
  const campaign = dashboard.querySelector('.dashboard-campaign-panel');
  const campaignDetails = element('details', 'insights-technical'); campaignDetails.append(element('summary', '', 'Ver detalhes'));
  for (const selector of ['#dashboard-campaign-accounts', '#dashboard-campaign-hours', '.dashboard-muted']) campaignDetails.append(campaign.querySelector(selector));
  campaign.append(campaignDetails);
  const bottom = dashboard.querySelector('.dashboard-analysis-bottom');
  const queuePanel = document.querySelector('#dashboard-queue').closest('section');
  const reelsPanel = document.querySelector('#dashboard-reels').closest('section');
  bottom.before(queuePanel); bottom.append(reelsPanel); bottom.after(campaign);
  campaign.before(document.querySelector('#dashboard-tiktok-panel'));
  const analysis = dashboard.querySelector('.dashboard-chart-panel').parentElement;
  analysis.classList.add('dashboard-network-analysis');
  dashboard.querySelector('.dashboard-platform-panel').hidden = true;
  queuePanel.classList.add('insights-queue-panel');
  reelsPanel.querySelector('h2').textContent = 'Top 3 Reels';
  const allVideos = element('dialog', 'insights-dialog');
  const closeVideos = element('button', 'secondary', 'Fechar'); closeVideos.type = 'button'; closeVideos.onclick = () => allVideos.close(); allVideos.append(closeVideos);
  const allList = element('div'); allVideos.append(allList); dashboard.append(allVideos);
  const viewAll = element('button', 'text-button', 'Ver todos'); viewAll.type = 'button'; viewAll.onclick = () => allVideos.showModal(); reelsPanel.querySelector('.dashboard-panel-head').append(viewAll);
  const reelSort = document.querySelector('#dashboard-sort');
  reelSort.append(new Option('Visualizações · última hora', 'views-hour'), new Option('Engajamento', 'engagement'));
  dashboard.querySelector('.dashboard-chart-panel .dashboard-panel-head p').textContent = '';
  const advancedFilters = dashboard.querySelector('.dashboard-advanced-filters');
  const advanced = element('details', 'dashboard-filter-details');
  advanced.append(element('summary', '', 'Filtros avançados'));
  advancedFilters.before(advanced); advanced.append(advancedFilters);
  const compare = element('label', 'insights-compare'); const check = element('input'); check.type = 'checkbox'; check.checked = true; compare.append(check, document.createTextNode('Período anterior')); document.querySelector('#dashboard-chart').before(compare); check.onchange = () => renderDashboard();
  const chartControls = element('div', 'insights-chart-controls');
  const chartLegend = element('div', 'insights-chart-legend');
  const currentLegend = element('span', 'insights-legend-current');
  const previousLegend = element('span', 'insights-legend-previous', 'Comparação');
  const publicationToggle = element('label', 'insights-legend-publications');
  const publicationCheck = element('input'); publicationCheck.type = 'checkbox'; publicationCheck.checked = true;
  publicationToggle.append(publicationCheck, document.createTextNode('Reels postados'));
  publicationCheck.addEventListener('change', () => renderDashboard());
  chartLegend.append(currentLegend, previousLegend, publicationToggle);
  const axisLabels = element('div', 'insights-axis-labels');
  const leftAxisLabel = element('span'), rightAxisLabel = element('span', '', 'Eixo direito · Reels postados');
  axisLabels.append(leftAxisLabel, rightAxisLabel);
  chartControls.append(chartLegend, axisLabels); compare.after(chartControls);
  const attentionDialog = element('dialog', 'insights-dialog insights-attention-dialog');
  const attentionTitle = element('h2', '', 'Contas em atenção');
  const attentionClose = element('button', 'secondary', 'Fechar'); attentionClose.type = 'button'; attentionClose.onclick = () => attentionDialog.close();
  const attentionList = element('div', 'insights-attention-list');
  attentionDialog.append(attentionTitle, attentionList, attentionClose); dashboard.append(attentionDialog);
  const metricValue = (points, key) => {
    const changes = window.dashboardAnalytics.observedChanges(points, key, { from: -Infinity, to: Infinity });
    return changes.length ? changes.reduce((sum, change) => sum + change.value, 0) : null;
  };
  const { observedChanges, seriesBuckets, publicationBuckets, bucketTime } = window.dashboardAnalytics;
  const metricLabels = { views: 'Visualizações', reach: 'Alcance por Reel', likes: 'Curtidas', comments: 'Comentários', shares: 'Compartilhamentos', saves: 'Salvamentos', engagement: 'Engajamento', publications: 'Publicações', publicationViews: 'Views por horário de publicação' };
  const supported = (platform, metric) => platform === 'instagram' ? ['views', 'reach'].includes(metric) : platform === 'tiktok' && ['views', 'likes', 'comments', 'shares', 'engagement'].includes(metric);
  const number = value => value.toLocaleString('pt-BR');
  const dateTime = at => new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const previousPeriod = element('details', 'insights-technical');
  previousPeriod.append(element('summary', '', 'Personalizar período de comparação'));
  const comparisonInputs = element('div', 'dashboard-toolbar');
  for (const [id, label] of [['dashboard-compare-from', 'De'], ['dashboard-compare-to', 'Até']]) {
    const field = element('label', '', label), input = element('input');
    input.type = 'datetime-local'; input.id = id; input.addEventListener('change', () => renderDashboard());
    field.append(input); comparisonInputs.append(field);
  }
  previousPeriod.append(comparisonInputs);
  compare.after(previousPeriod);
  function comparisonRange(dates) {
    return window.dashboardAnalytics.comparisonRange(dates, document.querySelector('#dashboard-period').value,
      document.querySelector('#dashboard-compare-from').value, document.querySelector('#dashboard-compare-to').value);
  }
  function analyticsPanel(title, options, label) {
    const panel = element('section', 'dashboard-panel analytics-panel');
    const header = element('div', 'dashboard-panel-head');
    header.append(element('h2', '', title));
    let select;
    if (options) {
      select = element('select'); select.setAttribute('aria-label', label);
      select.append(...options.map(key => new Option(metricLabels[key] || 'Crescimento no período', key)));
      select.addEventListener('change', () => renderDashboard());
      header.append(select);
    }
    const body = element('div');
    panel.append(header, body);
    queuePanel.before(panel);
    return { panel, body, select };
  }
  const timing = analyticsPanel('Desempenho por horário', ['views', 'engagement', 'publications', 'publicationViews'], 'Métrica por horário');
  const engagementPanel = analyticsPanel('Engajamento do público');
  const ranking = analyticsPanel('Desempenho das contas', ['views', 'reach', 'engagement', 'publications', 'growth'], 'Ordenar desempenho das contas');
  function selectAvailable(select, platform) {
    for (const option of select.options) {
      const metric = ['growth', 'publicationViews'].includes(option.value) ? 'views' : option.value;
      option.disabled = !supported(platform, metric) && option.value !== 'publications';
    }
    if (select.selectedOptions[0]?.disabled) select.value = [...select.options].find(option => !option.disabled).value;
  }
  function analyticsData(platform, accounts) {
    const ids = new Set(accounts.map(account => account.id));
    const instagram = platform === 'instagram';
    const videos = instagram
      ? (state.postings?.items || []).filter(item => item.status === 'published' && ids.has(item.account_id))
      : (state.tiktokInsights?.videos || []).filter(video => ids.has(video.account_id));
    const records = new Map(videos.map(video => {
      const key = instagram ? video.id : `${video.account_id}:${video.video_id}`;
      return [key, { accountId: video.account_id, publishedAt: Date.parse(instagram ? video.published_at : video.created_at), points: [] }];
    }));
    const history = instagram ? state.postings?.insightHistory : state.tiktokInsights?.history;
    for (const point of history || []) {
      const record = records.get(instagram ? point.item_id : `${point.account_id}:${point.video_id}`);
      if (!record) continue;
      const engagement = ['likes', 'comments', 'shares'].every(key => point[key] != null && Number.isFinite(Number(point[key])))
        ? Number(point.likes) + Number(point.comments) + Number(point.shares) : null;
      record.points.push({ ...point, engagement });
    }
    return [...records.values()];
  }
  const within = (at, range) => at >= range.from && at <= range.to;
  function gain(record, key, range) {
    const changes = observedChanges(record.points, key, range);
    return changes.length ? changes.reduce((total, point) => total + point.value, 0) : null;
  }
  function meterRow(label, value, maximum, suffix = '') {
    const row = element('div', 'analytics-meter-row');
    const heading = element('div', 'analytics-meter-label');
    heading.append(typeof label === 'string' ? element('span', '', label) : label, element('strong', '', value == null ? 'Indisponível' : `${number(value)}${suffix}`));
    row.append(heading);
    if (value != null) {
      const bar = element('div', 'insights-meter'), fill = element('span');
      fill.style.width = `${maximum ? Math.max(0, value / maximum * 100) : 0}%`;
      bar.setAttribute('aria-hidden', 'true'); bar.append(fill); row.append(bar);
    }
    return row;
  }
  function renderTiming(records, dates) {
    const metric = timing.select.value;
    const publication = metric === 'publications', cohort = metric === 'publicationViews';
    const slots = new Map();
    function recordAt(at, value) {
      const date = new Date(at), slot = (date.getDay() + 6) % 7 * 8 + Math.floor(date.getHours() / 3);
      const group = slots.get(slot) || { total: 0, count: 0 };
      group.total += value; group.count++;
      slots.set(slot, group);
    }
    for (const record of records) {
      if (publication && within(record.publishedAt, dates)) recordAt(record.publishedAt, 1);
      if (cohort && within(record.publishedAt, dates)) {
        const age = point => (Date.parse(point.fetched_at) - record.publishedAt) / 3600000;
        const readings = record.points.filter(point => point.views != null && Number.isFinite(Number(point.views)) && Date.parse(point.fetched_at) <= dates.to)
          .sort((a, b) => Date.parse(a.fetched_at) - Date.parse(b.fetched_at));
        const first = readings.find(point => age(point) >= 0 && age(point) <= 1);
        const last = readings.findLast(point => age(point) >= 23 && age(point) <= 24);
        if (first && last && Number(last.views) >= Number(first.views)) recordAt(record.publishedAt, last.views - first.views);
      }
      if (!publication && !cohort) for (const point of observedChanges(record.points, metric, dates)) recordAt(point.at, point.value);
    }
    timing.body.replaceChildren(element('p', 'dashboard-muted', cohort
      ? 'Média de ganhos por vídeo, agrupada pela hora da publicação. Só entram vídeos com leituras na 1ª hora e entre 23h e 24h de vida.'
      : publication
      ? 'Horário da publicação. A quantidade publicada não mede desempenho.'
      : 'Horário da coleta final. O ganho ocorreu entre duas leituras, sem atribuição ao horário da publicação.'));
    if (!slots.size) { timing.body.append(element('p', 'dashboard-empty', publication ? 'Sem publicações no intervalo.' : 'Sem leituras suficientes no intervalo.')); return; }
    const table = element('table', 'analytics-heatmap');
    const heading = table.createTHead().insertRow(); heading.append(element('th', '', 'Dia'));
    for (let hour = 0; hour < 24; hour += 3) heading.append(element('th', '', `${String(hour).padStart(2, '0')}h`));
    const slotValue = slot => cohort ? Math.round(slot.total / slot.count) : slot.total;
    const max = Math.max(1, ...[...slots.values()].map(slotValue));
    const body = table.createTBody();
    ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].forEach((day, index) => {
      const row = body.insertRow(), label = element('th', '', day); label.scope = 'row'; row.append(label);
      for (let column = 0; column < 8; column++) {
        const cell = row.insertCell(), slot = slots.get(index * 8 + column);
        const value = slot == null ? null : slotValue(slot);
        cell.textContent = value == null ? '—' : number(value);
        cell.title = `${day} · ${column * 3}h–${(column * 3 + 3) % 24}h · ${value == null ? 'Sem registro' : number(value)}${cohort && slot ? ` · ${slot.count} vídeo(s)` : ''}`;
        if (value != null) cell.style.setProperty('--heat', `${10 + 65 * value / max}%`);
      }
    });
    const scroll = element('div', 'analytics-table-scroll'); scroll.append(table); timing.body.append(scroll);
  }
  function renderEngagement(records, dates, platform) {
    const metrics = ['likes', 'comments', 'shares', 'saves'].map(key => {
      const gains = supported(platform, key) ? records.map(record => gain(record, key, dates)).filter(value => value != null) : [];
      return [key, gains.length ? gains.reduce((a, b) => a + b, 0) : null];
    });
    const max = Math.max(0, ...metrics.map(([, value]) => value ?? 0));
    engagementPanel.body.replaceChildren(...metrics.map(([key, value]) => meterRow(metricLabels[key], value, max)));
    let interactions = 0, views = 0;
    for (const record of records) {
      const pair = record.points.filter(point => point.engagement != null && point.views != null);
      const comparable = { points: pair };
      const seen = gain(comparable, 'views', dates), engaged = gain(comparable, 'engagement', dates);
      if (seen == null || engaged == null) continue;
      interactions += engaged; views += seen;
    }
    if (views > 0) engagementPanel.body.append(element('p', 'dashboard-muted', `Taxa: ${(interactions / views * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% · (curtidas + comentários + compartilhamentos) ÷ visualizações, nas mesmas leituras.`));
  }
  function renderRanking(accounts, records, dates, prior) {
    const metric = ranking.select.value, key = metric === 'growth' ? 'views' : metric;
    const rows = accounts.map(account => {
      const videos = records.filter(record => record.accountId === account.id);
      if (key === 'publications') {
        const value = videos.filter(record => within(record.publishedAt, dates)).length;
        const previous = videos.filter(record => within(record.publishedAt, prior)).length;
        return { account, value, change: previous ? (value - previous) / previous * 100 : null };
      }
      const gains = videos.map(record => [gain(record, key, dates), gain(record, key, prior)]).filter(([current]) => current != null);
      const value = gains.length ? gains.reduce((total, [current]) => total + current, 0) : null;
      const previous = gains.length && gains.every(([, before]) => before != null) ? gains.reduce((total, [, before]) => total + before, 0) : 0;
      const change = previous > 0 ? (value - previous) / previous * 100 : null;
      return { account, value: metric === 'growth' ? change : value, change };
    }).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    const max = Math.max(0, ...rows.map(row => row.value ?? 0));
    ranking.body.replaceChildren();
    for (const { account, value, change } of rows) {
      const name = element('button', 'analytics-account-link');
      name.type = 'button';
      const avatar = platformIcon(account.platform);
      avatar.classList.add('account-avatar');
      if (account.platform === 'instagram' && account.meta?.connected) {
        avatar.dataset.accountId = account.id;
        accountPhotoObserver.observe(avatar);
      }
      name.append(avatar, element('span', '', `${profileLabel(account)} · ${platformName(account.platform)}`));
      name.onclick = () => {
        const filter = document.querySelector('#dashboard-account'); filter.value = account.id;
        filter.dispatchEvent(new Event('change'));
      };
      const row = meterRow(name, value == null ? null : Math.round(value * 10) / 10, max, metric === 'growth' ? '%' : '');
      if (metric !== 'growth' && change != null) row.append(element('small', 'dashboard-muted', `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs. comparação`));
      ranking.body.append(row);
    }
    if (!rows.length) ranking.body.append(element('p', 'dashboard-empty', 'Nenhuma conta neste filtro.'));
  }
  renderDashboardChart = (_histories, allHistories, dates, platform, items = []) => {
    const root = document.querySelector('#dashboard-chart'); root.replaceChildren();
    const key = document.querySelector('[data-chart-metric][aria-pressed="true"]').dataset.chartMetric;
    if (!supported(platform, key)) { root.append(element('p', 'dashboard-empty', 'Métrica indisponível nesta rede.')); return; }
    currentLegend.textContent = metricLabels[key];
    leftAxisLabel.textContent = `Eixo esquerdo · ${metricLabels[key]}`;
    previousLegend.hidden = !check.checked;
    publicationToggle.hidden = rightAxisLabel.hidden = platform !== 'instagram';
    const showPublications = platform === 'instagram' && publicationCheck.checked;
    rightAxisLabel.hidden = !showPublications;
    const hours = (dates.to - dates.from) / 3600000;
    const selected = document.querySelector('#dashboard-group').value;
    const group = selected === 'auto' ? hours <= 48 ? '1' : hours <= 35 * 24 ? '24' : 'week' : selected;
    const current = seriesBuckets(allHistories.values(), key, dates, group);
    const publications = showPublications ? publicationBuckets(items, dates, group) : [];
    const prior = comparisonRange(dates);
    const previous = check.checked ? seriesBuckets(allHistories.values(), key, prior, group) : [];
    document.querySelector('#dashboard-comparison').textContent = check.checked && !previous.length ? 'Sem leituras comparáveis no outro período.' : '';
    if (!current.length && !publications.length) { root.append(element('p', 'dashboard-empty', showPublications ? 'Aguardando duas leituras ou Reels publicados no intervalo.' : 'Aguardando duas leituras no intervalo.')); return; }

    const tooltip = element('p', 'analytics-tooltip', 'Selecione um ponto para consultar o valor e a variação.');
    tooltip.setAttribute('aria-live', 'polite');
    const max = Math.max(1, ...current.map(point => point[1]), ...previous.map(point => point[1]));
    const publicationMax = Math.max(1, ...publications.map(point => point[1]));
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 900 230'); svg.setAttribute('aria-label', platform === 'instagram' ? `${metricLabels[key]} e Reels postados` : metricLabels[key]);
    const node = (tag, attrs) => {
      const item = document.createElementNS(ns, tag);
      for (const [name, value] of Object.entries(attrs)) item.setAttribute(name, value);
      svg.append(item); return item;
    };
    for (let i = 0; i <= 4; i++) {
      const y = 18 + i * 42;
      node('line', { x1: 65, x2: 835, y1: y, y2: y, class: 'insights-grid' });
      node('text', { x: 57, y: y + 4, 'text-anchor': 'end', class: 'insights-axis' }).textContent = current.length || previous.length ? number(Math.round(max * (4 - i) / 4)) : '—';
      if (showPublications) node('text', { x: 844, y: y + 4, class: 'insights-axis insights-publication-axis' }).textContent = number(Math.round(publicationMax * (4 - i) / 4));
    }
    const xFor = (at, range) => 65 + Math.max(0, (at - range.from) / Math.max(1, range.to - range.from)) * 770;
    function draw(values, range, isPrevious) {
      const coords = values.map(([at, value]) => [xFor(at, range), 186 - value / max * 168]);
      const color = isPrevious ? '#868392' : '#ad86df';
      const gap = (group === 'week' ? 7 * 86400000 : Number(group) * 3600000) + 3600000;
      let segment = [];
      const flush = () => { if (segment.length) node('polyline', { points: segment.map(point => point.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-dasharray': isPrevious ? '6 5' : 'none' }); segment = []; };
      coords.forEach((point, index) => { if (index && values[index][0] - values[index-1][0] > gap) flush(); segment.push(point); }); flush();
      coords.forEach(([x, y], index) => {
        const [at, value] = values[index], last = values[index - 1];
        const interval = group === 'week' ? 7 * 86400000 : Number(group) * 3600000;
        const comparable = last && at - last[0] <= interval + 3600000;
        const delta = comparable ? value - last[1] : null;
        const text = `${isPrevious ? 'Comparação' : 'Atual'} · ${dateTime(at)} · ${number(value)} ${metricLabels[key].toLowerCase()}${delta == null ? '' : ` · variação ${delta >= 0 ? '+' : ''}${number(delta)}`}`;
        const point = node('circle', { cx: x, cy: y, r: 5, fill: color, tabindex: 0, 'aria-label': text });
        point.addEventListener('pointerenter', () => { tooltip.textContent = text; });
        point.addEventListener('focus', () => { tooltip.textContent = text; });
        if (!isPrevious && index % Math.max(1, Math.ceil(coords.length / 6)) === 0) {
          const label = new Date(at).toLocaleString('pt-BR', Number(group) < 24 ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit' });
          node('text', { x: Math.max(80, Math.min(820, x)), y: 215, 'text-anchor': 'middle', class: 'insights-axis' }).textContent = label;
        }
      });
    }
    if (previous.length) draw(previous, prior, true);
    if (current.length) draw(current, dates, false);
    if (showPublications) {
      const counts = new Map(publications);
      const slots = new Set([...current.map(([at]) => at), ...counts.keys()]);
      const first = bucketTime(dates.from, group), last = bucketTime(dates.to, group);
      let at = first;
      for (let index = 0; at <= last && index <= 500; index++) {
        slots.add(at);
        const next = new Date(at);
        if (group === 'week') next.setDate(next.getDate() + 7);
        else next.setHours(next.getHours() + Number(group));
        if (+next <= at) break;
        at = +next;
      }
      if (at <= last) slots.add(last);
      const values = [...slots].sort((a, b) => a - b).map(at => [at, counts.get(at) || 0]);
      const coords = values.map(([at, value]) => [xFor(at, dates), 186 - value / publicationMax * 168]);
      const color = '#48c7b2';
      node('polyline', { points: coords.map(point => point.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, class: 'insights-publication-line' });
      values.forEach(([at, value], index) => {
        if (!value) return;
        const [x, y] = coords[index];
        const message = `${dateTime(at)} · ${number(value)} Reel(s) postado(s)`;
        const point = node('circle', { cx: x, cy: y, r: 5, fill: color, tabindex: 0, 'aria-label': message });
        point.addEventListener('pointerenter', () => { tooltip.textContent = message; });
        point.addEventListener('focus', () => { tooltip.textContent = message; });
        if (!current.length && index % Math.max(1, Math.ceil(values.length / 6)) === 0) {
          const label = new Date(at).toLocaleString('pt-BR', Number(group) < 24 ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit' });
          node('text', { x: Math.max(80, Math.min(820, x)), y: 215, 'text-anchor': 'middle', class: 'insights-axis' }).textContent = label;
        }
      });
    }
    if (current.length) {
      const [at, value] = current.at(-1), priorPoint = current.at(-2);
      const interval = group === 'week' ? 7 * 86400000 : Number(group) * 3600000;
      const delta = priorPoint && at - priorPoint[0] <= interval + 3600000 ? value - priorPoint[1] : null;
      tooltip.textContent = `Atual · ${dateTime(at)} · ${number(value)} ${metricLabels[key].toLowerCase()}${delta == null ? '' : ` · variação ${delta >= 0 ? '+' : ''}${number(delta)}`}`;
    } else if (publications.length) {
      const [at, value] = publications.at(-1);
      tooltip.textContent = `${dateTime(at)} · ${number(value)} Reel(s) postado(s)`;
    }
    root.append(svg, tooltip, element('p', 'dashboard-muted', 'Ganhos agrupados pelo horário da coleta final; publicações pelo horário de postagem.'));
  };

  renderDashboardQueue = items => {
    const root=document.querySelector('#dashboard-queue');root.replaceChildren();
    const platform=document.querySelector('#dashboard-platform').value;
    for(const id of ['instagram','tiktok','x']){if(platform!=='all'&&platform!==id)continue;const row=element('div','insights-queue-row');const head=element('div','insights-queue-head');head.append(platformIcon(id),element('strong','',platformName(id)));row.append(head);
      if(id!=='instagram'){head.append(element('span','','Indisponível'));root.append(row);continue;}
      const dates=dashboardDates();const filtered=items.filter(i=>{const at=Date.parse(i.status==='published'?i.published_at:i.created_at);return at>=dates.from&&at<=dates.to;});const queued=filtered.filter(i=>['queued','uploading','processing','publishing'].includes(i.status)).length, published=filtered.filter(i=>i.status==='published').length,attention=filtered.filter(i=>['attention','uncertain'].includes(i.status)).length;
      head.append(element('strong','',`${queued} na fila`)); const counts=element('div','insights-queue-counts');counts.append(element('span','',`${published} publicados`),element('span',attention?'insights-alert':'',`${attention} precisam de atenção`));row.append(counts);root.append(row);
    }
  };
  renderDashboardPlatforms = (items,histories) => {
    const root=document.querySelector('#dashboard-platforms');root.replaceChildren();const selected=document.querySelector('#dashboard-platform').value,account=document.querySelector('#dashboard-account').value,dates=dashboardDates();
    const results=['instagram','tiktok','x'].filter(p=>selected==='all'||selected===p).map(platform=>{const accounts=state.accounts.filter(a=>a.platform===platform&&(account==='all'||a.id===account));const ids=new Set(accounts.map(a=>a.id));let total=0,measured=0;
      if(platform==='instagram')for(const item of items){const value=metricValue(histories.get(item.id)||[],'views');if(value!==null){total+=value;measured++;}}
      if(platform==='tiktok'){const videos=new Map();for(const point of state.tiktokInsights?.history||[]){const at=Date.parse(point.fetched_at);if(!ids.has(point.account_id)||at<dates.from||at>dates.to)continue;const key=`${point.account_id}:${point.video_id}`;if(!videos.has(key))videos.set(key,[]);videos.get(key).push(point);}for(const points of videos.values()){const value=metricValue(points,'views');if(value!==null){total+=value;measured++;}}}
      return {platform,accounts,total,measured};});const max=Math.max(1,...results.map(r=>r.total));
    for(const r of results){const row=element('div','dashboard-platform-row'),head=element('div','dashboard-platform-title');head.append(platformIcon(r.platform),element('strong','',platformName(r.platform)),element('small','',`${r.accounts.length} contas`));row.append(head,element('p','insights-platform-value',r.measured?`${r.total.toLocaleString('pt-BR')} views`:'Indisponível'));if(r.measured){const bar=element('div','insights-meter');const fill=element('span');fill.style.width=`${r.total/max*100}%`;bar.append(fill);bar.title='Comparação do crescimento observado';row.append(bar);}root.append(row);}
  };
  renderDashboardVideos = (published,insights) => {
    const hourly = reelSort.value === 'views-hour';
    const now = Date.now();
    const dates = hourly ? { from: now - 3600000, to: now } : dashboardDates();
    const platform=document.querySelector('#dashboard-platform').value;
    reelsPanel.querySelector('h2').textContent = hourly ? 'Top 3 Reels · última hora' : 'Top 3 Reels';
    published=(state.postings?.items||[]).filter(item=>item.status==='published'&&dashboardAccountMatches(item.account_id, platform)&&platform==='instagram');
    const measured=new Map();for(const item of published){const points=(state.postings?.insightHistory||[]).filter(p=>p.item_id===item.id&&Date.parse(p.fetched_at)>=dates.from&&Date.parse(p.fetched_at)<=dates.to);measured.set(item.id,{views:metricValue(points,'views'),reach:metricValue(points,'reach'),engagement:null});}insights=measured;
    const root=document.querySelector('#dashboard-reels');root.replaceChildren();allList.replaceChildren();const key=hourly ? 'views' : reelSort.value;
    const sorted=published.filter(i=>insights.get(i.id)?.[key]!=null).sort((a,b)=>insights.get(b.id)[key]-insights.get(a.id)[key]);
    document.querySelector('#dashboard-reels-count').textContent='';viewAll.disabled=!sorted.length;
    if (!sorted.length) {
      const message = hourly ? 'Aguardando duas leituras de um mesmo Reel na última hora.' : key === 'engagement' ? 'Indisponível' : 'Sem métricas neste período.';
      root.append(element('p', 'dashboard-empty', message));
      return;
    }
    const makeRow=(item,index)=>{const row=element('div','dashboard-video-row');row.append(element('span','insights-rank',`${index+1}º`));const thumb=element('div','dashboard-thumb','▶');row.append(thumb);window.studio.videoThumbnail(item.id).then(data=>{if(data&&thumb.isConnected){const img=element('img');img.src=data;img.alt='';thumb.replaceChildren(img);}}).catch(()=>{});const account=state.accounts.find(a=>a.id===item.account_id),m=insights.get(item.id);const detail=element('div','dashboard-video-details');detail.append(element('strong','',item.caption||fileName(item.file)),element('span','',`Instagram · ${account?profileLabel(account):item.account_name||'Conta removida'}`),element('small','',`${m.views==null?'—':m.views.toLocaleString('pt-BR')} views${m.reach==null?'':` · ${m.reach.toLocaleString('pt-BR')} alcance`}`));row.append(detail);if(item.permalink)row.append(actionButton('Abrir',()=>window.studio.openPublishedReel(item.id)));return row;};
    sorted.slice(0,3).forEach((item,i)=>root.append(makeRow(item,i)));viewAll.onclick=()=>{allList.replaceChildren();sorted.forEach((item,i)=>allList.append(makeRow(item,i)));allVideos.showModal();};
  };
  const originalRender=renderDashboard;
  renderDashboard=()=>{
    const platform = document.querySelector('#dashboard-platform').value;
    const instagram = platform === 'instagram', tiktok = platform === 'tiktok';
    dashboard.querySelector('h1').textContent = `Dashboard · ${platformName(platform)}`;
    queuePanel.hidden = bottom.hidden = !instagram;
    campaign.hidden = instagram;
    campaign.querySelector('.dashboard-muted').textContent = tiktok
      ? 'Comentários confirmados e ações a conferir nas campanhas do Studio.'
      : 'Respostas e curtidas registradas nas campanhas do Studio.';
    analysis.hidden = platform === 'x';
    hourlyPanel.hidden = platform === 'x';
    document.querySelector('#dashboard-tiktok-settings').hidden = !tiktok;
    document.querySelector('#dashboard-refresh-insights').hidden = platform === 'x';
    document.querySelector('#dashboard-refresh-status').hidden = platform === 'x';
    document.querySelector('#dashboard-auto-refresh').hidden = platform === 'x';
    for (const tab of dashboard.querySelectorAll('[data-chart-metric]')) {
      const metric = tab.dataset.chartMetric;
      tab.disabled = !supported(platform, metric);
      tab.title = tab.disabled ? 'Métrica indisponível nesta rede' : '';
      if (tab.disabled && tab.getAttribute('aria-pressed') === 'true') {
        tab.setAttribute('aria-pressed', 'false');
        dashboard.querySelector('[data-chart-metric="views"]').setAttribute('aria-pressed', 'true');
      }
    }
    originalRender();
    const selectedAccounts = state.accounts.filter(account => account.platform === platform && dashboardAccountMatches(account.id, platform));
    const advancedDates = dashboardDates();
    timing.panel.hidden = engagementPanel.panel.hidden = ranking.panel.hidden = platform === 'x';
    const records = platform === 'x' ? [] : analyticsData(platform, selectedAccounts);
    if (platform !== 'x' && Number.isFinite(advancedDates.from)) {
      selectAvailable(timing.select, platform);
      selectAvailable(ranking.select, platform);
      renderTiming(records, advancedDates);
      renderEngagement(records, advancedDates, platform);
      renderRanking(selectedAccounts, records, advancedDates, comparisonRange(advancedDates));
    } else if (platform !== 'x') {
      for (const { body } of [timing, engagementPanel, ranking]) body.replaceChildren(element('p', 'dashboard-empty', 'Selecione um intervalo válido.'));
    }
    document.querySelectorAll('#dashboard-metrics .dashboard-metric').forEach(card=>{const note=card.querySelector('small');card.title=note.textContent;note.hidden=false;});
    const cards=document.querySelectorAll('#dashboard-metrics .dashboard-metric');
    cards.forEach((card, index) => { card.hidden = platform === 'x' ? index !== 5 : tiktok ? [1, 4].includes(index) : index === 3; });
    const engagement=cards[3];engagement.querySelector('span').textContent='Engajamento';engagement.querySelector('strong').textContent=platform==='tiktok'?cards[1].querySelector('strong').textContent:'—';engagement.title=platform==='tiktok'?'Curtidas + comentários + compartilhamentos':'Indisponível';if(platform==='tiktok'){cards[1].querySelector('span').textContent='Alcance';cards[1].querySelector('strong').textContent='—';}
    const selectedIds = new Set(selectedAccounts.map(account => account.id));
    const attention = new Map();
    const addAttention = (id, reason, posting = false) => {
      if (!selectedIds.has(id)) return;
      if (!attention.has(id)) attention.set(id, { reasons: new Set(), posting: false });
      attention.get(id).reasons.add(reason);
      attention.get(id).posting ||= posting;
    };
    for (const account of selectedAccounts) {
      if (account.error) addAttention(account.id, typeof account.error === 'string' ? account.error : 'Erro na conta');
      if (account.meta?.needsReconnect || account.tiktokAnalytics?.needsReconnect) addAttention(account.id, 'Reconexão necessária');
    }
    for (const entry of state.automation?.attentionAccounts || []) addAttention(entry.accountId, entry.reason || 'Automação precisa de atenção');
    for (const entry of state.xAutomation?.accounts || []) if (entry.status === 'attention') addAttention(entry.accountId, entry.reason || 'Campanha precisa de atenção');
    for (const item of state.postings?.items || []) if (instagram && ['attention', 'uncertain'].includes(item.status)) addAttention(item.account_id, item.status === 'uncertain' ? 'Publicação com resultado incerto' : 'Publicação precisa de atenção', true);
    cards[5].querySelector('span').textContent = 'Contas em atenção';
    cards[5].querySelector('strong').textContent = attention.size;
    cards[5].querySelector('small').textContent = attention.size ? 'Clique para ver os motivos' : 'Nenhuma conta em atenção';
    cards[5].classList.toggle('insights-attention-trigger', attention.size > 0);
    if (attention.size) {
      cards[5].setAttribute('role', 'button'); cards[5].tabIndex = 0;
      cards[5].onclick = () => attentionDialog.showModal();
      cards[5].onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); attentionDialog.showModal(); } };
    } else {
      cards[5].removeAttribute('role'); cards[5].removeAttribute('tabindex'); cards[5].onclick = cards[5].onkeydown = null;
    }
    attentionList.replaceChildren();
    for (const account of selectedAccounts) {
      const issue = attention.get(account.id);
      if (!issue) continue;
      const row = element('div', 'insights-attention-row');
      row.append(element('strong', '', `${profileLabel(account)} · ${platformName(account.platform)}`));
      for (const reason of issue.reasons) row.append(element('p', '', reason));
      const actions = element('div', 'insights-attention-actions');
      const openAccount = element('button', 'secondary', 'Ver conta'); openAccount.type = 'button';
      openAccount.onclick = () => {
        attentionDialog.close();
        document.querySelector('#account-platform-filter').value = account.platform;
        document.querySelector('#account-status-filter').value = 'all';
        document.querySelector('#account-connection-filter').value = 'all';
        document.querySelector('#account-proxy-filter').value = 'all';
        document.querySelector('#account-search').value = account.handle || account.name;
        renderAccounts(); page('accounts');
      };
      actions.append(openAccount);
      if (issue.posting) {
        const openQueue = element('button', 'secondary', 'Ver fila'); openQueue.type = 'button';
        openQueue.onclick = () => { attentionDialog.close(); page('postings'); document.querySelector('[data-posting-tab="queue"]')?.click(); };
        actions.append(openQueue);
      }
      row.append(actions); attentionList.append(row);
    }
    const status = document.querySelector('#dashboard-refresh-status');
    status.title = status.textContent;
    const ownersByItem = new Map((state.postings?.items || []).map(item => [item.id, item.account_id]));
    const readings = tiktok ? state.tiktokInsights?.videos : state.postings?.insights;
    const times = (readings || []).filter(point => selectedIds.has(tiktok ? point.account_id : ownersByItem.get(point.item_id)))
      .map(point => Date.parse(point.fetched_at)).filter(Number.isFinite);
    const latest = times.length ? Math.max(...times) : null;
    status.textContent = dashboardRefreshing ? 'Atualizando…' : latest ? `Última coleta: ${dateTime(latest)}` : 'Sem coleta registrada';
    status.title = status.textContent;
    if (platform !== 'x') cards[0].querySelector('small').textContent = `${cards[0].title} · ${latest ? `Última coleta: ${dateTime(latest)}` : 'Sem coleta registrada'}`;
    if (platform === 'x') return;
    const prior = comparisonRange(advancedDates);
    function addVariation(index, current, before) {
      const delta = check.checked ? window.dashboardAnalytics.comparisonVariation(current, before) : null;
      const comparable = delta != null;
      const customComparison = document.querySelector('#dashboard-compare-from').value && document.querySelector('#dashboard-compare-to').value;
      const badge = element('small', 'insights-change', comparable ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs. ${customComparison ? 'período escolhido' : 'período anterior'}` : 'Sem comparação');
      badge.title = comparable ? `Comparação: ${dateTime(prior.from)} a ${dateTime(prior.to)}` : 'Sem base comparável neste período';
      cards[index].append(badge);
    }
    for (const [index, metric] of [[0, 'views'], [1, 'reach'], [3, 'engagement']]) {
      if (!supported(platform, metric)) continue;
      const pairs = records.map(record => [gain(record, metric, advancedDates), gain(record, metric, prior)]).filter(([value]) => value != null);
      const complete = pairs.length && pairs.every(([, before]) => before != null);
      addVariation(index, pairs.length ? pairs.reduce((sum, [value]) => sum + value, 0) : null, complete ? pairs.reduce((sum, [, before]) => sum + before, 0) : null);
    }
    addVariation(2, records.filter(record => within(record.publishedAt, advancedDates)).length, records.filter(record => within(record.publishedAt, prior)).length);
  };
})();
