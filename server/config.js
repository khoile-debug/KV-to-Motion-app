import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON } from './util.js';

function deepMerge(a, b) {
  if (!b) return a;
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  }
  return out;
}

// Load .env (KEY=VALUE lines) if present — simple, no dependency.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

let cfg = readJSON(path.join(ROOT, 'config/default.json'));
cfg = deepMerge(cfg, readJSON(path.join(ROOT, 'config/local.json'), {}));
// Env overrides for the most common switches
if (process.env.KV_TTS_PROVIDER) cfg.tts.provider = process.env.KV_TTS_PROVIDER;
if (process.env.KV_TTS_VOICE) cfg.tts.voice = process.env.KV_TTS_VOICE;
if (process.env.KV_VISION_PROVIDER) cfg.vision.provider = process.env.KV_VISION_PROVIDER;
if (process.env.PORT) cfg.port = Number(process.env.PORT);
cfg.dataDir = path.resolve(ROOT, cfg.dataDir);

export function visionProvider() {
  const p = cfg.vision.provider;
  if (p === 'auto') return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'claude' : 'heuristic';
  return p;
}

export default cfg;
