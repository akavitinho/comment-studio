const { randomUUID } = require('node:crypto');

// One running collection and one replaceable pending selection. Checkpoints are
// between requests, so already returned metrics are always committed first.
class InstagramInsightsCoordinator {
  constructor({ db, collect, onProgress = () => {}, now = Date.now }) {
    Object.assign(this, { db, collect, onProgress, now });
    this.active = null; this.pending = null; this.last = null; this.stopped = false;
    db.exec('CREATE TABLE IF NOT EXISTS instagram_collection_jobs(id TEXT PRIMARY KEY,request TEXT NOT NULL,status TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    const unfinished = db.prepare("SELECT * FROM instagram_collection_jobs ORDER BY CASE WHEN status='queued' THEN 0 ELSE 1 END,updated_at DESC,rowid DESC LIMIT 1").all();
    db.prepare("UPDATE instagram_collection_jobs SET status='interrupted' WHERE status IN ('running','queued')").run();
    if (unfinished[0] && ['running','queued','interrupted'].includes(unfinished[0].status)) {
      try { this.recovery = JSON.parse(unfinished[0].request); } catch { this.recovery = null; }
    }
  }
  key(request) { return JSON.stringify([[...request.accountIds].sort(), request.ranges,request.selectionKey]); }
  persist(job, status) {
    job.status = status;
    this.db.prepare('INSERT INTO instagram_collection_jobs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').run(job.refreshId, JSON.stringify(job.request), status, this.now());
  }
  submit(request) {
    if (this.stopped) throw new Error('A coleta está sendo encerrada.');
    const key = this.key(request);
    if (this.active?.key === key && !this.pending) return this.ack(this.active, true);
    if (this.pending?.key === key) return this.ack(this.pending, true);
    const job = { refreshId: randomUUID(), key, request: structuredClone(request), phase: 'queued', startedAt: this.now(), sequence: 0 };
    if (this.pending) this.persist(this.pending, 'superseded');
    this.pending = job; this.persist(job, 'queued');
    if (!this.active) this.startNext();
    return this.ack(job, false);
  }
  ack(job, alreadyRunning) { return { refreshId: job.refreshId, selectionKey: job.request.selectionKey, startedAt:job.startedAt, backgroundActive: true, queued: job.status === 'queued', alreadyRunning, accounts: job.request.accountIds.length }; }
  snapshot() {
    const describe = job => job && ({ ...job.progress, refreshId: job.refreshId, selectionKey: job.request.selectionKey, startedAt:job.startedAt, accountIds: job.request.accountIds, ranges: job.request.ranges, phase: job.phase, status: job.status, sequence: job.sequence });
    return { active: describe(this.active), queued: describe(this.pending), last: describe(this.last), recoverable: Boolean(this.recovery) };
  }
  emit(job, progress) {
    job.phase = progress.phase; job.progress = { ...job.progress, ...progress }; job.sequence++;
    this.onProgress({ ...job.progress, platform: 'instagram', refreshId: job.refreshId, selectionKey: job.request.selectionKey, sequence: job.sequence, status: job.status });
  }
  startNext() {
    if (this.active || !this.pending || this.stopped) return;
    const job = this.active = this.pending; this.pending = null;
    this.persist(job, 'running');
    this.emit(job, { phase: 'started', startedAt: this.now() });
    const shouldContinue = () => !this.stopped && !this.pending;
    this.running = Promise.resolve().then(() => this.collect(job.request, { refreshId: job.refreshId, shouldContinue, progress: value => this.emit(job, value) }))
      .then(result => {
        this.persist(job, this.stopped ? 'interrupted' : this.pending ? 'superseded' : 'complete');
        this.emit(job, { ...result, phase: job.status === 'complete' ? 'background-complete' : job.status, durationMs: this.now() - job.startedAt });
      }, error => {
        this.persist(job, this.stopped ? 'interrupted' : 'failed');
        this.emit(job, { phase: 'failed', failures: [error.message || 'Falha na coleta.'] });
      }).finally(() => { this.last = job; this.active = null; this.startNext(); });
  }
  resume() { if (!this.recovery) return null; const request = this.recovery; this.recovery = null; return this.submit(request); }
  stop() { this.stopped = true; if (this.active) this.persist(this.active, 'interrupted'); /* queued request stays recoverable */ }
}
module.exports = { InstagramInsightsCoordinator };
