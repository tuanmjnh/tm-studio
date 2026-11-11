
## 1. Stack chính thức của TMCut (chốt 2026-11-08)

TMCut **không có FFmpeg, FFprobe, FFmpeg.wasm, wrapper hay binary media nào** (ADR-028). Không có fallback:
một codec hay container runtime không hỗ trợ thì capability check báo `Unsupported`, sản phẩm không lặng lẽ
đổi sang một đường khác. Tài liệu này liệt kê các thư viện đã cân nhắc; những mục không thuộc stack chính
thức được giữ lại để tham chiếu lịch sử, và trạng thái của chúng ghi ngay trên mục.

| Lớp | Thư viện / API | Vai trò trong sản phẩm |
|---|---|---|
| Luật dùng chung (Browser + Electron) | `tmcut-core` (`packages/core`) | timeline evaluator, frame scheduler, paint stack, export eligibility, mask/blend/text/audio laws — một artifact cho cả hai host |
| Probe / demux / mux | `mediabunny` | đọc metadata, `CanvasSink` cho thumbnail, `Mp4OutputFormat` cho file ra |
| Decode / encode | WebCodecs (`VideoDecoder`, `VideoEncoder`, `AudioDecoder`, `AudioEncoder`) | đường duy nhất; hỏi `isConfigSupported` trước khi chạy |
| Audio | Web Audio API | mix, gain, waveform; PCM offline cho export |
| Composition | Preview: DOM + CSS `filter` trên các surface media. Export: Canvas 2D (`ctx.filter`, `drawImage`) | painter của exporter và composite của preview — **không có WebGL2 hay WebGPU renderer trong code**; xem ghi chú dưới bảng |
| Lưu bytes | OPFS, fallback IndexedDB | client byte cache khoá theo fingerprint |

Bốn điều người đọc tài liệu này phải nhớ:

- **Browser và Electron dùng chung một Media Engine.** Electron chỉ là shell; nó không có engine riêng và
  không có đường media thứ hai (ADR-032).
- **Không có FFmpeg/FFprobe fallback.** Mục `@ffmpeg/ffmpeg` dưới đây là ghi chú đã nghỉ hưu, không phải
  hướng dẫn cài.
- **Một hàm, một engine.** Preview và export đọc cùng một evaluator, nên không có chuyện monitor và file
  trả lời hai câu khác nhau (ADR-031).
- **Không có GPU renderer.** Bảng trên từng ghi "Canvas 2D + WebGL2, WebGPU" như một kế hoạch; code hiện tại
  không có renderer đó. `app/composables/useTmcutPlatform.ts` khai `webGPU: false` cho cả hai host, không
  file nào trong `app/` mở context WebGL, và lần `getContext('webgl2')` duy nhất trong repo là một health
  check ở `packages/core/src/crashRecovery.mjs`. Đây là giới hạn sản phẩm, không phải thiếu sót cần che.

---

## 2. Cách các lớp phối hợp

**Nguyên tắc phân vai:**
- **Core Engine** = "xương sống" — quản lý timeline, composition, và gọi render.
- **Motion Layer** = tạo hiệu ứng chuyển động (CSS/JS/GSAP/timeline).
- **Effects Layer** = xử lý pixel-level bằng CSS `filter` trên DOM (preview) và `ctx.filter` trên Canvas 2D
  (export). Không có lớp WebGL/WebGPU nào tồn tại trong code; nếu sau này thêm GPU compositor thì nó là
  renderer thứ hai và phải đi kèm test riêng, không được thay thế ngầm lớp này.
- **Render Layer** = đóng gói frame → video file.

---

## 3. Bảng phân loại nhanh (Capability Matrix)

> **Đây là bảng nghiên cứu, không phải danh sách dependency.** Đo trên `package.json` hôm nay: **0 trong 12**
> thư viện ở cột "Package" có mặt trong dependency tree — kể cả những hàng từng ghi "⭐ Bắt buộc".
> Cột cuối ghi *đánh giá tại thời điểm khảo sát*, không phải trạng thái đã chọn. Stack thật nằm ở §1;
> chỉ `mediabunny` (hàng 16) là dependency.

