const DAY = 86400000;
const dayStart = at => Math.floor(at / DAY) * DAY;
class InstagramAccountInsights {
  constructor(db) {
    this.db = db;
    const firstMigration=!db.prepare("SELECT 1 FROM sqlite_master WHERE name='insight_schema_versions'").get();
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='insight_schema_versions'").get()) {
      const file = db.prepare('PRAGMA database_list').all().find(row => row.name === 'main')?.file;
      if (file && db.prepare("SELECT 1 FROM sqlite_master WHERE name='official_account_metrics'").get()) db.exec("VACUUM INTO '" + (file + '.insights-v1-' + Date.now() + '.bak').replaceAll("'", "''") + "'");
      db.exec('CREATE TABLE insight_schema_versions(version INTEGER PRIMARY KEY); INSERT INTO insight_schema_versions VALUES(1)');
    }
    if(!firstMigration&&!db.prepare('SELECT 1 FROM insight_schema_versions WHERE version=2').get()){
      const file=db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file;
      if(file&&db.prepare("SELECT 1 FROM sqlite_master WHERE name='official_account_metrics'").get())db.exec("VACUUM INTO '"+(file+'.insights-v2-'+Date.now()+'.bak').replaceAll("'","''")+"'");
    }
    db.exec('CREATE TABLE IF NOT EXISTS official_metric_evidence(account_id TEXT,start_at INTEGER,end_at INTEGER,metric TEXT,evidence TEXT NOT NULL,PRIMARY KEY(account_id,start_at,end_at,metric)); INSERT OR IGNORE INTO insight_schema_versions VALUES(2)');
    db.exec('CREATE TABLE IF NOT EXISTS official_metric_windows(account_id TEXT,start_at INTEGER,end_at INTEGER,requested_timezone TEXT,graph_version TEXT,fetched_at INTEGER,PRIMARY KEY(account_id,start_at,end_at))');
    db.exec(`CREATE TABLE IF NOT EXISTS account_insight_days (
      account_id TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
      views INTEGER NOT NULL, reels INTEGER, fetched_at INTEGER NOT NULL, timezone TEXT NOT NULL,
      PRIMARY KEY(account_id,start_at));
      CREATE TABLE IF NOT EXISTS account_insight_status (
      account_id TEXT PRIMARY KEY, status TEXT NOT NULL, breakdown INTEGER NOT NULL DEFAULT 0,
      retry_at INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS media_insight_attempts (item_id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS account_insight_day_attempts (account_id TEXT NOT NULL,start_at INTEGER NOT NULL,attempted_at INTEGER NOT NULL,PRIMARY KEY(account_id,start_at));`);
    db.exec(`CREATE TABLE IF NOT EXISTS official_account_metrics (account_id TEXT NOT NULL,start_at INTEGER NOT NULL,end_at INTEGER NOT NULL,metric TEXT NOT NULL,value REAL NOT NULL,fetched_at INTEGER NOT NULL,PRIMARY KEY(account_id,start_at,end_at,metric));
      CREATE TABLE IF NOT EXISTS official_media_metrics (item_id TEXT NOT NULL,metric TEXT NOT NULL,value REAL NOT NULL,fetched_at INTEGER NOT NULL,PRIMARY KEY(item_id,metric));`);
    db.exec('CREATE TABLE IF NOT EXISTS official_followers (account_id TEXT NOT NULL,fetched_at INTEGER NOT NULL,value INTEGER NOT NULL,PRIMARY KEY(account_id,fetched_at))');
    db.exec(`CREATE TABLE IF NOT EXISTS official_metric_capabilities (
      account_id TEXT NOT NULL, graph_version TEXT NOT NULL, scope TEXT NOT NULL,
      metric TEXT NOT NULL, status TEXT NOT NULL, checked_at INTEGER NOT NULL,
      PRIMARY KEY(account_id,graph_version,scope,metric))`);
  }
  metricOptions(id, version, scope) {
    const unsupported = new Set(this.db.prepare("SELECT metric FROM official_metric_capabilities WHERE account_id=? AND graph_version=? AND scope=? AND status='unsupported'").all(id, version, scope).map(row => row.metric));
    const deferred = new Set(scope === 'account' ? this.db.prepare("SELECT metric FROM official_metric_capabilities WHERE account_id=? AND graph_version=? AND scope=? AND status='recheck' AND checked_at>?").all(id,version,scope,Date.now()-DAY).map(row=>row.metric) : []);
    const record = (metric,status) => this.db.prepare("INSERT INTO official_metric_capabilities VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,graph_version,scope,metric) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at").run(id,version,scope,metric,status,Date.now());
    return { unsupported, deferred, markDeferred: scope === 'account' ? metric => {
      deferred.add(metric);record(metric,'recheck');
    } : undefined, markUnsupported: metric => {
      unsupported.add(metric);
      record(metric,'unsupported');
    } };
  }
  saveMetrics(id, from, to, values, now = Date.now(), metadata = {}) {
    this.db.exec('SAVEPOINT save_account_metrics');
    try {
    for(const [metric,evidence] of Object.entries(values.evidence||{}))this.db.prepare('INSERT INTO official_metric_evidence VALUES(?,?,?,?,?) ON CONFLICT(account_id,start_at,end_at,metric) DO UPDATE SET evidence=excluded.evidence').run(id,from,to,metric,JSON.stringify(evidence));
    const put = this.db.prepare('INSERT INTO official_account_metrics VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,start_at,end_at,metric) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at');
    for (const [metric,value] of Object.entries(values)) if (typeof value === 'number' && Number.isFinite(value) && value >= 0) put.run(id,from,to,metric,value,now);
    this.db.prepare('INSERT INTO official_metric_windows VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,start_at,end_at) DO UPDATE SET requested_timezone=excluded.requested_timezone,graph_version=excluded.graph_version,fetched_at=excluded.fetched_at').run(id,from,to,metadata.timezone || 'UTC',metadata.graphVersion || null,now);
    this.db.exec('RELEASE save_account_metrics');
    }catch(error){this.db.exec('ROLLBACK TO save_account_metrics; RELEASE save_account_metrics');throw error;}
  }
  saveMedia(id, values, now = Date.now()) {
    const put = this.db.prepare('INSERT INTO official_media_metrics VALUES (?,?,?,?) ON CONFLICT(item_id,metric) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at');
    for (const [metric,value] of Object.entries(values)) if (typeof value === 'number' && Number.isFinite(value) && value >= 0) put.run(id,metric,value,now);
  }
  official(ids, from, to, { allMedia = false, mediaFrom } = {}) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to-from > 366*DAY) throw new Error('Intervalo inválido.');
    if(mediaFrom!=null&&(!Number.isFinite(mediaFrom)||mediaFrom<from||mediaFrom>=to))throw new Error('Período dos Reels inválido.');
    const mediaStart=mediaFrom==null?null:new Date(mediaFrom).toISOString(),mediaEnd=new Date(to).toISOString();
    return {
      evidence: ids.flatMap(id=>this.db.prepare('SELECT * FROM official_metric_evidence WHERE account_id=? AND start_at>=? AND end_at<=?').all(id,from,to)).map(row=>({...row,...JSON.parse(row.evidence),evidence:undefined})),
      metrics: ids.flatMap(id => this.db.prepare('SELECT m.*,w.requested_timezone,w.graph_version,e.evidence FROM official_account_metrics m LEFT JOIN official_metric_windows w USING(account_id,start_at,end_at) LEFT JOIN official_metric_evidence e USING(account_id,start_at,end_at,metric) WHERE m.account_id=? AND m.start_at>=? AND m.end_at<=?').all(id,from,to)).filter(row=>!row.evidence||JSON.parse(row.evidence).status!=='incompatible'),
      media: ids.flatMap(id => allMedia
        ? this.db.prepare("SELECT m.*,i.account_id,i.media_id,i.caption,i.published_at FROM official_media_metrics m JOIN items i ON i.id=m.item_id WHERE i.account_id=? AND i.status='published' AND (? IS NULL OR (i.published_at>=? AND i.published_at<?))").all(id,mediaStart,mediaStart,mediaEnd)
        : this.db.prepare("SELECT m.*,i.account_id,i.media_id,i.caption,i.published_at FROM official_media_metrics m JOIN items i ON i.id=m.item_id WHERE i.account_id=? AND i.status='published' AND i.id IN (SELECT v.item_id FROM official_media_metrics v JOIN items t ON t.id=v.item_id WHERE t.account_id=? AND t.status='published' AND v.metric='views' AND (? IS NULL OR (t.published_at>=? AND t.published_at<?)) ORDER BY v.value DESC LIMIT 5)").all(id,id,mediaStart,mediaStart,mediaEnd)),
      followers: ids.flatMap(id => this.db.prepare('SELECT * FROM official_followers WHERE account_id=? ORDER BY fetched_at DESC LIMIT 2').all(id))
    };
  }
  latestRanking(ids) {
    const result = {};
    for (const metric of ['views', 'reach']) {
      const latest = ids.length ? this.db.prepare(`SELECT start_at,end_at,fetched_at FROM official_account_metrics WHERE metric=? AND account_id IN (${ids.map(() => '?').join(',')}) ORDER BY fetched_at DESC,end_at DESC LIMIT 1`).get(metric,...ids) : null;
      if (!latest) { result[metric] = { window: null, values: {} }; continue; }
      const endDay = Math.floor((latest.end_at - 1) / DAY);
      const values = {};
      for (const row of this.db.prepare('SELECT account_id,value,fetched_at,end_at FROM official_account_metrics WHERE metric=? AND start_at=? AND end_at>? AND end_at<=? ORDER BY fetched_at DESC,end_at DESC').all(metric,latest.start_at,endDay*DAY,(endDay+1)*DAY)) {
        if (ids.includes(row.account_id) && !Object.hasOwn(values,row.account_id)) values[row.account_id] = { value: row.value, fetchedAt: row.fetched_at };
      }
      result[metric] = { window: { from: latest.start_at, to: latest.end_at }, values };
    }
    return result;
  }
  status(id) { return this.db.prepare('SELECT * FROM account_insight_status WHERE account_id=?').get(id); }
  setStatus(id, status, breakdown, retryAt = 0, message = '') {
    this.db.prepare('INSERT INTO account_insight_status VALUES (?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET status=excluded.status,breakdown=excluded.breakdown,retry_at=excluded.retry_at,message=excluded.message').run(id, status, breakdown ? 1 : 0, retryAt, message);
  }
  save(id, result, now) {
    this.db.prepare('INSERT INTO account_insight_days VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_id,start_at) DO UPDATE SET end_at=excluded.end_at,views=excluded.views,reels=excluded.reels,fetched_at=excluded.fetched_at,timezone=excluded.timezone').run(id, result.from, result.to, result.views, result.reels, now, result.timezone);
  }
  query(ids, from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 366 * DAY) throw new Error('Selecione um intervalo válido de até 366 dias.');
    const rows = [], accounts = [];
    for (const id of ids) {
      rows.push(...this.db.prepare('SELECT * FROM account_insight_days WHERE account_id=? AND start_at>=? AND start_at<=? ORDER BY start_at').all(id, dayStart(from), dayStart(to)));
      accounts.push({ account_id: id, ...(this.status(id) || { status: 'pending', breakdown: 0 }), historyDays: this.db.prepare('SELECT COUNT(*) AS count FROM account_insight_days WHERE account_id=? AND start_at>=?').get(id, dayStart(Date.now()) - 30 * DAY).count });
    }
    return { rows, accounts, timezone: 'UTC' };
  }
  selectMedia(id, now = Date.now()) {
    const rows = this.db.prepare(`SELECT i.id,i.account_id,i.media_id,i.published_at,COALESCE(a.attempted_at,0) AS attempted_at FROM items i LEFT JOIN media_insight_attempts a ON a.item_id=i.id WHERE i.account_id=? AND i.status='published' AND i.media_id IS NOT NULL ORDER BY attempted_at ASC,i.published_at DESC,i.id`).all(id);
    const recent = rows.filter(row => Date.parse(row.published_at) >= now - 7 * DAY && row.attempted_at <= now - 3600000);
    const old = rows.filter(row => Date.parse(row.published_at) < now - 7 * DAY && row.attempted_at <= now - DAY);
    return [...recent, ...old];
  }
  attempted(id, now = Date.now()) {
    this.db.prepare('INSERT INTO media_insight_attempts VALUES (?,?) ON CONFLICT(item_id) DO UPDATE SET attempted_at=excluded.attempted_at').run(id, now);
  }
  async refresh(id, igId, token, publisher, progress = () => {}, now = Date.now(), ranges = [], shouldContinue = () => true) {
    const previous = this.status(id);
    if (previous?.retry_at > now) return;
    const periods=require('./ui/instagram-periods.js');
    const today = ranges.length ? periods.midnight(periods.dayKey(now)) : dayStart(now), dates = [today, today - DAY, today - 2 * DAY].filter(at=>!ranges.length||ranges.some(range=>at>=range.from&&at<range.to));
    // At most three missing historical days per cycle. Failed/empty days are retried after newer gaps.
    const existing = new Set((publisher.accountMetrics
      ? this.db.prepare("SELECT start_at FROM official_account_metrics WHERE account_id=? AND metric='views' AND end_at-start_at=86400000 GROUP BY start_at").all(id)
      : this.db.prepare('SELECT start_at FROM account_insight_days WHERE account_id=?').all(id)).map(row => row.start_at));
    const attempts = new Map(this.db.prepare('SELECT start_at,attempted_at FROM account_insight_day_attempts WHERE account_id=?').all(id).map(row=>[row.start_at,row.attempted_at]));
    const requestedDays = ranges.length ? ranges.flatMap(range => { const days=[];for(let at=range.from;at<range.to;at+=DAY)if(at<today-2*DAY && at>=today-180*DAY)days.push(at);return days; }) : Array.from({length:28},(_,index)=>today-(index+3)*DAY);
    const missing = [...new Set(requestedDays)].filter(at=>!existing.has(at));
    missing.sort((a,b)=>(attempts.get(a)||0)-(attempts.get(b)||0)||b-a);
    dates.push(...missing.slice(0,3));
    let completed = 0, supported = previous?.status === 'supported', breakdown = Boolean(previous?.breakdown);
    try {
      for (const from of dates) {
        if(!shouldContinue())return;
        const matching=ranges.find(range=>from>=range.from&&from<range.to);
        const to = Math.min(from === today ? Math.floor(now / 60000) * 60000 : from + DAY,matching?.to??Infinity);
        if (to <= from) continue;
        this.db.prepare('INSERT INTO account_insight_day_attempts VALUES (?,?,?) ON CONFLICT(account_id,start_at) DO UPDATE SET attempted_at=excluded.attempted_at').run(id,from,now);
        let result;
        if (publisher.accountMetrics) {
          const values = await publisher.accountMetrics(igId, token, from, to, this.metricOptions(id, publisher.version, 'account'));
          this.saveMetrics(id,from,to,values,now,{timezone:ranges.length?periods.timezone:'UTC',graphVersion:publisher.version});
          if (values.views != null) result = { views: values.views, reels: null, from, to, timezone: ranges.length?periods.timezone:'UTC' };
        } else {
        try { result = await publisher.accountInsights(igId, token, from, to, true); }
        catch (error) {
          if (error.metaCode !== 100 || error.transient) throw error;
          result = await publisher.accountInsights(igId, token, from, to, false);
        }
        }
        if (result) {
          this.save(id, result, now); supported = true; breakdown = result.reels != null;
        }
        completed++; progress({ accountId: id, completed, total: dates.length });
      }
      this.setStatus(id, supported ? 'supported' : 'unavailable', breakdown, supported ? 0 : now + DAY, supported ? '' : 'A Meta não retornou visualizações diárias para esta conta.');
    } catch (error) {
      const delay = error.retryAfterMinutes ? error.retryAfterMinutes * 60000 : error.metaCode === 100 ? DAY : 15 * 60000;
      const rejected = error.metaCode === 100 && !error.transient;
      this.setStatus(id, supported ? 'supported' : rejected ? 'unavailable' : 'pending', breakdown, now + delay, rejected ? 'Consulta diária indisponível nesta tentativa; uma nova verificação será feita depois.' : 'Coleta interrompida; os dados salvos foram preservados.');
      throw error;
    }
  }
}
module.exports = { InstagramAccountInsights, dayStart, DAY };
