const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseLinks, analyzeLinks, identifyPlatform } = require('../src/downloader.cjs');

test('identifies common video platforms and removes duplicate links', () => {
  assert.equal(identifyPlatform('https://www.tiktok.com/@creator/video/123'), 'TikTok');
  assert.equal(identifyPlatform('https://www.instagram.com/reel/example/'), 'Instagram');
  assert.equal(identifyPlatform('https://youtu.be/example'), 'YouTube');
  assert.equal(identifyPlatform('https://x.com/user/status/123'), 'X');
  const links = parseLinks('https://youtu.be/example\nhttps://youtu.be/example\nhttps://vimeo.com/123');
  assert.equal(links.length, 2);
  assert.deepEqual(links.map(item => item.platform), ['YouTube', 'Vimeo']);
});

test('extracts markdown URLs, keeps only Instagram Reels and normalizes profile-prefixed links', () => {
  const pasted = '[Home](https://www.instagram.com/)\\\n[Perfil](https://www.instagram.com/bianca_wvx/)\\\n[Reel](https://www.instagram.com/bianca_wvx/reel/DdozH6ORHtp/)\\\n[Duplicado](https://www.instagram.com/reel/DdozH6ORHtp/)\\\n[Direct](https://www.instagram.com/direct/inbox/)\\\n[Ajuda](https://help.instagram.com/)';
  const result = analyzeLinks(pasted);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].url, 'https://www.instagram.com/reel/DdozH6ORHtp/');
  assert.equal(result.links[0].label, 'Instagram Reels');
  assert.equal(result.ignoredCount, 4);
});

test('download links reject local, credentialed and non-http addresses', () => {
  for (const value of ['http://localhost/video', 'http://127.0.0.1/video', 'http://192.168.1.2/video', 'https://user:pass@example.com/video']) {
    assert.throws(() => parseLinks(value), /não permitido/);
  }
  assert.throws(() => parseLinks('not a link'), /Nenhum link/);
});

test('bundled yt-dlp executable is present and runnable', () => {
  const executable = path.join(__dirname, '..', 'vendor', 'yt-dlp.exe');
  assert.equal(fs.existsSync(executable), true);
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^\d{4}\.\d{2}\.\d{2}/);
});
