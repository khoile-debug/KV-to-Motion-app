// Tự lập timeline từ phân tích KV (không cần người dùng chọn preset) và ánh xạ mẫu chuyển động sang KV mới.
import { clamp, round } from '../util.js';
import { slideFrom, LOGO_SAFE_IN } from './presets.js';

export const STYLES = {
  energetic: { tempo: 0.75, inDur: 0.55, ease: 'back.out(1.6)', camScale: 1.32, reveal: 1.7, hold: 1.6, subject: 'zoom-in', text: 'pop', logo: 'pop', loop: 'pulse', intro: 0.25 },
  playful:   { tempo: 0.85, inDur: 0.7, ease: 'back.out(1.7)', camScale: 1.25, reveal: 2.0, hold: 1.6, subject: 'drop', text: 'pop', logo: 'pop', loop: 'float', intro: 0.3 },
  festive:   { tempo: 0.85, inDur: 0.7, ease: 'back.out(1.4)', camScale: 1.25, reveal: 2.0, hold: 1.7, subject: 'zoom-in', text: 'fade-up', logo: 'pop', loop: 'float', intro: 0.4 },
  corporate: { tempo: 1.0, inDur: 0.8, ease: 'power3.out', camScale: 1.18, reveal: 2.4, hold: 1.8, subject: 'slide', text: 'wipe-left', logo: 'fade', loop: 'breathe', intro: 0.5 },
  calm:      { tempo: 1.25, inDur: 1.2, ease: 'power2.out', camScale: 1.15, reveal: 3.4, hold: 2.0, subject: 'blur-in', text: 'fade-up', logo: 'fade', loop: 'breathe', intro: 0.7 },
  luxury:    { tempo: 1.2, inDur: 1.2, ease: 'power3.out', camScale: 1.2, reveal: 3.2, hold: 2.0, subject: 'blur-in', text: 'wipe-left', logo: 'fade', loop: 'breathe', intro: 0.8 },
};

/** Choose a motion style from mood words. */
export function pickStyle(moods = []) {
  const score = { energetic: 0, playful: 0, festive: 0, corporate: 0, calm: 0, luxury: 0 };
  const map = { energetic: 'energetic', sale: 'energetic', sport: 'energetic', gaming: 'energetic', bold: 'energetic', tech: 'corporate',
    playful: 'playful', food: 'playful', family: 'festive', festive: 'festive', tet: 'festive', warm: 'festive',
    corporate: 'corporate', finance: 'corporate', trust: 'corporate', education: 'corporate',
    calm: 'calm', beauty: 'calm', healthcare: 'calm', minimal: 'calm', spa: 'calm',
    luxury: 'luxury', premium: 'luxury', elegant: 'luxury', 'real-estate': 'luxury', cosmetics: 'luxury', fashion: 'energetic' };
  moods.forEach((m, i) => { const s = map[m]; if (s) score[s] += i < 3 ? 2 : 1; });
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(score).sort((a, b) => b[1] - a[1])[0][0] : 'corporate';
}

const snapper = (bpm) => {
  const g = bpm ? 30 / bpm : 0; // half-beat grid
  return (t) => (g ? round(Math.round(t / g) * g, 3) : round(t, 3));
};

const pad = (b, p, W, H) => ({ x: Math.max(0, b.x - p), y: Math.max(0, b.y - p), w: Math.min(W - Math.max(0, b.x - p), b.w + 2 * p), h: Math.min(H - Math.max(0, b.y - p), b.h + 2 * p) });

function regionLayersForElements(elements, src, srcBox, canvas, roles, zBase) {
  const out = [];
  for (const e of elements) {
    if (!roles.includes(e.role) || !e.cbox) continue;
    const b = pad(e.cbox, Math.round(Math.max(4, e.cbox.h * 0.12)), canvas.width, canvas.height);
    if (b.w * b.h > 0.35 * canvas.width * canvas.height) continue; // too large for a believable "pop"
    out.push({ id: `r_${e.role}_${out.length}`, name: `Vùng ${e.role}: ${e.text.slice(0, 24)}`, type: 'region', role: e.role, src, srcBox, box: b,
      z: zBase + out.length, locked: true, inStage: true, in: { preset: 'none' }, loop: { preset: 'none' }, facts: [e.role] });
  }
  return out;
}

/**
 * Auto plan. ctx = { canvas, mode:'flat'|'layered', kvSrc, layers:[{id,role,src,box,coverage}], elements (with cbox),
 *   facts, style, focal, bpm, durationHint }
 */
