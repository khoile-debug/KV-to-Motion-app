// Phân tích ảnh KV không cần model: bảng màu, độ sáng/bão hòa, điểm nhấn (saliency), bbox alpha của lớp.
import sharp from 'sharp';
import { round, clamp } from '../util.js';

const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function kmeans(pixels, k = 5, iters = 12) {
  const n = pixels.length / 3;
  const cents = [];
  for (let i = 0; i < k; i++) { const j = Math.floor(((i + 0.5) / k) * n) * 3; cents.push([pixels[j], pixels[j + 1], pixels[j + 2]]); }
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = pixels[i * 3] - cents[c][0], dg = pixels[i * 3 + 1] - cents[c][1], db = pixels[i * 3 + 2] - cents[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
      const s = sums[best]; s[0] += pixels[i * 3]; s[1] += pixels[i * 3 + 1]; s[2] += pixels[i * 3 + 2]; s[3]++;
    }
    sums.forEach((s, c) => { if (s[3]) cents[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = new Array(k).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i]]++;
  return cents.map((c, i) => ({ rgb: c, hex: toHex(c), share: counts[i] / n })).sort((a, b) => b.share - a.share);
}

/** Stats for a flat KV (or composite of layers). */
export async function analyzeImage(file) {
  const meta = await sharp(file).metadata();
  const W = 96;
  const { data, info } = await sharp(file).flatten({ background: '#000' }).resize(W, null, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const palette = kmeans(data, 5);
  let sumL = 0, sumS = 0, warm = 0;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const [hh, s, l] = rgbToHsl(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    sumL += l; sumS += s; lum[i] = l;
    if ((hh < 70 || hh > 320) && s > 0.25) warm++;
  }
  const brightness = sumL / (w * h), saturation = sumS / (w * h), warmth = warm / (w * h);

  // Saliency: per-cell color distance from the global mean + local edge density.
  const G = 12, cw = w / G, ch = h / G;
  const mean = [0, 0, 0];
  for (let i = 0; i < w * h; i++) { mean[0] += data[i * 3]; mean[1] += data[i * 3 + 1]; mean[2] += data[i * 3 + 2]; }
  mean.forEach((_, j) => { mean[j] /= w * h; });
  const cells = [];
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    let dist = 0, edge = 0, cnt = 0;
    for (let y = Math.floor(gy * ch); y < Math.floor((gy + 1) * ch); y++) for (let x = Math.floor(gx * cw); x < Math.floor((gx + 1) * cw); x++) {
      const i = y * w + x;
      dist += Math.hypot(data[i * 3] - mean[0], data[i * 3 + 1] - mean[1], data[i * 3 + 2] - mean[2]);
      if (x + 1 < w) edge += Math.abs(lum[i] - lum[i + 1]);
      if (y + 1 < h) edge += Math.abs(lum[i] - lum[i + w]);
      cnt++;
    }
    cells.push({ gx, gy, score: cnt ? dist / cnt / 255 + (edge / cnt) * 2 : 0 });
  }
  const sorted = [...cells].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 14);
  let fx = 0, fy = 0, fw = 0;
  for (const c of top) { fx += (c.gx + 0.5) / G * c.score; fy += (c.gy + 0.5) / G * c.score; fw += c.score; }
  const focal = { x: round(clamp(fx / fw, 0.15, 0.85)), y: round(clamp(fy / fw, 0.15, 0.85)) };
  // Edge color = likely background tone (for letterbox / intro)
  const edgePx = [];
  for (let x = 0; x < w; x++) { edgePx.push(x, (h - 1) * w + x); }
  const edge = [0, 0, 0];
  edgePx.forEach((i) => { edge[0] += data[i * 3]; edge[1] += data[i * 3 + 1]; edge[2] += data[i * 3 + 2]; });
  edge.forEach((_, j) => { edge[j] /= edgePx.length; });

  return {
    width: meta.width, height: meta.height, aspect: round(meta.width / meta.height, 4),
    orientation: meta.width > meta.height * 1.1 ? 'landscape' : meta.height > meta.width * 1.1 ? 'portrait' : 'square',
    palette: palette.map((p) => ({ hex: p.hex, share: round(p.share) })),
    brightness: round(brightness), saturation: round(saturation), warmth: round(warmth),
    edgeColor: toHex(edge), focal,
    saliencyGrid: { size: G, top: top.slice(0, 8).map((c) => [c.gx, c.gy]) },
  };
}

/** Bounding box of non-transparent pixels, in source pixels. */
export async function alphaBBox(file) {
  const img = sharp(file).ensureAlpha();
  const meta = await sharp(file).metadata();
  const scale = Math.min(1, 512 / Math.max(meta.width, meta.height));
  const { data, info } = await img.resize(Math.round(meta.width * scale), Math.round(meta.height * scale), { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1, opaque = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 16) { opaque++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { x: 0, y: 0, w: meta.width, h: meta.height, coverage: 0, hasAlpha: !!meta.hasAlpha };
  return {
    x: Math.round(x0 / scale), y: Math.round(y0 / scale),
    w: Math.round((x1 - x0 + 1) / scale), h: Math.round((y1 - y0 + 1) / scale),
    coverage: round(opaque / (info.width * info.height)), hasAlpha: !!meta.hasAlpha,
  };
}

/** Mood words from colour statistics (combined later with text/brief keywords). */
export function colorMood(stats) {
  const m = [];
  if (stats.saturation > 0.45 && stats.brightness > 0.45) m.push('energetic', 'playful');
  if (stats.saturation > 0.5 && stats.warmth > 0.35) m.push('sale', 'festive');
  if (stats.brightness < 0.3) m.push('luxury', 'premium');
  if (stats.saturation < 0.22 && stats.brightness > 0.55) m.push('calm', 'minimal');
  if (stats.saturation < 0.35 && stats.brightness >= 0.3 && stats.brightness <= 0.6) m.push('corporate');
  if (stats.warmth > 0.4) m.push('warm');
  if (!m.length) m.push('corporate');
  return m;
}
