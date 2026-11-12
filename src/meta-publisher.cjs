const { setTimeout: delay } = require('node:timers/promises');

class MetaPublisher {
  constructor({ fetch, version = 'v23.0', wait = delay }) { this.fetch = fetch; this.version = version; this.wait = wait; }
  async call(method, route, token, fields = {}) {
    const url = new URL(`https://graph.instagram.com/${this.version}/${route}`);
    if (method === 'GET') for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, String(value));
    const response = await this.fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(method === 'POST' ? { body: new URLSearchParams(fields) } : {}) });
    const data = await response.json();
    if (!response.ok || data.error) {
      const code = Number(data.error?.code);
      const error = new Error(`A Meta recusou a operação${Number.isInteger(code) && code > 0 ? ` (código ${code})` : ''}.`);
      error.metaCode = code;
      error.metaSubcode = Number(data.error?.error_subcode) || null;
      error.metaMessage = String(data.error?.message || '');
      error.transient = Boolean(data.error?.is_transient);
      error.httpStatus = response.status;
      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMinutes = Math.ceil(retryAfter / 60);
      throw error;
    }
    return data;
  }
  async create(igId, token, videoUrl, caption) {
    const data = await this.call('POST', `${igId}/media`, token, { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true' });
    if (!data.id) throw new Error('A Meta não retornou o ID de preparação do Reel.');
    return data.id;
  }
  async waitReady(containerId, token, onStatus = () => {}) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const data = await this.call('GET', containerId, token, { fields: 'status_code,status' });
      onStatus(data.status_code);
      if (data.status_code === 'FINISHED') return;
      if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') throw new Error('A Meta não conseguiu processar o vídeo.');
      await this.wait(15000);
    }
    throw new Error('A Meta não concluiu o processamento dentro de dez minutos.');
  }
  async publish(igId, token, containerId) {
    const data = await this.call('POST', `${igId}/media_publish`, token, { creation_id: containerId });
    if (!data.id) throw new Error('O resultado da publicação ficou incerto. Confira o perfil.');
    return data.id;
  }
  async permalink(mediaId, token) {
    const data = await this.call('GET', mediaId, token, { fields: 'permalink' });
    return data.permalink || '';
  }
  async callFacebook(method, route, token, fields = {}, bodyJson = null, headers = {}) {
    const url = route.startsWith('http') ? new URL(route) : new URL(`https://graph.facebook.com/${this.version}/${route}`);
    if (method === 'GET') for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, String(value));
    let body;
    const reqHeaders = { Authorization: `Bearer ${token}`, ...headers };
    if (bodyJson !== null) {
      reqHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify(bodyJson);
    } else if (method === 'POST') {
      reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(fields);
    }
    const response = await this.fetch(url, { method, headers: reqHeaders, ...(body !== undefined ? { body } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const code = Number(data.error?.code);
      const error = new Error(`O Facebook recusou a operação${Number.isInteger(code) && code > 0 ? ` (código ${code})` : ''}: ${data.error?.message || response.statusText}`);
      error.metaCode = code;
      error.metaSubcode = Number(data.error?.error_subcode) || null;
      error.metaMessage = String(data.error?.message || '');
      error.transient = Boolean(data.error?.is_transient);
      error.httpStatus = response.status;
      throw error;
    }
    return data;
  }
  async createFacebookReel(pageId, pageToken) {
    const data = await this.callFacebook('POST', `${pageId}/video_reels`, pageToken, {}, { upload_phase: 'start' });
    if (!data.video_id) throw new Error('O Facebook não retornou o ID de preparação do Reel.');
    return { videoId: data.video_id, uploadUrl: data.upload_url };
  }
  async uploadFacebookReelUrl(uploadUrl, pageToken, videoUrl) {
    const response = await this.fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${pageToken}`,
        file_url: videoUrl
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error || data.success === false) {
      throw new Error(`Falha no upload do vídeo para o Facebook: ${data.error?.message || response.statusText}`);
    }
    return data;
  }
  async finishFacebookReel(pageId, pageToken, videoId, caption) {
    const data = await this.callFacebook('POST', `${pageId}/video_reels`, pageToken, {}, {
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
      description: caption
    });
    if (!data.success && !data.id) throw new Error('O Facebook não confirmou a publicação do Reel.');
    return data.id || videoId;
  }
  async facebookPermalink(videoId, pageToken) {
    try {
      const data = await this.callFacebook('GET', videoId, pageToken, { fields: 'permalink_url' });
      return data.permalink_url || `https://www.facebook.com/reel/${videoId}`;
    } catch {
      return `https://www.facebook.com/reel/${videoId}`;
    }
  }
  async publishFacebookReel(pageId, pageToken, videoUrl, caption) {
    const session = await this.createFacebookReel(pageId, pageToken);
    if (session.uploadUrl) {
      await this.uploadFacebookReelUrl(session.uploadUrl, pageToken, videoUrl);
    }
    const publishedId = await this.finishFacebookReel(pageId, pageToken, session.videoId, caption);
    const permalink = await this.facebookPermalink(publishedId, pageToken);
    return { videoId: publishedId, permalink };
  }
  async insights(mediaId, token) {
    const data = await this.call('GET', `${mediaId}/insights`, token, { metric: 'views,reach' });
    const result = { views: null, reach: null };
    for (const metric of data.data || []) {
      if (!Object.hasOwn(result, metric.name)) continue;
      const value = metric.total_value?.value ?? metric.values?.at(-1)?.value;
      if (value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) >= 0) result[metric.name] = Number(value);
    }
    return result;
  }
  async accountInsights(igId, token, from, to, breakdown = true) {
    const data = await this.call('GET', `${igId}/insights`, token, {
      metric: 'views', period: 'day', metric_type: 'total_value',
      since: Math.floor(from / 1000), until: Math.floor(to / 1000),
      ...(breakdown ? { breakdown: 'media_product_type' } : {})
    });
    const metric = (data.data || []).find(entry => entry.name === 'views' && entry.period === 'day');
    const value = metric?.total_value?.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    let reels = null;
    for (const split of metric.total_value.breakdowns || []) {
      const index = split.dimension_keys?.indexOf('media_product_type');
      if (index == null || index < 0) continue;
      const rows = (split.results || []).filter(row => ['REEL', 'REELS'].includes(row.dimension_values?.[index]));
      if (rows.length && rows.every(row => typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= 0)) reels = rows.reduce((sum, row) => sum + row.value, 0);
    }
    return { views: value, reels, from, to, period: metric.period, timezone: 'UTC' };
  }
  async metricValues(route, token, metrics, params = {}, options = {}) {
    const read = data => Object.fromEntries(metrics.map(name => {
      const metric = (data.data || []).find(entry => entry.name === name);
      const value = metric?.total_value?.value ?? metric?.values?.at(-1)?.value;
      return [name, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null];
    }));
    const available = metrics.filter(name => !options.unsupported?.has(name) && !options.deferred?.has(name));
    if (!available.length) return Object.fromEntries(metrics.map(name => [name, null]));
    try {
      const values = read(await this.call('GET', route, token, { ...params, metric: available.join(',') }));
      return Object.fromEntries(metrics.map(name => [name, values[name] ?? null]));
    }
    catch (error) {
      if (error.metaCode !== 100 || error.transient || available.length === 1) {
        if (available.length === 1 && this.explicitlyUnsupported(error, available[0])) options.markUnsupported?.(available[0]);
        if (available.length === 1 && this.explicitlyUnsupported(error, available[0])) return Object.fromEntries(metrics.map(name => [name, null]));
        throw error;
      }
      const result = {}, rejected = [];
      let succeeded = false;
      for (const metric of available) {
        try { Object.assign(result, await this.metricValues(route, token, [metric], params, options)); succeeded = true; }
        catch (failure) { if (failure.metaCode !== 100 || failure.transient) throw failure; result[metric] = null; rejected.push(metric); }
      }
      if (succeeded) for (const metric of rejected) options.markDeferred?.(metric);
      return Object.fromEntries(metrics.map(name => [name, result[name] ?? null]));
    }
  }
  explicitlyUnsupported(error, metric) {
    const message = String(error.metaMessage || '').toLowerCase();
    return error.metaCode === 100 && !error.transient && message.includes(metric.toLowerCase()) && /invalid|unsupported|not available|not supported|não dispon[ií]vel|inv[aá]lid/.test(message);
  }
  accountMetrics(igId, token, from, to, options = {}) {
    return this.metricValues(`${igId}/insights`, token, ['views','reach','accounts_engaged','total_interactions','profile_views'], {
      period: 'day', metric_type: 'total_value', since: Math.floor(from / 1000), until: Math.floor(to / 1000)
    }, options);
  }
  mediaMetrics(mediaId, token, options = {}) {
    return this.metricValues(`${mediaId}/insights`, token, ['views','reach','likes','comments','shares','saved','ig_reels_avg_watch_time','ig_reels_video_view_total_time'], {}, options);
  }
}
module.exports = { MetaPublisher };
