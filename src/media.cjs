const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes } = require('node:crypto');
const { binaryPath } = require('./runtime-binaries.cjs');

const execFileAsync = promisify(execFile);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;

function existingFile(file, extensions, label) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} não encontrado.`);
  if (!extensions.has(path.extname(file).toLowerCase())) throw new Error(`${label} possui um formato não suportado.`);
  return path.resolve(file);
}
function outputPathFor(input, outputDir) {
  const base = path.basename(input, path.extname(input)).replace(/[. ]+$/g, '') || 'video';
  for (let attempt = 0; attempt < 20; attempt++) {
    const output = path.join(outputDir, `${base}_preparado_${randomBytes(5).toString('hex')}.mp4`);
    if (!fs.existsSync(output)) return output;
  }
  throw new Error('Não foi possível criar um nome exclusivo para o vídeo preparado.');
}
function parseRate(value) {
  const [top, bottom = '1'] = String(value || '').split('/').map(Number);
  const rate = bottom ? top / bottom : 30;
  return Number.isFinite(rate) ? Math.min(60, Math.max(24, Math.round(rate))) : 30;
}
function generatePerturbations(width, height) {
  const factor = Math.max(0.5, Math.min(width, height) / 1080);
  const maxCrop = Math.max(1, Math.round(6 * factor));
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 0.999));
  return {
    cropTop: randInt(1, maxCrop),
    cropBottom: randInt(1, maxCrop),
    cropLeft: randInt(1, maxCrop),
    cropRight: randInt(1, maxCrop),
    brightness: Number(rand(-0.03, 0.03).toFixed(4)),
    contrast: Number(rand(0.97, 1.03).toFixed(4)),
    saturation: Number(rand(0.95, 1.05).toFixed(4)),
    hue: Number(rand(-3, 3).toFixed(2)),
    speed: Number(rand(0.99, 1.01).toFixed(4)),
    crf: randInt(18, 22),
    gop: randInt(200, 350),
  };
}
function perturbFilter(p, width, height) {
  const cw = `iw-${p.cropLeft + p.cropRight}`;
  const ch = `ih-${p.cropTop + p.cropBottom}`;
  return [
    `crop=${cw}:${ch}:${p.cropLeft}:${p.cropTop}`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    `eq=brightness=${p.brightness}:contrast=${p.contrast}:saturation=${p.saturation}`,
    `hue=h=${p.hue}`,
    `setpts=PTS/${p.speed}`,
  ].join(',');
}
function buildArgs({ input, output, cover, coverSeconds, width, height, frameRate, hasAudio, perturbations }) {
  const p = perturbations || generatePerturbations(width, height);
  width = REEL_WIDTH;
  height = REEL_HEIGHT;
  const common = [
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-metadata', 'title=', '-metadata', 'comment=', '-metadata', 'creation_time=',
    '-metadata', 'description=', '-metadata', 'author=', '-metadata', 'artist=',
    '-metadata', 'album=', '-metadata', 'date=', '-metadata', 'handler_name=',
    '-metadata', 'location=', '-metadata', 'encoder=',
    '-metadata:s:v', 'handler_name=', '-metadata:s:a', 'handler_name=',
    '-metadata:s:v', 'encoder=', '-metadata:s:a', 'encoder=',
  ];
  // Leave room for encoder variation and MP4 container overhead.
  const encoding = ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(p.crf), '-maxrate', '23M', '-bufsize', '23M', '-pix_fmt', 'yuv420p', '-g', String(p.gop)];
  const audio = hasAudio ? ['-c:a', 'aac', '-ar', '48000', '-b:a', '112k'] : [];
  const vf = perturbFilter(p, width, height);
  let args;
  if (cover) {
    const milliseconds = Math.round(coverSeconds * 1000);
    const videoFilters = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${frameRate},trim=duration=${coverSeconds},setpts=PTS-STARTPTS[cover];[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${frameRate},setpts=PTS-STARTPTS[video];[cover][video]concat=n=2:v=1:a=0[vraw];[vraw]${vf}[v]`;
    const filter = hasAudio ? `${videoFilters};[1:a]adelay=${milliseconds}:all=1,atempo=${p.speed}[a]` : videoFilters;
    args = ['-hide_banner', '-y', '-loop', '1', '-framerate', String(frameRate), '-t', String(coverSeconds), '-i', cover, '-i', input, '-filter_complex', filter, '-map', '[v]'];
    if (hasAudio) args.push('-map', '[a]');
  } else {
    args = ['-hide_banner', '-y', '-i', input, '-map', '0:v:0', '-vf', vf];
    if (hasAudio) args.push('-map', '0:a:0', '-af', `atempo=${p.speed}`);
  }
  return [...args, ...common, ...encoding, ...audio, '-fflags', '+bitexact', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output];
}

