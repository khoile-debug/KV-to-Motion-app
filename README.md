# KV Motion — biến Key Visual tĩnh thành video animation

Ứng dụng web chạy local. Mặc định bạn chỉ cần **upload KV**: ứng dụng tự phân tích bố cục, điểm nhấn và nội dung, tự chọn chuyển động, nhạc và tạo giọng đọc tiếng Việt, rồi dựng preview. Video mẫu (MP4/GIF) là tùy chọn. Khi có mẫu, ứng dụng dựng chuyển động theo mẫu đó.

Chuyển động dùng **HyperFrames + GSAP**. Preview trong trình duyệt và file MP4 dùng **chung một composition** (`data/projects/<id>/build/index.html`). FFmpeg lo việc trích khung hình, xử lý âm thanh và mã hóa.

---

## 1. Cài đặt

Yêu cầu:

- Node.js ≥ 22
- FFmpeg (gồm cả ffprobe)
- Chrome/Chromium (HyperFrames dùng để render; chạy `npx hyperframes doctor` để kiểm tra)
- Tùy chọn nhưng nên có:
  - `tesseract-ocr` + gói ngôn ngữ `tesseract-ocr-vie`: đọc chữ trên KV khi không dùng mô hình đọc ảnh
  - `espeak-ng`: TTS offline có tiếng Việt, là nhà cung cấp mặc định

```bash
# Ubuntu/Debian
sudo apt install ffmpeg tesseract-ocr tesseract-ocr-vie espeak-ng
# macOS
brew install ffmpeg tesseract tesseract-lang espeak-ng
```

```bash
cd kv-motion
npm install
npm start            # http://localhost:5178
```

Thư viện nhạc mẫu đã có sẵn trong `library/music`. Nếu cần tạo lại: `npm run music` (cần python3 + numpy).

## 2. Cách dùng

1. **Dự án mới**: chọn *KV phẳng* (JPG/PNG/WebP) hoặc *KV có lớp*. Các lớp nền, chủ thể, logo, chữ, CTA đều tùy chọn. Nên dùng PNG trong suốt cùng khổ với KV.
2. Tùy chọn: tải **video mẫu** (MP4/GIF) và điền **brief**. Nội dung trong brief được coi là nội dung đã duyệt, được giữ nguyên văn và ưu tiên hơn OCR.
3. Bấm **Tạo preview tự động**. Bạn không cần chọn preset. Màn hình hiển thị tiến độ từng bước, nhật ký và lỗi kèm nút **Thử lại** (chạy lại từ bước bị lỗi).
4. Chỉnh sửa trong preview:
   - **Chuyển động**:
     - thời lượng, thời gian giữ khung cuối, keyframe camera (zoom/pan)
     - với từng lớp: kiểu vào cảnh, thời điểm, thời lượng, easing, nhịp loop, vị trí/kích thước, thứ tự
     - thêm **lớp chữ** hoặc **nút CTA** riêng (font, cỡ, màu, căn lề)
     - bấm vào lớp trên preview để chọn, kéo để đổi vị trí
   - **Âm thanh**:
     - đổi nhạc, sửa từng câu lời thoại, đổi nhà cung cấp/giọng/tốc độ đọc
     - chỉnh âm lượng hoặc tắt riêng nhạc/giọng (nghe được ngay)
     - mức hạ nhạc dưới lời (dB) và độ dài fade-out
   - **Phân tích & ghi chú**: ngành hàng, sắc thái, nội dung đã duyệt, các sự kiện của mẫu và cách ánh xạ sang lớp, danh sách **lớp cần bổ sung** (kèm nút tải lớp để dựng lại sát mẫu hơn).
   - **Timeline JSON**: sửa trực tiếp hoặc tải `timeline.json` về.
5. Bấm **Lưu & cập nhật preview**. Ứng dụng chỉ tạo lại TTS cho những câu đã đổi, sau đó mix lại và dựng lại composition.
6. Chọn **Khổ video** ngay trên nút xuất:
   - **Gốc**: giữ tỷ lệ KV.
   - **9:16 · TikTok / Reels / Shorts** (1080×1920): KV được đặt trọn trong khung, không cắt nội dung. Phần thừa phía trên/dưới là ảnh KV phóng to làm mờ hoặc một màu tùy chọn.
   - Ô **Chừa vùng an toàn TikTok** (bật sẵn) giữ KV tránh thanh trên, cột nút bên phải và phần chú thích phía dưới.
   - Preview cập nhật theo khổ đã chọn. Muốn có cả hai bản thì xuất một lần ở mỗi khổ; file 9:16 có hậu tố `_9x16`.
