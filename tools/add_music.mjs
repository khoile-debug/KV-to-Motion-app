// Thêm một bài nhạc đã có quyền sử dụng vào thư viện.
// node tools/add_music.mjs <file.mp3|wav> --title "Tên" --mood energetic,sale --bpm 120 --energy 0.8 --license "Nguồn/giấy phép"
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'library/music');
const [src, ...rest] = process.argv.slice(2);
const arg = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };
if (!src || !fs.existsSync(src)) { console.error('Cách dùng: node tools/add_music.mjs <file> --title "..." --mood a,b --bpm 110 --energy 0.6 --license "..."'); process.exit(1); }
const license = arg('license');
if (!license) { console.error('Bắt buộc ghi --license (nguồn & quyền sử dụng) để đảm bảo chỉ dùng nhạc đã có quyền.'); process.exit(1); }
const id = arg('id', path.basename(src).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const file = `${id}.wav`;
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ac', '2', '-ar', '44100', path.join(DIR, file)]);
const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(DIR, file)]).toString());
const libFile = path.join(DIR, 'library.json');
const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
lib.tracks = lib.tracks.filter((t) => t.id !== id);
lib.tracks.push({ id, title: arg('title', id), file, bpm: Number(arg('bpm', 110)), energy: Number(arg('energy', 0.5)),
  mood: arg('mood', 'corporate').split(',').map((s) => s.trim()).filter(Boolean), duration: Math.round(duration * 1000) / 1000, loopable: true, license });
fs.writeFileSync(libFile, JSON.stringify(lib, null, 2));
console.log(`Đã thêm "${id}" (${duration.toFixed(1)}s) vào thư viện. Khởi động lại server để dùng.`);