function imageOutputPathFor(input, outputDir) {
  const ext = path.extname(input).toLowerCase();
  // PNG stays PNG, everything else becomes JPEG for maximum metadata stripping
  const outExt = ext === '.png' ? '.png' : '.jpg';
  const base = path.basename(input, path.extname(input)).replace(/[. ]+$/g, '') || 'imagem';
  for (let attempt = 0; attempt < 20; attempt++) {
    const output = path.join(outputDir, `${base}_limpo_${randomBytes(5).toString('hex')}${outExt}`);
    if (!fs.existsSync(output)) return output;
  }
  throw new Error('Não foi possível criar um nome exclusivo para a imagem limpa.');
}

function generateImagePerturbations() {
  const rand = (min, max) => min + Math.random() * (max - min);
  return {
    brightness: Number(rand(-0.02, 0.02).toFixed(4)),
    contrast: Number(rand(0.98, 1.02).toFixed(4)),
    saturation: Number(rand(0.97, 1.03).toFixed(4)),
    hue: Number(rand(-2, 2).toFixed(2)),
  };
}

function buildImageArgs({ input, output, perturbations }) {
  const p = perturbations || generateImagePerturbations();
  const ext = path.extname(output).toLowerCase();
  const vf = [
    `eq=brightness=${p.brightness}:contrast=${p.contrast}:saturation=${p.saturation}`,
    `hue=h=${p.hue}`,
  ].join(',');
  // Strip every metadata category: EXIF, XMP, IPTC, ICC profile, GPS, camera info.
  // -map_metadata -1 removes all global/stream metadata containers.
  // Explicit blank tags ensure nothing survives in format-specific headers.
  const common = [
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-metadata', 'title=', '-metadata', 'comment=', '-metadata', 'creation_time=',
    '-metadata', 'description=', '-metadata', 'author=', '-metadata', 'artist=',
    '-metadata', 'album=', '-metadata', 'date=', '-metadata', 'handler_name=',
    '-metadata', 'location=', '-metadata', 'make=', '-metadata', 'model=',
    '-metadata', 'software=', '-metadata', 'copyright=',
    '-metadata', 'GPS=', '-metadata', 'GPSLatitude=', '-metadata', 'GPSLongitude=',
    '-metadata', 'Rating=', '-metadata', 'Subject=', '-metadata', 'XPComment=',
    '-metadata', 'XPAuthor=', '-metadata', 'XPTitle=', '-metadata', 'XPKeywords=',
    '-metadata', 'ImageDescription=', '-metadata', 'UserComment=',
    '-metadata', 'DateTimeOriginal=', '-metadata', 'DateTimeDigitized=',
    '-metadata', 'DateTime=', '-metadata', 'HostComputer=',
    '-metadata', 'LensMake=', '-metadata', 'LensModel=',
    '-metadata', 'ExifVersion=', '-metadata', 'CameraOwnerName=',
    '-metadata', 'BodySerialNumber=', '-metadata', 'LensSerialNumber=',
    '-metadata', 'encoder=',
  ];
  // Re-encode to new pixel data (defeats hash deduplication).
  // -fflags +bitexact prevents ffmpeg from writing its own version string.
  const codec = ext === '.png'
    ? ['-c:v', 'png', '-pred', 'mixed']
    : ['-c:v', 'mjpeg', '-q:v', '2'];
  return ['-hide_banner', '-y', '-fflags', '+bitexact', '-i', input, '-vf', vf, ...common, ...codec, output];
}