7. Bấm **Xuất MP4** để xem thanh tiến độ render. File nằm ở `data/projects/<id>/renders/`; bản mới nhất được sao thêm thành `output.mp4`.

Timeline (kể cả khổ video, trường `output`) được lưu tại `data/projects/<id>/timeline.json`, nên bạn có thể mở lại dự án, chỉnh và render lại bất cứ lúc nào.

## 3. Cấu hình mô hình đọc ảnh (tùy chọn)

Ứng dụng có hai chế độ phân tích:

- **Không có API key**: phân tích heuristic (bảng màu, saliency, bố cục) kết hợp OCR tesseract; lời thoại được viết theo quy tắc, chỉ từ nội dung đã duyệt.
- **Có `ANTHROPIC_API_KEY`** (đặt trong `.env`): ứng dụng dùng Claude (`vision.model` trong config, mặc định `claude-opus-5-5`) để:
  - phân tích KV
  - đối chiếu các khung hình tham chiếu của video mẫu
  - viết lời thoại

Lời thoại do mô hình viết được kiểm tra lại: mọi con số, giá và ngày giờ phải có nguyên văn trong nội dung đã duyệt, nếu không ứng dụng tự quay về lời thoại theo quy tắc. Mọi lỗi API cũng rơi về chế độ heuristic.

```bash
cp .env.example .env    # điền ANTHROPIC_API_KEY=...
```

Có thể ép chế độ bằng `KV_VISION_PROVIDER=heuristic|claude`.

## 4. Cấu hình TTS (thay nhà cung cấp)

Chọn nhà cung cấp bằng `KV_TTS_PROVIDER` trong `.env`, hoặc `tts.provider` trong `config/local.json` (xem `config/local.example.json`). Trong trình sửa cũng đổi được theo từng dự án.

