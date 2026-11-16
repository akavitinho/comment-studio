const fs = require('node:fs');
const path = require('node:path');

function sameFolder(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function syncPostingFolders(plan, accounts, { completedFile = null, minAgeMs = 5000 } = {}) {
  let importedCount = 0;
  for (const account of accounts) {
    if (account.platform !== 'instagram') continue;
    const folder = plan.mediaSettings(account.id).folder;
    if (!folder) continue;
    try { if (!fs.statSync(folder).isDirectory()) continue; }
    catch { continue; }
    if (completedFile && !sameFolder(folder, path.dirname(completedFile))) continue;
    const result = plan.importFolder(account.id, account.name, completedFile
      ? { onlyFile: completedFile, includeSnapshot: false }
      : { minAgeMs, includeSnapshot: false });
    importedCount += result.importedCount;
  }
  return importedCount;
}

module.exports = { syncPostingFolders };
