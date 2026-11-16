const fs = require('node:fs');
const { createProxyFetch } = require('./proxy-fetch.cjs');
const { MetaPublisher } = require('./meta-publisher.cjs');
const { validateReel } = require('./posting-media.cjs');
const { preparePostingVideo } = require('./posting-preparation.cjs');

class PostingWorker {
  constructor({ plan, storage, auth, facebookAuth = null, getFacebookTarget = () => null, net, getConnection, getAccount, onChange, onFailure = () => {}, validateMedia = validateReel, prepareMedia = preparePostingVideo, makePublisher = options => new MetaPublisher(options) }) {
    Object.assign(this, { plan, storage, auth, facebookAuth, getFacebookTarget, net, getConnection, getAccount, onChange, onFailure });
    this.validateMedia = validateMedia; this.prepareMedia = prepareMedia; this.makePublisher = makePublisher;
    this.active = new Set(); this.timer = setInterval(() => this.tick().catch(() => this.reportFailure(null)), 15000); this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); }
  reportFailure(accountId) {
    if (accountId) { try { this.plan.pauseAccount(accountId); } catch { /* The local database may be unavailable. */ } }
    try { this.onFailure(accountId); } catch { /* Do not turn reporting into another worker failure. */ }
  }
  async tick() {
    await this.cleanup();
    const activeGroups = new Set([...this.active].map(id => this.plan.db.prepare('SELECT group_id FROM schedules WHERE account_id=?').get(id)?.group_id).filter(Boolean));
    const due=this.plan.due(new Date(),this.active).sort((a,b)=>Date.parse(a.next_at)-Date.parse(b.next_at));
    for (const schedule of due) {
      if (this.active.size >= 2) break;
      if (this.active.has(schedule.account_id)) continue;
      if (schedule.group_id && activeGroups.has(schedule.group_id)) continue;
      if (schedule.group_id) activeGroups.add(schedule.group_id);
      this.active.add(schedule.account_id);
      this.run(schedule.account_id).catch(() => this.reportFailure(schedule.account_id)).finally(() => { this.active.delete(schedule.account_id); try { this.onChange(); } catch { /* The next snapshot may recover. */ } });
    }
  }
  async cleanup() {
    const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();
    const stale = this.plan.db.prepare('SELECT path,item_id,account_id FROM storage_objects WHERE uploaded_at<? LIMIT 5').all(cutoff);
    for (const item of stale) {
      if (this.active.has(item.account_id)) continue;
      try {
        const connection = await this.getConnection(item.account_id);
        const { client } = await this.storage.session(item.account_id, connection);
        await this.storage.remove(client, item.path);
        this.plan.clearStoragePath(item.item_id, item.path);
      } catch { /* Keep the path for a later cleanup attempt. */ }
    }
  }
  async cleanupAccount(accountId) {
    const objects = this.plan.db.prepare('SELECT path,item_id FROM storage_objects WHERE account_id=?').all(accountId);
    if (!objects.length) return;
    const connection = await this.getConnection(accountId);
    const { client } = await this.storage.session(accountId, connection);
    for (const object of objects) {
      await this.storage.remove(client, object.path);
      this.plan.clearStoragePath(object.item_id, object.path);
    }
  }
  async run(accountId) {
    const item = this.plan.claim(accountId); if (!item) return;
    if (this.getAccount(accountId)?.platform === 'facebook') return this.runFacebook(accountId, item);
    this.onChange(); let storageResult; let prepared; let published = false; let uncertain = false;
    try {
      const account = this.getAccount(accountId);
      if (!account || account.platform !== 'instagram' || !this.auth.status(accountId).connected) throw new Error('Reconecte a conta Instagram.');
      if (!fs.existsSync(item.file)) throw new Error('O arquivo de vídeo não existe mais.');
      const cover = this.plan.mediaSettings(accountId).cover;
      prepared = await this.prepareMedia(item.file, cover);
      await this.validateMedia(prepared.file, item.caption);
      const connection = await this.getConnection(accountId);
      storageResult = await this.storage.upload(accountId, connection, prepared.file);
      this.plan.phase(item.id, 'processing', { storagePath: storageResult.objectPath }); this.onChange();
      if (this.plan.db.prepare('SELECT status FROM schedules WHERE account_id=?').get(accountId)?.status !== 'running') throw Object.assign(new Error('Programação pausada antes da publicação.'), { interrupted: true });
      const token = await this.auth.token(accountId);
      const publisher = this.makePublisher({ fetch: createProxyFetch(this.net, connection), version: this.auth.data.graphVersion });
      const creationId = await publisher.create(this.auth.status(accountId).igId, token, storageResult.signedUrl, item.caption);
      this.plan.phase(item.id, 'processing', { creationId }); this.onChange();
      await publisher.waitReady(creationId, token);
      if (this.plan.db.prepare('SELECT status FROM schedules WHERE account_id=?').get(accountId)?.status !== 'running') throw Object.assign(new Error('Programação pausada antes da publicação.'), { interrupted: true });
      this.plan.phase(item.id, 'publishing'); this.onChange();
      const mediaId = await publisher.publish(this.auth.status(accountId).igId, token, creationId);
      published = true;
      let permalink = ''; try { permalink = await publisher.permalink(mediaId, token); } catch { /* Post already confirmed. */ }
      let facebookPermalink = null, facebookError = null;
      const media = this.plan.mediaSettings(accountId);
      if (media?.cross_post_facebook && media?.facebook_page_id) {
        try {
          const target = this.getFacebookTarget(media.facebook_page_id);
          if (target) {
            this.plan.addFacebook(target.id, { type: 'reel', file: item.file, caption: item.caption, sourceItemId: item.id }, target.name);
          } else if (media.facebook_page_token && publisher.publishFacebookReel) {
            const fbResult = await publisher.publishFacebookReel(media.facebook_page_id, media.facebook_page_token, storageResult.signedUrl, item.caption);
            facebookPermalink = fbResult?.permalink || null;
          } else {
            facebookError = 'Reconecte a Página Facebook para enviar este Reel à fila.';
          }
        } catch (fbErr) {
          facebookError = fbErr.message || 'Falha no cross-posting do Facebook';
        }
      }
      this.plan.phase(item.id, 'published', { mediaId, permalink, facebookPermalink, facebookError }); this.plan.advance(accountId); this.onChange();
    } catch (error) {
      if (error.metaCode === 190) this.auth.markReconnect(accountId);
      if (error.orphanPath) this.plan.trackStoragePath(item.id, error.orphanPath);
      const current = this.plan.db.prepare('SELECT status FROM items WHERE id=?').get(item.id)?.status;
      if (current === 'published' && published) { this.plan.db.prepare('UPDATE items SET error=? WHERE id=?').run('Reel publicado; confira a programação antes de continuar.', item.id); this.plan.pauseAccount(accountId); }
      else if (current === 'publishing' || published) { uncertain = true; this.plan.phase(item.id, 'uncertain', { error: 'Resultado da publicação incerto. Confira o perfil antes de continuar.' }); this.plan.pauseAccount(accountId); }
      else {
        const attempts = this.plan.db.prepare("SELECT count(*) AS n FROM attempts WHERE item_id=? AND phase='uploading' AND rowid>(SELECT COALESCE(MAX(rowid),0) FROM attempts WHERE item_id=? AND phase='manual_retry')").get(item.id, item.id).n;
        const attention = !error.interrupted && (error.proxyFailure || attempts >= 3 || /proxy|reconecte|arquivo|capa|autoriz|permiss|preparar|processar|ffmpeg|incompat|formato/i.test(error.message) || (error.metaCode && !error.transient));
        this.plan.phase(item.id, attention ? 'attention' : 'queued', { error: error.message });
        if (attention) this.plan.pauseAccount(accountId);
        else if (!error.interrupted) this.plan.delayRetry(accountId, Math.max(2 ** attempts, error.retryAfterMinutes || 0),new Date());
      }
      this.onChange();
    } finally {
      try { prepared?.cleanup(); } catch { /* A later system cleanup can remove the local temp file. */ }
      if (storageResult && !uncertain) {
        const removed = await this.storage.remove(storageResult.client, storageResult.objectPath).then(() => true, () => false);
        if (removed) this.plan.clearStoragePath(item.id, storageResult.objectPath);
      }
    }
  }
  async runFacebook(accountId, item) {
    this.onChange();
    let prepared, uploaded, uncertain = false;
    try {
      const page = this.getAccount(accountId);
      if (!page || page.platform !== 'facebook' || !this.facebookAuth?.status(accountId).connected) throw new Error('Reconecte a Página do Facebook.');
      const token = await this.facebookAuth.token(accountId);
      const connection = await this.getConnection(accountId);
      const publisher = this.makePublisher({ fetch: createProxyFetch(this.net, connection), version: 'v27.0' });
      if (this.plan.db.prepare('SELECT status FROM schedules WHERE account_id=?').get(accountId)?.status !== 'running') throw Object.assign(new Error('Programação pausada antes da publicação.'), { interrupted: true });
      let result;
      if (item.content_type === 'text') {
        this.plan.phase(item.id, 'publishing'); this.onChange();
        result = await publisher.publishFacebookText(page.facebookPageId, token, item.caption);
      } else if (item.content_type === 'photo') {
        if (!fs.existsSync(item.file)) throw new Error('O arquivo de foto não existe mais.');
        const stat = fs.statSync(item.file);
        if (stat.size > 10 * 1024 * 1024) throw new Error('A foto deve ter menos de 10 MB.');
        const source = { bytes: fs.readFileSync(item.file), name: require('node:path').basename(item.file), mime: /\.png$/i.test(item.file) ? 'image/png' : 'image/jpeg' };
        this.plan.phase(item.id, 'publishing'); this.onChange();
        result = await publisher.publishFacebookPhoto(page.facebookPageId, token, source, item.caption);
      } else {
        if (!fs.existsSync(item.file)) throw new Error('O arquivo de vídeo não existe mais.');
        prepared = await this.prepareMedia(item.file, null);
        await this.validateMedia(prepared.file, item.caption);
        uploaded = await this.storage.upload(accountId, connection, prepared.file);
        this.plan.phase(item.id, 'processing', { storagePath: uploaded.objectPath }); this.onChange();
        if (this.plan.db.prepare('SELECT status FROM schedules WHERE account_id=?').get(accountId)?.status !== 'running') throw Object.assign(new Error('Programação pausada antes da publicação.'), { interrupted: true });
        this.plan.phase(item.id, 'publishing'); this.onChange();
        result = await publisher.publishFacebookReel(page.facebookPageId, token, uploaded.signedUrl, item.caption);
      }
      this.plan.phase(item.id, 'published', { mediaId: result.videoId || result.id, facebookPermalink: result.permalink });
      this.plan.advance(accountId); this.onChange();
    } catch (error) {
      if (error.metaCode === 190) this.facebookAuth.markReconnect(accountId);
      if (error.orphanPath) this.plan.trackStoragePath(item.id, error.orphanPath);
      const current = this.plan.db.prepare('SELECT status FROM items WHERE id=?').get(item.id)?.status;
      if (current === 'publishing') {
        uncertain = true;
        this.plan.phase(item.id, 'uncertain', { error: 'Resultado Facebook incerto. Confira a Página antes de tentar novamente.' });
        this.plan.pauseAccount(accountId);
      } else {
        const attempts = this.plan.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE item_id=? AND phase='uploading'").get(item.id).n;
        const attention = !error.interrupted && (error.metaCode === 190 || error.metaCode === 200 || attempts >= 3 || /arquivo|foto|permiss|autoriz|reconecte/i.test(error.message));
        this.plan.phase(item.id, attention ? 'attention' : 'queued', { error: error.message });
        if (attention) this.plan.pauseAccount(accountId);
        else if (!error.interrupted) this.plan.delayRetry(accountId, Math.max(2 ** attempts, error.retryAfterMinutes || 0));
      }
      this.onChange();
    } finally {
      try { prepared?.cleanup(); } catch {}
      if (uploaded && !uncertain) {
        const removed = await this.storage.remove(uploaded.client, uploaded.objectPath).then(() => true, () => false);
        if (removed) this.plan.clearStoragePath(item.id, uploaded.objectPath);
      }
    }
  }
}
module.exports = { PostingWorker };