| # | Package / Tên | Vai trò | Dùng để xây app? | Dùng để làm hiệu ứng? | Đánh giá tại thời điểm khảo sát |
|---|---|---|---|---|---|
| 1 | `@diffusionstudio/core` | Core Engine | ✅ | ✅ (2D composition) | ⭐ Khuyến nghị |
| 2 | `@johnesleyer/tiramisu` | Core Engine (WebGL) | ✅ | ✅ (shader effects) | Thay thế #1 |
| 3 | `@hyperframes/core` ⚠️ | Composition Engine | ✅ | ✅ (HTML/GSAP) | Tùy chọn |
| 4 | `gsap` | Animation Engine | ✅ (logic) | ✅ (motion) | ⭐ Bắt buộc |
| 5 | `@scenejs/timeline` | Timeline UI | ✅ (UI) | ❌ | Tùy chọn |
| 6 | `motion-canvas` | Motion Framework | ✅ | ✅ | Tùy chọn |
| 7 | `lottie-web` | Animation Player | ✅ | ✅ (vector motion) | Khuyến nghị |
| 8 | `@rive-app/canvas` | Interactive Anim | ✅ | ✅ | Tùy chọn |
| 9 | `longpipe` ⚠️ | GPU Effects SDK | ❌ | ✅ (blur/matting) | Khuyến nghị |
| 10 | `kampos` | GPU Compositor | ❌ | ✅ (filter/transition) | Khuyến nghị |
| 11 | `gl-transitions` | Shader Library | ❌ | ✅ (transition) | ⭐ Bắt buộc |
| 12 | `pixi.js` | GPU 2D Renderer | ✅ (preview) | ✅ (filter) | Khuyến nghị |
| 13 | `three.js` | WebGL/WebGPU 3D | ✅ | ✅ (3D VFX) | Tùy chọn |
| 14 | `gsap-video-export` | Exporter | ❌ | ❌ (bridge) | ⭐ Bắt buộc |
| 15 | `motion-canvas-webcodecs` ⚠️ | Exporter Plugin | ❌ | ❌ (bridge) | Tùy chọn |
| 16 | `mediabunny` | Muxer/Demuxer | ❌ | ❌ (I/O) | ⭐ **Đã chọn** (ADR-029) |
| 17 | `mp4-muxer` | Muxer MP4 | ❌ | ❌ (I/O) | Không dùng — mediabunny phủ cả hai container |
| 18 | `webm-muxer` | Muxer WebM | ❌ | ❌ (I/O) | Không dùng — cùng lý do |
| 19 | `mp4box` | MP4 Container | ❌ | ❌ (I/O) | Không dùng — mediabunny là demuxer duy nhất |
| 20 | `@ffmpeg/ffmpeg` | Fallback Encoder | ❌ | ❌ (I/O) | **Đã nghỉ hưu (ADR-028)** — không có trong sản phẩm, không có fallback |

---

## 4. CHI TIẾT TỪNG THƯ VIỆN

### 4.1. CORE ENGINE (Xương sống ứng dụng)

> **Vai trò này đã có chủ.** "Core engine" trong sản phẩm là `tmcut-core` (`packages/core`), viết trong
> repo này, không phải một thư viện ngoài. `@diffusionstudio/core` bên dưới là thư viện đã khảo sát và
> **không được cài** — quyết định chốt là sở hữu luật dựng phim trong nhà để preview và export đọc cùng
> một evaluator. Đo hôm nay: `@diffusionstudio/core` không có trong `package.json`.

#### 🔹 `@diffusionstudio/core`
- **Vai trò:** 2D motion graphics engine + video renderer, xây dựng riêng cho WebCodecs.
- **Dùng làm:** Quản lý composition, track, clip, layer; render từng frame; kết nối với encoder.
- **Dùng làm hiệu ứng:** Có sẵn API cho clip 2D, transform, opacity, blend mode; có thể chèn custom shader/render callback.
- **Repo/Docs:** https://github.com/diffusionstudio/core · https://diffusion.studio
- **License:** MIT (cần xác minh lại)
- **Cài đặt:** `npm i @diffusionstudio/core`
- **Điểm tích hợp:** Đây là "trái tim" của app. AI nên dùng nó làm nền tảng, các thư viện khác gắn vào dưới dạng:
  - Motion → chèn vào clip dạng canvas/texture
  - GPU Effects → chèn vào pipeline render frame trước khi encode
