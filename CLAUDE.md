# CLAUDE.md — KV Motion

Ứng dụng web chạy local, biến Key Visual (KV) tĩnh thành video animation. Mặc định người dùng chỉ upload KV; ứng dụng tự phân tích, đề xuất chuyển động, chọn nhạc, viết lời thoại và tạo giọng đọc tiếng Việt. Video mẫu (MP4/GIF) là tùy chọn; khi có mẫu thì dựng chuyển động theo mẫu. Hướng dẫn cho người dùng cuối nằm trong `README.md` (tiếng Việt). Giao diện và thông báo lỗi đều bằng tiếng Việt — giữ nguyên ngôn ngữ đó khi sửa.

## Chạy và kiểm thử

```bash
npm install
npm start                  # http://localhost:5178 (PORT để đổi cổng)
npm test                   # cần server đang chạy; 3 kịch bản nghiệm thu + render MP4 vào samples/output/
npm test -- --no-render    # nhanh, bỏ render
node tools/snapshot.mjs data/projects/<id>/build/index.html out.png 0,1,2,4   # xem khung hình composition
```

- Yêu cầu: Node ≥ 22, FFmpeg/ffprobe, Chrome (HyperFrames tự tìm). Tùy chọn: `tesseract` + gói `vie` (OCR), `espeak-ng` (TTS mặc định — thiếu thì bước âm thanh báo lỗi).
- `tools/snapshot.mjs`, `tools/make_samples.mjs` cần Playwright. Nếu Playwright cài global, đặt `PLAYWRIGHT_PATH=<đường dẫn tới thư mục playwright>`.
- Không có bước build; frontend là vanilla JS phục vụ tĩnh từ `public/`. Dự án dùng ESM (`"type": "module"`).
- Sau mọi thay đổi ở phân tích/lập kế hoạch/composition: chạy `npm test` và xem khung hình bằng `tools/snapshot.mjs` — test pass chưa đủ để biết video trông ổn.

## Kiến trúc

Pipeline (`server/pipeline.js`, mảng `PIPELINE`): ingest → analyze → template (nếu có mẫu) → music → plan → script → audio → compose. Mỗi bước nhận `(project, log)` và phải idempotent, vì nút "Thử lại" chạy lại từ bước lỗi. Job chạy trong bộ nhớ (`server/index.js`), tiến độ đẩy qua SSE `/api/projects/:id/events`; render MP4 xếp hàng từng cái một.

| Thư mục/file | Vai trò |
|---|---|
| `server/index.js` | Express API, upload (multer), hàng đợi job, SSE, retry |
| `server/pipeline.js` | Các bước pipeline; `stepAudio` dùng lại cho mọi lần chỉnh sửa |
| `server/analyze/image.js` | Bảng màu, độ sáng/bão hòa, điểm nhấn (saliency), bbox alpha của lớp |
| `server/analyze/ocr.js` | Tesseract vie+eng, nhiều lượt (gốc, đảo màu, nhị phân hóa), gộp mảnh cùng dòng |
| `server/analyze/classify.js` | Gán vai trò chữ (headline/price/datetime/cta/terms/brand), ngành hàng, `facts` đã duyệt |
| `server/analyze/claude.js` | Claude vision (tùy chọn): phân tích KV, mẫu, viết lời thoại; mọi lỗi rơi về heuristic |
| `server/analyze/template.js` | Phân tích video mẫu bằng FFmpeg + đo trên ảnh xám 128px: cắt cảnh, camera, sự kiện từng phần tử, easing, thời gian giữ cuối |
| `server/plan/planner.js` | `autoPlan` (6 phong cách trong `STYLES`) và `templatePlan` (ánh xạ sự kiện mẫu → lớp KV) |
| `server/plan/presets.js` | Preset vào cảnh/loop, easing, font; `LOGO_SAFE_IN` |
| `server/audio/script.js` | Lời thoại theo quy tắc + `validateScript` (mọi số/giá/ngày phải có nguyên văn trong facts) |
| `server/audio/spoken.js` | Chuẩn hóa cách đọc tiếng Việt (số, đ, %, ngày giờ, chữ IN HOA) — chỉ ảnh hưởng TTS, không đổi chữ hiển thị |
| `server/tts/index.js` | `PROVIDERS`: espeak, google, openai, elevenlabs, fpt, azure, command |
| `server/audio/mix.js` | Canh lời theo anchor, ghép VO, ducking sidechain, fade-out |
| `server/audio/music.js` | Thư viện `library/music/library.json`, chọn nhạc theo mood + energy |
| `server/compose.js` | timeline.json → `build/index.html` (HyperFrames + GSAP) |
| `server/render.js` | `hyperframes render` trong thư mục build, đọc tiến độ từ dòng `@hf-progress` |
| `public/app.js` | SPA: tạo dự án, tiến độ/lỗi/thử lại, player, kéo thả lớp, tab Chuyển động/Âm thanh/Ghi chú/JSON |

Dữ liệu mỗi dự án: `data/projects/<id>/` gồm `project.json` (inputs, brief, analysis, template, renders, lastError), `timeline.json` (nguồn sự thật có thể chỉnh sửa), `assets/`, `audio/`, `template/`, `build/` (sinh ra, đừng sửa tay), `renders/`, `output.mp4`. `data/` không commit.

## Quy tắc bất biến (đừng phá)

