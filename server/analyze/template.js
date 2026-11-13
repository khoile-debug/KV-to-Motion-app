// Phân tích video mẫu (MP4/GIF): cắt cảnh, camera toàn cảnh, sự kiện xuất hiện của từng phần tử,
// hướng/tốc độ/easing, thời gian giữ khung cuối. Hoàn toàn bằng FFmpeg + đo trên ảnh xám thu nhỏ.
import path from 'node:path';
import fs from 'node:fs';
import { run, runBuffer, ffprobe, round, clamp } from '../util.js';

const AW = 128;      // analysis width
const AFPS = 12;     // analysis fps

class Frame {
  constructor(w, h, data) { this.w = w; this.h = h; this.d = data; }
  at(x, y) { // bilinear, returns -1 if outside
    if (x < 0 || y < 0 || x > this.w - 1 || y > this.h - 1) return -1;
    const x0 = x | 0, y0 = y | 0, x1 = Math.min(x0 + 1, this.w - 1), y1 = Math.min(y0 + 1, this.h - 1);
    const fx = x - x0, fy = y - y0, d = this.d, w = this.w;
    return (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
  }
}

export async function extractFrames(file, w = AW, fps = AFPS) {
  const info = await ffprobe(file);
  const h = Math.max(2, Math.round((w * info.height) / info.width / 2) * 2);
  const buf = await runBuffer('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-']);
  const n = Math.floor(buf.length / (w * h));
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(new Frame(w, h, buf.subarray(i * w * h, (i + 1) * w * h)));
  return { info, frames, w, h, fps };
}

const meanAbs = (A, B) => { let s = 0; for (let i = 0; i < A.d.length; i++) s += Math.abs(A.d[i] - B.d[i]); return s / A.d.length; };

/** error of modelling frame B as A magnified by s and shifted by (dx,dy) around the centre. */
function warpErr(A, B, s, dx, dy, pts) {
  const cx = A.w / 2, cy = A.h / 2;
  let e = 0, n = 0;
  for (let k = 0; k < pts.length; k += 2) {
    const px = pts[k], py = pts[k + 1];
    const v = A.at((px - cx - dx) / s + cx, (py - cy - dy) / s + cy);
    if (v < 0) continue;
    e += Math.abs(B.d[py * B.w + px] - v); n++;
  }
  return n > pts.length / 6 ? e / n : 1e9;
}

function gridPoints(w, h, step, margin = 0) {
  const p = [];
  for (let y = margin; y < h - margin; y += step) for (let x = margin; x < w - margin; x += step) p.push(x, y);
  return p;
}

/** Estimate how frame F relates to the final frame E: F ≈ E zoomed by s and shifted by (dx,dy). */
function fitCamera(E, F, pts) {
  const id = warpErr(E, F, 1, 0, 0, pts);
  let best = { s: 1, dx: 0, dy: 0, err: id };
  for (let s = 0.7; s <= 1.6001; s += 0.025) { const e = warpErr(E, F, s, 0, 0, pts); if (e < best.err) best = { s, dx: 0, dy: 0, err: e }; }
  const R = Math.round(E.w * 0.25);
  for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
    const e = warpErr(E, F, best.s, dx, dy, pts); if (e < best.err) best = { ...best, dx, dy, err: e };
  }
  for (let it = 0; it < 2; it++) {
    const b = best;
    for (const ds of [-0.0125, 0, 0.0125]) for (const ddx of [-1, 0, 1]) for (const ddy of [-1, 0, 1]) {
      const e = warpErr(E, F, b.s + ds, b.dx + ddx, b.dy + ddy, pts); if (e < best.err) best = { s: b.s + ds, dx: b.dx + ddx, dy: b.dy + ddy, err: e };
    }
  }
  return { ...best, identityErr: id };
}