export function autoPlan(ctx) {
  const st = STYLES[ctx.style] || STYLES.corporate;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const snap = snapper(ctx.bpm);
  const info = ['headline', 'price', 'datetime', 'cta'].filter((k) => ctx.facts?.[k]).length;
  let D = clamp(8 + 0.5 * info, 8, 10);
  if (ctx.durationHint) D = ctx.durationHint;
  const layers = [];
  const notes = [];
  let camera = null;
  const anchors = {};

  if (ctx.mode === 'flat') {
    layers.push({ id: 'kv', name: 'KV', type: 'image', role: 'kv', src: ctx.kvSrc, box: { x: 0, y: 0, w: W, h: H }, z: 0, locked: true, inStage: true, in: { preset: 'none' }, loop: { preset: 'none' } });
    const tR = snap(st.reveal);
    const f = ctx.focal || { x: 0.5, y: 0.5 };
    camera = { ease: st.ease.startsWith('back') ? 'power3.inOut' : 'power2.inOut', keys: [
      { t: 0, scale: st.camScale, cx: f.x, cy: f.y },
      { t: tR, scale: 1, cx: 0.5, cy: 0.5 },
    ] };
    if (ctx.style === 'calm' || ctx.style === 'luxury') camera.keys.splice(1, 0, { t: snap(tR * 0.55), scale: round(1 + (st.camScale - 1) * 0.45, 3), cx: round((f.x + 0.5) / 2, 3), cy: round((f.y + 0.5) / 2, 3) });
    anchors.intro = 0.2; anchors.brand = 0.2;
    anchors.headline = round(Math.max(0.4, tR * 0.5), 2);
    // Emphasis on approved info (exact pixel copies of the KV regions): price → pulse, CTA → pulse + shine
    const regions = regionLayersForElements(ctx.elements || [], ctx.kvSrc, null, ctx.canvas, ['price', 'cta', 'datetime'], 10);
    let t = tR + 0.3 * st.tempo;
    for (const role of ['price', 'datetime', 'cta']) {
      for (const r of regions.filter((x) => x.role === role)) {
        r.loop = { preset: role === 'datetime' ? 'breathe' : 'pulse', at: snap(t), count: role === 'cta' ? 4 : 2, intensity: role === 'datetime' ? 1.2 : 1, shine: role !== 'datetime' };
        layers.push(r);
        anchors[role] ??= snap(t);
        t += (role === 'cta' ? 1.0 : 0.8) * st.tempo;
      }
      if (anchors[role] == null && ctx.facts?.[role]) { anchors[role] = snap(t); t += 0.7 * st.tempo; }
    }
    // CTA approved in brief but not visible on the KV → add a separate CTA overlay
    const ctaOnKV = (ctx.elements || []).some((e) => e.role === 'cta');
    if (ctx.facts?.cta && !ctaOnKV && ctx.facts.ctaFromBrief) {
      const at = snap(Math.min(D - st.hold - 0.6, t));
      layers.push({ id: 'cta_overlay', name: 'CTA (thêm từ brief)', type: 'cta', role: 'cta', text: ctx.facts.cta, inStage: false, z: 50,
        box: { x: Math.round(W * 0.2), y: Math.round(H * 0.84), w: Math.round(W * 0.6), h: Math.round(H * 0.1) },
        style: { font: 'Be Vietnam Pro', weight: 800, size: Math.round(Math.min(W, H) * 0.045), color: '#ffffff', bg: ctx.accent || '#e53935', align: 'center' },
        in: { preset: 'pop', at, dur: 0.6, ease: 'back.out(1.7)' }, loop: { preset: 'pulse', at: at + 0.7, count: 4 } });
      anchors.cta = at;
      notes.push({ level: 'info', text: 'KV không có CTA hiển thị — đã thêm nút CTA riêng từ brief (có thể sửa/xóa ở tab Chuyển động).' });
    }
    if (!regions.length) notes.push({ level: 'info', text: 'Không xác định được vùng giá/CTA trên KV phẳng để nhấn — preview dùng zoom/pan/fade toàn ảnh.' });
  } else {
    // Layered KV: choreograph each layer
    let t = 0;
    const byRole = (r) => ctx.layers.filter((l) => l.role === r);
    const add = (L, preset, at, dur, extra = {}) => {
      const p = L.role === 'logo' && !LOGO_SAFE_IN.includes(preset) ? 'fade' : preset;
      layers.push({ ...L, in: { preset: p, at: snap(at), dur: round(dur, 2), ease: p === 'fade' ? 'power2.out' : st.ease }, loop: extra.loop || { preset: 'none' } });
    };
    for (const L of byRole('background')) add(L, ctx.style === 'energetic' ? 'zoom-out' : 'fade', 0, st.inDur + 0.2, { loop: { preset: 'kenburns', at: 0, intensity: 0.6 } });
    t = 0.3 * st.tempo;
    for (const L of byRole('subject')) {
      const cx = (L.box.x + L.box.w / 2) / W, cy = (L.box.y + L.box.h / 2) / H;
      let preset = st.subject;
      if (preset === 'slide') preset = cx < 0.4 ? 'slide-left' : cx > 0.6 ? 'slide-right' : cy > 0.55 ? 'slide-bottom' : 'zoom-in';
      add(L, preset, t, st.inDur + 0.2, { loop: { preset: st.loop === 'pulse' ? 'float' : st.loop, intensity: 0.8 } });
      anchors.product ??= snap(t);
      t += 0.35 * st.tempo;
    }
    t += 0.3 * st.tempo;
    // Text layers: split into lines (exact cuts of the text layer) to stagger headline → price → date → CTA
    for (const L of byRole('text')) {
      const inside = (ctx.elements || []).filter((e) => e.cbox && e.cbox.x >= L.box.x - 4 && e.cbox.y >= L.box.y - 4 && e.cbox.x + e.cbox.w <= L.box.x + L.box.w + 4 && e.cbox.y + e.cbox.h <= L.box.y + L.box.h + 4);
      const order = ['brand', 'headline', 'subheadline', 'product', 'body', 'price', 'datetime', 'terms', 'cta'];
      inside.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.cbox.y - b.cbox.y);
      if (inside.length >= 2) {
        const regs = regionLayersForElements(inside, L.src, L.box, ctx.canvas, order, (L.z ?? 2) * 10);
        for (const r of regs) {
          const preset = r.role === 'headline' ? st.text : r.role === 'price' ? 'pop' : r.role === 'cta' ? 'pop' : 'fade-up';
          add(r, preset, t, st.inDur, { loop: r.role === 'cta' ? { preset: 'pulse', count: 4, shine: true } : r.role === 'price' ? { preset: 'pulse', count: 2 } : { preset: 'none' } });
          anchors[r.role] ??= snap(t);
          t += (r.role === 'headline' ? 0.6 : 0.45) * st.tempo;
        }
        // the full text layer lands last so nothing outside the detected lines is ever lost
        add({ ...L, name: L.name + ' (toàn bộ)' }, 'fade', t - 0.2, 0.35);
        t += 0.2;
      } else {
        add(L, st.text, t, st.inDur + 0.1, { loop: { preset: 'none' } });
        anchors.headline ??= snap(t);
        t += 0.6 * st.tempo;
      }
    }
    for (const L of byRole('logo')) { add(L, st.logo, t, st.inDur, { loop: ctx.style === 'luxury' ? { preset: 'shine' } : { preset: 'none' } }); anchors.brand ??= snap(t); t += 0.4 * st.tempo; }
    for (const L of ctx.layers.filter((l) => !['background', 'subject', 'text', 'logo'].includes(l.role))) {
      add(L, L.role === 'cta' ? 'pop' : 'fade-up', t, st.inDur, { loop: L.role === 'cta' ? { preset: 'pulse', count: 4, shine: true } : { preset: 'none' } });
      anchors[L.role] ??= snap(t); t += 0.4 * st.tempo;
    }
    const lastEnd = Math.max(...layers.map((l) => (l.in?.at ?? 0) + (l.in?.dur ?? 0)));
    if (!ctx.durationHint) D = clamp(Math.max(D, lastEnd + st.hold + 1.5), 8, 10);
    if (lastEnd > D - st.hold) { // compress to keep the final hold
      const k = (D - st.hold) / lastEnd;
      for (const l of layers) if (l.in && l.role !== 'background') { l.in.at = round(l.in.at * k, 3); l.in.dur = round(l.in.dur * Math.max(0.6, k), 3); }
      for (const a of Object.keys(anchors)) anchors[a] = round(anchors[a] * k, 3);
    }
    if (!ctx.layers.some((l) => l.role === 'text') && ctx.mode === 'layered') notes.push({ level: 'info', text: 'KV có lớp nhưng không có lớp chữ — headline/giá nằm trong lớp nền sẽ xuất hiện cùng nền.' });
  }
  return {
    duration: round(D, 2), layers, camera, anchors, notes,
    intro: { fadeFromBlack: true, dur: st.intro }, finalHold: st.hold, style: ctx.style,
  };
}

