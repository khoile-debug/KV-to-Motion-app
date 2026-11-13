import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import cfg, { visionProvider } from './config.js';
import { ROOT, uid, writeJSON } from './util.js';
import { PIPELINE, REPLAN, UPDATE, pdir, projectsDir, loadProject, saveProject, loadTimeline, saveTimeline, stepPlan, stepScript, stepAudio, stepCompose } from './pipeline.js';
import { renderMp4 } from './render.js';
import { IN_PRESETS, LOOP_PRESETS, EASES, FONTS, LOGO_SAFE_IN } from './plan/presets.js';
import { OUTPUT_FORMATS } from './compose.js';
import { listMusic, MUSIC_DIR } from './audio/music.js';
import { providerStatus } from './tts/index.js';
import { ocrAvailable } from './analyze/ocr.js';

fs.mkdirSync(projectsDir(), { recursive: true });
const app = express();
app.use(express.json({ limit: '5mb' }));

// ------------------------------------------------------------------ jobs
const bus = new EventEmitter(); bus.setMaxListeners(100);
const jobs = new Map(); // projectId → job
let renderQueue = Promise.resolve();

function publicJob(j) { const { steps, ...rest } = j; return { ...rest, steps: steps.map(({ fn, when, ...s }) => s) }; }
function emit(j) { bus.emit(j.projectId, publicJob(j)); }

async function runJob(projectId, type, steps, { startAt = 0, extra } = {}) {
  const j = { id: uid(), projectId, type, status: 'running', progress: 0, error: null, log: [], startedAt: Date.now(),
    steps: steps.map((s) => ({ ...s, status: 'pending' })), result: null };
  jobs.set(projectId, j);
  const log = (m) => { j.log.push({ t: Date.now(), m }); if (j.log.length > 200) j.log.shift(); emit(j); };
  const p = loadProject(projectId);
  p.status = type === 'render' ? p.status : 'processing'; p.lastJob = { type, startAt }; saveProject(p);
  emit(j);
  for (let i = 0; i < j.steps.length; i++) {
    const s = j.steps[i];
    if (i < startAt) { s.status = 'done'; continue; }
    if (s.when && !s.when(p)) { s.status = 'skipped'; continue; }
    s.status = 'running'; const t0 = Date.now(); emit(j);
    try {
      const r = await s.fn(p, log, (pct, code) => { j.progress = pct; s.detail = code; emit(j); }, extra);
      if (r && type === 'render') j.result = r;
      s.status = 'done'; s.ms = Date.now() - t0;
      saveProject(p);
    } catch (e) {
      s.status = 'error'; j.status = 'error'; j.error = e.message; j.failedStep = i;
      console.error(`[${projectId}] ${s.key}:`, e);
      p.status = type === 'render' ? p.status : (p.status === 'processing' && !loadTimeline(projectId) ? 'error' : 'ready');
      p.lastError = { type, step: s.key, stepIndex: i, message: e.message, at: Date.now() }; saveProject(p);
      emit(j); return j;
    }
    j.progress = Math.round(((i + 1) / j.steps.length) * 100); emit(j);
  }
  j.status = 'done'; j.finishedAt = Date.now();
  if (type !== 'render') p.status = 'ready';
  if (type === 'render') { p.renders = [{ ...j.result, at: Date.now() }, ...(p.renders || [])].slice(0, 20); }
  p.lastError = null; saveProject(p); emit(j);
  return j;
}

const RENDER_STEPS = [{ key: 'render', label: 'Render MP4 (HyperFrames)', fn: (p, log, progress) => renderMp4(p, { log, progress }) }];
const STEPSETS = { create: PIPELINE, replan: REPLAN, update: UPDATE, render: RENDER_STEPS,
  voice: [{ key: 'script', label: 'Viết lại lời thoại', fn: stepScript }, ...UPDATE] };

function startJob(id, type, opts = {}) {
  const cur = jobs.get(id);
  if (cur?.status === 'running') { const e = new Error('Dự án đang xử lý, vui lòng đợi.'); e.status = 409; throw e; }
  if (type === 'render') {
    // one render at a time (Chrome + FFmpeg are heavy)
    const placeholder = { id: uid(), projectId: id, type, status: 'running', progress: 0, steps: RENDER_STEPS.map((s) => ({ ...s, status: 'queued' })), log: [{ t: Date.now(), m: 'Đang chờ lượt render…' }] };
    jobs.set(id, placeholder); emit(placeholder);
    renderQueue = renderQueue.then(() => runJob(id, type, STEPSETS.render)).catch(() => {});
    return;
  }
  runJob(id, type, STEPSETS[type], opts).catch((e) => console.error(e));
}

