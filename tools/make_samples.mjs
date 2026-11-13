// Tạo dữ liệu kiểm thử: KV phẳng, KV có lớp và 2 video mẫu chuyển động (thương hiệu hư cấu).
// node tools/make_samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'samples');
fs.mkdirSync(OUT, { recursive: true });
const fontCss = (pkg, w) => fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource', pkg, `${w}.css`), 'utf8')
  .replace(/url\(\.\/files\//g, `url(file://${path.join(ROOT, 'node_modules/@fontsource', pkg, 'files')}/`);
const FONTS = [fontCss('be-vietnam-pro', 400), fontCss('be-vietnam-pro', 800), fontCss('be-vietnam-pro', 900), fontCss('playfair-display', 700)].join('\n');

const browser = await chromium.launch();
async function shot(html, w, h, file, transparent = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
}

// ---------------------------------------------------------------- 1) flat KV 1080x1350 (coffee promo)
const cup = `<svg viewBox="0 0 400 420" width="520" height="546">
  <ellipse cx="200" cy="395" rx="170" ry="22" fill="rgba(0,0,0,.25)"/>
  <path d="M60 120 h280 l-30 250 a30 30 0 0 1 -30 26 h-160 a30 30 0 0 1 -30 -26 z" fill="#fff8ef"/>
  <path d="M75 150 h250 l-25 205 h-200 z" fill="#6b3e26"/>
  <path d="M75 150 h250 l-6 50 h-238 z" fill="#e9d2b5"/>
  <rect x="45" y="95" width="310" height="34" rx="14" fill="#ffffff"/>
  <rect x="190" y="10" width="16" height="110" rx="6" fill="#ff7a59" transform="rotate(12 198 60)"/>
  <circle cx="300" cy="300" r="8" fill="#fff" opacity=".5"/></svg>`;
await shot(`<html><head><style>${FONTS}
body{margin:0;width:1080px;height:1350px;font-family:'Be Vietnam Pro';overflow:hidden;
background:radial-gradient(circle at 70% 35%,#ffb36b 0,#f2742b 38%,#b9381c 100%);color:#fff;position:relative}
.logo{position:absolute;top:60px;left:0;right:0;text-align:center;font-weight:900;font-size:46px;letter-spacing:.12em}
.logo small{display:block;font-size:20px;font-weight:400;letter-spacing:.3em;opacity:.85}
.h{position:absolute;top:175px;left:60px;right:60px;text-align:center;font-weight:900;font-size:104px;line-height:1.02;text-shadow:0 6px 0 #8a2a12}
.cup{position:absolute;top:430px;left:280px}
.price{position:absolute;top:960px;left:0;right:0;text-align:center}
.price span{display:inline-block;background:#fff;color:#c2361a;font-weight:900;font-size:78px;padding:6px 40px;border-radius:24px;transform:rotate(-3deg)}
.date{position:absolute;top:1100px;left:0;right:0;text-align:center;font-weight:800;font-size:40px}
.cta{position:absolute;top:1175px;left:0;right:0;text-align:center}
.cta span{display:inline-block;background:#2b1408;color:#fff;font-weight:800;font-size:40px;padding:16px 64px;border-radius:999px}
.terms{position:absolute;bottom:22px;left:0;right:0;text-align:center;font-size:20px;opacity:.85}
.bean{position:absolute;width:60px;height:38px;border-radius:50%;background:#5a2d16;opacity:.35}
</style></head><body>
<div class="bean" style="left:90px;top:520px;transform:rotate(30deg)"></div><div class="bean" style="left:900px;top:760px;transform:rotate(-20deg)"></div>
<div class="bean" style="left:140px;top:860px;transform:rotate(70deg)"></div>
<div class="logo">LUMI COFFEE<small>CÀ PHÊ RANG XAY</small></div>
<div class="h">CÀ PHÊ MUỐI<br>MỚI RA LÒ</div>
<div class="cup">${cup}</div>
<div class="price"><span>CHỈ 29.000Đ</span></div>
<div class="date">Từ 15/11 đến 30/11/2026</div>
<div class="cta"><span>ĐẶT NGAY</span></div>
<div class="terms">*Áp dụng tại tất cả cửa hàng Lumi Coffee</div>
</body></html>`, 1080, 1350, path.join(OUT, 'flat_kv_coffee.png'));

// ---------------------------------------------------------------- 2) layered KV 1920x1080 (phone launch)
const W = 1920, H = 1080;
const phone = `<svg viewBox="0 0 300 600" width="400" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7cf3ff"/><stop offset="1" stop-color="#7b5cff"/></linearGradient></defs>
<rect x="5" y="5" width="290" height="590" rx="44" fill="#14141f" stroke="#cfd3ff" stroke-width="6"/>
<rect x="20" y="20" width="260" height="560" rx="32" fill="url(#g)"/><rect x="115" y="34" width="70" height="18" rx="9" fill="#14141f"/>
<circle cx="150" cy="300" r="70" fill="rgba(255,255,255,.35)"/></svg>`;
const parts = {
  background: `<div style="position:absolute;inset:0;background:linear-gradient(120deg,#0b1030 0%,#1b1f6b 55%,#3a1a6e 100%)"></div>
    <div style="position:absolute;left:1180px;top:140px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,#5d7bff88,transparent 70%)"></div>
    <div style="position:absolute;left:-200px;top:700px;width:900px;height:500px;border-radius:50%;background:radial-gradient(circle,#ff5ac855,transparent 70%)"></div>`,
  subject: `<div style="position:absolute;left:1290px;top:150px;transform:rotate(-8deg)">${phone}</div>`,
  logo: `<div style="position:absolute;left:120px;top:80px;font:900 52px 'Be Vietnam Pro';color:#fff;letter-spacing:.08em">NOVA<span style="color:#7cf3ff">●</span>TECH</div>`,
  text: `<div style="position:absolute;left:120px;top:300px;font:900 120px/1.0 'Be Vietnam Pro';color:#fff">NOVA X1</div>
    <div style="position:absolute;left:124px;top:440px;font:400 46px 'Be Vietnam Pro';color:#cfd3ff">Siêu mỏng. Pin 2 ngày.</div>
    <div style="position:absolute;left:120px;top:560px;font:900 92px 'Be Vietnam Pro';color:#7cf3ff">7.990.000đ</div>
    <div style="position:absolute;left:124px;top:690px;font:800 40px 'Be Vietnam Pro';color:#fff">Mở bán 20/11/2026</div>
    <div style="position:absolute;left:120px;top:790px;background:#ff5ac8;color:#fff;font:800 42px 'Be Vietnam Pro';padding:18px 58px;border-radius:999px">ĐẶT TRƯỚC NGAY</div>`,
};
for (const [name, html] of Object.entries(parts)) {
  await shot(`<html><head><style>${FONTS} body{margin:0;width:${W}px;height:${H}px;position:relative;overflow:hidden;background:transparent}</style></head><body>${html}</body></html>`,
    W, H, path.join(OUT, `layered_${name}.png`), name !== 'background');
}
await shot(`<html><head><style>${FONTS} body{margin:0;width:${W}px;height:${H}px;position:relative;overflow:hidden}</style></head><body>${Object.values(parts).join('')}</body></html>`,
  W, H, path.join(OUT, 'layered_composite.png'));
await browser.close();

// ---------------------------------------------------------------- 3) motion templates rendered with HyperFrames
const HF = path.join(ROOT, 'node_modules/.bin/hyperframes');
function hfTemplate(dir, w, h, D, body, script) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'node_modules/gsap/dist/gsap.min.js'), path.join(dir, 'gsap.min.js'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id: path.basename(dir), name: path.basename(dir) }));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta charset="UTF-8"><script src="gsap.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden;background:#000}.a{position:absolute}</style></head>
<body><div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="${w}" data-height="${h}" style="position:relative;width:${w}px;height:${h}px">
<div id="scene" class="clip" data-start="0" data-duration="${D}" style="position:absolute;inset:0">${body}</div></div>
<script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});${script}tl.set({}, {}, ${D});window.__timelines["main"]=tl;</script></body></html>`);
  execFileSync(HF, ['render', '-o', path.join(dir, 'out.mp4'), '-q', 'draft', '-f', '24'], { cwd: dir, stdio: 'ignore' });
  return path.join(dir, 'out.mp4');
}

// Template A (16:9, MP4): bg fade from black → subject slides in from right → text rises from bottom → logo pops; 1.8s hold
const tA = hfTemplate(path.join(OUT, '_tplA'), 960, 540, 5,
  `<div id="bg" class="a" style="inset:0;background:linear-gradient(120deg,#123,#345)"></div>
   <div id="sub" class="a" style="left:640px;top:70px;width:200px;height:400px;border-radius:24px;background:#f5c542"></div>
   <div id="txt" class="a" style="left:60px;top:170px;width:420px;height:200px;background:#fff;border-radius:8px"></div>
   <div id="logo" class="a" style="left:60px;top:40px;width:150px;height:50px;background:#e74c3c;border-radius:6px"></div>`,
  `tl.fromTo('#bg',{opacity:0},{opacity:1,duration:0.6,ease:'power1.out'},0);
   tl.fromTo('#sub',{x:420},{x:0,duration:0.8,ease:'power3.out'},0.6);
   tl.fromTo('#txt',{y:300,opacity:0},{y:0,opacity:1,duration:0.6,ease:'power2.out'},1.6);
   tl.fromTo('#logo',{scale:0},{scale:1,duration:0.5,ease:'back.out(1.7)'},2.4);`);
fs.copyFileSync(tA, path.join(OUT, 'template_layered_A.mp4'));

// Template B (4:5, GIF): per-element motion — badge from left, block from bottom, small sticker pops; 1.6s hold
const tB = hfTemplate(path.join(OUT, '_tplB'), 432, 540, 4.4,
  `<div class="a" style="inset:0;background:#f2742b"></div>
   <div id="top" class="a" style="left:40px;top:40px;width:352px;height:110px;background:#fff;border-radius:10px"></div>
   <div id="mid" class="a" style="left:110px;top:180px;width:212px;height:200px;background:#6b3e26;border-radius:50%"></div>
   <div id="bot" class="a" style="left:110px;top:400px;width:212px;height:56px;background:#2b1408;border-radius:28px"></div>`,
  `tl.fromTo('#top',{x:-480},{x:0,duration:0.7,ease:'power3.out'},0.3);
   tl.fromTo('#mid',{scale:0.2,opacity:0},{scale:1,opacity:1,duration:0.7,ease:'back.out(1.6)'},1.1);
   tl.fromTo('#bot',{y:200},{y:0,duration:0.6,ease:'power2.out'},2.0);`);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tB, '-vf', 'fps=15,scale=432:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', path.join(OUT, 'template_flat_B.gif')]);
for (const d of ['_tplA', '_tplB']) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
console.log('Samples written to', OUT, fs.readdirSync(OUT));
