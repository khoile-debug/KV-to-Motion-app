// Chụp khung hình composition tại các thời điểm: node tools/snapshot.mjs <build/index.html> <out.png> t1,t2,...
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const [file, out, times = '0,1,2,4,8'] = process.argv.slice(2);
const html = path.resolve(file);
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + html);
await p.waitForFunction(() => !!(window.__timelines && window.__timelines.main), null, { polling: 100 });
const { w, h } = await p.evaluate(() => { const r = document.getElementById('root'); return { w: Number(r.dataset.width), h: Number(r.dataset.height) }; });
await p.setViewportSize({ width: w, height: h });
const ts = times.split(',').map(Number);
const scale = 360 / w;
const shots = [];
for (const t of ts) {
  await p.evaluate((t) => { window.__timelines.main.seek(t, false); }, t);
  await p.evaluate(() => document.fonts.ready);
  shots.push((await p.screenshot({ clip: { x: 0, y: 0, width: w, height: h } })).toString('base64'));
}
const sheet = await b.newPage({ viewport: { width: Math.round(w * scale) * ts.length + 10 * ts.length, height: Math.round(h * scale) + 30 } });
await sheet.setContent(`<body style="margin:0;background:#222;display:flex;gap:10px;font:14px sans-serif;color:#fff">${shots.map((s, i) => `<div><img src="data:image/png;base64,${s}" style="width:${Math.round(w * scale)}px;display:block"><div>t=${ts[i]}s</div></div>`).join('')}</body>`);
await sheet.screenshot({ path: out, fullPage: true });
await b.close();