1. **Một composition cho cả preview và MP4.** `compose.js` sinh `build/index.html`; frontend nhúng file đó trong iframe và tự điều khiển `window.__timelines.main.seek(t)` + các `<audio>`. Không thêm logic chỉ-cho-preview vào composition. Composition phải tất định: không `Math.random()`, `Date.now()`, không fetch mạng; timeline đăng ký trên `window.__timelines["main"]`, `paused: true`, kết thúc bằng `tl.set({}, {}, D)`.
2. **Giữ đúng nội dung đã duyệt.** Không bao giờ vẽ lại KV/lớp. Hiệu ứng nhấn trên KV phẳng là bản sao pixel (`type: 'region'` + `srcBox`). Mọi preset vào cảnh kết thúc đúng trạng thái gốc (`inToVars`); loop yoyo luôn số nhịp chẵn và dừng trước `finalHold` → khung cuối là KV nguyên vẹn. Lớp `locked` không đổi được `src`/nội dung (server cưỡng chế trong `PUT /timeline`); logo giữ tỷ lệ và chỉ dùng preset trong `LOGO_SAFE_IN`.
3. **Brief thắng OCR/mô hình.** Brief là nội dung đã duyệt, giữ nguyên văn. Dòng OCR có `conf < 62` không được dùng làm facts. Lời thoại chỉ được chứa số/giá/ngày có trong facts (`validateScript`); vi phạm thì quay về lời theo quy tắc.
4. **Thiếu thông tin thì không bịa lời.** `scriptSufficiency` không đạt → preview chỉ có nhạc, `voice.muted = true`, kèm ghi chú nhắc nhập lời.
5. **Giữ tỷ lệ khung hình gốc** (`canvasFor`: cạnh dài ≤ 1920, cạnh ngắn ≤ 1080, số chẵn). Thời lượng mặc định 8–10s; khi dựng theo mẫu thì giữ thời lượng mẫu (`autoDuration = false`) và rút gọn lời thoại thay vì kéo dài video.
6. **Chỉ dùng nhạc đã có quyền.** Thêm nhạc qua `tools/add_music.mjs` (bắt buộc `--license`). Nhạc kèm theo do `tools/make_music.py` tự tổng hợp (CC0).
7. Không đưa API key vào mã hay git: key đọc từ `.env` (xem `.env.example`), cấu hình ghi đè trong `config/local.json` (đã gitignore; mẫu ở `config/local.example.json`).

## Timeline JSON (tóm tắt)

`canvas {width,height,fps,background}`, `duration`, `autoDuration`, `finalHold`, `intro {fadeFromBlack,dur}`, `camera {keys:[{t,scale,cx,cy,ease?}]}` (chỉ tác động lớp `inStage`), `transitions [{at,type:'flash'|'dip-black'}]`, `anchors {role: giây}` (lúc thông tin xuất hiện, dùng canh lời thoại), `layers[]`, `audio {music{trackId,volume,muted,mix}, voice{provider,voice,speed,volume,muted,lines[{text,anchor,at?,start,dur,file}],mix}, duckDb, fadeOut}`, `notes[] {level: info|warn|need-layer, text, role?}`, `output {format: 'original'|'9:16', fill: 'blur'|'color', fillColor, safeArea}` (khổ xuất — `OUTPUT_FORMATS`/`outputLayout` trong `compose.js`: KV đặt trọn trong `#frame` co giãn, nền `#fill`; tọa độ lớp vẫn theo canvas KV, UI quy đổi qua `data-fx/fy/fs` của `#frame`), `template {video,duration,mapping,timeScale}`.

Lớp: `{id, type: image|region|text|cta, role, src?, srcBox?, box{x,y,w,h} (px canvas), z, locked?, inStage?, visible?, text?, style?, in{preset,at,dur,ease,distance:'auto'|số}, loop{preset,at?,count?,intensity?,shine?}}`. Thêm preset mới: khai báo trong `IN_PRESETS`/`LOOP_PRESETS` và xử lý trong `inFromVars`/`compose.js`; UI tự lấy danh sách từ `/api/config`.

## Lưu ý khi phát triển

- Regex tiếng Việt: `\b` của JS không hoạt động với chữ có dấu. Dùng helper `rx()` trong `classify.js` (ranh giới `\b<` / `\b>` + cờ `iu`).
- `page.evaluate` của Playwright không được trả về object GSAP (gây treo khi serialize) — bọc trong `{ ... }`.
- `template.js` được tinh chỉnh trên `samples/template_layered_A.mp4` và `samples/template_flat_B.gif`; khi sửa ngưỡng, chạy lại `npm test` để đảm bảo cả hai vẫn nhận đúng sự kiện.
- Thay nhà cung cấp TTS: thêm mục vào `PROVIDERS` với `synth(text, voice, tmp)` trả về đường dẫn file audio; `synthesize()` lo chuẩn hóa WAV/loudness/cắt lặng. Câu TTS được cache theo hash (text, provider, voice, speed).
- Mô hình Claude mặc định `claude-opus-5-5` (đổi ở `config` → `vision.model`). Nhánh Claude chưa được kiểm thử thực tế vì môi trường phát triển không có API key — kiểm tra kỹ khi bật.
- Ngoài phạm vi MVP (giai đoạn sau): tự tách lớp từ KV phẳng, phục hồi nền (inpainting), cử động tự nhiên cho nhân vật.
