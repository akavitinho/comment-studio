'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { generateFingerprint, ensureFingerprint, mulberry32, GPU_LIST, SCREENS, LOCALES } = require('../src/fingerprint.cjs');
const { stealthPatchSource } = require('../src/stealth-preload.cjs');

describe('fingerprint generation', () => {
  test('generates a complete profile with all required fields', () => {
    const fp = generateFingerprint();
    assert.ok(typeof fp.seed === 'number' && fp.seed > 0);
    assert.ok(typeof fp.canvasSeed === 'number');
    assert.ok(typeof fp.audioOffset === 'number' && fp.audioOffset > 0);
    assert.ok(typeof fp.clientRectOffset === 'number' && fp.clientRectOffset > 0);
    assert.ok([4, 6, 8, 12, 16].includes(fp.cores));
    assert.ok([4, 8, 16].includes(fp.memory));
    assert.ok([24, 32].includes(fp.colorDepth));
    assert.ok(fp.screen.width > 0 && fp.screen.height > 0);
    assert.ok(GPU_LIST.some(g => g.v === fp.gpu.vendor && g.r === fp.gpu.renderer));
    assert.ok(typeof fp.timezone === 'string' && fp.timezone.length > 0);
    assert.ok(typeof fp.locale === 'string');
    assert.ok(Array.isArray(fp.languages) && fp.languages.length > 0);
    assert.ok(typeof fp.platformVersion === 'string');
  });

  test('two profiles have different seeds', () => {
    const a = generateFingerprint();
    const b = generateFingerprint();
    assert.notEqual(a.seed, b.seed);
  });

  test('accepts timezone and locale overrides', () => {
    const fp = generateFingerprint({ timezone: 'Europe/London', locale: 'GB' });
    assert.equal(fp.timezone, 'Europe/London');
    assert.equal(fp.locale, 'en-GB');
    assert.deepEqual(fp.languages, ['en-GB', 'en']);
  });

  test('unknown locale falls back to en-US', () => {
    const fp = generateFingerprint({ locale: 'ZZ' });
    assert.equal(fp.locale, 'en-US');
  });
});

describe('ensureFingerprint', () => {
  test('adds fingerprint to account without one', () => {
    const account = { id: 'test-1', name: 'Test' };
    const changed = ensureFingerprint(account);
    assert.equal(changed, true);
    assert.ok(account.fingerprint);
    assert.ok(account.fingerprint.seed > 0);
  });

  test('does not overwrite existing fingerprint', () => {
    const existing = { seed: 42, canvasSeed: 1, audioOffset: 0.001, clientRectOffset: 0.01, cores: 8, memory: 16, colorDepth: 24, screen: { width: 1920, height: 1080 }, gpu: { vendor: 'x', renderer: 'y' }, timezone: 'UTC', locale: 'en-US', languages: ['en-US'], platformVersion: '10.0.0' };
    const account = { id: 'test-2', fingerprint: existing };
    const changed = ensureFingerprint(account);
    assert.equal(changed, false);
    assert.equal(account.fingerprint.seed, 42);
  });
});

describe('mulberry32 PRNG', () => {
  test('same seed produces same sequence', () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      assert.equal(rng1(), rng2());
    }
  });

  test('different seeds produce different sequences', () => {
    const rng1 = mulberry32(11111);
    const rng2 = mulberry32(22222);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (rng1() === rng2()) same++;
    }
    assert.ok(same < 5, 'Different seeds should produce different values');
  });

  test('values are in [0, 1) range', () => {
    const rng = mulberry32(99999);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1, `Value ${v} out of range`);
    }
  });
});

describe('stealthPatchSource with profile', () => {
  test('returns valid JS without profile', () => {
    const src = stealthPatchSource();
    assert.ok(src.startsWith('(function()'));
    assert.ok(src.includes('_fp = null'));
  });

  test('embeds profile JSON when provided', () => {
    const fp = generateFingerprint({ timezone: 'America/Sao_Paulo', locale: 'BR' });
    const src = stealthPatchSource(fp);
    assert.ok(src.includes(`"seed":${fp.seed}`));
    assert.ok(src.includes('"timezone":"America/Sao_Paulo"'));
    assert.ok(src.includes('"locale":"pt-BR"'));
  });

  test('includes all stealth sections', () => {
    const fp = generateFingerprint();
    const src = stealthPatchSource(fp);
    // Core patches
    assert.ok(src.includes('navigator.webdriver'), 'webdriver patch');
    assert.ok(src.includes('window.chrome'), 'chrome stub');
    assert.ok(src.includes('userAgentData'), 'userAgentData');
    assert.ok(src.includes('PluginArray'), 'plugins');
    assert.ok(src.includes('navigator.vendor'), 'vendor');
    // New patches
    assert.ok(src.includes('getTimezoneOffset'), 'timezone spoof');
    assert.ok(src.includes('DateTimeFormat'), 'Intl timezone');
    assert.ok(src.includes('navigator.language'), 'locale spoof');
    assert.ok(src.includes('screen.width'), 'screen spoof');
    assert.ok(src.includes('getBoundingClientRect'), 'clientrects noise');
    assert.ok(src.includes('navigator.permissions'), 'permissions API');
    assert.ok(src.includes('Notification.permission'), 'notification');
    assert.ok(src.includes('speechSynthesis'), 'speech voices');
    assert.ok(src.includes('fonts.check'), 'font enumeration');
  });

  test('profile values are deterministic (same seed = same fingerprint data)', () => {
    const fp = generateFingerprint();
    const src1 = stealthPatchSource(fp);
    const src2 = stealthPatchSource(fp);
    assert.equal(src1, src2, 'Same profile should produce identical patch source');
  });

  test('PRNG inside patch uses profile seed when provided', () => {
    const fp = generateFingerprint();
    const src = stealthPatchSource(fp);
    assert.ok(src.includes('_mulberry32(_fp.seed)'), 'Should use profile seed for PRNG');
    assert.ok(src.includes('_fp.canvasSeed'), 'Should use profile canvas seed');
    assert.ok(src.includes('_fp.audioOffset'), 'Should use profile audio offset');
    assert.ok(src.includes('_fp.cores'), 'Should use profile cores');
    assert.ok(src.includes('_fp.memory'), 'Should use profile memory');
    assert.ok(src.includes('_fp.gpu.vendor'), 'Should use profile GPU vendor');
    assert.ok(src.includes('_fp.screen.width'), 'Should use profile screen');
    assert.ok(src.includes('_fp.clientRectOffset'), 'Should use profile clientRect offset');
  });
});