class MediaProcessor {
  constructor({ ffmpeg = binaryPath('ffmpeg'), ffprobe = binaryPath('ffprobe'), onProgress = () => {} } = {}) {
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
    this.onProgress = onProgress;
    this.running = false;
    this.child = null;
    this.cancelled = false;
  }
  cancel() {
    if (!this.running) return false;
    this.cancelled = true;
    this.child?.kill();
    return true;
  }
  async probe(input) {
    const { stdout } = await execFileAsync(this.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', input], { windowsHide: true, maxBuffer: 1024 * 1024 });
    const data = JSON.parse(stdout);
    const video = data.streams?.find(stream => stream.codec_type === 'video');
    if (!video?.width || !video?.height) throw new Error('O arquivo não possui uma faixa de vídeo válida.');
    return {
      width: Math.max(2, Math.floor(Math.min(video.width, 1920) / 2) * 2),
      height: Math.max(2, Math.floor(video.height * Math.min(1, 1920 / video.width) / 2) * 2),
      frameRate: parseRate(video.r_frame_rate),
      duration: Number(data.format?.duration) || 0,
      hasAudio: data.streams.some(stream => stream.codec_type === 'audio')
    };
  }
  async processFile(options, index, total) {
    const info = await this.probe(options.input);
    const perturbations = generatePerturbations(info.width, info.height);
    const args = buildArgs({ ...options, ...info, perturbations });
    const duration = Math.max(0.1, (info.duration + (options.cover ? options.coverSeconds : 0)) / perturbations.speed);
    await new Promise((resolve, reject) => {
      const child = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let stderr = '';
      let pending = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        pending += chunk;
        const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
        for (const line of lines) {
          const match = line.match(/^out_time_us=(\d+)$/);
          if (match) {
            const filePercent = Math.min(100, Number(match[1]) / 1000000 / duration * 100);
            this.onProgress({ status: 'running', index, total, file: options.input, output: options.output, filePercent, percent: ((index - 1) + filePercent / 100) / total * 100 });
          }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
      child.on('error', error => reject(new Error(`Não foi possível iniciar o FFmpeg: ${error.message}`)));
      child.on('close', code => {
        this.child = null;
        if (code !== 0) fs.rmSync(options.output, { force: true });
        if (this.cancelled) reject(new Error('Processamento cancelado.'));
        else if (code === 0) resolve();
        else reject(new Error(`Falha ao preparar ${path.basename(options.input)}. ${stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`));
      });
    });
  }
  async processImage(options, index, total) {
    const args = buildImageArgs(options);
    await new Promise((resolve, reject) => {
      const child = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', () => {});
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
      child.on('error', error => reject(new Error(`Não foi possível iniciar o FFmpeg: ${error.message}`)));
      child.on('close', code => {
        this.child = null;
        if (code !== 0) fs.rmSync(options.output, { force: true });
        if (this.cancelled) reject(new Error('Processamento cancelado.'));
        else if (code === 0) resolve();
        else reject(new Error(`Falha ao limpar ${path.basename(options.input)}. ${stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`));
      });
    });
  }
  async start(input) {
    if (this.running) throw new Error('Já existe um processamento em andamento.');
    const videos = [...new Set((input?.videos || []).map(file => existingFile(file, VIDEO_EXTENSIONS, 'Vídeo')))];
    const images = [...new Set((input?.images || []).map(file => existingFile(file, IMAGE_EXTENSIONS, 'Imagem')))];
    if (!videos.length && !images.length) throw new Error('Selecione pelo menos um vídeo ou imagem.');
    const cover = input.cover ? existingFile(input.cover, COVER_EXTENSIONS, 'Capa') : null;
    if (typeof input.outputDir !== 'string' || !path.isAbsolute(input.outputDir)) throw new Error('Selecione uma pasta de saída válida.');
    const outputDir = path.resolve(input.outputDir);
    if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) throw new Error('Selecione uma pasta de saída válida.');
    const coverSeconds = cover ? Number(input.coverSeconds ?? 0.5) : 0;
    if (cover && (!Number.isFinite(coverSeconds) || coverSeconds < 0.2 || coverSeconds > 3)) throw new Error('A duração da capa deve ficar entre 0,2 e 3 segundos.');
    this.running = true;
    this.cancelled = false;
    const outputs = [];
    const totalFiles = videos.length + images.length;
    try {
      for (let index = 0; index < videos.length; index++) {
        if (this.cancelled) throw new Error('Processamento cancelado.');
        const output = outputPathFor(videos[index], outputDir);
        await this.processFile({ input: videos[index], output, cover, coverSeconds }, index + 1, totalFiles);
        outputs.push(output);
        this.onProgress({ status: 'file-complete', index: index + 1, total: totalFiles, file: videos[index], output, filePercent: 100, percent: (index + 1) / totalFiles * 100 });
      }
      for (let index = 0; index < images.length; index++) {
        if (this.cancelled) throw new Error('Processamento cancelado.');
        const output = imageOutputPathFor(images[index], outputDir);
        await this.processImage({ input: images[index], output }, videos.length + index + 1, totalFiles);
        outputs.push(output);
        this.onProgress({ status: 'file-complete', index: videos.length + index + 1, total: totalFiles, file: images[index], output, filePercent: 100, percent: (videos.length + index + 1) / totalFiles * 100 });
      }
      const incomplete = outputs.some(output => !fs.existsSync(output) || fs.statSync(output).size === 0);
      if (incomplete) throw new Error('Um arquivo preparado está incompleto. Os originais foram mantidos.');
      for (const video of videos) fs.unlinkSync(video);
      for (const image of images) fs.unlinkSync(image);
      this.onProgress({ status: 'completed', total: totalFiles, percent: 100, outputs });
      return { outputs };
    } finally {
      this.running = false;
      this.child = null;
    }
  }
}

module.exports = { MediaProcessor, buildArgs, buildImageArgs, generatePerturbations, generateImagePerturbations, perturbFilter, outputPathFor, imageOutputPathFor, VIDEO_EXTENSIONS, IMAGE_EXTENSIONS, COVER_EXTENSIONS, REEL_WIDTH, REEL_HEIGHT };
