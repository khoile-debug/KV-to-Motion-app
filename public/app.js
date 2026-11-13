// KV Motion — giao diện web (vanilla JS, không cần build)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url, opts = {}) => {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};
const toast = (m, ms = 3000) => { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = 'none'), ms); };
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const ROLE_VI = { background: 'Nền', subject: 'Chủ thể', logo: 'Logo', text: 'Chữ', cta: 'CTA', extra: 'Lớp thêm', kv: 'KV', price: 'Giá', datetime: 'Ngày giờ', headline: 'Headline', brand: 'Thương hiệu', terms: 'Điều kiện', product: 'Sản phẩm', body: 'Nội dung' };

let CFG = null;
const S = { id: null, project: null, timeline: null, job: null, es: null, dirty: false, tab: 'motion', sel: null, player: null };

// ------------------------------------------------------------------ routing
window.addEventListener('hashchange', route);
async function boot() {
  CFG = await api('/api/config');
  const tts = CFG.tts.providers.find((p) => p.id === CFG.tts.default);
  $('#sysinfo').textContent = `Phân tích ảnh: ${CFG.vision.provider === 'claude' ? 'Claude (' + CFG.vision.model + ')' : 'heuristic + OCR'} · TTS: ${tts?.label || CFG.tts.default} · ${CFG.music.length} bài nhạc`;
  route();
}
async function route() {
  const m = location.hash.match(/^#\/p\/([\w]+)/);
  await renderSidebar(m?.[1]);
  if (S.es) { S.es.close(); S.es = null; }
  stopPlayer();
  if (m) openProject(m[1]); else renderCreate();
}
async function renderSidebar(active) {
  const list = await api('/api/projects');
  $('#projects').innerHTML = `<div class="muted small" style="margin:4px 4px 8px">Dự án</div>` + (list.length ? list.map((p) => `
    <a class="item ${p.id === active ? 'active' : ''}" href="#/p/${p.id}">${h(p.name)}
    <small>${p.mode === 'layered' ? 'KV có lớp' : p.mode === 'flat' ? 'KV phẳng' : ''}${p.hasTemplate ? ' · có mẫu' : ''} · ${{ ready: 'sẵn sàng', processing: 'đang xử lý', error: 'lỗi' }[p.status] || p.status}${p.renders ? ` · ${p.renders} MP4` : ''}</small></a>`).join('') : '<div class="muted small">Chưa có dự án.</div>');
}

// ------------------------------------------------------------------ create
function dropzone(name, label, accept, hint = '') {
  return `<label class="drop" data-name="${name}"><input type="file" name="${name}" accept="${accept}"><div class="ph"><b>${label}</b><div class="muted small">${hint}</div></div></label>`;
}
function renderCreate() {
  S.id = null;
  $('#main').innerHTML = `
  <div class="card">
    <h2>Tạo video từ Key Visual</h2>
    <p class="muted" style="margin-top:-6px">Chỉ cần tải KV. Ứng dụng tự phân tích bố cục và nội dung, đề xuất chuyển động, chọn nhạc và tạo giọng đọc. Brief và video mẫu là tùy chọn.</p>
    <div class="tabs" id="modeTabs"><button type="button" data-m="flat" class="on">KV phẳng (1 ảnh)</button><button type="button" data-m="layered">KV có lớp</button></div>
    <form id="createForm">
      <div id="flatBox">${dropzone('kv', 'Kéo thả KV vào đây', 'image/jpeg,image/png,image/webp', 'JPG · PNG · WebP')}</div>
      <div id="layerBox" style="display:none">
        <p class="muted small">Mỗi lớp đều tùy chọn. Nên xuất PNG trong suốt cùng khổ với KV (giữ đúng vị trí); lớp lẻ (vd. file logo) sẽ được đặt mặc định và chỉnh được sau.</p>
        <div class="grid3">${dropzone('background', 'Nền', 'image/*')}${dropzone('subject', 'Chủ thể / sản phẩm', 'image/*', 'PNG tách nền')}${dropzone('logo', 'Logo', 'image/*', 'PNG trong suốt')}${dropzone('text', 'Chữ (headline, giá, CTA…)', 'image/*', 'PNG trong suốt')}${dropzone('cta', 'CTA riêng', 'image/*', 'tùy chọn')}${dropzone('kv', 'KV hoàn chỉnh (tham chiếu)', 'image/*', 'tùy chọn')}</div>
      </div>
      <h3>Video mẫu chuyển động <span class="muted small">(tùy chọn)</span></h3>
      <div style="max-width:360px">${dropzone('template', 'MP4 hoặc GIF', 'video/mp4,image/gif,video/quicktime,video/webm', 'Khi có mẫu, ứng dụng dựng theo nhịp & chuyển động của mẫu')}</div>
      <details style="margin-top:14px"><summary><b>Brief / nội dung đã duyệt</b> <span class="muted small">(tùy chọn — giúp lời thoại chính xác hơn; sẽ được giữ nguyên văn)</span></summary>
        <div class="grid3" style="margin-top:10px">
          <label class="f">Tên dự án<input name="name" placeholder="vd. Lumi – Cà phê muối"></label>
          <label class="f">Thương hiệu<input data-b="brand"></label>
          <label class="f">Sản phẩm<input data-b="product"></label>
          <label class="f">Headline<input data-b="headline"></label>
          <label class="f">Giá / ưu đãi<input data-b="offer" placeholder="vd. Chỉ 29.000đ"></label>
          <label class="f">Ngày giờ<input data-b="datetime" placeholder="vd. Từ 15/11 đến 30/11/2026"></label>
          <label class="f">CTA<input data-b="cta" placeholder="vd. Đặt ngay"></label>
          <label class="f">Điều kiện ưu đãi<input data-b="terms"></label>
          <label class="f">Tone<input data-b="tone" placeholder="vd. trẻ trung, sang trọng"></label>
        </div>
        <label class="f" style="margin-top:8px">Ghi chú<textarea data-b="notes" rows="2"></textarea></label>
        <label class="f" style="margin-top:8px;max-width:200px">Thời lượng (giây, để trống = tự động 8–10s)<input name="duration" type="number" min="3" max="30" step="0.5"></label>
      </details>
      <div class="row" style="margin-top:16px"><button class="primary" id="goBtn">Tạo preview tự động</button><span class="muted small" id="goMsg"></span></div>
    </form>
  </div>`;
  let mode = 'flat';
  $$('#modeTabs button').forEach((b) => b.onclick = () => {
    mode = b.dataset.m; $$('#modeTabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('#flatBox').style.display = mode === 'flat' ? '' : 'none'; $('#layerBox').style.display = mode === 'flat' ? 'none' : '';
  });
  $$('.drop').forEach(wireDrop);
  $('#createForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    const box = mode === 'flat' ? $('#flatBox') : $('#layerBox');
    $$('input[type=file]', box).forEach((i) => i.files[0] && fd.append(i.name, i.files[0]));
    const tpl = $('input[name=template]').files[0]; if (tpl) fd.append('template', tpl);
    const brief = {}; $$('[data-b]').forEach((i) => { if (i.value.trim()) brief[i.dataset.b] = i.value.trim(); });
    fd.append('brief', JSON.stringify(brief));
    if ($('input[name=name]').value) fd.append('name', $('input[name=name]').value);
    if ($('input[name=duration]').value) fd.append('duration', $('input[name=duration]').value);
    if (![...fd.keys()].some((k) => !['brief', 'name', 'duration', 'template'].includes(k))) return toast('Hãy tải KV hoặc ít nhất một lớp.');
    $('#goBtn').disabled = true; $('#goMsg').textContent = 'Đang tải lên…';
    try { const { id } = await api('/api/projects', { method: 'POST', body: fd }); location.hash = `#/p/${id}`; }
    catch (err) { toast(err.message, 5000); $('#goBtn').disabled = false; $('#goMsg').textContent = ''; }
  };
}
function wireDrop(d) {
  const inp = $('input', d);
  const show = () => {
    const f = inp.files[0]; $('.prev', d)?.remove(); $('.x', d)?.remove();
    if (!f) { $('.ph', d).style.display = ''; return; }
    $('.ph', d).style.display = 'none';
    const url = URL.createObjectURL(f);
    d.insertAdjacentHTML('beforeend', `${f.type.startsWith('video') ? `<video class="prev" src="${url}" muted autoplay loop playsinline></video>` : `<img class="prev" src="${url}">`}<div class="prev small muted">${h(f.name)}</div><button type="button" class="x small ghost">✕</button>`);
    $('.x', d).onclick = (e) => { e.preventDefault(); inp.value = ''; show(); };
  };
  inp.onchange = show;
  d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); };
  d.ondragleave = () => d.classList.remove('over');
  d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) { const dt = new DataTransfer(); dt.items.add(e.dataTransfer.files[0]); inp.files = dt.files; show(); } };
}

