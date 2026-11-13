import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Run a command, resolve {code, stdout, stderr}; reject on non-zero unless allowFail. */
export function run(cmd, args, { cwd, input, allowFail = false, onStdout, onStderr, env, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env });
    let stdout = '', stderr = '';
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => { p.kill('SIGKILL'); }, timeoutMs);
    p.stdout.on('data', (d) => { const s = d.toString(); stdout += s; onStdout && onStdout(s); });
    p.stderr.on('data', (d) => { const s = d.toString(); stderr += s; onStderr && onStderr(s); });
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(`Không chạy được ${cmd}: ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !allowFail) {
        const tail = (stderr || stdout).split('\n').filter(Boolean).slice(-8).join('\n');
        return reject(new Error(`${path.basename(cmd)} lỗi (mã ${code}): ${tail}`));
      }
      resolve({ code, stdout, stderr });
    });
    if (input != null) { p.stdin.write(input); }
    p.stdin.end();
  });
}

/** Run a command and return raw stdout as Buffer. */
export function runBuffer(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd });
    const chunks = []; let stderr = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} lỗi: ${stderr.slice(-500)}`)));
    p.stdin.end();
  });
}

export async function ffprobe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames', '-of', 'json', file]);
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const [n, d] = (v?.r_frame_rate || '0/1').split('/').map(Number);
  return {
    duration: Number(j.format?.duration || 0),
    width: v?.width || 0, height: v?.height || 0,
    fps: d ? n / d : 0,
    hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

export const readJSON = (f, def = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
export const writeJSON = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 2)); };
export const hash = (s) => crypto.createHash('sha1').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex').slice(0, 12);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
export const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
