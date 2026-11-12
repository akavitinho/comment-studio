const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function parts(date, zone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
  return { day: weekdays.indexOf(values.weekday), minute: Number(values.hour) * 60 + Number(values.minute), date: `${values.year}-${values.month}-${values.day}` };
}
function allowed(date, config) {
  const p = parts(date, config.timeZone);
  return config.days.includes(p.day) && p.minute >= config.startMinute && p.minute < config.endMinute;
}
function nextAllowed(after, config) {
  let ms = Math.ceil(after / 60000) * 60000;
  for (let i = 0; i < 8 * 24 * 60; i++, ms += 60000) if (allowed(new Date(ms), config)) return new Date(ms).toISOString();
  throw new Error('Não há horário permitido nos próximos oito dias.');
}
function validateConfig(input) {
  const min = Number(input.minMinutes), max = Number(input.maxMinutes);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 10080) throw new Error('Defina intervalo mínimo e máximo entre 1 minuto e 7 dias.');
  const startMinute = Number(input.startMinute), endMinute = Number(input.endMinute);
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute < 0 || startMinute >= endMinute || endMinute > 1440) throw new Error('A janela diária deve começar antes do fim.');
  const days = [...new Set((input.days || []).map(Number))];
  if (!days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Selecione ao menos um dia da semana.');
  const timeZone = String(input.timeZone || 'America/Sao_Paulo');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone }); } catch { throw new Error('Fuso horário inválido.'); }
  const dailyLimit = Number(input.dailyLimit || 0);
  const intervalUnit = input.intervalUnit === 'hours' ? 'hours' : 'minutes';
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 100) throw new Error('Limite diário inválido.');
  const firstAt = input.firstAt ? new Date(input.firstAt).getTime() : Date.now();
  if (!Number.isFinite(firstAt)) throw new Error('Primeiro horário inválido.');
  return { minMinutes: min, maxMinutes: max, intervalUnit, startMinute, endMinute, days, timeZone, dailyLimit, firstAt: new Date(firstAt).toISOString() };
}
function nextTime(base, config, random = Math.random) {
  const minutes = config.minMinutes + Math.floor(random() * (config.maxMinutes - config.minMinutes + 1));
  return nextAllowed(new Date(base).getTime() + minutes * 60000, config);
}
class PostingPlan {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS schedules (account_id TEXT PRIMARY KEY, config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'stopped', next_at TEXT, group_id TEXT);
      CREATE TABLE IF NOT EXISTS shared_schedules (account_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'stopped', next_at TEXT);
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, account_name TEXT, file TEXT NOT NULL, caption TEXT NOT NULL, position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', creation_id TEXT, media_id TEXT, permalink TEXT, error TEXT, created_at TEXT NOT NULL, published_at TEXT, storage_path TEXT, uploaded_at TEXT);
      CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, account_id TEXT NOT NULL, phase TEXT NOT NULL, at TEXT NOT NULL, detail TEXT);
      CREATE TABLE IF NOT EXISTS media_insights (item_id TEXT PRIMARY KEY, media_id TEXT NOT NULL, views INTEGER, reach INTEGER, fetched_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_insight_history (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL, media_id TEXT NOT NULL, views INTEGER, reach INTEGER, fetched_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS media_insight_history_item_time ON media_insight_history(item_id, fetched_at);
      CREATE TABLE IF NOT EXISTS storage_objects (path TEXT PRIMARY KEY, item_id TEXT NOT NULL, account_id TEXT NOT NULL, uploaded_at TEXT NOT NULL);`);
    this.db.exec("CREATE TABLE IF NOT EXISTS posting_media_settings (account_id TEXT PRIMARY KEY, folder TEXT, cover TEXT, video_order TEXT NOT NULL DEFAULT 'sequence', cross_post_facebook INTEGER NOT NULL DEFAULT 0, facebook_page_id TEXT, facebook_page_token TEXT)");
    const mediaCols = new Set(this.db.prepare('PRAGMA table_info(posting_media_settings)').all().map(row => row.name));
    if (!mediaCols.has('video_order')) this.db.exec("ALTER TABLE posting_media_settings ADD COLUMN video_order TEXT NOT NULL DEFAULT 'sequence'");
    if (!mediaCols.has('cross_post_facebook')) this.db.exec("ALTER TABLE posting_media_settings ADD COLUMN cross_post_facebook INTEGER NOT NULL DEFAULT 0");
    if (!mediaCols.has('facebook_page_id')) this.db.exec("ALTER TABLE posting_media_settings ADD COLUMN facebook_page_id TEXT");
    if (!mediaCols.has('facebook_page_token')) this.db.exec("ALTER TABLE posting_media_settings ADD COLUMN facebook_page_token TEXT");
    const columns = new Set(this.db.prepare('PRAGMA table_info(items)').all().map(row => row.name));
    if (!this.db.prepare('PRAGMA table_info(schedules)').all().some(row => row.name === 'group_id')) this.db.exec('ALTER TABLE schedules ADD COLUMN group_id TEXT');
    if (!columns.has('published_at')) this.db.exec('ALTER TABLE items ADD COLUMN published_at TEXT');
    if (!columns.has('storage_path')) this.db.exec('ALTER TABLE items ADD COLUMN storage_path TEXT');
    if (!columns.has('uploaded_at')) this.db.exec('ALTER TABLE items ADD COLUMN uploaded_at TEXT');
    if (!columns.has('account_name')) this.db.exec('ALTER TABLE items ADD COLUMN account_name TEXT');
    if (!columns.has('queue_kind')) this.db.exec("ALTER TABLE items ADD COLUMN queue_kind TEXT NOT NULL DEFAULT 'account'");
    if (!columns.has('scheduled_at')) this.db.exec('ALTER TABLE items ADD COLUMN scheduled_at TEXT');
    if (!columns.has('facebook_permalink')) this.db.exec('ALTER TABLE items ADD COLUMN facebook_permalink TEXT');
    if (!columns.has('facebook_error')) this.db.exec('ALTER TABLE items ADD COLUMN facebook_error TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS items_shared_agenda ON items(queue_kind,scheduled_at,account_id,status)');
    this.db.exec('INSERT OR IGNORE INTO storage_objects (path,item_id,account_id,uploaded_at) SELECT storage_path,id,account_id,uploaded_at FROM items WHERE storage_path IS NOT NULL AND uploaded_at IS NOT NULL');
    this.db.prepare("UPDATE schedules SET status='paused' WHERE status='running'").run();
    this.db.prepare("UPDATE shared_schedules SET status='paused' WHERE status='running'").run();
    this.db.prepare("UPDATE items SET status='uncertain' WHERE status='publishing'").run();
    this.db.prepare("UPDATE items SET status='queued' WHERE status IN ('uploading','processing')").run();
    for (const {account_id:id} of this.db.prepare('SELECT account_id FROM shared_schedules').all()) this.replanShared(id);
  }
  snapshot() {
    return { schedules: this.db.prepare('SELECT * FROM schedules').all().map(row => ({ ...row, config: JSON.parse(row.config) })), sharedSchedules: this.db.prepare('SELECT * FROM shared_schedules').all(), mediaSettings: this.db.prepare('SELECT * FROM posting_media_settings').all(), items: this.db.prepare('SELECT * FROM items ORDER BY account_id, position, created_at').all(), attempts: this.db.prepare('SELECT * FROM attempts ORDER BY at DESC LIMIT 100').all(), insights: this.db.prepare('SELECT * FROM media_insights').all(), insightHistory: this.db.prepare('SELECT item_id,media_id,views,reach,fetched_at FROM media_insight_history ORDER BY fetched_at').all() };
  }
  mediaSettings(accountId) {
    return this.db.prepare('SELECT folder,cover,video_order,cross_post_facebook,facebook_page_id,facebook_page_token FROM posting_media_settings WHERE account_id=?').get(accountId) || { folder: null, cover: null, video_order: 'sequence', cross_post_facebook: 0, facebook_page_id: null, facebook_page_token: null };
  }
  saveMediaSettings(accountId, changes) {
    const current = this.mediaSettings(accountId);
    const folder = changes.folder === undefined ? current.folder : changes.folder;
    const cover = changes.cover === undefined ? current.cover : changes.cover;
    const videoOrder = changes.videoOrder === undefined ? current.video_order : changes.videoOrder;
    const crossPostFacebook = changes.crossPostFacebook === undefined ? (current.cross_post_facebook || 0) : (changes.crossPostFacebook ? 1 : 0);
    const facebookPageId = changes.facebookPageId === undefined ? current.facebook_page_id : (changes.facebookPageId ? String(changes.facebookPageId).trim() : null);
    const facebookPageToken = changes.facebookPageToken === undefined ? current.facebook_page_token : (changes.facebookPageToken ? String(changes.facebookPageToken).trim() : null);
    if (changes.folder !== undefined && folder !== null && (typeof folder !== 'string' || !path.isAbsolute(folder) || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory())) throw new Error('Selecione uma pasta de vídeos existente.');
    if (changes.cover !== undefined && cover !== null && (typeof cover !== 'string' || !path.isAbsolute(cover) || !fs.existsSync(cover) || !fs.statSync(cover).isFile() || !/\.(jpe?g|png|webp)$/i.test(cover))) throw new Error('Selecione uma capa JPG, PNG ou WebP existente.');
    if (!['sequence', 'random'].includes(videoOrder)) throw new Error('Escolha Sequência ou Aleatório para a ordem dos vídeos.');
    this.db.prepare('INSERT INTO posting_media_settings (account_id,folder,cover,video_order,cross_post_facebook,facebook_page_id,facebook_page_token) VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET folder=excluded.folder,cover=excluded.cover,video_order=excluded.video_order,cross_post_facebook=excluded.cross_post_facebook,facebook_page_id=excluded.facebook_page_id,facebook_page_token=excluded.facebook_page_token').run(accountId, folder && path.resolve(folder), cover && path.resolve(cover), videoOrder, crossPostFacebook, facebookPageId, facebookPageToken);
    return this.snapshot();
  }
  importFolder(accountId, accountName = '') {
    const folder = this.mediaSettings(accountId).folder;
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Escolha uma pasta de vídeos existente para esta conta.');
    const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
    const files = fs.readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile() && /\.(mp4|mov)$/i.test(entry.name)).map(entry => path.join(folder, entry.name)).sort((a, b) => collator.compare(path.basename(a), path.basename(b)) || a.localeCompare(b));
    const existing = new Set(this.db.prepare("SELECT file FROM items WHERE account_id=? AND status<>'cancelled'").all(accountId).map(row => path.basename(row.file).toLocaleLowerCase('pt-BR')));
    const additions = files.filter(file => !existing.has(path.basename(file).toLocaleLowerCase('pt-BR')));
    let position = this.db.prepare('SELECT COALESCE(MAX(position),0) AS n FROM items WHERE account_id=?').get(accountId).n;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT INTO items (id,account_id,account_name,file,caption,position,created_at) VALUES (?,?,?,?,?,?,?)');
      for (const file of additions) insert.run(randomUUID(), accountId, String(accountName).slice(0, 120), file, '', ++position, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { importedCount: additions.length, skippedCount: files.length - additions.length, ...this.snapshot() };
  }
  saveInsights(itemId, mediaId, values) {
    const item = this.db.prepare("SELECT media_id FROM items WHERE id=? AND status='published'").get(itemId);
    if (!item || item.media_id !== mediaId) throw new Error('Reel publicado não encontrado para atualizar os Insights.');
    const at = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO media_insights (item_id,media_id,views,reach,fetched_at) VALUES (?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET media_id=excluded.media_id,views=excluded.views,reach=excluded.reach,fetched_at=excluded.fetched_at').run(itemId, mediaId, values.views, values.reach, at);
      this.db.prepare('INSERT INTO media_insight_history (item_id,media_id,views,reach,fetched_at) VALUES (?,?,?,?,?)').run(itemId, mediaId, values.views, values.reach, at);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  configure(accountId, input) {
    const config = validateConfig(input);
    this.db.prepare("INSERT INTO schedules (account_id,config,status,next_at,group_id) VALUES (?,?,'stopped',NULL,NULL) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config,group_id=NULL").run(accountId, JSON.stringify(config));
    const schedule = this.db.prepare('SELECT next_at FROM schedules WHERE account_id=?').get(accountId);
    if (schedule.next_at) {
      const next = nextAllowed(Math.max(Date.parse(schedule.next_at), Date.parse(config.firstAt)), config);
      this.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?').run(next, accountId);
    }
    if (this.db.prepare('SELECT 1 FROM shared_schedules WHERE account_id=?').get(accountId)) this.replanShared(accountId, { force: true });
    return this.snapshot();
  }
  configureBatch(accountIds, input) {
    if (!Array.isArray(accountIds) || accountIds.length < 2 || new Set(accountIds).size !== accountIds.length) throw new Error('Selecione pelo menos duas contas diferentes.');
    const config = validateConfig(input);
    const groupId = randomUUID();
    const base = Math.max(Date.now(), Date.parse(config.firstAt));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      accountIds.forEach((accountId, index) => {
        const previous = this.db.prepare('SELECT status,next_at FROM schedules WHERE account_id=?').get(accountId);
        const earliest = Math.max(base + index * 5 * 60000, previous?.next_at ? Date.parse(previous.next_at) : 0);
        const next = this.groupSlot(nextAllowed(earliest, config), config, groupId, accountId);
        this.db.prepare("INSERT INTO schedules (account_id,config,status,next_at,group_id) VALUES (?,?,?, ?,?) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config,next_at=excluded.next_at,group_id=excluded.group_id").run(accountId, JSON.stringify(config), previous?.status || 'stopped', next, groupId);
      });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    for (const id of accountIds) if (this.db.prepare('SELECT 1 FROM shared_schedules WHERE account_id=?').get(id)) this.replanShared(id, { force: true });
    return this.snapshot();
  }
  groupSlot(candidate, config, groupId, accountId) {
    if (!groupId) return candidate;
    const slots = this.db.prepare('SELECT next_at FROM schedules WHERE group_id=? AND account_id<>? AND next_at IS NOT NULL').all(groupId, accountId).map(row => Date.parse(row.next_at));
    const latest = this.db.prepare("SELECT MAX(i.published_at) AS at FROM items i JOIN schedules s ON s.account_id=i.account_id WHERE s.group_id=? AND i.account_id<>? AND i.queue_kind='account' AND i.status='published'").get(groupId, accountId)?.at;
    if (latest) slots.push(Date.parse(latest));
    let at = Date.parse(candidate);
    for (let attempt = 0; attempt < 10000; attempt++) {
      const conflict = slots.find(slot => Math.abs(at - slot) < 5 * 60000);
      if (conflict === undefined) return new Date(at).toISOString();
      at = Date.parse(nextAllowed(conflict + 5 * 60000, config));
    }
    throw new Error('Não há horários separados suficientes para as contas selecionadas.');
  }
  preview(accountId, input, count = 5) {
    const config = validateConfig(input);
    let at = nextAllowed(Math.max(Date.now(), new Date(config.firstAt).getTime()), config);
    const result = [at];
    for (let i = 1; i < Math.min(20, count); i++) { at = nextTime(at, config, () => 0.5); result.push(at); }
    return result;
  }
  add(accountId, file, caption, accountName = '') {
    if (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !/\.(mp4|mov)$/i.test(file)) throw new Error('Selecione um vídeo MP4 ou MOV existente.');
    if (typeof caption !== 'string' || caption.length > 2200) throw new Error('A legenda deve ter até 2.200 caracteres.');
    const name = path.basename(file).toLocaleLowerCase('pt-BR');
    const existing = this.db.prepare("SELECT file FROM items WHERE account_id=? AND status<>'cancelled'").all(accountId);
    if (existing.some(item => path.basename(item.file).toLocaleLowerCase('pt-BR') === name)) throw new Error(`O vídeo ${path.basename(file)} já foi adicionado a esta conta. Escolha outro arquivo.`);
    const position = this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM items WHERE account_id=?').get(accountId).n;
    this.db.prepare('INSERT INTO items (id,account_id,account_name,file,caption,position,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), accountId, String(accountName).slice(0, 120), file, caption, position, new Date().toISOString());
    return this.snapshot();
  }
  addShared(accountIds, files, caption, accountNames = {}) {
    if (!Array.isArray(accountIds) || !accountIds.length || new Set(accountIds).size !== accountIds.length) throw new Error('Selecione ao menos uma conta para a fila única.');
    if (!Array.isArray(files) || !files.length) throw new Error('Selecione vídeos para a fila única.');
    if (typeof caption !== 'string' || caption.length > 2200) throw new Error('A legenda deve ter até 2.200 caracteres.');
    const existing = new Set(this.db.prepare("SELECT file FROM items WHERE queue_kind='shared' AND status<>'cancelled'").all().map(row => path.basename(row.file).toLocaleLowerCase('pt-BR')));
    for (const file of files) {
      if (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !/\.(mp4|mov)$/i.test(file)) throw new Error('Selecione vídeos MP4 ou MOV existentes.');
      const name = path.basename(file).toLocaleLowerCase('pt-BR');
      if (existing.has(name)) throw new Error(`O vídeo ${path.basename(file)} já está na fila única.`);
      existing.add(name);
    }
    const now = Date.now();
    const accounts = accountIds.map(id => {
      const schedule = this.db.prepare('SELECT config FROM schedules WHERE account_id=?').get(id);
      if (!schedule) throw new Error('Configure os horários de todas as contas escolhidas antes de adicionar vídeos.');
      const config = JSON.parse(schedule.config);
      const shared = this.db.prepare('SELECT next_at FROM shared_schedules WHERE account_id=?').get(id);
      const base = Math.max(now + 5 * 60000, Date.parse(config.firstAt), shared?.next_at ? Date.parse(shared.next_at) : 0);
      let projected=nextAllowed(base,config);
      const pending=this.db.prepare("SELECT COUNT(*) AS n FROM items WHERE account_id=? AND queue_kind='shared' AND status='queued'").get(id).n;
      for(let i=0;i<pending;i++)projected=nextTime(projected,config,()=>0.5);
      return { id, config, projected };
    });
    let position = this.db.prepare("SELECT COALESCE(MAX(position),0) AS n FROM items WHERE queue_kind='shared'").get().n;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare("INSERT INTO items (id,account_id,account_name,file,caption,position,created_at,queue_kind) VALUES (?,?,?,?,?,?,?,'shared')");
      for (const file of files) {
        accounts.sort((a,b)=>Date.parse(a.projected)-Date.parse(b.projected)||a.id.localeCompare(b.id));
        const target=accounts[0];
        insert.run(randomUUID(),target.id,String(accountNames[target.id]||'').slice(0,120),file,caption,++position,new Date().toISOString());
        this.db.prepare("INSERT OR IGNORE INTO shared_schedules (account_id,status,next_at) VALUES (?,'stopped',NULL)").run(target.id);
        target.projected=nextTime(target.projected,target.config,()=>0.5);
      }
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    for (const id of accountIds) if (this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind='shared' AND status='queued'").get(id)) this.replanShared(id);
    return this.snapshot();
  }
  updateItem(id, changes) {
    const item = this.db.prepare('SELECT * FROM items WHERE id=?').get(id);
    if (!item || item.status !== 'queued') throw new Error('Só é possível editar vídeos ainda na fila.');
    if (changes.caption !== undefined) {
      if (typeof changes.caption !== 'string' || changes.caption.length > 2200) throw new Error('Legenda inválida.');
      this.db.prepare('UPDATE items SET caption=? WHERE id=?').run(changes.caption, id);
    }
    return this.snapshot();
  }
  move(id, direction) {
    const item = this.db.prepare('SELECT * FROM items WHERE id=?').get(id);
    if (!item || item.status !== 'queued') throw new Error('Só é possível reordenar vídeos na fila.');
    const rows = item.queue_kind==='shared'
      ? this.db.prepare("SELECT id,account_id FROM items WHERE queue_kind='shared' AND status='queued' ORDER BY position,created_at").all()
      : this.db.prepare("SELECT id,account_id FROM items WHERE account_id=? AND queue_kind='account' AND status='queued' ORDER BY position,created_at").all(item.account_id);
    const index = rows.findIndex(row => row.id === id), target = index + (direction === 'up' ? -1 : direction === 'down' ? 1 : 10000);
    if (target < 0 || target >= rows.length) return this.snapshot();
    [rows[index], rows[target]] = [rows[target], rows[index]];
    this.db.exec('BEGIN IMMEDIATE');
    try { const update = this.db.prepare('UPDATE items SET position=? WHERE id=?'); rows.forEach((row, i) => update.run(i + 1, row.id)); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    if(item.queue_kind==='shared')for(const accountId of new Set([rows[index].account_id,rows[target].account_id]))this.replanShared(accountId,{force:true});
    return this.snapshot();
  }
  remove(id) {
    const item=this.db.prepare('SELECT account_id,queue_kind FROM items WHERE id=? AND status=?').get(id,'queued');
    const result = this.db.prepare("DELETE FROM items WHERE id=? AND status='queued'").run(id);
    if (!result.changes) throw new Error('Só é possível remover vídeos ainda na fila.');
    if(item?.queue_kind==='shared')this.replanShared(item.account_id,{force:true});
    return this.snapshot();
  }
  clearQueue(accountId) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const removedCount = this.db.prepare("DELETE FROM items WHERE account_id=? AND queue_kind='account' AND status='queued'").run(accountId).changes;
      if (removedCount) this.db.prepare("UPDATE schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(accountId);
      this.db.exec('COMMIT');
      return { removedCount, ...this.snapshot() };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  retryAttention(id) {
    const item = this.db.prepare('SELECT id,account_id,status,media_id,queue_kind FROM items WHERE id=?').get(id);
    if (!item || item.status !== 'attention') throw new Error('Só é possível tentar novamente um vídeo em atenção.');
    if (item.media_id || this.db.prepare("SELECT 1 FROM attempts WHERE item_id=? AND phase='publishing' LIMIT 1").get(id)) throw new Error('Confira a publicação antes de tentar novamente este vídeo.');
    if (!this.db.prepare('SELECT 1 FROM schedules WHERE account_id=?').get(item.account_id)) throw new Error('Configure a programação desta conta antes de tentar novamente.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE items SET status='queued',error=NULL,creation_id=NULL WHERE id=? AND status='attention'").run(id);
      this.db.prepare(`UPDATE ${item.queue_kind === 'shared' ? 'shared_schedules' : 'schedules'} SET status='paused' WHERE account_id=?`).run(item.account_id);
      this.db.prepare('INSERT INTO attempts (id,item_id,account_id,phase,at,detail) VALUES (?,?,?,?,?,?)').run(randomUUID(), id, item.account_id, 'manual_retry', new Date().toISOString(), 'Repetição solicitada pelo usuário antes da publicação.');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    if(item.queue_kind==='shared')this.replanShared(item.account_id,{force:true});
    return this.snapshot();
  }
  setStatus(accountId, status, now = new Date()) {
    if (!['running', 'paused', 'stopped'].includes(status)) throw new Error('Estado inválido.');
    const schedule = this.db.prepare('SELECT * FROM schedules WHERE account_id=?').get(accountId);
    if (!schedule) throw new Error('Configure o ritmo antes de iniciar.');
    if (status === 'running' && !this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind='account' AND status='queued' LIMIT 1").get(accountId)) throw new Error('Adicione ao menos um vídeo à fila antes de iniciar.');
    const config = JSON.parse(schedule.config);
    const saved = schedule.next_at ? Date.parse(schedule.next_at) : NaN;
    const preservePausedTime = status === 'running' && schedule.status === 'paused' && Number.isFinite(saved) && saved > now.getTime() && allowed(new Date(saved), config);
    const next = status === 'running'
      ? preservePausedTime ? schedule.next_at : this.groupSlot(nextAllowed(Math.max(now.getTime() + 5 * 60000, Date.parse(config.firstAt)), config), config, schedule.group_id, accountId)
      : schedule.next_at;
    this.db.prepare('UPDATE schedules SET status=?,next_at=? WHERE account_id=?').run(status, status === 'stopped' ? null : next, accountId);
    return this.snapshot();
  }
  staggerStarts(accountIds, gapMinutes = 5) {
    const selected = new Set(accountIds);
    if (!selected.size) return this.snapshot();
    const schedules = this.db.prepare("SELECT account_id,config,next_at FROM schedules WHERE status='running' AND next_at IS NOT NULL").all();
    const reserved = schedules.filter(row => !selected.has(row.account_id)).map(row => Date.parse(row.next_at));
    reserved.push(...this.db.prepare("SELECT next_at FROM shared_schedules WHERE status='running' AND next_at IS NOT NULL").all().map(row => Date.parse(row.next_at)));
    const pending = schedules.filter(row => selected.has(row.account_id)).sort((a, b) => Date.parse(a.next_at) - Date.parse(b.next_at) || a.account_id.localeCompare(b.account_id));
    const gap = gapMinutes * 60000;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const update = this.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?');
      for (const row of pending) {
        const config = JSON.parse(row.config);
        let at = Date.parse(row.next_at);
        for (let attempt = 0; attempt < 10000; attempt++) {
          const conflict = reserved.find(slot => Number.isFinite(slot) && Math.abs(at - slot) < gap);
          if (conflict === undefined) break;
          at = Date.parse(nextAllowed(conflict + gap, config));
        }
        if (reserved.some(slot => Number.isFinite(slot) && Math.abs(at - slot) < gap)) throw new Error('Não há horários separados suficientes para iniciar as filas.');
        if (at !== Date.parse(row.next_at)) update.run(new Date(at).toISOString(), row.account_id);
        reserved.push(at);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.snapshot();
  }
  replanShared(accountId, { force = false, from = null } = {}) {
    const own=this.db.prepare('SELECT config FROM schedules WHERE account_id=?').get(accountId);
    if (!own) return;
    const config=JSON.parse(own.config),shared=this.db.prepare('SELECT * FROM shared_schedules WHERE account_id=?').get(accountId);
    if (!shared) return;
    const queued=this.db.prepare("SELECT id,scheduled_at FROM items WHERE account_id=? AND queue_kind='shared' AND status='queued' ORDER BY position,created_at").all(accountId);
    if (!queued.length) { if(shared.status==='running')this.db.prepare("UPDATE shared_schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(accountId);return; }
    const active=this.db.prepare("SELECT scheduled_at FROM items WHERE account_id=? AND queue_kind='shared' AND status IN ('uploading','processing','publishing') ORDER BY position LIMIT 1").get(accountId);
    let candidate=nextAllowed(Math.max(Date.parse(from||shared.next_at||new Date(Date.now()+5*60000).toISOString()),Date.parse(config.firstAt)),config);
    if(active) candidate=nextTime(Math.max(Date.now(),Date.parse(active.scheduled_at||candidate)),config);
    if(!allowed(new Date(candidate),config))candidate=nextAllowed(Date.parse(candidate),config);
    const published=this.db.prepare("SELECT published_at FROM items WHERE account_id=? AND status='published' AND published_at IS NOT NULL").all(accountId);
    const daily=new Map();for(const row of published){const day=parts(new Date(row.published_at),config.timeZone).date;daily.set(day,(daily.get(day)||0)+1);}
    const update=this.db.prepare('UPDATE items SET scheduled_at=? WHERE id=?');
    let previous=null;
    for(let i=0;i<queued.length;i++){
      const row=queued[i];
      const earliest=previous?Date.parse(previous)+config.minMinutes*60000:Date.parse(candidate);
      if(!force && !from && row.scheduled_at && Date.parse(row.scheduled_at)>=earliest && allowed(new Date(row.scheduled_at),config))candidate=row.scheduled_at;
      let day=parts(new Date(candidate),config.timeZone).date;
      while(config.dailyLimit && (daily.get(day)||0)>=config.dailyLimit){
        let at=Date.parse(candidate);while(parts(new Date(at),config.timeZone).date===day)at+=3600000;
        candidate=nextAllowed(at-59*60000,config);day=parts(new Date(candidate),config.timeZone).date;
      }
      update.run(candidate,row.id);daily.set(day,(daily.get(day)||0)+1);
      if(i===0)this.db.prepare('UPDATE shared_schedules SET next_at=? WHERE account_id=?').run(candidate,accountId);
      previous=candidate;
      candidate=nextTime(candidate,config);
    }
  }
  setSharedStatus(status, accountIds, now = new Date()) {
    if (!['running','paused','stopped'].includes(status)) throw new Error('Estado inválido.');
    const ids = accountIds || this.db.prepare('SELECT account_id FROM shared_schedules').all().map(row=>row.account_id);
    for (const id of ids) {
      const own=this.db.prepare('SELECT config FROM schedules WHERE account_id=?').get(id);
      if (!own) throw new Error('Configure os horários da conta antes de iniciar a fila única.');
      const shared=this.db.prepare('SELECT * FROM shared_schedules WHERE account_id=?').get(id);
      if (!shared) continue;
      if (status==='running' && !this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind='shared' AND status='queued' LIMIT 1").get(id)) continue;
      const config=JSON.parse(own.config);
      const saved=shared.next_at ? Date.parse(shared.next_at) : NaN;
      const next=status==='running' ? Number.isFinite(saved)&&saved>now.getTime()&&allowed(new Date(saved),config) ? shared.next_at : nextAllowed(Math.max(now.getTime()+5*60000,Date.parse(config.firstAt)),config) : status==='stopped' ? null : shared.next_at;
      this.db.prepare('UPDATE shared_schedules SET status=?,next_at=? WHERE account_id=?').run(status,next,id);
      if(status==='running'){const force=!Number.isFinite(saved)||saved<=now.getTime()||!allowed(new Date(saved),config);this.replanShared(id,{force,from:force?next:null});}
    }
    return this.snapshot();
  }
  activateSharedOnly(accountIds, now = new Date()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.setSharedStatus('running', accountIds, now);
      const paused = this.db.prepare("UPDATE schedules SET status='paused' WHERE status='running'").run().changes;
      this.db.exec('COMMIT');
      return paused;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  cancelAccount(accountId, accountName = '') {
    this.db.prepare('DELETE FROM posting_media_settings WHERE account_id=?').run(accountId);
    this.db.prepare('UPDATE items SET account_name=? WHERE account_id=?').run(String(accountName).slice(0, 120), accountId);
    this.db.prepare("UPDATE items SET status='cancelled' WHERE account_id=? AND status='queued'").run(accountId);
    this.db.prepare("UPDATE schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(accountId);
    this.db.prepare("UPDATE shared_schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(accountId);
  }
  resolveUncertain(itemId, outcome) {
    if (!['published', 'cancelled'].includes(outcome)) throw new Error('Resultado de conferência inválido.');
    const item = this.db.prepare("SELECT * FROM items WHERE id=? AND status='uncertain'").get(itemId);
    if (!item) throw new Error('Este vídeo não está aguardando conferência.');
    this.phase(itemId, outcome, { error: outcome === 'published' ? 'Publicação conferida manualmente; link indisponível.' : 'Publicação não confirmada; adicione o vídeo novamente somente se desejar.' });
    if (outcome === 'published') this.advance(item.account_id,item.queue_kind);
    return this.snapshot();
  }
  pauseAccount(accountId, kind = 'account') { this.db.prepare(`UPDATE ${kind === 'shared' ? 'shared_schedules' : 'schedules'} SET status='paused' WHERE account_id=?`).run(accountId); }
  delayRetry(accountId, minutes, now = new Date(), kind = 'account') {
    const schedule = this.db.prepare('SELECT config FROM schedules WHERE account_id=?').get(accountId);
    if (!schedule) return;
    const next = nextAllowed(now.getTime() + minutes * 60000, JSON.parse(schedule.config));
    this.db.prepare(`UPDATE ${kind === 'shared' ? 'shared_schedules' : 'schedules'} SET next_at=? WHERE account_id=?`).run(next, accountId);
    if(kind==='shared')this.replanShared(accountId,{force:true,from:next});
  }
  clearStoragePath(itemId, objectPath) {
    if (objectPath) {
      this.db.prepare('DELETE FROM storage_objects WHERE path=? AND item_id=?').run(objectPath, itemId);
      this.db.prepare('UPDATE items SET storage_path=NULL,uploaded_at=NULL WHERE id=? AND storage_path=?').run(itemId, objectPath);
    } else {
      this.db.prepare('DELETE FROM storage_objects WHERE item_id=?').run(itemId);
      this.db.prepare('UPDATE items SET storage_path=NULL,uploaded_at=NULL WHERE id=?').run(itemId);
    }
  }
  trackStoragePath(itemId, objectPath) {
    const item = this.db.prepare('SELECT account_id FROM items WHERE id=?').get(itemId);
    if (!item) return;
    this.db.prepare('INSERT OR IGNORE INTO storage_objects (path,item_id,account_id,uploaded_at) VALUES (?,?,?,?)').run(objectPath, itemId, item.account_id, new Date().toISOString());
  }
  accountGap(accountId, table, now, config) {
    const last=this.db.prepare("SELECT MAX(published_at) AS at FROM items WHERE account_id=? AND status='published'").get(accountId)?.at;
    if (!last || now.getTime()-Date.parse(last)>=config.minMinutes*60000) return false;
    const next=nextAllowed(Date.parse(last)+config.minMinutes*60000,config);
    this.db.prepare(`UPDATE ${table} SET next_at=? WHERE account_id=?`).run(next,accountId);
    if(table==='shared_schedules')this.replanShared(accountId,{force:true,from:next});
    return true;
  }
  due(now = new Date()) {
    const candidates = this.db.prepare("SELECT * FROM schedules WHERE status='running' AND next_at<=? ORDER BY next_at").all(now.toISOString());
    return candidates.filter(schedule => {
      if (!this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind='account' AND status='queued' LIMIT 1").get(schedule.account_id)) { this.db.prepare("UPDATE schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(schedule.account_id); return false; }
      const config = JSON.parse(schedule.config);
      if (!allowed(now, config)) {
        this.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?').run(nextAllowed(now.getTime(), config), schedule.account_id);
        return false;
      }
      if (this.accountGap(schedule.account_id,'schedules',now,config)) return false;
      if (schedule.group_id) {
        const last = this.db.prepare("SELECT MAX(i.published_at) AS at FROM items i JOIN schedules s ON s.account_id=i.account_id WHERE s.group_id=? AND i.account_id<>? AND i.queue_kind='account' AND i.status='published'").get(schedule.group_id, schedule.account_id)?.at;
        if (last && now.getTime() - Date.parse(last) < 5 * 60000) {
          this.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?').run(this.groupSlot(nextAllowed(Date.parse(last) + 5 * 60000, config), config, schedule.group_id, schedule.account_id), schedule.account_id);
          return false;
        }
      }
      if (!config.dailyLimit) return true;
      const today = parts(now, config.timeZone).date;
      const published = this.db.prepare("SELECT published_at FROM items WHERE account_id=? AND status='published' AND published_at IS NOT NULL").all(schedule.account_id).filter(item => parts(new Date(item.published_at), config.timeZone).date === today).length;
      if (published < config.dailyLimit) return true;
      let later = now.getTime() + 60000;
      while (parts(new Date(later), config.timeZone).date === today) later += 60000;
      this.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?').run(nextAllowed(later, config), schedule.account_id);
      return false;
    });
  }
  dueShared(now = new Date()) {
    const candidates=this.db.prepare("SELECT s.account_id,s.next_at,c.config FROM shared_schedules s JOIN schedules c ON c.account_id=s.account_id WHERE s.status='running' AND s.next_at<=? ORDER BY s.next_at").all(now.toISOString());
    return candidates.filter(schedule=>{
      const id=schedule.account_id,config=JSON.parse(schedule.config);
      if(!this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind='shared' AND status='queued' LIMIT 1").get(id)){this.db.prepare("UPDATE shared_schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(id);return false;}
      if(!allowed(now,config)){this.replanShared(id,{force:true,from:nextAllowed(now.getTime(),config)});return false;}
      if(this.accountGap(id,'shared_schedules',now,config))return false;
      if(config.dailyLimit){const today=parts(now,config.timeZone).date;const published=this.db.prepare("SELECT published_at FROM items WHERE account_id=? AND status='published' AND published_at IS NOT NULL").all(id).filter(item=>parts(new Date(item.published_at),config.timeZone).date===today).length;
        if(published>=config.dailyLimit){let later=now.getTime()+60000;while(parts(new Date(later),config.timeZone).date===today)later+=60000;this.replanShared(id,{force:true,from:nextAllowed(later,config)});return false;}}
      return true;
    });
  }
  claim(accountId, kind = 'account', random = Math.random) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const randomOrder = kind === 'account' && this.mediaSettings(accountId).video_order === 'random';
      const queued = randomOrder ? this.db.prepare("SELECT * FROM items WHERE account_id=? AND queue_kind='account' AND status='queued' ORDER BY position,created_at").all(accountId) : null;
      const item = randomOrder ? queued[Math.floor(random() * queued.length)] : this.db.prepare("SELECT * FROM items WHERE account_id=? AND queue_kind=? AND status='queued' ORDER BY position,created_at LIMIT 1").get(accountId,kind);
      if (!item) { this.db.prepare(`UPDATE ${kind === 'shared' ? 'shared_schedules' : 'schedules'} SET status='stopped',next_at=NULL WHERE account_id=?`).run(accountId); this.db.exec('COMMIT'); return null; }
      this.db.prepare("UPDATE items SET status='uploading',error=NULL WHERE id=?").run(item.id);
      this.db.prepare('INSERT INTO attempts (id,item_id,account_id,phase,at) VALUES (?,?,?,?,?)').run(randomUUID(), item.id, accountId, 'uploading', new Date().toISOString());
      this.db.exec('COMMIT'); return item;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  phase(itemId, phase, fields = {}) {
    if (!['processing', 'publishing', 'published', 'queued', 'uncertain', 'attention', 'cancelled'].includes(phase)) throw new Error('Fase inválida.');
    const item = this.db.prepare('SELECT * FROM items WHERE id=?').get(itemId);
    if (!item) throw new Error('Vídeo não encontrado.');
    this.db.prepare('UPDATE items SET status=?,creation_id=COALESCE(?,creation_id),media_id=COALESCE(?,media_id),permalink=COALESCE(?,permalink),storage_path=COALESCE(?,storage_path),uploaded_at=COALESCE(?,uploaded_at),error=?,published_at=?,facebook_permalink=COALESCE(?,facebook_permalink),facebook_error=? WHERE id=?').run(phase, fields.creationId || null, fields.mediaId || null, fields.permalink || null, fields.storagePath || null, fields.storagePath ? new Date().toISOString() : null, fields.error || null, phase === 'published' ? new Date().toISOString() : item.published_at, fields.facebookPermalink || null, fields.facebookError !== undefined ? fields.facebookError : item.facebook_error, itemId);
    if (fields.storagePath) this.db.prepare('INSERT OR IGNORE INTO storage_objects (path,item_id,account_id,uploaded_at) VALUES (?,?,?,?)').run(fields.storagePath, itemId, item.account_id, new Date().toISOString());
    this.db.prepare('INSERT INTO attempts (id,item_id,account_id,phase,at,detail) VALUES (?,?,?,?,?,?)').run(randomUUID(), itemId, item.account_id, phase, new Date().toISOString(), fields.error || null);
    return this.snapshot();
  }
  advance(accountId, kind = 'account', now = new Date()) {
    const schedule = this.db.prepare('SELECT * FROM schedules WHERE account_id=?').get(accountId);
    if (!schedule) return;
    const table=kind === 'shared' ? 'shared_schedules' : 'schedules';
    const remaining = this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind=? AND status='queued' LIMIT 1").get(accountId,kind);
    if (!remaining) { this.db.prepare(`UPDATE ${table} SET status='stopped',next_at=NULL WHERE account_id=?`).run(accountId); return; }
    const config = JSON.parse(schedule.config);
    if (kind === 'shared') {
      const first=this.db.prepare("SELECT scheduled_at FROM items WHERE account_id=? AND queue_kind='shared' AND status='queued' ORDER BY position,created_at LIMIT 1").get(accountId);
      if (!first.scheduled_at || Date.parse(first.scheduled_at)<now.getTime()+config.minMinutes*60000) this.replanShared(accountId,{force:true,from:nextAllowed(now.getTime()+config.minMinutes*60000,config)});
      else this.db.prepare('UPDATE shared_schedules SET next_at=? WHERE account_id=?').run(first.scheduled_at,accountId);
      return;
    }
    const next = this.groupSlot(nextTime(now, config), config, schedule.group_id, accountId);
    this.db.prepare(`UPDATE ${table} SET next_at=? WHERE account_id=?`).run(next, accountId);
  }
  close() { this.db.close(); }
}
module.exports = { PostingPlan, validateConfig, nextAllowed, nextTime, parts };