// ------------------------------------------------------------------ project
async function openProject(id) {
  S.id = id; S.dirty = false; S.sel = null;
  const data = await api(`/api/projects/${id}`);
  Object.assign(S, { project: data.project, timeline: data.timeline, job: data.job });
  renderProject();
  S.es = new EventSource(`/api/projects/${id}/events`);
  S.es.onmessage = (ev) => onJob(JSON.parse(ev.data));
}
async function onJob(j) {
  const was = S.job?.status;
  S.job = j;
  renderJob();
  if (j.status !== 'running' && was === 'running') {
    const data = await api(`/api/projects/${S.id}`);
    S.project = data.project;
    if (j.status === 'done' && j.type !== 'render') { S.timeline = data.timeline; S.dirty = false; renderProject(); }
    else { renderRenders(); renderJob(); }
    renderSidebar(S.id);
    if (j.status === 'done') toast(j.type === 'render' ? 'Đã xuất MP4 ✔' : 'Preview đã cập nhật ✔');
  }
}

function renderProject() {
  const p = S.project, tl = S.timeline;
  $('#main').innerHTML = `
    <div class="row" style="margin-bottom:12px"><h2 style="margin:0">${h(p.name)}</h2>
      <span class="tag">${p.mode === 'layered' ? 'KV có lớp' : 'KV phẳng'}</span>${p.templateVideo ? '<span class="tag">dựng theo mẫu</span>' : '<span class="tag">tự động</span>'}
      <span style="flex:1"></span><button class="ghost small" id="delBtn">Xóa dự án</button></div>
    <div id="jobBox"></div>
    ${tl ? `<div class="editor">
      <div>
        <div class="card"><div class="previews" id="previews"></div>
          <div class="transport"><button id="playBtn">▶ Phát</button><input type="range" id="scrub" min="0" max="${tl.duration}" step="0.01" value="0"><span class="time" id="time">0:00.00 / ${fmt(tl.duration)}</span></div>
          <div class="timeline-viz" id="tviz"></div>
          <div class="muted small" style="margin-top:6px">Mẹo: bấm vào một lớp trong preview để chọn, kéo để đổi vị trí. Âm lượng/tắt track áp dụng ngay khi nghe thử.</div>
        </div>
        <div class="card"><h3 style="margin-top:0">Xuất MP4</h3><div id="renderBox"></div></div>
      </div>
      <div class="card panel" id="panel"></div>
    </div>` : ''}`;
  $('#delBtn').onclick = async () => { if (!confirm('Xóa dự án này?')) return; await api(`/api/projects/${S.id}`, { method: 'DELETE' }); location.hash = '#/'; };
  renderJob();
  if (tl) { setupPlayer(); renderPanel(); renderRenders(); drawViz(); }
}

function renderJob() {
  const j = S.job, box = $('#jobBox'); if (!box) return;
  const p = S.project;
  if (!j && !p.lastError) { box.innerHTML = ''; return; }
  if (j && j.status === 'done' && j.type !== 'render' && Date.now() - (j.finishedAt || 0) > 4000) { box.innerHTML = ''; return; }
  if (j?.type === 'render') { box.innerHTML = ''; renderRenders(); return; }
  const err = j?.status === 'error' ? j.error : (!j && p.lastError && p.lastError.type !== 'render' ? p.lastError.message : null);
  box.innerHTML = `<div class="card">
    <div class="row"><b>${{ create: 'Tạo preview tự động', update: 'Cập nhật preview', replan: 'Dựng lại theo lớp mới', 'replan-auto': 'Đề xuất lại', voice: 'Viết lại lời thoại' }[j?.type] || 'Xử lý'}</b>
      <span class="muted small">${j?.status === 'running' ? 'đang chạy…' : j?.status === 'done' ? 'xong' : 'lỗi'}</span></div>
    ${j ? `<div class="bar" style="margin:10px 0"><i style="width:${j.progress || 0}%"></i></div>
    <ul class="steps">${j.steps.map((s) => `<li><span class="dot ${s.status}"></span>${h(s.label)} <span class="muted small">${s.ms ? (s.ms / 1000).toFixed(1) + 's' : s.status === 'skipped' ? 'bỏ qua' : ''}</span></li>`).join('')}</ul>` : ''}
    ${err ? `<div class="err" style="margin-top:10px">${h(err)}</div><div class="row" style="margin-top:10px"><button class="primary" id="retryBtn">↻ Thử lại</button><span class="muted small">Chạy lại từ bước bị lỗi.</span></div>` : ''}
    ${j?.log?.length ? `<div class="log">${j.log.map((l) => h(l.m)).join('<br>')}</div>` : ''}
  </div>`;
  const lg = $('.log', box); if (lg) lg.scrollTop = 1e9;
  if ($('#retryBtn')) $('#retryBtn').onclick = retry;
}
async function retry() { try { await api(`/api/projects/${S.id}/retry`, { method: 'POST' }); } catch (e) { toast(e.message); } }