- **Ưu điểm:** Nhẹ (~38KB), API giống Premiere/CapCut, không phụ thuộc FFmpeg.wasm.
- **Lưu ý:** Project còn non trẻ — AI nên kiểm tra changelog/version ổn định.

#### 🔹 `@johnesleyer/tiramisu`
- **Vai trò:** Video editor engine trên nền WebGL, tích hợp WebCodecs.
- **Dùng làm:** Toàn bộ logic editor + preview bằng WebGL (mạnh hơn canvas 2D).
- **Dùng làm hiệu ứng:** Có sẵn shader cho blur, chromakey, filter màu.
- **Repo/Docs:** https://github.com/johnesleyer/tiramisu
- **License:** MIT (cần xác minh)
- **Cài đặt:** `npm i @johnesleyer/tiramisu`
- **Điểm tích hợp:** Thay thế hoặc bổ sung cho #1 nếu cần hiệu năng WebGL cao hơn, hoặc cần pipeline shader thuần.

#### 🔹 `@hyperframes/core` ⚠️
- **Vai trò:** Composition engine kiểu "HTML-first" — định nghĩa thời gian bằng `data-*`, animation bằng GSAP timeline.
- **Dùng làm:** Xây dựng video composition từ HTML/CSS thuần, phù hợp cho title, overlay, lower-third, phụ đề động.
- **Dùng làm hiệu ứng:** Có.
- **Repo/Docs:** ⚠️ Cần AI xác minh URL chính thức trước khi tích hợp.
- **Điểm tích hợp:** Lý tưởng khi muốn tạo các "scene" động bằng HTML/CSS thay vì canvas.

---

### 4.2. MOTION / ANIMATION LAYER

#### 🔹 `gsap`
- **Vai trò:** Thư viện animation tiêu chuẩn của web.
- **Dùng làm:** Điều khiển mọi chuyển động (transform, opacity, filter, color, morph SVG...).
- **Dùng làm hiệu ứng:** Có (đây là công cụ tạo hiệu ứng chính).
- **Web:** https://gsap.com
- **License:** Miễn phí cho hầu hết mục đích (thương mại bao gồm, sau khi Webflow mua lại — cần đọc điều khoản mới nhất).
- **Cài đặt:** `npm i gsap`
- **Điểm tích hợp:** Dùng để animate DOM/canvas/text trong timeline; kết hợp với `gsap-video-export` để render.

#### 🔹 `@scenejs/timeline`
- **Vai trò:** UI component timeline cho Scene.js.
- **Dùng làm:** Giao diện timeline cho người dùng (kéo thả, playhead, keyframe).
- **Dùng làm hiệu ứng:** Không.
- **Web:** https://scenejs.net
- **License:** MIT
- **Cài đặt:** `npm i @scenejs/timeline scenejs`
- **Điểm tích hợp:** Dùng làm UI timeline nếu không muốn tự viết. Scene.js core (`scenejs`) dùng để chạy animation theo thời gian.

#### 🔹 `motion-canvas`
- **Vai trò:** Framework tạo animation lập trình (programmatic).
- **Dùng làm:** Tạo motion graphics phức tạp bằng code (dùng cho template, intro, explainer).
- **Dùng làm hiệu ứng:** Có.
- **Web:** https://motioncanvas.io
- **License:** MIT
- **Cài đặt:** `npm i @motion-canvas/core`
- **Điểm tích hợp:** Có thể dùng như "effect authoring tool" — tạo sẵn template motion rồi nhúng vào app.