// ---------------------------------------------------------------- template mapping
const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy; return i / (a.w * a.h + b.w * b.h - i || 1);
};
const centerDist = (a, b) => Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));

export function guessRole(ev) {
  const b = ev.bbox;
  if (ev.area > 0.6) return 'background';
  if (b.y < 0.22 && ev.area < 0.08) return 'logo';
  if (b.w / Math.max(0.01, b.h) * 1.0 > 1.6 && b.h < 0.32) return b.y >= 0.68 && ev.area < 0.18 ? 'cta' : 'text';
  if (ev.area < 0.03) return 'cta';
  return 'subject';
}

const ROLE_VI = { background: 'nền', subject: 'chủ thể/sản phẩm', logo: 'logo', text: 'chữ (headline/giá)', cta: 'CTA', other: 'khác' };
const MOTION_VI = (m) => ({
  slide: `trượt vào từ ${{ left: 'trái', right: 'phải', top: 'trên', up: 'trên', bottom: 'dưới', down: 'dưới' }[m.from] || ''}`,
  'zoom-in': 'phóng to vào', 'zoom-out': 'thu nhỏ vào', pop: 'bật nảy', fade: 'hiện mờ dần', 'fade-up': 'hiện mờ + trồi lên',
}[m.type] || m.type);

export function motionToIn(m, k = 1) {
  let preset = { slide: slideFrom(m.from), 'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', pop: 'pop', fade: 'fade', 'fade-up': 'fade-up' }[m.type] || 'fade';
  const distance = m.type === 'slide' && m.distance && m.distance < 0.45 ? round(m.distance, 3) : 'auto';
  return { preset, distance, ease: m.ease || 'power3.out' };
}