// ------------------------------------------------------------------ uploads
const upload = multer({ dest: path.join(cfg.dataDir, 'tmp'), limits: { fileSize: 200 * 1024 * 1024 } });
const IMG = /\.(jpe?g|png|webp)$/i, VID = /\.(mp4|gif|mov|webm)$/i;
const LAYER_FIELDS = ['background', 'subject', 'logo', 'text', 'cta', 'extra'];

function moveUpload(f, dir, name) {
  const ext = path.extname(f.originalname).toLowerCase() || '.bin';
  const rel = `input/${name}${ext}`;
  fs.mkdirSync(path.join(dir, 'input'), { recursive: true });
  fs.renameSync(f.path, path.join(dir, rel));
  return rel;
}

app.post('/api/projects', upload.fields([{ name: 'kv', maxCount: 1 }, { name: 'template', maxCount: 1 }, ...LAYER_FIELDS.map((n) => ({ name: n, maxCount: n === 'extra' ? 4 : 1 }))]), (req, res) => {
  try {
    const files = req.files || {};
    const id = uid();
    const dir = pdir(id);
    fs.mkdirSync(dir, { recursive: true });
    const inputs = { kv: null, layers: [], template: null };
    if (files.kv?.[0]) { if (!IMG.test(files.kv[0].originalname)) throw new Error('KV phải là JPG, PNG hoặc WebP'); inputs.kv = moveUpload(files.kv[0], dir, 'kv'); }
    for (const role of LAYER_FIELDS) for (const [i, f] of (files[role] || []).entries()) {
      if (!IMG.test(f.originalname)) throw new Error(`Lớp ${role} phải là ảnh PNG/WebP/JPG`);
      inputs.layers.push({ role, file: moveUpload(f, dir, `layer_${role}${i || ''}`) });
    }
    if (files.template?.[0]) { if (!VID.test(files.template[0].originalname)) throw new Error('Video mẫu phải là MP4 hoặc GIF'); inputs.template = moveUpload(files.template[0], dir, 'template'); }
    if (!inputs.kv && !inputs.layers.length) throw new Error('Hãy tải KV (ảnh phẳng) hoặc ít nhất một lớp.');
    let brief = {};
    try { brief = JSON.parse(req.body.brief || '{}'); } catch { /* ignore */ }
    const name = (req.body.name || files.kv?.[0]?.originalname || files.background?.[0]?.originalname || 'KV').replace(/\.[^.]+$/, '');
    const p = { id, name, createdAt: Date.now(), inputs, brief, status: 'processing', durationHint: Number(req.body.duration) || null };
    saveProject(p);
    startJob(id, 'create');
    res.json({ id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// add/replace layers on an existing project (e.g. layers the template needs), then re-plan
app.post('/api/projects/:id/layers', upload.fields(LAYER_FIELDS.map((n) => ({ name: n, maxCount: 1 }))), (req, res) => {
  try {
    const p = loadProject(req.params.id); if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
    const dir = pdir(p.id);
    for (const role of LAYER_FIELDS) for (const f of req.files?.[role] || []) {
      p.inputs.layers = (p.inputs.layers || []).filter((l) => l.role !== role);
      p.inputs.layers.push({ role, file: moveUpload(f, dir, `layer_${role}_${Date.now()}`) });
    }
    // keep the flat KV as visual reference for analysis; if a background layer is missing use the KV as background
    if (p.inputs.kv && !p.inputs.layers.some((l) => l.role === 'background')) p.inputs.layers.unshift({ role: 'background', file: p.inputs.kv });
    saveProject(p);
    fs.rmSync(path.join(dir, 'timeline.json'), { force: true });
    startJob(p.id, 'replan');
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

app.get('/api/projects', (req, res) => {
  const list = fs.readdirSync(projectsDir()).map((id) => loadProject(id)).filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, status: p.status, mode: p.mode, hasTemplate: !!p.inputs?.template, renders: (p.renders || []).length }));
  res.json(list);
});

app.get('/api/projects/:id', (req, res) => {
  const p = loadProject(req.params.id); if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const j = jobs.get(p.id);
  res.json({ project: p, timeline: loadTimeline(p.id), job: j ? publicJob(j) : null });
});

app.get('/api/projects/:id/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (j) => res.write(`data: ${JSON.stringify(j)}\n\n`);
  const j = jobs.get(req.params.id); if (j) send(publicJob(j));
  bus.on(req.params.id, send);
  const ka = setInterval(() => res.write(': ka\n\n'), 15000);
  req.on('close', () => { bus.off(req.params.id, send); clearInterval(ka); });
});

app.post('/api/projects/:id/retry', (req, res) => {
  try {
    const p = loadProject(req.params.id); if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
    const j = jobs.get(p.id);
    const type = j?.type || p.lastError?.type || 'create';
    const startAt = j?.status === 'error' ? j.failedStep : (p.lastError?.stepIndex ?? 0);
    startJob(p.id, type, { startAt: type === 'render' ? 0 : startAt });
    res.json({ ok: true, type, startAt });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// Save an edited timeline → TTS (only changed lines) + re-mix + rebuild composition
app.put('/api/projects/:id/timeline', (req, res) => {
  try {
    const p = loadProject(req.params.id); if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
    const tl = req.body?.timeline;
    if (!tl?.layers || !tl.canvas || !(tl.duration > 0)) throw new Error('Timeline không hợp lệ');
    tl.duration = Math.max(2, Math.min(60, Number(tl.duration)));
    // approved content guard: locked layers keep their source image
    const prev = loadTimeline(p.id);
    for (const L of tl.layers) {
      const old = prev?.layers.find((x) => x.id === L.id);
      if (old?.locked) { L.src = old.src; L.type = old.type; L.region = old.region; L.srcBox = old.srcBox; L.locked = true; if (old.role === 'logo') L.box = { ...L.box, h: L.box.w * (old.box.h / old.box.w) }; }
    }
    saveTimeline(p.id, tl);
    startJob(p.id, req.query.rewriteScript ? 'voice' : 'update');
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// Re-run the automatic proposal (e.g. after changing duration or brief)
app.post('/api/projects/:id/replan', (req, res) => {
  try {
    const p = loadProject(req.params.id); if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
    if (req.body?.brief) p.brief = { ...p.brief, ...req.body.brief };
    p.durationHint = Number(req.body?.duration) || null;
    saveProject(p);
    const steps = [
      ...(req.body?.brief ? [REPLAN.find((s) => s.key === 'analyze')] : []),
      { key: 'plan', label: 'Đề xuất chuyển động & timeline', fn: (pp, log) => { fs.rmSync(path.join(pdir(pp.id), 'timeline.json'), { force: true }); stepPlan(pp, log, { durationHint: pp.durationHint }); } },
      { key: 'script', label: 'Viết lời thoại', fn: stepScript },
      { key: 'audio', label: 'Giọng đọc & mix', fn: (pp, log) => stepAudio(pp, log, { allowExtend: !pp.durationHint }) },
      { key: 'compose', label: 'Dựng preview', fn: stepCompose },
    ];
    if (jobs.get(p.id)?.status === 'running') return res.status(409).json({ error: 'Dự án đang xử lý' });
    runJob(p.id, 'replan-auto', steps).catch(console.error);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/projects/:id/render', (req, res) => {
  try {
    const p = loadProject(req.params.id); if (!p) return res.status(404).json({ error: 'Không tìm thấy dự án' });
    startJob(p.id, 'render');
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

app.delete('/api/projects/:id', (req, res) => {
  if (jobs.get(req.params.id)?.status === 'running') return res.status(409).json({ error: 'Dự án đang xử lý' });
  fs.rmSync(pdir(req.params.id), { recursive: true, force: true }); jobs.delete(req.params.id);
  res.json({ ok: true });
});

app.get('/api/config', async (req, res) => {
  res.json({
    vision: { provider: visionProvider(), model: cfg.vision.model },
    ocr: await ocrAvailable(),
    tts: { default: cfg.tts.provider, defaultVoice: cfg.tts.voice, providers: await providerStatus() },
    music: listMusic(),
    presets: { in: IN_PRESETS, loop: LOOP_PRESETS, eases: EASES, logoSafe: LOGO_SAFE_IN },
    fonts: Object.keys(FONTS),
    outputFormats: OUTPUT_FORMATS,
    defaults: cfg.defaults,
  });
});

// static
app.use('/projects', express.static(projectsDir(), { fallthrough: false, setHeaders: (res) => res.set('Cache-Control', 'no-store') }));
app.use('/music', express.static(MUSIC_DIR));
app.use('/fonts', express.static(path.join(ROOT, 'node_modules/@fontsource')));
app.use(express.static(path.join(ROOT, 'public')));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });

app.listen(cfg.port, () => {
  console.log(`KV Motion đang chạy: http://localhost:${cfg.port}`);
  console.log(`Phân tích ảnh: ${visionProvider()} · TTS mặc định: ${cfg.tts.provider} · dữ liệu: ${cfg.dataDir}`);
});

