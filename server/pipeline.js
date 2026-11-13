// Điều phối: ingest → phân tích KV → (phân tích mẫu) → chọn nhạc → lập timeline → lời thoại → TTS + mix → composition.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import cfg, { visionProvider } from './config.js';
import { run, ffprobe, readJSON, writeJSON, hash, round, clamp } from './util.js';
import { analyzeImage, alphaBBox, colorMood } from './analyze/image.js';
import { ocrImage } from './analyze/ocr.js';
import { classify, MOOD_BY_INDUSTRY, scriptSufficiency, detectIndustry } from './analyze/classify.js';
import { claudeAnalyzeKV, claudeAnalyzeTemplate, claudeReady } from './analyze/claude.js';
import { analyzeTemplate } from './analyze/template.js';
import { autoPlan, templatePlan, pickStyle } from './plan/planner.js';
import { selectMusic, listMusic } from './audio/music.js';
import { writeScript } from './audio/script.js';
import { synthesize } from './tts/index.js';
import { alignSegments, buildVoiceTrack, buildMusicTrack } from './audio/mix.js';
import { buildComposition } from './compose.js';

export const projectsDir = () => path.join(cfg.dataDir, 'projects');
export const pdir = (id) => path.join(projectsDir(), id);
export const loadProject = (id) => readJSON(path.join(pdir(id), 'project.json'));
export const saveProject = (p) => writeJSON(path.join(pdir(p.id), 'project.json'), p);
export const loadTimeline = (id) => readJSON(path.join(pdir(id), 'timeline.json'));
export const saveTimeline = (id, tl) => writeJSON(path.join(pdir(id), 'timeline.json'), tl);

const LAYER_ORDER = ['background', 'subject', 'text', 'logo', 'cta', 'extra'];
const ROLE_NAME = { background: 'Nền', subject: 'Chủ thể', text: 'Chữ', logo: 'Logo', cta: 'CTA', extra: 'Lớp thêm' };

/** Canvas: keep the KV aspect ratio; long side ≤1920, short side ≤1080 (even numbers). */
export function canvasFor(w, h) {
  const s = Math.min(1, 1920 / Math.max(w, h), 1080 / Math.min(w, h));
  const even = (v) => Math.max(2, Math.round((v * s) / 2) * 2);
  return { width: even(w), height: even(h), fps: cfg.render.fps || 30 };
}

function defaultBox(role, w, h, C) {
  const W = C.width, H = C.height;
  const fit = (maxW, maxH) => { const s = Math.min(maxW / w, maxH / h); return { w: Math.round(w * s), h: Math.round(h * s) }; };
  if (role === 'logo') { const b = fit(W * 0.28, H * 0.12); return { x: Math.round((W - b.w) / 2), y: Math.round(H * 0.05), ...b }; }
  if (role === 'subject') { const b = fit(W * 0.7, H * 0.6); return { x: Math.round((W - b.w) / 2), y: Math.round(H * 0.25), ...b }; }
  if (role === 'cta') { const b = fit(W * 0.5, H * 0.1); return { x: Math.round((W - b.w) / 2), y: Math.round(H * 0.84), ...b }; }
  if (role === 'background') return { x: 0, y: 0, w: W, h: H };
  const b = fit(W * 0.86, H * 0.4); return { x: Math.round((W - b.w) / 2), y: Math.round(H * 0.5), ...b };
}

