// timeline.json → HyperFrames composition (index.html + GSAP). Cùng một file cho preview và render MP4.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, esc, round, clamp } from './util.js';
import { inFromVars, inToVars, DEFAULT_EASE, FONTS } from './plan/presets.js';

const GSAP = path.join(ROOT, 'node_modules/gsap/dist/gsap.min.js');

function nearestWeight(font, w) {
  const ws = FONTS[font]?.weights || [400];
  return ws.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), ws[0]);
}

function copyFonts(buildDir, used) {
  const css = [];
  for (const [font, weights] of Object.entries(used)) {
    const meta = FONTS[font]; if (!meta) continue;
    const pkgDir = path.join(ROOT, 'node_modules/@fontsource', meta.pkg);
    if (!fs.existsSync(pkgDir)) continue;
    const dst = path.join(buildDir, 'fonts', meta.pkg);
    fs.mkdirSync(path.join(dst, 'files'), { recursive: true });
    for (const w of weights) {
      const cssFile = path.join(pkgDir, `${w}.css`);
      if (!fs.existsSync(cssFile)) continue;
      let text = fs.readFileSync(cssFile, 'utf8');
      // keep only vietnamese + latin + latin-ext faces
      const blocks = text.split('/*').map((b) => '/*' + b).filter((b) => /@font-face/.test(b) && /(vietnamese|latin)/.test(b.split('*/')[0]));
      text = blocks.join('\n');
      for (const m of text.matchAll(/url\(\.\/files\/([^)]+)\)/g)) {
        const src = path.join(pkgDir, 'files', m[1]);
        if (fs.existsSync(src) && !fs.existsSync(path.join(dst, 'files', m[1]))) fs.copyFileSync(src, path.join(dst, 'files', m[1]));
      }
      css.push(text.replace(/url\(\.\/files\//g, `url(fonts/${meta.pkg}/files/`).replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, ''));
    }
  }
  return css.join('\n');
}

function camTransform(k, W, H) {
  const s = Math.max(1, k.scale || 1);
  const cx = clamp(k.cx ?? 0.5, 0.5 / s, 1 - 0.5 / s), cy = clamp(k.cy ?? 0.5, 0.5 / s, 1 - 0.5 / s);
  return { scale: round(s, 4), x: round(W / 2 - s * cx * W, 2), y: round(H / 2 - s * cy * H, 2) };
}

function textStyle(st = {}, isCta) {
  const s = [];
  s.push(`font-family:'${st.font || 'Be Vietnam Pro'}',sans-serif`);
  s.push(`font-weight:${st.weight || (isCta ? 800 : 700)}`);
  s.push(`font-size:${st.size || 48}px`);
  s.push(`line-height:${st.lineHeight || 1.15}`);
  s.push(`color:${st.color || '#ffffff'}`);
  s.push(`text-align:${st.align || 'center'}`);
  if (st.letterSpacing) s.push(`letter-spacing:${st.letterSpacing}em`);
  if (st.uppercase) s.push('text-transform:uppercase');
  if (st.shadow !== false && !isCta) s.push('text-shadow:0 2px 12px rgba(0,0,0,.35)');
  if (isCta || st.bg) {
    s.push(`background:${st.bg || '#ff3b30'}`);
    s.push(`border-radius:${st.radius ?? 999}px`);
    s.push(`padding:${st.padY ?? 0.45}em ${st.padX ?? 1.2}em`);
    s.push('box-shadow:0 8px 24px rgba(0,0,0,.25)');
    s.push('display:inline-block');
  }
  return s.join(';');
}

// Khổ xuất: 'original' giữ nguyên canvas KV; '9:16' = 1080×1920 (TikTok/Reels/Shorts).
// KV luôn được đặt TRỌN trong khung (không cắt nội dung đã duyệt); phần thừa là nền mờ từ KV hoặc màu.
export const OUTPUT_FORMATS = {
  original: { label: 'Gốc (giữ tỷ lệ KV)' },
  '9:16': { label: '9:16 · TikTok / Reels / Shorts (1080×1920)', width: 1080, height: 1920,
    // vùng an toàn: tránh thanh trên, cột nút bên phải và phần chú thích/tên tài khoản phía dưới của TikTok
    safe: { top: 150, right: 140, bottom: 420, left: 60 } },
};

export function outputLayout(tl) {
  const W = tl.canvas.width, H = tl.canvas.height;
  const o = tl.output || {};
  const F = OUTPUT_FORMATS[o.format];
  if (!F || !F.width) return { OW: W, OH: H, fx: 0, fy: 0, fs: 1, reframed: false };
  const OW = F.width, OH = F.height;
  const box = o.safeArea !== false && F.safe
    ? { x: F.safe.left, y: F.safe.top, w: OW - F.safe.left - F.safe.right, h: OH - F.safe.top - F.safe.bottom }
    : { x: 0, y: 0, w: OW, h: OH };
  const fs = Math.min(box.w / W, box.h / H);
  // horizontally centre on the full frame when that still stays inside the safe box, else centre in the box
  let fx = (OW - W * fs) / 2;
  if (fx < box.x || fx + W * fs > box.x + box.w) fx = box.x + (box.w - W * fs) / 2;
  const fy = box.y + (box.h - H * fs) / 2;
  return { OW, OH, fx: round(fx, 2), fy: round(fy, 2), fs: round(fs, 5), reframed: true, fill: o.fill || 'blur', fillColor: o.fillColor || tl.canvas.background || '#000' };
}

export function buildComposition(projectDir, timeline) {
  const tl = timeline;
  const { width: W, height: H } = tl.canvas;
  const D = tl.duration;
  const buildDir = path.join(projectDir, 'build');
  fs.mkdirSync(path.join(buildDir, 'assets'), { recursive: true });
  fs.copyFileSync(GSAP, path.join(buildDir, 'gsap.min.js'));

  // assets
  const usedFonts = {};
  for (const L of tl.layers) {
    if (L.src) {
      const src = path.join(projectDir, L.src);
      const dst = path.join(buildDir, L.src);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
    }
    if (L.type === 'text' || L.type === 'cta') {
      const f = FONTS[L.style?.font] ? L.style.font : 'Be Vietnam Pro';
      (usedFonts[f] ||= new Set()).add(nearestWeight(f, L.style?.weight || (L.type === 'cta' ? 800 : 700)));
    }
  }
  for (const k of ['music', 'voice']) {
    const a = tl.audio?.[k];
    if (a?.mix) {
      const src = path.join(projectDir, a.mix);
      if (fs.existsSync(src)) { fs.mkdirSync(path.join(buildDir, 'audio'), { recursive: true }); fs.copyFileSync(src, path.join(buildDir, a.mix)); }
    }
  }
  const LO = outputLayout(tl);
  if (LO.reframed && LO.fill === 'blur') {
    const comp = path.join(projectDir, 'assets/composite.png');
    if (fs.existsSync(comp)) fs.copyFileSync(comp, path.join(buildDir, 'assets/composite.png')); else LO.fill = 'color';
  }
  const fontCss = copyFonts(buildDir, Object.fromEntries(Object.entries(usedFonts).map(([f, s]) => [f, [...s]])));

  const stageLayers = [], overlayLayers = [], fxLayers = [];
  const js = [];
  const sorted = [...tl.layers].filter((L) => L.visible !== false).sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  for (const L of sorted) {
    const b = L.box;
    const id = 'L_' + L.id.replace(/[^a-zA-Z0-9_]/g, '_');
    let inner = '';
    if (L.type === 'image') inner = `<img src="${esc(L.src)}" alt="" draggable="false">`;
    else if (L.type === 'region') {
      // a rectangular cut of a source image (the flat KV or a layer), shown 1:1 at the same place
      const sb = L.srcBox || { x: 0, y: 0, w: W, h: H };
      inner = `<div class="region" style="background-image:url('${esc(L.src)}');background-size:${round(sb.w, 1)}px ${round(sb.h, 1)}px;background-position:${round(sb.x - b.x, 1)}px ${round(sb.y - b.y, 1)}px"></div>`;
    } else if (L.type === 'text' || L.type === 'cta') {
      const st = { ...(L.style || {}) };
      st.weight = nearestWeight(FONTS[st.font] ? st.font : 'Be Vietnam Pro', st.weight || (L.type === 'cta' ? 800 : 700));
      const lines = esc(L.text || '').replace(/\n/g, '<br>');
      inner = `<div class="txt" style="justify-content:${{ left: 'flex-start', right: 'flex-end' }[st.align] || 'center'}"><span style="${textStyle(st, L.type === 'cta')}">${lines}</span></div>`;
    }
    const shine = L.loop?.preset === 'shine' || L.loop?.shine ? '<div class="shinewrap"><div class="shine"></div></div>' : '';
    const html = `<div class="L" id="${id}" data-layer="${esc(L.id)}" style="left:${round(b.x, 1)}px;top:${round(b.y, 1)}px;width:${round(b.w, 1)}px;height:${round(b.h, 1)}px;z-index:${(L.z ?? 0) + 1}"><div class="inner" id="${id}_i">${inner}${shine}</div></div>`;
    (L.inStage === false ? overlayLayers : stageLayers).push(html);

    // ---- animation
    const inp = L.in || { preset: 'none' };
    const from = inFromVars(inp.preset, b, tl.canvas, inp.distance ?? 'auto');
    if (from) {
      const at = round(clamp(inp.at ?? 0, 0, D), 3), dur = round(Math.max(0.05, inp.dur ?? 0.8), 3);
      const ease = inp.ease || DEFAULT_EASE[inp.preset] || 'power3.out';
      js.push(`tl.fromTo('#${id}', ${JSON.stringify(from)}, ${JSON.stringify({ ...inToVars(inp.preset), duration: dur, ease })}, ${at});`);
    }
    const lp = L.loop || { preset: 'none' };
    if (lp.preset && lp.preset !== 'none') {
      const start = round(lp.at ?? ((inp.at ?? 0) + (inp.dur ?? 0.8)), 3);
      const intensity = lp.intensity ?? 1;
      const holdEnd = lp.preset === 'kenburns' ? D : Math.max(start, D - (tl.finalHold ?? 1.2));
      const span = holdEnd - start;
      if (span > 0.3) {
        if (lp.shine && lp.preset !== 'shine') {
          js.push(`tl.fromTo('#${id}_i .shine', {xPercent:-160}, {xPercent:160, duration:0.8, ease:'power2.inOut'}, ${round(start + 0.1, 3)});`);
        }
        if (lp.preset === 'kenburns') {
          js.push(`tl.fromTo('#${id}_i', {scale:1}, {scale:${round(1 + 0.08 * intensity, 3)}, duration:${round(span, 3)}, ease:'none'}, ${start});`);
        } else if (lp.preset === 'shine') {
          const period = lp.period ?? 2.2;
          const reps = Math.max(1, Math.floor(span / period));
          js.push(`tl.fromTo('#${id}_i .shine', {xPercent:-160}, {xPercent:160, duration:${round(Math.min(0.9, period * 0.5), 3)}, ease:'power2.inOut', repeat:${reps - 1}, repeatDelay:${round(period - Math.min(0.9, period * 0.5), 3)}}, ${start});`);
        } else {
          const period = lp.period ?? { float: 1.6, pulse: 0.55, breathe: 1.4, sway: 1.2 }[lp.preset] ?? 1;
          const vars = {
            float: { y: round(-0.012 * H * intensity, 1) }, pulse: { scale: round(1 + 0.06 * intensity, 3) },
            breathe: { scale: round(1 + 0.025 * intensity, 3) }, sway: { rotation: round(2.5 * intensity, 2) },
          }[lp.preset] || {};
          // even number of half-cycles → returns exactly to the approved position before the final hold
          let halves = lp.count ? Math.min(lp.count, Math.max(2, Math.floor(span / period))) : Math.max(2, Math.floor(span / period)); if (halves % 2) halves -= 1;
          js.push(`tl.to('#${id}_i', ${JSON.stringify({ ...vars, duration: period, ease: 'sine.inOut', yoyo: true, repeat: halves - 1 })}, ${start});`);
        }
      }
    }
  }

  // ---- camera (stage)
  const keys = (tl.camera?.keys || []).slice().sort((a, b) => a.t - b.t);
  if (keys.length) {
    const k0 = camTransform(keys[0], W, H);
    js.unshift(`tl.set('#stage', ${JSON.stringify(k0)}, 0);`);
    for (let i = 1; i < keys.length; i++) {
      const k = camTransform(keys[i], W, H);
      const dur = round(Math.max(0.01, keys[i].t - keys[i - 1].t), 3);
      js.push(`tl.to('#stage', ${JSON.stringify({ ...k, duration: dur, ease: keys[i].ease || tl.camera.ease || 'power2.inOut' })}, ${round(keys[i - 1].t, 3)});`);
    }
  }
  // ---- global intro / outro
  if (tl.intro?.fadeFromBlack) js.push(`tl.fromTo('#content', {opacity:0}, {opacity:1, duration:${round(tl.intro.dur ?? 0.5, 3)}, ease:'power1.out'}, 0);`);
  for (const [i, tr] of (tl.transitions || []).entries()) {
    const col = tr.type === 'dip-black' ? '#000' : '#fff';
    fxLayers.push(`<div id="TR_${i}" style="position:absolute;inset:0;z-index:9999;background:${col};opacity:0;pointer-events:none"></div>`);
    js.push(`tl.fromTo('#TR_${i}', {opacity:0}, {opacity:${tr.type === 'dip-black' ? 1 : 0.85}, duration:0.12, ease:'power1.in', yoyo:true, repeat:1}, ${round(Math.max(0, tr.at - 0.12), 3)});`);
  }
  // keep the timeline exactly D seconds long
  js.push(`tl.set({}, {}, ${D});`);

  const audio = [];
  for (const [k, id] of [['music', 'a_music'], ['voice', 'a_voice']]) {
    const a = tl.audio?.[k];
    if (a?.mix && fs.existsSync(path.join(buildDir, a.mix))) {
      const vol = a.muted ? 0 : round(a.volume ?? 1, 3);
      audio.push(`<audio id="${id}" src="${esc(a.mix)}" data-start="0" data-duration="${D}" data-volume="${vol}" data-track-index="${k === 'music' ? 1 : 2}"></audio>`);
    }
  }

  const html = `<!doctype html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${LO.OW}, height=${LO.OH}">
<!-- Generated by kv-motion from timeline.json — edit the timeline, not this file. -->
<script src="gsap.min.js"></script>
<style>
${fontCss}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${LO.OW}px;height:${LO.OH}px;overflow:hidden;background:#000}
#root{position:relative;width:${LO.OW}px;height:${LO.OH}px;overflow:hidden;background:#000}
#content{position:absolute;inset:0}
#fill{position:absolute;inset:0;overflow:hidden;background:${LO.fillColor || tl.canvas.background || '#000'}}
#fill img{position:absolute;left:50%;top:50%;width:${LO.OW}px;height:${LO.OH}px;object-fit:cover;transform:translate(-50%,-50%) scale(1.15);filter:blur(40px) brightness(.72) saturate(1.1)}
#frame{position:absolute;left:${LO.fx}px;top:${LO.fy}px;width:${W}px;height:${H}px;transform-origin:0 0;transform:scale(${LO.fs});overflow:hidden;background:${tl.canvas.background || '#000'}${LO.reframed ? ';box-shadow:0 20px 60px rgba(0,0,0,.45)' : ''}}
#stage{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;will-change:transform}
#overlay{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
.L{position:absolute;transform-origin:50% 50%}
.L .inner{position:relative;width:100%;height:100%;transform-origin:50% 50%;overflow:visible}
.L img{display:block;width:100%;height:100%;object-fit:fill;user-select:none}
.L .region{width:100%;height:100%;background-repeat:no-repeat}
.L .txt{width:100%;height:100%;display:flex;align-items:center}
.L .txt span{white-space:pre-wrap}
.L .shinewrap{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.L .shine{position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);mix-blend-mode:screen}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${D}" data-width="${LO.OW}" data-height="${LO.OH}" data-fps="${tl.canvas.fps || 30}">
<div id="content" class="clip" data-start="0" data-duration="${D}">
<div id="fill">${LO.reframed && LO.fill === 'blur' ? '<img src="assets/composite.png" alt="">' : ''}</div>
<div id="frame" data-fx="${LO.fx}" data-fy="${LO.fy}" data-fs="${LO.fs}" data-cw="${W}" data-ch="${H}">
<div id="stage" class="clip" data-start="0" data-duration="${D}">
${stageLayers.join('\n')}
</div>
<div id="overlay" class="clip" data-start="0" data-duration="${D}">
${overlayLayers.join('\n')}
</div>
</div>
</div>
${fxLayers.join('\n')}
${audio.join('\n')}
</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${js.join('\n')}
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(buildDir, 'index.html'), html);
  return path.join(buildDir, 'index.html');
}
