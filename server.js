const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobe = require('ffprobe-static');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobe.path);

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const id = randomUUID();
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed'));
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const jobs = new Map();
const compressions = new Map();

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const jobId = path.basename(req.file.filename, path.extname(req.file.filename));
  const inputPath = req.file.path;

  ffmpeg.ffprobe(inputPath, (err, data) => {
    if (err) {
      fs.unlink(inputPath, () => {});
      return res.status(500).json({ error: 'Could not read video metadata' });
    }
    const v = data.streams.find((s) => s.codec_type === 'video');
    const a = data.streams.find((s) => s.codec_type === 'audio');
    let fps = null;
    if (v && v.r_frame_rate) {
      const [n, d] = v.r_frame_rate.split('/').map(Number);
      fps = d ? n / d : n;
    }
    const metadata = {
      filename: req.file.originalname,
      size: req.file.size,
      duration: parseFloat(data.format.duration) || 0,
      bitrate: parseInt(data.format.bit_rate) || 0,
      width: v?.width || 0,
      height: v?.height || 0,
      videoCodec: v?.codec_name || 'unknown',
      audioCodec: a?.codec_name || null,
      fps: fps ? Math.round(fps * 100) / 100 : null,
    };
    jobs.set(jobId, { inputPath, metadata, originalName: req.file.originalname });
    res.json({ jobId, metadata });
  });
});

function audioBitrateKbps(mode) {
  if (mode === 'remove') return 0;
  if (mode === '64k') return 64;
  if (mode === '128k') return 128;
  if (mode === '192k') return 192;
  return 128;
}

app.post('/api/compress', (req, res) => {
  const { jobId, method, value, codec, resolution, audio, preset } = req.body;
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const compressId = randomUUID();
  const outputExt = codec === 'vp9' ? '.webm' : '.mp4';
  const outputPath = path.join(OUTPUT_DIR, `${compressId}${outputExt}`);

  const codecMap = { h264: 'libx264', h265: 'libx265', vp9: 'libvpx-vp9' };
  const vcodec = codecMap[codec] || 'libx264';

  let cmd = ffmpeg(job.inputPath).videoCodec(vcodec);

  const audioKbps = audioBitrateKbps(audio);

  if (method === 'size') {
    const targetMB = parseFloat(value);
    const totalKbps = (targetMB * 8 * 1024) / job.metadata.duration;
    const videoKbps = Math.max(100, totalKbps - audioKbps);
    cmd = cmd.videoBitrate(`${Math.floor(videoKbps)}k`);
  } else if (method === 'percentage') {
    const pct = parseFloat(value) / 100;
    const targetBytes = job.metadata.size * pct;
    const totalKbps = (targetBytes * 8) / job.metadata.duration / 1000;
    const videoKbps = Math.max(100, totalKbps - audioKbps);
    cmd = cmd.videoBitrate(`${Math.floor(videoKbps)}k`);
  } else if (method === 'quality') {
    const crf = parseInt(value);
    cmd = cmd.addOption('-crf', String(crf));
    if (codec === 'vp9') cmd = cmd.addOption('-b:v', '0');
  } else if (method === 'bitrate') {
    cmd = cmd.videoBitrate(`${parseInt(value)}k`);
  }

  if (resolution && resolution !== 'original') {
    const hMap = { '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };
    const h = hMap[resolution];
    if (h) cmd = cmd.size(`?x${h}`).addOption('-vf', `scale=trunc(oh*a/2)*2:${h}`);
  }

  if (audio === 'remove') {
    cmd = cmd.noAudio();
  } else if (audio && audio !== 'keep') {
    cmd = cmd.audioBitrate(audio);
  }

  if (codec !== 'vp9' && preset) {
    cmd = cmd.addOption('-preset', preset);
  }

  cmd = cmd.output(outputPath);

  const entry = {
    status: 'processing',
    progress: 0,
    outputPath,
    originalName: job.originalName,
    originalSize: job.metadata.size,
  };
  compressions.set(compressId, entry);

  cmd.on('progress', (p) => {
    if (typeof p.percent === 'number' && !Number.isNaN(p.percent)) {
      entry.progress = Math.max(0, Math.min(99, p.percent));
    }
  });
  cmd.on('end', () => {
    try {
      const stats = fs.statSync(outputPath);
      entry.outputSize = stats.size;
    } catch (_) {}
    entry.status = 'done';
    entry.progress = 100;
  });
  cmd.on('error', (err) => {
    entry.status = 'error';
    entry.error = err.message;
  });
  cmd.run();

  res.json({ compressId });
});

app.get('/api/progress/:id', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const interval = setInterval(() => {
    const entry = compressions.get(req.params.id);
    if (!entry) {
      send({ status: 'error', error: 'Not found' });
      clearInterval(interval);
      return res.end();
    }
    send({
      status: entry.status,
      progress: entry.progress,
      outputSize: entry.outputSize,
      originalSize: entry.originalSize,
      error: entry.error,
    });
    if (entry.status === 'done' || entry.status === 'error') {
      clearInterval(interval);
      res.end();
    }
  }, 400);

  req.on('close', () => clearInterval(interval));
});

app.get('/api/download/:id', (req, res) => {
  const entry = compressions.get(req.params.id);
  if (!entry || entry.status !== 'done') return res.status(404).send('Not ready');
  const origName = path.parse(entry.originalName).name;
  const ext = path.extname(entry.outputPath);
  res.download(entry.outputPath, `${origName}-keiko${ext}`);
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Keiko Compress  →  http://localhost:${PORT}\n`);
});