function renderRenders() {
  const box = $('#renderBox'); if (!box) return;
  const j = S.job?.type === 'render' ? S.job : null;
  const rs = S.project.renders || [];
  const lastErr = S.project.lastError?.type === 'render' ? S.project.lastError : null;
  const O = S.timeline.output || {};
  const fmts = Object.entries(CFG.outputFormats || { original: { label: 'Gốc' } });
  box.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <label class="f">Khổ video<select id="fmtSel" ${j?.status === 'running' ? 'disabled' : ''}>${opt(fmts.map(([k, v]) => [k, v.label]), O.format || 'original')}</select></label>
      ${O.format && O.format !== 'original' ? `<label class="f">Nền phần thừa<select id="fillSel">${opt([['blur', 'Mờ từ KV'], ['color', 'Màu đơn']], O.fill || 'blur')}</select></label>
      ${(O.fill || 'blur') === 'color' ? `<label class="f">Màu<input type="color" id="fillCol" value="${O.fillColor || S.timeline.canvas.background || '#000000'}"></label>` : ''}
      <label class="row small" style="align-self:flex-end;padding-bottom:6px"><input type="checkbox" id="safeChk" ${O.safeArea !== false ? 'checked' : ''}> Chừa vùng an toàn TikTok</label>` : ''}
    </div>
    <div class="row"><button class="primary" id="renderBtn" ${j?.status === 'running' || S.dirty ? 'disabled' : ''}>⬇ Xuất MP4</button>
      ${S.dirty ? '<span class="dirty">Có thay đổi chưa lưu — bấm "Lưu & cập nhật preview" trước khi xuất.</span>' : '<span class="muted small">Dùng đúng composition của preview (HyperFrames + GSAP).</span>'}</div>
    ${j?.status === 'running' ? `<div style="margin-top:10px"><div class="bar"><i style="width:${j.progress || 0}%"></i></div><div class="muted small" style="margin-top:4px">${j.steps[0].status === 'queued' ? 'Đang chờ lượt render…' : `Đang render… ${j.progress || 0}% ${j.steps[0].detail || ''}`}</div></div>` : ''}
    ${j?.status === 'error' || (!j && lastErr) ? `<div class="err" style="margin-top:10px">${h(j?.error || lastErr.message)}</div><button class="small" id="rRetry" style="margin-top:8px">↻ Thử lại</button>` : ''}
    <div class="renders" style="margin-top:8px">${rs.map((r) => `<a href="/projects/${S.id}/${r.file}" download>🎬 ${h(r.file.split('/').pop())}</a><span class="muted small">${r.width}×${r.height} · ${r.duration.toFixed(2)}s · ${(r.size / 1e6).toFixed(1)} MB · ${r.hasAudio ? 'có âm thanh' : 'không âm thanh'}</span>`).join('') || '<span class="muted small">Chưa có bản xuất.</span>'}</div>
    ${rs[0] ? `<video src="/projects/${S.id}/${rs[0].file}?v=${rs[0].at}" controls style="width:100%;max-height:320px;margin-top:8px;border-radius:8px;background:#000"></video>` : ''}`;
  const setOut = (patch) => { S.timeline.output = { ...(S.timeline.output || {}), ...patch }; S.dirty = true; save(); };
  $('#fmtSel').onchange = (e) => setOut({ format: e.target.value });
  if ($('#fillSel')) $('#fillSel').onchange = (e) => setOut({ fill: e.target.value });
  if ($('#fillCol')) $('#fillCol').onchange = (e) => setOut({ fillColor: e.target.value });
  if ($('#safeChk')) $('#safeChk').onchange = (e) => setOut({ safeArea: e.target.checked });
  $('#renderBtn').onclick = async () => { try { await api(`/api/projects/${S.id}/render`, { method: 'POST' }); } catch (e) { toast(e.message); } };
  if ($('#rRetry')) $('#rRetry').onclick = async () => { try { await api(`/api/projects/${S.id}/render`, { method: 'POST' }); } catch (e) { toast(e.message); } };
}

// ------------------------------------------------------------------ player (same composition as the MP4)
function setupPlayer() {
  const tl = S.timeline;
  const F = CFG.outputFormats?.[tl.output?.format];
  const W = F?.width || tl.canvas.width, H = F?.height || tl.canvas.height;
  const hasTpl = !!tl.template?.video;
  const avail = Math.max(320, ($('#previews').clientWidth || 700) - 4);
  const tplAR = S.project.template?.aspect || 1;
  const maxH = 480;
  // side by side: split the width between the build and the template in proportion to their aspect ratios
  const maxW = hasTpl ? Math.min(640, (avail - 12) * (W / H) / (W / H + tplAR)) : Math.min(720, avail);
  const sc = Math.min(maxW / W, maxH / H);
  const fw = Math.round(W * sc), fh = Math.round(H * sc);
  $('#previews').innerHTML = `
    <div class="pv"><div class="frame" id="frame" style="width:${fw}px;height:${fh}px">
      <iframe id="comp" src="/projects/${S.id}/build/index.html?v=${Date.now()}" style="width:${W}px;height:${H}px;transform:scale(${sc})"></iframe>
      <div class="hit" id="hit"></div></div><div class="lbl">Bản dựng · ${W}×${H}${F?.width ? ' (9:16)' : ''} · ${tl.duration}s</div></div>
    ${hasTpl ? `<div class="pv"><div class="frame" style="height:${fh}px;width:${Math.round(fh * tplAR)}px"><video id="tplv" src="/projects/${S.id}/${tl.template.video}" muted playsinline preload="auto"></video></div>
      <div class="lbl">Mẫu · ${tl.template.duration}s ${tl.template.timeScale !== 1 ? `(co giãn ×${tl.template.timeScale})` : ''}</div></div>` : ''}`;
  S.player = { t: 0, playing: false, sc, raf: 0 };
  const ifr = $('#comp');
  ifr.onload = () => {
    const w = ifr.contentWindow; S.player.win = w;
    const fr = w.document.getElementById('frame')?.dataset || {};
    S.player.fr = { fx: Number(fr.fx || 0), fy: Number(fr.fy || 0), fs: Number(fr.fs || 1) };
    applyVolumes(); seek(S.player.t);
  };
  $('#playBtn').onclick = () => (S.player.playing ? pause() : play());
  $('#scrub').oninput = (e) => { pause(); seek(Number(e.target.value)); };
  wireHit();
}
function comp() { return S.player?.win?.__timelines?.main; }
function audios() { const d = S.player?.win?.document; return d ? [['music', d.getElementById('a_music')], ['voice', d.getElementById('a_voice')]].filter((x) => x[1]) : []; }
function applyVolumes() {
  for (const [k, el] of audios()) { const a = S.timeline.audio[k]; el.volume = a?.muted ? 0 : Math.min(1, a?.volume ?? 1); }
}
function seek(t) {
  const P = S.player; if (!P) return;
  P.t = Math.max(0, Math.min(S.timeline.duration, t));
  comp()?.seek(P.t, false);
  $('#scrub').value = P.t; $('#time').textContent = `${fmt(P.t)} / ${fmt(S.timeline.duration)}`;
  const v = $('#tplv'); if (v && !P.playing) v.currentTime = Math.min(v.duration || 1e9, P.t / (S.timeline.template.timeScale || 1));
  const ph = $('#tviz .ph'); if (ph) ph.style.left = `calc(${(P.t / S.timeline.duration) * 100}% )`;
}
function play() {
  const P = S.player; if (!P || !comp()) return;
  if (P.t >= S.timeline.duration - 0.02) seek(0);
  P.playing = true; $('#playBtn').textContent = '❚❚ Dừng';
  applyVolumes();
  for (const [, el] of audios()) { el.currentTime = P.t; el.play().catch(() => {}); }
  const v = $('#tplv'); if (v) { v.currentTime = P.t / (S.timeline.template.timeScale || 1); v.playbackRate = 1 / (S.timeline.template.timeScale || 1); v.play().catch(() => {}); }
  const t0 = performance.now() - P.t * 1000;
  const loop = () => {
    if (!P.playing) return;
    const t = (performance.now() - t0) / 1000;
    if (t >= S.timeline.duration) { seek(S.timeline.duration); pause(); return; }
    seek(t);
    for (const [, el] of audios()) if (Math.abs(el.currentTime - t) > 0.15) el.currentTime = t;
    P.raf = requestAnimationFrame(loop);
  };
  P.raf = requestAnimationFrame(loop);
}
function pause() {
  const P = S.player; if (!P) return;
  P.playing = false; cancelAnimationFrame(P.raf);
  if ($('#playBtn')) $('#playBtn').textContent = '▶ Phát';
  for (const [, el] of audios()) el.pause();
  $('#tplv')?.pause();
}
function stopPlayer() { if (S.player) pause(); S.player = null; }

// click-select + drag layers on the preview
function wireHit() {
  const hit = $('#hit'); let drag = null;
  const toCanvas = (e) => {
    const r = hit.getBoundingClientRect(), f = S.player.fr || { fx: 0, fy: 0, fs: 1 };
    return { x: ((e.clientX - r.left) / S.player.sc - f.fx) / f.fs, y: ((e.clientY - r.top) / S.player.sc - f.fy) / f.fs };
  };
  hit.onmousedown = (e) => {
    const p = toCanvas(e);
    const L = [...S.timeline.layers].filter((l) => l.visible !== false && l.role !== 'kv' && l.role !== 'background').sort((a, b) => (b.z ?? 0) - (a.z ?? 0))
      .find((l) => p.x >= l.box.x && p.x <= l.box.x + l.box.w && p.y >= l.box.y && p.y <= l.box.y + l.box.h);
    S.sel = L?.id || null; showSel();
    if (L) { drag = { L, p, box: { ...L.box } }; const d = $(`details[data-id="${CSS.escape(L.id)}"]`); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } }
  };
  window.onmousemove = (e) => {
    if (!drag || !S.player) return;
    const p = toCanvas(e);
    drag.L.box.x = Math.round(drag.box.x + p.x - drag.p.x); drag.L.box.y = Math.round(drag.box.y + p.y - drag.p.y);
    const el = S.player.win?.document.querySelector(`[data-layer="${CSS.escape(drag.L.id)}"]`);
    if (el) { el.style.left = drag.L.box.x + 'px'; el.style.top = drag.L.box.y + 'px'; }
    showSel(); markDirty();
  };
  window.onmouseup = () => { if (drag) { drag = null; renderPanel(); } };
}
function showSel() {
  $$('#frame .sel').forEach((x) => x.remove());
  const L = S.timeline.layers.find((l) => l.id === S.sel); if (!L) return;
  const sc = S.player.sc, f = S.player.fr || { fx: 0, fy: 0, fs: 1 }, k = sc * f.fs;
  $('#frame').insertAdjacentHTML('beforeend', `<div class="sel" style="left:${(f.fx + L.box.x * f.fs) * sc}px;top:${(f.fy + L.box.y * f.fs) * sc}px;width:${L.box.w * k}px;height:${L.box.h * k}px"></div>`);
}

function drawViz() {
  const tl = S.timeline, D = tl.duration, pct = (t) => `${(Math.max(0, t) / D) * 100}%`;
  const rows = tl.layers.filter((l) => l.visible !== false).map((L) => {
    const i = L.in || {}; const lp = L.loop || {};
    const a = i.preset && i.preset !== 'none' ? `<span style="left:${pct(i.at || 0)};width:${pct(i.dur || 0.8)}">${h(i.preset)}</span>` : '';
    const lps = lp.preset && lp.preset !== 'none' ? `<span class="loop" style="left:${pct(lp.at ?? ((i.at || 0) + (i.dur || 0.8)))};width:${pct(lp.preset === 'kenburns' ? D : Math.max(0.3, (lp.count || 2) * 0.6))}">${h(lp.preset)}</span>` : '';
    return `<div class="tr"><b>${h(L.name || L.id)}</b>${a}${lps}</div>`;
  });
  const vo = (tl.audio.voice?.lines || []).filter((l) => l.start != null).map((l) => `<span class="vo" style="left:${pct(l.start)};width:${pct((l.dur || 1) / (l.speed || 1))}" title="${h(l.text)}">${h(l.text)}</span>`).join('');
  rows.push(`<div class="tr"><b>Lời thoại</b>${vo}</div>`);
  $('#tviz').innerHTML = rows.join('') + `<div class="ph" style="left:0"></div>`;
}

// ------------------------------------------------------------------ editor panel
function markDirty() { if (!S.dirty) { S.dirty = true; renderRenders(); const s = $('#saveState'); if (s) s.textContent = 'Có thay đổi chưa lưu'; } }
function opt(list, cur) { return list.map(([v, l]) => `<option value="${h(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${h(l)}</option>`).join(''); }
const num = (v, d = 0) => (v === '' || v == null || Number.isNaN(Number(v)) ? d : Number(v));

function renderPanel() {
  const tl = S.timeline;
  const tabs = [['motion', 'Chuyển động'], ['audio', 'Âm thanh'], ['notes', `Phân tích & ghi chú${tl.notes?.length ? ` (${tl.notes.length})` : ''}`], ['json', 'Timeline JSON']];
  $('#panel').innerHTML = `<div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="tabBody"></div>
    <div class="sticky-actions"><button class="primary" id="saveBtn">Lưu & cập nhật preview</button><button id="replanBtn" title="Chạy lại đề xuất chuyển động tự động">↺ Đề xuất lại</button><span class="dirty" id="saveState">${S.dirty ? 'Có thay đổi chưa lưu' : ''}</span></div>`;
  $$('#panel .tabs button').forEach((b) => b.onclick = () => { S.tab = b.dataset.t; renderPanel(); });
  ({ motion: tabMotion, audio: tabAudio, notes: tabNotes, json: tabJson })[S.tab]();
  $('#saveBtn').onclick = () => save();
  $('#replanBtn').onclick = async () => {
    if (!confirm('Đề xuất lại chuyển động tự động? Các chỉnh sửa chuyển động hiện tại sẽ bị thay thế.')) return;
    try { await api(`/api/projects/${S.id}/replan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ duration: S.timeline.autoDuration ? null : S.timeline.duration }) }); } catch (e) { toast(e.message); }
  };
}
async function save(extra = '') {
  pause();
  try { await api(`/api/projects/${S.id}/timeline${extra}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timeline: S.timeline }) }); toast('Đang cập nhật preview…'); }
  catch (e) { toast(e.message, 5000); }
}

