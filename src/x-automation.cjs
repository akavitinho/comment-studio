const { randomUUID } = require('node:crypto');
const { xCampaign, eligible, ReplyBag, xTargets } = require('./x-domain.cjs');
const { XBrowser } = require('./x-browser.cjs');
const { needsManual } = require('./x-errors.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
class XAutomation {
  constructor({ store, onChange = () => {}, driver, getWindow, openAccount, now = Date.now, wait = sleep, random = Math.random }) {
    Object.assign(this, { store, onChange, now, wait, random });
    this.driver = driver || new XBrowser({ getWindow, openAccount });
    this.workers = new Map(); this.status = 'idle'; this.used = 0; this.stopping = false;
    store.data.xAttempts ||= [];
    let changed = false;
    for (const a of store.data.xAttempts) if (a.status === 'pending') { a.status = 'unknown'; changed = true; }
    if (changed) store.save();
  }
  isActive() { return ['running', 'paused', 'stopping'].includes(this.status); }
  owns(id) { return this.isActive() && this.workers.has(id) && !this.workers.get(id).done; }
  snapshot() {
    return { status: this.status, used: this.used, limit: this.config?.sessionLimit || 0,
      accounts: [...this.workers.values()].map(w => ({ accountId: w.id, status: w.done ? 'done' : w.attention ? 'attention' : w.paused || this.status === 'paused' ? 'paused' : w.status, message: w.message, likes: w.likes, replies: w.replies, scanned: w.scanned, recoveries: w.recoveries, uncertain: w.uncertain })) };
  }
  emit() { this.onChange(this.snapshot()); }
  configFromStore() {
    const c = this.store.data.xCampaign;
    if (!c) throw new Error('Salve a configuração do X antes de iniciar.');
    return xCampaign({ ...c, hashtags: (c.hashtags || []).join(','), queries: (c.queries || []).join('\n'), comments: c.comments.join('\n') }, this.store.data.accounts);
  }
  start() {
    if (this.isActive() || this.checking) throw new Error('Já existe uma execução ou verificação do X.');
    this.config = this.configFromStore(); this.workers.clear(); this.used = 0; this.stopping = false; this.status = 'running';
    for (const id of this.config.accountIds) this.workers.set(id, { id, status: 'running', message: 'Abrindo pesquisa…', paused: false, attention: false, done: false, likes: 0, replies: 0, scanned: 0, recoveries: 0, uncertain: 0, failures: 0, skippedActions: new Set(), bag: new ReplyBag(this.config.comments, this.random) });
    this.emit();
    this.completion = Promise.all([...this.workers.values()].map(w => this.run(w).finally(() => { w.done = true; this.emit(); }))).finally(() => { this.status = 'idle'; this.emit(); });
    return this.snapshot();
  }
  pause(id) { if (!this.isActive()) return; if (id) { const w = this.workers.get(id); if (w) w.paused = true; } else if (!this.stopping) this.status = 'paused'; this.emit(); }
  resume(id) { if (!this.isActive() || this.stopping) return; if (id) { const w = this.workers.get(id); if (w) { w.paused = false; w.attention = false; w.message = 'Retomando…'; } } else this.status = 'running'; this.emit(); }
  stop() { if (!this.isActive()) return; this.stopping = true; this.status = 'stopping'; this.emit(); }
  stopAccount(id) { const w = this.workers.get(id); if (w && this.isActive()) { w.stopping = true; w.message = 'Encerrando esta conta…'; this.emit(); } }
  async gate(w) {
    while (!this.stopping && !w.stopping && this.used < this.config.sessionLimit && (this.status === 'paused' || w.paused || w.attention)) await this.wait(150);
    return !this.stopping && !w.stopping && this.used < this.config.sessionLimit;
  }
  async delay(w, ms) { let remaining = ms; while (remaining > 0) { if (!await this.gate(w)) return false; const part = Math.min(250, remaining); await this.wait(part); remaining -= part; } return this.gate(w); }
  attention(w, message) { w.attention = true; w.status = 'attention'; w.message = message; this.emit(); }
  async recover(w, message) {
    w.recoveries++; w.failures++;
    const cooldown = w.failures >= 3;
    w.status = 'recovering';
    w.message = `${message} ${cooldown ? 'Três falhas seguidas: aguardando 60 segundos antes de continuar.' : 'Continuando automaticamente em 2 segundos.'}`;
    this.emit();
    const proceed = await this.delay(w, cooldown ? 60000 : 2000);
    if (cooldown) w.failures = 0;
    return proceed;
  }
  async readRetry(w, operation, { post = false } = {}) {
    for (;;) {
      let error;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!await this.gate(w)) return null;
        try { return await operation(); } catch (e) { error = e; }
        if (needsManual(error)) break;
        w.status = 'recovering'; w.message = `Falha de leitura. Tentativa ${attempt + 1}/3: ${error.message}`; this.emit();
        if (attempt < 2 && !await this.delay(w, (attempt + 1) * 1000)) return null;
      }
      if (needsManual(error)) {
        this.attention(w, error.message);
        if (!await this.gate(w)) return null;
      } else {
        if (!await this.recover(w, `Falha de leitura: ${error.message}`)) return null;
        if (post) return null;
      }
    }
  }
  seen(id, postId, action) { return this.store.data.xAttempts.some(a => a.accountId === id && a.postId === postId && a.action === action && ['pending', 'confirmed', 'unknown', 'skipped'].includes(a.status)); }
  hourly(id) { return this.store.data.xAttempts.filter(a => a.accountId === id && ['pending', 'confirmed', 'unknown'].includes(a.status) && Date.parse(a.at) > this.now() - 3600000); }
  reserve(w, post, action) {
    if (this.stopping || w.stopping || this.status !== 'running' || w.paused || w.attention || this.used >= this.config.sessionLimit || this.hourly(w.id).length >= this.config.hourlyLimit || this.seen(w.id, post.id, action)) return null;
    const record = { id: randomUUID(), accountId: w.id, postId: post.id, url: post.url, action, at: new Date(this.now()).toISOString(), status: 'pending' };
    this.store.data.xAttempts.unshift(record);
    try { this.store.save(); } catch (e) { this.store.data.xAttempts.shift(); throw e; }
    this.used++; this.emit(); return record;
  }
  record(w, post, action, status, message) {
    this.store.data.xAttempts.unshift({ id: randomUUID(), accountId: w.id, postId: post.id, url: post.url, action, status, message, at: new Date(this.now()).toISOString() }); this.store.save(); this.emit();
  }
  async capacity(w) {
    while (await this.gate(w)) {
      const entries = this.hourly(w.id);
      if (entries.length < this.config.hourlyLimit) { w.status = 'running'; return true; }
      const release = Math.min(...entries.map(a => Date.parse(a.at))) + 3600000;
      w.status = 'waiting'; w.message = `Limite por hora. Retomada após ${new Date(release).toLocaleTimeString('pt-BR')}.`; this.emit();
      if (!await this.delay(w, Math.min(1000, Math.max(1, release - this.now())))) return false;
    }
    return false;
  }
  async interact(w, post, action) {
    const key = `${post.id}:${action}`;
    if (this.seen(w.id, post.id, action)) return true;
    if (w.skippedActions.has(key)) return false;
    const text = action === 'reply' ? w.bag.next() : '';
    let retries = 0;
    while (await this.capacity(w)) {
      let record;
      try {
        const state = await this.readRetry(w, () => this.driver.inspectPost(w.id, post), { post: true });
        if (!state) { w.skippedActions.add(key); return false; }
        const actual = state.posts.find(p => p.id === post.id);
        if (!actual || !eligible(actual, state.handle, this.config, this.now())) return false;
        if (!await this.gate(w)) return false;
        const prepared = await this.driver.prepare(w.id, post, action, text);
        if (prepared.skipped) { this.record(w, post, action, 'skipped', 'Post já curtido.'); w.failures = 0; return true; }
        if (!await this.gate(w)) return false;
        const result = await this.driver.send(w.id, post, action, text, prepared, () => Boolean(record = this.reserve(w, post, action)));
        if (result === 'cancelled') continue;
        if (record) {
          if (result !== 'confirmed') throw new Error('O X não confirmou o resultado da ação.');
          record.status = 'confirmed'; this.store.save();
          action === 'like' ? w.likes++ : w.replies++;
        } else if (result === 'skipped') this.record(w, post, action, 'skipped', 'Post já curtido.');
        w.failures = 0; w.status = 'running'; w.message = 'Ação confirmada. Avançando para o próximo post.';
        this.emit(); return true;
      } catch (error) {
        if (record) {
          record.status = 'unknown'; record.message = `Resultado incerto: ${error.message} A ação não será repetida.`;
          this.store.save(); w.uncertain++;
        } else this.record(w, post, action, 'failed', error.message);
        if (needsManual(error)) {
          this.attention(w, error.message);
          if (!await this.gate(w) || record) return false;
          retries = 0; continue;
        }
        if (record) {
          await this.recover(w, 'Resultado incerto registrado; pulando este post sem repetir o envio.');
          return false;
        }
        if (++retries < 2) {
          w.status = 'recovering'; w.message = `Falha anterior ao envio. Reabrindo o mesmo post para tentar novamente: ${error.message}`; this.emit();
          if (!await this.delay(w, 1500)) return false;
        } else {
          w.skippedActions.add(key);
          await this.recover(w, `Post pulado após duas falhas anteriores ao envio: ${error.message}`);
          return false;
        }
      }
    }
    return false;
  }
  async run(w) {
    try {
      while (await this.gate(w)) {
        let found = false;
        for (const tag of xTargets(this.config)) {
          if (!await this.gate(w)) return;
          const roundLimit = this.config.targetSwitchMin + Math.floor(this.random() * (this.config.targetSwitchMax - this.config.targetSwitchMin + 1));
          w.status = 'running'; w.message = this.config.targetType === 'foryou' ? 'Lendo Para você' : `Pesquisando ${this.config.targetType === 'search' ? '' : '#'}${tag}`; this.emit();
          let state = await this.readRetry(w, () => this.driver.search(w.id, tag, this.config.search, this.config.targetType));
          if (!state) return;
          const examined = new Set(), candidates = []; let stagnant = 0;
          while (examined.size < roundLimit && stagnant < 3) {
            const oldSize = examined.size;
            for (const post of state.posts) {
              if (examined.size >= roundLimit) break;
              if (examined.has(post.id)) continue;
              examined.add(post.id); w.scanned++;
              if (eligible(post, state.handle, this.config, this.now())) candidates.push(post);
            }
            this.emit();
            if (state.empty || examined.size >= roundLimit) break;
            stagnant = examined.size === oldSize ? stagnant + 1 : 0;
            if (stagnant >= 3) break;
            state = await this.readRetry(w, () => this.driver.more(w.id)); if (!state) return;
          }
          for (const post of candidates) {
            const actions = this.config.mode === 'both' ? ['reply', 'like'] : [this.config.mode];
            if (actions.every(a => this.seen(w.id, post.id, a) || w.skippedActions.has(`${post.id}:${a}`))) continue;
            found = true;
            for (const action of actions) { if (!await this.gate(w)) return; if (await this.interact(w, post, action) === false) break; }
            if (!await this.delay(w, (this.config.waitMin + this.random() * (this.config.waitMax - this.config.waitMin)) * 1000)) return;
          }
        }
        if (!found) { w.status = 'waiting'; w.message = 'Sem novos posts elegíveis. Nova pesquisa em 60 segundos.'; this.emit(); if (!await this.delay(w, 60000)) return; }
      }
    } catch { w.message = 'Execução interrompida por falha local. Confira o histórico antes de reiniciar.'; }
    finally { if (!w.attention) w.message = this.stopping || w.stopping ? 'Execução encerrada.' : this.used >= this.config.sessionLimit ? 'Limite total atingido.' : w.message; }
  }
  async check() {
    if (this.isActive() || this.checking) throw new Error('Pare o X antes de verificar acesso.');
    const c = this.configFromStore(); this.checking = true;
    try {
      const results = [];
      for (const id of c.accountIds) {
        try { const r = await this.driver.search(id, xTargets(c)[0], c.search, c.targetType); results.push({ accountId: id, ok: true, handle: r.handle }); }
        catch (e) { results.push({ accountId: id, ok: false, message: e.message }); }
      }
      return results;
    } finally { this.checking = false; }
  }
}
module.exports = { XAutomation };