// ------------------------------------------------------------------ steps
export async function stepIngest(p, log) {
  const dir = pdir(p.id);
  const A = path.join(dir, 'assets');
  fs.mkdirSync(A, { recursive: true });
  const inp = p.inputs;
  const firstLayer = inp.layers?.find((l) => l.role === 'background') || inp.layers?.[0];
  const refFile = inp.kv ? path.join(dir, inp.kv) : firstLayer ? path.join(dir, firstLayer.file) : null;
  if (!refFile) throw new Error('Chưa có KV: hãy tải KV phẳng hoặc ít nhất một lớp.');
  const ref = await sharp(refFile).metadata();
  const C = canvasFor(ref.width, ref.height);
  p.canvas = C;
  p.mode = inp.layers?.length ? 'layered' : 'flat';
  if (inp.kv) await sharp(path.join(dir, inp.kv)).rotate().resize(C.width, C.height, { fit: 'fill' }).png().toFile(path.join(A, 'kv.png'));

  p.layers = [];
  for (const [i, l] of (inp.layers || []).entries()) {
    const src = path.join(dir, l.file);
    const m = await sharp(src).metadata();
    const sameCanvas = Math.abs(m.width / m.height - C.width / C.height) < 0.02 && m.width >= 0.5 * ref.width;
    const id = `${l.role}${(inp.layers.filter((x) => x.role === l.role).indexOf(l) || '') || ''}`;
    const out = `assets/layer_${id}.png`;
    let box;
    if (sameCanvas) {
      const full = path.join(A, `full_${id}.png`);
      await sharp(src).resize(C.width, C.height, { fit: 'fill' }).ensureAlpha().png().toFile(full);
      const bb = l.role === 'background' ? { x: 0, y: 0, w: C.width, h: C.height } : await alphaBBox(full);
      box = { x: bb.x, y: bb.y, w: bb.w, h: bb.h };
      await sharp(full).extract({ left: box.x, top: box.y, width: Math.min(box.w, C.width - box.x), height: Math.min(box.h, C.height - box.y) }).png().toFile(path.join(dir, out));
    } else {
      // standalone element (e.g. a logo file): trim transparent margins and place by role
      const trimmed = await sharp(src).ensureAlpha().trim({ threshold: 1 }).png().toBuffer().catch(() => sharp(src).png().toBuffer());
      const tm = await sharp(trimmed).metadata();
      await sharp(trimmed).toFile(path.join(dir, out));
      box = defaultBox(l.role, tm.width, tm.height, C);
      log(`Lớp ${l.role} không cùng khổ với KV → đặt mặc định, có thể chỉnh vị trí trong trình sửa.`);
    }
    p.layers.push({ id, type: 'image', role: l.role, name: ROLE_NAME[l.role] || l.role, src: out, box, z: LAYER_ORDER.indexOf(l.role) >= 0 ? LAYER_ORDER.indexOf(l.role) : 5 + i, locked: l.role === 'logo' || l.role === 'text' });
  }
  // composite = what the viewer sees; used for analysis (and as reference)
  const comp = path.join(A, 'composite.png');
  if (inp.kv) fs.copyFileSync(path.join(A, 'kv.png'), comp);
  else {
    const sorted = [...p.layers].sort((a, b) => a.z - b.z);
    await sharp({ create: { width: C.width, height: C.height, channels: 4, background: '#000000ff' } })
      .composite(await Promise.all(sorted.map(async (L) => ({ input: await sharp(path.join(dir, L.src)).resize(Math.round(L.box.w), Math.round(L.box.h), { fit: 'fill' }).toBuffer(), left: Math.round(L.box.x), top: Math.round(L.box.y) }))))
      .png().toFile(comp);
  }
  if (inp.template) {
    const tdir = path.join(dir, 'template'); fs.mkdirSync(tdir, { recursive: true });
    await run('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, inp.template), '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', path.join(tdir, 'template.mp4')]);
    p.templateVideo = 'template/template.mp4';
  }
  log(`Khung hình ${C.width}×${C.height} (giữ tỷ lệ gốc), chế độ ${p.mode === 'flat' ? 'KV phẳng' : `KV có lớp (${p.layers.map((l) => l.role).join(', ')})`}.`);
}

export async function stepAnalyzeKV(p, log) {
  const dir = pdir(p.id);
  const comp = path.join(dir, 'assets/composite.png');
  const stats = await analyzeImage(comp);
  const ocr = await ocrImage(comp, path.join(dir, 'work'));
  log(ocr.available ? `OCR (${ocr.lang}): ${ocr.lines.length} dòng chữ.` : 'Không có OCR (tesseract) — chỉ dựa vào brief.');
  const brief = p.brief || {};
  const cls = classify(ocr.lines, brief, p.canvas);
  let elements = cls.elements.map((e) => ({ ...e, cbox: e.bbox }));
  let facts = { ...cls.facts };
  let industry = cls.industry;
  let moods = [...new Set([...(brief.tone ? brief.tone.toLowerCase().split(/[,\s]+/) : []), ...industry.flatMap((i) => MOOD_BY_INDUSTRY[i] || []), ...colorMood(stats)])];
  let focal = stats.focal, style = null, source = 'heuristic', enough = scriptSufficiency(facts).enough, rationale = '';

  if (visionProvider() === 'claude' && claudeReady()) {
    try {
      const c = await claudeAnalyzeKV(comp, brief, ocr.lines, p.canvas);
      const W = p.canvas.width, H = p.canvas.height;
      elements = c.elements.filter((e) => e.text || ['logo', 'subject'].includes(e.role)).map((e, i) => ({
        id: `c${i}`, role: e.role === 'subheadline' ? 'headline' : e.role, text: e.text, importance: e.importance,
        cbox: { x: Math.round(e.bbox.x * W), y: Math.round(e.bbox.y * H), w: Math.round(e.bbox.w * W), h: Math.round(e.bbox.h * H) },
      }));
      // brief stays authoritative
      facts = Object.fromEntries(Object.entries(c.facts).map(([k, v]) => [k, (cls.facts[k] && brief[{ price: 'offer' }[k] || k]) ? cls.facts[k] : v]));
      industry = [...new Set([...c.industry, ...industry])];
      moods = [...new Set([...c.mood, ...moods])];
      focal = c.focal; style = c.motion_style; enough = c.enough_for_voiceover && scriptSufficiency(facts).enough; rationale = c.rationale; source = 'claude';
      log('Phân tích KV bằng mô hình đọc ảnh (Claude).');
    } catch (e) { log('Không gọi được mô hình đọc ảnh, dùng heuristic: ' + e.message); }
  }
  facts.ctaFromBrief = !!brief.cta;
  style ||= pickStyle(moods);
  p.analysis = { source, stats, ocr: ocr.lines, elements, facts, industry, moods, focal, style, enoughForVO: enough, rationale };
  log(`Ngành: ${industry.join(', ') || 'chưa rõ'} · sắc thái: ${moods.slice(0, 5).join(', ')} · phong cách chuyển động: ${style}.`);
}

export async function stepAnalyzeTemplate(p, log) {
  if (!p.templateVideo) return;
  const dir = pdir(p.id);
  const t = await analyzeTemplate(path.join(dir, p.templateVideo), path.join(dir, 'template'));
  log(`Mẫu ${t.duration}s: ${t.events.length} sự kiện, camera ${t.camera ? 'có' : 'không'}, cắt cảnh ${t.cuts.length}, giữ khung cuối ${t.hold}s${t.perLayer ? ', có chuyển động riêng từng lớp' : ''}.`);
  if (visionProvider() === 'claude' && claudeReady()) {
    try {
      const frames = t.keyframes.map((k) => ({ t: k.t, file: path.join(dir, 'template', k.file) }));
      t.model = await claudeAnalyzeTemplate(frames, t);
      if (t.model.per_layer_motion) t.perLayer = true;
      if (t.model.final_hold > 0) t.hold = Math.max(t.hold, t.model.final_hold);
      log('Đã đối chiếu khung hình tham chiếu bằng mô hình đọc ảnh.');
    } catch (e) { log('Bỏ qua phân tích mẫu bằng mô hình: ' + e.message); }
  }
  p.template = t;
}

export function stepMusic(p, log) {
  const tr = selectMusic(p.analysis.moods, p.template ? 'template' : p.analysis.style,
    p.template ? p.template.events.length / Math.max(1, p.template.duration) : null);
  p.music = tr;
  log(tr ? `Nhạc: "${tr.title}" (${tr.bpm} BPM) — ${tr.reason}.` : 'Thư viện nhạc trống — preview không có nhạc.');
}

export function stepPlan(p, log, { durationHint } = {}) {
  const ctx = {
    canvas: p.canvas, mode: p.mode, kvSrc: p.inputs.kv ? 'assets/kv.png' : 'assets/composite.png', layers: p.layers || [],
    elements: p.analysis.elements, facts: p.analysis.facts, style: p.analysis.style, focal: p.analysis.focal,
    bpm: p.template ? null : p.music?.bpm, durationHint, accent: p.analysis.stats.palette.find((c) => c.share > 0.05 && c.hex !== '#000000')?.hex,
  };
  const plan = p.template ? templatePlan(ctx, p.template) : autoPlan(ctx);
  const prev = loadTimeline(p.id);
  const tl = {
    version: 1,
    canvas: { ...p.canvas, background: p.analysis.stats.edgeColor || '#000000' },
    duration: plan.duration, autoDuration: !durationHint && !p.template, mode: p.mode, source: p.template ? 'template' : 'auto', style: plan.style,
    layers: plan.layers, camera: plan.camera, intro: plan.intro, finalHold: plan.finalHold, transitions: plan.transitions || [],
    anchors: plan.anchors,
    audio: prev?.audio || {
      music: p.music ? { trackId: p.music.id, title: p.music.title, volume: cfg.audio.musicVolume, muted: false } : null,
      voice: { provider: cfg.tts.provider, voice: cfg.tts.voice, speed: cfg.tts.speed, volume: cfg.audio.voiceVolume, muted: false, lines: [] },
      duckDb: cfg.audio.duckDb, fadeOut: cfg.audio.fadeOut,
    },
    notes: plan.notes,
    output: prev?.output || { format: 'original' },
    template: p.template ? { video: p.templateVideo, duration: p.template.duration, mapping: plan.mapping, timeScale: plan.timeScale } : null,
  };
  if (p.template?.perLayer && p.mode === 'flat') tl.notes.unshift({ level: 'warn', text: 'Mẫu có chuyển động riêng từng lớp nhưng KV là ảnh phẳng: preview chỉ dùng hiệu ứng khả thi trên toàn ảnh. Xem danh sách lớp cần bổ sung bên dưới.' });
  saveTimeline(p.id, tl);
  log(`Timeline: ${tl.duration}s, ${tl.layers.length} lớp, ${tl.camera?.keys?.length || 0} keyframe camera.`);
  return tl;
}

export async function stepScript(p, log) {
  const tl = loadTimeline(p.id);
  const res = await writeScript(p.analysis.facts, p.brief, tl.duration, log);
  p.script = { source: res.source, enough: res.enough, issues: res.issues };
  const order = ['intro', 'brand', 'headline', 'product', 'price', 'datetime', 'terms', 'cta'];
  tl.audio.voice.lines = res.lines.map((l, i) => ({ id: `v${i + 1}`, text: l.text, anchor: l.anchor }));
  tl.audio.voice.lines.sort((a, b) => (tl.anchors[a.anchor] ?? order.indexOf(a.anchor)) - (tl.anchors[b.anchor] ?? order.indexOf(b.anchor)));
  if (!res.enough) {
    tl.audio.voice.muted = true;
    tl.notes.push({ level: 'warn', text: 'KV có quá ít thông tin để viết lời thoại chính xác: preview chỉ có nhạc. Nhập lời thoại ở tab Âm thanh rồi bấm "Tạo giọng đọc".' });
  }
  saveTimeline(p.id, tl);
  log(res.enough ? `Lời thoại (${res.source}): ${res.lines.map((l) => l.text).join(' ')}` : 'Không đủ thông tin để viết lời thoại — chỉ dùng nhạc.');
}

/** TTS (cached per line) + alignment + mixing. Used by the pipeline and by every edit. */
export async function stepAudio(p, log, { allowExtend = false } = {}) {
  const dir = pdir(p.id);
  const tl = loadTimeline(p.id);
  const A = tl.audio; const V = A.voice;
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  const lines = (V.lines || []).filter((l) => l.text && l.text.trim());
  const segs = [];
  if (!V.muted || lines.length) {
    for (const l of lines) {
      const h = hash([l.text, V.provider, V.voice, V.speed]);
      const file = `audio/vo_${h}.wav`;
      if (!fs.existsSync(path.join(dir, file))) {
        log(`TTS (${V.provider}/${V.voice}): "${l.text}"`);
        try { l.dur = round(await synthesize({ text: l.text, provider: V.provider, voice: V.voice, speed: V.speed }, path.join(dir, file)), 3); }
        catch (e) { throw new Error(`TTS "${V.provider}" lỗi: ${e.message}`); }
      } else if (l.file !== file || !l.dur) l.dur = round((await ffprobe(path.join(dir, file))).duration, 3);
      l.file = file;
    }
    // anchors: when each piece of info appears on screen (manual "at" wins)
    let fallback = 0.3;
    const want = lines.map((l) => { const s = l.at ?? tl.anchors?.[l.anchor] ?? fallback; fallback = s + l.dur + 0.3; return { start: s, dur: l.dur }; });
    let al = alignSegments(want, tl.duration, A.fadeOut);
    // fixed duration (e.g. following a short template): drop lower-priority lines until the VO fits
    if (al.overflow > 0 && allowExtend && !tl.autoDuration && lines.length > 1) {
      const drop = ['terms', 'body', 'brand', 'datetime', 'headline', 'product', 'custom'];
      const removed = [];
      while (al.overflow > 0 && lines.length > 1) {
        const idx = drop.map((a) => lines.findIndex((l) => l.anchor === a)).find((i) => i >= 0);
        if (idx == null) break;
        removed.push(lines[idx].text); lines.splice(idx, 1); want.splice(idx, 1);
        al = alignSegments(want, tl.duration, A.fadeOut);
      }
      V.lines = V.lines.filter((l) => lines.includes(l) || !l.text?.trim());
      if (removed.length) {
        tl.notes = [...(tl.notes || []), { level: 'info', text: `Đã rút gọn lời thoại cho vừa ${tl.duration}s (bỏ: ${removed.join(' / ')}). Có thể thêm lại ở tab Âm thanh.` }];
        log(`Rút gọn lời thoại cho vừa thời lượng: bỏ ${removed.length} câu.`);
      }
    }
    if (al.overflow > 0 && allowExtend && tl.autoDuration) {
      tl.duration = round(Math.min(cfg.defaults.maxDuration + 2, tl.duration + al.overflow + 0.4), 2);
      log(`Lời thoại dài hơn video → kéo dài video lên ${tl.duration}s.`);
      al = alignSegments(want, tl.duration, A.fadeOut);
    }
    if (al.overflow > 0) tl.notes = [...(tl.notes || []).filter((n) => n.kind !== 'vo-overflow'), { level: 'warn', kind: 'vo-overflow', text: `Lời thoại dài hơn thời lượng ${al.overflow}s — hãy rút gọn lời hoặc tăng thời lượng.` }];
    else tl.notes = (tl.notes || []).filter((n) => n.kind !== 'vo-overflow');
    lines.forEach((l, i) => { l.start = al.placed[i].start; l.speed = al.placed[i].speed; });
    lines.forEach((l) => segs.push({ file: l.file, start: l.start, speed: l.speed }));
  }
  V.mix = segs.length ? await buildVoiceTrack(dir, segs, tl.duration) : null;
  if (A.music?.trackId) {
    const tr = listMusic().find((t) => t.id === A.music.trackId);
    if (tr) A.music.mix = await buildMusicTrack(dir, tr, tl.duration, { voFile: V.mix && !V.muted ? V.mix : null, duckDb: A.duckDb, fadeOut: A.fadeOut });
  } else if (A.music) A.music.mix = null;
  saveTimeline(p.id, tl);
  log(`Âm thanh: ${segs.length} câu thoại${A.music?.mix ? ' + nhạc (đã hạ dưới lời thoại, fade-out cuối)' : ''}.`);
}

export function stepCompose(p, log) {
  const tl = loadTimeline(p.id);
  buildComposition(pdir(p.id), tl);
  log('Đã dựng composition HyperFrames (dùng chung cho preview và MP4).');
}

export const PIPELINE = [
  { key: 'ingest', label: 'Nhận file & chuẩn hóa', fn: stepIngest },
  { key: 'analyze', label: 'Phân tích KV (bố cục, điểm nhấn, nội dung)', fn: stepAnalyzeKV },
  { key: 'template', label: 'Phân tích video mẫu', fn: stepAnalyzeTemplate, when: (p) => !!p.inputs.template },
  { key: 'music', label: 'Chọn nhạc', fn: stepMusic },
  { key: 'plan', label: 'Đề xuất chuyển động & timeline', fn: stepPlan },
  { key: 'script', label: 'Viết lời thoại', fn: stepScript },
  { key: 'audio', label: 'Tạo giọng đọc & mix âm thanh', fn: (p, log) => stepAudio(p, log, { allowExtend: true }) },
  { key: 'compose', label: 'Dựng preview', fn: stepCompose },
];

export const REPLAN = PIPELINE.filter((s) => ['ingest', 'analyze', 'template', 'plan', 'script', 'audio', 'compose'].includes(s.key));
export const UPDATE = [
  { key: 'audio', label: 'Cập nhật giọng đọc & mix', fn: (p, log) => stepAudio(p, log) },
  { key: 'compose', label: 'Dựng lại preview', fn: stepCompose },
];
