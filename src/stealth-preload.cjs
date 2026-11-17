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
 * @param {object} [profile] - Persistent fingerprint profile for this account.
 *   When omitted, falls back to random-per-load (backward compat for non-account windows).
 * Must be injected via webContents.executeJavaScript BEFORE any page script runs
 * (use 'dom-created' or webContents.executeJavaScriptInIsolatedWorld at navigation).
 */
function stealthPatchSource(profile) {
  // Inline the profile as JSON so the page-context IIFE can read it
  const profileJSON = JSON.stringify(profile || null);
  return `(function() {
  'use strict';
  var _fp = ${profileJSON};

  // ── Deterministic PRNG (mulberry32) ──────────────────────────────────
  // Used for all randomization so fingerprints stay consistent per account.
  function _mulberry32(seed) {
    var s = seed | 0;
    return function() {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var _rng = _fp ? _mulberry32(_fp.seed) : function() { return Math.random(); };

  // ── 1. navigator.webdriver ──────────────────────────────────────────
  try {
    var proto = Object.getPrototypeOf(navigator);
    if ('webdriver' in navigator) {
      Object.defineProperty(proto, 'webdriver', { get: function() { return false; }, configurable: true });
    }
  } catch(e) {}

  // ── 1b. Remove Electron/Node.js globals that leak identity ─────────
  try {
    // Electron contextBridge internals
    delete window.__electron_contextBridge;
    delete window.__electronLog;
    delete window.electron;
    // Node.js globals that Electron may expose despite sandbox
    if (typeof window.process !== 'undefined' && window.process.versions) {
      delete window.process;
    }
    if (typeof window.require === 'function') { delete window.require; }
    if (typeof window.module !== 'undefined') { delete window.module; }
    if (typeof window.exports !== 'undefined' && window.exports !== window) { delete window.exports; }
    if (typeof window.Buffer !== 'undefined') { delete window.Buffer; }
    if (typeof window.global !== 'undefined' && window.global === window) { /* ok */ }
    else if (typeof window.global !== 'undefined') { delete window.global; }
  } catch(e) {}

  // ── 2. window.chrome stub ───────────────────────────────────────────
  try {
    var existingRuntime = window.chrome && window.chrome.runtime ? window.chrome.runtime : null;
    var chrome = {
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
    var fakeToString = function(fn) {
      Object.defineProperty(fn, 'toString', { value: function() { return 'function ' + (fn.name || '') + '() { [native code] }'; }, configurable: true });
    };
    try { fakeToString(chrome.csi); fakeToString(chrome.loadTimes); fakeToString(chrome.app.getDetails); fakeToString(chrome.app.getIsInstalled); } catch(e) {}
    try { delete window.chrome; } catch(e) {}
    Object.defineProperty(window, 'chrome', { value: chrome, writable: true, configurable: true, enumerable: true });
  } catch(e) {}

  // ── 2b. navigator.userAgentData ─────────────────────────────────────
  try {
    var uaMatch = navigator.userAgent.match(/Chrome\\/(\\d+)/);
    var major = uaMatch ? uaMatch[1] : '134';
    var fullMatch = navigator.userAgent.match(/Chrome\\/([\\d.]+)/);
    var full = fullMatch ? fullMatch[1] : major + '.0.0.0';
    var brands = Object.freeze([
      Object.freeze({ brand: 'Chromium', version: major }),
      Object.freeze({ brand: 'Google Chrome', version: major }),
      Object.freeze({ brand: 'Not:A-Brand', version: '99' })
    ]);
    var fullBrands = Object.freeze([
      Object.freeze({ brand: 'Chromium', version: full }),
      Object.freeze({ brand: 'Google Chrome', version: full }),
      Object.freeze({ brand: 'Not:A-Brand', version: '99.0.0.0' })
    ]);
    var _platform = navigator.platform === 'Win32' ? 'Windows' : navigator.platform === 'MacIntel' ? 'macOS' : 'Linux';
    var _mobile = /Mobile|Android/i.test(navigator.userAgent);
    var _platformVersion = _fp ? _fp.platformVersion : '15.0.0';
    var uaData = {
      brands: brands,
      mobile: _mobile,
      platform: _platform,
      getHighEntropyValues: function(hints) {
        return Promise.resolve({
          brands: brands,
          fullVersionList: fullBrands,
          mobile: _mobile,
          platform: _platform,
          platformVersion: _platformVersion,
          architecture: 'x86',
          bitness: '64',
          model: '',
          uaFullVersion: full,
          wow64: false
        });
      },
      toJSON: function() { return { brands: brands, mobile: _mobile, platform: _platform }; }
    };
    Object.defineProperty(navigator, 'userAgentData', { get: function() { return uaData; }, configurable: true });
  } catch(e) {}

  // ── 3. navigator.plugins ────────────────────────────────────────────
  try {
    var fakeMime = function(type, suffixes, description, plugin) {
      var m = Object.create(MimeType.prototype);
      Object.defineProperties(m, {
        type: { get: function() { return type; } }, suffixes: { get: function() { return suffixes; } },
        description: { get: function() { return description; } }, enabledPlugin: { get: function() { return plugin; } }
      });
      return m;
    };
    var fakePlugin = function(name, filename, description, mimes) {
      var p = Object.create(Plugin.prototype);
      var items = [];
      Object.defineProperties(p, {
        name: { get: function() { return name; } }, filename: { get: function() { return filename; } },
        description: { get: function() { return description; } }, length: { get: function() { return items.length; } }
      });
      for (var i = 0; i < mimes.length; i++) {
        var m = fakeMime(mimes[i].type, mimes[i].suffixes, mimes[i].description, p);
        items.push(m);
        Object.defineProperty(p, i, { get: (function(mm) { return function() { return mm; }; })(m) });
      }
      p.item = function(idx) { return items[idx] || null; };
      p.namedItem = function(name) { return items.find(function(m) { return m.type === name; }) || null; };
      return p;
    };
    var pdfMimes = [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }];
    var plugins = [
      fakePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      fakePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      fakePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      fakePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes),
      fakePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format', pdfMimes)
    ];
    var pluginArray = Object.create(PluginArray.prototype);
    Object.defineProperty(pluginArray, 'length', { get: function() { return plugins.length; } });
    for (var i = 0; i < plugins.length; i++) {
      Object.defineProperty(pluginArray, i, { get: (function(pp) { return function() { return pp; }; })(plugins[i]) });
    }
    pluginArray.item = function(idx) { return plugins[idx] || null; };
    pluginArray.namedItem = function(name) { return plugins.find(function(p) { return p.name === name; }) || null; };
    pluginArray.refresh = function() {};
    pluginArray[Symbol.iterator] = function*() { for (var p of plugins) yield p; };
    Object.defineProperty(navigator, 'plugins', { get: function() { return pluginArray; }, configurable: true });
    var allMimes = plugins.flatMap(function(p) { return Array.from({ length: p.length }, function(_, j) { return p[j]; }); });
    var mimeArray = Object.create(MimeTypeArray.prototype);
    Object.defineProperty(mimeArray, 'length', { get: function() { return allMimes.length; } });
    for (var i2 = 0; i2 < allMimes.length; i2++) Object.defineProperty(mimeArray, i2, { get: (function(mm) { return function() { return mm; }; })(allMimes[i2]) });
    mimeArray.item = function(idx) { return allMimes[idx] || null; };
    mimeArray.namedItem = function(type) { return allMimes.find(function(m) { return m.type === type; }) || null; };
    mimeArray[Symbol.iterator] = function*() { for (var m of allMimes) yield m; };
    Object.defineProperty(navigator, 'mimeTypes', { get: function() { return mimeArray; }, configurable: true });
  } catch(e) {}

  // ── 4. navigator.languages + locale ─────────────────────────────────
  try {
    var _langs = _fp ? Object.freeze(_fp.languages) : null;
    var _lang = _fp ? _fp.locale : null;
    if (_lang) {
      Object.defineProperty(navigator, 'language', { get: function() { return _lang; }, configurable: true });
    }
    if (_langs) {
      Object.defineProperty(navigator, 'languages', { get: function() { return _langs; }, configurable: true });
    } else if (!navigator.languages || !navigator.languages.length) {
      var lang = navigator.language || 'pt-BR';
      Object.defineProperty(navigator, 'languages', { get: function() { return Object.freeze([lang, lang.split('-')[0]]); }, configurable: true });
    }
  } catch(e) {}

  // ── 5. Timezone spoofing ────────────────────────────────────────────
  // Override Intl.DateTimeFormat and Date.getTimezoneOffset to match proxy geo.
  try {
    if (_fp && _fp.timezone) {
      var _tz = _fp.timezone;

      // Calculate offset for this timezone
      var _calcOffset = function() {
        var now = new Date();
        var utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        var local = new Date(now.toLocaleString('en-US', { timeZone: _tz }));
        return Math.round((utc - local) / 60000);
      };

      // Override Date.prototype.getTimezoneOffset
      var _origGetTZOffset = Date.prototype.getTimezoneOffset;
      Date.prototype.getTimezoneOffset = function() { return _calcOffset(); };

      // Override Intl.DateTimeFormat to inject timezone
      var _OrigDTF = Intl.DateTimeFormat;
      Intl.DateTimeFormat = function(locales, options) {
        var opts = Object.assign({}, options);
        if (!opts.timeZone) opts.timeZone = _tz;
        return new _OrigDTF(locales, opts);
      };
      Intl.DateTimeFormat.prototype = _OrigDTF.prototype;
      Intl.DateTimeFormat.supportedLocalesOf = _OrigDTF.supportedLocalesOf;
      Object.defineProperty(Intl.DateTimeFormat, 'name', { value: 'DateTimeFormat' });
      Object.defineProperty(Intl.DateTimeFormat, 'length', { value: 0 });

      // Override Date.prototype.toString/toLocaleString family
      var _dateStringMethods = ['toString', 'toDateString', 'toTimeString', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'];
      _dateStringMethods.forEach(function(method) {
        var orig = Date.prototype[method];
        Date.prototype[method] = function() {
          if (arguments.length === 0 || (arguments.length >= 1 && typeof arguments[arguments.length - 1] !== 'object')) {
            try {
              if (method === 'toString' || method === 'toDateString' || method === 'toTimeString') {
                // These don't accept options in standard, use toLocaleString as proxy
                var parts = new _OrigDTF('en-US', { timeZone: _tz, weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }).formatToParts(this);
                var pv = {};
                parts.forEach(function(p) { pv[p.type] = p.value; });
                if (method === 'toDateString') return pv.weekday + ' ' + pv.month + ' ' + pv.day + ' ' + pv.year;
                if (method === 'toTimeString') return pv.hour + ':' + pv.minute + ':' + pv.second + ' ' + (pv.timeZoneName || '');
                return pv.weekday + ' ' + pv.month + ' ' + pv.day + ' ' + pv.year + ' ' + pv.hour + ':' + pv.minute + ':' + pv.second + ' ' + (pv.timeZoneName || '');
              }
              var args = Array.prototype.slice.call(arguments);
              if (args.length === 0) args.push(undefined);
              if (typeof args[args.length - 1] === 'object') args[args.length - 1].timeZone = _tz;
              else args.push({ timeZone: _tz });
              return orig.apply(this, args);
            } catch(e) { return orig.apply(this, arguments); }
          }
          return orig.apply(this, arguments);
        };
      });
    }
  } catch(e) {}

  // ── 8. Error stack trace normalization ──────────────────────────────
  try {
    Error.stackTraceLimit = 10;
  } catch(e) {}

  // ── 9. Window dimensions / screen spoofing ─────────────────────────
  try {
    var ow = window.outerWidth, oh = window.outerHeight;
    var iw = window.innerWidth, ih = window.innerHeight;
    if (ow < iw || oh < ih) {
      Object.defineProperty(window, 'outerWidth', { get: function() { return window.innerWidth + 16; }, configurable: true });
      Object.defineProperty(window, 'outerHeight', { get: function() { return window.innerHeight + 88; }, configurable: true });
    }
    // Screen resolution spoofing (persistent per account)
    if (_fp && _fp.screen) {
      var _sw = _fp.screen.width, _sh = _fp.screen.height;
      Object.defineProperty(screen, 'width', { get: function() { return _sw; }, configurable: true });
      Object.defineProperty(screen, 'height', { get: function() { return _sh; }, configurable: true });
      Object.defineProperty(screen, 'availWidth', { get: function() { return _sw; }, configurable: true });
      Object.defineProperty(screen, 'availHeight', { get: function() { return _sh - 40; }, configurable: true });
    }
  } catch(e) {}

  // ── 10. navigator.connection ────────────────────────────────────────
  try {
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: function() { return ({
          effectiveType: '4g', rtt: 50, downlink: 10, saveData: false,
          addEventListener: function() {}, removeEventListener: function() {},
          onchange: null, type: 'wifi'
        }); },
        configurable: true
      });
    }
  } catch(e) {}

  // ── 11. navigator.getBattery ────────────────────────────────────────
  try {
    if (!navigator.getBattery) {
      navigator.getBattery = function() { return Promise.resolve({
        charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
        addEventListener: function() {}, removeEventListener: function() {}, onchargingchange: null,
        onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null
      }); };
    }
  } catch(e) {}

  // ── 12. Automation flags cleanup ────────────────────────────────────
  try {
    delete window.__nightmare; delete window._phantom; delete window.callPhantom;
    delete window._selenium_ide_recorder; delete window._SELENIUM_IDE_RECORDER;
    delete window.__webdriver_script_fn; delete window.__driver_evaluate;
    delete window.__webdriver_evaluate; delete window.__fxdriver_evaluate;
    delete window.__driver_unwrapped; delete window.__webdriver_unwrapped;
    delete window.__fxdriver_unwrapped; delete window.__lastWatirAlert;
    delete window.__lastWatirConfirm; delete window.__lastWatirPrompt;
    delete document.__webdriver_evaluate; delete document.__selenium_evaluate;
    delete document.__webdriver_script_function; delete document.__webdriver_script_func;
    delete document.__webdriver_script_fn;
    delete document.documentElement.getAttribute;
  } catch(e) {}
  try {
    if (!document.documentElement.getAttribute) {
      document.documentElement.getAttribute = Element.prototype.getAttribute;
    }
  } catch(e) {}

  // ── 13. WebGL renderer / vendor spoofing ─────────────────────────────
  // Deterministic GPU per account (from profile) or random per session (fallback).
  try {
    var _gpuV, _gpuR;
    if (_fp && _fp.gpu) { _gpuV = _fp.gpu.vendor; _gpuR = _fp.gpu.renderer; }
    else {
      var gpuList = [
        { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
        { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' }
      ];
      var gpu = gpuList[Math.floor(_rng() * gpuList.length)];
      _gpuV = gpu.v; _gpuR = gpu.r;
    }
    var patchGL = function(proto) {
      var origGetParam = proto.getParameter;
      proto.getParameter = function(param) {
        try {
          var ext = this.getExtension('WEBGL_debug_renderer_info');
          if (ext) {
            if (param === ext.UNMASKED_VENDOR_WEBGL) return _gpuV;
            if (param === ext.UNMASKED_RENDERER_WEBGL) return _gpuR;
          }
        } catch(e) {}
        return origGetParam.call(this, param);
      };
    };
    patchGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchGL(WebGL2RenderingContext.prototype);
  } catch(e) {}

  // ── 15. Canvas fingerprint noise ───────────────────────────────────
  // Deterministic noise using profile seed (same hash every session).
  try {
    var cSeed = _fp ? _fp.canvasSeed : (Math.floor(_rng() * 2147483647) || 1);
    var nByte = function(v, s) { return (v + (((cSeed >> s) & 1) * 2 - 1) + 256) & 255; };
    var noiseCanvas = function(src) {
      var c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      var im = ctx.getImageData(0, 0, c.width, c.height);
      var d = im.data;
      for (var k = 0; k < 12; k++) {
        var idx = (((cSeed * (k + 1) * 31337) >>> 0) % (d.length >> 2)) << 2;
        d[idx]     = nByte(d[idx],     k & 7);
        d[idx + 1] = nByte(d[idx + 1], (k + 3) & 7);
      }
      ctx.putImageData(im, 0, 0);
      return c;
    };
    var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      if (this.width < 1 || this.height < 1) return origToDataURL.apply(this, arguments);
      try { return origToDataURL.apply(noiseCanvas(this), arguments); }
      catch(e) { return origToDataURL.apply(this, arguments); }
    };
    var origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function() {
      if (this.width < 1 || this.height < 1) return origToBlob.apply(this, arguments);
      try { return origToBlob.apply(noiseCanvas(this), arguments); }
      catch(e) { return origToBlob.apply(this, arguments); }
    };
  } catch(e) {}

  // ── 16. AudioContext fingerprint noise ─────────────────────────────
  // Deterministic offset from profile (same audio hash every session).
  try {
    var aOff = _fp ? _fp.audioOffset : ((_rng() * 0.00001) + 0.000002);
    var origGFF = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function(arr) {
      origGFF.call(this, arr);
      for (var i = 0; i < arr.length; i += 13) arr[i] += aOff;
    };
    var origGCD = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(ch) {
      var buf = origGCD.call(this, ch);
      if (buf.length <= 8192) { for (var i = 0; i < buf.length; i += 97) buf[i] += aOff; }
      return buf;
    };
  } catch(e) {}

  // ── 17. hardwareConcurrency / deviceMemory ─────────────────────────
  // Deterministic per account from profile.
  try {
    var _cores = _fp ? _fp.cores : [4, 6, 8, 12, 16][Math.floor(_rng() * 5)];
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: function() { return _cores; }, configurable: true });
  } catch(e) {}
  try {
    var _mem = _fp ? _fp.memory : [4, 8, 8, 16][Math.floor(_rng() * 4)];
    Object.defineProperty(navigator, 'deviceMemory', { get: function() { return _mem; }, configurable: true });
  } catch(e) {}

  // ── 18. Screen properties consistency ──────────────────────────────
  try {
    var _cd = _fp ? _fp.colorDepth : 24;
    if (_cd !== screen.colorDepth) {
      Object.defineProperty(screen, 'colorDepth', { get: function() { return _cd; }, configurable: true });
      Object.defineProperty(screen, 'pixelDepth', { get: function() { return _cd; }, configurable: true });
    }
  } catch(e) {}

  // ── 19. maxTouchPoints consistency ─────────────────────────────────
  try {
    if (!/Mobile|Android/i.test(navigator.userAgent) && navigator.maxTouchPoints > 0) {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: function() { return 0; }, configurable: true });
    }
  } catch(e) {}

  // ── 20. navigator.vendor ───────────────────────────────────────────
  try {
    if (!navigator.vendor || navigator.vendor === '') {
      Object.defineProperty(navigator, 'vendor', { get: function() { return 'Google Inc.'; }, configurable: true });
    }
  } catch(e) {}

  // ── 21. ClientRects noise ──────────────────────────────────────────
  // Sub-pixel offset on getBoundingClientRect / getClientRects to vary fingerprint.
  try {
    var _crOff = _fp ? _fp.clientRectOffset : ((_rng() * 0.04) + 0.001);
    var _origGetBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      var rect = _origGetBCR.call(this);
      return new DOMRect(rect.x + _crOff, rect.y + _crOff, rect.width, rect.height);
    };
    var _origGetCR = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function() {
      var rects = _origGetCR.call(this);
      var result = [];
      for (var i = 0; i < rects.length; i++) {
        result.push(new DOMRect(rects[i].x + _crOff, rects[i].y + _crOff, rects[i].width, rects[i].height));
      }
      // Mimic DOMRectList
      result.item = function(idx) { return result[idx] || null; };
      return result;
    };
  } catch(e) {}

  // ── 22. Permissions API normalization ──────────────────────────────
  // Real Chrome returns 'prompt' for most permissions. Electron may differ.
  try {
    if (navigator.permissions) {
      var _origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(desc) {
        return _origQuery(desc).catch(function() {
          return { state: 'prompt', onchange: null, addEventListener: function() {}, removeEventListener: function() {} };
        });
      };
    }
  } catch(e) {}

  // ── 23. Notification.permission ────────────────────────────────────
  try {
    if (typeof Notification !== 'undefined' && Notification.permission !== 'default') {
      Object.defineProperty(Notification, 'permission', { get: function() { return 'default'; }, configurable: true });
    }
  } catch(e) {}

  // ── 24. Speech synthesis voices normalization ──────────────────────
  // Reduce voice list leakage by capping exposed voices.
  try {
    if (window.speechSynthesis) {
      var _origGetVoices = speechSynthesis.getVoices.bind(speechSynthesis);
      speechSynthesis.getVoices = function() {
        var voices = _origGetVoices();
        // Return max 6 common voices to reduce uniqueness
        return voices.slice(0, 6);
      };
    }
  } catch(e) {}

  // ── 25. Font enumeration protection ────────────────────────────────
  // Override document.fonts.check to return consistent results.
  try {
    if (document.fonts && document.fonts.check) {
      var _safeCheck = document.fonts.check.bind(document.fonts);
      var _commonFonts = ['Arial', 'Verdana', 'Helvetica', 'Times New Roman', 'Courier New',
        'Georgia', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Tahoma',
        'Segoe UI', 'Calibri', 'Cambria', 'Consolas', 'Lucida Console'];
      document.fonts.check = function(font, text) {
        // Only report common fonts as available
        var family = (font.match(/['"]?([^'",$]+)['"]?\\s*$/)||[])[1];
        if (family && !_commonFonts.some(function(f) { return f.toLowerCase() === family.trim().toLowerCase(); })) {
          return false;
        }
        return _safeCheck(font, text);
      };
    }
  } catch(e) {}

})();`;
}

module.exports = { stealthPatchSource };
