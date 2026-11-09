const { app, net, session, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PostingStorage } = require('../src/posting-storage.cjs');

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-storage-live-'));
  const file = path.join(dir, 'probe.mp4'); fs.writeFileSync(file, 'storage probe');
  try {
    const storage = new PostingStorage({ directory: dir, safeStorage, net });
    storage.configure({ url: process.env.STUDIO_SUPABASE_URL, publishableKey: process.env.STUDIO_SUPABASE_KEY });
    const result = await storage.upload('integration-probe', { ses: session.defaultSession, proxy: null, credentials: null }, file);
    if (!result.signedUrl.startsWith(storage.info().url)) throw new Error('Signed URL uses another project.');
    const publicFetch = await fetch(result.signedUrl);
    if (!publicFetch.ok || await publicFetch.text() !== 'storage probe') throw new Error('Signed URL is not readable without authentication.');
    await storage.remove(result.client, result.objectPath);
    console.log('Electron Storage probe: upload, unauthenticated signed URL and cleanup passed.');
  } catch (error) { console.error(`Electron Storage probe failed: ${error.message}`); process.exitCode = 1; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); app.exit(process.exitCode || 0); }
}).catch(error => { console.error(error.message); app.quit(); });