function bind(root, obj, onChange) {
  $$('[data-k]', root).forEach((el) => {
    const ev = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const path = el.dataset.k.split('.'); let o = obj;
      for (const k of path.slice(0, -1)) o = o[k] ??= {};
      const last = path[path.length - 1];
      let v = el.type === 'checkbox' ? el.checked : el.dataset.num != null ? (el.value === '' ? undefined : Number(el.value)) : el.value;
      if (el.dataset.k.endsWith('distance') && el.value !== 'auto' && el.value !== '') v = Number(el.value);
      o[last] = v; markDirty(); onChange?.(el.dataset.k);
    });
  });
}

function tabMotion() {
  const tl = S.timeline, P = CFG.presets;
  const inOpts = Object.entries(P.in).map(([k, v]) => [k, v.label]);
  const loopOpts = Object.entries(P.loop).map(([k, v]) => [k, v.label]);
  const easeOpts = [['', '(mặc định)'], ...P.eases.map((e) => [e, e])];
  const fontOpts = CFG.fonts.map((f) => [f, f]);
  const layers = [...tl.layers].sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  $('#tabBody').innerHTML = `
    <div class="row"><label class="f">Thời lượng (s)<input type="number" step="0.1" min="2" max="60" data-num data-k="duration" value="${tl.duration}"></label>
      <label class="f">Giữ khung cuối (s)<input type="number" step="0.1" min="0" data-num data-k="finalHold" value="${tl.finalHold ?? 1.5}"></label>
      <label class="f">Mở đầu từ đen<select data-k="intro.fadeFromBlack">${opt([['true', 'Có'], ['false', 'Không']], String(!!tl.intro?.fadeFromBlack))}</select></label></div>
    <div class="muted small" style="margin:6px 0 10px">Khung hình giữ tỷ lệ gốc ${tl.canvas.width}×${tl.canvas.height}. Phong cách: <b>${h(tl.style)}</b>${tl.source === 'template' ? ' (bám theo video mẫu)' : ''}.</div>
    <h3>Camera ${tl.mode === 'flat' ? '(zoom / pan toàn ảnh)' : ''}</h3>
    <div id="cam">${(tl.camera?.keys || []).map((k, i) => `<div class="row" data-i="${i}"><label class="f">t (s)<input type="number" step="0.05" data-num data-k="camera.keys.${i}.t" value="${k.t}"></label><label class="f">Zoom<input type="number" step="0.01" min="1" data-num data-k="camera.keys.${i}.scale" value="${k.scale}"></label><label class="f">Tâm X<input type="number" step="0.01" min="0" max="1" data-num data-k="camera.keys.${i}.cx" value="${k.cx}"></label><label class="f">Tâm Y<input type="number" step="0.01" min="0" max="1" data-num data-k="camera.keys.${i}.cy" value="${k.cy}"></label><button class="small ghost" data-delkey="${i}">✕</button></div>`).join('') || '<div class="muted small">Không có chuyển động camera.</div>'}</div>
    <div class="row" style="margin-top:6px"><button class="small" id="addKey">+ Keyframe camera tại ${S.player ? S.player.t.toFixed(2) : 0}s</button></div>
    <h3>Lớp <span class="muted small">(trên cùng → dưới cùng)</span></h3>
    <div class="row" style="margin-bottom:8px"><button class="small" id="addText">+ Lớp chữ</button><button class="small" id="addCta">+ Nút CTA</button></div>
    ${layers.map((L) => {
      const i = tl.layers.indexOf(L), k = (s) => `layers.${i}.${s}`;
      const isText = L.type === 'text' || L.type === 'cta';
      const inList = L.role === 'logo' ? inOpts.filter(([v]) => P.logoSafe.includes(v)) : inOpts;
      return `<details class="layer" data-id="${h(L.id)}" ${S.sel === L.id ? 'open' : ''}><summary><input type="checkbox" data-k="${k('visible')}" ${L.visible !== false ? 'checked' : ''} title="Hiện/ẩn" onclick="event.stopPropagation()"><b>${h(L.name || L.id)}</b><span class="tag">${h(ROLE_VI[L.role] || L.role)}</span>${L.locked ? '<span class="tag lock" title="Nội dung đã duyệt — không đổi nội dung, chỉ chỉnh chuyển động/vị trí">🔒 đã duyệt</span>' : ''}<span class="muted small" style="margin-left:auto">${L.in?.preset && L.in.preset !== 'none' ? `${L.in.preset} @${L.in.at ?? 0}s` : ''}</span></summary>
        <div class="body">
          ${isText ? `<label class="f">Nội dung<textarea rows="2" data-k="${k('text')}">${h(L.text)}</textarea></label>
            <div class="row"><label class="f">Font<select data-k="${k('style.font')}">${opt(fontOpts, L.style?.font)}</select></label><label class="f">Đậm<input type="number" step="100" min="400" max="900" data-num data-k="${k('style.weight')}" value="${L.style?.weight ?? 700}"></label><label class="f">Cỡ (px)<input type="number" data-num data-k="${k('style.size')}" value="${L.style?.size ?? 48}"></label></div>
            <div class="row"><label class="f">Màu chữ<input type="color" data-k="${k('style.color')}" value="${L.style?.color || '#ffffff'}"></label>${L.type === 'cta' ? `<label class="f">Màu nút<input type="color" data-k="${k('style.bg')}" value="${L.style?.bg || '#e53935'}"></label>` : ''}<label class="f">Căn<select data-k="${k('style.align')}">${opt([['left', 'Trái'], ['center', 'Giữa'], ['right', 'Phải']], L.style?.align || 'center')}</select></label><label class="f">IN HOA<select data-k="${k('style.uppercase')}">${opt([['', 'Không'], ['1', 'Có']], L.style?.uppercase ? '1' : '')}</select></label></div>` : ''}
          <div class="row"><label class="f">X<input type="number" data-num data-k="${k('box.x')}" value="${Math.round(L.box.x)}"></label><label class="f">Y<input type="number" data-num data-k="${k('box.y')}" value="${Math.round(L.box.y)}"></label><label class="f">Rộng<input type="number" data-num data-k="${k('box.w')}" value="${Math.round(L.box.w)}"></label><label class="f">Cao<input type="number" data-num data-k="${k('box.h')}" value="${Math.round(L.box.h)}" ${L.role === 'logo' ? 'disabled title="Logo giữ đúng tỷ lệ"' : ''}></label><label class="f">Thứ tự (z)<input type="number" data-num data-k="${k('z')}" value="${L.z ?? 0}"></label></div>
          <div class="row"><label class="f">Vào cảnh<select data-k="${k('in.preset')}">${opt(inList, L.in?.preset || 'none')}</select></label><label class="f">Lúc (s)<input type="number" step="0.05" min="0" data-num data-k="${k('in.at')}" value="${L.in?.at ?? 0}"></label><label class="f">Dài (s)<input type="number" step="0.05" min="0.05" data-num data-k="${k('in.dur')}" value="${L.in?.dur ?? 0.8}"></label></div>
          <div class="row"><label class="f">Easing<select data-k="${k('in.ease')}">${opt(easeOpts, L.in?.ease || '')}</select></label><label class="f">Quãng trượt<select data-k="${k('in.distance')}">${opt([['auto', 'Từ ngoài khung'], ['0.05', '5%'], ['0.1', '10%'], ['0.2', '20%'], ['0.35', '35%']], String(L.in?.distance ?? 'auto'))}</select></label></div>
          <div class="row"><label class="f">Nhịp giữ (loop)<select data-k="${k('loop.preset')}">${opt(loopOpts, L.loop?.preset || 'none')}</select></label><label class="f">Bắt đầu (s)<input type="number" step="0.05" data-num data-k="${k('loop.at')}" value="${L.loop?.at ?? ''}" placeholder="sau khi vào"></label><label class="f">Số nhịp<input type="number" min="2" step="2" data-num data-k="${k('loop.count')}" value="${L.loop?.count ?? ''}" placeholder="tự động"></label><label class="f">Cường độ<input type="number" step="0.1" min="0" data-num data-k="${k('loop.intensity')}" value="${L.loop?.intensity ?? 1}"></label></div>
          <div class="row"><label class="row small"><input type="checkbox" data-k="${k('loop.shine')}" ${L.loop?.shine ? 'checked' : ''}> Vệt sáng</label>${tl.mode === 'flat' ? `<label class="row small"><input type="checkbox" data-k="${k('inStage')}" ${L.inStage !== false ? 'checked' : ''}> Đi theo camera</label>` : ''}
            ${!L.locked ? `<button class="small ghost" data-del="${h(L.id)}" style="margin-left:auto">Xóa lớp</button>` : ''}</div>
        </div></details>`;
    }).join('')}`;
  bind($('#tabBody'), tl, (key) => {
    if (key === 'intro.fadeFromBlack') tl.intro.fadeFromBlack = tl.intro.fadeFromBlack === 'true' || tl.intro.fadeFromBlack === true;
    const m = key.match(/^layers\.(\d+)\.style\.uppercase$/); if (m) tl.layers[m[1]].style.uppercase = !!tl.layers[m[1]].style.uppercase;
    const lw = key.match(/^layers\.(\d+)\.box\.w$/); if (lw && tl.layers[lw[1]].role === 'logo') { const L = tl.layers[lw[1]]; L.box.h = Math.round(L.box.w * (L._ar ||= L.box.h / (L.box.w || 1))); }
    if (key === 'duration') { tl.autoDuration = false; }
    drawViz();
  });
  $$('[data-delkey]').forEach((b) => b.onclick = () => { tl.camera.keys.splice(Number(b.dataset.delkey), 1); markDirty(); tabMotion(); });
  $$('[data-del]').forEach((b) => b.onclick = () => { tl.layers = tl.layers.filter((l) => l.id !== b.dataset.del); markDirty(); tabMotion(); drawViz(); });
  $('#addKey').onclick = () => { tl.camera ||= { keys: [] }; tl.camera.keys.push({ t: Number((S.player?.t || 0).toFixed(2)), scale: 1, cx: 0.5, cy: 0.5 }); tl.camera.keys.sort((a, b) => a.t - b.t); markDirty(); tabMotion(); };
  const addOverlay = (type) => {
    const W = tl.canvas.width, H = tl.canvas.height;
    const id = `${type}_${Date.now().toString(36)}`;
    tl.layers.push({ id, name: type === 'cta' ? 'CTA mới' : 'Chữ mới', type, role: type === 'cta' ? 'cta' : 'text', text: type === 'cta' ? 'MUA NGAY' : 'Nội dung mới', inStage: false, z: 60,
      box: { x: Math.round(W * 0.15), y: Math.round(H * (type === 'cta' ? 0.82 : 0.1)), w: Math.round(W * 0.7), h: Math.round(H * 0.1) },
      style: { font: 'Be Vietnam Pro', weight: type === 'cta' ? 800 : 700, size: Math.round(Math.min(W, H) * 0.05), color: '#ffffff', bg: type === 'cta' ? '#e53935' : undefined, align: 'center' },
      in: { preset: 'pop', at: Number((S.player?.t || 1).toFixed(2)), dur: 0.6 }, loop: type === 'cta' ? { preset: 'pulse', count: 4 } : { preset: 'none' } });
    S.sel = id; markDirty(); tabMotion(); drawViz(); toast('Đã thêm lớp — bấm "Lưu & cập nhật preview" để xem.');
  };
  $('#addText').onclick = () => addOverlay('text');
  $('#addCta').onclick = () => addOverlay('cta');
}

