// language: JavaScript (Node.js), file: fingerprint.cjs
// Generates and manages persistent browser fingerprint profiles per account.
// Each account gets a deterministic set of hardware/software traits that stay
// stable across sessions, matching what anti-detect browsers do.

'use strict';
const { randomInt } = require('node:crypto');

const GPU_LIST = [
  { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)' }
];

const SCREENS = [
  { w: 1920, h: 1080 }, { w: 1366, h: 768 }, { w: 1440, h: 900 },
  { w: 1536, h: 864 }, { w: 1680, h: 1050 }, { w: 2560, h: 1440 },
  { w: 1600, h: 900 }, { w: 1280, h: 720 }, { w: 1920, h: 1200 }
];

const CORES = [4, 4, 6, 8, 8, 12, 16];
const MEMORY = [4, 8, 8, 8, 16, 16];

const LOCALES = {
  'BR': { lang: 'pt-BR', langs: ['pt-BR', 'pt', 'en'] },
  'US': { lang: 'en-US', langs: ['en-US', 'en'] },
  'PT': { lang: 'pt-PT', langs: ['pt-PT', 'pt', 'en'] },
  'ES': { lang: 'es-ES', langs: ['es-ES', 'es', 'en'] },
  'FR': { lang: 'fr-FR', langs: ['fr-FR', 'fr', 'en'] },
  'DE': { lang: 'de-DE', langs: ['de-DE', 'de', 'en'] },
  'IT': { lang: 'it-IT', langs: ['it-IT', 'it', 'en'] },
  'GB': { lang: 'en-GB', langs: ['en-GB', 'en'] },
  'MX': { lang: 'es-MX', langs: ['es-MX', 'es', 'en'] },
  'AR': { lang: 'es-AR', langs: ['es-AR', 'es', 'en'] },
  'CO': { lang: 'es-CO', langs: ['es-CO', 'es', 'en'] },
  'default': { lang: 'en-US', langs: ['en-US', 'en'] }
};

// Mulberry32 PRNG — deterministic, fast, good distribution
function mulberry32(seed) {
  let s = seed | 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

// Generate a complete fingerprint profile for an account
function generateFingerprint({ timezone, locale } = {}) {
  const seed = randomInt(1, 2147483647);
  const rng = mulberry32(seed);

  const screen = pick(rng, SCREENS);
  const gpu = pick(rng, GPU_LIST);
  const cores = pick(rng, CORES);
  const memory = pick(rng, MEMORY);
  const colorDepth = pick(rng, [24, 24, 24, 32]);

  // Canvas / Audio / WebGL noise seeds (deterministic from main seed)
  const canvasSeed = Math.floor(rng() * 2147483647) || 1;
  const audioOffset = rng() * 0.00001 + 0.000002;
  const clientRectOffset = (rng() * 0.04) + 0.001; // 0.001 – 0.041 sub-pixel noise

  // Platform version for Windows (most common values)
  const platformVersion = pick(rng, ['10.0.0', '13.0.0', '14.0.0', '15.0.0', '15.0.0']);

  const localeData = LOCALES[locale] || LOCALES['default'];
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    seed,
    canvasSeed,
    audioOffset,
    clientRectOffset,
    cores,
    memory,
    colorDepth,
    screen: { width: screen.w, height: screen.h },
    gpu: { vendor: gpu.v, renderer: gpu.r },
    timezone: tz,
    locale: localeData.lang,
    languages: localeData.langs,
    platformVersion
  };
}

// Ensure an account has a fingerprint; generate if missing
function ensureFingerprint(account) {
  if (account.fingerprint && account.fingerprint.seed) return false;
  account.fingerprint = generateFingerprint();
  return true; // changed
}

module.exports = { generateFingerprint, ensureFingerprint, mulberry32, GPU_LIST, SCREENS, LOCALES };