/** Locate the final-state patch (bbox in px) inside frame F: translation + scale + contrast (≈opacity). */
function trackPatch(E, F, box, range) {
  const step = Math.max(1, Math.round(Math.max(box.w, box.h) / 22));
  const pts = [];
  let mean = 0;
  for (let y = box.y; y < box.y + box.h; y += step) for (let x = box.x; x < box.x + box.w; x += step) { pts.push(x, y); mean += E.d[y * E.w + x]; }
  mean /= pts.length / 2;
  let std = 0; for (let k = 0; k < pts.length; k += 2) std += (E.d[pts[k + 1] * E.w + pts[k]] - mean) ** 2;
  std = Math.sqrt(std / (pts.length / 2)) || 1;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const evalAt = (s, dx, dy) => {
    let e = 0, n = 0, fm = 0, fs = 0;
    const vals = [];
    for (let k = 0; k < pts.length; k += 2) {
      const x = (pts[k] - cx) * s + cx + dx, y = (pts[k + 1] - cy) * s + cy + dy;
      const v = F.at(x, y); if (v < 0) continue;
      const ev = E.d[pts[k + 1] * E.w + pts[k]];
      vals.push([v, ev]); e += Math.abs(v - ev); n++;
    }
    if (n < pts.length / 2 * 0.3) return { err: 1e9 };
    for (const [v] of vals) fm += v; fm /= n;
    for (const [v] of vals) fs += (v - fm) ** 2; fs = Math.sqrt(fs / n);
    return { err: e / n, contrast: fs / std, vis: n / (pts.length / 2) };
  };
  let best = { s: 1, dx: 0, dy: 0, ...evalAt(1, 0, 0) };
  const scales = [0.4, 0.6, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
  const st = Math.max(2, Math.round(range / 24));
  for (const s of scales) for (let dy = -range; dy <= range; dy += st) for (let dx = -range; dx <= range; dx += st) {
    const r = evalAt(s, dx, dy); if (r.err < best.err) best = { s, dx, dy, ...r };
  }
  for (let it = 0; it < 3; it++) {
    const b = best;
    for (const ds of [-0.05, 0, 0.05]) for (const ddx of [-st / 2, 0, st / 2]) for (const ddy of [-st / 2, 0, st / 2]) {
      const r = evalAt(b.s + ds, b.dx + ddx, b.dy + ddy); if (r.err < best.err) best = { s: b.s + ds, dx: b.dx + ddx, dy: b.dy + ddy, ...r };
    }
  }
  return best;
}

function classifyEase(progress) {
  // progress: array of [tNorm, p] where p goes 0→1
  const at = (q) => { let best = progress[0]; for (const pr of progress) if (Math.abs(pr[0] - q) < Math.abs(best[0] - q)) best = pr; return best[1]; };
  const overshoot = progress.some(([, p]) => p > 1.06);
  if (overshoot) return 'back.out(1.6)';
  const mid = at(0.5), q1 = at(0.25);
  if (mid > 0.72 || q1 > 0.5) return 'power3.out';
  if (mid < 0.3) return 'power2.in';
  if (q1 < 0.15 && mid > 0.4 && mid < 0.6) return 'power2.inOut';
  return 'power1.out';
}

export async function analyzeTemplate(file, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const { info, frames, w, h, fps } = await extractFrames(file);
  if (frames.length < 3) throw new Error('Video mẫu quá ngắn hoặc không đọc được');
  const N = frames.length;
  const duration = info.duration || N / fps;
  const E = frames[N - 1];
  const tOf = (i) => round(i / fps, 2);

  // 1) frame-to-frame activity, cuts, final hold
  const diffs = [0];
  for (let i = 1; i < N; i++) diffs.push(meanAbs(frames[i - 1], frames[i]));
  const sortedD = [...diffs].sort((a, b) => a - b);
  const med = sortedD[Math.floor(N / 2)];
  const cuts = [];
  for (let i = 1; i < N; i++) if (diffs[i] > Math.max(28, med * 8)) cuts.push(tOf(i));
  let lastActive = 0;
  for (let i = 1; i < N; i++) if (diffs[i] > 0.15) lastActive = i;
  const hold = round(Math.max(0, duration - lastActive / fps), 2);
  // Fade from/to black
  const meanLum = frames.map((f) => { let s = 0; for (const v of f.d) s += v; return s / f.d.length; });
  const fadeInFromBlack = meanLum[0] < 18 && meanLum[N - 1] > 40;

  // 2) global camera relative to final frame (only frames after the last cut)
  const startIdx = cuts.length ? Math.round(cuts[cuts.length - 1] * fps) : 0;
  const pts = gridPoints(w, h, 3, 2);
  const cam = [];
  for (let i = startIdx; i < N; i += 2) {
    const f = fitCamera(E, frames[i], pts);
    cam.push({ i, t: tOf(i), ...f });
  }
  const camGood = cam.filter((c) => c.identityErr > 3 && c.err < c.identityErr * 0.45 && (Math.abs(c.s - 1) > 0.02 || Math.hypot(c.dx, c.dy) > 2));
  const hasCamera = camGood.length >= Math.max(2, cam.length * 0.2);
  const camera = hasCamera ? {
    keys: cam.filter((c) => c.err < c.identityErr * 0.6 || c.identityErr < 3).map((c) => {
      const s = Math.max(1, c.s);
      return { t: c.t, scale: round(s), cx: round(clamp(0.5 - c.dx / (s * w), 0, 1)), cy: round(clamp(0.5 - c.dy / (s * h), 0, 1)) };
    }),
  } : null;
  const camAt = (i) => {
    if (!hasCamera) return { s: 1, dx: 0, dy: 0 };
    let best = cam[0]; for (const c of cam) if (Math.abs(c.i - i) < Math.abs(best.i - i)) best = c;
    return best.err < best.identityErr * 0.6 ? best : { s: 1, dx: 0, dy: 0 };
  };

  // 3) per-cell settle time vs. (camera-compensated) final frame
  const GX = 16, GY = Math.max(6, Math.round(16 * h / w));
  const cw = w / GX, ch = h / GY;
  const cellErr = (F, c) => {
    const { s, dx, dy } = c;
    const out = new Float32Array(GX * GY); const cnt = new Float32Array(GX * GY);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const v = E.at((x - w / 2 - dx) / s + w / 2, (y - h / 2 - dy) / s + h / 2); if (v < 0) continue;
      const k = Math.min(GY - 1, (y / ch) | 0) * GX + Math.min(GX - 1, (x / cw) | 0);
      out[k] += Math.abs(F.d[y * w + x] - v); cnt[k]++;
    }
    for (let k = 0; k < out.length; k++) out[k] = cnt[k] ? out[k] / cnt[k] : 0;
    return out;
  };
  const errs = []; for (let i = 0; i < N; i++) errs.push(cellErr(frames[i], camAt(i)));
  const THR = 9;
  const settle = new Int32Array(GX * GY).fill(0);
  for (let k = 0; k < GX * GY; k++) { for (let i = N - 1; i >= startIdx; i--) if (errs[i][k] > THR) { settle[k] = i + 1; break; } }

  // 4) connected components of animated cells with similar settle times
  const seen = new Uint8Array(GX * GY); const comps = [];
  for (let k = 0; k < GX * GY; k++) {
    if (seen[k] || settle[k] <= startIdx) continue;
    const q = [k]; seen[k] = 1; const cells = [];
    while (q.length) {
      const c = q.pop(); cells.push(c);
      const cx = c % GX, cy = (c / GX) | 0;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue;
        const n = ny * GX + nx;
        if (!seen[n] && settle[n] > startIdx && Math.abs(settle[n] - settle[c]) <= Math.max(1, Math.round(fps * 0.17))) { seen[n] = 1; q.push(n); }
      }
    }
    if (cells.length >= 2) comps.push(cells);
  }

  // 5) build events: t1 = settle, t0 from region mismatch curve; final bbox = cells that changed between t0 and end
  const events = [];
  for (const cells of comps) {
    const st = cells.map((c) => settle[c]).sort((a, b) => a - b);
    const i1 = st[Math.floor(st.length * 0.8)];
    const curve = []; for (let i = startIdx; i <= i1 && i < N; i++) { let m = 0; for (const c of cells) m += errs[i][c]; curve.push([i, m / cells.length]); }
    // t0 = start of the final approach: walk back from the settle frame while the mismatch keeps growing
    let j = curve.length - 1;
    while (j > 0 && curve[j - 1][1] > curve[j][1] + 0.4) j--;
    let i0 = curve[Math.max(0, j)][0];
    if (i1 - i0 < 2) i0 = Math.max(startIdx, i1 - 2);
    // what changed because of this event = final vs frame before it started
    const pre = frames[Math.max(startIdx, i0 - 1)], preCam = camAt(Math.max(startIdx, i0 - 1));
    const preErr = cellErr(pre, preCam);
    let finalCells = cells.filter((c) => preErr[c] > THR);
    if (finalCells.length < 2) finalCells = cells;
    const bb = (list) => {
      let x0 = GX, y0 = GY, x1 = -1, y1 = -1;
      for (const c of list) { const x = c % GX, y = (c / GX) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x: x0 * cw, y: y0 * ch, w: (x1 - x0 + 1) * cw, h: (y1 - y0 + 1) * ch };
    };
    const fb = bb(finalCells), pb = bb(cells);
    const area = (fb.w * fb.h) / (w * h);
    events.push({ i0, i1, cells: cells.length, box: fb, pathBox: pb, area });
  }
  events.sort((a, b) => a.i0 - b.i0 || b.area - a.area);
  // background reveal: everything that settles while the frame fades up from black is one background event
  if (fadeInFromBlack) {
    // the fade is over when frame-to-frame activity first calms down
    let fadeEnd = 1; while (fadeEnd < Math.floor(N / 3) && diffs[fadeEnd] >= 2) fadeEnd++;
    const bg = events.filter((e) => e.i1 <= fadeEnd + 2);
    if (bg.length > 1) {
      const keep = events.filter((e) => !bg.includes(e));
      const area = bg.reduce((a, e) => a + e.area, 0);
      events.length = 0;
      events.push({ i0: startIdx, i1: Math.max(...bg.map((e) => e.i1)), cells: bg.reduce((a, e) => a + e.cells, 0), box: { x: 0, y: 0, w, h }, pathBox: { x: 0, y: 0, w, h }, area: Math.max(area, 0.61) }, ...keep);
    }
  }
  // small fragments that settle right next to (and right after) a bigger event belong to it
  for (let a = 0; a < events.length; a++) for (let b = 0; b < events.length; b++) {
    const A = events[a], B = events[b];
    if (!A || !B || a === b || B.area > 0.12 || A.area < B.area || A.area > 0.6) continue;
    const P = A.pathBox, bx = B.box.x + B.box.w / 2, by = B.box.y + B.box.h / 2;
    const inside = bx >= P.x - cw / 2 && bx <= P.x + P.w + cw / 2 && by >= P.y - ch / 2 && by <= P.y + P.h + ch / 2;
    const adjacent = !(B.box.x > A.box.x + A.box.w + cw || B.box.x + B.box.w < A.box.x - cw || B.box.y > A.box.y + A.box.h + ch || B.box.y + B.box.h < A.box.y - ch);
    const dt = Math.abs(B.i1 - A.i1);
    if (((inside && dt <= fps * 0.5) || (adjacent && dt <= fps * 0.35)) && B.i0 >= A.i0 - fps * 0.1) {
      A.i1 = Math.max(A.i1, B.i1); A.cells += B.cells;
      events[b] = null;
    }
  }
  for (let k = events.length - 1; k >= 0; k--) if (!events[k]) events.splice(k, 1);

  // 6) motion of each event by tracking its final patch backwards
  const out = [];
  for (const ev of events) {
    const box = { x: Math.round(ev.box.x), y: Math.round(ev.box.y), w: Math.max(4, Math.round(ev.box.w)), h: Math.max(4, Math.round(ev.box.h)) };
    const range = Math.round(Math.max(w, h) * 0.6);
    const track = [];
    const span = Math.max(1, ev.i1 - ev.i0);
    for (let i = ev.i0; i <= Math.min(N - 1, ev.i1); i += Math.max(1, Math.round(span / 8))) {
      const r = trackPatch(E, frames[i], box, range);
      track.push({ t: tOf(i), ...r });
    }
    const first = track.find((r) => r.err < 30 && r.contrast > 0.35) || track[0];
    const dist = Math.hypot(first.dx, first.dy);
    let type = 'fade', from = 'none', scaleFrom = 1;
    if (ev.area > 0.6) type = fadeInFromBlack && ev.i0 <= startIdx + 1 ? 'fade' : (Math.abs(first.s - 1) > 0.08 ? (first.s > 1 ? 'zoom-out' : 'zoom-in') : 'fade');
    else if (dist > Math.max(w, h) * 0.04) {
      type = 'slide';
      from = Math.abs(first.dx) > Math.abs(first.dy) ? (first.dx < 0 ? 'left' : 'right') : (first.dy < 0 ? 'top' : 'bottom');
    } else if (dist > Math.max(w, h) * 0.012 && Math.abs(first.dy) > Math.abs(first.dx) && first.dy > 0) {
      type = 'fade-up';
    } else if (Math.abs(first.s - 1) > 0.08) {
      type = first.s < 1 ? 'zoom-in' : 'zoom-out'; scaleFrom = round(first.s, 2);
      if (track.some((r) => r.s > 1.04) && first.s < 1) type = 'pop';
    }
    // easing from progress curve
    const prog = track.map((r) => {
      const tn = (r.t - track[0].t) / Math.max(0.01, track[track.length - 1].t - track[0].t);
      let p;
      if (type === 'slide') p = dist ? 1 - Math.hypot(r.dx, r.dy) / dist : 1;
      else if (type === 'zoom-in' || type === 'zoom-out' || type === 'pop') p = Math.abs(first.s - 1) > 1e-3 ? (r.s - first.s) / (1 - first.s) : 1;
      else p = clamp(1 - r.err / Math.max(1, first.err), 0, 1.2);
      return [tn, p];
    });
    const t0 = tOf(ev.i0), t1 = tOf(ev.i1);
    out.push({
      id: `e${out.length + 1}`, t0, t1: Math.max(t1, round(t0 + 0.15, 2)), dur: round(Math.max(0.15, t1 - t0), 2),
      bbox: { x: round(box.x / w), y: round(box.y / h), w: round(box.w / w), h: round(box.h / h) },
      area: round(ev.area),
      motion: { type, from, distance: round(dist / Math.max(w, h)), scaleFrom, ease: classifyEase(prog) },
      speed: round(dist / Math.max(w, h) / Math.max(0.1, t1 - t0)),
    });
  }

  // background reveal (fade from black) even if it was merged
  const bgEvents = out.filter((e) => e.area > 0.6);
  const elementEvents = out.filter((e) => e.area <= 0.6);
  const perLayer = elementEvents.length >= 2 || (elementEvents.length >= 1 && !hasCamera);

  // 7) reference frames (for UI + optional Claude analysis)
  const kfTimes = new Set([0, ...out.map((e) => e.t0), ...out.map((e) => e.t1), round(duration - 0.05, 2)].map((t) => round(clamp(t, 0, duration - 0.05), 2)));
  const keyframes = [];
  for (const t of [...kfTimes].sort((a, b) => a - b).slice(0, 12)) {
    const fn = `kf_${String(Math.round(t * 100)).padStart(5, '0')}.jpg`;
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(workDir, fn)], { allowFail: true });
    if (fs.existsSync(path.join(workDir, fn))) keyframes.push({ t, file: fn });
  }

  return {
    duration: round(duration, 2), fps: round(info.fps, 2), width: info.width, height: info.height,
    aspect: round(info.width / info.height, 4),
    cuts, hold, fadeInFromBlack,
    camera, events: out, backgroundEvents: bgEvents.map((e) => e.id),
    perLayer, activity: diffs.map((d, i) => [tOf(i), round(d, 2)]).filter((_, i) => i % 2 === 0),
    keyframes,
  };
}
