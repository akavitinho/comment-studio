const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MediaProcessor, outputPathFor } = require('./media.cjs');

async function preparePostingVideo(input, cover = null) {
  if (!path.isAbsolute(input) || !fs.existsSync(input) || !fs.statSync(input).isFile() || !/\.(mp4|mov)$/i.test(input)) throw new Error('Arquivo de vídeo não encontrado ou incompatível.');
  if (cover && (!path.isAbsolute(cover) || !fs.existsSync(cover) || !fs.statSync(cover).isFile() || !/\.(jpe?g|png|webp)$/i.test(cover))) throw new Error('A capa configurada para esta conta não existe mais ou é incompatível.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-posting-'));
  const output = outputPathFor(input, directory);
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const processor = new MediaProcessor();
    await processor.processFile({ input, output, cover, coverSeconds: cover ? 0.2 : 0 }, 1, 1);
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('O vídeo preparado está incompleto.');
    return { file: output, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

module.exports = { preparePostingVideo };
