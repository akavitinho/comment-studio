const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PostingPlan } = require('../src/posting-plan.cjs');
const { syncPostingFolders } = require('../src/posting-folder-sync.cjs');

test('downloads enter every queue linked to the output folder without duplicates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-folder-sync-'));
  const folder = path.join(root, 'videos'); fs.mkdirSync(folder);
  const other = path.join(root, 'other'); fs.mkdirSync(other);
  const file = path.join(folder, 'novo.mp4'); fs.writeFileSync(file, 'complete');
  const plan = new PostingPlan(path.join(root, 'postings.sqlite'));
  const accounts = [
    { id: 'a', name: 'Conta A', platform: 'instagram' },
    { id: 'b', name: 'Conta B', platform: 'instagram' },
    { id: 'c', name: 'Conta C', platform: 'instagram' },
    { id: 'x', name: 'Conta X', platform: 'x' }
  ];
  try {
    plan.saveMediaSettings('a', { folder });
    plan.saveMediaSettings('b', { folder });
    plan.saveMediaSettings('c', { folder: other });
    assert.equal(syncPostingFolders(plan, accounts, { completedFile: file }), 2);
    assert.equal(syncPostingFolders(plan, accounts, { completedFile: file }), 0);
    assert.deepEqual(plan.snapshot().items.map(item => item.account_id), ['a', 'b']);
  } finally { plan.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('periodic scan waits for a newly written file and later imports it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-folder-scan-'));
  const folder = path.join(root, 'videos'); fs.mkdirSync(folder);
  const file = path.join(folder, 'novo.mov'); fs.writeFileSync(file, 'copying');
  const plan = new PostingPlan(path.join(root, 'postings.sqlite'));
  const accounts = [{ id: 'a', name: 'Conta A', platform: 'instagram' }];
  try {
    plan.saveMediaSettings('a', { folder });
    assert.equal(syncPostingFolders(plan, accounts), 0);
    const old = new Date(Date.now() - 10000);
    fs.utimesSync(file, old, old);
    assert.equal(syncPostingFolders(plan, accounts), 1);
    assert.equal(syncPostingFolders(plan, accounts), 0);
  } finally { plan.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
