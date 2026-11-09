const fs = require('node:fs');
const path = require('node:path');
class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, accounts: [], proxies: [], campaign: null, events: [] };
    if (this.data.version !== 1 || !Array.isArray(this.data.accounts) || !Array.isArray(this.data.proxies)) throw new Error('Formato de dados inválido. Preserve state.json antes de tentar recuperar.');
    let migrated = false;
    for (const account of this.data.accounts) {
      if (!account.platform) { account.platform = 'tiktok'; migrated = true; }
      if (!['tiktok', 'instagram', 'x'].includes(account.platform)) throw new Error('Uma conta possui plataforma inválida. Preserve state.json antes de tentar recuperar.');
    }
    if (migrated) this.save();
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  log(message) {
    this.data.events.unshift({ at: new Date().toISOString(), message });
    this.data.events = this.data.events.slice(0, 300);
    this.save();
  }
}
module.exports = { Store };
