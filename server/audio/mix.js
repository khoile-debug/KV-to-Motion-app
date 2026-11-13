// Ghép giọng đọc theo thời điểm, hạ nhạc dưới lời thoại (sidechain ducking), fade-out cuối video.
import fs from 'node:fs';
import path from 'node:path';
import { run, round } from '../util.js';
import { MUSIC_DIR } from './music.js';

/**
 * Place VO segments: each line starts at its anchor (when its info appears), pushed later if it would overlap.
 * If the total overflows the usable span, gaps are tightened, then lines are sped up (≤1.25x).
 * segs: [{start, dur}] (start = desired anchor). Returns adjusted [{start, speed}].
 */
export function alignSegments(segs, D, fadeOut, gap = 0.25) {
  const limit = D - Math.max(0.6, fadeOut * 0.6);
  let speed = 1;
  for (let attempt = 0; attempt < 6; attempt++) {
    const out = []; let cursor = 0.15;
    for (const s of segs) { const st = Math.max(s.start, cursor); out.push({ start: round(st, 3), speed }); cursor = st + s.dur / speed + gap; }
    const end = out.length ? out[out.length - 1].start + segs[segs.length - 1].dur / speed : 0;
    if (end <= limit || !out.length) return { placed: out, overflow: 0, speed };
    // tighten: shift anchors earlier proportionally
    const k = limit / end;
    segs = segs.map((s) => ({ ...s, start: s.start * k }));
    if (attempt >= 2) speed = Math.min(1.25, speed + 0.08);
    if (attempt === 5) return { placed: out, overflow: round(end - limit, 2), speed };
  }
  return { placed: [], overflow: 0, speed };
}

export async function buildVoiceTrack(projectDir, segments, D) {
  const out = path.join(projectDir, 'audio', 'vo.wav');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!segments.length) { fs.rmSync(out, { force: true }); return null; }
  const args = ['-v', 'error', '-y'];
  segments.forEach((s) => args.push('-i', path.join(projectDir, s.file)));
  const f = segments.map((s, i) => {
    const tempo = s.speed && Math.abs(s.speed - 1) > 0.01 ? `atempo=${s.speed},` : '';
    const ms = Math.round(s.start * 1000);
    return `[${i}:a]${tempo}adelay=${ms}|${ms}[v${i}]`;
  });
  f.push(`${segments.map((_, i) => `[v${i}]`).join('')}amix=inputs=${segments.length}:normalize=0:dropout_transition=0,apad=whole_dur=${D},atrim=0:${D}[out]`);
  args.push('-filter_complex', f.join(';'), '-map', '[out]', '-ac', '2', '-ar', '44100', out);
  await run('ffmpeg', args);
  return 'audio/vo.wav';
}

/** Music: loop/trim to D, duck under VO, fade out at the end. */
export async function buildMusicTrack(projectDir, track, D, { voFile, duckDb = 12, fadeOut = 1.5 } = {}) {
  const out = path.join(projectDir, 'audio', 'music_mix.wav');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const src = path.join(MUSIC_DIR, track.file);
  const fadeStart = Math.max(0, D - fadeOut);
  const args = ['-v', 'error', '-y', '-stream_loop', '-1', '-i', src];
  let filter;
  if (voFile) {
    args.push('-i', path.join(projectDir, voFile));
    // ratio chosen so speech at ~-16 LUFS pulls music down by ≈duckDb
    const ratio = Math.max(2, Math.min(20, duckDb / 2));
    filter = `[0:a]atrim=0:${D},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[m];` +
      `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=1[sc];` +
      `[m][sc]sidechaincompress=threshold=0.015:ratio=${ratio}:attack=40:release=450:makeup=1[d];` +
      `[d]afade=t=in:st=0:d=0.3,afade=t=out:st=${round(fadeStart, 3)}:d=${round(fadeOut, 3)}[out]`;
  } else {
    filter = `[0:a]atrim=0:${D},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo,afade=t=in:st=0:d=0.3,afade=t=out:st=${round(fadeStart, 3)}:d=${round(fadeOut, 3)}[out]`;
  }
  args.push('-filter_complex', filter, '-map', '[out]', '-t', String(D), '-ar', '44100', out);
  await run('ffmpeg', args);
  return 'audio/music_mix.wav';
}
