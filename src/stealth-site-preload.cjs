// language: JavaScript (Electron preload), file: stealth-site-preload.cjs
// Preload for site WebContentsView / BrowserWindow views.
// Uses webFrame.executeJavaScript to inject stealth patches into the page's
// main world BEFORE any page scripts run — the only reliable timing for
// defeating Google/Instagram bot detection.
//
// Because sandbox:true limits require() to 'electron' only, this preload
// must be GENERATED at startup with the patch code inlined.
// See main.cjs writeSitePreload() for the generation step.

'use strict';
const { webFrame } = require('electron');

// __STEALTH_PATCH__ is replaced at generation time with the actual patch source.
const patch = __STEALTH_PATCH__;
webFrame.executeJavaScript(patch).catch(() => {});