/**
 * Map template motion onto the KV. tpl = template analysis; ctx like autoPlan.
 */
export function templatePlan(ctx, tpl) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const D = round(clamp(ctx.durationHint || tpl.duration, 4, 20), 2);
  const k = D / tpl.duration;
  const layers = [], notes = [], anchors = {};
  const T = (t) => round(t * k, 3);
  const elementEvents = tpl.events.filter((e) => e.area <= 0.6).sort((a, b) => a.t0 - b.t0);
  const bgEvent = tpl.events.find((e) => e.area > 0.6);
  let camera = tpl.camera?.keys?.length ? { ease: 'power2.inOut', keys: tpl.camera.keys.map((c) => ({ ...c, t: T(c.t) })) } : null;
  const transitions = (tpl.cuts || []).map((c) => ({ at: T(c), type: 'flash' }));
  const mapping = [];

  if (ctx.mode === 'layered') {
    const pool = ctx.layers.filter((l) => l.role !== 'background').map((l) => ({ ...l, nb: { x: l.box.x / W, y: l.box.y / H, w: l.box.w / W, h: l.box.h / H } }));
    // text layers can be split into lines to receive several events
    const pairs = [];
    for (const ev of elementEvents) for (const L of pool) {
      const role = guessRole(ev);
      const s = iou(ev.bbox, L.nb) * 2 + (1 - Math.min(1, centerDist(ev.bbox, L.nb) * 1.5)) + (role === L.role ? 0.6 : 0);
      pairs.push({ ev, L, s });
    }
    pairs.sort((a, b) => b.s - a.s);
    const usedE = new Set(), usedL = new Set();
    for (const p of pairs) {
      if (usedE.has(p.ev.id) || usedL.has(p.L.id) || p.s < 0.3) continue;
      usedE.add(p.ev.id); usedL.add(p.L.id);
      const inn = motionToIn(p.ev.motion);
      const preset = p.L.role === 'logo' && !LOGO_SAFE_IN.includes(inn.preset) ? 'fade' : inn.preset;
      const { nb, ...L } = p.L;
      layers.push({ ...L, in: { preset, at: T(p.ev.t0), dur: round(Math.max(0.2, p.ev.dur * k), 3), ease: inn.ease, distance: inn.distance }, loop: { preset: 'none' }, templateEvent: p.ev.id });
      anchors[L.role === 'text' ? 'headline' : L.role === 'subject' ? 'product' : L.role === 'logo' ? 'brand' : L.role] ??= T(p.ev.t0);
      mapping.push({ event: p.ev.id, layer: L.id, score: round(p.s, 2) });
    }
    for (const L of ctx.layers.filter((l) => l.role === 'background')) {
      const ev = bgEvent;
      const inn = ev ? motionToIn(ev.motion) : { preset: tpl.fadeInFromBlack ? 'fade' : 'none', ease: 'power1.out' };
      layers.push({ ...L, in: { preset: inn.preset, at: ev ? T(ev.t0) : 0, dur: ev ? round(ev.dur * k, 3) : 0.5, ease: inn.ease }, loop: { preset: 'none' } });
      if (ev) mapping.push({ event: ev.id, layer: L.id, score: 1 });
    }
    const lastT = elementEvents.length ? T(Math.max(...elementEvents.map((e) => e.t1))) : 0.5;
    for (const L of pool.filter((l) => !usedL.has(l.id))) {
      const { nb, ...rest } = L;
      layers.push({ ...rest, in: { preset: 'fade', at: round(Math.min(D - 1, lastT + 0.2), 3), dur: 0.5, ease: 'power2.out' }, loop: { preset: 'none' } });
      notes.push({ level: 'warn', text: `Lớp "${L.name}" không có chuyển động tương ứng trong mẫu → cho hiện mờ dần sau sự kiện cuối.` });
    }
    for (const ev of elementEvents.filter((e) => !usedE.has(e.id))) notes.push({ level: 'warn', text: `Mẫu có phần tử ${ROLE_VI[guessRole(ev)]} ${MOTION_VI(ev.motion)} lúc ${ev.t0}s nhưng KV không có lớp tương ứng.` });
  } else {
    // Flat KV: only whole-image effects are possible. Keep the template's rhythm with camera + fades + region emphasis.
    layers.push({ id: 'kv', name: 'KV', type: 'image', role: 'kv', src: ctx.kvSrc, box: { x: 0, y: 0, w: W, h: H }, z: 0, locked: true, inStage: true,
      in: bgEvent ? { ...motionToIn(bgEvent.motion), at: T(bgEvent.t0), dur: round(bgEvent.dur * k, 3) } : { preset: 'none' }, loop: { preset: 'none' } });
    if (!camera && elementEvents.length) {
      // visit each animated region in the template order, then settle on the full KV for the final hold
      const keys = [{ t: 0, scale: 1.18, cx: elementEvents[0].bbox.x + elementEvents[0].bbox.w / 2, cy: elementEvents[0].bbox.y + elementEvents[0].bbox.h / 2 }];
      for (const ev of elementEvents.slice(1, 4)) keys.push({ t: T(ev.t1), scale: 1.1, cx: round(ev.bbox.x + ev.bbox.w / 2, 3), cy: round(ev.bbox.y + ev.bbox.h / 2, 3) });
      keys.push({ t: round(Math.max(T(Math.max(...elementEvents.map((e) => e.t1))), D - tpl.hold * k), 3), scale: 1, cx: 0.5, cy: 0.5 });
      keys.forEach((kk, i) => { if (i && kk.t <= keys[i - 1].t) kk.t = round(keys[i - 1].t + 0.4, 3); });
      camera = { ease: 'power2.inOut', keys };
    }
    const regions = regionLayersForElements(ctx.elements || [], ctx.kvSrc, null, ctx.canvas, ['price', 'cta', 'datetime', 'headline'], 10);
    for (const ev of elementEvents) {
      const r = regions.find((x) => !x.loop.at && iou(ev.bbox, { x: x.box.x / W, y: x.box.y / H, w: x.box.w / W, h: x.box.h / H }) > 0.05);
      if (r) { r.loop = { preset: 'pulse', at: T(ev.t1), count: 2, shine: r.role === 'cta' }; layers.push(r); anchors[r.role] ??= T(ev.t0); }
      notes.push({ level: 'need-layer', role: guessRole(ev), event: ev.id,
        text: `Mẫu: ${ROLE_VI[guessRole(ev)]} ${MOTION_VI(ev.motion)} lúc ${ev.t0}s–${ev.t1}s. KV phẳng chỉ mô phỏng bằng camera/nhấn vùng — tải lớp "${ROLE_VI[guessRole(ev)]}" (PNG nền trong suốt) để bám mẫu sát hơn.` });
    }
    anchors.headline ??= T(elementEvents[0]?.t1 ?? 1);
  }
  return {
    duration: D, layers, camera, anchors, notes, transitions,
    intro: { fadeFromBlack: !!tpl.fadeInFromBlack && !bgEvent, dur: 0.4 },
    finalHold: round(tpl.hold * k, 2), style: 'template', mapping, timeScale: round(k, 4),
  };
}
