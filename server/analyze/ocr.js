// OCR (tesseract, vie+eng) → các dòng chữ có bbox (đơn vị px của ảnh gốc).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../util.js';

let available = null;
export async function ocrAvailable() {
  if (available != null) return available;
  try { const r = await run('tesseract', ['--list-langs'], { allowFail: true }); available = /vie/.test(r.stdout + r.stderr) ? 'vie+eng' : (/eng/.test(r.stdout + r.stderr) ? 'eng' : false); }
  catch { available = false; }
  return available;
}

function parseTsv(tsv, scale) {
  const words = [];
  for (const line of tsv.split('\n').slice(1)) {
    const c = line.split('\t');
    if (c.length < 12) continue;
    const conf = Number(c[10]); const text = (c[11] || '').trim();
    if (!text || conf < 40) continue;
    if (!/[\p{L}\p{N}%₫$]/u.test(text)) continue;
    words.push({ text, conf, x: c[6] / scale, y: c[7] / scale, w: c[8] / scale, h: c[9] / scale });
  }
  return words;
}

/** Group words into lines geometrically (works across PSM modes). */
function groupLines(words) {
  words.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const lines = [];
  for (const w of words) {
    const cy = w.y + w.h / 2;
    let target = null;
    for (const l of lines) {
      const lcy = l.y + l.h / 2;
      const sameRow = Math.abs(lcy - cy) < Math.max(l.h, w.h) * 0.5 && Math.abs(l.h - w.h) < Math.max(l.h, w.h) * 0.6;
      const gap = w.x - (l.x + l.w);
      if (sameRow && gap < Math.max(l.h, w.h) * 1.6 && gap > -w.w) { target = l; break; }
    }
    if (target) {
      const x1 = Math.max(target.x + target.w, w.x + w.w), y1 = Math.max(target.y + target.h, w.y + w.h);
      target.x = Math.min(target.x, w.x); target.y = Math.min(target.y, w.y);
      target.w = x1 - target.x; target.h = y1 - target.y;
      target.words.push(w);
    } else lines.push({ x: w.x, y: w.y, w: w.w, h: w.h, words: [w] });
  }
  // second pass: merge fragments of the same row (tesseract often splits big display type)
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < lines.length && !changed; i++) for (let j = 0; j < lines.length && !changed; j++) {
      if (i === j) continue;
      const A = lines[i], Bl = lines[j];
      const ov = Math.min(A.y + A.h, Bl.y + Bl.h) - Math.max(A.y, Bl.y);
      const gap = Bl.x - (A.x + A.w);
      if (ov > 0.5 * Math.min(A.h, Bl.h) && gap > -0.3 * Bl.w && gap < 1.2 * Math.max(A.h, Bl.h)) {
        const x1 = Math.max(A.x + A.w, Bl.x + Bl.w), y1 = Math.max(A.y + A.h, Bl.y + Bl.h);
        A.x = Math.min(A.x, Bl.x); A.y = Math.min(A.y, Bl.y); A.w = x1 - A.x; A.h = y1 - A.y; A.words.push(...Bl.words);
        lines.splice(j, 1); changed = true;
      }
    }
  }
  return lines.map((l) => {
    l.words.sort((a, b) => a.x - b.x);
    return {
      text: l.words.map((w) => w.text).join(' '),
      conf: Math.round(l.words.reduce((s, w) => s + w.conf, 0) / l.words.length),
      bbox: { x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) },
      size: Math.round(l.words.reduce((s, w) => s + w.h, 0) / l.words.length),
    };
  }).filter((l) => l.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 2 || /\d/.test(l.text));
}

export async function ocrImage(file, workDir) {
  const lang = await ocrAvailable();
  if (!lang) return { available: false, lines: [] };
  const meta = await sharp(file).metadata();
  const scale = Math.min(3, Math.max(1, 1800 / Math.max(meta.width, meta.height)));
  fs.mkdirSync(workDir, { recursive: true });
  const variants = [];
  const base = path.join(workDir, 'ocr_a.png');
  await sharp(file).flatten({ background: '#fff' }).resize(Math.round(meta.width * scale)).grayscale().normalize().toFile(base);
  variants.push(base);
  const inv = path.join(workDir, 'ocr_b.png'); // light text on dark backgrounds
  await sharp(base).negate({ alpha: false }).toFile(inv);
  variants.push(inv);
  // light text on coloured buttons/badges: binarise, then make the text dark
  for (const th of [185, 120]) {
    const bin = path.join(workDir, `ocr_t${th}.png`);
    await sharp(base).threshold(th).negate({ alpha: false }).toFile(bin);
    variants.push(bin);
  }
  let words = [];
  for (const v of variants) {
    for (const psm of v === base || v === inv ? ['11', '3'] : ['11']) {
      const r = await run('tesseract', [v, 'stdout', '-l', lang, '--psm', psm, 'tsv'], { allowFail: true, timeoutMs: 60000 });
      words.push(...parseTsv(r.stdout, scale));
    }
  }
  // de-duplicate words found by several passes (keep highest confidence)
  words.sort((a, b) => b.conf - a.conf);
  const kept = [];
  for (const w of words) {
    const dup = kept.find((k) => {
      const ix = Math.max(0, Math.min(k.x + k.w, w.x + w.w) - Math.max(k.x, w.x));
      const iy = Math.max(0, Math.min(k.y + k.h, w.y + w.h) - Math.max(k.y, w.y));
      return ix * iy > 0.4 * Math.min(k.w * k.h, w.w * w.h);
    });
    if (!dup) kept.push(w);
    else {
      // same word read with/without diacritics → keep the one with diacritics (vie pass)
      const plain = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
      const marks = (t) => (t.normalize('NFD').match(/[\u0300-\u036f]/g) || []).length + (t.match(/[đĐ]/g) || []).length;
      if (plain(dup.text) === plain(w.text) && marks(dup.text) === 0 && marks(w.text) > 0 && w.conf >= 60) dup.text = w.text;
    }
  }
  return { available: true, lang, lines: groupLines(kept) };
}
