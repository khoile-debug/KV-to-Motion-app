// Render MP4 bằng HyperFrames từ chính composition của preview.
import fs from 'node:fs';
import path from 'node:path';
import cfg from './config.js';
import { ROOT, run, ffprobe, writeJSON } from './util.js';
import { pdir, loadTimeline } from './pipeline.js';
import { buildComposition } from './compose.js';

const HF = path.join(ROOT, 'node_modules/.bin/hyperframes');

export async function renderMp4(p, { log, progress }) {
  const dir = pdir(p.id);
  const tl = loadTimeline(p.id);
  const html = buildComposition(dir, tl);
  const build = path.dirname(html);
  writeJSON(path.join(build, 'meta.json'), { id: p.id, name: p.name || p.id });
  writeJSON(path.join(build, 'hyperframes.json'), { paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' } });
  fs.mkdirSync(path.join(dir, 'renders'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const out = path.join(dir, 'renders', `${(p.name || 'kv').replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${stamp}.mp4`);
  const args = ['render', '-o', out, '-q', cfg.render.quality || 'standard', '-f', String(tl.canvas.fps || cfg.render.fps || 30), '-w', String(cfg.render.workers || 2), '--quiet'];
  log(`hyperframes ${args.join(' ')}`);
  let last = -1;
  const onData = (s) => {
    for (const line of s.split('\n')) {
      const m = line.match(/@hf-progress (\{.*\})/);
      if (m) { try { const j = JSON.parse(m[1]); if (j.pct !== last) { last = j.pct; progress(j.pct, j.code); } } catch { /* ignore */ } }
    }
  };
  // --quiet suppresses the progress lines on some versions; run without it if nothing arrives
  const res = await run(HF, args.filter((a) => a !== '--quiet'), { cwd: build, onStdout: onData, onStderr: onData, allowFail: true, env: { DO_NOT_TRACK: '1', HYPERFRAMES_SKIP_SKILLS: '1' }, timeoutMs: 20 * 60 * 1000 });
  if (res.code !== 0 || !fs.existsSync(out)) {
    const tail = (res.stderr + res.stdout).split('\n').filter((l) => l && !l.startsWith('@hf-progress') && !l.includes('[Render:trace]')).slice(-12).join('\n');
    throw new Error('Render thất bại:\n' + tail);
  }
  const info = await ffprobe(out);
  if (Math.abs(info.duration - tl.duration) > 0.25) log(`Cảnh báo: thời lượng MP4 ${info.duration}s khác timeline ${tl.duration}s`);
  const rel = path.relative(dir, out);
  fs.copyFileSync(out, path.join(dir, 'output.mp4'));
  return { file: rel, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, size: fs.statSync(out).size };
}
