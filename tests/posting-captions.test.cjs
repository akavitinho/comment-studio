const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PostingPlan } = require('../src/posting-plan.cjs');

test('legenda em lote persiste por conta e preserva publicações fora da fila editável', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-captions-'));
  const file = path.join(dir, 'postings.sqlite');
  let plan = new PostingPlan(file);
  try {
    const insert = plan.db.prepare('INSERT INTO items (id,account_id,file,caption,position,status,queue_kind,created_at) VALUES (?,?,?,?,?,?,?,?)');
    const rows = [
      ['empty', 'a', '', 'queued', 'account'], ['existing', 'a', 'Original', 'queued', 'account'],
      ['spaces', 'a', ' \r\n\t', 'queued', 'account'], ['other', 'b', 'Outra conta', 'queued', 'account'],
      ...['uploading', 'processing', 'publishing', 'published', 'uncertain', 'attention', 'cancelled'].map(status => [status, 'a', 'Preservar', status, 'account']),
      ['shared', 'a', 'Preservar', 'queued', 'shared']
    ];
    for (const [id, account, caption, status, kind] of rows) insert.run(id, account, 'video.mp4', caption, 1, status, kind, new Date().toISOString());
    const captions = () => Object.fromEntries(plan.snapshot().items.map(item => [item.id, item.caption]));
    const text = 'Uma legenda para todos 🎬\n#reels';
    assert.equal(plan.updateCaptions(['a', 'a'], text, true).updatedCount, 2);
    assert.equal(captions().existing, 'Original');
    assert.equal(plan.updateCaptions(['a'], text).updatedCount, 3);
    assert.equal(captions().other, 'Outra conta');
    for (const [id, , , status, kind] of rows) if (status !== 'queued' || kind === 'shared') assert.equal(captions()[id], 'Preservar');
    assert.equal(plan.updateCaptions(['a', 'b'], text, true).updatedCount, 0);
    assert.equal(plan.updateCaptions(['a', 'b'], text).updatedCount, 4);
    const before = captions();
    for (const args of [[[], text], [['a'], ''], [['a'], ' \n'], [['a'], 'x'.repeat(2201)], [['a'], null], [['a', null], text], [['a'], text, 'yes']]) {
      assert.throws(() => plan.updateCaptions(...args));
      assert.deepEqual(captions(), before);
    }
    // A failed batch must not leave the first account partially updated.
    plan.db.exec("CREATE TRIGGER reject_caption BEFORE UPDATE OF caption ON items WHEN NEW.account_id='b' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => plan.updateCaptions(['a', 'b'], 'Outra legenda'), /test failure/);
    assert.deepEqual(captions(), before);
    plan.close(); plan = new PostingPlan(file);
    assert.equal(captions().existing, text);
    assert.equal(captions().other, text);
  } finally { plan.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
