// Thư viện nhạc đã có quyền sử dụng: library/music/library.json. Chọn theo sắc thái KV + nhịp bản dựng.
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, readJSON } from '../util.js';

export const MUSIC_DIR = path.join(ROOT, 'library/music');

export function listMusic() {
  const lib = readJSON(path.join(MUSIC_DIR, 'library.json'), { tracks: [] });
  return lib.tracks.filter((t) => fs.existsSync(path.join(MUSIC_DIR, t.file)));
}

const STYLE_ENERGY = { energetic: 0.9, playful: 0.75, festive: 0.7, corporate: 0.55, calm: 0.25, luxury: 0.45, template: 0.6 };

/** moods: words from KV analysis; style: motion style; tempo: optional events per second of the edit */
export function selectMusic(moods = [], style = 'corporate', eventsPerSec = null) {
  const tracks = listMusic();
  if (!tracks.length) return null;
  const targetEnergy = eventsPerSec != null ? Math.min(1, 0.25 + eventsPerSec * 0.35) * 0.5 + (STYLE_ENERGY[style] ?? 0.5) * 0.5 : (STYLE_ENERGY[style] ?? 0.5);
  const scored = tracks.map((t) => {
    let s = 0;
    moods.forEach((m, i) => { if (t.mood.includes(m)) s += i < 3 ? 2 : 1; });
    if (t.mood.includes(style)) s += 1.5;
    s -= Math.abs(t.energy - targetEnergy) * 4;
    return { t, s };
  }).sort((a, b) => b.s - a.s);
  return { ...scored[0].t, reason: `khớp sắc thái [${moods.slice(0, 4).join(', ')}], năng lượng mục tiêu ${targetEnergy.toFixed(2)}`, alternatives: scored.slice(1, 4).map((x) => x.t.id) };
}
