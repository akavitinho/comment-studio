const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isIP } = require('node:net');

function identifyPlatform(value) {
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  if (/(^|\.)tiktok\.com$/.test(host)) return 'TikTok';
  if (/(^|\.)instagram\.com$/.test(host)) return 'Instagram';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'YouTube';
  if (/(^|\.)(twitter\.com|x\.com)$/.test(host)) return 'X';
  if (/(^|\.)(facebook\.com|fb\.watch)$/.test(host)) return 'Facebook';
  if (/(^|\.)vimeo\.com$/.test(host)) return 'Vimeo';
  return 'Site compatível';
}
function privateHost(host) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) return true;
  if (isIP(value) === 4) return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
  if (isIP(value) === 6) return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  return false;
}
function normalizeVideoLink(value) {
  if (value.length > 2048) throw new Error('Um dos links é muito longo.');
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || privateHost(url.hostname)) throw new Error(`Link não permitido: ${value.slice(0, 80)}`);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (/(^|\.)instagram\.com$/.test(host)) {
    const reelIndex = parts.findIndex(part => part.toLowerCase() === 'reel');
    const code = reelIndex >= 0 ? parts[reelIndex + 1] : null;
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
    return { url: `https://www.instagram.com/reel/${code}/`, platform: 'Instagram', type: 'Reel', label: 'Instagram Reels' };
  }
  if (/(^|\.)tiktok\.com$/.test(host)) {
    if (['vm.tiktok.com', 'vt.tiktok.com'].includes(host) && parts[0]) return { url: `https://${host}/${parts[0]}/`, platform: 'TikTok', type: 'Vídeo', label: 'TikTok' };
    const match = url.pathname.match(/^\/@([^/]+)\/video\/(\d+)/);
    return match ? { url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`, platform: 'TikTok', type: 'Vídeo', label: 'TikTok' } : null;
  }
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) {
    let id = host === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : null;
    if (!id || !/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
    return { url: `https://www.youtube.com/watch?v=${id}`, platform: 'YouTube', type: 'Vídeo', label: 'YouTube' };
  }
  if (/(^|\.)(twitter\.com|x\.com)$/.test(host)) {
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    return match ? { url: `https://x.com/${match[1]}/status/${match[2]}`, platform: 'X', type: 'Vídeo', label: 'X' } : null;
  }
  if (/(^|\.)(facebook\.com|fb\.watch)$/.test(host)) {
    const valid = host === 'fb.watch' ? parts[0] : parts.includes('reel') || parts.includes('videos') || url.pathname === '/watch/' && url.searchParams.has('v');
    return valid ? { url: url.href, platform: 'Facebook', type: 'Vídeo', label: 'Facebook' } : null;
  }
  if (/(^|\.)vimeo\.com$/.test(host)) {
    const id = parts.find(part => /^\d+$/.test(part));
    return id ? { url: `https://vimeo.com/${id}`, platform: 'Vimeo', type: 'Vídeo', label: 'Vimeo' } : null;
  }
  return null;
}
function analyzeLinks(input) {
  const text = Array.isArray(input) ? input.join('\n') : String(input || '');
  const candidates = [...new Set(text.match(/https?:\/\/[^\s<>\[\]()"'\\]+/gi) || [])];
  const links = [];
  const normalized = new Set();
  let ignoredCount = 0;
  for (const candidate of candidates) {
    const item = normalizeVideoLink(candidate);
    if (!item) { ignoredCount++; continue; }
    if (normalized.has(item.url)) continue;
    normalized.add(item.url);
    links.push(item);
  }
  if (links.length > 200) throw new Error('Use no máximo 200 links de vídeo por vez.');
  return { links, ignoredCount, totalFound: candidates.length };
}
function parseLinks(input) {
  const analysis = analyzeLinks(input);
  if (!analysis.links.length) throw new Error('Nenhum link direto de vídeo ou Reel foi reconhecido.');
  return analysis.links;
}

class VideoDownloader {
  constructor({ executable, onProgress = () => {} }) {
    this.executable = executable;
    this.onProgress = onProgress;
    this.running = false;
    this.cancelled = false;
    this.child = null;
  }
  cancel() {
    if (!this.running) return false;
    this.cancelled = true;
    this.child?.kill();
    return true;
  }
  async downloadOne(item, outputDir, index, total) {
    const args = [
      '--no-playlist', '--no-color', '--newline', '--windows-filenames', '--trim-filenames', '180', '--no-mtime',
      '--format', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4', '--remux-video', 'mp4',
      '--paths', outputDir, '--output', '%(uploader)s_%(id)s_%(title).100s.%(ext)s',
      '--progress-template', 'download:studio-progress:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print', 'after_move:studio-file:%(filepath)s', item.url
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      let stderr = '';
      let pending = '';
      let file = null;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        pending += chunk;
        const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('studio-file:')) file = line.slice('studio-file:'.length).trim();
          const match = line.match(/^studio-progress:\s*([\d.]+)%\|([^|]*)\|([^|]*)/);
          if (match) this.onProgress({ status: 'running', index, total, url: item.url, platform: item.label || item.platform, filePercent: Number(match[1]), speed: match[2].trim(), eta: match[3].trim(), percent: ((index - 1) + Number(match[1]) / 100) / total * 100 });
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
      child.on('error', error => reject(new Error(`Não foi possível iniciar o downloader: ${error.message}`)));
      child.on('close', code => {
        this.child = null;
        if (this.cancelled) reject(new Error('Downloads cancelados.'));
        else if (code === 0 && file && fs.existsSync(file)) resolve(path.resolve(file));
        else reject(new Error(stderr.split(/\r?\n/).filter(line => /^ERROR:/.test(line)).at(-1)?.replace(/^ERROR:\s*/, '') || 'O site não entregou um arquivo de vídeo.'));
      });
    });
  }
  async start(input) {
    if (this.running) throw new Error('Já existem downloads em andamento.');
    const links = parseLinks(input?.links);
    if (typeof input?.outputDir !== 'string' || !path.isAbsolute(input.outputDir) || !fs.existsSync(input.outputDir) || !fs.statSync(input.outputDir).isDirectory()) throw new Error('Selecione uma pasta de saída válida.');
    if (!fs.existsSync(this.executable)) throw new Error('O componente de download não foi encontrado.');
    this.running = true;
    this.cancelled = false;
    const files = [];
    const failures = [];
    try {
      for (let index = 0; index < links.length; index++) {
        if (this.cancelled) throw new Error('Downloads cancelados.');
        const item = links[index];
        this.onProgress({ status: 'starting', index: index + 1, total: links.length, url: item.url, platform: item.label || item.platform, percent: index / links.length * 100 });
        try {
          const file = await this.downloadOne(item, input.outputDir, index + 1, links.length);
          files.push(file);
          this.onProgress({ status: 'file-complete', index: index + 1, total: links.length, url: item.url, platform: item.platform, file, percent: (index + 1) / links.length * 100 });
        } catch (error) {
          if (this.cancelled) throw error;
          failures.push({ url: item.url, platform: item.platform, error: error.message });
          this.onProgress({ status: 'file-error', index: index + 1, total: links.length, url: item.url, platform: item.platform, error: error.message, percent: (index + 1) / links.length * 100 });
        }
      }
      this.onProgress({ status: 'completed', total: links.length, files, failures, percent: 100 });
      return { files, failures };
    } finally {
      this.running = false;
      this.child = null;
    }
  }
}

module.exports = { VideoDownloader, parseLinks, analyzeLinks, normalizeVideoLink, identifyPlatform };