function tabAudio() {
  const tl = S.timeline, A = tl.audio, V = A.voice;
  const prov = CFG.tts.providers;
  const cur = prov.find((p) => p.id === V.provider) || prov[0];
  const lines = V.lines || [];
  const noVO = S.project.script && !S.project.script.enough && !lines.length;
  $('#tabBody').innerHTML = `
    <h3 style="margin-top:0">Nhạc nền <span class="muted small">(thư viện đã có quyền sử dụng)</span></h3>
    <div class="row"><label class="f" style="flex:2">Bài nhạc<select data-k="audio.music.trackId">${opt([['', '— Không nhạc —'], ...CFG.music.map((m) => [m.id, `${m.title} · ${m.bpm} BPM · ${m.mood.slice(0, 3).join(', ')}`])], A.music?.trackId || '')}</select></label>
      <button class="small" id="musicPrev">▶ Nghe</button></div>
    <div class="row"><label class="f">Âm lượng nhạc <span id="mv">${Math.round((A.music?.volume ?? 0.8) * 100)}%</span><input type="range" min="0" max="1" step="0.01" data-num data-k="audio.music.volume" value="${A.music?.volume ?? 0.8}"></label><label class="row small"><input type="checkbox" data-k="audio.music.muted" ${A.music?.muted ? 'checked' : ''}> Tắt nhạc</label></div>
    <div class="row"><label class="f">Hạ nhạc dưới lời (dB)<input type="number" min="0" max="30" data-num data-k="audio.duckDb" value="${A.duckDb ?? 12}"></label><label class="f">Fade-out cuối (s)<input type="number" min="0" step="0.1" data-num data-k="audio.fadeOut" value="${A.fadeOut ?? 1.5}"></label></div>
    <h3>Giọng đọc (TTS)</h3>
    ${noVO ? `<div class="note warn">KV có quá ít thông tin để viết lời thoại chính xác — preview hiện chỉ có nhạc. Nhập lời thoại bên dưới rồi bấm "Lưu & cập nhật preview".</div>` : ''}
    <div class="row"><label class="f">Nhà cung cấp<select data-k="audio.voice.provider">${opt(prov.map((p) => [p.id, `${p.label}${p.available ? '' : ' (chưa cấu hình)'}`]), V.provider)}</select></label>
      <label class="f">Giọng<select data-k="audio.voice.voice">${opt(cur.voices.map((v) => [v, v]), V.voice)}</select></label>
      <label class="f">Tốc độ<input type="number" step="0.05" min="0.5" max="2" data-num data-k="audio.voice.speed" value="${V.speed ?? 1}"></label></div>
    <div class="row"><label class="f">Âm lượng giọng <span id="vv">${Math.round((V.volume ?? 1) * 100)}%</span><input type="range" min="0" max="1" step="0.01" data-num data-k="audio.voice.volume" value="${V.volume ?? 1}"></label><label class="row small"><input type="checkbox" data-k="audio.voice.muted" ${V.muted ? 'checked' : ''}> Tắt giọng đọc</label></div>
    <h3>Lời thoại <span class="muted small">— canh theo thời điểm thông tin xuất hiện; giữ nguyên tên thương hiệu, giá, ngày giờ</span></h3>
    <div id="vlines">${lines.map((l, i) => `<div class="vline"><textarea rows="2" data-k="audio.voice.lines.${i}.text">${h(l.text)}</textarea><input type="number" step="0.05" min="0" data-num data-k="audio.voice.lines.${i}.at" value="${l.at ?? ''}" placeholder="${l.start != null ? l.start.toFixed(2) : 'tự động'}" title="Thời điểm bắt đầu (để trống = canh tự động theo ${h(l.anchor || '')})"><button class="small ghost" data-dl="${i}">✕</button></div>`).join('')}</div>
    <div class="row"><button class="small" id="addLine">+ Thêm câu</button><button class="small" id="rewrite">✎ Viết lại lời thoại tự động</button></div>
    ${S.project.script?.issues?.length ? `<div class="note warn small" style="margin-top:8px">${S.project.script.issues.map(h).join('<br>')}</div>` : ''}
    <div class="muted small" style="margin-top:6px">Âm lượng & tắt track nghe được ngay trong preview. Đổi lời/giọng/nhạc cần bấm "Lưu & cập nhật preview" (chỉ tạo lại các câu đã đổi).</div>`;
  bind($('#tabBody'), tl, (key) => {
    if (key === 'audio.voice.provider') { const p = prov.find((x) => x.id === V.provider); V.voice = p.voices[0]; if (!p.available) toast('Nhà cung cấp này chưa được cấu hình API key — xem README.', 5000); tabAudio(); }
    if (key === 'audio.music.trackId') { if (!A.music) A.music = { volume: 0.8 }; if (!A.music.trackId) A.music = { ...A.music, trackId: null }; else A.music.title = CFG.music.find((m) => m.id === A.music.trackId)?.title; }
    if (/volume|muted/.test(key)) { applyVolumes(); $('#mv').textContent = Math.round((A.music?.volume ?? 0) * 100) + '%'; $('#vv').textContent = Math.round((V.volume ?? 0) * 100) + '%'; }
    if (key === 'audio.voice.muted' && !V.muted && !lines.length) toast('Hãy nhập lời thoại.');
  });
  $$('[data-dl]').forEach((b) => b.onclick = () => { V.lines.splice(Number(b.dataset.dl), 1); markDirty(); tabAudio(); });
  $('#addLine').onclick = () => { V.lines ||= []; V.lines.push({ id: 'v' + Date.now().toString(36), text: '', anchor: 'custom', at: Number((S.player?.t || 0).toFixed(2)) }); V.muted = false; markDirty(); tabAudio(); };
  $('#rewrite').onclick = () => { if (confirm('Viết lại lời thoại tự động từ KV/brief? Lời thoại hiện tại sẽ bị thay thế.')) save('?rewriteScript=1'); };
  let audioEl = null;
  $('#musicPrev').onclick = () => {
    const m = CFG.music.find((x) => x.id === A.music?.trackId); if (!m) return;
    if (audioEl) { audioEl.pause(); audioEl = null; $('#musicPrev').textContent = '▶ Nghe'; return; }
    audioEl = new Audio(`/music/${m.file}`); audioEl.volume = 0.6; audioEl.play(); $('#musicPrev').textContent = '■ Dừng';
  };
}

