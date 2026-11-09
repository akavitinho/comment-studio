const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { MediaProcessor, buildArgs, buildImageArgs, generatePerturbations, generateImagePerturbations, perturbFilter, outputPathFor, imageOutputPathFor, IMAGE_EXTENSIONS } = require('../src/media.cjs');
const { validateReel, isVerticalReel } = require('../src/posting-media.cjs');

test('accepts legacy vertical files with harmless pixel rounding', () => {
  assert.equal(isVerticalReel(1080, 1920), true);
  assert.equal(isVerticalReel(604, 1074), true);
  assert.equal(isVerticalReel(540, 960), true);
  assert.equal(isVerticalReel(1920, 1080), false);
});

test('media export removes metadata and prepends a cover without shell commands', () => {
  const args = buildArgs({ input: 'C:\\videos\\one.mp4', output: 'C:\\ready\\one.mp4', cover: 'C:\\covers\\cover.jpg', coverSeconds: 0.5, width: 1080, height: 1920, frameRate: 30, hasAudio: true });
  assert.equal(args.includes('-map_metadata'), true);
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  assert.equal(args.includes('-map_chapters'), true);
  assert.match(args[args.indexOf('-filter_complex') + 1], /concat=n=2:v=1:a=0/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /adelay=500:all=1/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /crop=iw-\d+:ih-\d+:\d+:\d+/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /eq=brightness=/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /hue=h=/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /atempo=/);
  assert.equal(args.at(-1), 'C:\\ready\\one.mp4');
  assert.equal(args.includes('cmd.exe'), false);
});

test('perturbations generate unique random values per call', () => {
  const a = generatePerturbations(1920, 1080);
  const b = generatePerturbations(1920, 1080);
  assert.equal(typeof a.cropTop, 'number');
  assert.equal(a.cropTop >= 1 && a.cropTop <= 6, true);
  assert.equal(a.speed >= 0.99 && a.speed <= 1.01, true);
  assert.equal(a.crf >= 18 && a.crf <= 22, true);
  assert.equal(a.gop >= 200 && a.gop <= 350, true);
  assert.equal(a.brightness >= -0.03 && a.brightness <= 0.03, true);
  assert.equal(a.hue >= -3 && a.hue <= 3, true);
  const keysA = JSON.stringify(a);
  const keysB = JSON.stringify(b);
  assert.notEqual(keysA, keysB, 'two runs should produce different values');
});

test('perturbations scale down for small resolutions', () => {
  const p = generatePerturbations(360, 640);
  assert.equal(p.cropTop >= 1 && p.cropTop <= 3, true);
  assert.equal(p.cropLeft >= 1 && p.cropLeft <= 3, true);
  const large = generatePerturbations(1920, 1080);
  assert.equal(large.cropTop >= 1 && large.cropTop <= 6, true);
});

