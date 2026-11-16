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
  if (input?.mode === 'fixed') return fixedConfig(input);
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
const isFixed = config => config.mode === 'fixed';
const localDate = (date, zone) => parts(date, zone).date;
function localInstant(day, minute, zone) {
  const target = Date.parse(`${day}T00:00:00.000Z`) + minute * 60000;
  let at = target;
  for (let i = 0; i < 4; i++) {
    const actual = parts(new Date(at), zone);
    const delta = (Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${actual.date}T00:00:00.000Z`)) / 60000 + minute - actual.minute;
    if (!delta) return new Date(at).toISOString();
    at += delta * 60000;
  }
  const actual = parts(new Date(at), zone);
  return actual.date === day && actual.minute === minute ? new Date(at).toISOString() : null;
}
function fixedConfig(input) {
  const times = input.times;
  const variationMinutes = Number(input.variationMinutes);
  if (!Array.isArray(times) || !times.length || times.some(time => typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Adicione ao menos um horário válido (HH:mm).');
  if (!Number.isInteger(variationMinutes) || variationMinutes < 0 || variationMinutes > 1439) throw new Error('A variação deve ser um número inteiro de minutos entre 0 e 1439.');
  const sorted = [...times].sort();
  if (new Set(sorted).size !== sorted.length) throw new Error('Não repita o mesmo horário.');
  const minutes = sorted.map(time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
  if (minutes.some((minute, index) => index && minute - minutes[index - 1] <= variationMinutes * 2)) throw new Error('As janelas de variação dos horários não podem se sobrepor.');
  const timeZone = String(input.timeZone || 'America/Sao_Paulo');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone }); } catch { throw new Error('Fuso horário inválido.'); }
  return { mode: 'fixed', times: sorted, variationMinutes, timeZone };
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
    this.db.exec('CREATE TABLE IF NOT EXISTS facebook_page_insights (account_id TEXT PRIMARY KEY, media_views INTEGER, unique_viewers INTEGER, fetched_at TEXT NOT NULL)');
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
    if (!columns.has('content_type')) this.db.exec("ALTER TABLE items ADD COLUMN content_type TEXT NOT NULL DEFAULT 'reel'");
    if (!columns.has('source_item_id')) this.db.exec('ALTER TABLE items ADD COLUMN source_item_id TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS items_shared_agenda ON items(queue_kind,scheduled_at,account_id,status)');
    this.db.exec(`CREATE TABLE IF NOT EXISTS fixed_posting_slots (account_id TEXT NOT NULL, local_date TEXT NOT NULL, minute INTEGER NOT NULL, planned_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', PRIMARY KEY(account_id,local_date,minute));
      CREATE TABLE IF NOT EXISTS removed_shared_files (account_id TEXT NOT NULL, filename TEXT NOT NULL, PRIMARY KEY(account_id,filename));`);
    const scheduleColumns = new Set(this.db.prepare('PRAGMA table_info(schedules)').all().map(row => row.name));
    if (!scheduleColumns.has('slot_date')) this.db.exec('ALTER TABLE schedules ADD COLUMN slot_date TEXT');
    if (!scheduleColumns.has('slot_minute')) this.db.exec('ALTER TABLE schedules ADD COLUMN slot_minute INTEGER');
    this.db.prepare("UPDATE items SET status='uncertain' WHERE queue_kind='shared' AND status='publishing'").run();
    this.db.prepare("UPDATE items SET status='queued' WHERE queue_kind='shared' AND status IN ('uploading','processing')").run();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const obsolete = this.db.prepare("SELECT id,account_id,file FROM items WHERE queue_kind='shared' AND status='queued'").all();
      const removed = this.db.prepare('INSERT OR IGNORE INTO removed_shared_files (account_id,filename) VALUES (?,?)');
      const deleteItem = this.db.prepare('DELETE FROM items WHERE id=?');
      for (const item of obsolete) { removed.run(item.account_id, path.basename(item.file).toLocaleLowerCase('pt-BR')); deleteItem.run(item.id); }
      this.db.prepare("UPDATE shared_schedules SET status='stopped',next_at=NULL").run();
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.db.exec('INSERT OR IGNORE INTO storage_objects (path,item_id,account_id,uploaded_at) SELECT storage_path,id,account_id,uploaded_at FROM items WHERE storage_path IS NOT NULL AND uploaded_at IS NOT NULL');
    this.db.prepare("UPDATE schedules SET status='paused' WHERE status='running'").run();
    this.db.prepare("UPDATE shared_schedules SET status='paused' WHERE status='running'").run();
    this.db.prepare("UPDATE items SET status='uncertain' WHERE status='publishing'").run();
    this.db.prepare("UPDATE items SET status='queued' WHERE status IN ('uploading','processing')").run();
    for (const row of this.db.prepare("SELECT account_id,config FROM schedules WHERE json_extract(config,'$.mode')='fixed'").all()) this.scheduleFixed(row.account_id, new Date(), { preserve: true });
  }
  snapshot() {
    return { schedules: this.db.prepare('SELECT * FROM schedules').all().map(row => ({ ...row, config: JSON.parse(row.config) })), mediaSettings: this.db.prepare('SELECT account_id,folder,cover,video_order,cross_post_facebook,facebook_page_id FROM posting_media_settings').all(), items: this.db.prepare('SELECT * FROM items ORDER BY account_id, position, created_at').all(), attempts: this.db.prepare('SELECT * FROM attempts ORDER BY at DESC LIMIT 100').all(), insights: this.db.prepare('SELECT * FROM media_insights').all(), insightHistory: this.db.prepare('SELECT item_id,media_id,views,reach,fetched_at FROM media_insight_history ORDER BY fetched_at').all() };
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
  importFolder(accountId, accountName = '', options = {}) {
    const folder = this.mediaSettings(accountId).folder;
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Escolha uma pasta de vídeos existente para esta conta.');
    const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
    const files = fs.readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(mp4|mov)$/i.test(entry.name))
      .map(entry => path.join(folder, entry.name))
      .filter(file => !options.onlyFile || path.resolve(file).toLowerCase() === path.resolve(options.onlyFile).toLowerCase())
      .filter(file => {
        if (!options.minAgeMs) return true;
        try { return Date.now() - fs.statSync(file).mtimeMs >= options.minAgeMs; }
        catch { return false; }
      })
      .filter(file => !this.db.prepare('SELECT 1 FROM removed_shared_files WHERE account_id=? AND filename=?').get(accountId, path.basename(file).toLocaleLowerCase('pt-BR')))
      .sort((a, b) => collator.compare(path.basename(a), path.basename(b)) || a.localeCompare(b));
    const existing = new Set(this.db.prepare("SELECT file FROM items WHERE account_id=? AND status<>'cancelled'").all(accountId).map(row => path.basename(row.file).toLocaleLowerCase('pt-BR')));
    const additions = files.filter(file => !existing.has(path.basename(file).toLocaleLowerCase('pt-BR')));
    const result = () => ({ importedCount: additions.length, skippedCount: files.length - additions.length, ...(options.includeSnapshot === false ? {} : this.snapshot()) });
    if (!additions.length) return result();
    let position = this.db.prepare('SELECT COALESCE(MAX(position),0) AS n FROM items WHERE account_id=?').get(accountId).n;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT INTO items (id,account_id,account_name,file,caption,position,created_at) VALUES (?,?,?,?,?,?,?)');
      for (const file of additions) insert.run(randomUUID(), accountId, String(accountName).slice(0, 120), file, '', ++position, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return result();
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
  ensureFixedSlots(accountId, day, config, random = Math.random) {
    const insert = this.db.prepare("INSERT OR IGNORE INTO fixed_posting_slots (account_id,local_date,minute,planned_at,status) VALUES (?,?,?,?,'pending')");
    for (const time of config.times) {
      const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      if (this.db.prepare('SELECT 1 FROM fixed_posting_slots WHERE account_id=? AND local_date=? AND minute=?').get(accountId, day, minute)) continue;
      const lower = Math.max(0, minute - config.variationMinutes);
      const upper = Math.min(1439, minute + config.variationMinutes);
      const chosen = lower + Math.floor(random() * (upper - lower + 1));
      let planned = localInstant(day, chosen, config.timeZone);
      if (!planned) continue;
      const groupId = this.db.prepare('SELECT group_id FROM schedules WHERE account_id=?').get(accountId)?.group_id;
      if (groupId) {
        for (let i = 0; i < 1000; i++) {
          const other = this.db.prepare('SELECT f.planned_at FROM fixed_posting_slots f JOIN schedules s ON s.account_id=f.account_id WHERE s.group_id=? AND f.account_id<>? AND f.local_date=?').all(groupId, accountId, day);
          if (!other.some(row => Math.abs(Date.parse(row.planned_at) - Date.parse(planned)) < 5 * 60000)) break;
          planned = new Date(Date.parse(planned) + 5 * 60000).toISOString();
          if (localDate(new Date(planned), config.timeZone) !== day) throw new Error('Não há espaço para separar os horários das contas neste dia.');
        }
      }
      insert.run(accountId, day, minute, planned);
    }
  }
  scheduleFixed(accountId, now = new Date(), { preserve = false } = {}) {
    const row = this.db.prepare('SELECT * FROM schedules WHERE account_id=?').get(accountId);
    if (!row) return null;
    const config = JSON.parse(row.config);
    if (!isFixed(config)) return row.next_at;
    const today = localDate(now, config.timeZone);
    this.ensureFixedSlots(accountId, today, config);
    const todaySlots = this.db.prepare("SELECT * FROM fixed_posting_slots WHERE account_id=? AND local_date=? AND status='pending' ORDER BY planned_at").all(accountId, today);
    const publishedToday = this.db.prepare("SELECT published_at FROM items WHERE account_id=? AND status='published' AND published_at IS NOT NULL").all(accountId).filter(item => localDate(new Date(item.published_at), config.timeZone) === today).length;
    const future = todaySlots.find(slot => Date.parse(slot.planned_at) > now.getTime() + 5 * 60000);
    const due = todaySlots.find(slot => Date.parse(slot.planned_at) <= now.getTime() + 5 * 60000 && Date.parse(slot.planned_at) >= now.getTime() - 5 * 60000);
    let selected = null, at = null;
    if (publishedToday < config.times.length && preserve && row.next_at && row.slot_date === today && Date.parse(row.next_at) > now.getTime()) {
      selected = this.db.prepare("SELECT * FROM fixed_posting_slots WHERE account_id=? AND local_date=? AND minute=? AND status IN ('pending','missed')").get(accountId, today, row.slot_minute);
      at = row.next_at;
    } else if (publishedToday < config.times.length && due) {
      selected = due;
      at = due.planned_at;
    } else if (publishedToday < config.times.length && future) {
      this.db.prepare("UPDATE fixed_posting_slots SET status='missed' WHERE account_id=? AND local_date=? AND status='pending' AND planned_at<?").run(accountId, today, now.toISOString());
      selected = future;
      at = future.planned_at;
    } else {
      this.db.prepare("UPDATE fixed_posting_slots SET status='missed' WHERE account_id=? AND local_date=? AND status='pending' AND planned_at<?").run(accountId, today, now.toISOString());
      const missed = this.db.prepare("SELECT * FROM fixed_posting_slots WHERE account_id=? AND local_date=? AND status='missed' ORDER BY planned_at LIMIT 1").get(accountId, today);
      if (publishedToday < config.times.length && missed && !future && !due) {
        const last = this.db.prepare("SELECT MAX(published_at) AS at FROM items WHERE account_id=? AND status='published'").get(accountId)?.at;
        const earliest = Math.max(now.getTime() + 5 * 60000, last ? Date.parse(last) + 3 * 3600000 : 0);
        if (localDate(new Date(earliest), config.timeZone) === today) { selected = missed; at = new Date(earliest).toISOString(); }
      }
    }
    if (!selected) {
      let day = today;
      for (let i = 0; i < 8 && !selected; i++) {
        day = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
        this.ensureFixedSlots(accountId, day, config);
        selected = this.db.prepare("SELECT * FROM fixed_posting_slots WHERE account_id=? AND local_date=? AND status='pending' ORDER BY planned_at LIMIT 1").get(accountId, day);
      }
      at = selected?.planned_at || null;
    }
    this.db.prepare('UPDATE schedules SET next_at=?,slot_date=?,slot_minute=? WHERE account_id=?').run(at, selected?.local_date || null, selected?.minute ?? null, accountId);
    return at;
  }
  configure(accountId, input) {
    const config = validateConfig(input);
    if (isFixed(config)) {
      this.db.prepare("INSERT INTO schedules (account_id,config,status,next_at,group_id,slot_date,slot_minute) VALUES (?,?,'stopped',NULL,NULL,NULL,NULL) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config,group_id=NULL,next_at=NULL,slot_date=NULL,slot_minute=NULL").run(accountId, JSON.stringify(config));
      this.db.prepare("DELETE FROM fixed_posting_slots WHERE account_id=? AND status<>'used'").run(accountId);
      this.scheduleFixed(accountId);
      return this.snapshot();
    }
    this.db.prepare("INSERT INTO schedules (account_id,config,status,next_at,group_id) VALUES (?,?,'stopped',NULL,NULL) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config,group_id=NULL").run(accountId, JSON.stringify(config));
    const schedule = this.db.prepare('SELECT next_at FROM schedules WHERE account_id=?').get(accountId);
    if (schedule.next_at) {
      const next = nextAllowed(Math.max(Date.parse(schedule.next_at), Date.parse(config.firstAt)), config);
      this.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?').run(next, accountId);
    }
    return this.snapshot();
  }
  configureBatch(accountIds, input) {
    if (!Array.isArray(accountIds) || accountIds.length < 2 || new Set(accountIds).size !== accountIds.length) throw new Error('Selecione pelo menos duas contas diferentes.');
    const config = validateConfig(input);
    if (isFixed(config)) {
      const groupId = randomUUID();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const id of accountIds) {
          const prior = this.db.prepare('SELECT status FROM schedules WHERE account_id=?').get(id);
          this.db.prepare('INSERT INTO schedules (account_id,config,status,next_at,group_id,slot_date,slot_minute) VALUES (?,?,?,NULL,?,NULL,NULL) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config,group_id=excluded.group_id,next_at=NULL,slot_date=NULL,slot_minute=NULL').run(id, JSON.stringify(config), prior?.status || 'stopped', groupId);
          this.db.prepare("DELETE FROM fixed_posting_slots WHERE account_id=? AND status<>'used'").run(id);
          this.scheduleFixed(id);
        }
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      return this.snapshot();
    }
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
    if (isFixed(config)) {
      const own = this.db.prepare('SELECT config FROM schedules WHERE account_id=?').get(accountId);
      if (own && JSON.stringify(JSON.parse(own.config)) === JSON.stringify(config)) {
        let day = localDate(new Date(), config.timeZone);
        for (let i = 0; i < 8; i++) {
          this.ensureFixedSlots(accountId, day, config);
          day = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
        }
        return this.db.prepare("SELECT planned_at FROM fixed_posting_slots WHERE account_id=? AND status='pending' AND planned_at>? ORDER BY planned_at LIMIT ?").all(accountId, new Date().toISOString(), Math.min(20, count)).map(row => row.planned_at);
      }
      const result = [];
      let day = localDate(new Date(), config.timeZone);
      for (let i = 0; i < 8 && result.length < count; i++) {
        for (const time of config.times) {
          const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
          const at = localInstant(day, minute, config.timeZone);
          if (at && Date.parse(at) > Date.now()) result.push(at);
          if (result.length >= count) break;
        }
        day = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);
      }
      return result;
    }
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
  addFacebook(accountId, { type, file = '', caption = '', sourceItemId = null }, accountName = '') {
    if (!['reel', 'photo', 'text'].includes(type)) throw new Error('Tipo de postagem Facebook inválido.');
    if (typeof caption !== 'string' || (type === 'text' && !caption.trim()) || caption.length > 5000) throw new Error('Escreva um texto ou legenda de até 5.000 caracteres.');
    if (type !== 'text' && (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !(type === 'reel' ? /\.(mp4|mov)$/i : /\.(jpe?g|png)$/i).test(file))) throw new Error(type === 'reel' ? 'Selecione um vídeo MP4 ou MOV.' : 'Selecione uma imagem JPG ou PNG.');
    if (sourceItemId && this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND source_item_id=? AND status<>'cancelled'").get(accountId, sourceItemId)) return this.snapshot();
    const position = this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM items WHERE account_id=?').get(accountId).n;
    this.db.prepare('INSERT INTO items (id,account_id,account_name,file,caption,position,created_at,content_type,source_item_id) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), accountId, String(accountName).slice(0,120), file, caption, position, new Date().toISOString(), type, sourceItemId);
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
    const rows = this.db.prepare("SELECT id,account_id FROM items WHERE account_id=? AND queue_kind='account' AND status='queued' ORDER BY position,created_at").all(item.account_id);
    const index = rows.findIndex(row => row.id === id), target = index + (direction === 'up' ? -1 : direction === 'down' ? 1 : 10000);
    if (target < 0 || target >= rows.length) return this.snapshot();
    [rows[index], rows[target]] = [rows[target], rows[index]];
    this.db.exec('BEGIN IMMEDIATE');
    try { const update = this.db.prepare('UPDATE items SET position=? WHERE id=?'); rows.forEach((row, i) => update.run(i + 1, row.id)); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.snapshot();
  }
  remove(id) {
    const result = this.db.prepare("DELETE FROM items WHERE id=? AND status='queued'").run(id);
    if (!result.changes) throw new Error('Só é possível remover vídeos ainda na fila.');
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
      this.db.prepare("UPDATE items SET status='queued',queue_kind='account',scheduled_at=NULL,error=NULL,creation_id=NULL WHERE id=? AND status='attention'").run(id);
      this.db.prepare("UPDATE schedules SET status='paused' WHERE account_id=?").run(item.account_id);
      this.db.prepare('INSERT INTO attempts (id,item_id,account_id,phase,at,detail) VALUES (?,?,?,?,?,?)').run(randomUUID(), id, item.account_id, 'manual_retry', new Date().toISOString(), 'Repetição solicitada pelo usuário antes da publicação.');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.snapshot();
  }
  setStatus(accountId, status, now = new Date()) {
    if (!['running', 'paused', 'stopped'].includes(status)) throw new Error('Estado inválido.');
    const schedule = this.db.prepare('SELECT * FROM schedules WHERE account_id=?').get(accountId);
    if (!schedule) throw new Error('Configure o ritmo antes de iniciar.');
    if (status === 'running' && !this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind='account' AND status='queued' LIMIT 1").get(accountId)) throw new Error('Adicione ao menos um vídeo à fila antes de iniciar.');
    const config = JSON.parse(schedule.config);
    if (isFixed(config)) {
      const next = status === 'running' ? this.scheduleFixed(accountId, now, { preserve: schedule.status === 'paused' }) : status === 'stopped' ? null : schedule.next_at;
      this.db.prepare('UPDATE schedules SET status=?,next_at=? WHERE account_id=?').run(status, next, accountId);
      return this.snapshot();
    }
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
          at = isFixed(config) ? conflict + gap : Date.parse(nextAllowed(conflict + gap, config));
        }
        if (reserved.some(slot => Number.isFinite(slot) && Math.abs(at - slot) < gap)) throw new Error('Não há horários separados suficientes para iniciar as filas.');
        if (at !== Date.parse(row.next_at)) {
          if (isFixed(config)) {
            const slot = this.db.prepare('SELECT slot_date,slot_minute FROM schedules WHERE account_id=?').get(row.account_id);
            if (localDate(new Date(at), config.timeZone) !== slot.slot_date) throw new Error('Não há espaço para separar os horários das contas neste dia.');
            this.db.prepare('UPDATE fixed_posting_slots SET planned_at=? WHERE account_id=? AND local_date=? AND minute=?').run(new Date(at).toISOString(), row.account_id, slot.slot_date, slot.slot_minute);
          }
          update.run(new Date(at).toISOString(), row.account_id);
        }
        reserved.push(at);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.snapshot();
  }
  cancelAccount(accountId, accountName = '') {
    this.db.prepare('DELETE FROM posting_media_settings WHERE account_id=?').run(accountId);
    this.db.prepare('UPDATE items SET account_name=? WHERE account_id=?').run(String(accountName).slice(0, 120), accountId);
    this.db.prepare("UPDATE items SET status='cancelled' WHERE account_id=? AND status='queued'").run(accountId);
    this.db.prepare("UPDATE schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(accountId);
  }
  resolveUncertain(itemId, outcome) {
    if (!['published', 'cancelled'].includes(outcome)) throw new Error('Resultado de conferência inválido.');
    const item = this.db.prepare("SELECT * FROM items WHERE id=? AND status='uncertain'").get(itemId);
    if (!item) throw new Error('Este vídeo não está aguardando conferência.');
    this.phase(itemId, outcome, { error: outcome === 'published' ? 'Publicação conferida manualmente; link indisponível.' : 'Publicação não confirmada; adicione o vídeo novamente somente se desejar.' });
    if (outcome === 'published' && item.queue_kind === 'account') this.advance(item.account_id,'account');
    return this.snapshot();
  }
  pauseAccount(accountId) { this.db.prepare("UPDATE schedules SET status='paused' WHERE account_id=?").run(accountId); }
  delayRetry(accountId, minutes, now = new Date()) {
    const schedule = this.db.prepare('SELECT config FROM schedules WHERE account_id=?').get(accountId);
    if (!schedule) return;
    const config = JSON.parse(schedule.config);
    const next = isFixed(config) ? new Date(now.getTime() + minutes * 60000).toISOString() : nextAllowed(now.getTime() + minutes * 60000, config);
    this.db.prepare('UPDATE schedules SET next_at=? WHERE account_id=?').run(next, accountId);
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
    return true;
  }
  due(now = new Date(), activeAccounts = new Set()) {
    const candidates = this.db.prepare("SELECT * FROM schedules WHERE status='running' AND next_at<=? ORDER BY next_at").all(now.toISOString());
    return candidates.filter(schedule => {
      if (activeAccounts.has(schedule.account_id)) return false;
      if (!this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind='account' AND status='queued' LIMIT 1").get(schedule.account_id)) { this.db.prepare("UPDATE schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(schedule.account_id); return false; }
      const config = JSON.parse(schedule.config);
      if (isFixed(config)) {
        const today = localDate(now, config.timeZone);
        if (schedule.slot_date !== today || (Date.parse(schedule.next_at) < now.getTime() - 5 * 60000 && this.db.prepare("SELECT status FROM fixed_posting_slots WHERE account_id=? AND local_date=? AND minute=?").get(schedule.account_id, schedule.slot_date, schedule.slot_minute)?.status === 'pending')) {
          this.scheduleFixed(schedule.account_id, now);
          return false;
        }
        const count = this.db.prepare("SELECT published_at FROM items WHERE account_id=? AND status='published' AND published_at IS NOT NULL").all(schedule.account_id).filter(item => localDate(new Date(item.published_at), config.timeZone) === today).length;
        if (count >= config.times.length) { this.scheduleFixed(schedule.account_id, now); return false; }
        return true;
      }
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
  claim(accountId, kind = 'account', random = Math.random) {
    if (kind !== 'account') throw new Error('Esta fila não está mais disponível.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const randomOrder = kind === 'account' && this.mediaSettings(accountId).video_order === 'random';
      const queued = randomOrder ? this.db.prepare("SELECT * FROM items WHERE account_id=? AND queue_kind='account' AND status='queued' ORDER BY position,created_at").all(accountId) : null;
      const item = randomOrder ? queued[Math.floor(random() * queued.length)] : this.db.prepare("SELECT * FROM items WHERE account_id=? AND queue_kind=? AND status='queued' ORDER BY position,created_at LIMIT 1").get(accountId,kind);
      if (!item) { this.db.prepare("UPDATE schedules SET status='stopped',next_at=NULL WHERE account_id=?").run(accountId); this.db.exec('COMMIT'); return null; }
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
    if (kind !== 'account') throw new Error('Esta fila não está mais disponível.');
    const schedule = this.db.prepare('SELECT * FROM schedules WHERE account_id=?').get(accountId);
    if (!schedule) return;
    const table='schedules';
    const config = JSON.parse(schedule.config);
    if (isFixed(config)) this.db.prepare("UPDATE fixed_posting_slots SET status='used' WHERE account_id=? AND local_date=? AND minute=?").run(accountId, schedule.slot_date, schedule.slot_minute);
    const remaining = this.db.prepare("SELECT 1 FROM items WHERE account_id=? AND queue_kind=? AND status='queued' LIMIT 1").get(accountId,kind);
    if (!remaining) { this.db.prepare(`UPDATE ${table} SET status='stopped',next_at=NULL WHERE account_id=?`).run(accountId); return; }
    if (isFixed(config)) {
      this.scheduleFixed(accountId, now);
      return;
    }
    const next = this.groupSlot(nextTime(now, config), config, schedule.group_id, accountId);
    this.db.prepare(`UPDATE ${table} SET next_at=? WHERE account_id=?`).run(next, accountId);
  }
  close() { this.db.close(); }
}
module.exports = { PostingPlan, validateConfig, nextAllowed, nextTime, parts };