| provider | Ghi chú | Cấu hình |
|---|---|---|
| `espeak` (mặc định) | Offline, có `vi`, `vi-vn-x-central`, `vi-vn-x-south`; giọng máy | cài `espeak-ng` |
| `google` | Google Cloud TTS, giọng `vi-VN-Neural2-A/D`, Wavenet… | `GOOGLE_TTS_API_KEY` |
| `fpt` | FPT.AI (banmai, lannhi, leminh…) | `FPT_TTS_API_KEY` |
| `azure` | `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural` | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` |
| `openai` | gpt-4o-mini-tts | `OPENAI_API_KEY` |
| `elevenlabs` | eleven_multilingual_v2 | `ELEVENLABS_API_KEY` |
| `command` | Lệnh bất kỳ, ví dụ **Piper** offline với model `vi_VN-vais1000-medium` | `tts.providers.command.cmd`, có `{out}`, `{voice}`, `{text}`; `stdin: true` để truyền chữ qua stdin |

Muốn thêm nhà cung cấp khác, thêm một mục vào `PROVIDERS` trong `server/tts/index.js` với hàm `synth(text, voice, tmpPath)` trả về đường dẫn file audio.

Cách xử lý câu đọc:

- Mỗi câu được chuẩn hóa về WAV 44.1 kHz, cắt khoảng lặng và đưa về khoảng −16 LUFS.
- Chữ hiển thị giữ nguyên văn. Riêng cách đọc được chuẩn hóa cho tiếng Việt, ví dụ `29.000đ` đọc thành "hai mươi chín nghìn đồng", `15/11` thành "mười lăm tháng mười một", `-30%` thành "giảm ba mươi phần trăm".

## 5. Thêm nhạc

Chỉ thêm nhạc **đã có quyền sử dụng**. Lệnh dưới đây bắt buộc ghi nguồn/giấy phép:

```bash
node tools/add_music.mjs ~/Downloads/track.mp3 --title "Summer Sale" --mood energetic,sale,fashion --bpm 124 --energy 0.85 --license "Artlist #12345, giấy phép thương mại"
```

Hoặc chép file WAV vào `library/music/` rồi thêm một mục vào `library/music/library.json`.

- **Chọn nhạc tự động**: ứng dụng chấm điểm từng bài theo `mood` (khớp với sắc thái/ngành hàng của KV) và `energy` (khớp với phong cách và nhịp chuyển động).
- **Canh nhịp**: thời điểm các chuyển động được canh vào lưới nửa phách theo `bpm` của bài được chọn.
- **Mood nên dùng**: energetic, playful, calm, luxury, elegant, premium, corporate, tech, finance, trust, festive, tet, warm, food, family, beauty, cosmetics, fashion, sale, healthcare, minimal, real-estate.

Thư viện kèm theo gồm 7 bài nhạc nền do dự án tự tổng hợp bằng `tools/make_music.py` (CC0, dùng thương mại tự do). Đây là nhạc mẫu đơn giản; nên thay bằng thư viện nhạc có bản quyền của đơn vị.

## 6. Cách hoạt động

| Bước | Module |
|---|---|
| Nhận file, chuẩn hóa khung hình (giữ tỷ lệ gốc, cạnh dài ≤ 1920, cạnh ngắn ≤ 1080), cắt lớp theo alpha, ghép composite | `server/pipeline.js` |
| Phân tích KV: bảng màu, độ sáng/bão hòa, điểm nhấn, OCR, phân vai trò (headline/giá/ngày giờ/CTA/điều kiện/thương hiệu), ngành hàng, sắc thái | `server/analyze/image.js`, `ocr.js`, `classify.js`, `claude.js` |
| Phân tích video mẫu: cắt cảnh, camera toàn cảnh, sự kiện xuất hiện của từng phần tử (thời điểm, hướng, quãng, easing), thời gian giữ khung cuối, khung hình tham chiếu | `server/analyze/template.js` |
| Lập timeline tự động (6 phong cách) hoặc ánh xạ mẫu sang lớp KV | `server/plan/planner.js`, `presets.js` |
| Lời thoại → TTS → canh theo thời điểm thông tin xuất hiện → hạ nhạc (sidechain) → fade-out | `server/audio/*`, `server/tts/index.js` |
| Composition HyperFrames (HTML + GSAP), dùng cho cả preview lẫn render | `server/compose.js` |
| Render MP4 (`hyperframes render`), có tiến độ | `server/render.js` |

**Giữ đúng nội dung đã duyệt**

- KV và các lớp không bao giờ bị vẽ lại.
- Hiệu ứng "nhấn" trên KV phẳng là bản sao pixel y hệt của vùng giá hoặc CTA.
- Mọi chuyển động vào cảnh đều kết thúc đúng vị trí gốc. Loop luôn trở về trạng thái gốc trước khung cuối, nên khung cuối luôn là KV nguyên vẹn.
- Lớp logo, chữ và vùng nội dung bị khóa: không đổi được ảnh hay nội dung, logo luôn giữ tỷ lệ, và chỉ dùng được các preset biến đổi đồng đều.

**Khi KV thiếu thông tin**: nếu KV và brief không đủ để viết lời thoại chính xác, preview chỉ có nhạc. Tab Âm thanh sẽ nhắc bạn nhập lời thoại.

**Mẫu có chuyển động từng lớp nhưng KV phẳng**: preview chỉ dùng các hiệu ứng khả thi trên toàn ảnh (camera đi qua từng vùng theo nhịp mẫu, fade, nhấn vùng). Phần ghi chú liệt kê từng lớp cần bổ sung. Khi bạn tải thêm lớp, ứng dụng dựng lại theo mẫu.

### Timeline JSON (rút gọn)

```jsonc
{
  "canvas": { "width": 1080, "height": 1350, "fps": 30, "background": "#c2361a" },
  "duration": 10, "finalHold": 1.6, "intro": { "fadeFromBlack": true, "dur": 0.3 },
  "camera": { "keys": [ { "t": 0, "scale": 1.25, "cx": 0.5, "cy": 0.63 }, { "t": 1.9, "scale": 1, "cx": 0.5, "cy": 0.5 } ] },
  "layers": [
    { "id": "subject", "type": "image", "role": "subject", "src": "assets/layer_subject.png",
      "box": { "x": 1250, "y": 130, "w": 490, "h": 840 }, "z": 1,
      "in": { "preset": "slide-right", "at": 0.67, "dur": 0.58, "ease": "power3.out", "distance": "auto" },
      "loop": { "preset": "float", "count": 4, "intensity": 0.8 } },
    { "id": "cta_1", "type": "cta", "text": "ĐẶT NGAY", "inStage": false,
      "style": { "font": "Be Vietnam Pro", "weight": 800, "size": 48, "color": "#fff", "bg": "#e53935" }, "box": { } , "in": { "preset": "pop", "at": 3 } }
  ],
  "transitions": [ { "at": 2.0, "type": "flash" } ],
  "audio": {
    "music": { "trackId": "festive-tet", "volume": 0.8, "muted": false },
    "voice": { "provider": "espeak", "voice": "vi", "speed": 1, "volume": 1, "muted": false,
               "lines": [ { "text": "CHỈ 29.000Đ.", "anchor": "price", "at": null } ] },
    "duckDb": 12, "fadeOut": 1.5
  }
}
```

- Preset vào cảnh: `none, fade, fade-up, slide-left/right/top/bottom, zoom-in, zoom-out, pop, blur-in, wipe-left/right/up/down, rotate-in, drop`.
- Preset loop: `none, float, pulse, breathe, kenburns, sway, shine` (cộng thêm `shine: true` để có vệt sáng).

## 7. Kiểm thử

```bash
npm start                  # cửa sổ 1
npm test                   # cửa sổ 2 — 3 kịch bản nghiệm thu + render MP4 vào samples/output/
npm test -- --no-render    # nhanh, bỏ qua render
```

Ba kịch bản:

1. KV phẳng, không mẫu, không brief, không chọn preset. Kiểm tra: preview có chuyển động, nhạc, giọng đọc; lời thoại giữ nguyên giá và ngày; câu đọc canh theo thời điểm thông tin xuất hiện.
2. KV có lớp kèm mẫu MP4. Kiểm tra: ánh xạ sự kiện của mẫu sang từng lớp (nền fade, chủ thể trượt từ phải, chữ, logo); timeline lưu được; chỉnh sửa được giữ sau khi cập nhật.
3. KV phẳng kèm mẫu GIF có chuyển động riêng từng lớp. Kiểm tra: preview dùng hiệu ứng toàn ảnh, giữ nhịp và thời lượng của mẫu, và liệt kê lớp cần bổ sung.

Dữ liệu kiểm thử nằm trong `samples/`; tạo lại bằng `npm run samples` (cần Playwright). Các thương hiệu trong mẫu đều là hư cấu. Xem nhanh khung hình của một composition:

```bash
node tools/snapshot.mjs data/projects/<id>/build/index.html sheet.png 0,1,2,4,8
```

## 8. Giới hạn của MVP / giai đoạn sau

- **Chưa có**:
  - tự tách lớp từ KV phẳng
  - phục hồi nền phía sau chủ thể (inpainting)
  - tạo cử động tự nhiên cho nhân vật
- **Phân tích mẫu bằng heuristic** hoạt động tốt với chuyển động đồ họa rõ ràng (trượt, phóng, bật, mờ, camera zoom/pan, cắt cảnh). Với mẫu phức tạp (nhiều lớp chồng, hiệu ứng hạt, 3D) nên bật mô hình đọc ảnh; trong mọi trường hợp vẫn sửa được timeline.
- **OCR tesseract** có thể sai với font trang trí. Hãy điền brief cho các nội dung quan trọng (thương hiệu, headline, giá, ngày, CTA), vì brief luôn được ưu tiên và giữ nguyên văn.
- **Giọng espeak** nghe máy; nên dùng Google, FPT hoặc Azure cho bản phát hành.
- **Video mẫu ngắn**: lời thoại tự được rút gọn cho vừa thời lượng (giữ giá và CTA). Có thể thêm lại câu bị bỏ, hoặc tăng thời lượng trong trình sửa.
