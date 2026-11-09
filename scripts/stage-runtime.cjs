const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'win32') throw new Error('Este instalador é para Windows.');
const root = path.join(__dirname, '..');
const target = path.join(root, 'build', 'runtime');
fs.mkdirSync(target, { recursive: true });

function commandPath(name) {
  let result;
  try { result = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean); }
  catch { throw new Error(`${name} não encontrado. Instale FFmpeg e FFprobe antes de gerar o instalador.`); }
  if (!result || !fs.existsSync(result)) throw new Error(`${name} não encontrado.`);
  return result.trim();
}
function stage(source, name) {
  if (!fs.existsSync(source)) throw new Error(`Arquivo necessário ausente: ${name}`);
  const destination = path.join(target, name);
  fs.copyFileSync(source, destination);
  console.log(`${name}: ${Math.round(fs.statSync(destination).size / 1048576)} MiB`);
}

const ffmpeg = commandPath('ffmpeg.exe');
const ffprobe = commandPath('ffprobe.exe');
stage(ffmpeg, 'ffmpeg.exe');
stage(ffprobe, 'ffprobe.exe');
stage(path.join(root, 'vendor', 'yt-dlp.exe'), 'yt-dlp.exe');
const ffmpegRoot = path.dirname(path.dirname(ffmpeg));
for (const name of ['LICENSE', 'README.txt']) {
  const source = path.join(ffmpegRoot, name);
  if (fs.existsSync(source)) stage(source, `FFmpeg-${name}`);
}
stage(path.join(root, 'vendor', 'README.md'), 'yt-dlp-README.md');