#### 🔹 `lottie-web` (hoặc `@lottiefiles/dotlottie-web`)
- **Vai trò:** Player animation vector (Bodymovin).
- **Dùng làm:** Nhúng animation từ After Effects vào app dưới dạng vector.
- **Dùng làm hiệu ứng:** Có.
- **Web:** https://airbnb.io/lottie
- **License:** MIT (lottie-web) / Apache 2.0 (dotlottie)
- **Cài đặt:** `npm i lottie-web`
- **Điểm tích hợp:** Cho phép user kéo thả file `.json` Lottie vào timeline → render trong frame.

#### 🔹 `@rive-app/canvas`
- **Vai trò:** Interactive animation (state machine).
- **Dùng làm:** Animation có tương tác, transition state phức tạp.
- **Dùng làm hiệu ứng:** Có.
- **Web:** https://rive.app
- **License:** MIT (runtime)
- **Cài đặt:** `npm i @rive-app/canvas`
- **Điểm tích hợp:** Tương tự Lottie nhưng mạnh hơn về state machine.

---

### 4.3. GPU EFFECTS LAYER

> **Cả bốn thư viện trong mục này đều là nghiên cứu, không phải dependency.** Không thư viện nào có mặt
> trong `package.json`, và **không có GPU effects layer nào trong code**: preview áp look bằng CSS `filter`
> trên phần tử DOM, export áp bằng `ctx.filter` trên Canvas 2D. Mục này giữ lại để tham chiếu nếu sau này
> quyết định thêm GPU compositor — khi đó nó phải là renderer thứ hai có test riêng, không thay thế ngầm
> đường DOM/canvas hiện tại (xem ghi chú §1).

#### 🔹 `longpipe` ⚠️
- **Vai trò:** SDK hiệu ứng video trên WebGPU/WebGL2.
- **Dùng làm:** Xử lý pixel-level: background blur, portrait matting, virtual background, color grading.
- **Dùng làm hiệu ứng:** Có (đây là mục đích chính).
- **Repo/Docs:** ⚠️ Cần AI xác minh package và URL chính thức.
- **Điểm tích hợp:** Chèn vào pipeline giữa "decode frame" và "encode frame" — nhận texture vào, trả texture ra.

#### 🔹 `kampos`
- **Vai trò:** WebGL compositor nhỏ gọn (~4KB).
- **Dùng làm:** Áp filter và transition lên video/image.
- **Dùng làm hiệu ứng:** Có.
- **Repo:** https://github.com/liquid-js/kampos
- **License:** MIT
- **Cài đặt:** `npm i kampos`
- **Điểm tích hợp:** Dùng khi cần hiệu ứng WebGL nhẹ, thay thế đơn giản cho Pixi/Three.

#### 🔹 `gl-transitions`
- **Vai trò:** Bộ sưu tập shader transition GLSL mã nguồn mở.
- **Dùng làm:** Cung cấp shader transition (fade, wipe, morph, burn...) cho layer/GPU compositor.
- **Dùng làm hiệu ứng:** Có.
- **Repo:** https://github.com/gl-transitions/gl-transitions
- **License:** MIT
- **Điểm tích hợp:** Import shader string từ bộ sưu tập, đưa vào Kampos/Pixi/Three để render transition giữa 2 clip.

#### 🔹 `pixi.js`
- **Vai trò:** GPU 2D renderer (WebGL/WebGPU).
- **Dùng làm:** Render preview canvas, filter chain, sprite composition.
- **Dùng làm hiệu ứng:** Có (filter, blend mode, mesh, particle).
- **Web:** https://pixijs.com
- **License:** MIT
- **Cài đặt:** `npm i pixi.js`
- **Điểm tích hợp:** Dùng làm preview canvas chính, kết hợp shader tùy chỉnh cho hiệu ứng.

#### 🔹 `three.js`
- **Vai trò:** 3D engine (WebGL/WebGPU).
- **Dùng làm:** Hiệu ứng 3D, camera move, particle 3D.
- **Dùng làm hiệu ứng:** Có.
- **Web:** https://threejs.org
- **License:** MIT
- **Cài đặt:** `npm i three`
- **Điểm tích hợp:** Chỉ cần nếu app có 3D VFX.

