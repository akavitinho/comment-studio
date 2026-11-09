// language: JavaScript (Electron preload), file: stealth-preload.cjs
// Injected into every WebContentsView that renders sites (free browser, account windows).
// Patches Electron fingerprint leaks so the browser passes Gmail / Instagram / TikTok bot detection.
// Runs in an isolated world via contextBridge — no node access leaks.

'use strict';
const { contextBridge } = require('electron');

// The script below runs in the PAGE context via executeJavaScript at dom-ready,
// so it has direct access to window/navigator/document. contextBridge is only
// used here as a signal channel if needed in the future.

/**
 * Returns the JS source that patches all known Electron fingerprint leaks.
 * Must be injected via webContents.executeJavaScript BEFORE any page script runs
 * (use 'dom-created' or webContents.executeJavaScriptInIsolatedWorld at navigation).
 */
function stealthPatchSource() {
  return `(function() {
  'use strict';
  // ── 1. navigator.webdriver ──────────────────────────────────────────
  // disable-blink-features=AutomationControlled handles this in Chromium 134,
  // but belt-and-suspenders: delete the property if it leaked through.
  try {
    const proto = Object.getPrototypeOf(navigator);
    if ('webdriver' in navigator) {
      Object.defineProperty(proto, 'webdriver', { get: () => false, configurable: true });
    }
  } catch {}

  // ── 2. window.chrome stub ───────────────────────────────────────────
  // Electron 45 exposes a partial window.chrome (only runtime). Its object
  // may be frozen or have non-configurable props, so we build a full
  // replacement and force-replace via Object.defineProperty on window.
  try {
    const existingRuntime = window.chrome && window.chrome.runtime ? window.chrome.runtime : null;
    const chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }, getDetails: function() { return null; }, getIsInstalled: function() { return false; } },
      csi: function() { return { startE: Date.now(), onloadT: Date.now(), pageT: performance.now(), tran: 15 }; },
      loadTimes: function() { return { commitLoadTime: Date.now() / 1000, connectionInfo: 'h2', finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000, navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true }; },
      runtime: existingRuntime || {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        connect: function() { return { disconnect: function() {}, onDisconnect: { addListener: function() {} }, onMessage: { addListener: function() {} }, postMessage: function() {} }; },
        sendMessage: function(id, msg, opts, cb) { if (typeof cb === 'function') cb(); else if (typeof opts === 'function') opts(); },
        id: undefined
      }
    };
    const fakeToString = fn => {
      Object.defineProperty(fn, 'toString', { value: function() { return 'function ' + (fn.name || '') + '() { [native code] }'; }, configurable: true });
    };
    try { fakeToString(chrome.csi); fakeToString(chrome.loadTimes); fakeToString(chrome.app.getDetails); fakeToString(chrome.app.getIsInstalled); } catch {}
    // Force-replace: delete then redefine to bypass frozen/sealed Electron chrome
    try { delete window.chrome; } catch {}
    Object.defineProperty(window, 'chrome', { value: chrome, writable: true, configurable: true, enumerable: true });
  } catch {}

  // ── 2b. navigator.userAgentData ─────────────────────────────────────
  // Google checks userAgentData.brands for "Google Chrome". Electron omits
  // it, which triggers "This browser may not be secure" on Google login.
  try {
    const uaMatch = navigator.userAgent.match(/Chrome\\/(\\d+)/);
    const major = uaMatch ? uaMatch[1] : '134';
    const fullMatch = navigator.userAgent.match(/Chrome\\/([\\d.]+)/);
    const full = fullMatch ? fullMatch[1] : major + '.0.0.0';
    const brands = Object.freeze([
      Object.freeze({ brand: 'Chromium', version: major }),
      Object.freeze({ brand: 'Google Chrome', version: major }),
      Object.freeze({ brand: 'Not:A-Brand', version: '99' })
    ]);
    const fullBrands = Object.freeze([
      Object.freeze({ brand: 'Chromium', version: full }),
      Object.freeze({ brand: 'Google Chrome', version: full }),
      Object.freeze({ brand: 'Not:A-Brand', version: '99.0.0.0' })
    ]);
    const platform = navigator.platform === 'Win32' ? 'Windows' : navigator.platform === 'MacIntel' ? 'macOS' : 'Linux';
    const mobile = /Mobile|Android/i.test(navigator.userAgent);
    const uaData = {
      brands: brands,
      mobile: mobile,
      platform: platform,
      getHighEntropyValues: function(hints) {
        return Promise.resolve({
          brands: brands,
          fullVersionList: fullBrands,
          mobile: mobile,
          platform: platform,
          platformVersion: platform === 'Windows' ? '15.0.0' : '13.0.0',
          architecture: 'x86',
          bitness: '64',
          model: '',
          uaFullVersion: full,
          wow64: false
        });
      },
      toJSON: function() { return { brands: brands, mobile: mobile, platform: platform }; }
    };
    Object.defineProperty(navigator, 'userAgentData', { get: () => uaData, configurable: true });
  } catch {}

  // ── 3. navigator.plugins ────────────────────────────────────────────
  // Electron has an empty plugins array. Real Chrome on Windows has at least
  // PDF Viewer and Chrome PDF Viewer. This is checked by bot detectors.
  try {
    const fakeMime = (type, suffixes, description, plugin) => {
      const m = Object.create(MimeType.prototype);
      Object.defineProperties(m, {
        type: { get: () => type }, suffixes: { get: () => suffixes },
        description: { get: () => description }, enabledPlugin: { get: () => plugin }
      });
      return m;
    };
    const fakePlugin = (name, filename, description, mimes) => {
      const p = Object.create(Plugin.prototype);
      const items = [];
      Object.defineProperties(p, {
        name: { get: () => name }, filename: { get: () => filename },
        description: { get: () => description }, length: { get: () => items.length }
      });
      for (let i = 0; i < mimes.length; i++) {
        const m = fakeMime(mimes[i].type, mimes[i].suffixes, mimes[i].description, p);
        items.push(m);
        Object.defineProperty(p, i, { get: () => m });
      }
      p.item = idx => items[idx] || null;
      p.namedItem = name => items.find(m => m.type === name) || null;
      return p;
    };
    const pdfMimes = [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }];
    const plugins = [
      fakePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      fakePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      fakePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      fakePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      fakePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes)
    ];
    const pluginArray = Object.create(PluginArray.prototype);
    Object.defineProperty(pluginArray, 'length', { get: () => plugins.length });
    for (let i = 0; i < plugins.length; i++) {
      Object.defineProperty(pluginArray, i, { get: () => plugins[i] });
    }
    pluginArray.item = idx => plugins[idx] || null;
    pluginArray.namedItem = name => plugins.find(p => p.name === name) || null;
    pluginArray.refresh = () => {};
    pluginArray[Symbol.iterator] = function*() { for (const p of plugins) yield p; };
    Object.defineProperty(navigator, 'plugins', { get: () => pluginArray, configurable: true });

    // Also patch navigator.mimeTypes
    const allMimes = plugins.flatMap((p, i) => Array.from({ length: p.length }, (_, j) => p[j]));
    const mimeArray = Object.create(MimeTypeArray.prototype);
    Object.defineProperty(mimeArray, 'length', { get: () => allMimes.length });
    for (let i = 0; i < allMimes.length; i++) Object.defineProperty(mimeArray, i, { get: () => allMimes[i] });
    mimeArray.item = idx => allMimes[idx] || null;
    mimeArray.namedItem = type => allMimes.find(m => m.type === type) || null;
    mimeArray[Symbol.iterator] = function*() { for (const m of allMimes) yield m; };
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeArray, configurable: true });
  } catch {}

  // ── 4. navigator.languages ──────────────────────────────────────────
  // Ensure languages is always an array with at least navigator.language.
  try {
    if (!navigator.languages || !navigator.languages.length) {
      const lang = navigator.language || 'pt-BR';
      Object.defineProperty(navigator, 'languages', { get: () => Object.freeze([lang, lang.split('-')[0]]), configurable: true });
    }
  } catch {}

  // ── 5. Permissions API hardening ────────────────────────────────────
  // Electron's Permissions.query() can throw or behave oddly. Stub it to
  // return "prompt" for notifications (like real Chrome with no decision).
  try {
    const originalQuery = Permissions.prototype.query;
    Permissions.prototype.query = function(desc) {
      if (desc && desc.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null, addEventListener: () => {} });
      }
      return originalQuery.call(this, desc);
    };
  } catch {}

  // ── 6. Notification constructor ─────────────────────────────────────
  // If Notification.permission is "denied" because we blocked permissions,
  // override to "default" which is less suspicious (real users just haven't decided).
  try {
    if (Notification.permission === 'denied') {
      Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
    }
  } catch {}

  // ── 7. iframe contentWindow ─────────────────────────────────────────
  // Bot detectors create a tiny iframe and check properties on its contentWindow.
  // Electron handles these correctly when webSecurity is on, so this is mostly fine.

  // ── 8. Error stack trace normalization ──────────────────────────────
  // Electron sometimes leaks internal paths in Error.stack. Clamp stack depth
  // and strip anything that looks like an Electron internal path.
  try {
    Error.stackTraceLimit = 10;
  } catch {}

  // ── 9. window dimensions consistency ────────────────────────────────
  // outerWidth/outerHeight should be >= innerWidth/innerHeight.
  // In Electron WebContentsView this can mismatch. Patch if needed.
  try {
    const ow = window.outerWidth, oh = window.outerHeight;
    const iw = window.innerWidth, ih = window.innerHeight;
    if (ow < iw || oh < ih) {
      Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth + 16, configurable: true });
      Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 88, configurable: true });
    }
  } catch {}

  // ── 10. navigator.connection ────────────────────────────────────────
  // Electron may lack NetworkInformation. Stub a basic wifi connection.
  try {
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g', rtt: 50, downlink: 10, saveData: false,
          addEventListener: () => {}, removeEventListener: () => {},
          onchange: null, type: 'wifi'
        }),
        configurable: true
      });
    }
  } catch {}

  // ── 11. navigator.getBattery ────────────────────────────────────────
  // Some detectors call this. Stub if missing.
  try {
    if (!navigator.getBattery) {
      navigator.getBattery = () => Promise.resolve({
        charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
        addEventListener: () => {}, removeEventListener: () => {}, onchargingchange: null,
        onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null
      });
    }
  } catch {}

  // ── 12. Automation flags cleanup ────────────────────────────────────
  // Remove any leftover Electron/automation indicators.
  try {
    delete window.__nightmare;
    delete window._phantom;
    delete window.callPhantom;
    delete window._selenium_ide_recorder;
    delete window._SELENIUM_IDE_RECORDER;
    delete window.__webdriver_script_fn;
    delete window.__driver_evaluate;
    delete window.__webdriver_evaluate;
    delete window.__fxdriver_evaluate;
    delete window.__driver_unwrapped;
    delete window.__webdriver_unwrapped;
    delete window.__fxdriver_unwrapped;
    delete window.__lastWatirAlert;
    delete window.__lastWatirConfirm;
    delete window.__lastWatirPrompt;
    delete document.__webdriver_evaluate;
    delete document.__selenium_evaluate;
    delete document.__webdriver_script_function;
    delete document.__webdriver_script_func;
    delete document.__webdriver_script_fn;
    delete document.documentElement.getAttribute;
  } catch {}

  // Restore documentElement.getAttribute if we accidentally deleted it
  try {
    if (!document.documentElement.getAttribute) {
      document.documentElement.getAttribute = Element.prototype.getAttribute;
    }
  } catch {}

  // ── 13. WebGL renderer / vendor spoofing ─────────────────────────────
  // Mask SwiftShader / ANGLE fallback strings that signal headless Electron.
  // Picks one realistic GPU per session; patches both WebGL1 and WebGL2.
  try {
    const gpuList = [
      { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }
    ];
    const gpu = gpuList[Math.floor(Math.random() * gpuList.length)];
    const patchGL = (proto) => {
      const origGetParam = proto.getParameter;
      proto.getParameter = function(param) {
        try {
          const ext = this.getExtension('WEBGL_debug_renderer_info');
          if (ext) {
            if (param === ext.UNMASKED_VENDOR_WEBGL) return gpu.v;
            if (param === ext.UNMASKED_RENDERER_WEBGL) return gpu.r;
          }
        } catch {}
        return origGetParam.call(this, param);
      };
    };
    patchGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchGL(WebGL2RenderingContext.prototype);
  } catch {}

  // ── 14. sourceURL / sourceMap masking ───────────────────────────────
  // Prevent injected scripts from being detectable via sourceURL.

  // ── 15. Canvas fingerprint noise ───────────────────────────────────
  // Per-session pixel noise on canvas readback so fingerprint hashes differ.
  // Clones the canvas before noising — original is never modified.
  try {
    const cSeed = Math.floor(Math.random() * 2147483647) || 1;
    const nByte = (v, s) => (v + (((cSeed >> s) & 1) * 2 - 1) + 256) & 255;
    const noiseCanvas = (src) => {
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const im = ctx.getImageData(0, 0, c.width, c.height);
      const d = im.data;
      for (let k = 0; k < 12; k++) {
        const i = (((cSeed * (k + 1) * 31337) >>> 0) % (d.length >> 2)) << 2;
        d[i]     = nByte(d[i],     k & 7);
        d[i + 1] = nByte(d[i + 1], (k + 3) & 7);
      }
      ctx.putImageData(im, 0, 0);
      return c;
    };
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      if (this.width < 1 || this.height < 1) return origToDataURL.apply(this, arguments);
      try { return origToDataURL.apply(noiseCanvas(this), arguments); }
      catch { return origToDataURL.apply(this, arguments); }
    };
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function() {
      if (this.width < 1 || this.height < 1) return origToBlob.apply(this, arguments);
      try { return origToBlob.apply(noiseCanvas(this), arguments); }
      catch { return origToBlob.apply(this, arguments); }
    };
  } catch {}

  // ── 16. AudioContext fingerprint noise ─────────────────────────────
  // Micro-offset on AnalyserNode and short AudioBuffer readback.
  try {
    const aOff = (Math.random() * 0.00001) + 0.000002;
    const origGFF = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function(arr) {
      origGFF.call(this, arr);
      for (let i = 0; i < arr.length; i += 13) arr[i] += aOff;
    };
    const origGCD = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(ch) {
      const buf = origGCD.call(this, ch);
      if (buf.length <= 8192) { for (let i = 0; i < buf.length; i += 97) buf[i] += aOff; }
      return buf;
    };
  } catch {}

  // ── 17. hardwareConcurrency / deviceMemory ─────────────────────────
  // Realistic per-session values — real desktops: 4-16 cores, 4-16 GB.
  try {
    const cores = [4, 6, 8, 12, 16][Math.floor(Math.random() * 5)];
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores, configurable: true });
  } catch {}
  try {
    const mem = [4, 8, 8, 16][Math.floor(Math.random() * 4)];
    Object.defineProperty(navigator, 'deviceMemory', { get: () => mem, configurable: true });
  } catch {}

  // ── 18. Screen properties consistency ──────────────────────────────
  // Clamp colorDepth / pixelDepth to 24 if Electron reports an odd value.
  try {
    if (screen.colorDepth !== 24 && screen.colorDepth !== 32) {
      Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });
    }
  } catch {}

  // ── 19. maxTouchPoints consistency ─────────────────────────────────
  // Desktop should report 0; Electron sometimes leaks > 0 from the host.
  try {
    if (!/Mobile|Android/i.test(navigator.userAgent) && navigator.maxTouchPoints > 0) {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true });
    }
  } catch {}

  // ── 20. navigator.vendor ───────────────────────────────────────────
  // Must be "Google Inc." on Chrome-based browsers. Electron may leave it empty.
  try {
    if (!navigator.vendor || navigator.vendor === '') {
      Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });
    }
  } catch {}

})();`;
}

module.exports = { stealthPatchSource };
