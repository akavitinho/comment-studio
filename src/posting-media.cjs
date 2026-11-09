const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { binaryPath } = require('./runtime-binaries.cjs');

const run = promisify(execFile);
function isVerticalReel(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs(width / height - 9 / 16) <= 0.005;
}
async function validateReel(file, caption) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !fs.existsSync(file)) throw new Error('Arquivo de vídeo não encontrado.');
  const stat = fs.statSync(file);
  if (!stat.isFile() || !['.mp4', '.mov'].includes(path.extname(file).toLowerCase())) throw new Error('Use um vídeo MP4 ou MOV. Prepare o arquivo em Mídia.');
  if (stat.size > 1024 ** 3) throw new Error('O Reel deve ter até 1 GB. Prepare o arquivo em Mídia.');
  if (typeof caption !== 'string' || caption.length > 2200) throw new Error('A legenda deve ter até 2.200 caracteres.');
  let data;
  try {
    const { stdout } = await run(binaryPath('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,bit_rate:format=duration,bit_rate', '-of', 'json', file], { windowsHide: true, maxBuffer: 1024 * 1024 });
    data = JSON.parse(stdout);
  } catch { throw new Error('Não foi possível examinar o vídeo com ffprobe. Confira a instalação do FFmpeg.'); }
  const video = data.streams?.find(stream => stream.codec_type === 'video');
  const audio = data.streams?.find(stream => stream.codec_type === 'audio');
  const duration = Number(data.format?.duration);
  const [numerator, denominator = 1] = String(video?.r_frame_rate || '').split('/').map(Number);
  const fps = numerator / denominator;
  if (!video || !['h264', 'hevc'].includes(video.codec_name) || !Number.isFinite(fps) || fps < 23 || fps > 60 || video.width > 1920 || !video.width || !video.height || !Number.isFinite(duration) || duration < 3 || duration > 900 || (audio && (audio.codec_name !== 'aac' || Number(audio.sample_rate) !== 48000))) {
    throw new Error('Vídeo incompatível com Reels (H.264/HEVC, áudio AAC 48 kHz, 23–60 fps, 3–900 s, largura até 1920 px). Prepare em Mídia.');
  }
  if (!isVerticalReel(video.width, video.height)) throw new Error('O vídeo precisa ser vertical em 9:16 para Reels. Prepare em Mídia.');
  const videoBitrate = Number(video.bit_rate);
  const audioBitrate = audio ? Number(audio.bit_rate) : 0;
  const totalBitrate = Number(data.format?.bit_rate);
  if ((Number.isFinite(videoBitrate) && videoBitrate > 25000000) || (audio && Number.isFinite(audioBitrate) && audioBitrate > 128000) || (Number.isFinite(totalBitrate) && totalBitrate > 25128000)) throw new Error('Bitrate acima do limite para Reels (vídeo 25 Mb/s, áudio 128 kb/s). Prepare em Mídia.');
  if ((!Number.isFinite(videoBitrate) || videoBitrate <= 0) && (!Number.isFinite(totalBitrate) || totalBitrate <= 0)) throw new Error('Não foi possível medir o bitrate do vídeo. Prepare em Mídia.');
  if (audio && (!Number.isFinite(audioBitrate) || audioBitrate <= 0)) throw new Error('Não foi possível medir o bitrate do áudio. Prepare em Mídia.');
  return { duration, width: video.width, height: video.height, fps, size: stat.size };
}
module.exports = { validateReel, isVerticalReel };
