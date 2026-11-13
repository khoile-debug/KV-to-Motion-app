// Kiểm thử nghiệm thu (server phải đang chạy: npm start). node tests/e2e.mjs [--no-render]
// 1) KV phẳng, không mẫu, không brief, không chọn preset → preview có chuyển động + nhạc + giọng đọc
// 2) KV có lớp + mẫu MP4 → ánh xạ chuyển động từng lớp theo mẫu
// 3) KV phẳng + mẫu GIF có chuyển động riêng từng lớp → hiệu ứng toàn ảnh + danh sách lớp cần bổ sung
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.KV_URL || 'http://localhost:5178';
const RENDER = !process.argv.includes('--no-render');
const OUT = path.join(ROOT, 'samples/output');
fs.mkdirSync(OUT, { recursive: true });
const S = (f) => path.join(ROOT, 'samples', f);
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`); if (!cond) failures++; };

async function create(files, fields = {}) {
  const fd = new FormData();
  for (const [k, f] of Object.entries(files)) fd.append(k, new Blob([fs.readFileSync(f)]), path.basename(f));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(`${BASE}/api/projects`, { method: 'POST', body: fd });
  const j = await r.json(); if (!r.ok) throw new Error(j.error);
  return j.id;
}
async function wait(id, type, timeoutS = 600) {
  for (let i = 0; i < timeoutS; i++) {
    const j = await (await fetch(`${BASE}/api/projects/${id}`)).json();
    if (j.job && j.job.type === type && j.job.status !== 'running') {
      if (j.job.status === 'error') throw new Error(`${type} lỗi: ${j.job.error}`);
      return j;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('timeout');
}
async function render(id, label) {
  if (!RENDER) return null;
  await fetch(`${BASE}/api/projects/${id}/render`, { method: 'POST' });
  const j = await wait(id, 'render', 900);
  const r = j.project.renders[0];
  const dst = path.join(OUT, `${label}.mp4`);
  fs.copyFileSync(path.join(ROOT, 'data/projects', id, r.file), dst);
  check(r.hasAudio && Math.abs(r.duration - j.timeline.duration) < 0.3, `MP4 ${r.width}×${r.height}, ${r.duration.toFixed(2)}s, có âm thanh → ${path.relative(ROOT, dst)}`);
  return r;
}
const animated = (tl) => tl.layers.filter((l) => (l.in?.preset && l.in.preset !== 'none') || (l.loop?.preset && l.loop.preset !== 'none')).length + (tl.camera?.keys?.length > 1 ? 1 : 0);

// ---------------------------------------------------------------- 1
console.log('\n[1] KV phẳng, không mẫu, không brief');
{
  const id = await create({ kv: S('flat_kv_coffee.png') }, { name: 'Test1 - KV phang tu dong' });
  const { timeline: tl, project: p } = await wait(id, 'create');
  check(tl.canvas.width / tl.canvas.height === 1080 / 1350, `giữ tỷ lệ gốc (${tl.canvas.width}×${tl.canvas.height})`);
  check(tl.duration >= 8 && tl.duration <= 10, `thời lượng mặc định 8–10s (${tl.duration}s)`);
  check(animated(tl) >= 2, `tự đề xuất chuyển động (phong cách ${tl.style}, camera ${tl.camera?.keys?.length} key, ${animated(tl)} hiệu ứng)`);
  check(!!tl.audio.music?.mix, `tự chọn nhạc: ${tl.audio.music?.title}`);
  const lines = tl.audio.voice.lines;
  check(lines.length >= 2 && !!tl.audio.voice.mix && !tl.audio.voice.muted, `tự viết & đọc lời thoại (${lines.length} câu): ${lines.map((l) => l.text).join(' | ')}`);
  const facts = p.analysis.facts;
  for (const k of ['price', 'datetime']) if (facts[k]) check(lines.some((l) => l.text.includes(facts[k])), `lời thoại giữ nguyên văn ${k}: "${facts[k]}"`);
  check(lines.every((l, i) => i === 0 || l.start >= lines[i - 1].start), `canh lời theo thời điểm xuất hiện: ${lines.map((l) => l.start + 's').join(', ')}`);
  await render(id, '1_flat_auto');
}

// ---------------------------------------------------------------- 2
console.log('\n[2] KV có lớp + mẫu MP4');
{
  const id = await create({ background: S('layered_background.png'), subject: S('layered_subject.png'), logo: S('layered_logo.png'), text: S('layered_text.png'), template: S('template_layered_A.mp4') },
    { name: 'Test2 - KV co lop + mau', brief: JSON.stringify({ brand: 'NOVA TECH' }) });
  const { timeline: tl, project: p } = await wait(id, 'create');
  const tpl = p.template;
  check(tpl.events.length >= 3, `phân tích mẫu: ${tpl.events.map((e) => `${e.motion.type}${e.motion.from !== 'none' ? '←' + e.motion.from : ''}@${e.t0}s`).join(', ')}; giữ cuối ${tpl.hold}s`);
  const L = (role) => tl.layers.find((l) => l.role === role);
  check(L('subject')?.in?.preset === 'slide-right', `chủ thể trượt từ phải như mẫu (${L('subject')?.in?.preset} @${L('subject')?.in?.at}s)`);
  check(L('background')?.in?.preset === 'fade', `nền hiện mờ từ đen như mẫu (${L('background')?.in?.preset})`);
  check((tl.template?.mapping || []).length >= 3, `ánh xạ sự kiện → lớp: ${(tl.template?.mapping || []).map((m) => `${m.event}→${m.layer}`).join(', ')}`);
  check(fs.existsSync(path.join(ROOT, 'data/projects', id, 'timeline.json')), 'lưu timeline JSON có thể chỉnh sửa');
  check(!!tl.audio.music?.mix && tl.audio.voice.lines.length > 0, `nhạc + lời thoại: ${tl.audio.voice.lines.map((l) => l.text).join(' | ')}`);
  // edit: change duration & a layer, save, verify re-render of preview keeps edits
  tl.layers.find((l) => l.role === 'logo').in.preset = 'zoom-in';
  const r = await fetch(`${BASE}/api/projects/${id}/timeline`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timeline: tl }) });
  check(r.ok, 'lưu chỉnh sửa timeline');
  const after = await wait(id, 'update');
  check(after.timeline.layers.find((l) => l.role === 'logo').in.preset === 'zoom-in', 'chỉnh sửa được giữ sau khi cập nhật preview');
  await render(id, '2_layered_template');
}

// ---------------------------------------------------------------- 3
console.log('\n[3] KV phẳng + mẫu GIF có chuyển động riêng từng lớp');
{
  const id = await create({ kv: S('flat_kv_coffee.png'), template: S('template_flat_B.gif') }, { name: 'Test3 - KV phang + mau tung lop' });
  const { timeline: tl, project: p } = await wait(id, 'create');
  check(p.template.perLayer, `phát hiện mẫu có chuyển động riêng từng lớp (${p.template.events.length} sự kiện)`);
  check(animated(tl) >= 1, `tạo preview bằng hiệu ứng khả thi trên toàn ảnh (camera ${tl.camera?.keys?.length || 0} key, ${tl.layers.length - 1} vùng nhấn)`);
  const need = tl.notes.filter((n) => n.level === 'need-layer');
  check(need.length >= 2, `chỉ rõ lớp cần bổ sung: ${[...new Set(need.map((n) => n.role))].join(', ')}`);
  check(Math.abs(tl.duration - p.template.duration) < 0.01, `giữ nhịp/thời lượng của mẫu (${tl.duration}s)`);
  await render(id, '3_flat_with_layered_template');
}

console.log(failures ? `\n${failures} kiểm tra KHÔNG đạt` : '\nTất cả kiểm tra đều đạt ✔');
process.exit(failures ? 1 : 0);
