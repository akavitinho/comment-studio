const fs = require('node:fs');
const path = require('node:path');
const obfuscator = require('javascript-obfuscator');

const root = path.join(__dirname, '..');
const stage = path.join(root, 'build', 'protected-app');
const protectedModules = [
  'main.cjs', 'x-automation.cjs', 'posting-worker.cjs',
  'posting-plan.cjs', 'meta-auth.cjs', 'posting-storage.cjs',
  'meta-publisher.cjs', 'media.cjs', 'downloader.cjs',
  'domain.cjs', 'x-domain.cjs', 'campaign-analytics.cjs'
];

fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'tests'), path.join(stage, 'tests'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'vendor'), path.join(stage, 'vendor'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'supabase'), path.join(stage, 'supabase'), { recursive: true, force: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(stage, 'package.json'));

for (const [index, name] of protectedModules.entries()) {
  const file = path.join(stage, 'src', name);
  const original = fs.readFileSync(file, 'utf8');
  const code = obfuscator.obfuscate(original, {
    target: 'node',
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    identifiersPrefix: `cs${index}_`,
    renameGlobals: false,
    renameProperties: false,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.6,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.12,
    deadCodeInjection: false,
    selfDefending: false,
    sourceMap: false
  }).getObfuscatedCode();
  fs.writeFileSync(file, code);
  console.log(`${name}: código protegido para distribuição`);
}