function tabNotes() {
  const tl = S.timeline, p = S.project, a = p.analysis || {};
  const f = a.facts || {};
  const tpl = p.template;
  $('#tabBody').innerHTML = `
    ${(tl.notes || []).map((n) => `<div class="note ${n.level}">${h(n.text)}${n.level === 'need-layer' ? ` <label class="small" style="display:inline-block;margin-left:6px;color:var(--acc2);cursor:pointer">[Tải lớp ${h(ROLE_VI[n.role] || n.role)}<input type="file" accept="image/png,image/webp" data-up="${h(n.role === 'cta' ? 'cta' : n.role)}" style="display:none">]</label>` : ''}</div>`).join('') || '<div class="muted small">Không có ghi chú.</div>'}
    ${p.mode === 'flat' && tpl?.perLayer ? `<div class="card" style="padding:10px;margin-top:8px"><b>Bổ sung lớp để bám mẫu sát hơn</b><div class="muted small">Tải các lớp PNG (cùng khổ KV) — ứng dụng sẽ dựng lại theo mẫu, dùng KV hiện tại làm nền tham chiếu.</div>
      <form id="upLayers" class="grid2" style="margin-top:8px">${['subject', 'text', 'logo', 'cta', 'background'].map((r) => `<label class="f">${ROLE_VI[r]}<input type="file" name="${r}" accept="image/png,image/webp"></label>`).join('')}</form><button class="small primary" id="upGo" style="margin-top:8px">Tải lớp & dựng lại theo mẫu</button></div>` : ''}
    <h3>Phân tích KV <span class="muted small">(${a.source === 'claude' ? 'mô hình đọc ảnh' : 'heuristic + OCR'})</span></h3>
    <table class="facts">
      <tr><td>Ngành hàng</td><td>${h((a.industry || []).join(', ') || '—')}</td></tr>
      <tr><td>Sắc thái</td><td>${h((a.moods || []).slice(0, 6).join(', '))}</td></tr>
      <tr><td>Phong cách</td><td>${h(a.style)}</td></tr>
      <tr><td>Điểm nhấn</td><td>${a.focal ? `x=${a.focal.x}, y=${a.focal.y}` : '—'}</td></tr>
      <tr><td>Bảng màu</td><td>${(a.stats?.palette || []).map((c) => `<span title="${c.hex}" style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${c.hex};margin-right:3px"></span>`).join('')}</td></tr>
      <tr><td>Nhạc</td><td>${h(p.music ? `${p.music.title} (${p.music.bpm} BPM) — ${p.music.reason}` : '—')}</td></tr>
    </table>
    <h3>Nội dung đã duyệt <span class="muted small">(giữ nguyên văn)</span></h3>
    <table class="facts">${['brand', 'headline', 'product', 'price', 'datetime', 'cta', 'terms'].map((k) => `<tr><td>${ROLE_VI[k] || k}</td><td>${h(f[k] || '—')}</td></tr>`).join('')}</table>
    <div class="row" style="margin-top:8px"><button class="small" id="editBrief">Sửa brief & phân tích lại</button></div>
    ${tpl ? `<h3>Video mẫu</h3><div class="muted small">${tpl.duration}s · ${tpl.events.length} sự kiện · camera: ${tpl.camera ? 'có' : 'không'} · chuyển cảnh: ${tpl.cuts.length} · giữ khung cuối ${tpl.hold}s${tpl.perLayer ? ' · chuyển động riêng từng lớp' : ''}</div>
      <table class="facts" style="margin-top:6px">${tpl.events.map((e) => { const m = tl.template?.mapping?.find((x) => x.event === e.id); return `<tr><td>${e.id} ${e.t0}–${e.t1}s</td><td>${h(e.motion.type)}${e.motion.from !== 'none' ? ' từ ' + h(e.motion.from) : ''} · ${h(e.motion.ease)} → ${m ? `<b>${h(tl.layers.find((l) => l.id === m.layer)?.name || m.layer)}</b>` : '<span class="muted">(không có lớp tương ứng)</span>'}</td></tr>`; }).join('')}</table>
      <div class="kfs" style="margin-top:8px">${(tpl.keyframes || []).map((k) => `<figure><img src="/projects/${S.id}/template/${k.file}"><figcaption>${k.t}s</figcaption></figure>`).join('')}</div>` : ''}`;
  $$('[data-up]').forEach((inp) => inp.onchange = () => uploadLayers({ [inp.dataset.up]: inp.files[0] }));
  if ($('#upGo')) $('#upGo').onclick = () => { const files = {}; $$('#upLayers input').forEach((i) => i.files[0] && (files[i.name] = i.files[0])); if (!Object.keys(files).length) return toast('Chọn ít nhất một lớp.'); uploadLayers(files); };
  $('#editBrief').onclick = () => {
    const keys = [['brand', 'Thương hiệu'], ['headline', 'Headline'], ['product', 'Sản phẩm'], ['offer', 'Giá / ưu đãi'], ['datetime', 'Ngày giờ'], ['cta', 'CTA'], ['terms', 'Điều kiện'], ['tone', 'Tone']];
    $('#tabBody').insertAdjacentHTML('beforeend', `<div class="card" id="briefCard" style="margin-top:10px">${keys.map(([k, l]) => `<label class="f">${l}<input data-bf="${k}" value="${h(p.brief?.[k] || '')}"></label>`).join('')}<button class="primary small" id="briefGo" style="margin-top:8px">Phân tích & đề xuất lại</button></div>`);
    $('#briefGo').onclick = async () => {
      const brief = {}; $$('[data-bf]').forEach((i) => (brief[i.dataset.bf] = i.value.trim()));
      try { await api(`/api/projects/${S.id}/replan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief }) }); } catch (e) { toast(e.message); }
    };
  };
}
async function uploadLayers(files) {
  const fd = new FormData(); for (const [k, f] of Object.entries(files)) fd.append(k, f);
  try { await api(`/api/projects/${S.id}/layers`, { method: 'POST', body: fd }); toast('Đang dựng lại với lớp mới…'); } catch (e) { toast(e.message, 5000); }
}

function tabJson() {
  $('#tabBody').innerHTML = `<div class="muted small" style="margin-bottom:6px">Timeline lưu tại <code>data/projects/${S.id}/timeline.json</code>. Sửa trực tiếp rồi bấm Áp dụng.</div>
    <textarea id="tljson" rows="28" spellcheck="false" style="font:12px ui-monospace,Menlo,monospace">${h(JSON.stringify(S.timeline, null, 2))}</textarea>
    <div class="row" style="margin-top:6px"><button class="small" id="applyJson">Áp dụng JSON</button><a class="small" href="/projects/${S.id}/timeline.json" download="timeline.json">Tải timeline.json</a></div>`;
  $('#applyJson').onclick = () => {
    try { S.timeline = JSON.parse($('#tljson').value); markDirty(); toast('Đã áp dụng — bấm "Lưu & cập nhật preview".'); drawViz(); }
    catch (e) { toast('JSON lỗi: ' + e.message, 5000); }
  };
}

boot().catch((e) => { $('#main').innerHTML = `<div class="err">${h(e.message)}</div>`; });