---

### 4.4. RENDER / ENCODE / MUXER LAYER

#### 🔹 `gsap-video-export`
- **Vai trò:** Công cụ chuyển animation GSAP → video.
- **Dùng làm:** Step-through từng frame, chụp ảnh, đưa qua encoder.
- **Dùng làm hiệu ứng:** Không (bridge).
- **Repo:** https://github.com/workeffortwaste/gsap-video-export
- **License:** MIT
- **Cài đặt:** CLI tool, không phải npm package chính thức (kiểm tra README).
- **Điểm tích hợp:** Dùng như "renderer phụ" khi user export một scene HTML/GSAP.

#### 🔹 `motion-canvas-webcodecs` ⚠️
- **Vai trò:** Plugin xuất video cho Motion Canvas bằng WebCodecs.
- **Dùng làm:** Bridge Motion Canvas → MP4.
- **Dùng làm hiệu ứng:** Không.
- **Điểm tích hợp:** Chỉ cần nếu dùng Motion Canvas (#6).

#### 🔹 `mediabunny` ⭐
- **Vai trò:** Muxer/Demuxer WebCodecs cho MP4/MKV/WebM.
- **Dùng làm:** Đóng gói video/audio frame (từ VideoEncoder) thành file.
- **Dùng làm hiệu ứng:** Không (I/O).
- **Web:** https://mediabunny.dev
- **License:** MPL-2.0 (cần xác minh)
- **Cài đặt:** `npm i mediabunny`
- **Điểm tích hợp:** Đây là muxer khuyến nghị — thay thế cả `mp4-muxer` và `webm-muxer` trong cùng một API.

#### 🔹 `mp4-muxer` / `webm-muxer`
- **Vai trò:** Muxer chuyên biệt (tác giả Vanilagy — cùng tác giả Mediabunny).
- **Dùng làm:** Fallback hoặc nếu chỉ cần một container.
- **License:** MIT
- **Cài đặt:** `npm i mp4-muxer webm-muxer`
- **Điểm tích hợp:** Dùng nếu không muốn dùng Mediabunny.

#### 🔹 `mp4box`
- **Vai trò:** Parse/create MP4 container.
- **Dùng làm:** Demux MP4, xử lý metadata, sample table.
- **Dùng làm hiệu ứng:** Không.
- **Repo:** https://github.com/gpac/mp4box.js
- **License:** BSD-3-Clause
- **Cài đặt:** `npm i mp4box`

#### 🔹 `@ffmpeg/ffmpeg` (FFmpeg.wasm) — ĐÃ NGHỈ HƯU
- **Trạng thái:** **Không dùng, không cài, không phải fallback** (ADR-028, quyết định 2026-11-03).
- **Lý do:** TMCut chạy media in-process bằng WebCodecs + Mediabunny. Một runtime không hỗ trợ codec hay
  container nào đó thì capability check báo `unsupported` cho đúng tổ hợp đó — sản phẩm không chuyển sang
  một engine thứ hai, vì hai engine là hai kết quả khác nhau cho cùng một timeline (ADR-031).
- **Không có hướng dẫn cài đặt ở đây.** Gói đã bị gỡ khỏi `package.json` và `pnpm-lock.yaml` ở slice I; dev
  setup không cần thêm bất cứ binary media nào.
- **Mục này được giữ lại để người đọc tài liệu cũ biết nó đã bị thay bằng gì,** không phải để hướng dẫn dùng.

---

## 5. NGUỒN ASSET (Tài nguyên để nhúng vào app)

### 5.1. Hình ảnh (cho phép thương mại)
| Nguồn | URL | Giấy phép |
|---|---|---|
| Pexels | https://pexels.com | Pexels License |
| Pixabay | https://pixabay.com | Pixabay Content License |
| Unsplash | https://unsplash.com | Unsplash License |
| Burst (Shopify) | https://burst.shopify.com | CC0 |
| Picjumbo | https://picjumbo.com | Free for commercial |
| StockSnap | https://stocksnap.io | CC0 |
| Kaboompics | https://kaboompics.com | Free for commercial |
| Life of Pix | https://lifeofpix.com | Free for commercial |
| PxHere | https://pxhere.com | CC0 |
| Pixnio | https://pixnio.com | Public domain |
| LibreShot | https://libreshot.com | CC0 |
| Skitterphoto | https://skitterphoto.com | CC0 |
| Dreamstime CC0 | https://dreamstime.com | CC0 |
| WordPress Photo Directory | https://wordpress.org/photos | CC0 |
| Openverse (meta-search) | https://openverse.org | Đa giấy phép, có filter |

### 5.2. Video
| Nguồn | URL | Giấy phép |
|---|---|---|
| Pexels Video | https://pexels.com/videos | Pexels License |
| Pixabay Video | https://pixabay.com/videos | Pixabay Content License |
| Mixkit | https://mixkit.co | Mixkit Free License |
| Coverr | https://coverr.co | Free for commercial |
| Videvo | https://videvo.net | Đa giấy phép (đọc từng clip) |
| Life of Vids | https://lifeofvids.com | CC0 |
| LoveYouMotion | https://loveyoumotion.com | Free commercial, no watermark |

### 5.3. Audio / Music / SFX
| Nguồn | URL | Giấy phép |
|---|---|---|
| YouTube Audio Library | https://studio.youtube.com | YouTube-safe, có loại cần credit |
| Pixabay Music/SFX | https://pixabay.com/music | Pixabay Content License |
| Mixkit Music/SFX | https://mixkit.co | Mixkit Free License (không TV/Radio) |
| ZapSplat | https://zapsplat.com | Free tier, **bắt buộc credit** |
| Unminus | https://unminus.com | Free commercial, remix OK |
| SFX Kit (GitHub) | https://github.com/... | CC0 |
| Openverse Audio | https://openverse.org | Đa giấy phép |

### 5.4. Hiệu ứng / Overlay / Template
| Nguồn | URL | Loại |
|---|---|---|
| Mixkit Overlays | https://mixkit.co | Light leaks, film texture, bokeh |
| Videezy | https://videezy.com | Overlay |
| Jitter | https://jitter.video | Motion template |
| LottieFiles | https://lottiefiles.com | Lottie animation |
| SVGator | https://svgator.com | Animated SVG |
| Typoanim | https://typoanim.com | Text/title template (AE/PR) |
| FX Elements | https://fxelements.com | VFX overlay (free tier) |
| gl-transitions | https://github.com/gl-transitions/gl-transitions | Shader transition |

---

## 6. KHUYẾN NGHỊ STACK TỐI THIỂU (MVP)

Phần này là **khuyến nghị lịch sử** cho một dự án mới bắt đầu từ đầu; TMCut đã đi xa hơn nó. Stack TMCut
**đang chạy** là bảng ở §1, và ba điểm khác biệt quan trọng so với bản khuyến nghị cũ:

- Core engine là `tmcut-core` trong `packages/core` (đã ship, có test), không phải `@diffusionstudio/core`.
- Exporter là WebCodecs + `mediabunny` viết trong repo (`webCodecsExport.ts`, `exportEncodeSession.ts`),
  không phải `gsap-video-export` chạy CLI — một CLI export sẽ là engine thứ hai, trái ADR-031/ADR-032.
- Không có `@ffmpeg/ffmpeg` ở bất kỳ vai trò nào, kể cả fallback.

Nếu vẫn muốn xem combo tối giản cho một prototype độc lập:

```json
{
  "core": "@diffusionstudio/core",
  "motion": "gsap",
  "vector-animation": "lottie-web",
  "gpu-effects": ["kampos", "gl-transitions"],
  "muxer": "mediabunny",
  "exporter": "WebCodecs in-app + mediabunny muxer"
}
```

Đọc bảng này như **danh sách ứng viên cho prototype mới**, không như mô tả TMCut: combo trên chưa được đo
trong repo này (TMCut không cài `@diffusionstudio/core`, `gsap`, `lottie-web`, `kampos` hay
`gl-transitions`).