test('non-cover args include video and audio perturbation filters', () => {
  const args = buildArgs({ input: 'C:\\videos\\clip.mp4', output: 'C:\\ready\\clip.mp4', width: 1920, height: 1080, frameRate: 30, hasAudio: true });
  const vfIndex = args.indexOf('-vf');
  assert.notEqual(vfIndex, -1);
  assert.match(args[vfIndex + 1], /crop=iw-\d+:ih-\d+:\d+:\d+,scale=1080:1920:force_original_aspect_ratio=decrease/);
  assert.match(args[vfIndex + 1], /pad=1080:1920:\(ow-iw\)\/2:\(oh-ih\)\/2,setsar=1/);
  assert.match(args[vfIndex + 1], /eq=brightness=/);
  assert.match(args[vfIndex + 1], /setpts=PTS\//);
  const afIndex = args.indexOf('-af');
  assert.notEqual(afIndex, -1);
  assert.match(args[afIndex + 1], /^atempo=[\d.]+$/);
  assert.equal(args.includes('-g'), true, 'randomized GOP');
  assert.equal(args[args.indexOf('-maxrate') + 1], '23M');
  assert.equal(args[args.indexOf('-ar') + 1], '48000');
  assert.equal(args[args.indexOf('-b:a') + 1], '112k');
});

test('media output chooses a distinct random filename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-media-'));
  try {
    const first = outputPathFor(path.join(dir, 'clip.mov'), dir);
    assert.match(path.basename(first), /^clip_preparado_[0-9a-f]{10}\.mp4$/);
    fs.writeFileSync(first, 'existing');
    assert.notEqual(outputPathFor(path.join(dir, 'clip.mov'), dir), first);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('originais são removidos só após concluir todo o lote', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-media-batch-'));
  const first = path.join(dir, 'a.mp4'), second = path.join(dir, 'b.mp4');
  fs.writeFileSync(first, 'a'); fs.writeFileSync(second, 'b');
  class Processor extends MediaProcessor {
    async processFile({ output }, index) { if (index === 2 && this.fail) throw new Error('Falha simulada'); fs.writeFileSync(output, 'prepared'); }
  }
  try {
    const processor = new Processor(); processor.fail = true;
    await assert.rejects(processor.start({ videos: [first, second], outputDir: dir }), /Falha simulada/);
    assert.equal(fs.existsSync(first) && fs.existsSync(second), true);
    processor.fail = false;
    const result = await processor.start({ videos: [first, second], outputDir: dir });
    assert.equal(result.outputs.every(output => fs.existsSync(output)), true);
    assert.equal(fs.existsSync(first) || fs.existsSync(second), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0 && spawnSync('ffprobe', ['-version'], { windowsHide: true }).status === 0;
test('processes a real video with cover, synchronized audio and scrubbed personal metadata', { skip: !ffmpegAvailable }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-ffmpeg-'));
  try {
    const input = path.join(dir, 'source.mp4');
    const cover = path.join(dir, 'cover.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#d6a23a:s=320x568', '-frames:v', '1', '-update', '1', cover], { windowsHide: true });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#315fa8:s=320x568:d=4', '-f', 'lavfi', '-i', 'sine=frequency=800:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'title=Private title', '-metadata', 'comment=Private comment', '-metadata', 'creation_time=2020-01-01T00:00:00Z', input], { windowsHide: true });
    await assert.rejects(validateReel(input, 'Legenda'), /incompatível/);
    const processor = new MediaProcessor();
    const result = await processor.start({ videos: [input], cover, outputDir: dir, coverSeconds: 0.2 });
    assert.equal(result.outputs.length, 1);
    assert.equal(fs.existsSync(input), false);
    assert.equal(fs.existsSync(cover), true);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,sample_rate,bit_rate,width,height:format=duration:format_tags=title,comment,creation_time,description,author,artist', '-of', 'json', result.outputs[0]], { encoding: 'utf8', windowsHide: true }));
    assert.equal(Number(probe.format.duration) >= 1.3, true);
    assert.equal(probe.format.tags?.title, undefined);
    assert.equal(probe.format.tags?.comment, undefined);
    assert.equal(probe.format.tags?.creation_time, undefined);
    assert.equal(probe.format.tags?.description, undefined);
    assert.equal(probe.format.tags?.author, undefined);
    assert.equal(probe.format.tags?.artist, undefined);
    assert.equal(probe.streams.find(stream => stream.codec_type === 'audio')?.sample_rate, '48000');
    assert.ok(Number(probe.streams.find(stream => stream.codec_type === 'audio')?.bit_rate) <= 128000);
    assert.deepEqual([probe.streams.find(stream => stream.codec_type === 'video')?.width, probe.streams.find(stream => stream.codec_type === 'video')?.height], [1080, 1920]);
    const reel = await validateReel(result.outputs[0], 'Legenda');
    assert.ok(reel.duration >= 4);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('converts a horizontal video without a cover to a vertical 9:16 Reel', { skip: !ffmpegAvailable }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-reel-ratio-'));
  try {
    const input = path.join(dir, 'horizontal.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#315fa8:s=320x180:d=4', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input], { windowsHide: true });
    await assert.rejects(validateReel(input, ''), /9:16/);
    const result = await new MediaProcessor().start({ videos: [input], outputDir: dir });
    const reel = await validateReel(result.outputs[0], '');
    assert.deepEqual([reel.width, reel.height], [1080, 1920]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


// ── Image metadata cleaning tests ─────────────────────────────────────────────

test('buildImageArgs strips all metadata tags including EXIF, GPS, camera, and XMP', () => {
  const args = buildImageArgs({ input: 'C:\\photos\\selfie.jpg', output: 'C:\\ready\\selfie.jpg', perturbations: { brightness: 0.01, contrast: 1.01, saturation: 0.99, hue: 1 } });
  assert.equal(args.includes('-map_metadata'), true);
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  assert.equal(args.includes('-fflags'), true, 'should have -fflags for bitexact');
  assert.equal(args[args.indexOf('-fflags') + 1], '+bitexact');
  // Core metadata tags
  for (const tag of ['title=', 'comment=', 'creation_time=', 'description=', 'author=', 'artist=', 'date=', 'software=', 'copyright=']) {
    assert.equal(args.includes(tag), true, `should blank tag: ${tag}`);
  }
  // Camera and device tags
  for (const tag of ['make=', 'model=', 'LensMake=', 'LensModel=', 'BodySerialNumber=', 'LensSerialNumber=', 'CameraOwnerName=']) {
    assert.equal(args.includes(tag), true, `should blank camera tag: ${tag}`);
  }
  // GPS tags
  for (const tag of ['location=', 'GPS=', 'GPSLatitude=', 'GPSLongitude=']) {
    assert.equal(args.includes(tag), true, `should blank GPS tag: ${tag}`);
  }
  // EXIF/XMP tags
  for (const tag of ['DateTimeOriginal=', 'DateTimeDigitized=', 'DateTime=', 'ImageDescription=', 'UserComment=', 'ExifVersion=']) {
    assert.equal(args.includes(tag), true, `should blank EXIF tag: ${tag}`);
  }
  // Windows-specific tags
  for (const tag of ['XPComment=', 'XPAuthor=', 'XPTitle=', 'XPKeywords=']) {
    assert.equal(args.includes(tag), true, `should blank Windows tag: ${tag}`);
  }
  // JPEG output
  assert.equal(args.includes('mjpeg'), true, 'should re-encode as JPEG');
  assert.equal(args.at(-1), 'C:\\ready\\selfie.jpg');
});

test('buildImageArgs uses PNG codec for PNG output', () => {
  const args = buildImageArgs({ input: 'C:\\photos\\logo.png', output: 'C:\\ready\\logo.png' });
  assert.equal(args.includes('png'), true, 'should use PNG codec');
  assert.equal(args.includes('-pred'), true, 'should use PNG pred filter');
  assert.equal(args.includes('mjpeg'), false, 'should not use JPEG codec for PNG');
});

test('buildImageArgs applies subtle perturbation filters', () => {
  const args = buildImageArgs({ input: 'C:\\photos\\test.jpg', output: 'C:\\ready\\test.jpg' });
  const vfIndex = args.indexOf('-vf');
  assert.notEqual(vfIndex, -1);
  assert.match(args[vfIndex + 1], /eq=brightness=/);
  assert.match(args[vfIndex + 1], /contrast=/);
  assert.match(args[vfIndex + 1], /saturation=/);
  assert.match(args[vfIndex + 1], /hue=h=/);
});

test('generateImagePerturbations produces unique subtle values', () => {
  const a = generateImagePerturbations();
  const b = generateImagePerturbations();
  assert.equal(a.brightness >= -0.02 && a.brightness <= 0.02, true);
  assert.equal(a.contrast >= 0.98 && a.contrast <= 1.02, true);
  assert.equal(a.saturation >= 0.97 && a.saturation <= 1.03, true);
  assert.equal(a.hue >= -2 && a.hue <= 2, true);
  assert.notEqual(JSON.stringify(a), JSON.stringify(b), 'two runs should differ');
});

test('imageOutputPathFor preserves PNG extension and uses _limpo_ naming', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-img-'));
  try {
    const png = imageOutputPathFor(path.join(dir, 'screenshot.png'), dir);
    assert.match(path.basename(png), /^screenshot_limpo_[0-9a-f]{10}\.png$/);
    const jpg = imageOutputPathFor(path.join(dir, 'photo.jpg'), dir);
    assert.match(path.basename(jpg), /^photo_limpo_[0-9a-f]{10}\.jpg$/);
    const jpeg = imageOutputPathFor(path.join(dir, 'camera.jpeg'), dir);
    assert.match(path.basename(jpeg), /^camera_limpo_[0-9a-f]{10}\.jpg$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('IMAGE_EXTENSIONS includes common image formats', () => {
  assert.equal(IMAGE_EXTENSIONS.has('.jpg'), true);
  assert.equal(IMAGE_EXTENSIONS.has('.jpeg'), true);
  assert.equal(IMAGE_EXTENSIONS.has('.png'), true);
  assert.equal(IMAGE_EXTENSIONS.has('.webp'), true);
  assert.equal(IMAGE_EXTENSIONS.has('.mp4'), false);
});

test('start accepts images-only batch without videos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-img-batch-'));
  const img = path.join(dir, 'test.jpg');
  fs.writeFileSync(img, 'fake');
  class FakeProcessor extends MediaProcessor {
    async processImage({ output }) { fs.writeFileSync(output, 'cleaned'); }
  }
  try {
    const result = await new FakeProcessor().start({ images: [img], outputDir: dir });
    assert.equal(result.outputs.length, 1);
    assert.equal(fs.existsSync(img), false, 'original should be deleted');
    assert.equal(result.outputs.every(o => fs.existsSync(o)), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('start processes mixed videos and images in single batch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-mixed-'));
  const vid = path.join(dir, 'clip.mp4');
  const img = path.join(dir, 'photo.png');
  fs.writeFileSync(vid, 'video'); fs.writeFileSync(img, 'image');
  const progress = [];
  class FakeProcessor extends MediaProcessor {
    async processFile({ output }) { fs.writeFileSync(output, 'v'); }
    async processImage({ output }) { fs.writeFileSync(output, 'i'); }
  }
  try {
    const processor = new FakeProcessor({ onProgress: p => progress.push(p) });
    const result = await processor.start({ videos: [vid], images: [img], outputDir: dir });
    assert.equal(result.outputs.length, 2);
    assert.equal(fs.existsSync(vid), false);
    assert.equal(fs.existsSync(img), false);
    const completions = progress.filter(p => p.status === 'file-complete');
    assert.equal(completions.length, 2);
    assert.equal(completions[0].total, 2);
    assert.equal(completions[1].total, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('processes a real JPEG image and strips all personal metadata', { skip: !ffmpegAvailable }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-img-ffmpeg-'));
  try {
    const input = path.join(dir, 'photo.jpg');
    // Create a JPEG with metadata using ffmpeg
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#e83a4f:s=640x480', '-frames:v', '1',
      '-metadata', 'title=Private Photo', '-metadata', 'comment=Secret comment',
      '-metadata', 'creation_time=2020-06-15T12:30:00Z', '-metadata', 'author=John Doe',
      '-metadata', 'description=My vacation photo', '-metadata', 'artist=Camera User',
      '-metadata', 'software=Adobe Photoshop', '-metadata', 'copyright=All Rights Reserved',
      '-metadata', 'make=Canon', '-metadata', 'model=EOS R5',
      input], { windowsHide: true });
    assert.equal(fs.existsSync(input), true);
    const processor = new MediaProcessor();
    const result = await processor.start({ images: [input], outputDir: dir });
    assert.equal(result.outputs.length, 1);
    assert.equal(fs.existsSync(input), false, 'original deleted');
    const output = result.outputs[0];
    assert.match(path.basename(output), /_limpo_/);
    assert.equal(path.extname(output), '.jpg');
    // Verify all metadata is stripped
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', output], { encoding: 'utf8', windowsHide: true }));
    const tags = probe.format?.tags || {};
    assert.equal(tags.title, undefined, 'title should be stripped');
    assert.equal(tags.comment, undefined, 'comment should be stripped');
    assert.equal(tags.creation_time, undefined, 'creation_time should be stripped');
    assert.equal(tags.author, undefined, 'author should be stripped');
    assert.equal(tags.description, undefined, 'description should be stripped');
    assert.equal(tags.artist, undefined, 'artist should be stripped');
    assert.equal(tags.software, undefined, 'software should be stripped');
    assert.equal(tags.copyright, undefined, 'copyright should be stripped');
    assert.equal(tags.make, undefined, 'camera make should be stripped');
    assert.equal(tags.model, undefined, 'camera model should be stripped');
    // Verify file is valid
    assert.equal(fs.statSync(output).size > 0, true, 'output should not be empty');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('processes a real PNG image and strips metadata while keeping PNG format', { skip: !ffmpegAvailable }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-studio-png-ffmpeg-'));
  try {
    const input = path.join(dir, 'screenshot.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#3a7fe8:s=800x600', '-frames:v', '1',
      '-metadata', 'title=Screen Capture', '-metadata', 'comment=Desktop screenshot',
      '-metadata', 'software=Snipping Tool', '-metadata', 'creation_time=2024-01-01T00:00:00Z',
      input], { windowsHide: true });
    const processor = new MediaProcessor();
    const result = await processor.start({ images: [input], outputDir: dir });
    assert.equal(result.outputs.length, 1);
    assert.equal(path.extname(result.outputs[0]), '.png', 'PNG should stay PNG');
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', result.outputs[0]], { encoding: 'utf8', windowsHide: true }));
    const tags = probe.format?.tags || {};
    assert.equal(tags.title, undefined, 'title should be stripped');
    assert.equal(tags.comment, undefined, 'comment should be stripped');
    assert.equal(tags.software, undefined, 'software should be stripped');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
