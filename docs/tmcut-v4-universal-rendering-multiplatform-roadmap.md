# TMCut V4 – Universal HTML/GPU Video Rendering & Multi-Platform Architecture

> **Tài liệu định hướng kiến trúc và roadmap triển khai**
>
> Trạng thái: Proposal / Architecture Blueprint  
> Phiên bản tài liệu: 1.0  
> Nền tảng hiện tại: Nuxt 4 + Vue 3 + Nuxt UI + Electron  
> Mục tiêu: Xây dựng TMCut thành nền tảng biên tập và xử lý video đa nền tảng, dùng chung Project Core, Timeline Core và Rendering Core.
>
> **Cập nhật 2026-11-03:** tài liệu này vẫn là blueprint kiến trúc, nhưng mọi chỗ nó cho phép FFmpeg ở lại đã bị [ADR-028](file:///D:/Applications/tm-studio/docs/adr/zero-ffmpeg-decisions.md) supersede; nguồn sự thật của media pipeline là plan browser-first và [docs/audit/zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md). Bản thân roadmap sẽ được archive ở slice K của kế hoạch đó.

---

## 1. Tóm tắt định hướng

TMCut V4 được định hướng chuyển từ mô hình:

**HTML Preview → chuyển đổi thành FFmpeg Filter Graph → FFmpeg Export**

sang mô hình:

**Shared Project/Timeline Core → Unified HTML/GPU Rendering Engine → Frame Pipeline → WebCodecs/Muxer**

FFmpeg **không còn là một phần của kiến trúc** (ADR-028, ghi ngày 2026-11-03): không backend tùy chọn, không fallback, không media operation chuyên biệt dành riêng cho nó. Năng lực media thuộc runtime — WebCodecs cho decode/encode, Mediabunny cho demux/mux, Web Audio cho audio, GPU compositor cho composition — và được khai bằng capability check của host, không bằng tên nền tảng.

### 1.1 Các nguyên tắc cốt lõi

1. **HTML-first, GPU-accelerated:** HTML/CSS/SVG phù hợp với typography, subtitle, template, vector và motion graphics; GPU compositor xử lý video/image layers, transforms, compositing và effects.
2. **Preview/Export dùng chung logic:** Cùng Project Core, Timeline Core, effect definitions, transform model và timestamp evaluation.
3. **Deterministic rendering:** Render theo timestamp/frame index xác định, không phụ thuộc đồng hồ thực hoặc tốc độ playback.
4. **Platform-independent project:** Project JSON không phụ thuộc Electron, browser, VPS hay Vercel.
5. **Runtime adapters:** Native APIs, filesystem, process, downloader, storage và remote jobs được trừu tượng hóa qua adapter.
6. **Progressive enhancement:** WebGPU/WebCodecs được sử dụng khi hỗ trợ; có fallback phù hợp như WebGL2, Canvas2D hoặc native backend.
7. **Local-first, cloud-capable:** Người dùng có thể xử lý media tại máy; cloud worker là lựa chọn bổ sung, không bắt buộc.
8. **Zero FFmpeg (ADR-028):** renderer không phụ thuộc FFmpeg filter graph, và cũng không còn một adapter FFmpeg để gọi "khi thực sự cần"; runtime thiếu capability nào thì báo thiếu capability đó.

### 1.2 Phạm vi mục tiêu

TMCut hướng tới các sản phẩm/runtime:

- TMCut Desktop: Electron trên Windows, macOS, Linux.
- TMCut Web Local: Web app chạy trên trình duyệt, dùng file do người dùng chọn và tài nguyên máy người dùng.
- TMCut Web Cloud: Web app deploy trên Vercel hoặc VPS.
- TMCut Remote Worker: Dịch vụ xử lý media trên VPS/server.
- TMCut Agent: Native helper chạy trên máy người dùng, cung cấp các khả năng mà browser không được phép truy cập trực tiếp.

---

## 2. Kiến trúc tổng thể

```mermaid
flowchart TB
    UI["TMCut Shared Application<br/>Nuxt 4 · Vue 3 · Nuxt UI"]
    CORE["Shared Core<br/>Project · Timeline · Timebase · Keyframes"]
    PLATFORM["Platform Adapter Layer<br/>File · Process · Storage · Media · GPU · Network"]
    RENDER["Unified Rendering Core<br/>Frame Scheduler · DOM Renderer · GPU Compositor"]
    EXPORT["Export Pipeline<br/>Frame Capture · WebCodecs · Audio · Muxer"]

    UI --> CORE
    CORE --> PLATFORM
    CORE --> RENDER
    RENDER --> EXPORT

    PLATFORM --> ELECTRON["Electron Runtime"]
    PLATFORM --> BROWSER["Browser Runtime"]
    PLATFORM --> SERVER["Node.js / VPS Runtime"]
    PLATFORM --> VERCEL["Vercel API / Orchestration"]

    EXPORT --> LOCAL["Local Export"]
    EXPORT --> WORKER["Remote Worker"]
    PLATFORM --> AGENT["TMCut Local Agent"]
    AGENT --> NATIVE["yt-dlp · local file access · media cache"]
    WORKER --> STORAGE["Object Storage"]
```

### 2.1 Các lớp kiến trúc

| Lớp | Trách nhiệm |
|---|---|
| Application/UI | Editor, timeline, inspector, media library, settings |
| Project Core | Project schema, serialization, migration, validation |
| Timeline Core | Track, clip, layer, timebase, keyframe, easing |
| Rendering Core | Đánh giá composition tại timestamp và tạo frame |
| DOM Renderer | Text, HTML templates, SVG, CSS-based elements |
| GPU Compositor | Video/image textures, transform, blend, mask, effects |
| Media Core | Media metadata, source, decode lifecycle, audio/video timing |
| Export Core | Frame scheduling, encoding, audio pipeline, muxing |
| Platform Adapter | Cầu nối với browser, Electron, Node.js và cloud |
| Agent/Worker | Native process, downloader, server-side render jobs |

---

## 3. Project Core và Timeline Core

Đây là nền móng quan trọng nhất. Không để Project JSON chứa các chi tiết riêng của FFmpeg, Electron hoặc một browser cụ thể.

### 3.1 Project schema

Project nên lưu các thông tin mang tính biên tập:

- Project ID, schema version, name.
- Canvas/composition width, height, frame rate.
- Timebase và duration.
- Media assets và metadata tham chiếu.
- Tracks, clips, layers.
- Transform, crop, opacity, blend mode.
- Effects và effect parameters.
- Keyframes, interpolation và easing.
- Audio tracks, gain, pan, fades.
- Export profile.
- Asset references/relative paths hoặc storage references.

Không lưu đường dẫn tuyệt đối của máy A như một định danh duy nhất. Nên có `assetId`, `sourceUri`, `relativePath`, `storageKey` và cơ chế relink asset.

### 3.2 Timebase

Sử dụng timebase độc lập với frame rate để tránh sai số tích lũy. Nếu project hiện tại đã dùng 120.000 ticks/giây, có thể tiếp tục dùng làm nền tảng, nhưng cần chuẩn hóa quy tắc chuyển đổi giữa:

- ticks
- microseconds
- frame index
- source media timestamp
- composition timestamp

Ví dụ:

```ts
interface Timebase {
  ticksPerSecond: number
}

interface FrameRate {
  numerator: number
  denominator: number
}

function frameToTicks(
  frameIndex: number,
  fps: FrameRate,
  ticksPerSecond: number
): number {
  return Math.round(
    frameIndex * ticksPerSecond * fps.denominator / fps.numerator
  )
}
```

Không giả định mọi FPS đều là số nguyên; cần hỗ trợ 23.976, 29.97, 59.94 dưới dạng rational numerator/denominator.

### 3.3 Timeline evaluation

Timeline Core cần có API thuần, không phụ thuộc UI:

```ts
interface TimelineEvaluator {
  evaluateAt(timestamp: number): EvaluatedComposition
}
```

Kết quả đánh giá phải xác định:

- Clip/layer nào đang active.
- Source timestamp tương ứng.
- Transform tại thời điểm đó.
- Effect parameters tại thời điểm đó.
- Opacity/blend/mask.
- Transition progress.
- Audio gain/pan/fade.
- Thứ tự compositing.

UI Preview và Export đều gọi cùng logic evaluation này.

---

## 4. Unified Rendering Engine

### 4.1 Triết lý

Không dùng CSS animation chạy theo thời gian thực làm nguồn sự thật của export. Mọi animation phải được tính từ timestamp của timeline.

Thay vì yêu cầu browser tự chạy animation 10 giây rồi chụp lại, engine cần có thể yêu cầu:

```ts
await renderer.renderAt(5.25)
```

và nhận được composition chính xác tại 5,25 giây.

### 4.2 Renderer abstraction

```ts
interface RenderRequest {
  timestamp: number
  width: number
  height: number
  quality?: 'preview' | 'final'
}

interface RenderResult {
  frame: VideoFrame | ImageBitmap
  timestamp: number
  width: number
  height: number
}

interface Renderer {
  initialize(): Promise<void>
  renderAt(request: RenderRequest): Promise<RenderResult>
  dispose(): Promise<void>
}
```

Đây là interface định hướng. Cần quản lý vòng đời `VideoFrame`, `ImageBitmap`, GPU texture và resource rõ ràng; giải phóng tài nguyên sau khi encoder tiêu thụ xong.

### 4.3 DOM Renderer

Dùng cho:

- Text và typography.
- Subtitle/caption.
- HTML template.
- SVG, icon, vector shapes.
- Sticker và lower-third.
- CSS layout, gradient, shadow.
- Một số animation và visual element.

Lưu ý: DOM không tự động trở thành texture GPU trong mọi browser. Cần thiết kế cơ chế capture/rasterize DOM thành texture hoặc render element qua surface riêng. Cần kiểm thử giới hạn của Chromium/browser, đặc biệt với font, filter, cross-origin media và CSS features.

### 4.4 GPU Compositor

Khuyến nghị hỗ trợ theo thứ tự:

1. WebGL2 làm baseline tương thích rộng.
2. WebGPU là backend nâng cao khi runtime hỗ trợ ổn định.
3. Canvas2D là fallback cho trường hợp đơn giản hoặc GPU không khả dụng.

GPU compositor xử lý:

- Video frames và image textures.
- Layer ordering.
- Transform matrix.
- Alpha blending.
- Blend modes.
- Crop/UV mapping.
- Masks.
- Color adjustments.
- Blur/glow/distortion.
- Transition shaders.
- Custom GLSL/WGSL effects.

Không nên giả định WebGPU luôn có mặt trên mọi máy hoặc mọi môi trường remote/headless. Cần capability detection và backend fallback.

### 4.5 Media Renderer

Media renderer quản lý:

- Video source decode.
- Audio source decode.
- Source timestamp và composition timestamp.
- Seek và keyframe behavior.
- Frame caching.
- Proxy media.
- Audio/video synchronization.
- Decode concurrency.

Không được coi video 15 phút là một ảnh lớn hoặc yêu cầu phát liên tục từ đầu đến cuối để có thể truy cập một timestamp.

---

## 5. Video Transform Engine

Các thao tác zoom, flip, pan, rotate, crop không bắt buộc phải dùng FFmpeg. Đây là các phép biến đổi hình học có thể xử lý trong DOM hoặc GPU. Với video editor, GPU compositor thường là lựa chọn phù hợp hơn để giữ hiệu năng và đảm bảo cùng logic cho nhiều layer.

### 5.1 Transform model

```ts
interface VideoTransform {
  position: {
    x: number
    y: number
  }

  scale: {
    x: number
    y: number
  }

  rotation: number

  anchor: {
    x: number
    y: number
  }

  crop: {
    top: number
    bottom: number
    left: number
    right: number
  }

  opacity: number
  fit: 'contain' | 'cover' | 'fill'
}
```

Ví dụ:

- Zoom: thay đổi scale.
- Flip horizontal: scale.x âm hoặc cờ flip riêng.
- Flip vertical: scale.y âm hoặc cờ flip riêng.
- Pan: thay đổi position.
- Rotate: thay đổi rotation.
- Crop: thay đổi vùng UV hoặc clip region.
- Opacity: alpha.
- Anchor: điểm neo để xoay/scale.

### 5.2 Tọa độ

Quy tắc bắt buộc:

- Lưu transform trong composition coordinate system.
- Không lưu tọa độ CSS pixel phụ thuộc kích thước cửa sổ.
- Preview chỉ chuyển đổi composition coordinates sang viewport coordinates.
- Export dùng cùng transform values và cùng matrix calculation.
- Định nghĩa rõ thứ tự transform: translate, anchor, rotate, scale, crop hoặc một quy ước matrix thống nhất.

### 5.3 Keyframe

Transform và effect parameters phải hỗ trợ:

- Linear interpolation.
- Bezier/easing.
- Hold/constant.
- Motion path khi cần.
- Keyframe interpolation độc lập với FPS.
- Timestamp evaluation deterministic.

---

## 6. Effects, Transitions và Plugin API

### 6.1 Effect categories

- Geometry: transform, crop, perspective.
- Color: brightness, contrast, saturation, hue, temperature.
- Blur: gaussian blur, directional blur, motion blur.
- Stylize: glow, outline, pixelate, noise.
- Keying: chroma key, luma key.
- Mask: shape mask, image mask, animated mask.
- Distortion: wave, displacement, lens distortion.
- Compositing: blend modes, opacity.
- Motion: tracking, stabilization, optical flow (cần thuật toán chuyên biệt).

### 6.2 Transition engine

Transition được định nghĩa bằng progress từ 0 đến 1 và composition timestamp, không dựa vào CSS wall-clock animation.

Ví dụ:

```ts
interface TransitionContext {
  progress: number
  timestamp: number
  width: number
  height: number
}

interface TransitionRenderer {
  render(
    from: VideoFrame,
    to: VideoFrame,
    context: TransitionContext
  ): Promise<VideoFrame>
}
```

### 6.3 Plugin API

Cho phép đăng ký effect/transition mới:

```ts
interface EffectPlugin<TParams = unknown> {
  id: string
  version: string
  schema: unknown
  defaultParams: TParams

  render(
    input: VideoFrame,
    params: TParams,
    timestamp: number,
    context: GpuRenderContext
  ): Promise<VideoFrame>
}
```

Cần có versioning, parameter schema, validation, capability requirements và cơ chế sandbox phù hợp. Không chạy plugin không đáng tin cậy với quyền truy cập tùy ý vào filesystem/process.

---

## 7. Preview và Export: cùng lõi, khác chính sách chất lượng

### 7.1 Preview

Preview ưu tiên phản hồi nhanh:

- Resolution thấp hơn final khi cần.
- Cache frame.
- Decode theo nhu cầu.
- Proxy media.
- Giảm chất lượng effect nặng trong lúc kéo timeline.
- Scrubbing và playback.
- Có thể bỏ frame khi playback realtime bị quá tải.

### 7.2 Export

Export ưu tiên độ chính xác:

- Render theo frame index/timestamp xác định.
- Không bỏ frame.
- Chờ decode và render hoàn tất.
- Kiểm soát encoder backpressure.
- Đồng bộ audio/video.
- Có thể render offline nhanh hơn hoặc chậm hơn realtime.
- Có checkpoint và retry theo segment nếu thiết kế hỗ trợ.

### 7.3 Deterministic Frame Scheduler

Không sử dụng cách `sleep(33)` giữa các lần screenshot. Cách này phụ thuộc tốc độ máy và thời gian xử lý.

Ví dụ logic:

```ts
const fps = { numerator: 30, denominator: 1 }
const durationSeconds = 10
const totalFrames = Math.ceil(
  durationSeconds * fps.numerator / fps.denominator
)

for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
  const timestampSeconds =
    frameIndex * fps.denominator / fps.numerator

  const result = await renderer.renderAt({
    timestamp: timestampSeconds,
    width: 1920,
    height: 1080,
    quality: 'final'
  })

  await encoder.encode(result.frame, {
    frameIndex,
    timestampSeconds
  })

  result.frame.close()
}
```

Đây là pseudocode. Implementation thực tế phải xử lý timestamp theo đơn vị mà WebCodecs yêu cầu, encoder queue/backpressure, frame duration, lỗi decode và giải phóng resource đúng thời điểm.

### 7.4 Preview/Export parity

Cùng dùng:

- Timeline evaluator.
- Transform model.
- Effect definitions.
- Transition definitions.
- Font/assets.
- Coordinate system.
- Timestamp semantics.

Có thể khác:

- Preview resolution.
- Preview quality.
- Cache policy.
- Decode strategy.
- Encoder settings.

Không thể cam kết pixel-perfect tuyệt đối giữa mọi GPU/driver/browser nếu shader, color management hoặc font rasterization khác nhau. Cần xây dựng visual regression test và tolerance hợp lý.

---

## 8. Import và xử lý video dài 15 phút

**Import video 15 phút không yêu cầu chờ 15 phút.** Import chủ yếu là đọc metadata, đăng ký asset và tạo các dữ liệu hỗ trợ như thumbnail/waveform. Preview playback phát theo thời gian thực; export là một quá trình riêng.

### 8.1 Import workflow

1. Người dùng chọn video.
2. Đọc metadata: duration, dimensions, FPS, codec, audio tracks.
3. Tạo asset record.
4. Đưa asset lên timeline.
5. Tạo thumbnail/waveform ở background nếu cần.
6. Cho phép seek tới timestamp khi media decoder sẵn sàng.

### 8.2 Seek video

Với codec inter-frame như H.264/H.265, seek có thể cần decode từ keyframe gần nhất rồi tiến đến frame mục tiêu. Không phải mọi timestamp đều là điểm seek trực tiếp.

Cần:

- Keyframe-aware seek.
- Decode queue.
- Frame cache.
- Proxy media.
- Pre-roll decode khi scrub.
- Giới hạn số decoder đồng thời.

### 8.3 Proxy và cache

Proxy media hữu ích khi:

- Source 4K/8K.
- Codec khó decode.
- Nhiều layer video.
- Máy có decoder hạn chế.
- Preview cần scrubbing mượt.

Proxy là bản media nhẹ để preview; export final vẫn có thể dùng source gốc.

### 8.4 Render nhanh hơn realtime

Video 15 phút ở 30 FPS có 27.000 frame. Export không nhất thiết phải mất 15 phút. Tốc độ phụ thuộc:

- Số layer và effects.
- Độ phân giải.
- Source codec và khả năng decode.
- GPU/CPU.
- Encoder và codec.
- Memory bandwidth.
- Audio processing.
- Có thể tận dụng stream copy hay không.

Không nên mặc định chia 15 phút thành 5 worker song song. Chia segment chỉ hiệu quả khi source decode, timestamp boundaries, transitions, audio continuity và encoder/muxing được quản lý đúng. Nhiều worker có thể làm chậm hệ thống do tranh chấp decoder/GPU/RAM.

### 8.5 Smart Export

Có thể tối ưu các trường hợp:

- Source không thay đổi và codec phù hợp: remux/copy khi điều kiện cho phép.
- Chỉ cắt: stream copy có thể dùng nếu điểm cắt tương thích keyframe; nếu không cần re-encode.
- Có overlay/effect: render các frame bị ảnh hưởng.
- Intro/outro thay đổi: có thể giữ nguyên đoạn giữa nếu codec, timestamps, audio và concat compatibility đáp ứng yêu cầu.

Smart Export là giai đoạn nâng cao; không nên hứa hẹn giữ nguyên bitstream cho mọi dự án.

---

## 9. Export pipeline: WebCodecs + muxer, không có FFmpeg

### 9.1 Pipeline đề xuất

```mermaid
flowchart TD
    TIMELINE["Timeline Evaluation"]
    DOM["DOM / SVG Renderer"]
    GPU["WebGL2 / WebGPU Compositor"]
    FRAME["Frame Scheduler / Frame Capture"]
    VIDEO["WebCodecs VideoEncoder"]
    AUDIO["Audio Engine / AudioEncoder"]
    MUX["Mediabunny / MP4-WebM Muxer"]
    OUTPUT["Final Video"]

    TIMELINE --> DOM
    TIMELINE --> GPU
    DOM --> GPU
    GPU --> FRAME
    FRAME --> VIDEO
    TIMELINE --> AUDIO
    VIDEO --> MUX
    AUDIO --> MUX
    MUX --> OUTPUT
```

### 9.2 Công nghệ

| Chức năng | Công nghệ đề xuất |
|---|---|
| HTML composition | Chromium |
| GPU compositing | WebGL2 / WebGPU |
| Frame capture | VideoFrame / canvas / browser-specific capture |
| Video encoding | WebCodecs VideoEncoder |
| Audio processing | Web Audio API / AudioWorklet |
| Audio encoding | WebCodecs AudioEncoder khi hỗ trợ |
| MP4/WebM muxing | Mediabunny hoặc muxer tương thích |
| Metadata/probe | Browser APIs và/hoặc native helper |
| Native fallback | Không có — một engine duy nhất, giới hạn khai bằng capability (ADR-028) |

### 9.3 Các giới hạn phải kiểm thử

- WebCodecs không có cùng codec/profile trên mọi thiết bị.
- Hardware acceleration là tùy chọn của browser/platform, không được đảm bảo.
- Một số browser/API không hỗ trợ đầy đủ audio/video codec mong muốn.
- Browser tab có thể bị throttling hoặc đóng.
- WebGPU có thể không khả dụng trong một số runtime/headless environment.
- MP4 muxing cần xử lý timestamps, codec configuration, keyframe và audio/video interleaving.
- Export dài cần quản lý memory, queue và file output streaming.

Không nên dùng MediaRecorder làm export offline chính nếu yêu cầu điều khiển frame/timestamp chính xác. MediaRecorder phù hợp hơn cho realtime capture.

---

## 10. Multi-platform: Electron, Web Local, VPS và Vercel

### 10.1 Runtime matrix

| Khả năng | Electron | Browser Local | VPS | Vercel |
|---|---|---|---|---|
| Shared UI | Có | Có | Có | Có |
| Project/Timeline Core | Có | Có | Có | Có |
| HTML Preview | Có | Có | Có | Có |
| WebGL/WebGPU | Theo runtime | Theo browser | Theo browser/headless runtime | Trên client browser |
| WebCodecs | Theo Chromium/runtime | Theo browser | Theo runtime | Trên client browser |
| Import file local | Native | File Picker/permission | Cần upload | Cần upload |
| Local filesystem | Có | Giới hạn browser | Server filesystem | Temporary filesystem giới hạn |
| Spawn native process | Có | Không trực tiếp | Có | Không phù hợp cho worker dài |
| yt-dlp | Có | Qua Local Agent | Có | Không nên làm downloader chính |
| Long-running render | Có | Tab có thể bị giới hạn | Có | Không nên dùng Functions làm worker chính |

Điểm quan trọng: Vercel host frontend/API, nhưng WebGL/WebCodecs khi chạy trên trang web vẫn chạy trên thiết bị của người dùng. Không có nghĩa Vercel server đang sử dụng GPU máy người dùng.

### 10.2 Monorepo gợi ý

```text
tmcut/
├── apps/
│   ├── desktop/                 # Electron shell
│   ├── web/                     # Nuxt web application
│   └── worker/                  # Node.js media worker
│
├── packages/
│   ├── core/                    # Project + timeline + timebase
│   ├── editor/                  # Shared Vue editor UI
│   ├── rendering/               # Rendering interfaces/core
│   ├── renderer-dom/            # DOM/SVG renderer
│   ├── renderer-webgl/          # WebGL2 backend
│   ├── renderer-webgpu/         # WebGPU backend
│   ├── media-core/              # Media abstraction/decode
│   ├── effects/                 # Effect definitions/plugins
│   ├── animation/               # Keyframes/easing
│   ├── export/                  # Frame scheduling/encoding
│   ├── muxing/                  # MP4/WebM muxing
│   ├── platform-contracts/      # Runtime interfaces
│   └── shared/                  # Types/utilities
│
├── adapters/
│   ├── browser/
│   ├── electron/
│   ├── node/
│   └── cloud/
│
├── services/
│   ├── agent/
│   ├── downloader/
│   ├── media-worker/
│   ├── job-api/
│   └── storage/
│
├── docs/
└── tests/
```

Không cần tách toàn bộ package ngay từ đầu. Trước tiên tạo boundaries và interfaces trong codebase hiện tại, sau đó tách package khi có nhu cầu build/test/deploy độc lập.

### 10.3 Platform Adapter

```ts
interface PlatformAdapter {
  files: FileAdapter
  process: ProcessAdapter
  storage: StorageAdapter
  media: MediaAdapter
  gpu: GpuAdapter
  network: NetworkAdapter
  downloader: DownloaderAdapter
}
```

Ví dụ:

- Electron: native filesystem, `child_process`, native binaries.
- Browser: File API, IndexedDB/OPFS khi phù hợp, WebCodecs, WebGPU.
- Node/VPS: filesystem, process, worker queue, object storage.
- Vercel: API/auth/job orchestration; không chạy media worker dài hạn.

Không để UI gọi thẳng `child_process`, `fs` hoặc API Electron. Mọi native operation phải đi qua adapter và IPC được kiểm soát.

---

## 11. yt-dlp và TMCut Downloader

### 11.1 Bản chất

yt-dlp là native command-line tool/Python package. Browser sandbox không cho phép JavaScript của website tự ý chạy `yt-dlp.exe` hoặc truy cập filesystem tùy ý.

Các môi trường:

| Môi trường | Cách chạy |
|---|---|
| Electron Desktop | Chạy native yt-dlp qua process adapter |
| Browser Web | Không chạy trực tiếp; cần Local Agent hoặc remote service |
| VPS | Chạy yt-dlp trong worker/service |
| Vercel | Không phù hợp làm downloader dài hạn; dùng remote worker |

Chỉ tải nội dung mà người dùng có quyền tải/sử dụng và tuân thủ điều khoản nền tảng cũng như pháp luật liên quan. Không thiết kế tính năng nhằm vượt DRM, paywall hoặc cơ chế kiểm soát truy cập.

### 11.2 Phương án 1: Native Downloader trong Electron

```mermaid
flowchart TD
    UI["TMCut Desktop"]
    ADAPTER["Downloader Adapter"]
    PROC["Native Process Manager"]
    YTDLP["yt-dlp executable"]
    FILE["Local Media Files"]

    UI --> ADAPTER --> PROC --> YTDLP --> FILE
```

Chức năng:

- Download job.
- Progress parsing.
- Cancel.
- Retry.
- Output template.
- Format selection.
- Error mapping.
- Download history.
- Version/update management.

Không truyền shell command string ghép từ input người dùng. Dùng process spawn với executable path cố định và arguments dạng array để tránh command injection.

### 11.3 Phương án 2: TMCut Local Agent

Đây là phương án quan trọng để Web App sử dụng native capability trên máy người dùng.

```mermaid
flowchart TD
    WEB["TMCut Web App"]
    LOCAL["127.0.0.1 Local Agent API"]
    AUTH["Session Token + Origin Validation"]
    JOB["Local Job Manager"]
    YTDLP["yt-dlp"]
    RESULT["Local Download / Status"]

    WEB --> LOCAL --> AUTH --> JOB --> YTDLP --> RESULT
```

Agent có thể cung cấp API:

```ts
interface LocalAgentClient {
  getCapabilities(): Promise<AgentCapabilities>

  createDownloadJob(
    request: DownloadRequest
  ): Promise<{ jobId: string }>

  getJob(jobId: string): Promise<DownloadJobStatus>

  cancelJob(jobId: string): Promise<void>
}
```

Yêu cầu bảo mật bắt buộc:

- Bind chỉ vào `127.0.0.1` hoặc loopback tương đương.
- Không mở API không xác thực.
- Kiểm tra Origin allowlist.
- Token phiên ngẫu nhiên, thời hạn ngắn.
- Chống CSRF và DNS rebinding.
- Validate URL, scheme và redirect.
- Chặn truy cập địa chỉ private/link-local/metadata IP không cần thiết.
- Không cho website bất kỳ gọi tùy ý process.
- Không nhận command line tùy ý từ client.
- Có consent rõ ràng trước khi tải.
- Log/audit các native jobs.

Cần kiểm tra kỹ mô hình bảo mật browser-to-localhost trên các browser/OS mục tiêu. Có thể cần onboarding, pairing code hoặc cơ chế xác thực riêng.

### 11.4 Phương án 3: Remote Downloader trên VPS

```mermaid
flowchart TD
    CLIENT["TMCut Web / Desktop"]
    API["Vercel API hoặc VPS API"]
    QUEUE["Job Queue"]
    WORKER["VPS yt-dlp Worker"]
    STORAGE["Object Storage"]
    URL["Short-lived Signed URL"]

    CLIENT --> API --> QUEUE --> WORKER --> STORAGE --> URL
```

Chức năng:

- Nhận download request.
- Xác thực user/quota.
- Đưa job vào queue.
- Worker thực thi yt-dlp.
- Lưu output vào object storage.
- Cấp signed URL có thời hạn.
- Theo dõi trạng thái và dọn file hết hạn.

Phải giới hạn concurrency, dung lượng, thời gian chạy, URL được phép, network egress và chi phí storage/bandwidth.

### 11.5 So sánh downloader

| Tiêu chí | Electron native | Local Agent | VPS Worker |
|---|---|---|---|
| Không cần upload source | Có | Có | Không |
| Dùng trên Web | Không | Có | Có |
| Tải về máy người dùng | Có | Có | Cần tải từ storage |
| Phụ thuộc server | Không | Không | Có |
| Multi-user cloud | Không | Không | Có |
| Cần cài native helper | Electron đã có | Có | Không |
| Phù hợp | Desktop | Web Local | Cloud |

---

## 12. Google Colab có nên làm Remote Worker?

### 12.1 Có thể về kỹ thuật

Về mặt kỹ thuật, một Google Colab notebook cài được yt-dlp và chạy encode trên Linux runtime, rồi lưu output vào Drive hoặc tải xuống — nhưng đó **không** phải đường TMCut chọn: media pipeline là WebCodecs + muxer chạy trong runtime của app (ADR-028, ADR-030), Colab chỉ là prototype (ADR-010).

Tuy nhiên, Colab Free không phải môi trường production worker:

- Runtime có thể bị ngắt.
- Session và endpoint không ổn định.
- Tài nguyên GPU/CPU không được đảm bảo liên tục.
- Không phù hợp làm service API thường trực.
- Chính sách Colab hạn chế một số kiểu sử dụng như web service/remote control hoặc worker liên tục.

Không nên xây kiến trúc sản phẩm phụ thuộc vào một notebook Colab đang mở.

### 12.2 Hướng thay thế

- VPS Linux: phù hợp worker lâu dài.
- Google Compute Engine: khi muốn dùng hạ tầng Google Cloud.
- Cloud Run/Jobs: phù hợp job theo lô nếu thiết kế đúng giới hạn runtime/storage.
- Object Storage: lưu input/output.
- Redis/BullMQ hoặc queue managed: điều phối job.

Colab chỉ nên dùng để thử nghiệm, benchmark, prototype hoặc tác vụ cá nhân phù hợp chính sách.

---

## 13. Vercel và VPS: phân chia trách nhiệm

### Vercel phù hợp

- Nuxt frontend.
- Authentication.
- User/project APIs.
- Project metadata.
- Job creation/status APIs.
- Signed URL issuance.
- Webhook và orchestration nhẹ.

### VPS/Worker phù hợp

- yt-dlp.
- Không FFmpeg trên worker: worker chạy đúng stack WebCodecs + muxer của browser (ADR-028), khác biệt chỉ là headless runtime.
- Long-running render.
- Batch processing.
- Thumbnail/waveform generation.
- Media probing.
- Queue consumers.
- GPU/CPU workloads có kiểm soát.

### Storage

Không lưu file media lớn lâu dài trong filesystem tạm của Vercel Functions. Dùng object storage S3-compatible hoặc dịch vụ storage phù hợp.

### Job lifecycle

```ts
type JobStatus =
  | 'queued'
  | 'preparing'
  | 'processing'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled'
```

Mỗi job nên có:

- `jobId`
- `userId`
- `projectId` nếu có
- `jobType`
- `status`
- `progress`
- `stage`
- `inputAssets`
- `outputAssets`
- `createdAt`, `updatedAt`
- `errorCode`, `errorMessage`
- `retryCount`
- `workerId`

Không để API request chờ cho tới khi render/download hoàn tất. API tạo job và trả `jobId`; client subscribe/poll trạng thái.

---

## 14. Smart Export và backend selection

TMCut có thể lựa chọn backend dựa trên capability:

```ts
interface RuntimeCapabilities {
  webgl2: boolean
  webgpu: boolean
  webCodecsVideo: boolean
  webCodecsAudio: boolean
  supportedVideoCodecs: string[]
  supportedAudioCodecs: string[]
  hardwareAcceleration: 'available' | 'unavailable' | 'unknown'
  nativeAgent: boolean
  nativeFfmpeg: boolean
}
```

Ví dụ lựa chọn:

1. Browser có WebGPU + WebCodecs phù hợp → GPU renderer + WebCodecs.
2. Browser chỉ có WebGL2 + WebCodecs → WebGL2 renderer + WebCodecs.
3. Browser thiếu codec cần thiết → thông báo rõ và đề xuất backend khác.
4. Desktop dùng cùng engine với browser; phần riêng của nó là quyền đọc file hệ thống và cache đĩa, không phải một media engine (ADR-032).
5. Cloud job → gửi VPS worker.
6. Không có backend dự phòng: thiếu codec là báo thiếu và dừng ở đó, không âm thầm đổi engine (ADR-028, ADR-030).

Không tự động chuyển file riêng tư lên cloud mà không có sự đồng ý của người dùng.

---

## 15. Roadmap triển khai TMCut V4

Nên triển khai theo giai đoạn, giữ sản phẩm hiện tại hoạt động và tránh rewrite toàn bộ cùng lúc.

### Phase 0 – Audit và đóng băng contract

> **Trạng thái: PASS (2026-11-01).** Deliverable đầy đủ tại [v4-phase-0-audit.md](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md): bản đồ kiến trúc, kiểm kê 20 tính năng theo runtime, đặc tả Project schema (app model vs DSL v3 + chuỗi migration v1→v3), 10 khoảng trống và 5 ADR cần chốt trước Phase 1.

- Audit repo hiện tại.
- Xác định Project JSON hiện tại.
- Xác định Timeline/Timebase hiện tại.
- Liệt kê feature đang dùng FFmpeg.
- Phân loại feature: editor, renderer, export, downloader, native tools.
- Viết architecture decision records (ADR).
- Xác định backward compatibility và migration strategy.

**Deliverables:**

- Current architecture map.
- Feature inventory.
- Project schema specification.
- V4 migration plan.

### Phase 1 – Shared Core và Platform Contracts

> **Trạng thái: IN PROGRESS.**

**Nhật ký tiến độ (mỗi bước một dòng):**

- M1 đã xong (2026-11-01): `evaluateTimeline(timeline, tick)` ([evaluate.mjs](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs)), clock tick↔frame ([clock.mjs](file:///D:/Applications/tm-studio/packages/core/src/clock.mjs)), capability negotiation ([platform.mjs](file:///D:/Applications/tm-studio/packages/core/src/platform.mjs)) và contract type-only `TmcutPlatformAdapter` ([types/platform.ts](file:///D:/Applications/tm-studio/packages/core/types/platform.ts)); 34 test thuần Node.
- M2 đang mở (2026-11-01): preview đã đọc `evaluateClip` cho transform/opacity, `textAnimationAt` cho animation chữ in/out, và `evaluateTimeline` để chọn clip đang phát + cặp crossfade (`useTmcutPlayback`); evaluator ánh xạ speed ramp bằng tích phân và nhận cả shape phẳng của app store (`clipSpan`); core 449 test.
  - Golden-frame test đầu tiên đã chạy (`tmcut_golden_frame.spec.ts`, canvas + FFmpeg thật + `compareFrames`); M2 bước 4 thêm `tmcut_render_parity.spec.ts` render clip thật rồi kiểm pixel theo geometry/source mà `evaluateTimeline` trả (scale/x/y/opacity và speed→source), đưa unit suite lên 73 spec.
- M1c (2026-11-01) cho Electron cài đặt phần capture của contract: `openCaptureSession` (`html-video-renderer.cjs`) là `TmcutCaptureSession` thật và chính loop render `tmcut:renderHtmlVideo` dùng nó; `createElectronPlatformCapture` báo cùng biên fps mà validator từ chối. `/tmcut/editor` đã được QA trực quan qua CDP (0 console error).
- Adapter giờ có consumer thật (2026-11-01, khép nửa đầu G3): `useTmcutPlatform()` ([useTmcutPlatform.ts:227](file:///D:/Applications/tm-studio/app/composables/useTmcutPlatform.ts#L227)) dựng một adapter cho cả hai host — `info` qua `createPlatformInfo`, `media.resolveSrc` ủy quyền cho `useTmcutMedia`, `encoder` chọn queue desktop hay endpoint render Nitro — và preview engine ([useTmcutPreviewEngine.ts:49](file:///D:/Applications/tm-studio/app/composables/useTmcutPreviewEngine.ts#L49)) cùng modal export ([TmcutExportModal.vue:224](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutExportModal.vue#L224)) đọc capability thay vì sniff `window.electronAPI`.
  - Contract đã bổ sung phần còn thiếu để nói được "job xong, file nằm ở đâu": `TmcutRenderJob.output`/`error` và `getJob` ([runtime.ts:38](file:///D:/Applications/tm-studio/packages/core/types/runtime.ts#L38)); `capture.open` vẫn từ chối kèm tên process thật sự sở hữu session.
  - Nửa sau G3 (2026-11-01, khép gap): renderer chỉ còn **một** chỗ chạm bridge — `tmcutHostBridge()`/`tmcutHostIpc()` ([hostBridge.ts:24](file:///D:/Applications/tm-studio/app/utils/tmcut/hostBridge.ts#L24)) — 30 file import nó, 5 helper `tmcutIpc()` cục bộ bị xoá, `useToolTaskManager` và `useTmcutPlatform` không còn crash/tham số hoá ngoài browser; 4 gate UI (`TmcutExportModal`, `TmcutMarketplace`, `TmcutVoiceStudioBody`, `VideoPreviewModal`) đọc `platform.info` thay vì tự sniff, và [tmcut_host_bridge.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_host_bridge.spec.ts) biến quy tắc đó thành gate 8 check chứ không phải convention.
- Còn lại của Phase 1: một capture engine cho hai runtime (M4 — hết lệch **giới hạn** G6: fps/frame rồi canvas lẻ; **bước 2a đã đo xong 2026-11-01: chỉ một engine thật sự chạy trên cả hai host; bước 2b-i đã code 2026-11-02: transport desktop từ chối composition script-driven thay vì render ảnh tĩnh im lặng — xem ADR-021**), và golden chữ khi có font ghim.
- ADR-019 đã chốt và code xong (2026-11-01, **M4 bước 1**): `HTML_VIDEO_LIMITS` trong core là hợp đồng duy nhất cho một composition HTML-video — `html-video-renderer.cjs` `require` object đó từ `packages/core/src/htmlVideo.mjs` (leaf module, đã thêm vào `files` của [electron-builder.yml](file:///D:/Applications/tm-studio/electron-builder.yml)) thay vì giữ bản sao `MIN_FPS = 15`/`MAX_FRAMES = 1800`/fps-số-nguyên, và dùng luôn `frameCountFor` của core để đếm frame.
  - Lệch từng đo được (10 fps và 29,97 fps hợp lệ trên web, bị từ chối trên desktop) không còn; `useTmcutPlatform().capture.supportsFps` trả một cửa sổ cho cả hai host.
  - Follow-up cùng ngày khép nốt lệch thứ hai: `validateHtmlVideoSpec` nay từ chối width/height **lẻ**, vì phép đo với `resources/ffmpeg.exe` cho thấy `s=1001x100` + `libx264` + `yuv420p` hỏng trên **cả hai** host (`width not divisible by 2`, file ra 0 byte; `s=1000x100` chạy cùng lệnh → file 1750 byte) — desktop chỉ là bên báo sớm, còn web thì accepted rồi chết giữa encode; rule đó thuộc về hợp đồng render, không phải về một host.
  - Gate sau follow-up: core **450/450**, unit **76/76**, electron tools **71/71**.
- ADR-020 đã chốt và code xong (2026-11-01, khép mảnh cuối của adapter): `probe(src)` là method **bắt buộc** của `TmcutPlatformMedia` — một câu hỏi read-only cả hai host đều trả lời được.
  - Desktop đi qua handler `tmcut:probeMedia` mới ([tmcut.controller.cjs:1402](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L1402)) trả raw ffprobe JSON rồi normalize bằng `normalizeProbe` của core; web đi qua `probeWebMetadata` ([webProbe.ts:21](file:///D:/Applications/tm-studio/app/utils/tmcut/webProbe.ts#L21)) báo đúng những gì media element thấy (duration/size thật, `fps` luôn 0, audio suy ra khi không có video track) và trả `null` thay vì số 0 khi không đọc được file. `analyzeAsset` vẫn sở hữu metadata đã persist + thumbnail/filmstrip/waveform.
  - Hai handler thêm file vào timeline bỏ hẳn đoán duration bằng element — trước đây container Chromium không decode được khiến mọi clip nhận 10 s/15 s phẳng.
  - Gate slice: unit **76/76** (adapter 12 check, ipc-policy 10 check), core **450/450**, electron tools **71/71**, typecheck 0 `error TS`; **chưa QA trên Electron runtime**.
- ADR-018 đã chốt và code xong (2026-11-01): mọi consumer của timeline dùng chung một quy tắc nửa mở `[start, end)` — export chữ `enable='gte(t,start)*lt(t,end)'` ([text.ts:128](file:///D:/Applications/tm-studio/app/utils/tmcut/render/text.ts#L128)), `activeTextClips` đọc layer từ `evaluateTimeline` thay vì tự tính cửa sổ, và playhead ở đúng cuối **nội dung** lùi về đầu frame cuối qua `renderAt` (`snapToFrame: false`) ([renderAt.mjs:51](file:///D:/Applications/tm-studio/packages/core/src/renderAt.mjs#L51)).
  - Trước đó preview và export **khớp nhau nhưng cùng sai một frame**: cả hai vẽ đè chữ của clip kết thúc lên frame đầu cửa sổ kế (đã đo bằng pixel); render-parity spec case 3 giờ khoá hành vi đúng.
- ADR-021 đã chốt **phần đo** (2026-11-01, **M4 bước 2a**, không đổi hành vi người dùng): phép đo bằng Chrome thật trên một starter có thật (`stat-counter`, 540×960 @10 fps, 1 s = 10 frame) cho thấy **chỉ một engine HTML-video thật sự chạy, và nó chạy trên cả hai host** — [TmcutHtmlVideoStudio.vue:217](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue#L217) POST `/api/v1/media/html-video` mà không có nhánh host nào, nên Nitro + playwright-core + Chrome/Edge hệ thống render cả web lẫn Electron; kênh `tmcut:renderHtmlVideo` vẫn được đăng ký ([main.cjs:585](file:///D:/Applications/tm-studio/electron/main.cjs#L585)) và có trong preload allow-list nhưng `grep` toàn bộ `app/` không có một dòng gọi nào.
  - Engine sống trả **10 hash frame khác nhau** và **giống hệt giữa hai browser context mới** (deterministic); transport WebContents của desktop trả **một hash lặp lại 10 lần** (`7aed8e5bf3bf`) vì `sanitizeCompositionHtml` xoá mọi `<script>`, mà mọi starter của app đều khai báo motion qua `window.__hf` — nghĩa là nó render ảnh tĩnh dựng thành video và **không báo lỗi**, nên tuyệt đối không được wire vào job.
  - Slice này khoá sự thật đó bằng 2 test characterisation (`html-video-renderer.test.mjs:352`) + doc comment trên `sanitizeCompositionHtml` và `registerHtmlVideoRenderer`, và ghi gap mới **G12** + ADR-021 vào audit.
  - Hệ quả đóng gói nêu thẳng: không tìm thấy Chrome thì endpoint trả 503 chứ không fallback, nên câu hỏi còn lại của M4 bước 2b là **protect desktop khỏi dependency đó** — hoặc cho composition giữ script đã nonce-hoá (quyết định bảo mật, cần QA Electron), hoặc retire transport WebContents.
  - Gate slice: electron tools **73/73** (71 + 2 test mới), unit **76/76**, core **450/450**, boundaries PASS, typecheck exit 0 với 0 `error TS`, eslint 2 file chạm exit 0 (hash `.nuxt/eslint.config.mjs` `2ae10dff` không đổi trước/sau); **chưa QA trên Electron runtime** vì shell này không spawn được Electron; phép đo desktop dùng document + `__tmcutSeek` **thật** của host render trong Chrome thật, chỉ bước `capturePage` thay bằng screenshot Playwright.
- **Follow-up 2026-11-02 (bước 2b-i):** quyết định "không được wire transport WebContents" không còn chỉ nằm ở comment — core xuất [htmlVideoSeekContract](file:///D:/Applications/tm-studio/packages/core/src/htmlVideo.mjs) và cho chính rule lint `missing-seek-contract` gọi nó (một định nghĩa duy nhất cho "composition này seek bằng script hay không", nên editor không thể bảo hợp lệ rồi host bảo không làm được), còn `validateRenderOptions` của desktop **từ chối** composition script-driven bằng token `composition-requires-script-seek` trước khi mở BrowserWindow hay spawn FFmpeg; composition thuần CSS/SVG/`<video>` vẫn nhận job như cũ.
  - Gate slice 2b-i: electron tools **75/75** (73 + 2), core **451/451**, unit **76/76**, boundaries PASS, typecheck exit 0 với 0 `error TS`, eslint **6 file chạm** exit 0 (hash `.nuxt/eslint.config.mjs` `2ae10dff` không đổi trước/sau), `tsc -p packages/core/tsconfig.check.json` exit 0; vẫn **chưa QA trên Electron runtime** (kênh này không có app caller, nên đường đổi hành vi chỉ đi tới người dùng khi bước 2b-ii wire nó).
- **2b-ii vẫn mở**: cho composition giữ script đã nonce-hoá (quyết định bảo mật + cần Electron QA) hoặc retire transport và khai báo `capture` là capability của host có Playwright.
- **Cùng ngày, hygiene (G10):** hai spec unit hoá ra đang import core bằng `'../../../tmcut-core/src/index.mjs'` — đường đó **thoát repo** và trỏ vào bản core standalone cũ nằm cạnh project, nên chúng kiểm một hợp đồng đã bị thay (bản cũ nhận canvas `1001×1000`, không có `htmlVideoSeekContract`); đã trỏ lại vào `packages/core/src/index.mjs` (11 + 11 check vẫn pass, **không** phải sửa assertion) và thêm [tmcut_core_source.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_core_source.spec.ts) quét mọi specifier tương đối trong repo để loại lệch này không quay lại — guard đã được red-test bằng cách đặt lại đường cũ vào một spec: fail đúng 2 subtest.
  - **Cùng ngày, ADR-017 code xong:** alias `@tmcut-core` → `tmcut-core` (102 lần trong 79 file + 3 chỗ config), tên alias giờ **đúng bằng** tên package nên một specifier cho biết chính xác file nào được nạp; guard khoá ba bất biến (alias == tên package, không import nào dùng tên cũ, và alias chỉ được import trần vì Vite khớp alias theo tiền tố).
  - Đổi tên cũng lộ ra **G13**: `@tmcut/core` là tên thứ ba, trỏ vào `packages/core/dist` qua dependency `file:` — hai chỗ trong `electron/tools/video-generation/controller.mjs`, và `dist` đã build 2 ngày trước nên **không chứa** `htmlVideoSeekContract` mà `src` có; Electron main vì thế đọc hai bản core khác nhau trong cùng một process.
  - Guard khi đó mới chỉ **khoá nguyên trạng** (specifier scoped chỉ được phép xuất hiện dưới `electron/`), vì đóng một artifact cần một quyết định và QA bản đóng gói.
  - **Cùng ngày, ADR-022 code xong — đóng G13: `packages/core/src` là artifact duy nhất mọi host đọc.** `controller.mjs` import thẳng `../../../packages/core/src/generationAdapter.mjs` + `providerAdapter.mjs`; **9/9 tên** đo bằng Node thuần từ đúng thư mục của file (bắt buộc, vì `electron/tools/*.test.mjs` không load controller này); `file:packages/core` bị xoá khỏi `package.json` (lock −3 dòng, `@tmcut/core` trong lockfile = 0) và symlink `node_modules/@tmcut/core` đã gỡ, nên `require.resolve` tên scoped trả `MODULE_NOT_FOUND`; `electron-builder.yml` đóng gói **cả cây** `packages/core/src/**/*` — 51 file / 588 KB, **nhỏ hơn** `dist` (25 file / 1832 KB) — thay vì một leaf chọn tay cộng toàn bộ `dist`, và bao đóng thật mà main cần đo được **3 file**. `dist` còn đúng một vai trò: artifact của `npm publish`. Guard thay 1 test khoá-nguyên-trạng bằng 4 test (tổng 10 test, đỏ-test từng cái bằng 5 kịch bản: đặt lại import vào `dist`, đặt lại import scoped, khai lại `file:`, bỏ `src/**` khỏi `files:`, và thêm một import đặt tên core trong `electron/` — mỗi kịch bản làm fail đúng một subtest).
  - Gate slice ADR-022: typecheck exit 0 với 0 `error TS`, hash `.nuxt/eslint.config.mjs` `2ae10dff` không đổi trước/sau, unit **77/77**, core **451/451**, boundaries PASS, electron tools **75/75**, `tsc -p packages/core/tsconfig.check.json` exit 0; eslint spec mới exit 0, còn `controller.mjs` giữ **14 problem đã đo lại trên đúng nội dung HEAD** (giống hệt về số và rule — nợ cũ, không `--fix` repo-wide).
- **Chưa chứng minh được:** hành vi bản đóng gói thật (shell này không chạy `electron-builder` ra app), và phần prose từng để lại ("75 file") đã quét xong cùng ngày: **99 lần** tên đã nghỉ trong **94 file** tracked (`packages/core` 75 file banner+README, 19 file ở `app/ server/ shared/ electron/ tests/`) đổi sang `tmcut-core`, kèm 3 dòng `@tmcut/types` — một tên thứ tư chưa từng tồn tại trong `exports` — và `scripts/prepare-dist.mjs`, nơi sinh banner cho `dist`, đổi theo để bản build kế tiếp không mang tên cũ về lại; `git grep` giờ còn tên cũ ở **5 file**, toàn bộ là hồ sơ (4 file `docs/` + chính file guard), và [tmcut_core_source.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_core_source.spec.ts) thêm test thứ 11 cấm cả ba tên trong mã nguồn/README ngoài `docs/` (đỏ-test 5 kịch bản, mỗi kịch bản fail đúng một subtest).
  - Gate slice prose: typecheck exit 0 / 0 `error TS`, hash `2ae10dff` không đổi, unit **77/77**, core **451/451**, boundaries PASS, electron tools **75/75**, `tsc -p packages/core/tsconfig.check.json` + `tsc --noEmit` trong core đều exit 0; eslint 95 file chạm đo **trên cả HEAD lẫn tree đã quét**: cùng **86 problem ở 12 file**, cùng tập rule, và **0** problem nằm trên dòng mà slice này đổi (nợ cũ, không `--fix` repo-wide).
- Slice 2026-11-02 (M4 bước 2b-ii, **ADR-023**): **retire** transport HTML-video của desktop — xoá engine WebContents (288 dòng) cùng test của nó (422 dòng), chỗ `require`/`register` trong `main.cjs`, 3 mục ở preload và 1 mục ở ipcPolicy, 2 khai báo type; repo còn **một** engine HTML-video (playwright-core + Chrome/Edge hệ thống trong server Nitro), và cả hai host tới nó bằng cùng một endpoint vì app desktop do chính server đó phục vụ. `capture.open()` vì thế trả **một message cho cả hai host** thay vì hai message lệch nhau, và guard mới đi hết cây `electron/` tìm dấu vết engine (`__tmcutSeek` / `image2pipe` / `capturePage`) — **0 hit**.
  - Cùng slice khép hai gap lộ ra khi đo: **G14** — hai kênh output-watch đặt tên theo một quy ước kebab-case thứ hai nên không lời gọi nào tới được handler đã cài sẵn, `.catch(() => {})` che mất; đổi sang camelCase khớp quy ước `${moduleName}:name` và guard khoá **cả hai chiều** ghép kênh.
  - **G15** — engine không tạo thư mục output (git-ignored) nên render đầu tiên trên checkout mới chết `ENOENT`; thêm `mkdir` recursive, đỏ/xanh đo bằng `TOOLS_UPLOADS_DIR` trỏ vào một đường chưa tồn tại.
  - Gate: typecheck exit 0 / 0 `error TS`, eslint exit 0 trên các file chạm, unit **77/77**, core **451/451**, boundaries PASS, electron tools **59/59** (4 file — trước ADR-023 là 75/5 file), `tsc` của core exit 0; smoke HTML-video thật **6 check** pass và md5 `0c85cf99ba9618929f33a0fe5d474500` lặp lại đúng 3 lần trên 3 render.
- **Đã có bằng chứng Electron runtime (2026-11-02, app `dev:electron` + CDP :9222):** app khởi động bình thường với engine đã bị xoá (`getPaths()` trả 8 khoá), cầu preload đúng như ADR-023 khai (`renderHtmlVideo` / `onHtmlVideoProgress` = `undefined`), `watchOutput` / `unwatchOutput` resolve `true` (G14 đã sửa, đo được chứ không chỉ là guard), và HTML-video **render thật từ trong cửa sổ app desktop** — `POST /api/v1/media/html-video` trả 120 frame, job `done`, file ra `200 video/mp4` 123 980 byte (G15 chạy trên host desktop); quét 22 route trong shell desktop cho **0** dòng `error` (đo sau khi `.spa-loading-overlay` detach hẳn — sleep cố định chỉ chụp được shell pre-hydrate).
  - **Chưa chứng minh được:** bản **đóng gói** (asar + `startServer()` thật) và một lần `renderDone` thật từ export modal — watcher mới chứng minh kênh resolve, chưa chứng minh bắt được file.
- M2 bước 7 (2026-11-02), gate pixel cho **chữ**: [tmcut_text_pixel.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_text_pixel.spec.ts) render FFmpeg thật rồi đọc từng frame rawvideo — 8 check (font ghim có mực, caption bắt đầu sau t=0, mực chỉ trong cửa half-open, caption vượt footage, fontsize lớn hơn cao hơn, align trái/giữa/phải, biên dịch deterministic, và WOFF2 bị drawtext từ chối).
  - Gate này bắt được **hai** lệch preview↔export thật, cả hai đã sửa trong [render/index.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts): (1) `totalDuration` bỏ qua track chữ, nên timeline chỉ-có-caption bị cắt ngắn — cửa sổ drawtext mở ra sau khi nguồn nền `color=` đã kết thúc, export trả nền trống đúng chỗ preview đang hiện chữ; (2) caption dài hơn frame cuối của footage thì không còn frame nào để vẽ — nay `tpad=stop_mode=add:color=<canvas>` nối đuôi bus **sau** LUT (màu canvas do tác giả chọn không được bị grade) và **trước** drawtext, chỉ bật khi thật sự có overflow nên không export nào khác đổi độ dài.
  - Đo bằng file thật: 1 s footage + 2 s caption trước sửa cho 30 frame, sau sửa cho 60 frame, frame 45 mang 298 px mực trên nền `#101018`.
  - Phát hiện về font: `resources/ffmpeg.exe` là bản N-126482 cấu hình fontconfig/harfbuzz/freetype nhưng **không** có woff2; `drawtext fontfile=` mở được TTF và từ chối WOFF2 (`could not parse fontconfig pattern`), còn app chỉ đóng gói WOFF2 (`@fontsource-variable/inter`) → **font trong preview không bao giờ là font trong export**; một golden pixel ghim đúng font cần một TTF/OTF nằm trong repo, và vendoring một face là quyết định của owner (ADR-025 còn mở, ghi ở [v4-phase-0-audit.md](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md) §7).
- Docs hygiene (2026-11-02), trích dẫn `§N` tới tài liệu **ngoài** repo: guard link chỉ đi theo `file:///…` trong `docs/`, còn `§N` nằm trong comment mã nguồn thì không cơ chế nào nhìn thấy — [tmcut_doc_citations.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_doc_citations.spec.ts) nay khai báo 7 họ nhãn, mỗi họ trỏ đúng một tài liệu, và bắt mọi số mục là heading có thật của tài liệu mà nhãn gọi tên.
  - Đo: 172 trích dẫn trên 543 file; 32 chỗ được gắn tên tài liệu theo ba tiêu chí máy kiểm được (số mục chỉ tồn tại ở một tài liệu đã đăng ký / comment trích nguyên văn mục đó / prose đã tự tên tài liệu), 2 chỗ `TmcutAssetCenter.vue §14` **để trần có chủ đích** vì v3 và v1 đều có mục 14 — đóng băng thành `BARE_CEILING = 2`, chỉ đi xuống.
  - Hai file `…-roadmap-v1.md` trùng cách đánh số là lý do nhãn phải tên tài liệu, không tên version.
  - Guard kiểm **số mục có thật**, chưa kiểm **nội dung trích dẫn nói đúng mục đó** (ADR-026, [v4-phase-0-audit.md](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md) §7).
- Docs hygiene (2026-11-02), **độ dài dòng**: các bước Phase 1 được append vào **cùng một dòng** blockquote cho tới khi dòng đó mang 19037 ký tự — diff của nó chỉ là `-1/+1` bất kể prose thêm bao nhiêu, nên reviewer không thấy slice claims gì; và "câu về ADR-022" nằm ở đâu trong blob 19k thì không chỉ được. Nay log là 48 bullet (dài nhất 1101), và [tmcut_doc_line_length.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_doc_line_length.spec.ts) đóng băng trần 1356 ký tự cho dòng prose: đo ngày 2026-11-02 được 10 file md, 2070 dòng prose ngoài bảng/fence, 451 dòng bảng với 21 dòng dài hơn trần. Bảng được miễn vì GFM không cắt được cell, và test 3 bắt chính sự miễn trừ đó phải còn có tác dụng.
- **M3 (2026-11-02), một nguồn nghĩa cho mask + crop + transition**: mỗi layer của `evaluateTimeline` nay mang **geometry đã sanitize** (`mask` = `normalizeMask(clip.mask)`) và **layout** (`layout` = `resolveClipLayout(clip)`, tức `fit`/`focusX`/`focusY`/`cropRect`) — đúng hai hàm mà `maskAlphaExpr`, `maskCssMaskImage` và các fit builder vẫn gọi nội bộ, nên một host chỉ đọc layer (M5 WebCodecs, M8 WASM) xếp được frame mà không cần biết model của app.
  - Vì sao công khai kết quả này **không thể** làm lệch ảnh đang render: `normalizeMask` idempotent và nằm ở cả hai builder nên `maskAlphaExpr(layer.mask) === maskAlphaExpr(stored)` (test), và `resolveClipLayout` đi qua `clamp01` — cùng hàm mà 'smart' fit vẫn áp; `cropRect` truyền nguyên trạng vì mỗi builder tự clamp, thêm một rule thứ ba chỉ có thể **lệch** với chúng. Một shape lạ thành `null` thay vì dữ liệu truthy — hết cảnh "có mask trên giấy, không mask trên màn hình". `evaluateClip` **không** đổi shape vì [evaluate.test.mjs:434](file:///D:/Applications/tm-studio/packages/core/test/evaluate.test.mjs#L434) đã `deepEqual` pin nó, nên field mới nằm ở layer.
  - Export ngừng chọn field từ `raw`: `toRenderClip` tự gọi `resolveClipLayout(item)` + `normalizeMask(item.mask)` ([clip.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts)) và [video.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts) hết `raw.mask` / `raw.cropRect`; preview bỏ bộ default thứ tư — `fitStyle()` trong [TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue) gọi resolver của core thay vì `clip.fit || 'fit'` / `focusX ?? 0.5` (nên `focusX = NaN` không còn sinh `objectPosition: NaN%`).
  - Parity từ **giả định** thành **assertion**: [tmcut_shared_model.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_shared_model.spec.ts) 12 check — 8 assert graph FFmpeg (`xfade=duration/offset` bằng `transition.duration` / `startTicks` của layer, `geq` alpha bằng expression của model **byte-for-byte**, `crop=w='iw*…'` bằng `layout.cropRect`) + 4 guard nguồn; [tmcut_render_parity.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_parity.spec.ts) lên **14** check pixel thật, lần đầu có **mask** (3 probe trong vùng + 3 probe ngoài vùng so với **màu canvas**, oracle `maskCoverage()` viết theo đúng quy ước mẫu của `geq`, thêm một render `invert`) và **transition ramp** (5 frame giữa cửa sổ overlap đo `64 + 191 × progress` ±8 trên nguồn xám/trắng — pha trộn affine nên so được bằng số học của model, cộng membership cửa sổ tại `1.6T-1` / `1.6T` / `2T`).
  - Red-test: **4** mutation (core trả `clip.mask` thô / evaluator tự tính layout / SFC bỏ `resolveClipLayout` / export quay lại `raw.mask`), mỗi cái fail **đúng** subtest đã nêu tên, file restore byte-identical có md5. Bài học harness: `spawnSync('npx', …)` không spawn được `.cmd` nên **mọi** mutation ban đầu báo `exit=null` — đổi sang `process.execPath` + `node_modules/tsx/dist/cli.mjs` (và `node --test` cho core) như `run-all.mts`, thêm một lượt BASELINE để một lần đỏ chỉ được tính khi cùng lệnh đó xanh khi chưa mutation.
  - Gate: core **460/460** (62 suite / 39 file), boundaries PASS, `tsc -p packages/core/tsconfig.check.json` exit 0, typecheck exit 0 với 0 `error TS` (`.nuxt/eslint.config.mjs` md5 `63b66999`, eslint chạy **sau** typecheck), eslint **9 file chạm** exit 0, unit **82/82** spec. (Leg 2 cùng ngày nâng core lên **461** và shared-model lên **16** check — số liệu cuối ở các gạch đầu dòng dưới.)
  - **Chưa chứng minh được**, nói thẳng: gate live của chính slice này **BLOCKED** — đo lúc chốt slice, `tasklist` không có `electron.exe` và `netstat` không có listener nào ở :4002/:4003 (CDP cũng không nối), nên thay đổi `fitStyle` trong preview chưa có screenshot. Và **G16** ghi vào audit chứ không sửa: [TmcutPreviewPlayer.vue:694](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L694) `incomingRamp()` chỉ có hình học riêng cho 4/45 kiểu, `fade`/`dissolve` dùng crossfade là đúng, còn **39** kiểu vẫn preview như mờ dần trong khi export emit `xfade=<tên>` thật — cùng thời lượng, cùng biên, khác hình học. Không đổi trong slice này vì thêm 39 nhánh CSS mà không có app để QA là thay đổi render mù.
  - **Leg 2 (cùng ngày): cửa sổ overlap cũng về một nguồn.** Đo được một lệch thật giữa preview và file: một cặp cắt **lệch 20 ms** thì `transitionWindows`/`evaluateTimeline` báo **không có** transition (preview chạy thẳng), còn export vẫn emit `xfade=transition=fade:duration=0.400:offset=1.600` + `acrossfade` — vì [video.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts) tự kiểm adjacency bằng **giây** với dung sai `0.05`, tức lỏng hơn quy tắc của core **50 lần**. Nay [index.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts) gọi `transitionWindows(videoTrack)` và đưa vào `VideoPipelineContext` như field **bắt buộc**; video.ts chỉ còn hỏi "cắt này có window `fromId→toId` không", nên một quy tắc (1 ms, `ADJACENCY_EPS`) quyết định cho cả hai.
  - Bằng chứng không đổi output: [tmcut_render_graph.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_graph.spec.ts) **21/21 vẫn xanh không sửa một assertion nào** — file đó so chuỗi literally `xfade=transition=dissolve:duration=0.500:offset=3.500` và 5 biến thể tên, nên cặp hợp lệ compile **y hệt từng byte**; spec shared-model thêm **4** check (cặp 20 ms → `[]` window **và** graph hết `xfade`/`acrossfade`; cặp nguyên → đúng 1 window dài đúng `overlap`; guard cấm `0.05` và bắt `index.ts` gọi `transitionWindows(`) → tổng **16**.
  - **Cổng mới phát hiện khi red-test:** nới `ADJACENCY_EPS` ra 50 ms mà [transitions.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/transitions.test.mjs) vẫn **10/10 xanh** — không test core nào chạm biên (chúng chỉ dùng lệch 0 và 1 s). Thêm test thứ **11**: drift `0 / ±12 / ±120` ticks (grid 1e-4 s = 12, dung sai 1 ms = 120) phải **có** window, `±121` và `6000` phải **không**, và `canApplyTransition` `ok` tại `EPS` / `reason: 'gap'` tại `EPS+1`. Sau khi thêm, **cả hai chiều** mutate đều đỏ (`pass 10 / fail 1`); core **461/461**.
  - `transitionWindows` phải **nới khai báo** (`track: TmcutTrack | { items?: readonly unknown[] } | null | undefined`) vì `TmcutTrack` của app không phải DSL `TmcutTrack` của core (TS2345 ở [index.ts:162](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts#L162)); nới ở `index.d.ts` chứ không cast `as never` tại chỗ gọi, vì runtime thật sự nhận cả hai shape nhờ `clipSpan`.
  - Gate leg 2: core **461/461**, boundaries PASS, core `tsc` exit 0, typecheck exit 0 / **0** `error TS`, eslint **5 file chạm** exit 0 (sau typecheck), unit **82/82**, electron **59/59**, shared-model **16/16**, parity **14/14**, render-graph **21/21**, 3 guard docs (line-length / link-integrity / citations) exit 0 sau khi sửa tài liệu.
  - **Gate live chạy được lần đầu** (`electron.exe` nghe `:9222`, `:4003` trả `200`): quét 8 route `/tmcut*` qua CDP = **0 exception, 0 console error**, chỉ còn cảnh báo CSP dev-only của Electron — và **một phát hiện ngoài phạm vi render** ghi thành **G17**: `POST /api/v1/auth/refresh` trả `401 (error.refreshTokenInvalid)` ngay sau `/tmcut/autocut`, và lần quét thứ hai thì mọi route đã bị đẩy về `/login` (mất phiên). Thủ phạm khớp hình dạng mã: `let refreshPromise` nằm **trong** `useAuth()` nên mỗi instance có khoá riêng, trái với hai biến module-level kế nó — nhưng **chưa repro được** hai request chồng nhau, nên đó là hypothesis, không phải kết luận.
  - **Slice đóng cơ chế G17 (ngay sau gate live):** promote `refreshPromise` từ trong `useAuth()` lên module scope ([useAuth.ts:57](file:///D:/Applications/tm-studio/app/composables/useAuth.ts#L57)) — `grep -rln "useAuth()" app/` = **25** file, nên bản cũ là 25 khoá song song chứ không phải một. Red-test trước khi sửa: `2 !== 1` request `/auth/refresh` khi instance của component và của plugin cùng refresh (check mới dựng đúng tình huống app: plugin kích hoạt bằng `$fetch` bị 401, `appStatuses = [401, 200]`); sau khi sửa **24/24** và `requests.me === 1`, tức bên đến sau **join** chứ không tự verify lần hai. Share được mà không rò phiên: [auth.global.ts:4](file:///D:/Applications/tm-studio/app/middleware/auth.global.ts#L4) return sớm khi `import.meta.server`, nên `refresh()` không chạy trong SSR. **Chưa kết luận được**: chính lần 401 hôm đó là do race (refresh token của phiên dev cũng có thể đã hết hạn từ trước); bằng chứng ngược chỉ là quét lại **5 route authenticated sau khi sửa** = **0** finding ngoài CSP và session còn nguyên. Slice không thêm chuỗi nào nên không đụng `i18n/`, và không tự nhập credentials.
  - **Slice đóng tên transition bằng phép đo (2026-11-02):** `FFMPEG_XFADE_NAMES` vốn là một bản chép tay từ bảng tài liệu FFmpeg, nên nó có thể lệch khỏi binary thật sự chạy graph mà không ai biết — và một tên sai không phải cảnh báo: `xfade` khởi tạo lỗi là **cả export chết**. [tmcut_fx_catalog.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_catalog.spec.ts) giờ hỏi thẳng `resources/ffmpeg.exe` (=`N-126482-g903325e279-20260909`, advertise **59** tên) và so **set equality** với danh sách **59** tên; **45** entry catalog quy về **44** tên distinct, **0** `custom`. Red-test 5 mutation: (A)/(B) thêm-xoá một tên **chỉ** đỏ ở check mới, (C)/(D) đỏ ở check cũ, (E) regex parse rỗng đỏ vì set equality (nên assertion `>= 50` chưa chứng minh được giá trị thực chiến). Binary được phân giải giống hệt hai host ([server/config/index.ts:36](file:///D:/Applications/tm-studio/server/config/index.ts#L36), [paths.cjs:37](file:///D:/Applications/tm-studio/electron/tools/paths.cjs#L37)); clone chưa có binary in `SKIPPED` thay vì xanh im lặng. Đây là bước đóng nợ "tên FFmpeg lấy từ bảng tài liệu" chứ chưa phải QA pixel của transition.
  - **Nợ phát hiện ngay khi viết tài liệu (đã đóng tại chỗ):** hai dòng audit thêm ở bullet trước **render sai** vì `|` nằm trong code span — GFM chia ô theo mọi `|` chưa escape, nên row 4 cột hoá 6 ô mà không một guard nào báo. Thêm [tmcut_doc_table_shape.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_doc_table_shape.spec.ts) (**3** test: corpus thật, mọi dòng đúng số ô của header, escape được tôn trọng và corpus thật có dùng), unit lên **83/83**; hai dòng lỗi sửa bằng cách **bỏ pipe** chứ không escape nửa vời. Đỏ-test: chèn `a || b` vào row G17 cho `198 has 6 cells, header :180 has 4`, và bỏ bước strip escape làm test 3 đỏ; cả hai file restore byte-identical.
  - **Slice G5 — cầu nối flat↔v3 không được mất field (2026-11-02):** [v1compat.mjs](file:///D:/Applications/tm-studio/packages/core/src/v1compat.mjs) chở flat → DSL v3 rồi sync ngược, nhưng **im lặng bỏ** `mask`, `blend`, `speedPoints` và ba màu chữ của text. Không phải lỗi trình bày: core op nào *sinh clip mới* (paste/duplicate/ripple/split qua `applyV3Edit`) dựng flat item từ patch của bridge, nên clip đó **mất vĩnh viễn** mask + chế độ hoà + speed ramp trong store — và export đọc store. Đo trước khi sửa: view v3 trả `ABSENT` cả ba, paste trả `LOST` cả ba. Sau khi chở đủ 6 field + cho `matchesV3` so chúng thật ([sameMask](file:///D:/Applications/tm-studio/packages/core/src/v1compat.mjs#L299) / [sameRamp](file:///D:/Applications/tm-studio/packages/core/src/v1compat.mjs#L316)), cùng fixture clip 24 s ramp 0,5×→1,5× cho `evaluateTimeline` đổi từ `ramped=false` + `mask=null` + nguồn chạy dọc sang `ramped=true` + `mask=rectangle` + **9,000 s ở giây 12** (lệch −3,000 s ở giữa, −2,250 s ở 25/75%). Preview chưa từng sai vì mask/ramp: [useTmcutPlayback.ts:80](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L80) đưa project phẳng thẳng vào evaluator, evaluator nhận cả hai shape.
  - **Kiểu mới chỉ là optional, nên không cần ADR** — đúng mục §4.6 của audit ("thêm trường optional với default = hành vi cũ", khai ở [dsl.ts:106](file:///D:/Applications/tm-studio/packages/core/types/dsl.ts#L106)); `speedPoints` cố ý **không** đi qua converter thời gian vì ramp ra đời cùng commit với store ticks (`c999a26`, tra bằng `git log -S`) nên file legacy không mang field này. Red-test **3** test mới ([v1compat.test.mjs:442](file:///D:/Applications/tm-studio/packages/core/test/v1compat.test.mjs#L442)/[:450](file:///D:/Applications/tm-studio/packages/core/test/v1compat.test.mjs#L450)/[:473](file:///D:/Applications/tm-studio/packages/core/test/v1compat.test.mjs#L473)): trước sửa `25 pass / 3 fail`, sau sửa core **461 → 464/464**, unit **83/83**, electron **59/59**, typecheck exit 0 / **0** `error TS`, eslint 3 file chạm exit 0 chạy sau typecheck, boundaries + core `tsc` PASS.
  - **Gap đo được từ G5:** split **không retime** `speedPoints`. Cắt clip ramp 24 s (mean 1,0×) tại giây 12: head khai báo nguồn 0–12 s nhưng chỉ đi hết **0–9,000 s**, tail khai báo 12–24 s và đi **12,000–21,000 s**, control point của tail **giống hệt** head nên nó phát lại ramp từ 0,5× thay vì tiếp tục ở 1,0× — **6 s nguồn không bao giờ được chiếu** (9–12 và 21–24). Lỗi có sẵn ở **cả hai** đường ([timeline.mjs:242](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L242) và handler riêng [useTmcutProject.ts:1249](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L1249)); trước slice này triệu chứng là "tail mất ramp, chạy 1×", sau slice là "tail replay" — **cả hai đều sai**, chỉ khác hình dạng. Liên quan nhưng tách bạch: layer của `evaluateTimeline` publish `mask` mà **không** publish `blend`.
  - **Slice G5 follow-up — split phải retime `speedPoints` (2026-11-02, ĐÓNG gap ở bullet trên):** [splitSpeedPoints](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L222) cắt curve theo vết cắt — head giữ các điểm `< cut` cộng **một điểm nội suy ngay tại cut**, tail lấy điểm tại cut làm `t = 0` rồi tịnh tiến `-cut` (nên cắt trúng một control point không nhân đôi điểm đó); [splitRamp](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L255) trả `{ boundary, consumed, head, tail }`. Clip 24 s ramp 0,5×→1,5× cắt ở giây 12: boundary nay là **9,000 s** đúng bằng `rampIntegral`, head `speed 0,75` + curve `[{0, 0,5×}, {12s, 1,0×}]`, tail `speed 1,25` + `[{0, 1,0×}, {12s, 1,5×}]`, mỗi nửa **12 s** timeline và **0 s nguồn bị bỏ** (trước đây là **6 s**).
  - **Vì sao mỗi nửa phải có mean speed riêng:** flat model **không có field duration** — chiều dài suy ra `round((out − in) / speed)` ở [clipTime.ts:32](file:///D:/Applications/tm-studio/app/utils/tmcut/clipTime.ts#L32) và trong `clipDurationTicks`. Nếu head nhận đúng 9 s nguồn mà giữ `speed = 1,0` của cả clip thì nó thành **9 s** timeline chứ không phải 12 s, tức sửa ramp xong lại làm **lệch ngay vị trí user vừa cắt**. Hai đường split cùng gọi một helper: core [timeline.mjs:244](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L244) và handler riêng của app [useTmcutProject.ts:1276](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L1276). Clip **không** ramp đi đường cũ y nguyên (`speed` user gõ + curve `null`), và `splitClip` **xóa** key chứ không gán `null` nên project đã lưu không nhận field lạ. `reverse` cũng được chia lại (head nhận nguồn muộn, tail nhận nguồn sớm) — trước slice này chưa test nào phủ đường reversed.
  - **Đỏ-test và gate của slice split-retime:** **10** test mới trong [retime.test.mjs:196](file:///D:/Applications/tm-studio/packages/core/test/retime.test.mjs#L196) (chạy lẻ trước khi sửa: `pass 0 / fail 1`), **3** trong [timeline.test.mjs:95](file:///D:/Applications/tm-studio/packages/core/test/timeline.test.mjs#L95) (`pass 11 / fail 3`), **1** check store [tmcut_store_behaviour.spec.ts:89](file:///D:/Applications/tm-studio/tests/unit/tmcut_store_behaviour.spec.ts#L89) (**15 → 16**). Assertion `deepEqual(speedPoints, RAMP)` của slice G5 phải viết lại thành "còn là curve ≥ 2 điểm" **và** pin sub-curve của từng nửa, vì nó **đỏ thật** khi split bắt đầu retime (`27 pass / 1 fail`) — tức nó đã đang bắt đúng hành vi. **5** mutation, mỗi cái giết ≥ 1 test, restore byte-identical. Core **464 → 477/477**, unit **83/83**, electron tools **59/59**, boundaries PASS, core `tsc` exit 0, typecheck exit 0 + **0** `error TS`, eslint **3** error nhưng **cả 3 có ở HEAD** trên dòng không chạm (`git show HEAD:` lint cùng file ra `171 no-useless-assignment` + `arrow-parens` bị dời 257 → 339; test file HEAD đã có `165 arrow-parens`).
  - **Bằng chứng live của slice split-retime (app `dev:electron` của user, đọc không):** URL module thật mà dev server serve là bản **có** `/_nuxt` tiền tố (`200`, `text/javascript`, **22 362** byte) và `typeof splitRamp` = **`function`** trong trang đang chạy; bundle composable **200 599** byte chứa `splitRamp(` **1** lần, `map.head.speed` **3** lần và **0** lần công thức cũ `elapsedOnTimeline * speed`. Quét 5 route `/tmcut*`: mỗi route **1** finding = cảnh báo CSP dev-only, **0** console error. Route `/tmcut/library` là do probe **tự bịa** mới sinh `VUE_ROUTER_R0004` + `NUXT_E1005` + MIME `text/html` — không phải lỗi app. **Chưa chứng minh được:** một cú cắt thật qua UI trên clip ramp thật, vì `localStorage` chỉ có **1** project (`tmcut_project_default`: 3 track, **0** item có `in`/`out`) — cần user mở project có clip ramp.
  - **Gap đo được từ slice split-retime (trim của clip ramp, ĐÓNG ở ADR-027 bên dưới):** [trimClip:288](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L288) không đụng `speedPoints`, nên kéo edge `in` tới nguồn 9 s cho clip **giữ nguyên curve** (mở màn bằng 0,5× trong khi clip đã bắt đầu ở nơi curve đang 1,0×): duration **15 s**, khai **15 s** nguồn, curve chỉ đi **12,187 s** ⇒ **2,813 s** không bao giờ chiếu; kéo edge `out` tới 12 s thì curve chỉ ăn **9 s** và đoạn 12–24 s **không bao giờ tới**. Không sửa luôn vì **tịnh tiến curve là chưa đủ**: đoạn còn lại có mean 1,25× nên 15 s timeline sẽ ăn **18,75 s** nguồn và tràn `out`; muốn đúng phải normalize lại mean theo cửa mới, mà đó là chính sách sản phẩm (CapCut giữ hình dạng curve rồi co theo duration), không phải một phép toán duy nhất đúng — cần owner chốt.
  - **Slice ADR-027 — trim của clip ramp phải re-phase `speedPoints` (2026-11-02, ĐÓNG gap ở bullet trước):** chính sách chốt là *trim = một phép split mà nửa bị bỏ bị vứt đi*, nên curve **neo theo nội dung nguồn** chứ không theo vị trí edge. [trimClip:296](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L296) gọi [trimRamp:340](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L340) khi phép trim **co** một clip có curve; kết quả là nửa sống mang **curve con của chính nó** (re-anchor về `t = 0`, y như tail của một cú cắt) cộng **mean speed của chính nó** — vì store flat không có field duration, dài = `round(span/speed)`, nên dùng mean cũ sẽ dời vết cắt. Clip 24 s ease-in 0,5×→1,5× (mean 1,0×): out-trim tới nguồn 9 s cho `out` **9 s** + mean **0,75×** + curve `[{0, 0,5×}, {12s, 1,0×}]` và **vẫn 12 s timeline** ⇒ vết cắt nằm đúng playhead; in-trim cùng chỗ cho `in` **9 s**, offset dời tới **12 s**, mean **1,25×**, curve `[{0, 1,0×}, {12s, 1,5×}]`.
  - **Inverse của integral là mảnh còn thiếu:** [rampElapsedForConsumed:299](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L299) trả lời "cần bao nhiêu giây timeline để chiếu hết N giây nguồn" — phương trình bậc hai giải từng đoạn curve, viết ở dạng ổn định số `2*rem / (a + sqrt(a*a + 2*k*rem))` nên không chia cho 0 khi độ dốc `k` tiến về 0 (nghiệm `-b ± sqrt` gốc bị triệt tiêu số học ở đó). Không có nó thì chỉ tịnh tiến curve theo edge, và phép thử nhanh cho thấy **tịnh tiến là chưa đủ**: đoạn 1,0×→1,5× có mean 1,25×, nên 15 s timeline sẽ ăn **18,75 s** nguồn và tràn khỏi `out`. Clip constant đi qua đường cũ và trả số **byte-identical**.
  - **Chiều chiếu quyết định edge nào dời clip (cùng ADR-027, áp cho cả clip constant):** gọt nội dung **chiếu trước** thì dời, gọt nội dung chiếu sau thì đứng yên. Đo trước khi sửa, trên clip constant 2× offset 4 s: in-trim `0 → 2 s` dời tới **5 s** (đúng ra phải giữ 4 s) còn out-trim `10 → 8 s` giữ 4 s (đúng ra phải dời tới **5 s**) — hai case reverse **đảo ngược nhau**, tức trim đang giả định chiều forward. Cùng error class ở chân trời app: [useTmcutProject.ts:1341](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L1341) tự nhân đôi `clip.in + (timeTicks - start) * speed` thay vì dùng time map của core, nên playhead giây 12 thành nguồn 12 s thay vì 9 s; nay gọi `rampTimelineToSource` — **một** công thức cho constant + ramp + reverse.
  - **Đỏ-test và gate của slice trim-retime:** **6** test mới trong [timeline.test.mjs:255](file:///D:/Applications/tm-studio/packages/core/test/timeline.test.mjs#L255) (`trimClip honors the time map`), trong đó [check replay:313](file:///D:/Applications/tm-studio/packages/core/test/timeline.test.mjs#L313) pin bất biến "nguồn tại cùng một vị trí timeline" cho **cả 4** tổ hợp reverse × edge; **9** test trong [retime.test.mjs:324](file:///D:/Applications/tm-studio/packages/core/test/retime.test.mjs#L324); **3** check store từ [tmcut_store_behaviour.spec.ts:119](file:///D:/Applications/tm-studio/tests/unit/tmcut_store_behaviour.spec.ts#L119) (**16 → 19**). Red thật: thay lại công thức cũ ở composable thì `the trim follows the speed integral` fail; **6** mutation (`if (false)`, mean của clip, copy nguyên curve, `shiftTicks = 0`, bỏ rule reverse, inverse degenerate về `want / speed`) mỗi cái giết ≥ 1 test và hai file `src` restore `md5` khớp. Core **477 → 492/492** (**65** suite), unit **83/83**, electron tools **59/59**, boundaries PASS, core `tsc` exit 0, typecheck exit 0 + **0** `error TS`, eslint **3** error và **cả 3 có ở HEAD** trên dòng không chạm (**0** problem mới trên 6 file chạm).
  - **Bằng chứng live của slice trim-retime (app `dev:electron`, đọc không):** bundle serve của composable chứa `rampTimelineToSource` **2** lần và **0** lần công thức cũ; bundle `timeline.mjs` chứa `trimRamp` **3** + `isRamped(flat)` **1** + `if (clip.reverse) clip.timeline.start` **1**; instance core **sau** reload trả `typeof trimRamp = function` và đo thật `inverse(9 s) = 12 s`, out `0/9/0,75/shift 0`, in `9/24/1,25/shift 12`, reverse in `15/24/0,75/shift 0` — khớp unit test từng chữ. Console `/tmcut/editor` **8** dòng, **2** warning CSP dev-only, **0** error. **Chưa chứng minh được:** cú trim thật qua UI trên clip ramp thật — `localStorage` vẫn chỉ có `tmcut_project_default` (3 track, **0** item, **0** clip ramp, `indexedDB` rỗng); cần user mở project có clip. **Ghi thật:** probe đầu tiên attach nhầm target `devtools://` và sau đó app mất cả `:4003` lẫn `:9222`; không quy được cho sửa đổi nào (gate 1–3 đã xanh trước đó), đã khởi động lại `dev:electron` rồi đo lại — các số trên là của lần đo lại.
  - **Phát hiện live khi đóng gate G5:** `import(url)` bằng đúng URL document đã load trả **bản tiền-sửa**, trong khi `fetch` cùng URL cho thấy dev server **đã** serve bản mới và `import(url + '?b=…')` trả **carried** ⇒ trang đang chạy giữ instance cũ trong ESM module map, **phải reload** app mới nhận sửa trong `packages/core` (`Target.createTarget` trên CDP của Electron trả `-32000 Not supported` nên không mở được tab nền). Quét read-only `/tmcut/editor` = **0** console error/warning/exception.
  - **Vẫn chưa QA được bằng mắt:** preview của clip có mask/`fitStyle` — probe CDP trên `/tmcut/editor` (app đã đăng nhập lại) cho **530** element có `style`, **0** chứa `NaN`, nhưng **0** element `object-fit` vì project đang mở là `Untitled Project`; đây là bằng chứng phủ lỗi NaN, chưa phải bằng chứng thuận của layout.
- **Slice G16 — preview đọc hình học do core sở hữu (2026-11-02, ĐÓNG G16 ở phần hình học):** [transitions.mjs:242](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L242) khai `XFADE_PREVIEW` — đúng **một dòng cho mỗi trong 45** khoá của `KNOWN_TRANSITIONS`, mỗi dòng là `{shape, from, law, fidelity, note}` với `law` lấy từ [XFADE_POSITION_LAWS](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L253) (8 hàm `p → travel`) và hình học/CSS phát ra từ [previewTransitionRamp:470](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L470) dưới dạng **chuỗi CSS thuần** + một số `coverage`, nên [TmcutPreviewPlayer.vue:698](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L698) chỉ còn `xfadeRamp = previewTransitionRamp(cf.type, cf.progress)`; `incomingRamp()` (switch 4 nhánh, nguồn của gap) đã bị xoá và **0** tham chiếu còn lại. Khai báo kiểu ở `packages/core/src/index.d.ts` nên app đọc bảng này có type, không đọc comment.
- **Cách đo từng dòng số liệu:** hai plate đặc đen→trắng qua `xfade=transition=<name>:duration=0.4:offset=0.8` ở `320x180` (`0.8` = cửa hợp lệ `độ dài clip đầu − duration`; slice #82 quét lại toàn bộ **45** khoá trên đúng cửa đó và các con số dưới đây tái hiện không đổi), xuất `rawvideo -pix_fmt gray`, decode **hết** frame, luminance trung bình của 12 frame chuyển tiếp **chính là** phần box clip vào đã phủ (0 và 255 làm phép đo thành tuyệt đối, không cần oracle). Kết quả trên `resources/ffmpeg.exe` (`N-126482-g903325e279-20260909`): **17** khoá `exact` (lệch frame lớn nhất **1.6%**), **19** `shape` (lớn nhất **5.1%**), **9** `approximate`; **4** khoá `circle*`/`radial` trả `coverage = null` vì diện tích bị cắt theo tỉ lệ canvas mà core không biết. Bảng đầy đủ: [v4-phase-0-audit.md §8.1](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md).
- **Hai bất biến preview rút ra được từ phép đo, ghi thành test chứ không thành comment:** (1) player vẽ clip **đến** đè lên clip đi, nên mọi phép reveal phải nằm trên lớp incoming — cắt/mask lớp outgoing chỉ làm lộ nền đen của canvas; bất biến này red-test được bằng cách mutate `corner`/`hole`/`squeeze` về lớp outgoing, và chỉ họ `slide` là được quyền dời cả hai lớp. (2) một mặt trước **mềm** rộng 37–70% trục không thể đạt alpha 0 tại `p=0` và alpha 1 tại `p=1` (CSS kẹp stop ngược thứ tự), nên các key soft-wipe/band vẽ biên cứng và tự khai `fidelity: 'shape'` + `note` nói rõ cái gì mất — thay vì để lộ một mảnh clip đến ở hai đầu mút như bản gradient.
- **Model sửa lại vì chính spec bắt được:** bản đầu của bảng coi `travel` của họ `diag*` là **diện tích** với law `quad` — phép đo 12 frame trả lệch tới **21.4%**, vượt trần `shape` 15%. Fit lại 9 ứng viên law × đường chéo (cả raw lẫn bình phương) trên **ba** canvas (`320x180`, `180x320`, `200x200`) cho thấy diện tích là `travel²` với `travel = inOutQuad(p)` (RMSE **2.3%**, lệch lớn nhất **5.1%**), và đường cong diện tích **không đổi** giữa ba canvas (trải **0.10%**) — vì mặt trước là đường 45° theo **tỉ lệ**, không theo pixel. Law `quad` vì thế bị bỏ khỏi `XFADE_POSITION_LAWS` (không còn khoá nào dùng), và spec giờ kiểm luôn tính bất biến aspect-free thay vì biện luận tay như với `circleopen`.
- **`squeezev` KHÔNG phải lỗi đặt tên — và slice #81 chỉ ra rằng nó cũng không phải "lỗi binary" vô điều kiện:** bản đo cũ (probe plate `d=1.2`, `duration=0.4`, `offset=0.6`) in ra **28/60** frame rồi chết `0xC0000005`, trong khi `squeezeh` đi hết 60 frame, nên registry ghi `unavailable` và cả preview lẫn export vẽ fade thường. Phép đo lại chỉ đổi **một** tham số: cửa hợp lệ của hai plate 1.2 s là `offset=0.8`, không phải `0.6`. Ở cửa hợp lệ, `squeezev` chạy **xong 60/60 frame, exit 0** — cả từ plate lavfi, cả từ file mp4, và cả từ filtergraph `compileTimelineToFfmpeg` sinh ra ở `320x180` lẫn `1920x1080`; ở cửa sai thì nó chết **4/4** lần và số frame nó kịp xuất ra thay đổi giữa các lần (22 / 23 / 27), đúng dáng của một lỗi đọc ngoài biên chứ không phải một quyết định từ chối của filter. Ba giả nhân khác bị đo và loại: `format=yuv420p`, `settb=AVTB`/`settb=1/30`+`fps=30`, nguồn lavfi-vs-mp4. Phần bỏ ngỏ — hình học thật của nó trên cửa hợp lệ — slice **#82** đã đo, và nó **không** vẽ fade: xem bullet #82. Con số 28/60 nói trên vẫn là probe sống trong [tmcut_transition_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_transition_preview.spec.ts), nhưng file đó giờ assert **cả hai phía** của đường ranh giới cửa (chết ở `0.6`, in đủ frame ở `0.8`) thay vì chỉ phía sai
- **Slice #80 đóng nốt phía export của G16 — và sửa luôn một giả định sai:** [video.ts:23](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L23) `mapXfadeTransition` đưa tên vừa giải ra qua [renderableXfadeName](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L511), nên một khoá bị đo `unavailable` phát `fade` với **đúng** duration và offset cũ — timeline không dịch chỗ nào, và graph không còn tự chọn một cái tên mà registry đã đo là không vẽ được — Ghi lại cả giả định sai: **không** cần chuỗi UI mới, vì cách xử lý đúng là vẽ đúng cái preview đã vẽ (fade), không phải báo lỗi bằng một câu chữ khác; guard mới chạy ở **cả ba** tầng — core (mọi khoá đều trả tên render được, và chỉ `squeezev->fade` bị degrade), compile graph (`xfade=transition=fade`, không còn chuỗi `squeezev`), và FFmpeg thật (chain sau khi degrade phải xuất đủ 12 frame trên đúng hai plate). Phép đo live: dev server standalone serve đúng module đã nối dây, và **5/5** route tmcut sạch console, **nhưng** cả năm route dừng ở `/login` vì không có phiên hub — wiring được xác nhận ở bundle đang chạy, chưa phải ở một transition thật. **Rút lại ở #82:** cả tầng degrade `unavailable -> fade` đó đã bị **xoá**, vì không khoá nào trong catalogue bị từ chối trên cửa hợp lệ
- **Và một câu của #80 phải rút lại, vì nó hóa ra là lỗi cửa transpose chứ không phải "binary từ chối tên":** probe G16 dùng `d=1.2` + `duration=0.4` + `offset=0.6`, trong khi cửa hợp lệ của xfade là `offset = độ dài clip đầu − duration = 0.8`. Đổi đúng một tham số đó: `squeezev` chạy **xong 60/60 frame, exit 0** — từ plate lavfi, từ file mp4 thật, và từ filtergraph mà `compileTimelineToFfmpeg` sinh ra ở cả `320x180` lẫn `1920x1080`. Ở cửa sai nó chết **4/4** lần chạy và số frame kịp xuất ra **không ổn định** (22 / 23 / 27), đúng dáng một phép đọc ngoài biên hơn là một quyết định từ chối. Ba giả nhân khác đã đo và loại: `format=yuv420p` trước xfade, `settb=AVTB`/`settb=1/30` + `fps=30`, và nguồn lavfi-vs-mp4. **#82 đã trả lời câu hỏi đó:** trên cửa hợp lệ `squeezev` là squeeze với mặt trước chạy dọc `x`, `fidelity: exact` (0.3% / 12-12 frame); `unavailable` và tầng degrade bị xoá — xem bullet #82 ngay dưới.
- **Slice #81 — parity pixel của một project thật, không chỉ của một chuỗi lọc (V4 G2, 2026-11-02):** [tmcut_render_smoke.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_smoke.spec.ts) giờ dựng **hai plate đặc** (đen → trắng) thành **một project hai clip** rồi đưa qua `compileTimelineToFfmpeg`, tức thứ được chấm là pipeline mà export thật chạy (container, encoder, hai lane audio), không phải một `[0:v][1:v]xfade=…` nối tay. Số đo của `wipe-left`: diện tích lệch **0.3%** so với `coverage` của model, và vì diện tích của một cú wipe **trùng từng điểm** với của một cú crossfade, block này chấm thêm **vị trí** — cột trái/giữa/phải lệch **0.8% / 1.2% / 1.3%** trong trần **3%**, với đường bao kỳ vọng đọc từ chính `clipPath` mà [previewTransitionRamp](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L470) trả về chứ không viết tay trong test. Test cũng tự chứng minh nó phân biệt được: cùng project đó chạy `fade` rồi chấm theo model của wipe ra **74.9% / 33.3% / 75.3%**, và con số đó nằm trong một assert `> 15%` — nếu một ngày phép chấm cột không còn tách được wipe khỏi fade thì smoke đỏ thay vì âm thầm vô dụng.
- **`--smoke` xanh toàn bộ lần đầu trên máy này, và lý do nó từng đỏ:** [tmcut_detect_smoke.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_detect_smoke.spec.ts) ghi media ra `%TEMP%`, mà binary bundled ở `resources/` **không mở được file ở đó** (`Error opening output …: Permission denied`, exit `-13`) — nên spec đó đỏ **từ trước** slice này, không phải do slice này làm hỏng. Work dir chuyển vào trong repo theo đúng quy ước `.golden-render-*/` (gitignore, cùng cách `tmcut_render_parity` và `tmcut_golden_frame` đang dùng) và thêm `try/finally` dọn dẹp; kết quả: `84/84` khi chạy thường, **`87/87`** khi bật `--smoke`, **0** dòng `FAIL`, và không còn dir rác nào sau run.
   - **Gate + đỏ-test + bằng chứng live của slice G16:** core **502/502** (`fail 0`, 66 suite / 39 file), unit **84/84** (87 file), electron tools **59/59**, `check-boundaries` PASS, core `tsc` exit 0, `nuxt typecheck` exit 0 / **0** `error TS`, eslint **0** problem trên 5 file touched chạy sau khi typecheck sinh lại config. Hai mutation thật đều bị bắt: đổi `coverage = area` về `travel` → guard diagonal đỏ (19/1), làm lệch polygon hàm trả về → guard `shapeArea()` đỏ (20/1). Live: module player đang serve tham chiếu `previewTransitionRamp` **2** lần và `incomingRamp` **0** lần, sweep 5 route tmcut không có error/warning nào; một lỗi HMR `SOFT_EDGE is not defined` thấy ở probe đầu **không** tái hiện sau reload sạch, nên nó là snapshot giữa lúc sửa chứ không phải code lỗi. Chưa chứng minh: transition trên clip thật (app hết phiên, `localStorage` vẫn 0 item) và packaged build.
- **Slice #82 — G16 đóng lại bằng hình học đo được, không bằng suy ra từ ký ức (2026-11-02):** câu hỏi #81 để ngỏ (`squeezev` trên cửa hợp lệ vẽ gì) đã có số đo, và câu trả lời đổi **cả họ** squeeze/band. Probe đọc **runs của hàng và cột** thay vì diện tích: ở frame giữa ramp `squeezeh` để lại hai dải trắng theo hàng (`0-44 + 136-179`) nên mặt trước ăn từ **trên/dưới** và chạy dọc trục `y`, còn `squeezev` để lại hai dải theo cột (`0-79 + 241-319`) nên là `x`. Registry thành `{squeezeh: squeeze/y, squeezev: squeeze/x}`, cả hai `law: linear`, `fidelity: exact`, diện tích khớp model **0.3%** trên **12/12** frame; bảng `fidelity` đi từ **16/19/10** sang **17 exact / 19 shape / 9 approximate**. Cùng phép đo sửa luôn bảng card preview: trước #82 nó nói `squeezeh` = `x`, `horzopen` = `x`, `vertopen` = `y` — tức **cả sáu** khoá squeeze/band đều đảo trục so với cái binary render ra.
- **Vì sao diện tích từng bỏ sót bug này, và guard mới chấm gì:** hai cú squeeze có **curve diện tích giống hệt nhau** (một band và một squeeze cũng che đúng `travel` của box), nên không con số area nào phân biệt được squeeze dọc với squeeze ngang — đó là cách lỗi đảo trục sống sót qua mọi bản ghi đo trước đây. Phép mutation chứng minh đúng điều đó: đổi `squeezeh.travel` sang `x` làm đỏ **đúng** guard trục (`'y' !== 'x'`) trong khi sweep diện tích **22** khoá vẫn xanh. Ba guard **vị trí** mới vì thế: [tmcut_transition_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_transition_preview.spec.ts) chấm runs hàng/cột cho **6** khoá, [tmcut_render_smoke.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_smoke.spec.ts) chấm `bandFront()` trên frame của một **project thật** đã qua `compileTimelineToFfmpeg` (kèm một control `fade` phải **không** ra trục nào với decisiveness < 0.05), và [tmcut_fx_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_preview.spec.ts) pin `axis` của bảng card với `XFADE_PREVIEW.travel`. Hệ quả vocabulary: `unavailable` không còn là một shape, `renderableXfadeName` bị xoá khỏi core, và [mapXfadeTransition:29](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L29) chỉ còn là `xfadeNameFor(type)` — export xin **đúng** tên preview vẽ.
- **Bất biến cửa thay cho danh sách tên bị cấm:** thứ làm encode chết chưa từng là cái tên, mà là **cửa**. `offset` phải đặt overlap sao cho nó **kết thúc** đúng chỗ clip đầu kết thúc; [tmcut_render_graph.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_graph.spec.ts) giờ đọc từng chuỗi `xfade=` trong filtergraph đã biên dịch của một project **ba** clip và đòi `offset + duration` bằng đúng độ dài chain đã tiêu thụ ở **cả hai** cửa (và `offset > 0`, tức không cửa nào rơi vào nhánh clamp), cộng một check tên để `squeezev`/`squeezeh` phải tới graph **dưới tên của chính nó**. Mutation: dịch `offset` đi `-0.2 s` ở clip thứ ba → đỏ đúng bất biến cửa, các check tên vẫn xanh; restore byte-identical (md5 khớp). Chưa chứng minh: transition trên **footage thật** (plate đặc chỉ chấm được luminance và vị trí dải trắng), profile vị trí ngoài 6 khoá squeeze/band (và cột của `wipe-left` ở #81), 4 khoá `circle*`/`radial` vẫn trả `coverage = null` vì diện tích bị cắt theo tỉ lệ canvas, `distance`/`fadewhite`/`fadeblack` vẫn mù trên plate đặc, packaged build, và một cú bấm render thật trong UI.

- **Slice #83 — dọn nốt chữ `unavailable` mà #82 đã làm cho thành rỗng (2026-11-02):** sau khi #82 chứng minh **mọi** khoá trong catalogue render được trên cửa hợp lệ, `shape: 'unavailable'` là một giá trị không còn dòng nào trong registry dùng, và `renderableXfadeName` là một hàm luôn trả đúng tên nó nhận. Xoá cả hai khỏi [transitions.mjs](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs) + [index.d.ts](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts) và gọi thẳng `xfadeNameFor(type)` ở [video.ts:29](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L29): **không** đổi hành vi export nào (guard chuỗi của `tmcut_render_graph.spec.ts` vẫn nguyên từng byte), chỉ bỏ một lớp ngả tên mà chính phép đo của #82 đã khai là vô nghĩa. Đây là kiểu dọn mà một registry do đo mà ra phải chịu được: khi dữ liệu nói "không khoá nào bị cấm", cái hàm "cấm theo dữ liệu" phải đi, vì để nó thì mọi đọc sau này lại tưởng có một danh sách cấm thật.
- **Slice #84 — preview được đọc bằng **pixel**, không chỉ bằng diện tích, và họ `*slice` bị bắt bug (2026-11-03):**
  [tmcut_transition_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_transition_preview.spec.ts) thêm **hai** phép đọc mới trên cùng bộ
  frame FFmpeg thật: chuỗi CSS của model được **raster hoá** ngay trong spec (`polygon`/`inset`/`circle`/ba loại
  gradient/`translate…%`, một mẫu cho mỗi tâm pixel của `320x180`) để chấm **diện tích sơn**, và **thành viên
  vùng từng pixel** (`≥128` = pixel đó thuộc clip vào) để chấm **hình dạng**. Trần mới theo grade — `coverage`
  **3% / 15%**, diện tích **3% / 8%**, vùng **3% / 12%** (exact/shape); dòng `approximate` rút khỏi **cả ba** phép
  chấm và ghi trong `ungradeable`, vì plate đặc không hiển thị được timing của tint/blur/dither.
  - **Bốn khoá `*slice` chuyển `shape` → `exact`**, và lý do là một giới hạn của phép chấm cũ: hai phép diện
    tích **không phân biệt được** mười răng lược đang đầy dần với một mặt front đơn — diện tích trùng từng điểm.
    Phép đọc vùng thì phân biệt, và source của binary nói hình thật: `smooth = smoothstep(-0.5f, 0.f,
    x/w - progress*1.5f)` và `ss = smooth <= fract(10.f*x/w)` = **10** răng chu kỳ **1/10** trên dải **0.5** trục,
    front chạy **linear** theo progress (trước đó bảng G16 ghi law `inOutQuad` + "một mặt front", và nó vẫn xanh
    vì chỉ có diện tích được chấm). Model mới trong core là bất động điểm của chính công thức đó
    (`combTooth`, `XFADE_COMB_PERIOD = 1/10`) và khớp render trong **0.9–1.7%** trên cả ba phép.
  - **Card preview phải cắt cùng chu kỳ với binary**, không chỉ cùng hướng: guard mới ở
    [tmcut_fx_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_preview.spec.ts) đếm số răng từ
    `repeating-linear-gradient` + `maskSize` của card rồi so với `1/XFADE_COMB_PERIOD`, và vẫn so `axis` của card
    với `from` của core — nên một card vẽ lược ngang cho một họ cắt dọc, hoặc vẽ 20 răng cho một chu kỳ 10,
    đều đỏ tại chỗ.
  - `circlecrop` lên `exact` (law `iris` → `lateCube`), `radial` sang `radialLag` và lệch **1.2%** vùng — hai
    khoá này từng có `coverage = null` nên **không từng được chấm**, giờ được chấm bằng hai phép pixel.
    Census **17/19/9 → 21/15/9**, và ba con số đó bị **pin** bằng `deepEqual`; thêm guard "mỗi cặp
    `(shape, law)` khai trong `XFADE_PREVIEW` phải có ít nhất một probe vẽ nó", tức một họ hình học mới chưa đo
    là đỏ ngay chứ không im lặng đi qua sweep.
  - **Lưới mẫu là bài học riêng:** ở `80x45` họ comb báo **6.7%** lệch vùng, ở `320x180` cùng hình học báo
    **1.7%** — lưới thô tự sinh sai số trên một biên sắc, và đó là lý do mọi grade vùng chạy trên pixel của plate.
  - Đỏ-test **6/6** mutation trên bốn mặt (period `1/10→1/6`, law comb `linear→smoother`, grade
    `circlecrop exact→shape`, travel `squeezeh y→x`, axis card `hlslice x→y`, probe list bỏ `radial`), mỗi cái fail
    **đúng** guard được nêu tên, file restore byte-identical (md5).
- **Slice #85 — preview được đọc bằng **ảnh thật**, không chỉ bằng plate (2026-11-03):**
  Phép đọc thứ tư trong [tmcut_transition_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_transition_preview.spec.ts)
  so **từng pixel** của frame `xfade` trên `testsrc2`/`smptebars` (qua đúng chuỗi prep mà graph của app phát ra)
  với **bức ảnh mà model dự đoán** ở pixel đó: lớp nào ở trên và lớp đó chiếu pixel nguồn nào, lấy mẫu bilinear
  tại toạ độ nghịch đảo của transform lớp. Lý do phải có phép này: **plate đặc bị mù** — nó chấm được diện tích
  và biên vùng, nhưng không thấy được một ảnh bị nén/trượt, và với họ `*crop` thì plate đen của clip ra **chính
  là** trường đen mà file vẽ, nên `circlecrop` đạt **0.0%** trên plate dù vẽ sai ảnh.
  - **Law đo được của hai khoá crop:** `circlecrop` = **hai pha** trên nền đen — nửa đầu cửa clip **ra** co lại
    theo `|2p−1|³` (fractions **0.5824 / 0.300 / 0.128 / 0.0402 / 0.0039** tại p=1/12…5/12, đối xứng sau 0.5),
    nửa sau clip **vào** mở ra đúng law `lateCube` đã đo ở #84; `rectcrop` giống hệt với law `late` linear
    (**0.828 / 0.657 / 0.496 / 0.325 / 0.160**). Trong cửa hợp lệ, ảnh **không** bị dịch: source mapping là
    identity (lệch ≤1 trên 320 cột), và 100% pixel ở p=0.5 là **đen**. Hình học này **không phụ thuộc format**:
    `rgb24` prep, prep `gbrp` của app và footage thật cho cùng một con số.
  - **Họ squeeze:** ảnh ra bị **nén** quanh tâm với `slope = 1/(1−p)` (fit **1.088 / 1.329 / 1.981 / 3.963 /
    11.889** tại p=1/12…5/12); plate từng cho **17.2%** pixel sai khi bỏ quyền biến này.
  - Registry: `circlecrop` → `iris`/`lateCube`/**exact**, `rectcrop` → `rect`/`late`/**exact**, cả hai mang cờ mới
    `crop: true`; `previewTransitionRamp` phát `clipPath` cho **cả hai** lớp theo cùng một cửa, và player clip lớp
    ra trên nền đen của monitor. Census **không đổi** (**21/15/9**) — đây là sửa hình học, không phải hạ grade.
  - Trần mới **3% / 3%** (lệch dự đoán / off-model) và **hai** guard chống rỗng (≥50% pixel phân biệt được,
    ≤50% pixel hai nguồn giống nhau); **100** phép chấm trên 20 khoá, tệ nhất **1.7%** ở `vdslice`/`vuslice`,
    off-model tệ nhất **2.2%** ở `slidedown`, số pixel chấm được thấp nhất **48968/57600**.
- **Gate của #83–#84 và hai chỗ vẫn blocked (2026-11-03):** core **505/505** (`fail 0`), unit **83/84** — fail duy nhất là guard link docs, đỏ vì `docs/user-guide.md` bị xoá trong working tree của **owner** (HEAD vẫn có file, nên không phải lỗi slice này; slice không đụng `extraction-plan.md`), `nuxt typecheck` **BLOCKED** với **3** `error TS2321` nằm trọn ở `app/composables/useHub.ts:51` (WIP owner, **0** error ở mọi file khác — không sửa/stash để làm gate im lặng), ESLint **0** problem trên **6** file chạm chạy **sau** khi typecheck sinh lại `.nuxt/eslint.config.mjs`. Live bằng `dev:electron` của user (`:4003` HTTP 200): module core mà dev server đang serve chứa `XFADE_COMB_PERIOD` + `combTooth`, và khớp source từng dòng ở `SOFT_EDGE` (291) cùng `previewTransitionRamp` (454) — geometry mới nằm trong bundle thật, không chỉ trong file.
    Hai chi tiết probe đáng ghi: URL phải là `/_nuxt/@fs/D:/.../transitions.mjs`, vì `/@fs/...` không prefix trả về **200 kèm SPA shell** (thân HTML, 0 symbol) nên một probe quên prefix sẽ kết luận sai là geometry chưa được serve; và `renderableXfadeName` **0** lần trong module core đang serve, còn `render/video.ts` đang serve có `mapXfadeTransition` trả đúng `xfadeNameFor(type)` — tức cả phía #83 cũng nằm trong bundle chạy thật.
    CDP của chính app tm-studio là `:9223` (User-Agent `tm-studio/0.1.0 Electron/44.10.0`), **không phải** `:9222` (app đó là tm-tools, `tm-tools/1.0.0`); nhưng cửa sổ `:9223` đang mở dashboard tm-tools ở `:4002`, nên không đọc console renderer của tm-studio được — đọc console ở đó là bằng chứng của app khác, và điều hướng cửa sổ user đang dùng thì không phải đọc-không. **Chưa chứng minh ở #84:** DOM của card trong browser, cú bấm render thật, packaged build — còn **transition trên footage thật** đã có bằng chứng ở #85 (phép đọc thứ tư, 100 grade).
Của #85: core **506/506**, electron tools **59/59**, typecheck **exit 0 / 0 `error TS`** (TS2321 của owner ở `useHub.ts` đã biến mất), ESLint **0** problem trên **5** file chạm sau khi regenerate, unit **82/84** với **hai** fail đều là WIP owner — trong đó `app/pages/login.vue` bản working tree **quay lại ghi mật khẩu plaintext vào `localStorage`** mà HEAD đã gỡ; guard `tmcut_login_remember` bắt đúng và slice này không đụng file đó.

**Các bước của phase:**

- Tách Project Core khỏi UI.
- Tách Timeline evaluator.
- Chuẩn hóa timebase.
- Xây platform adapter interfaces.
- Tạo browser/electron/node adapters tối thiểu.
- Không thay đổi behavior người dùng ở giai đoạn này.

**Acceptance criteria:**

- Core chạy được trong browser và Node test.
- Project serialize/deserialize không phụ thuộc Electron.
- Timeline evaluation có unit tests.
- Project cũ có migration tests.

### Phase 2 – Deterministic Rendering MVP

- Xây `renderAt(timestamp)`. *(**xong — slice #89, 2026-11-03**: [renderAt.mjs:51](file:///D:/Applications/tm-studio/packages/core/src/renderAt.mjs#L51) là API công khai **tên** `renderAt`, và preview gọi nó ở chế độ scrub thay vì giữ luật boundary riêng — xem block "Trạng thái #89" ngay dưới acceptance criteria của phase này. Cái **chưa** làm là interface `Renderer.renderAt(request): Promise<RenderResult>` ở §4.2: nó quản lý vòng đời `VideoFrame`/texture và thuộc Phase 3.)*
- Xây DOM renderer. *(**xong một phần — slice #92, 2026-11-03**: DOM renderer đã tồn tại từ lâu (overlay CSS trong [TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue)), và bản copy **cuối cùng** các số đo chữ của nó vừa bị lấy đi: stroke/shadow/plate padding cùng hai giá trị mặc định `36` / `#ffffff` giờ sống ở [textStyle.mjs](file:///D:/Applications/tm-studio/packages/core/src/textStyle.mjs), preview và export cùng đọc từ đó, và `addClip` + migration cũng seed từ đó — xem block "Trạng thái #92" cuối phase này. Cái **chưa** làm là phần khiến mục này mới thật sự là "renderer": chưa có cổng **pixel DOM ↔ export** cho cùng một project — `captureFrames()` ([htmlVideoRender.ts:97](file:///D:/Applications/tm-studio/server/utils/htmlVideoRender.ts#L97)) chỉ phục vụ HTML-video, và ảnh DOM của một caption chưa từng được so với khung mp4 render từ chính project đó.)*
- Xây frame scheduler. *(**xong — slice #86, 2026-11-03**: [scheduler.mjs](file:///D:/Applications/tm-studio/packages/core/src/scheduler.mjs) `createFrameScheduler(input, { rate })` → `frameCount` / `frameAt(index)` / `indexOf(ticks)` / `frames(from, to)`; xem block "Trạng thái #86" ngay dưới acceptance criteria của phase này)*
- Render text, image, SVG, shape. *(**xong 3/4 — slice #90, 2026-11-03**: text đã có cổng pixel riêng ở M2 bước 7, image từ lâu, và **SVG** nay đi chung một luật still với image — [media.mjs:13](file:///D:/Applications/tm-studio/packages/core/src/media.mjs#L13) phân loại `svg` là ảnh tĩnh, [canvas.mjs:45](file:///D:/Applications/tm-studio/packages/core/src/canvas.mjs#L45) `stillImageInputFlags` là nơi **duy nhất** đổi một file still thành input flags. Cái **chưa** làm là `shape`: nó cần một loại layer mới, chưa tồn tại ở đâu cả — xem block "Trạng thái #90" ngay dưới acceptance criteria của phase này.)*
- Preview và export gọi cùng timeline evaluator. *(**xong — slice #87, 2026-11-03**: export không còn tự chọn track và không còn tự suy lại cửa sổ clip; [tmcut_export_track_parity.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_track_parity.spec.ts) đi **từng frame** của `createFrameScheduler` và so caption của evaluator với cửa sổ của file — xem block "Trạng thái #87" dưới acceptance criteria của phase này. Cái **chưa** xong là composite hai row footage: G18. **2026-11-03 (slice #93)** câu hỏi "hàng nào VẼ tại tick này" cũng về core — [paintStack.mjs:49](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L49) `selectPaintRows` là luật duy nhất, preview đọc nó ở [useTmcutPlayback.ts:112](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L112), và 121 cặp layout×tick chứng minh đường mới trả lời đúng như loop cũ. Nhưng **export vẫn trả lời per file** (`videoBase = videoRows[0]` ở [render/clip.ts:155](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts#L155)) nên tại một ô trống hai surface từng lệch — độ lệch đó đã bị **pin** trong test cho tới **#95**: **mọi** row đang hiện giờ vào file thành chồng hình theo đúng thứ tự `rows` của core, còn preview vẫn vẽ row đáy. **#95** khép sau **#94** (export bỏ hẳn `offsetSec` — G19, xem "Trạng thái #94" và "Trạng thái #95").)*
- *(**F3, 2026-11-04**: vế "export vẫn trả lời per file" đã đóng. Câu hỏi per-file giờ là luật core — `selectFileRows` ([paintStack.mjs:140](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L140)) — và [render/clip.ts:160](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts#L160) chỉ còn **join** `{ trackId, trackIndex }` về track authored; bản `videoBase = videoRows[0]` + `paints(t, 'src')` bị xóa. Preview per-tick và file per-file là **hai scope của một luật**, không còn là hai câu trả lời — xem §30 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md). Vế "preview vẫn vẽ row đáy" của dòng trên đã bị **F2b** (§29) đóng trước đó.)*
- *(**F4a, 2026-11-04**: "cùng một màn hình" còn một vế chưa đóng — **nhanh bao nhiêu**. Preview đặt `playbackRate` từ `shuttleRate` đơn thuần cho hàng stacked và partner crossfade, còn element chính chỉ đọc `speedAt` khi clip **có** ramp; trong khi target seek của chúng đến từ `layer.sourceTicks` **đã chia speed**, và file chia `setpts` cho **mọi** row ([render/video.ts:260](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L260)). Kết quả: hàng 2x tự chạy 1x và corrective seek bắn mọi frame. Luật mới `mediaRate(clip)` ở [useTmcutPlayback.ts:301](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L301) là bản đọc trên màn hình của **đúng số đó** — `speedAt` một chỗ duy nhất, nhân `|shuttleRate|`, kẹp `[0.25, 16]`, `isRamped` không còn là cửa, reverse vẫn seek-driven. Pin nguồn ở [tmcut_speed_clock.spec.ts:178](file:///D:/Applications/tm-studio/tests/unit/tmcut_speed_clock.spec.ts#L178) không cho luật quay về từng element nữa. Xem §31 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F4b-1, 2026-11-05**: vế còn lại của "một đường composite" — **effect tint row nào**. Monitor từng phủ vignette lên **cả** khung hình (một div `z-10` con của monitor) trong khi file nung effect **vào layer**, sau fit ([render/video.ts:320](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L320)); và DOM chạy lại `evaluateClip` + `resolveClipLayout` cho đúng clip mà `surface.layer` đã mang số. Giờ mỗi row footage là một **group**: group mang `layer.transform` / `layer.opacity` / mask / filter / blend, element mang `object-fit`, còn plate là **con của group** — [player:736](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L736) và [:750](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L750), bốn site template.)*
- *(**F4b-2, 2026-11-05**: ai được plate live là cờ trung thực mới của registry, `preview.layerOverlay` ([effects.mjs:53](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L53) / [:63](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L63) / [:185](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L185), đọc ở [fxPreview.ts:812](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L812)) — mnemonic của tile (dải key, lưới ô) không bao giờ tint màn hình. Đo live trên Chromium: plate nằm trong group của clip có effect, `rgba(0,0,0,0.41)` = `0.5 × 0.82` của registry chứ không phải `0.43` của công thức DOM cũ, và số plate phủ toàn khung = **0**.)*
- *(**F4b-3, 2026-11-05**: spec mới [tmcut_surface_plate.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_surface_plate.spec.ts) RED **0/7** một lượt đo rồi GREEN 7/7; suite **110/110**, smoke **113/113**, core `tsc` 0. Contract cũ ở [tmcut_shared_model.spec.ts:307](file:///D:/Applications/tm-studio/tests/unit/tmcut_shared_model.spec.ts#L307) tiến hóa theo luật chứ không theo sự tiện: đòi `fitStyle(surface.layer.layout)` và phủ định `resolveClipLayout(`. Xem §32 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md). Còn chờ F6: rAF riêng của html-video và `mediaTimeAt` fallback.)*
- *(**F5-1, 2026-11-05**: một element dùng một lần nay **trả lại** những gì nó mượn. `probeWebMetadata` và `captureVideoThumb` mỗi nơi tự mở `<video>` / `new Audio()`, tự arm `setTimeout(…, 15000)`, rồi bỏ đi: `src` vẫn chỉ vào blob hay `/uploads/…`, reader vẫn bám đúng byte đó, và watchdog vẫn chạy **sau khi câu trả lời đã giao** — 12 file import là 12 decoder và 12 timer sống thêm 15 giây. Giờ [mediaElement.ts:25](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts#L25) `withThrowawayMedia` là nơi **duy nhất** định nghĩa "xong": [settle :39](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts#L39) clear watchdog → release → resolve, và [release :61](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts#L61) detach bốn handler trước rồi `pause()` / `srcObject = null` / `removeAttribute('src')` / `load()`. Handler đi trước vì `load()` không nguồn có báo error. Đúng cái luật `openMedia` đã giữ với Mediabunny ở [frameDecode.ts:69](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L69), nay tới nhánh DOM.)*
- *(**F5-2, 2026-11-05**: số đo trên Chromium 156 với **file thiệt** (`h264.mp4` 4448 byte, `sample-sfx-sweep.wav` 132 344 byte, cả hai HTTP 200), route `/tmcut/voice`, hai lô 12 + 12 chạy đồng thời. Lô **law**: **0/12** element còn giữ `src`, `readyState` về **0**, **0/12** watchdog fire sau 15 giây. Lô **pre-F5**: **12/12** còn giữ `src`, `readyState` **4**, **12/12** watchdog fire — in ra 12 lần resolve `TIMEOUT`. Một element lẻ: law trả lời lúc **7 ms** (`duration 0.6`, `videoWidth 64`) rồi release, `networkState` về **3** (`NETWORK_EMPTY`); pre-F5 đọc xong vẫn `networkState` **1** + `readyState` **4**, và **detach handler không làm nó release** — đó là lý do luật phải là một hàm chứ không phải một lời dặn. Watchdog cũng release: `timeoutMs = 250` resolve `null` lúc **252 ms**. `probeWebMetadata` vẫn trả `{0.6, 64, 36, fps 0, hasAudio false}` trên mp4 và `{1.5, hasAudio true}` trên wav; jpg vẫn `null` như trước. Console tám route `/tmcut*`: không dòng nào thuộc F5.)*
- *(**F5-3, 2026-11-05**: spec mới [tmcut_media_element.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_element.spec.ts) — 381 dòng, 9 check trên DOM giả, trong đó check "watchdog clear đúng id nó armed" đo bằng timer thật. RED **0/9** exit 1, đo bằng cách tạm dời helper sang `node_modules/.cache` rồi trả về **nguyên byte** (`md5sum -c` OK); GREEN **9/9** exit 0; suite **111/111**, smoke **114/114**, core `tsc` 0 (lượt này không chạm `packages/core`), lint **5** file exit 0 chạy sau gate types. `getMediaSize` ở [ffmpegHelper.ts:167](file:///D:/Applications/tm-studio/app/utils/ffmpegHelper.ts#L167) mang đúng hình dạng site thứ ba nhưng có **0** call site — không migrate hàm chết, ghi nợ slice I. Electron host chưa chạy lượt này. Xem §33 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F6a-1, 2026-11-05**: vị trí nguồn của một surface giờ **chỉ** core trả lời. `paintSurfaces` giữ một nhánh dự phòng: layer nào `sourceTicks === null` thì tự tính bằng `clipMediaTimeSec` của app — bản copy thứ hai của đúng luật `clip.in + local * speed` ([clipTime.ts:99](file:///D:/Applications/tm-studio/app/utils/tmcut/clipTime.ts#L99)). Với clip sống theo hình DSL (`timeline.{start,duration}`, không `source`, không `in` số — `clipSpan` nhận, `sourceRangeOf` từ chối ở [evaluate.mjs:55](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L55)), phép đó là `undefined + x` = NaN và `ticksToSec` gấp NaN về **0** ([time.mjs:18](file:///D:/Applications/tm-studio/packages/core/src/time.mjs#L18)) — đo được `mediaTimeSec = 0` ở playhead 1 s: element đỗ ở khung đầu nguồn và xin seek lại mỗi khung, đứng hình, không crash, nên không lại được chỗ nào.)*
- *(**F6a-1b, 2026-11-05**: [useTmcutPlayback.ts:144](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L144) bỏ slot không định vị được khỏi danh sách, [:156](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L156) chỉ còn `ticksToSec(slot.layer.sourceTicks)`, import `clipMediaTimeSec` rời file, và điều kiện `partner.layer.sourceTicks === null` trong `transitionCrossfade` rời theo vì chính danh sách surface bảo đảm nó [:198](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L198). DOM không đổi một dòng — nó đã luôn đọc `surface.mediaTimeSec` ([TmcutPreviewPlayer.vue:867](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L867)).)*
- *(**F6a-2, 2026-11-05**: spec mới [tmcut_surface_media_time.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_surface_media_time.spec.ts) — 156 dòng, 5 check, dựng đúng hình v3 qua store thật (`timeline.{start,duration}`, bỏ `in`/`out`). RED exit 1 fail ở check 2 (`['a.mp4']` vs `[]`), GREEN **5/5**; `tmcut_preview_paint_plan` **6/6**, `tmcut_surface_plate` **7/7**, `tmcut_speed_clock` **5/5**, `tmcut_paint_stack` **9/9**, không đổi assertion. Gate: types exit 0 / 0 `error TS`, lint **2** file exit 0 chạy sau gate 1 (lượt đầu FAIL `@stylistic/arrow-parens` — sửa code), suite **112/112**, smoke **115/115**, core `tsc` 0. Xem §34 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F6a-3, 2026-11-05**: live `/tmcut/editor` trên Chromium 156, :4003 — **51/51** mẫu `currentTime` hữu hạn, element `0.098 → 0.597` rồi seek sang clip hai `0.11 → 0.6`, không mẫu nào `0` giả mạo. Lượt đo đầu suýt ghi nhầm "playhead nhảy 0.74 s trong 105 ms": trường `ff` của timecode là **chỉ số khung hình theo rate canvas**, không phải phần trăm giây; đo lại kèm `performance.now()` thì 0.967 s → 1.1 s trong 105 ms, tức loop bám đúng. Hệ quả: **F6e vẫn mở** và chưa có án lệ mới. Chưa chứng minh: số project v3-thật đi qua cửa này, Electron host. Hàng audio vẫn giữ bản copy thứ hai ở [TmcutPreviewPlayer.vue:579](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L579) — nợ slice G.)*
- *(**F6e-1, 2026-11-05**: vế còn lại của slice F yêu cầu 6 — **host không được sở hữu vị trí**. Loop preview trả lời "playhead đứng đâu" bằng cách cộng dồn khoảng rAF: `const delta = (timestamp - lastTimestamp) / 1000` rồi `playhead.value + delta * shuttleRate.value`, và là **hai** bản copy (nhánh forward + nhánh reverse của J). Vị trí vì thế là một float của những khoảng máy giao (đo live 14–20 ms, ~68 Hz ⇒ 2.37 mẫu/khung 30 fps): preview xem đúng những chỗ mà `frameAt(i)` của core **không bao giờ sinh ra** — `scheduler.mjs` nói host chỉ được giữ WHEN, luật này app đang vi phạm. RED đo được **86/90** mẫu forward nằm **giữa hai frame** (first 1920 ticks, grid 4000).)*
- *(**F6e-2, 2026-11-05**: nhịp giờ là một **anchor** `(timestamp, frame, rate)` ở [useTmcutPlayback.ts:395](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L395) và một phép quy đổi ở [:410](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L410) — elapsed → ticks → `clock.frameIndexAt(elapsedTicks * abs(rate))` → `clock.frameStartAt(anchorFrame ± advanced)` → `ticksToSec`, **một** `const newTime` ở [:435](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L435) mà cả hai nhánh cùng đọc. `clock.frameStartAt` tự kẹp lùi ([clock.mjs:42](file:///D:/Applications/tm-studio/packages/core/src/clock.mjs#L42)) nên J không cần delta riêng: hai chiều đi trên cùng grid, chỉ khác dấu. Re-arm thay "set 0": `seek` [:270](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L270), `play` [:553](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L553), `pause` [:565](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L565), `shuttleBackward` [:618](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L618) và mọi đổi rate ở [:433](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L433) — một interval đã đi ở 1x không bị đi lại ở 8x.)*
- *(**F6e-3, 2026-11-05**: spec mới [tmcut_playback_pace.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_playback_pace.spec.ts) — 197 dòng, **6** check trên đồng hồ rAF giả một slot, đo playhead **bằng ticks**: mọi vị trí là frame start; 1 s wall = 1 s timeline ở 1x và 2 s sau `shuttleForward()`×3; đổi rate giữa chừng tính từ frame hiện tại; J lùi đúng 0.6 s trên cùng grid; scrub khi đang phát re-arm; và pin nguồn (hết `const delta = (timestamp - lastTimestamp)`, hết `playhead.value + delta`, có `clock.frameIndexAt` + `clock.frameStartAt`). Dung sai **một frame mỗi segment nhịp** — grid chỉ giải số frame nguyên, anchor là timestamp đầu loop được đưa; check 2–3 đi hai segment nên `2 * perFrame`. GREEN **6/6**; hàng xóm **9/9 / 5/5 / 10/10 / 5/5 / 6/6** không đổi assertion; suite **113/113**, smoke **116/116**, core `tsc` 0, lint **2** file exit 0 chạy sau gate types (lượt đầu FAIL `max-statements-per-line` + `no-unused-vars` — sửa code).)*
- *(**F6e-4, 2026-11-05**: live `/tmcut/editor`, :4003, project 1.1667 s = 35 khung @30 fps — forward **64 mẫu / 902 ms**, `00:00.00 → 00:00.26`, 27 timecode khác nhau, **paceRatio 1.0244**, **0** khung bị bỏ; reverse `00:01.05 → 00:00.21` = 0.4667 s trong 440 ms wall, **ratio 1.0606**, 0 violation; loop **213 mẫu / 3001 ms**, **2 lần wrap**; 2.37 mẫu cho mỗi lần timecode đổi. Chưa chứng minh: wrap đậu ngoài grid (re-arm từ vị trí đã bọc), Electron host, và điều "đúng là frame start" **không đọc được từ DOM** nên phần đó chỉ do unit proof giữ. Còn mở trong F: rAF riêng của `TmcutHtmlVideoStudio.vue` (**F6b** — đã đóng ngày 2026-11-05, xem F6b-1…F6b-4b ngay dưới), bốn chỗ tự hỏi "hàng nào" ở UI (**F6c** — đã đóng ngày 2026-11-05, xem F6c-1…F6c-3 ngay dưới), blend + grain trên plate live (**F6d** — đã đóng ngày 2026-11-05, xem F6d-1…F6d-4 ngay dưới). Xem §35 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F6b-1, 2026-11-05**: bản copy **thứ hai** của luật nhịp vẫn sống ở [TmcutHtmlVideoStudio.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue) — `const delta = lastFrameAt ? Math.min(0.25, (now - lastFrameAt) / 1000) : 0` rồi `previewTime.value + delta` — và nó đắt hơn vẻ ngoài: preview này **không phải video element**. Nó post `{ type: 'hf:seek', time }` sang tài liệu HTML/CSS trong iframe `sandbox="allow-scripts"`, còn job *Render MP4* repaint frame `i` tại `i / fps`. Nên mỗi thời gian giữa hai khung là một thời gian **file xuất ra không chứa**: người dùng xem một bức tranh mà bản render không bao giờ có. F6e đóng luật trong composable, tức luật vẫn còn **hai** chỗ; sửa nửa kia mà không nhắc nửa này là giữ lại đúng thứ slice F yêu cầu 6 cấm.)*
- *(**F6b-2, 2026-11-05**: nhịp dời xuống core — `createFramePace(clock)` ở [pace.mjs:84](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L84), export ở [index.mjs:4](file:///D:/Applications/tm-studio/packages/core/src/index.mjs#L4), kiểu ở [index.d.ts:2008](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L2008). Neo vẫn là `(timestamp, frame, rate)`; mỗi lần `at()` chỉ mua số **nguyên** khung ([pace.mjs:93](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L93)) và đặt xuống bằng `clock.frameStartAt` ([pace.mjs:61](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L61)) — vị trí luôn là **điểm bắt đầu khung**. Ba đường re-arm tại [pace.mjs:88](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L88): đổi rate, vị trí không do nhịp sinh ra, và `reset()` [pace.mjs:103](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L103); khoảng đã mang thì **tiêu**, không chi tiếp.)*
- *(**F6b-2b, 2026-11-05**: hai host giờ chỉ còn việc giao timestamp của rAF. Editor [useTmcutPlayback.ts:395](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L395) dựng nhịp một lần theo **danh tính clock** của scheduler và hỏi vị trí ở [:406](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L406) — hết 4 biến closure `anchorMs/anchorFrame/anchorRate/needsRearm` của F6e; re-arm gọi `resetPace()` ở `seek` [:270](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L270), `play` [:547](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L547), `pause` [:559](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L559), `shuttleBackward` [:612](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L612). Studio dựng `previewClock` + `previewPace` từ `fps` UI ([:95](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue#L95)) và `tick()` chỉ đọc frame từ nhịp ([Studio:215](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue#L215)). Module law giữ nguyên: host sở hữu WHEN, core sở hữu WHAT.)*
- *(**F6b-3, 2026-11-05**: chân scrub — thanh *Preview time* có `step="0.01"`, tức ~100 điểm dừng mỗi giây trong khi lưới 30 fps chỉ có 30 điểm hợp lệ; **đo live** trước khi sửa: kéo tới `0.37` → composition nhận đúng `0.37`, và `0.37 × 30 = 11.1` **không phải** một frame. Nay slider đi trên **chỉ số khung**: `:max="lastPreviewFrame"` ([studio:97](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue#L97) = `durationFrames − 1`), `step="1"`, `:value="currentPreviewFrame()"` ([:576](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue#L576)), mọi seek UI đi qua `seekFrame` ([:177](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue#L177)) rồi `showFrame` ([:183](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue#L183)); `@load` và `hf:ready` cũng re-seek bằng frame. Đọc số vẫn là giây. RED: check 8 fail ngay `doesNotMatch /step="0\\.01"/`, 7 check trước đã xanh; GREEN 8/8; live sau sửa: index 11 → echo `0.36666666666666664` = **11/30**.)*
- *(**F6b-4, 2026-11-05**: spec mới [tmcut_frame_pace.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_pace.spec.ts) — 152 dòng, **8** check (frame start mọi vị trí; đổi rate re-arm; vị trí ngoại lai re-arm; `reset()` disarm; reverse cùng lưới + kẹp 0; **jitter 5 ms cho cùng frame như một cú nhảy** ⇒ đo từ neo, không cộng dồn; **pin cả hai host** — `/createFramePace/`, hết `+ delta`, hết `const delta = …Last`, hết `elapsedTicks * Math.abs` ở app; scrub theo khung). `tmcut_playback_pace.spec.ts` check 6 **tiến hóa theo luật**: giữ hai phủ định cũ, thêm `/createFramePace/` và phủ định `/clock\\.(frameIndexAt|frameStartAt)/` — host không tự đếm, không tự đặt.)*
- *(**F6b-4b, 2026-11-05**: live, :4003. Studio (starter *Kinetic title*, 1080×1920, composition khai báo 4.00 s): play 1.2 s → **90 echo `hf:frame`, 0 mẫu ngoài lưới**, walk liên tục 11→46 = 36 khung trong ~1.17 s; scrub giờ là `min 0 / max 119 / step 1` và index 11 gửi đúng `0.36666666666666664`; wrap từ frame 117 cho `117,118,119,0,1,2,3,4,5` — tất cả trên lưới. Editor: forward 25 khung/882 ms **0 hồi lùi**, `L` 8→31 tăng đơn điệu, `J` 33→22 giảm đơn điệu. Án lệ mới cho mọi lượt probe sau: **tab background được Chromium trả đúng 1 rAF trong 600 ms** — phép thử đầu tiên báo "playhead đứng `00:00.00` suốt 900 ms" là **artifact của cách đo**, không phải regression (`visibilityState` vẫn `visible`, video element vẫn chạy). Chưa chứng minh: Electron host, `renderDuration` FALLBACK 5 s khi composition chưa báo `hf:ready`, fps đổi giữa lúc phát. Suite **117/117** + smoke, core `tsc` 0, lint exit 0 chạy sau gate types. Xem §36 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F6c-1, 2026-11-05**: F3 ghi nợ **ba** bộ lọc `type ===` (§30.7); grep lại `app/` theo mẫu predicate ra **bốn** chỗ, và chỗ thứ tư là chỗ duy nhất có lỗi thật. [TmcutTimeline.vue:750](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L750) dựng file `.srt` từ `.find(tr => tr.type === 'text')?.items` — tức **một** lane, mọi lane phụ đề phía sau biến mất, và `hidden` không hề được hỏi nên một lane đã tắt vẫn góp cue vào file mà không khung hình nào vẽ nó. Cùng hình dạng lỗi G18 ghi cho hàng footage: một surface thứ ba tự trả lời câu hỏi của surface thứ nhất. Ba chỗ còn lại: validation rotation của export ([:535](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutExportModal.vue#L535)), clip nguồn của AutoCaption ([:804](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L804)), cue fill của html-video studio ([:348](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutHtmlVideoStudio.vue#L348)).)*
- *(**F6c-2, 2026-11-05**: lượt này **không thêm luật nào** — bốn chỗ đọc câu trả lời đã có: `selectFileRows(project).overlays` (mọi lane phụ đề của cả file, đã trừ lane ẩn và lane chỉ có clip zero-length), `selectExportTracks(project).textTracks` (chính câu trả lời đó sau chỗ join mà compiler export dùng, nên validation kiểm **đúng lane file sẽ paint** thay vì đoán từ danh sách track), và `paintStackAt(project, atTicks).rows` (hàng footage **đang vẽ tại tick này** — clip được transcribe là clip người dùng đang thực sự thấy). Host vẫn chỉ cầm `trackIndex`/`clipId` nối về object mình authored. Ba chân đổi hành vi (SRT lấy mọi lane bật; studio hết nhận cue lane ẩn; export hết bị chặn bởi lane text không xuất hiện); một chân **chỉ đổi nguồn**: điều kiện `playhead ∈ [clipStartSec, clipEndSec)` của AutoCaption trùng luật per-tick nên đáp án như nhau — nói rõ để không ai tưởng F6c sửa bug ở đó.)*
- *(**F6c-3, 2026-11-05**: [tmcut_paint_stack.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts) 9 → **10** check; check 10 ([:337](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts#L337)) pin **hai chiều** trên ba component — phải gọi selector core, và **không** được còn predicate `x => x.type === 'video|text|audio'`. Template ternaries (`track.type === 'video' ? icon`) không bị cấm vì chúng là chrome, không phải luật hàng; đó là lý do mẫu pin là dạng arrow. RED: `EXIT=1` fail ngay pin đầu, 9 check trước đã xanh; GREEN **10/10**.)*
- *(**F6c-3b, 2026-11-05**: Copy đi theo luật: `captionsFilled` "from the text track" → "from the caption rows" (en+vi, **không stage** — `git diff --numstat` đo 19 thêm / 4 bớt mỗi file vì hai locale đang mang WIP của chủ repo; luật của repo là không commit WIP của người khác). Gate: typecheck 0, lint 4 file exit 0 (log 0 byte), suite **117/117** + smoke, core `tsc` 0, console sạch trên `/tmcut/editor` + `/tmcut/html-video`. Chưa đo thật: ba chân đổi hành vi (route html-video mở fresh có `currentProject === null` nên nút bị disable — hành vi **có trước**; SRT/AutoCaption là đường desktop-only; project dev không có text đã xoay và lượt này không sửa dữ liệu project của người dùng), và **chọn clip nào trong cửa transition** vẫn là quyết định chưa có test. Xem §37 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F6d-1, 2026-11-05**: §32.7 để lại **đúng hai** con số và §35.6 nhắc lại: blend vẫn đọc từ clip authored, plate grain là ảnh **tĩnh** trong khi file grain là `noise=allf=t` — mỗi khung một hạt mới. Blend được đưa xuống core vì một bất đối xứng: CSS bỏ qua tên lạ (hàng trông vẫn ổn), FFmpeg **lỗi lúc parse filtergraph** nên một giá trị bẩn giết **cả** render chứ không giết một clip. Luật mới [packages/core/src/blend.mjs](file:///D:/Applications/tm-studio/packages/core/src/blend.mjs) — `BLEND_MODES` 4 tên và `blendModeOf` chuẩn hóa (absent / không phải chuỗi / ngoài danh sách → `normal`) — và [evaluate.mjs:294](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L294) đặt kết quả lên layer, cùng chỗ `layerFor` đã sinh effects, mask, layout.)*
- *(**F6d-2, 2026-11-05**: ba chỗ đọc đổi nguồn và một chỗ đổi kiểu. Preview [TmcutPreviewPlayer.vue:834](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L834) chỉ còn `layer.blend` — hết một cast `as` trong đường paint; export [render/video.ts:329](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L329) đi `blendModeOf(clip.raw)` vào `blend=all_mode='…'`; inspector [:442](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutInspector.vue#L442) hiển thị **câu trả lời của core** thay vì quảng cáo một mode không counterpart nào vẽ; `TmcutBlendMode` thành alias của `CoreBlendMode` (không còn union thứ hai để lệch). Grain: builder tách `overlayMotion` (chuyển động của **chính** effect — plate chạy) khỏi `overlayAnimation` (tile: reveal **cộng** motion), [fxPreview.ts:834](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L834) là chỗ plate chọn; **không** mang `tmfx-compare` sang monitor vì một pha tan toàn màn hình sẽ bịa transition không ai authored.)*
- *(**F6d-3, 2026-11-05**: frame `tmfx-grain` dời từ tile sang [app/assets/css/tmcut-fx.css:12](file:///D:/Applications/tm-studio/app/assets/css/tmcut-fx.css#L12) do [main.css:9](file:///D:/Applications/tm-studio/app/assets/css/main.css#L9) import — plate nhận style **inline** nên nó cần keyframes sống cùng trang, không phụ thuộc chunk của tile; tile hết định nghĩa trùng (45 → 44 `@keyframes`), và số của frame đổi có lý do: `6px -4px` chỉ kín với cell 3px, còn `12px -12px` là bội số của **cả ba** cell 3/4/6 nên loop kín với mọi độ hạt — kể cả trạng thái đậu khi reduced-motion kẹp `animation-duration: 0.01ms` ([main.css:237](file:///D:/Applications/tm-studio/app/assets/css/main.css#L237)) giống hệt trạng thái đầu. `vhs` giữ motion ở tile vì nó **không** `layerOverlay` (set đúng ba tên: vignette, grain, letterbox).)*
- *(**F6d-4, 2026-11-05**: spec mới [tmcut_blend_grain.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_blend_grain.spec.ts) — 201 dòng, **8** check, pin **hai chiều** (preview phải đọc `layer.blend` và **không** được còn `(clip as { blend`), bắt plate grain chạy mà plate vignette/letterbox **không** chạy, và check 8 quét `EFFECT_REGISTRY` lấy các `layerOverlay` rồi đối chiếu tên với stylesheet mà `main.css` import — một frame chỉ có trong tile là **fail**, không phải pass. [tmcut_fx_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_preview.spec.ts) **không** thêm check: check 6 **tiến hóa theo luật** (24 như cũ) — tên đã có toàn app thì không được xuất hiện lại trong tile. RED = `SyntaxError: … does not provide an export named 'BLEND_MODES'`; GREEN đầu tiên **7/8** vì bug của **chính spec** (destructure mảng string), sửa spec chứ không nới assertion → 8/8.)*
- *(**F6d-4b, 2026-11-05**: live :4003, đi qua **handler thật của app** (`handleAddEffect('grain')`, `handleBlendUpdate('screen')`) rồi `undo()` ×2 để project dev về nguyên trạng. Sheet `main.css` có `tmfx-grain` `0%{0 0}100%{12px -12px}` (66 keyframes) còn sheet của tile (44) **không**; plate tính ra `animation-name: tmfx-grain` `1.1s linear infinite` với `background-position` **2.15474 → 5.97277 → 2.88303 px** qua 350/1150 ms, `playState: running`; group footage `mix-blend-mode: screen` trong khi `<video>` vẫn `normal` — blend áp cho **cả nhóm**, đúng như export composite nhóm rồi mới transform; surface `display: none` mang cùng plate nhưng `getAnimations()` rỗng nên hàng đang tắt không tốn frame; tile grain khi vào viewport vẫn chạy `"tmfx-compare, tmfx-grain"` (11.5371 → 4.99141 px/500 ms).)*
- *(**F6d-4c, 2026-11-05**: Chưa chứng minh: **không có pixel** (chưa render file nào; `blend=all_mode` mới ở tầng spec), chỉ `screen` được đo live, Electron host, reduced-motion chỉ suy từ stylesheet (`emulate` không có feature đó), và effect thuần chuyển động (`shake`, `rgb`, `slide-ghost`) vẫn chưa có mặt live vì plate chỉ tiêu `filter`/`transform`/`overlay`. Gate: typecheck 0, lint **12** file exit 0 (log 0 byte; lượt đầu FAIL 2 lỗi tự gây), suite **118/118** + smoke exit 0 — lượt áp chót **116/118** vì **hai gate docs của repo** bắt đúng lỗi của lượt này (một bullet 1398 ký tự → tách, một `||` trong ô bảng → `\|\|`; **không** nới trần nào), core `tsc` 0, console sạch trên `/tmcut/editor` + `/tmcut/html-video` + `/tmcut`. Xem §38 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F7-1, 2026-11-05**: text là bề mặt DOM **cuối cùng** còn tự đọc clip. `activeTextClips` đi qua đúng các slot overlay của plan, lấy clip authored rồi **vứt layer đi**, và [textOverlayStyle](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L889) dựng lại chữ ký cấu trúc **27 field** của clip ngay trong component để tự gọi `evalKeyframe` ×4 (x/y/scale/opacity), `textAnimationAt` và `clipDurationTicks({ in, out, speed })` — ba luật của core, bốn lời gọi trong DOM. Màu thì lệch **thật**: export [`clip.shadowColor || 'black'`](file:///D:/Applications/tm-studio/app/utils/tmcut/render/text.ts#L133) (alpha chỉ nhân `@…` khi clip < 100%, [:126](file:///D:/Applications/tm-studio/app/utils/tmcut/render/text.ts#L126)) còn DOM `textClip.shadowColor || 'rgba(0, 0, 0, 0.85)'` (85% luôn luôn). F7 **không** đổi default đó — một bên là filter string của project cũ mà golden spec đang khóa byte-identical, một bên là CSS đang render; đó là quyết định parity, ghi thành nợ §39.7. F7 đổi **nguồn của giá trị authored**: [`textOf`](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L203) nay trả [`shadowColor` / `strokeColor` / `bgColor`](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L216) lên layer, `null` khi không authored — core không bịa default.)*
- *(**F7-2, 2026-11-05**: composable trả [`TextSurface { clip, layer }`](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L25) — cùng quy ước "**layer theo reference**" mà `PaintSurface` dùng từ F2a — và [activeTextSurfaces](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L265) lọc `slot.kind === 'overlay'`, nối về clip bằng `clipId`. [Player:889](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L889) chỉ còn `layer.text` / `layer.transform` / `layer.opacity` / `layer.mask` + preview scale: **hết** `evalKeyframe`, **hết** `textAnimationAt`, **hết** `clipDurationTicks`, **hết** phép `/ 100` (scale đi qua `transform.scaleX/scaleY` vì core đã đổi `%` → hệ số; opacity là `layer.opacity * animation.opacity`). Template [v-for:2046](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L2046) bind `activeTextSurfaces`, và chữ được vẽ là [`surface.layer.text?.content`](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L2057).)*
- *(**F7-3, 2026-11-05**: spec mới [tmcut_text_layer.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_text_layer.spec.ts) — 158 dòng, **6** check: màu authored phải lên layer / không authored thì `null` (DOM không được bịa); composable đưa **đúng layer của plan** (so theo reference, không so cấu trúc); một keyframe `x` + `opacity` tới surface **qua layer** (`transform.x === 250`, `opacity === 0.5`); và pin nguồn hai chiều — body `textOverlayStyle` không còn ba hàm kể trên, template + composable không còn `activeTextClips`. RED thật là `layers[0].text.shadowColor` trả `undefined` trước khi core có field. Check 1–2 tác nghiệp qua `updateClip` (đường Inspector) vì whitelist của [addClipToTrack:855](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L855) không mang ba màu — **ghi thành nợ**, không sửa luật authoring nhân tiện.)*
- *(**F7-4, 2026-11-05**: live :4003 qua **control thật của UI** (`+ Add Text`, nút Shadow, nút Outline, `input[type=color]` → `#3aa0ff`), rồi undo ×4 trả workspace về "Untitled Project" 0 overlay — lượt QA không để project rác. Overlay có `font-size: 12.3594px` với caption authored 42 ⇒ preview scale `12.3594 / 42 = 0.294271`. DOM đo `text-shadow: rgba(0, 0, 0, 0.85) 0.882812px` và `-webkit-text-stroke: 0.588542px`; core nói `textShadowOffset(42) = 3` × scale = `0.882814` và `textStrokeWidth(42) = 2` × scale = `0.588543` — khớp tới mức CSS làm tròn. `color: rgb(58, 160, 255)` chảy qua layer, và `background` **không tồn tại** trong style vì `bgColor === null`.)*
- *(**F7-5, 2026-11-05**: Gate — typecheck exit 0 và 0 × `error TS` (`.nuxt/eslint.config.mjs` regenerate 3 lần, lint chạy lại sau mỗi lần), lint **8** file exit 0 (lượt đầu FAIL 4: ba import chết `textAnimationAt` / `TICKS_PER_SECOND` / `TmcutTextAnimationType` do refactor để lại + một biến spec không dùng — xoá code, không tắt rule), suite **119/119** + smoke exit 0; lượt đầu **118/119** vì guard [tmcut_text_style.spec.ts:129](file:///D:/Applications/tm-studio/tests/unit/tmcut_text_style.spec.ts#L129) pin nguyên văn `textClip.fontSize || DEFAULT_TEXT_FONT_SIZE` — hai phủ định literal giữ nguyên, pin mới thay tên cũ bằng `const text = layer.text`, **cùng ý định, không nới**. Core `tsc` 0 và `node --test packages/core/test/*.test.mjs` **679/679**. Console: `/tmcut` 0 lỗi, `/tmcut/editor` đúng baseline §31.5 (`401` ×4 = `GET /api/v1/ai/relay/catalog`). Chưa chứng minh: default màu vẫn lệch hai counterpart, pixel preview-vs-export cho nhiều layer (**F8**, #134), `TmcutFxThumb` cho caption chưa đo lại sau khi layer mang màu, Electron host. Xem §39 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F8-1, 2026-11-05**: fixture pixel **preview-dự-đoán-export** đầu tiên — [tmcut_preview_export_pixel_parity.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_export_pixel_parity.spec.ts). Mọi gate trước so hai host bằng từ vựng của từng host (row set vs expression `enable`, số DOM vs số layer); chưa gate nào hỏi câu người xem hỏi: **lấy đúng câu trả lời preview nhận ở từng khung, tự composite, có ra màu file thật chứa không**. Kỳ vọng là [`modelAt`:180](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_export_pixel_parity.spec.ts#L180): bắt đầu từ màu canvas, đi theo **slot order** của `compositePlan`, mỗi footage slot pha `plate × slot.layer.opacity` — không đọc field authored, không bảng màu tra theo frame index, không lấy gì từ render. Check 3 là guard **trên chính spec**: tách thân `modelAt` bằng regex và pin nó chỉ được đọc `compositePlan(evaluateTimeline` + `slot.layer.opacity`. Project 128×72 @30: `v1` xanh dương 0–3 s opaque, `v2` đỏ 1–3 s `opacity 50`, `v3` xanh lá 2–4 s **keyframed 0→100**, caption 1.5–2.5 s.)*
- *(**F8-2, 2026-11-05**: số đo (binary trong `resources/`) — **480** sample = 120 khung × 4 góc, lệch lớn nhất **5** trên trần `MODEL_TOL = 12`; kỳ vọng có **32** màu distinct trên 120 khung (30 khung ramp + 3 vùng phẳng); boundary gọi tên từng khung: 29 = xanh dương thuần, 30 = `mix(50 %)`, **60 = vẫn `mix(50 %)`** vì row mới vào ở opacity 0 (ADR-018 một chiều), 89 = ramp `29/30`, 90 = xanh lá thuần khi base đã kết thúc, 119 = xanh lá; caption ink ≥ 30 px trên **đúng 30** khung plan gọi và **0** px ở mọi khung khác.)*
- *(**F8-3, 2026-11-05**: fixture được làm hỏng hai lần trước khi được tin. Tráo `PLATE.b ↔ PLATE.c` → check 4 **FAIL** ở frame 30 (`got [125,52,107], want within 12 of [15,145,150]`). `slots.slice().reverse()` trong `modelAt` → check 2 sập còn **2** màu distinct, tức **thứ tự paint được đo thật** chứ không chỉ được nêu. Cả hai mutation đã revert; 6/6 PASS là chạy trên file ở trạng thái commit.)*
- *(**F8-4, 2026-11-05**: runner không được gọi một gate bị bỏ là PASS. Đo trước lượt này: `run-all.mts` quyết định từ `res.status === 0` nên trên host không FFmpeg nó in `PASS tmcut_render_parity.spec.ts` với tail **rỗng** rồi kết luận "119/119 specs passed" dù **0 pixel** được so. Luật mới ở [helpers/spec_status.ts:34](file:///D:/Applications/tm-studio/tests/unit/helpers/spec_status.ts#L34) phân biệt `SKIP` (bail, không measure gì) / `PARTIAL` (check chạy hết, **một gate bên trong** bị bỏ) / `PASS` / `FAIL` (outrank cả dòng SKIP); runner chỉ gọi nó ([run-all.mts:41](file:///D:/Applications/tm-studio/tests/unit/run-all.mts#L41)) và in summary qua `summarize` ([`:55`](file:///D:/Applications/tm-studio/tests/unit/run-all.mts#L55)) → `117/119 specs passed  (1 spec skipped, 1 spec partial)`, đo bằng hai spec probe tạm **đã xoá** ngay sau khi in. Guard [tmcut_runner_status.spec.ts:89](file:///D:/Applications/tm-studio/tests/unit/tmcut_runner_status.spec.ts#L89) liệt kê **9** spec có thể bail. Một chỗ sửa luôn vì đúng luật này: [tmcut_fx_catalog.spec.ts:201](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_catalog.spec.ts#L201) in `   SKIPPED: …` ở **cột 3** nên `specStatus` không thấy, gate xfade-name ẩn trong một chữ PASS; nay là `SKIP  the xfade-name gate: …` cột 0.)*
- *(**F8-5, 2026-11-05**: Gate — typecheck exit 0 / 0 × `error TS` (config regenerate 13:03), lint **6** file exit 0 (lượt 1 FAIL 1: `@stylistic/eol-last` trên spec mới — `--fix` đúng một file, chỉ thêm newline cuối), suite `--smoke` **122/122** exit 0, core `tsc` 0 và core tests **679/679**; live gate **N/A** vì lượt này chỉ chạm `tests/**`. Chưa chứng minh: kỳ vọng là màu phẳng ở 4 góc + ink, **không** phải cả khung — transform/crop/mask/effect nhiều layer vẫn chỉ có spec graph; transition chưa vào fixture vì export vẽ xfade bằng filter `xfade` chứ không bằng hai layer overlay (H/I trả lời); **yêu cầu 4 (`TmcutFxThumb`) và 8 (resource lifecycle + huỷ request stale) của slice F vẫn mở nên #103 chưa exit**; default màu §39.1 và whitelist `addClipToTrack` §39.7 còn nguyên. Xem §40 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F8-6, 2026-11-05**: ba ký tự Hán đã được commit vào giữa câu tiếng Việt của chính tài liệu (§28/§33 của audit), và **không gate nào báo** — line-length đếm ký tự, table-shape đếm dấu `|`, link/citation kiểm đường dẫn; không ai hỏi *loại* ký tự**. Guard mới [tmcut_doc_charset.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_doc_charset.spec.ts) quét **401** file `.md/.ts/.mts/.mjs/.json` trong `docs/**`, `packages/core/**`, `app/composables/**`, `app/utils/tmcut/**`, `tests/unit/**`, `i18n/locales/**` để tìm Hán/Kanji/Hangul/dấu câu CJK — không chạm Latin Extended Additional, nơi dấu thanh tiếng Việt sống. Đã làm hỏng có chủ đích trước khi sửa (RED: `pass 2 / fail 1` vì chính dòng ghi chú trích lại ba ký tự đó), và có falsification: chèn một ký tự Hán vào heading → `fail 1`, phục hồi byte-identical (md5 đầu/cuối khớp) → 3/3. Xem §40.9.)*
- *(**F9-1, 2026-11-05**: yêu cầu 4 của slice F — *"tile dùng Effect Definition + hành vi renderer, không CSS tự chế"* — đóng bằng cách đo **tuyên bố**, không đo mô tả. `preview.fidelity: 'exact'` là chữ biến thành badge WYSIWYG trên [TmcutFxThumb.vue:119](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutFxThumb.vue#L119), nhưng mặt CSS ở [fxPreview.ts:818](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L818) và mặt export ở [effects.mjs:521](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L521) chưa từng được đặt cạnh nhau. Đo: registry có **29** effect, **5** claim `exact`, **2** trong số đó sai — `sepia` và `negate`.)*
- *(**F9-2, 2026-11-05**: `sepia` — chín hệ số `colorchannelmixer` mà file chạy **chính là** nội suy identity → bảng W3C (rr = 1 − 0.607·t, rg = 0.769·t, …), tức `sepia(t)` tự nó đã là export; builder CSS lại cộng `saturate(1 + 0.25t)`, nên ở intensity 60 monitor nói `sepia(0.6) saturate(1.15)` trong khi file chỉ đổi ma trận — 15 % bão hòa bịa thêm. `negate` — param `alpha` chuyển file sang `negate=negate_alpha=1` ([effects.mjs:661](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L661)) và `invert()` không có mặt alpha để nói, nên claim cấp type không được nhân danh giá trị mặc định. Sửa hai chỗ: bỏ hàm thứ hai trong builder ([fxPreview.ts:313](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L313)), hạ negate xuống `approximate` ([effects.mjs:200](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L200)); hai test nêu claim cũ ([effects.test.mjs:255](file:///D:/Applications/tm-studio/packages/core/test/effects.test.mjs#L255), [tmcut_fx_preview.spec.ts:124](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_preview.spec.ts#L124)) sửa theo nhãn mới vì **claim sai**, không có assertion nào bị nới.)*
- *(**F9-3, 2026-11-05**: guard mới [tmcut_fx_exact.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_exact.spec.ts) — **7** check, mọi kỳ vọng lấy từ **chuỗi filter đã ship** chứ không từ mô tả, nên một rule chỉ chép lại builder sẽ còn xanh sau khi hai bên lệch. Check 1 pin tập claim `exact` == tập rule đã chứng minh (sàn ≥ 4) và liệt kê negate trong `NOT_EXACT` kèm lý do; check 2 giải `t` từ **cả chín** hệ số trên 8 giá trị intensity (kèm ngoài biên −20/140 và default) rồi đòi `effectCss` là **một** hàm; check 4 đọc axis default **từ registry** (mirror-h `horizontal`, mirror-v `vertical`) thay vì hardcode; check 5 so `h=ih*bar` với stop `%` của plate trên 9 giá trị size; check 6 quét **154** file trong `app/components/tmcut` + `app/utils/tmcut` + `app/composables` và đòi `fxPreview.ts` là nơi duy nhất viết từ vựng CSS của effect; check 7 đòi tile không chứa tên type nào có ngoặc kép. RED: `an exact claim moved without a rule here` (actual 5, expected 4, diff chỉ đích danh `+ 'negate'`). Falsification ba mutation, mỗi cái một run: gắn lại `saturate` → check 2 FAIL; `scale(-1,-1)` → `scale(-1,1)` → check 4 FAIL; và **sửa phía export** `size/100` → `size/90` → check 5 FAIL `bars at 12,12,88,88% vs export … h=ih*0.13` — cái cuối chứng minh rule đọc file thật. Ba mutation đều đã revert.)*
- *(**F9-4, 2026-11-05**: Gate 1–3 — typecheck exit 0 / 0 × `error TS` (config regenerate 13:40), lint **5** file exit 0 (lần đầu báo 1 lỗi `@stylistic/quote-props` trên object một key `negate` — sửa file, không sửa rule), `npx tsx tests/unit/run-all.mts --smoke` **123/123** specs exit 0 với **0** dòng `SKIP`/`PARTIAL`/`FAIL`, `npx tsc -p packages/core --noEmit` exit 0, core tests **679/679**. Phần trung thực của bằng chứng: chỉ check 1 được **nhìn thấy** sập trong run gốc (nó bail trước vòng sepia), divergence của sepia lấy từ phép đo §41.2 và được chứng minh là sẽ sập bằng mutation A.)*
- *(**F9-5, 2026-11-05**: Gate 4 live trên `:4003` — lượt này đổi một chuỗi CSS mà tile thật render nên không được xin miễn. Năm route `/tmcut`, `/tmcut/autocut`, `/tmcut/editor`, `/tmcut/templates`, `/tmcut/factory`: **0** `[warn]`/`[issue]`, chỉ có baseline `401` ×4/×2/×1 mà `list_network_requests` quy toàn bộ cho `GET /api/v1/ai/relay/catalog` (endpoint AI cần phiên, đã ghi ở §31.5). Thư viện Effects: **27** tile, **16** tile có lớp `filter` ≠ `none`; tile `Sepia` computed đúng `sepia(1)` và hover **không** badge, tile `Negate` computed `invert(1)` và hover ra **"Approximate preview"** — hai chiều của đúng một cơ chế ở [TmcutFxThumb.vue:119](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutFxThumb.vue#L119). Xem §41.6b. Còn mở: **yêu cầu 8 (resource lifecycle + huỷ request stale) là F10 (#136) — nên #103 chưa exit** *(dòng này nghỉ ở F10 dưới đây; #103 exit)*; các claim `approximate`/`illustrative` không pin 1-1 vì chúng tự nhận gần đúng, không có tuyên bố nào để phá. Xem §41 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**F10-1, 2026-11-05**: yêu cầu 8 của slice F — *"preview trả lại mọi tài nguyên nó lấy, và một request frame cũ bị hủy chứ không được paint"* — có nửa thứ hai từ D1 (§19: ask sau retire ask trước) và nửa decoder từ F5 (§33: element dùng một lần trả `Input` + watchdog trong `finally`). Cái không lượt nào nói là **một lần rời đi**: editor unmount thì ai revoke object URL, ai abort decode đang chạy, ai trả slot về ledger. Đo ở HEAD `0760990` bằng `git show HEAD:<file> | grep -c` cho từng chỗ spec mới đòi: `disposeFrameService` trong editor = **0**, `requestFrameBatch` trong composable = **0**, `pause()` trong `onUnmounted` của player = **0**, `cancelScan()` trong `onUnmounted` của autocut = **0**, `bitmap.close()` trong `readStill` = **0**, `release`/`clear` của ledger = **0**. Không có đường nào để kết thúc một phiên.)*
- *(**F10-2, 2026-11-05**: hai phương thức mới của `createFrameSlotLedger()` ở [frames.mjs:224](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L224)/[:231](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L231). `release(slot, token)` chỉ xóa khi **đúng token của người gọi** đang giữ slot — `forget(slot)` xóa vô điều kiện và ở đây vô điều kiện là **sai**, vì autocut hỏi lại chính các slot `thumb:<asset>#<index>` khi phân tích lại: một batch đã thua mà xóa theo tên sẽ đá chủ mới. `clear()` trả **số** slot gỡ được, để spec đòi chữ "hết" chứ không chỉ "không còn slot nào mình biết tên".)*
- *(**F10-3, 2026-11-05**: service dùng **thế hệ** chứ không dùng cờ `disposed`. `generation` ([frameStore.ts:113](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L113)) tăng mỗi lần dispose; task ghi `born` lúc khởi sinh và chặn `if (born !== generation) return null` trước khi mint URL ([:210](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L210)) — một decode kết thúc vào phiên trẻ hơn đã trả bytes về nhưng không được trả một URL mà không cache nào còn khả năng revoke. Cờ boolean sẽ biến dispose thành **tuyệt đối**: vào lại `/tmcut/editor` lần hai là hết frame, trong khi singleton cấp module cố ý dùng chung. `dispose()` ([:168](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L168)) là một hành động: tăng thế hệ, revoke hết `held`, abort hết task, xóa waiters, `ledger.clear()` ([:179](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L179)), trả về **số URL đã revoke** để spec đếm được.)*
- *(**F10-3b, 2026-11-05**: phần hỏi của service. `beginAsk()` ([:230](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L230)) là chỗ **duy nhất** định nghĩa cache-hit + slot token + cancellation, nên `request` và `requestBatch` ([:264](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L264)) không thể lệch nhau. `requestBatch` trả slot qua `finishBatchSlot` ([:154](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L154)) → `ledger.release(slot, token)` ([:161](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L161)): một batch giữ slot **tới khi nó có câu trả lời**, chứ không tới khi cả app đổi ý. Hai hàm module mới: `requestFrameBatch` ([:306](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L306)) và `disposeFrameService` ([:311](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L311)).)*
- *(**F10-4, 2026-11-05**: nối dây đúng năm chỗ — [useTmcutFrames.ts:66](file:///D:/Applications/tm-studio/app/composables/useTmcutFrames.ts#L66) hỏi **một batch** thay vì `requestFrame` từng khung, [editor.vue:108](file:///D:/Applications/tm-studio/app/pages/tmcut/editor.vue#L108) `disposeFrameService()`, [TmcutPreviewPlayer.vue:1411](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1411) `pause()`, [autocut.vue:572](file:///D:/Applications/tm-studio/app/pages/tmcut/autocut.vue#L572) `cancelScan()`, [mediaProbe.ts:175](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaProbe.ts#L175) `bitmap?.close?.()` trong `finally`. Không đặt dispose trong layout vì số đo này: **chỉ** `editor.vue` khai `layout: 'studio'`, các trang tmcut còn lại dùng `default` chung với cả app nên dispose ở đó giết frame service của một trang chưa hề rời đi; autocut cũng không cần dispose vì chỗ nó rò là **slot**, mà slot thì batch đã trả. `pause()` đứng riêng vì loop playhead tự nạp lại qua rAF — unmount mà không pause thì một playhead vô hình vẫn chạy đúng nhịp monitor.)*
- *(**F10-5, 2026-11-05**: spec mới [tmcut_resource_lifecycle.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_resource_lifecycle.spec.ts) — 368 dòng, **12** check, RED một lượt đo rồi GREEN (`request` sau dispose khi ledger chưa có `clear` → "undefined is not a function"). Ba nhóm tài nguyên: dispose revoke **cả 3** URL đang giữ (`dispose() === 3`, `cached()` rỗng, `trackedSlots()` = 0, `inFlight()` = 0), một decode đang chạy lúc dispose **không publish** (`created.length === 0`), và service **trả lời tiếp** sau dispose; hai nhóm slot: batch trả slot của nó, và batch **bị superseded** không đá chủ mới (`trackedSlots() === 2` giữa cuộc đua); còn lại là hình dạng nguồn — composable phải **không** còn `requestFrame(`, player unmount phải có `pause()`, autocut unmount phải có `cancelScan()`, `readStill` đóng bitmap đúng **một** lần khi getter `width` ném lỗi, và `/new (Shared)?Worker\s*\(/` không có kết quả nào trong `app/`. Check 7 viết lại vì một sai số trung thực: bản gốc đòi "bốn frame của riêng nó" và FAIL `3 !== 4` — `TMCUT_FRAME_MAX_CONCURRENT = 3` xếp frame thứ tư vào queue, nên con số đó là **nhịp của máy** chứ không phải luật của slot; assertion mới chỉ đòi những gì tất định (`signal.aborted === true`, `trackedSlots() === 2`, rồi 0).)*
- *(**F10-6, 2026-11-05**: falsification bốn mutation, bốn run, mỗi cái làm **đúng một** check sập — nên không check nào dư. Bỏ guard `born !== generation` → "and it is not published either" (`1 !== 0`); `ledger.release(slot, token)` → `ledger.forget(slot)` → "handing back its own slots leaves the newer batch owners in place" (`0 !== 2`) — cái này chứng minh token guard mua được gì; bỏ `ledger.clear()` → "no slot is still owned by the page that left" (`3 !== 0`); bỏ `bitmap?.close?.()` → "but the bitmap was allocated" (`0 !== 1`). Restore **byte-identical** (`sha256sum -c` OK: `frameStore.ts` `396d0fa9…`, `mediaProbe.ts` `fec94d84…`), spec chạy lại 12/12.)*
- *(**F10-7, 2026-11-05**: Gate 1–3 — typecheck exit 0 / 0 × `error TS` (config regenerate 14:22, 28581 B), lint **9** file exit 0, `run-all.mts --smoke` **124/124** exit 0, core `tsc` exit 0, core tests **679/679** (0 fail, 0 skipped); dòng grep `SKIP|PARTIAL|FAIL` duy nhất là chuỗi "0 FAILED" **trong** một dòng PASS. Gate 4 live trên `:4003`, năm route: 0 `[warn]`/`[issue]`, `401` đúng baseline ×4/×2/×1 của `GET /api/v1/ai/relay/catalog`, cộng ba phép đo của đúng lượt này bằng wrapper đếm callback rAF trong Chromium thật — ambient **0/giây**, đang phát **82/giây**, **+10** callback trong 2 s chuyển route rồi **0** trong 2 s tiếp theo ở `/tmcut` (loop đã chết); `fetch()` một URL `blob:` filmstrip vừa capture **thất bại** sau khi rời editor (đã revoke); rời rồi vào lại editor vẽ lại **16** dải `blob:` (dispose không giết singleton). Chưa chứng minh: **WebGL texture** là leg **rỗng** chứ không phải đã xử lý — `grep webgl2` trong `app/` trả 0, preview composite bằng lớp DOM/CSS; `VideoFrame` app không tự tạo (F5 giữ leg đó); unmount **giữa** một scene scan chưa đo live; host Electron, độ bền OPFS qua reload, số listener/ledger trong production build. **Yêu cầu 8 đóng** (§42.10 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md)) — hết nợ của slice F.)*
- *(**F10-8, 2026-11-05**: **slice F #103 exit**, theo phép đo **từng tiêu chí** ở §42.11 — brief của slice F ([execution brief:127](file:///D:/Applications/tm-studio/docs/tmcut-zero-ffmpeg-next-slices-agent-execution-brief.md#L127)) định nghĩa exit bằng **5 tiêu chí và 8 yêu cầu**, không bằng một tên công nghệ; cả tám yêu cầu đều có spec. Hai phần còn lại được **kể tên** chứ không bị gọi là xong: `shape` là trục yêu cầu 2 kê ra nhưng **layer type đó chưa tồn tại** (chủ là gap (d) của #90), và "responsive khi scrub" mới đo được **nhịp callback** (82/giây khi phát, 0 sau khi rời trang, 0 lỗi console) chứ chưa đo **khung rơi** trong một scrub dài. WebGL2 compositor thuộc một dòng khác của Phase 5 và leg đó đang **rỗng** (§42.9), không phải đã xử lý.)*
- *(**G1-1, 2026-11-05**: slice G mở bằng một phép đo thang, không bằng một tính năng. Luật waveform cũ chia 32768 vì thứ nuôi nó là pipe `-f s16le` của FFmpeg; thứ nuôi đường mới là `decodePcm` trả Float32 −1..1. Chạy cùng một tín hiệu — sine biên độ **0.35**, 8000 mẫu 8 kHz — qua cả hai hàm: luật cũ peak lớn nhất **1.068e-5**, luật mới **0.35**. Đó không phải "nhỏ hơn một chút" mà là một đường phẳng, và nó là lỗi một port naive sẽ mang sang browser nếu chỉ sửa caller. Hiện trạng ghi được trước lượt này: [tmcut.controller.cjs:429-443](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L429) **nhân bản** reducer trong controller, `:402-406` đọc cache bằng `Array.isArray(cached.buckets)` (artifact không algorithm), `:420-427` FFmpeg chết thì ghi **zeros và trả `ok:true`**. Xem §43.1 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**G1-2, 2026-11-05**: `floatPeakBuckets` ([waveform.mjs:69](file:///D:/Applications/tm-studio/packages/core/src/waveform.mjs#L69)) giữ nguyên phép chia bucket của `int16ToPeaks`, đổi đúng một điều: peak là magnitude full-scale. Kênh fold theo **kênh to nhất** — cùng luật `loudestPeakSeries` của E4 — nên test `[1.0, 0.0] → 1.0` giết cả trung bình (0.5) lẫn RMS (0.707); mẫu NaN bị **bỏ** chứ không đọc thành im lặng; kênh không được giao bị bỏ hẳn, không tính là kênh im. `int16ToPeaks` đứng nguyên: một test đòi hai hàm trả **cùng dãy** khi cùng biên độ vật lý. Bao ngoài là envelope có dấu: `buildWaveformPayload` / `readWaveformPayload` (`:114`, `:142`) với `algorithm: 'peak-v1'`, sáu trường, freeze, tròn 3 chữ số; `readWaveformPayload` từ chối algorithm lạ, `peaks` rỗng và `bucketCount` không khớp, nhưng **clamp** một vạch vượt 1. Ba trạng thái tách bạch: im lặng = zeros kèm `channelCount ≥ 1`, không có track = `channelCount: 0`, giải mã thất bại = **không ghi gì** (`buildWaveformPayload` trả `null`). §43.2–43.3.)*
- *(**G1-3, 2026-11-05**: trục key cho artifact — `a1b2c3d4-wave-v1` ([byteCache.mjs:24](file:///D:/Applications/tm-studio/packages/core/src/byteCache.mjs#L24): fingerprint + kind chữ thường + version `v[1-9][0-9]*`) và eviction cho artifact **sống nhờ nguồn** (`:147`), vì thư viện kê tên revision chứ không kê tên artifact; nếu hỏi `live.has(key)` trần thì mỗi lần mở lại dự án xoá sạch waveform vừa tạo. Cái bẫy đã tránh được có chủ đích: [frames.mjs:165](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L165) dùng `isByteCacheKey(fingerprint)` để hỏi "có phải một bản ghi hình không", mà key dẫn xuất thì **chứa** một fingerprint hợp lệ — nên `isByteCacheKey` giữ nghĩa nguồn, union là tên khác (`isStoredByteCacheKey`), và guard app pin cả hai chiều: `frameRequestKey('a1b2c3d4-wave-v1', …) === null` trong khi `frameRequestKey('a1b2c3d4', 1.5, 320) === 'a1b2c3d4-f1500-w320'`. §43.4–43.5.)*
- *(**G1-4, 2026-11-05**: TDD — hai file core chạy đỏ trước (`pass 0 / fail 2`, `SyntaxError: … does not provide an export named 'TMCUT_WAVEFORM_ALGORITHM'`) rồi mới viết luật; **35** check core (`17` waveform + `18` key/eviction, [waveform-float-peaks.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/waveform-float-peaks.test.mjs) và [byte-cache-derived-key.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/byte-cache-derived-key.test.mjs)) + **6** check app-level ([tmcut_waveform_law.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_waveform_law.spec.ts)). Falsification bốn mutation, mỗi cái một run, revert byte-identical (md5 `7651a0a8…` / `34bdb6ab…`): nới `isByteCacheKey` thành union → core `fail 4`; eviction bỏ vế nguồn → `fail 2` và spec fail `the artifact of a gone revision goes with it`; `floatPeakBuckets` chia 32768 → `fail 7`; `buildWaveformPayload` nhận `peaks: []` → `fail 1` và spec fail `a failed decode stores nothing`. §43.6.)*
- *(**G1-5, 2026-11-05**: Gate 1–3 — typecheck exit 0 / 0 `error TS` (config 15:25), lint **7** file chạm exit 0 (run đầu FAIL 5: `import/no-duplicates` ×2 vì tách import cũ/mới, `@stylistic/arrow-parens` ×1 — sửa file, không sửa rule), `run-all.mts --smoke` **125/125** exit 0 với **0** dòng `SKIP`/`PARTIAL`/`FAIL`, core tests **714/714** (`679` cũ + `35` mới), core `tsc` exit 0, `check-boundaries` PASS. Gate 4 live trên `:4003`: năm route **0** `[error]`/`[warn]`/`[issue]` (noise duy nhất `[info] <Suspense>`), và bằng chứng bundle — barrel `/_nuxt/utils/tmcut/waveform.ts` đang serve re-export **bảy** tên từ core, `waveform.mjs` served khớp **7** tên mới, `byteCache.mjs` served khớp **5**. Chưa chứng minh: **chưa ai gọi luật mới** — `floatPeakBuckets` chưa có call-site ngoài barrel, `readCachedBytes` chưa đọc artifact nào, nên **ADR-033 chưa có thêm bằng chứng**; envelope chưa ghi xuống OPFS/IDB; `controller.mjs:420-427` (zeros + `ok:true`) còn nguyên; `/tmcut/editor` sạch console nhưng dừng ở màn boot vì trình duyệt MCP không có phiên. Đó là việc của G2 (#138). §43.7–43.8.)*
- *(**G2-1, 2026-11-05**: G2 mở bằng một phép đo "ai đã gọi luật của G1". Trả lời: **không ai**. `git grep -n waveformCacheKey HEAD` = **0** kết quả toàn repo; `readCachedBytes` có **2** call-site (`frameStore.ts:196`, `autocutDetect.ts:106`) và **0** chỗ đọc một artifact — cả hai xin revision của file. Tệ hơn ở đúng cái cần thay: `loadWaveform` (HEAD `a33d745`, dòng 938-946) `fetch` một **file JSON do controller FFmpeg viết xuống server**, và **7** chỗ gate trên `asset.waveformPath` (6 trong composable + panel `:542`), mà trường đó chỉ desktop IPC điền — nên **web host chưa từng vẽ nổi một dải bar**. Xem §44.1 của [zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md).)*
- *(**G2-2, 2026-11-05**: [waveformService.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts) là file mới duy nhất (117 dòng) và đi theo đúng hình hài D2/E4: hỏi artifact theo key của G1 ([:63](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts#L63)) → hỏi **bytes của revision** ([:73](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts#L73)) → decoder chỉ nhận `src` khi máy không giữ bản nào ([:75](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts#L75)) → reduction ở core → ghi artifact ([:96](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts#L96)). **Bốn lời từ chối** đứng riêng: không fingerprint (`:101`), `durationSec` không hợp lệ (`:104`), decoder trả `null` **hoặc** không kênh nào (`:82`), `buildWaveformPayload` trả `null` (`:90`). Vế giữa là chỗ bug controller chết: [tmcut.controller.cjs:420-427](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L420) ghi **toàn zeros kèm `ok:true`**, nên lần đọc sau tin là thành công — ở đây **không có gì được ghi**, nên lần hỏi sau hỏi lại thật. §44.2.)*
- *(**G2-3, 2026-11-05**: hai quyết định có chủ đích. (a) `decode` là **tham số** chứ không import trong lòng luật, vì PCM cần WebCodecs mà Node không có — muốn đo "cái gì được cache, cái gì bị gộp, cái gì bị từ chối" thì phải dựng service không có decoder; đúng 1 dòng nối dây ở [useTmcutMedia.ts:116](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L116). (b) `liveKeys` **bắt buộc** và là câu trả lời của cả thư viện ([:107](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L107)): mỗi lần ghi chạy luôn luật eviction, nên một service đưa tập hẹp hơn sẽ **xóa chính cache nó đang viết**; service tự thêm fingerprint nó đang phục vụ vào tập đó ([:95](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts#L95)). Gộp người hỏi (`jobs` map, :106-113) tồn tại vì một phép đo thật: panel duyệt danh sách và clip mount **trong cùng một tick**.)*
- *(**G2-4, 2026-11-05**: defect A — **index ghi theo snapshot**. Cache client tồn tại từ C2b nhưng **chưa từng có hai caller chồng nhau**; leg waveform là leg đầu tiên vừa đọc artifact vừa ghi revision trong một lượt, và nó lộ ra ngay: một file OPFS nằm trên máy mà index **không kê tên** — không ai đọc được, lần reconcile kế tiếp giải phóng. Cơ chế: `readCachedBytes` mở `index = readIndex()` **trước** khi `await getFile()` rồi `writeIndex(index)` **sau**; writer xen giữa mang snapshot của nó đè lên. Sửa: [touchIndexRow :165](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L165) / [forgetIndexRow :172](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L172) — mỗi lần sửa **một row**, đọc index lại ngay lúc sửa, không hàm nào trả snapshot cho caller mang theo. Check 'the index is written one row at a time, never as a snapshot' ([tmcut_byte_cache.spec.ts:213](file:///D:/Applications/tm-studio/tests/unit/tmcut_byte_cache.spec.ts#L213)) chạy **đỏ** (`undefined !== 600`) trước khi có luật mới. §44.3.)*
- *(**G2-5, 2026-11-05**: defect B — **OPFS cắt ngắn file ngay khi mở writable**. Triệu chứng đo live: hàng cache trong panel báo `bytes: 0` cho một asset 48 KB thật. Sửa hai vế: row chỉ được **kê sau khi bytes nằm xuống** ([byteStore.ts:310](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L310)), và reader **từ chối file rỗng** ([:336](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L336)) thay vì vẽ nó như hàng có sẵn. Một quyết định rút lại có ghi lại: bản đầu còn `deleteStored` trong đường đọc — trong thế giới có write đang bay thì đó là **xóa bytes của người khác**, nên reader giờ chỉ *quên row* và để riêng `pruneByteCache` quyết định giải phóng. Phía test, fake OPFS được làm **giống browser** thay vì dễ kiểm soát: cắt ngắn khi `createWritable()` ([helper :54](file:///D:/Applications/tm-studio/tests/unit/helpers/tmcut_browser_storage.ts#L54)) và `installOpfs(quota, { holdReadsFor, holdWritesFor })` ([:135](file:///D:/Applications/tm-studio/tests/unit/helpers/tmcut_browser_storage.ts#L135)) cho phép **xếp lịch** cuộc chồng nhau, không trông chờ timing.)*
- *(**G2-6, 2026-11-05**: nối dây năm chỗ và retire **một đường đọc**, không retire **một trường**. `loadWaveform` qua service và `waveformCache` key theo **fingerprint** chứ không theo tên file server ([:964](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L964)); "Clear cache" xóa luôn hàng nhớ ([:133](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L133)) vì nó chỉ là convenience over store; re-check thấy revision đổi thì quên hàng của revision cũ ([:832](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L832)); relink quên theo **fingerprint cũ** chứ không theo `oldWaveformPath` ([:898](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L898)), artifact cũ do prune giải phóng vì thư viện không còn kê nó; panel ([:545](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutMediaPanel.vue#L545)) và clip ([:210](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimelineClip.vue#L210)) **bỏ cổng** `asset.waveformPath`. Nhánh audio của re-check cũng bỏ luôn `void analyzeAsset(...)`: trước đây nó null pointer **và** xếp một vòng IPC để FFmpeg viết lại JSON; bar giờ là câu trả lời của browser nên pointer cũ chỉ là đường dẫn chết. `asset.waveformPath` vẫn còn trong schema và desktop IPC vẫn ghi nó (`:463`) — chưa có quyết định migrate, ghi rõ là nợ.)*
- *(**G2-7, 2026-11-05**: **bằng chứng ADR-033** mà C2b còn thiếu. Chromium, web runtime `:4003`, import một WAV tự tổng hợp (duy nhất để không dính dedupe của `importWebFiles`), rồi **tải lại trang**: index vẫn đúng `{ adfcda50: 48044, adfcda50-wave-v1: 1302 }`; `accessedAt` của **artifact** tiến 1793871451863 → **1793871506846** trong khi `accessedAt` của **revision** đứng nguyên ở 1793871451762; resource entries kết thúc `.wav` = **0** (không một request nào tới `/uploads/` cho audio); dải bar vẫn vẽ **200** shape; panel nói `48.2 KB · 2 file`. Hai hàng giữa là cả luận điểm: **reload đọc artifact mà không đọc file**. §18 (đo 2026-11-04) còn ghi "bytes trong máy là bytes **được giữ**, chưa phải bytes **được dùng**" — với leg waveform, vế sau đã đổi.)*
- *(**G2-8, 2026-11-05**: falsification **bốn mutation / bốn run**, restore byte-identical (`af66537f…` service, `75789f38…` byteStore), hai spec chạy lại xanh (28/28, 11/11). Bỏ đường đọc artifact → fail `a cached waveform is read instead of decoded`; bỏ gộp job → fail `a panel and a timeline clip cost one decode` (`2 !== 1`); reader ghi cả snapshot (đúng hình hài HEAD) → fail `and the index still names them` (`undefined !== 600`); kê row trước khi bytes landing **và** reader tin file rỗng → fail `and an empty file answers nothing`. Sai số phải ghi lại: **từng vế một của mutation cuối thì không sập** — hai guard **che lẫn nhau**, check chỉ sập khi thiếu **cả hai**, tức đúng cái đã ship; nên nó pin *tổ hợp*, không chứng minh từng guard là riêng biệt cần thiết. §44.6.)*
- *(**G2-9, 2026-11-05**: Gate — typecheck exit 0 / 0 `error TS` (config 16:34, 28581 B), lint **7** file chạm exit 0 chạy **sau** 16:34, `run-all.mts --smoke` **126/126** exit 0 (125 của G1 + `tmcut_waveform_service` mới), core **717/717** (+3 check `waveformCacheKey`) và core `tsc` exit 0; dọn **0** bản `g2-` còn lại trong `.data/uploads`, library/index/OPFS trình duyệt đã xóa. Chưa chứng minh: desktop controller `:420-427` / `:402-406` còn nguyên (I/J), `asset.waveformPath` chưa retire, `clampWaveformPoints` không còn call-site nào trong `app/**` (1 kết quả, và đó là dòng re-export), chỉ đo trên **web runtime** (Electron OPFS packaged + IndexedDB fallback chưa đo; defect B là OPFS-specific nên đường IDB không có số đo concurrent), **playhead audio chưa có gì** (mixer/gain thuộc G3 #139, gap/overlap/sync/trim/rate + close-out ADR-033 thuộc G4 #140), và console live còn đúng một `[error]` **môi trường**: `401 /api/v1/ai/relay/catalog` do [catalog.get.ts:11](file:///D:/Applications/tm-studio/server/api/v1/ai/relay/catalog.get.ts#L11) tự chặn khi `event.context.auth` vắng — pre-existing, không phải của lượt này. §44.7–44.8.)*
- Tạo golden-frame tests. *(**xong — slice #91, 2026-11-03**: [tmcut_golden_frame.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_golden_frame.spec.ts) giờ là cổng 4 chân bằng FFmpeg thật — nền màu, hai still tự tác giả giải mã **chính xác từng byte**, rồi hai still render ra mp4 so với khung mong đợi và với nhau; core [pixels.mjs:89](file:///D:/Applications/tm-studio/packages/core/src/pixels.mjs#L89) thêm `mask` để band quanh cạnh bị loại khỏi trung bình/đếm/tỉ lệ thay vì cả khung được nới. Chân **text** vẫn chờ pin font (ADR-025), chân **shape** chờ loại layer mới (gap (d) của #90) — xem block "Trạng thái #91" cuối phase này.)*

**Acceptance criteria:**

- Render được composition mẫu ở timestamp tùy chọn.
- Kết quả không phụ thuộc wall-clock.
- Seek đến timestamp bất kỳ trong composition.
- Không dùng `sleep()` làm cơ chế frame timing.

**Trạng thái #86 — frame scheduler đã xong, và tiêu chí "không phụ thuộc wall-clock" giờ có chỗ đo được (2026-11-03):**

- [scheduler.mjs](file:///D:/Applications/tm-studio/packages/core/src/scheduler.mjs) lật câu hỏi của một loop đếm thời gian: một **index** là một **vị trí** (`clock.frameStartAt(i)`), và nội dung ở vị trí đó là `evaluateTimeline(input, startTicks)`. `createFrameScheduler(input, { rate })` trả `{ clock, fps, ticksPerFrame, endTicks, frameCount, indexOf, frameAt, frames }`, tất cả `Object.freeze`; đếm, thứ tự và nội dung chỉ đến từ project + framerate, không từ đồng hồ hệ thống.
- Module này dùng được cả hai hình clip đang tồn tại (`timeline` DSL v3 và model phẳng `offset` + `in`/`out`/`speed` của store app), nên editor và project core-native schedule **giống nhau từng byte** — có một test riêng chứng minh điều đó, và đó cũng là lý do scheduler tự tính span thay gọi `totalDurationTicks` (hàm đó chỉ hiểu hình v3).
- Ba bất biến acceptance, mỗi cái một test: `frames` là **nửa mở** và **clamped** nên không index nào outside; `frameAt(last).startTicks` trùng `renderAt` (`snapToFrame: false`) của ADR-018 (frame cuối đậu đúng chỗ render, không phải một răng sau đó); `indexOf` của một vị trí giữa hai frame luôn trả frame chứa nó. Project rỗng → `frameCount = 0` → mọi index là `null`, tức transport không dịch playhead.
- App nối dây ở [useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts): `seekToFrame(index)` lấy frame **từ plan** rồi `seek(ticksToSec(frame.startTicks))`, `stepFrame(delta)` là số học index. Alt+← / Alt+→ ở [TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue) là đường frame; mũi tên thường vẫn lùi/tiến theo giây (giữ nguyên hành vi cũ, không đổi nút nào).
- [tmcut_frame_scheduler.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_scheduler.spec.ts) là **10** check trên store + composable **thật** (không phải đọc chuỗi nguồn thuần): 60 frame cho 2 s rồi 90 frame sau khi nối clip; index 37 đậu đúng `frameAt(37)`; cùng một index trả **giống hệt** khi replay sau các seek khác; `stepFrame` làm tròn lại một playhead đang giữa frame (+0.001 s bị bỏ); 29.97 step trên đúng **4004** ticks/frame; và một check rằng thân `seekToFrame` **không** tham chiếu `timestamp`/`delta`/`lastTimestamp`/`Date.now`.
- Đỏ-test: **2** mutation trên `scheduler.mjs` (jitter mỗi lần gọi `frameAt`, và offset của evaluation) — cái thứ nhất giết đúng hai assert determinism của core (`not ok 3`, `not ok 5`), cái thứ hai giết đúng assert parity của app spec; file restore **byte-identical** (md5 `141d6e4b7295a127cafa63d7ad11a8f5`).
- Số gate của slice: core **523/523** (`fail 0`), `check-boundaries` **PASS**, core `tsc` **exit 0**, unit **83/85** exit 1 với **đúng hai** fail WIP owner (`tmcut_docs_link_integrity` vì `docs/user-guide.md` bị xoá trong working tree, `tmcut_login_remember` vì `app/pages/login.vue` bản working tree lại ghi plaintext password — slice này không đụng hai file đó), `nuxt typecheck` **exit 0 / 0 `error TS`**, ESLint **0** problem trên **8** file chạm, chạy **sau** khi `.nuxt/eslint.config.mjs` sinh lại (mtime `09:41:07`, không regenerate sau đó).
- Live trên dev server `:4003` (bằng chứng bundle, không phải DOM): module scheduler đang serve, sau khi strip comment, chứa **0** token wall-clock (`Date.now`/`performance.now`/`setTimeout`/`setInterval`/`requestAnimationFrame`/`new Date`) — hai token mà grep thô thấy chỉ là chữ trong khối comment đầu file; composable đang serve gọi thật `frameScheduler.value.frameAt(index)` và khai báo `function stepFrame`; player đang serve có `altKey) stepFrame(-1)` **kèm** `else stepBackward(e.shiftKey ? 5 : 1)`; modal đang serve chứa `frameStep` **3** lần; `i18n/locales/vi.json` đang serve chứa "Lùi / Tiến 1 khung hình".
- **Chưa chứng minh:** một cú bấm Alt+Arrow trong browser thật và thời gian trên HUD nhảy đúng **1/30 s**. `/tmcut/editor` nằm sau [auth.global.ts](file:///D:/Applications/tm-studio/app/middleware/auth.global.ts) (chỉ `/login`, `/register` là public): trình duyệt MCP không có phiên nên redirect `/login?redirect=/tmcut/editor`, và cửa sổ Electron của user đang ở Home — không điều hướng cửa sổ user đang dùng, không mở cửa sổ editor thứ hai (hai instance `useTmcutProject` cùng ghi một key localStorage), và không đụng credentials của họ.
- **Rút lại một câu của #84:** cổng CDP **không** gắn với app. Đo hôm nay: `:9222` = "Home - TMCut Studio" ở `:4003`, `:9223` = dashboard tm-tools ở `:4002` — ngược với câu "CDP của chính app tm-studio là `:9223`". Hai cổng chia nhau theo **thứ tự khởi động** `dev:electron`, nên muốn đọc renderer của app nào phải đọc `/json/list` của **cả hai** cổng rồi so URL, đừng đoán từ số cổng.
- Item (1) vẫn mở theo **nghĩa tên gọi**: `evaluateTimeline` đã là "render tại một vị trí" và #87 đã lấy đi phần export **tự suy lại** cửa sổ chữ, nhưng chưa có API công khai nào **tên** `renderAt`. Item (5) đóng bằng slice ngay dưới. *(#89: item (1) cũng đóng — API công khai tên `renderAt` đã có và preview đọc từ nó; xem `Trạng thái #89` bên dưới.)*

**Trạng thái #87 — preview và export trả lời "cái gì trên màn hình" từ cùng một rule (2026-11-03):**

- Câu chuyện không phải "thêm API mới" mà là **hai chỗ cùng quyết định một việc**: preview hỏi `evaluateTimeline` (đi **mọi** track, `visible = track?.hidden !== true && opacity > 0`), còn export hỏi chính nó bằng `.find()` — row video **đầu**, row text **đầu**, và `hidden` **không** nằm trong từ điển. Nên project hai row chữ **im lặng mất** row thứ hai, và project một row đã tắt **vẫn vẽ** vào file thứ preview đang ẩn.
- `selectExportTracks(project)` ([render/clip.ts:160](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts#L160)) là **join**, không còn là quyết định: từ **F3** luật "hàng nào vào file" sống ở core — `selectFileRows` ([paintStack.mjs:140](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L140)) — và selector chỉ map `{ trackId, trackIndex }` của core về track mà app đã tác giả. `videoBase` = row footage **đầu tiên còn hiện** và **có clip span sống**, `textTracks` = **mọi** row chữ còn hiện, `extraVideoTracks` = những row footage cùng hiện **bên trên** `videoBase` — từ #95 graph composite chúng thành chồng hình, `videoBase` là **đáy**, `audioTracks` = **mọi** row audio. Compiler chỉ còn đọc selector ([render/index.ts:45](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts#L45)), không còn `.find()` nào nữa. *(Bản #88 ghi "và có nội dung" — từ F3 chữ đó là `clipSpan(clip).duration > 0` của core, không phải `!!item.src` của app; xem §30 của audit.)*
- **Audio giữ luật riêng, có chủ đích và có check:** `hidden` là quyết định **hình ảnh**, `muted` là quyết định **âm thanh**; một row audio không có hình để ẩn nên vẫn mix vào file. Đây là chỗ **không** "đồng bộ" theo nghĩa mù quáng, và nó được viết thành một check để lần sau không ai sửa thành mất tiếng.
- Lớp lệch thứ hai nằm trong **chính cửa sổ chữ**: [render/text.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/text.ts) tự tính `(out - in) / speed` bằng float, trong khi core làm tròn span ra **ticks nguyên**. Caption 1 s ở **1.1x**: float **0.9090909090909091 s**, core **109091** ticks = **0.9090916666666666 s** — lệch **0.758 µs**, tức đúng lớp ADR-018 đã phải chốt bằng pixel, và nó còn chảy vào `d=` của plate mask lẫn `tpad`. Export giờ nhận `durationSec` từ canonical view; float chỉ còn là fallback cho overlay dựng tay.
- **Extent cũng là một phần của "cùng màn hình":** hai row footage cùng hiện từng cho file **dài bằng row đầu**, nên nửa sau timeline biến mất không lời giải thích. Nay row bên trên vừa **chặn độ dài file** ([render/index.ts:73](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts#L73)) vừa được **overlay** lên row đáy — bus nối đuôi tới hết row trên cùng rồi về đúng lưới frame (#95) — đo: row 2 s + row 8 s cho `duration` **8 s**, và `contentDuration` của store (thứ preview + estimate dùng) không còn là câu trả lời thứ hai.
- **Witness là chuỗi FFmpeg, không phải list nội bộ:** [tmcut_export_track_parity.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_track_parity.spec.ts) **11** check parse `-filter_complex` để đọc cửa `enable` (cap `gte(t,X)` rồi `lt(t,Y)`) và danh sách input từ `args`, vì một hàm chọn track có thể tự khớp với chính nó và vẫn lệch command line. Check nặng nhất đi **từng frame** của `createFrameScheduler`: project 1 row video + 3 row chữ (0–2, 1–3, 3–4 s) lên kế hoạch **120** frame, file có **3** cửa, và **120/120** frame có tập caption của evaluator **bằng** tập cửa sổ của file.
- Đỏ-test bằng **2** mutation trên **2** lớp khác nhau (restore **byte-identical**, md5 `clip.ts` `26a47e380caf2c6899e20770276a6a8d`, `text.ts` `43774e3a00a65dddb1891ed1dd89d634`): bỏ qua `hidden` làm fail ngay check thứ hai với evidence `[["A",0,2],["B",1,3]]`; bỏ `durationSec` làm fail **đúng** check "tick for tick" với `+ 0.9090909090909091`.
- UI nói **đúng** cái còn thiếu: banner ở [TmcutExportModal.vue:407](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutExportModal.vue#L407) đọc `extraVideoTracks.length` thay vì tự đếm lại, và copy `tmcut.export.parallelTracksWarning` được viết lại **trong cả hai locale** (en + vi, cùng slice) để chỉ còn nói về **row video song song** — vì từ slice này row chữ thứ hai **có** vào file, nên câu "chỉ render track đầu mỗi loại" đã thành nói sai. *(#88: câu đó sửa**một nửa** — copy mới của #87 vẫn hứa "hình row thứ hai chỉ có ở preview", và preview cũng không composite. Xem `Trạng thái #88` bên dưới.)*
- **Chưa composite hai row footage = G18** ([v4-phase-0-audit.md](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md)), không phải việc dở của slice này: `compileVideoPipeline` dựng **một** concat chain, nên thêm row footage cần thiết kế overlay (thứ tự layer, blend, opacity giữa hai chain) rồi verify bằng FFmpeg thật + pixel. Slice này khép **rule chọn track**, vì đó là thứ khiến warning và file không nói cùng một chuyện.
- Số gate: `nuxt typecheck` **exit 0 / 0** `error TS`; ESLint chạy **sau** khi `.nuxt/eslint.config.mjs` sinh lại (mtime `10:23`) → **0** problem trên **6** file chạm; unit **84/86** với **đúng hai** fail WIP owner, tổng specs **85 → 86**; live `:4003` là **bằng chứng bundle** (`selectExportTracks`, `extraVideoClips`, `overlayDurationSec`, modal import selector, hai locale chứa copy mới) — **chưa** phải DOM, vì `/tmcut/*` vẫn sau `auth.global.ts` như ghi ở #86.

**Trạng thái #88 — một rule chọn row footage cho cả preview lẫn export, và copy nói đúng điều xảy ra (2026-11-03):**

- Slice này **mở** bằng một giả định sai: "còn lại là cho export composite hai row footage". Đo trước khi sửa: preview **cũng** chỉ có **một** phần tử `<video>` mang footage, nên row thứ hai không có hình ở **bất kỳ** đâu — G18 vì vậy là **thiếu compositor** (Phase 3), không phải thiếu rule. Ghi lại ở §5 G18 và §8.3 của [v4-phase-0-audit.md](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md); câu #87 viết "row thứ hai còn có hình ở preview" bị **rút lại** ở đó và ở chính copy shipped.
- Chỗ lệch thật nằm ở **hai chỗ vẫn tự hỏi câu hỏi của riêng mình**: `transitionCrossfade` và `posterUrl` cùng dùng `.find(type === 'video')` — hàng **đầu tiên**, bất kể user đã tắt nó — trong khi `activeVideoClip` đã biết bỏ hàng ẩn. Hệ quả đo được: một row bị ẩn vẫn điều khiển phần tử `<video>` thứ hai, còn row **đang thực sự vẽ** thì **không crossfade được chút nào**.
- Fix: `footageRow` ([useTmcutPlayback.ts:112](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L112)) là **câu trả lời duy nhất** cho "row nào đang vẽ" — hàng video **đang hiện** đầu tiên có layer sống ở vị trí render — và cả `transitionCrossfade` (:133) lẫn `activeVideoClip` (:158) đọc từ nó; poster của modal export đọc `selectExportTracks(...).videoBase` ([TmcutExportModal.vue:391](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutExportModal.vue#L391)) đúng như compiler. Luật preview giờ **trùng** luật của file.
- Copy `tmcut.export.parallelTracksWarning` **được sửa cả hai locale**: bản #87 hứa "hình của row thứ hai chỉ có ở preview", user tin vào đó rồi nhận file không có hình. Câu mới nói thẳng **chỉ row footage đang hiện trên cùng có hình, cả ở preview lẫn khi xuất file**. Check 6 của guard chạy regex trên **cả hai** file locale, nên một bản dịch khác nhưng vẫn nói sai sẽ đỏ.
- Guard [tmcut_footage_row_rule.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_footage_row_rule.spec.ts) **7** check đi qua **store + composable + compiler thật** (không phải đọc chuỗi nguồn): hai row footage, một cửa sổ transition 0,5 s đặt trên row **bị ẩn** thì không được tới canvas; đặt trên row **đang vẽ** thì crossfade đúng hai clip của row đó; và modal không được tự chọn row cho poster.
- Đỏ-test **3** mutation trên **3** lớp khác nhau (restore **byte-identical**, sha256/16: `useTmcutPlayback.ts` `cb2ff4903ec29b90`, `TmcutExportModal.vue` `577dd7d4a67abf9d`, `en.json` `8c1c25d8183eede9`): bỏ `evaluation.hidden` khỏi `footageRow` → còn **1/7** (`the preview follows the hide`); đưa `posterUrl` về `.find(...)` → **6/7** (`the modal must not pick a footage row by itself`); đổi copy về câu "preview-only" → **5/7** (`en: the second footage row is not in the preview either`).
- **7** chỗ trích dẫn line-number trong docs trỏ vào file mà slice này chạm tới đã được đánh lại số (**14** lần thay vì mỗi chỗ có cả dạng `:L` trong prose lẫn `#L` trong link; code shift ~20 dòng ở `useTmcutPlayback.ts`, ~5 ở `TmcutExportModal.vue`), kèm **hai** chỗ sửa vì **stale từ trước slice này**: `activeTextClips` từng ghi `:156` (đúng là `:191`) và citation "modal đọc capability" từng ghi `:650` (đúng là `:224`, `isDesktop`). Guard liên kết chỉ bắt neo **ngoài phạm vi** — một neo sai nhưng còn trong file thì nó im — nên đây là việc sửa tay có ghi lại, không phải việc test tự làm hộ.
- Số gate: `nuxt typecheck` **exit 0 / 0** `error TS`; ESLint chạy **sau** khi `.nuxt/eslint.config.mjs` sinh lại (mtime `12:11`) → **0** problem trên **3** file chạm (đúng một lỗi style ở spec mới, `--fix` riêng file đó); unit **85/87** exit 1 với **đúng hai** fail WIP owner: `tmcut_login_remember` (credential regression ở `app/pages/login.vue`) và `tmcut_docs_link_integrity` (`docs/extraction-plan.md:484 -> docs/user-guide.md`); FFmpeg smoke thật chạy riêng vì slice chạm modal export → **7/7** render thật pass, exit 0.
- Live trên dev server `:4003` (bằng chứng bundle, không phải DOM): module playback đang serve chứa `footageRow` **5** lần và **0** lần pattern cũ `tracks?.find(t => t.type === 'video')`; module modal chứa `selectExportTracks(currentProject.value).videoBase` **1** lần và **0** lần `tracks.find(tr => tr.type === 'video')`; **hai** file locale serve **đúng bằng số byte** với nguồn (en 136 712, vi 157 309) và mang copy mới. Một chỉnh nhỏ cho chính phép đo: `/@fs/...` **không** prefix `/_nuxt` trả về **SPA shell với status 200**, nên kết luận "file đã serve" phải dựa vào **nội dung**, không vào status code.
- **Chưa chứng minh:** DOM thật của `/tmcut/editor` (đằng sau [auth.global.ts](file:///D:/Applications/tm-studio/app/middleware/auth.global.ts), và không đụng phiên đăng nhập của user), một cú bấm crossfade thật trên canvas, và một file export thật có row footage thứ hai — vế cuối chờ **Phase 3**, vì hôm nay **không surface nào** composite hai row.

**Trạng thái #89 — `renderAt` là API công khai của core, và preview không còn giữ luật boundary riêng (2026-11-03):**

- Item (1) của Phase 2 đóng **theo đúng nghĩa tên gọi**: `renderAt(input, atTicks, options)` ([renderAt.mjs:51](file:///D:/Applications/tm-studio/packages/core/src/renderAt.mjs#L51)) trả lời "timestamp này render **ở đâu**, và **có gì** ở đó" bằng `{ requestedTicks, at, evaluation, index, frame, snapped, beyond, fps, ticksPerFrame, endTicks, frameCount }`, tất cả `Object.freeze`.
- **Lời giải thích "một phần" của #86 được rút lại bằng chính code:** trước slice này cái thiếu không phải khả năng đánh giá (evaluateTimeline đã có từ M1) mà là **một hợp đồng công khai** mà mọi renderer cùng gọi. `renderAt` là **composition** trên `createFrameScheduler` (#86) — span, rate và lưới frame lấy từ đúng plan trong cùng lời gọi — nên nó không thể trả một vị trí mà kế hoạch frame không có; một test so **từng frame** của `frames()` với `renderAt(..., { snapToFrame: true })` chốt điều đó.
- Hai chế độ, **một luật boundary**: mặc định frame mode collapse mọi timestamp trong một frame về **đầu frame** (đó là thứ làm một frame replay được); `{ snapToFrame: false }` là scrub mode, giữ đúng vị trí trỏ chuột nhưng **vẫn lùi về đầu frame cuối khi vị trí nằm ngoài content** (ADR-018). `beyond` tách hai chuyện: `at` là vị trí thật sự vẽ, còn `beyond` nói cho UI biết đó là clamp chứ không phải một frame có thật.
- Cái bị **xoá** đáng kể nhất là **hai bản copy của cùng một luật**: helper `lastRenderableTicks` trong [clipTime.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/clipTime.ts) (file còn 101 dòng) và khối clamp riêng trong `useTmcutPlayback`. Preview chỉ còn **một** lời gọi ([useTmcutPlayback.ts:80](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L80) `renderPosition`); `renderSeconds` (:85) và `playheadEvaluation` (:90) là hai chiếu của cùng câu trả lời — không còn khả năng một caption còn sống ở surface này mà chết ở surface kia vì hai chỗ tính khác nhau về frame cuối.
- **Không nhầm với interface ở §4.2:** `Renderer.renderAt(request): Promise<RenderResult>` vẫn **chưa** làm — nó quản lý vòng đời `VideoFrame`/`ImageBitmap`/texture và thuộc Phase 3. Cái vừa có là hàm **thuần, đồng bộ, theo tick**: phía "biết phải vẽ gì", chưa phải phía "dựng tài nguyên để vẽ".
- Test mới [render-at.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/render-at.test.mjs) **12** check: frame collapse determinism; `evaluation` **trùng** `evaluateTimeline(project, at)`; đậu frame cuối khi vượt end; scrub step-back đúng `endTicks - ticksPerFrame` **và** caption trên frame cuối vẫn vẽ; identity fields; explicit `rate` thắng canvas của project, rate hỏng fallback 30 fps; project rỗng (`frameCount 0`, `index`/`frame` `null`, `at` = chính request); số âm clamp về 0; purity (`Object.isFrozen(result)` **true**, `evaluation` **không** freeze, gán `result.at` ném `TypeError`); hình **flat của store** trả lời giống hệt hình DSL trên 6 vị trí × 2 chế độ; và đồng ý với `frames()` trên **mọi** frame.
- Hai spec cũ import helper đã bị xoá nay hỏi core, **không hạ assertion**: [tmcut_frame_scheduler.spec.ts:150](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_scheduler.spec.ts#L150) so `plan.frameAt(last).startTicks` với `renderAt(project, plan.endTicks, { snapToFrame: false }).at` **và** pin thêm `beyond === true`; [tmcut_render_parity.spec.ts:296](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_parity.spec.ts#L296) lấy `at` từ `renderAt(windowProject, 2 s, { snapToFrame: false })` thay vì tự làm arithmetic, vẫn giữ `endTicks - 4000` và "chữ vẫn còn trên frame cuối".
- Đỏ-test **5** mutation, mỗi lần sửa đúng một luật, file restore **byte-identical** (sha256/16 `43ce6bdceb7a0196`): bỏ step-back scrub → core **fail 5** **và** app spec fail `core parks the scrub on the last frame the plan carries`; frame mode hết collapse → **fail 4**; evaluate ở `requestedTicks` thay vì `at` → **fail 1** đúng test ADR-018; `beyond` luôn `false` → **fail 2** **và** app spec fail `a position at the span end is past the last frame, so it steps back`; bỏ `options.rate` → **fail 1** đúng test rate precedence.
- Docs phải đánh lại số vì code shift: **20** lần thay trên **3** file. `useTmcutPlayback.ts` mất **3** dòng dưới khối mới (`:114→:111`, `:168→:165`, `:191→:188`), và citation "preview đưa project phẳng thẳng vào evaluator" đổi từ `:90` (chỗ đó giờ chỉ còn đọc `.evaluation`) xuống `:80` (`renderPosition`, nơi lời gọi core thật sự nằm). **4** neo `clipTime.ts#L113` thành **out-of-range** vì file còn 101 dòng sau khi helper bị xoá — lần này chính guard `tmcut_docs_link_integrity` bắt được (khác những lần trước, khi một neo sai nhưng còn trong file thì nó im), nên tên helper trong prose được đổi theo và link trỏ sang [renderAt.mjs:51](file:///D:/Applications/tm-studio/packages/core/src/renderAt.mjs#L51). `extraction-plan.md` vẫn **pure CRLF** (`bareLf = 0`, `crlf = 919`), roadmap và audit vẫn LF, và **0** dòng prose vượt trần 1356.
- Số gate: core **523 → 535/535** (`fail 0`), `check-boundaries` **PASS**, core `tsc` **exit 0**; `nuxt typecheck` **exit 0 / 0** `error TS` (`.nuxt/eslint.config.mjs` sinh lại 28 510 byte lúc 12:37), ESLint **0** problem trên **8** file chạm chạy **sau** lần sinh config đó (đúng hai lỗi style trên file test mới, `--fix` riêng file đó rồi split thủ công `max-statements-per-line`); unit **85/87** exit 1 với **đúng hai** fail, cả hai **không** do slice này: `tmcut_login_remember` (`app/pages/login.vue` bản working tree ghi plaintext password — slice không đụng file đó) và `tmcut_docs_link_integrity`, mà assertion **#L anchor** đã quay lại xanh sau phép vá trích dẫn ở dưới, chỉ còn fail vì `docs/extraction-plan.md:484 -> docs/user-guide.md` — link dead có từ trước, vì owner đã chuyển bài đó sang `docs/content/` (still untracked, nên chưa thể trỏ vào đó).
- Live trên dev server `:4003` (bằng chứng bundle, không phải DOM): module `renderAt.mjs` đang serve **22 153** byte, **không** phải SPA shell, khai báo `function renderAt(` và thân hàm chứa đúng lời lùi `Math.min(requestedTicks, lastRenderable)`; sau khi strip comment, **0** token wall-clock. Barrel `packages/core/src/index.mjs` serve `export * from ".../src/renderAt.mjs?t=…"` — vừa chứng tỏ API đã public, vừa chứng tỏ app đọc core từ **src** (đúng một artifact như G13 đã chốt). Module `clipTime` đang serve chứa `lastRenderableTicks` **0** lần; module playback chứa `renderAt(` **1** lần kèm `snapToFrame: false` và pattern clamp cũ `Math.min(Math.round(playhead` **0** lần.
- **Chưa chứng minh:** DOM thật của `/tmcut/editor` (vẫn sau [auth.global.ts](file:///D:/Applications/tm-studio/app/middleware/auth.global.ts), và không đụng phiên đăng nhập của user), và một frame loop **thật** (WebCodecs / offline dump) gọi `renderAt` ở **frame mode** — hôm nay phía frame mode mới chỉ có test thuần của core; preview vẫn đi scrub mode, còn `stepFrame`/`seekToFrame` đi thẳng qua plan.

**Trạng thái #90 — SVG thành ảnh tĩnh thật sự, từ phân loại đến từng byte của command line (2026-11-03):**

- ba danh sách cùng trả lời "đây có phải ảnh tĩnh không" và **trả lời khác nhau**: core [media.mjs:13](file:///D:/Applications/tm-studio/packages/core/src/media.mjs#L13) `IMAGE_EXTS` **không** có `svg`, `isImageFile` của app ([ffmpegHelper.ts:133](file:///D:/Applications/tm-studio/app/utils/ffmpegHelper.ts#L133)) **có**, còn whitelist của server ([uploads.ts:18](file:///D:/Applications/tm-studio/server/utils/uploads.ts#L18)) tự nhận "mirrors core" mà không. Vì preview đọc danh sách app còn export đọc danh sách core, một clip `.svg` **vẽ được trên canvas và biến mất trong file**. Đây là lệch **tiềm ẩn**, chưa từng nổ: `classifyAssetKind` trả `null` cho svg nên [useTmcutMedia.ts:422](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L422) loại đường dẫn trước khi nó vào thư viện — tức từ slice này svg mới **vào được** editor.
- **một luật, một chỗ**: `stillImageInputFlags(path, { fps, width, height, duration })` ([canvas.mjs:45](file:///D:/Applications/tm-studio/packages/core/src/canvas.mjs#L45)) là nơi **duy nhất** đổi một file still thành input flags — luôn `-framerate` + `-loop 1`, `-width/-height` **chỉ** cho vector (`isVectorStillImage`, [media.mjs:52](file:///D:/Applications/tm-studio/packages/core/src/media.mjs#L52)), `-t` chốtท้าย. `buildBackgroundSource` gọi lại nó ([canvas.mjs:131](file:///D:/Applications/tm-studio/packages/core/src/canvas.mjs#L131)) thay vì tự viết mảng, nên flag của nền ảnh raster **giống hệt từng byte** như trước (test cũ `canvas.test.mjs:251` vẫn xanh mà không sửa assertion), và per-clip input của app ([render/video.ts:242](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L242)) cũng đi qua cùng hàm — không còn đường nào để "quên" `-loop 1`.
- **bốn phép đo trên binary vendored** (`N-126482-g903325e279-20260909`, build có `--enable-librsvg`) là toàn bộ lý do của luật này, không phải suy đoán: (1) `ffprobe` một file svg → codec `svg`, format `svg_pipe`, `nb_read_frames` **1**, `duration` `N/A` — một still là **một frame**, mọi cửa sổ dài bao nhiêu đi nữa; (2) cửa 3 s **không loop** trả đúng **1** frame (172 800 byte rgb24 cho 320×180), cũng cửa đó với `-loop 1 -framerate 30 -t 3.5` trả **90** frame — flag loop là thứ biến một tấm ảnh thành một đoạn phim; (3) `-width`/`-height` là **decoder option của librsvg**, `keep_ar` mặc định `true` nên box 1000×1000 cho file 320×180 ra **1000×562** (resize theo tỉ lệ, **không** pad), và không truyền box thì raster = kích thước nội tại, file không có kích thước nội tại là **100×100**; (4) truyền hai option đó vào một input **png** là lỗi **cứng** trước khi graph kịp dựng (`Codec AVOption width … has not been used for any stream` + `Error opening input file`) — đó là lý do `-width/-height` phải **gate theo extension**, và vì sao một check trong spec assert png **không** có hai flag đó rồi vẫn render thật.
- luật still của ảnh còn kéo theo **luật audio**: branch `anullsrc` ở [render/video.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts) vốn keyed trên `clip.isImage`, nên svg tự được lane im lặng tổng hợp mà không cần code riêng — một still không có stream audio mà graph concat vẫn cần **một lane mỗi clip**.
- **security, vì svg là document chứ không chỉ là pixel**: `/uploads/**` là **origin của chính app**, nên một `.svg` tải lên và được điều hướng tới sẽ chạy script trong phiên đó. [uploads.ts:64](file:///D:/Applications/tm-studio/server/utils/uploads.ts#L64) `uploadsSecurityHeaders(contentType)` trả `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` + `x-content-type-options: nosniff` **riêng** cho `image/svg+xml`, và `{}` cho mọi media khác (`video/mp4` là dữ liệu, không phải document — gắn sandbox cho nó là vô nghĩa và dễ hỏng view). Route serve gắn header sau khi đặt content-type ([uploads/[...path].get.ts](file:///D:/Applications/tm-studio/server/routes/uploads/[...path].get.ts)). `style-src 'unsafe-inline'` là **bắt buộc** vì SVG style inline trong chính file.
- preview giờ hỏi **đúng một câu**: fallback của `isCurrentClipImage` ([TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue)) dùng `classifyAssetKind(src)` của core thay vì `isImageFile`; danh sách legacy vẫn còn cho chính việc nó vẫn làm (sniff trong `ffmpegHelper.ts:170`) nhưng **không** quyết định media của canvas nữa. `tmcut_svg_still.spec.ts` có một source-guard chốt điều đó (bắt `classifyAssetKind(src) === 'image'` **có** mặt và `isImageFile(` **không** còn trong file) — vì đây là loại lệch mà một lần refactor sau có thể âm thầm dựng lại.
- test: [still-image.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/still-image.test.mjs) **11** check thuần (phân loại, `isVectorStillImage`, từng mảng flag chính xác cho png/svg/hộp không hợp lệ/`-t` cuối/30 fps mặc định, và cả hai hình nền), còn [tmcut_svg_still.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_svg_still.spec.ts) **7** check **bằng FFmpeg thật** — flags deep-equal `['-framerate','30','-loop','1','-width','320','-height','180','-t','2.500']` + `anullsrc`; png **không** có flag vector và vẫn render; clip svg 2 s ra **≥55** frame và duration **>1.9 s**; canvas 640×360 đúng hình học **và** đúng ảnh (pixel giữa sáng, pixel góc đỏ, và raster "as-fed" bởi chính flags mà compiler phát ra là **640×360**, tức librsvg raster ở độ phân giải canvas chứ không phải một postage stamp bị phóng); luật CSP; luật một-câu-hỏi của preview.
- **một bug của chính test, sửa bằng đo**: helper đọc pixel từng dùng `crop=1:1:x:y`, và FFmpeg **từ chối** frame 1×1 trên nguồn yuv420p (`Could not open encoder before EOF`, `Nothing was written into output file`) — exit `-22`, trông như lỗi render nhưng là lỗi decode-helper. Bài học ghi vào test: decode **cả frame** `-frames:v 1 -f rawvideo -pix_fmt rgb24` rồi index `(y*W+x)*3`, và assert độ dài buffer = `W*H*3` để không đọc pixel ngoài frame.
- **bốn điều chưa đóng, ghi lại thành văn** (khớp lời hứa "known gap" trong comment của `canvas.mjs`): (a) **svg động** — SMIL/CSS animation trình duyệt chạy, librsvg raster **một** frame, nên export là ảnh tĩnh của frame đó; (b) file **chỉ có `viewBox`** không có `width`/`height` raster **1:1** kể cả khi được xin một box, trong khi browser vẽ theo tỉ lệ viewBox — lệch hình học, không lệch pixel của chính file; (c) phóng **vượt** box đã raster thì **mờ đi** (vector ở preview, raster trong file) — muốn nét phải raster ở đúng kích thước canvas, và flag `-width/-height` đã làm điều đó cho **canvas**, không cho mọi transform lớn hơn canvas; (d) **`shape`** vẫn **chưa** làm: cần một loại layer mới từ đầu — `TmcutTrackType` ([dsl.ts:43](file:///D:/Applications/tm-studio/packages/core/types/dsl.ts#L43)) và `TmcutTrack['type']` ([useTmcutProject.ts:138](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L138)) đang chốt ở `'video' | 'text' | 'audio'`, validator từ chối mọi loại khác ([timeline.mjs:347](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L347)), và cần thêm kind trong evaluator, cách vẽ preview lẫn filter export.
- **đỏ-test ba mutation**, mỗi lần sửa đúng một luật và file restore **byte-identical**: bỏ gate extension (`if (width && height && isVectorStillImage(path))` → `if (width && height)`) giết **đúng** check raster, message `raster input got -framerate 30 -loop 1 -width 320 -height 180 -t 2.500` (`canvas.mjs` sha256/16 `ebd5f40146d94d65` trước và sau); bỏ `'-loop', '1'` ra khỏi flags giết check deep-equal của vector flags — tức lớp mà mutation thứ nhất không chạm tới; và xoá `'svg'` khỏi `IMAGE_EXTS` giết check phân loại ở đầu spec (`media.mjs` sha `55424ba50de2fb8e`). Ba cái đó là bằng chứng ba lớp của luật — classification, loop, extension gate — mỗi lớp có người gác riêng.
- **số gate của slice**: core **546/546** (`fail 0`), `check-boundaries` **PASS**, core `tsc` **exit 0**; `nuxt typecheck` **exit 0 / 0** `error TS` (`.nuxt/eslint.config.mjs` sinh lại 28 535 byte lúc 13:20), ESLint **0** problem trên **9** file chạm chạy **sau** lần sinh config đó — hai lỗi `@stylistic/quotes` duy nhất nằm ở string CSP, `--fix` đúng hai file chứa nó rồi re-lint và mtime config không đổi nên kết quả còn hiệu lực; unit **89/91** exit 1 với **đúng hai** fail và cả hai **không** do slice này (`tmcut_login_remember`: `app/pages/login.vue` bản working tree lại ghi plaintext password, xem mục regression; `tmcut_docs_link_integrity`: link dead có từ trước `docs/extraction-plan.md:484 -> docs/user-guide.md`, bài đó owner đã chuyển sang `docs/content/` vẫn untracked). Chạy **kèm `--smoke`**: `tmcut_render_smoke` **7/7**, `tmcut_render_parity` **14/14**, `tmcut_svg_still` **7/7**, tất cả bằng FFmpeg thật. Sau khi sửa docs, ba spec docs chạy lại: `docs_link_integrity` chỉ còn fail vì đúng link pre-existing kia (mọi neo `#L…` mới đều **trong range**), `doc_line_length` và `doc_table_shape` **exit 0**. Slice này **không** thêm key i18n: không có string user-facing mới — header CSP là thứ máy đọc.
- live trên dev server `:4003` (bằng chứng bundle, không phải DOM): module đang serve — `packages/core/src/canvas.mjs` **131 703** byte `text/javascript` chứa `stillImageInputFlags` **3** lần, `isVectorStillImage` **2** lần, flag `'-loop'` và `'-width'` mỗi thứ **1**; `packages/core/src/media.mjs` **15 314** byte chứa `'svg'` **2** lần (danh sách still + danh sách vector) kèm định nghĩa `function isVectorStillImage`; `app/components/tmcut/TmcutPreviewPlayer.vue` **291 725** byte chứa `classifyAssetKind(src)` **1** lần và `isImageFile(` **0** lần — danh sách legacy thật sự đã rời khỏi module đang chạy, không chỉ khỏi file trên đĩa; `app/utils/tmcut/render/video.ts` **40 906** byte gọi `stillImageInputFlags(` **1** lần. Kích thước + content-type là bằng chứng, vì `/@fs/...` **không** có prefix `/_nuxt` trả về SPA shell **12 536** byte `text/html` với status **200**: status không bao giờ là bằng chứng.
- **chưa chứng minh**: một file `.svg` thật đi qua upload rồi xuất hiện trong thư viện trên DOM thật (`/tmcut/*` vẫn sau [auth.global.ts](file:///D:/Applications/tm-studio/app/middleware/auth.global.ts), và không điều hướng cửa sổ Electron user đang dùng, không đụng credentials của họ — bằng chứng phía server là unit spec trên `uploadKindForName` + `uploadsSecurityHeaders`, chưa phải một response thật); một cú bấm Export thật trong app đang chạy (spec gọi FFmpeg trực tiếp bằng project dựng tay); header CSP thật sự trên một response `/uploads/...` (cần một file svg có thật trong thư mục uploads của user, và không tạo file test vào data của họ); và chênh lệch ảnh browser-vs-export trên svg **động** hoặc `viewBox`-only — đúng ba gap vừa ghi thành văn ở trên.

**Trạng thái #91 — golden-frame thật sự gating, và một bug nằm trong chính file golden (2026-11-03):**

- **vì sao comparator cần `mask`**: mp4 là **4:2:0**, nên một cạnh cứng thật sự nhoè ra vài pixel sau khi encode. Nới tolerance cho **cả khung** để chịu được band đó cũng là nới cho một hình chữ nhật vẽ **lệch một pixel** — chính cái bug golden sinh ra để bắt. Nên [pixels.mjs:89](file:///D:/Applications/tm-studio/packages/core/src/pixels.mjs#L89) nhận `mask` một byte mỗi pixel, `0` = **không assert**, và pixel bị mask rời khỏi **cả** trung bình lẫn số lượng lẫn tỉ lệ (kết quả mới `assertedPixels`/`skippedPixels` ở [pixels.ts:28](file:///D:/Applications/tm-studio/packages/core/types/pixels.ts#L28)); không có mask thì số học **giống hệt** trước, nên chân PNG cũ không đổi assertion. Mask lỗi (sai độ dài, không phải byte array, hoặc mask rỗng) là `TypeError`, kể cả trường hợp mask **tắt mọi pixel** — một golden rỗng không phải một cổng.
- **`DEFAULT_FRAME_COMPARE` không có mask**: [index.d.ts:1800](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L1800) đổi sang `Required<Omit<TmcutFrameCompareOptions, 'mask'>>`, vì "mask mặc định" là vô nghĩa — hoặc caller chủ động đánh dấu cạnh, hoặc không gì bị bỏ qua.
- **band rộng mấy pixel là do đo**, không do ước: với picture 64×36 plate + inset, `edgeBand(0)` (chỉ trừ cột/hàng **chính** cạnh chữ nhật và viền khung, assert **1920/2304**) lọt cho hai chân "một still → mp4" với **worst channel 9** (raster) và **15** (vector), `0` pixel vượt budget; nhưng **không** lọt cho chân so **hai decoder với nhau** — nó fail với **47** pixel over budget, worst **24**, vì librsvg và bmp decoder đặt cùng một cạnh lên hai pixel **láng giềng** sau round-trip. Kết luận: band thuộc về **từng chân**, nên spec giữ `renderMask = edgeBand(0)` cho hai chân nguồn và `crossMask = edgeBand(1)` cho chân chéo ([tmcut_golden_frame.spec.ts:234](file:///D:/Applications/tm-studio/tests/unit/tmcut_golden_frame.spec.ts#L234)).
- **budget = đo + headroom dưới 2×**: `meanTolerance 4` (worst đo được **2.076**), `channelTolerance 20` (worst **15**), `diffRatioTolerance 0.005` (đo được **0** pixel). Lần sau nới ba số đó nghĩa là **đo lại**, không phải nâng trần cho qua. Chạy lại nguyên lệnh ba lần cho **cùng một bộ số** — libx264 trên binary vendored là deterministic với input + args cố định, nên đây là gate so sánh được giữa các lần chạy chứ không phải gate may rủi.
- **bug thật, và nó nằm ở phía tác giả golden**: bản đầu của spec viết pixel BMP vào offset `54 + …` **bên trong** buffer dữ liệu ảnh (buffer đã nằm **sau** header), nên mỗi dòng lệch **18 pixel** và 18 pixel cuối rơi ra ngoài file. Triệu chứng trông hệt một lỗi pipeline: `mean 40.687 (max 6), worst channel 200, diffRatio 0.39583` — gấp nhiều lần mức nhoè chroma, và ảnh vẫn **đúng hình học** vì inset được đặt đối xứng trong khung nên flip/lật không lộ ra. Cách sửa: một buffer duy nhất `Buffer.alloc(54 + rowBytes*HEIGHT)` rồi ghi tại `54 + …` ([writeBmp, :117](file:///D:/Applications/tm-studio/tests/unit/tmcut_golden_frame.spec.ts#L117)). **Bài học được dựng thành chân test**: trước khi render, mỗi file still phải giải mã **chính xác từng byte** với khung mong đợi (`meanTolerance 0, channelTolerance 0, diffRatioTolerance 0`, không mask, [vòng :249](file:///D:/Applications/tm-studio/tests/unit/tmcut_golden_frame.spec.ts#L249)) — sai một kênh, lệch một dòng, vẽ thiếu một pixel là chết **ở đây**, chứ không phải để lại một con số khó hiểu ở tầng mp4.
- **đỏ-test bốn mutation, mỗi cái giết một lớp**: (1) đảo R/B trong `writeBmp` → chân raster-exact fail `mean 49.448`, **2304/2304** pixel khác; (2) khung mong đợi lệch **1 pixel** (`isInset(x + 1, y)` trong `expectedFrame`) → chân vector-exact fail `mean 30.913`, **2304/2304**, và khi tạm tắt chân đó thì **chân render ở band 0 cũng fail**: `mean 4.420 (max 4), worst channel 195, diffRatio 0.02396 (max 0.005)` — tức mask **không** xoá tội cho một cú lệch hình học; (3) đảo quy ước mask trong core (`mask[pixel] !== 0`) → `pixels.test.mjs` fail đúng hai test (test masked nhận `mean 67` thay vì `1`, test mask-âm ném `TypeError` sớm); (4) khôi phục cả bốn, file **green lại y nguyên** và số liệu tái hiện đúng.
- **số gate của slice**: core **546 → 549/549** (`fail 0`), `check-boundaries` **PASS**, core `tsc` **exit 0**; `nuxt typecheck` **exit 0 / 0** `error TS` (`.nuxt/eslint.config.mjs` sinh lại **28 535** byte lúc **13:49**), ESLint **0** problem trên **5** file chạm chạy **sau** lần sinh config đó (mtime config không đổi nên kết quả còn hiệu lực).
- unit **88/91** exit 1 với **ba** fail, **cả ba ngoài slice này**: `tmcut_login_remember` (owner WIP `app/pages/login.vue`), `tmcut_docs_link_integrity` (link dead có từ trước `docs/extraction-plan.md:484 -> docs/user-guide.md`), và **một fail mới do môi trường** — `tmcut_process.spec.ts` chết ở `[web store round-trip]` với `ERR_PACKAGE_IMPORT_NOT_DEFINED: "#shared/utils/processStore"` khi Node nạp `server/utils/processStore.ts`.
- về fail thứ ba, đã kiểm chứ không suy đoán: `package.json` **chưa từng** có mục `imports` (cả HEAD lẫn working tree), nên `#shared/*` chỉ sống nhờ alias của Nuxt; nó chỉ nổ khi chạy **spec bằng Node trực tiếp** dưới **v24** — tức defect **tiềm ẩn từ trước**, user vừa nâng Node nên mới lộ. Không sửa trong slice này vì hai hướng vá đều nằm ngoài quyền: thêm `imports` vào `package.json` (file owner WIP, không được commit) hoặc đổi import sang đường dẫn relative trong `server/` (đi ngược quy ước `#shared` của repo, cần owner chốt). **Slice này không thêm key i18n**: không có string user-facing mới — cả bốn chân đều là test và số học pixel.
- live trên dev server `:4003` (bằng chứng bundle, không phải DOM): module `packages/core/src/pixels.mjs` đang serve **24 249** byte `text/javascript`, chứa `skippedPixels` **5**, `assertedPixels` **6**, `compareFrames` **3** và nguyên văn chuỗi lỗi `the mask leaves no pixel to assert` **1** — logic mask mới thật sự có trong module app đang chạy, không chỉ trên đĩa.
- **chưa chứng minh**: chân **text** (cần pin font — ADR-025, tới giờ vẫn là owner decision), chân **shape** (chưa có loại layer nào ngoài `video | text | audio`), và một tấm **PNG nền** vẫn chỉ được đo ở **một màu đặc** — golden có hình thật (nhiều vùng, nhiều màu) chính là hai chân still vừa thêm, chưa có ảnh phong cảnh/footage thật. Ngoài ra chưa có gì chứng minh golden chạy trên **binary FFmpeg khác** (build hệ thống của user, hoặc build CI): budget đo từ đúng một build vendored, và đó chính xác là lúc một gate nên đỏ lên để **đo lại** thay vì âm thầm khoan dung.

**Trạng thái #92 — số đo chữ về core, và một cổng đỏ-test chứng minh nó không phải bản copy thứ hai (2026-11-03):**

- **vì sao slice này tồn tại**: `app/utils/tmcut/textStyle.ts` (file đã xoá ở slice này) giữ ba công thức stroke/shadow/plate padding mà **cả** preview lẫn export gọi. Nó là bản copy cuối cùng kiểu đó trong repo, và nó đặt luật ở nơi mà core — chỗ `addClip` và migration **seed** `fontSize`/`color` — không đọc được. Numbers ở [textStyle.mjs:14-38](file:///D:/Applications/tm-studio/packages/core/src/textStyle.mjs#L14): `DEFAULT_TEXT_FONT_SIZE 36`, `DEFAULT_TEXT_COLOR '#ffffff'`, `textStrokeWidth = max(1, round(fs/18))`, `textShadowOffset = max(1, round(fs/14))`, `textBoxPadding = max(2, round(fs*0.25))`.
- **bốn chỗ seed, hai chỗ đọc**: [timeline.mjs:207](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L207) và [project.mjs:98](file:///D:/Applications/tm-studio/packages/core/src/project.mjs#L98) (addClip + v1 migration) thay hai literal bằng hai hằng; [templates.mjs:102](file:///D:/Applications/tm-studio/packages/core/src/templates.mjs#L102) bỏ `|| '#ffffff'` còn lại cuối cùng trong pack chữ; export đọc ở [render/text.ts:42](file:///D:/Applications/tm-studio/app/utils/tmcut/render/text.ts#L42) và preview ở [TmcutPreviewPlayer.vue:899](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L899). **Không đổi có chủ đích**: `fontSize: 42` khi thêm chữ từ timeline, `56`/`36` trong text preset — đó là **nội dung tác giả** chọn, không phải fallback, nên chúng không phải luật.
- **hai cách viết một màu**: drawtext nhận `fontcolor=white`, CSS nhận `#ffffff`. Spec không tin "trắng thì giống trắng" — nó decode cả hai về RGB rồi so ([tmcut_text_style.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_text_style.spec.ts)), nên một ngày core đổi sang `#fefe` sẽ bắt buộc export đổi theo hoặc chết.
- **đỏ-test bốn mutation, và kết quả thú vị nhất là cái KHÔNG chết**: (1) sửa **luật** ở core (`/18` → `/20`) → core test fail **1** (`stroke width: drawtext borderw…`), app spec vẫn **11/11** — đúng như thiết kế: spec app là cổng **đọc-cùng-nguồn**, không phải bản sao thứ hai của các con số; (2) sửa **một reader** (export `boxborderw` → `round(fs*0.3)`, tức một công thức riêng trong file export) → app spec fail **4** (drawtext không còn mang số của core ở 24/36/54/72 px); (3) preview quay lại `|| 36` → fail **1** (`the preview keeps no literal fallback of its own`); (4) tắt dòng barrel `export * from './textStyle.mjs'` → app spec **chết từ khâu nạp module** (`SyntaxError: The requested module 'tmcut-core' does not provide an export named 'DEFAULT_TEXT_FONT_SIZE'`). Cả bốn file restore **byte-identical** (md5 khớp trước/sau).
- **test mới**: core **549 → 559/559** (`fail 0`) — 10 check trong [text-style.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/text-style.test.mjs), viết **số cụ thể** chứ không tính lại công thức (một test tự suy `fs/18` sẽ vẫn xanh khi luật đổi), cộng seed-law cho `addClip` và migration; app **11** check.
- **số gate của slice**: `check-boundaries` **PASS**, core `tsc` **exit 0**; `nuxt typecheck` **exit 0 / 0** `error TS` (config ESLint sinh lại **28 535** byte lúc **14:21**), ESLint **0** problem trên **10** file chạm chạy **sau** lần sinh config đó.
- unit **89/92** exit 1 với **đúng ba** fail quen thuộc của slice #91 và không cái nào thuộc slice này: `tmcut_docs_link_integrity` (link chết có từ trước `docs/extraction-plan.md:484 -> docs/user-guide.md`), `tmcut_login_remember` (owner WIP `app/pages/login.vue` ghi plaintext password), `tmcut_process` (`ERR_PACKAGE_IMPORT_NOT_DEFINED "#shared/utils/processStore"` — defect tiềm ẩn lộ ra từ lần chạy đầu dưới Node **v24.22.2**; hai hướng vá đều thuộc owner, xem `Trạng thái #91`). **Không thêm key i18n**: slice chỉ có code + test + docs, không có string user-facing mới.
- live trên dev server `:4003` (bằng chứng bundle, không phải DOM): module core mới đang serve **9 344** byte `text/javascript` với `DEFAULT_TEXT_FONT_SIZE = 36` và **5** export; barrel `index.mjs` đang serve **23 870** byte và re-export `textStyle.mjs`; `render/text.ts` đang serve **30 518** byte, dòng import của nó là `import { DEFAULT_TEXT_FONT_SIZE, keyframeExpr, maskAlphaExpr, textBoxPadding, textShadowOffset, textStrokeWidth } from "/_nuxt/@fs/…/packages/core/src/index.mjs"` — tức host đọc từ **core thật**, và **0** lần chuỗi `'textStyle'` (bản app cũ) còn sót; `TmcutPreviewPlayer.vue` đang serve **291 817** byte, chứa `DEFAULT_TEXT_COLOR` **2** và `DEFAULT_TEXT_FONT_SIZE` **2** lần, và **0** lần `fontSize || 36`.
- **chưa chứng minh**: đây là slice **dời con số**, không phải slice **vẽ pixel** — vẫn chưa có cổng so ảnh DOM của preview với khung mp4 của cùng project (`captureFrames()` ở [htmlVideoRender.ts:97](file:///D:/Applications/tm-studio/server/utils/htmlVideoRender.ts#L97) chỉ phục vụ HTML-video), nên "preview paint đúng số đó" mới được chứng minh ở tầng **filter string + nguồn**, chưa ở tầng **pixel**. Hai lỗ hổng nhỏ đo được khi đọc lại chính hai host: `borderRadius` của plate trong preview tính bằng `round(fontSize * 0.08)` **không có twin ở core và không có twin ở export** (drawtext box là hình vuông), nên góc tròn là khác biệt WYSIWYG **thật**, thuộc về renderer chứ không thuộc luật số; và ba hàm metric **không chắn NaN** (`Math.max(1, NaN)` là `NaN`), test đã bỏ case NaN ra thay vì giả định có guard — mọi caller hiện tại đều truyền `fontSize` đã là số.

**Trạng thái #93 — luật "hàng nào vẽ" về core, và một cổng 121 ô chứng minh nó không đổi hành vi (2026-11-03):**

- **vì sao slice này tồn tại**: evaluator trả lời "clip nào đang sống"; **không ai** trả lời "hàng nào VẼ". Hai surface giữ hai bản copy của chính câu trả lời đó: `footageRow` trong [useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts) (26 dòng loop, pairing theo index) và `selectExportTracks` trong [render/clip.ts:155](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts#L155) (`videoBase = videoRows[0]` — một câu trả lời **per file**). Slice #88 đã "một luật cho hai surface", nhưng luật đó khi đo lại chỉ đúng với bộ lọc **ẩn/hiện**: nó không nói gì về ô **trống**.
- **luật mới, nguyên văn**: [paintStack.mjs:49](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L49) `selectPaintRows(evaluation)` duyệt `evaluation.tracks` **theo thứ tự track**, giữ lại hàng `type === 'video'` **không hidden** và **có ít nhất một layer sống** ngay tại tick đó; hàng đầu tiên là `base`, phần còn lại là `rows.slice(1)` — tức đúng số hàng mà compositor còn thiếu (gap G18). `paintStackAt(input, atTicks)` là tiện ích một lần = `evaluateTimeline` + `selectPaintRows`. Core **cố ý không nhận items**: hàng trả về mang `trackId` + `trackIndex` + `layers`, host join `trackIndex` lại `timeline.tracks[i]` trong một lookup, nên core vẫn không biết gì về renderer.
- **hai chi tiết đo chứ không đoán**: (1) một layer `opacity: 0` **vẫn chiếm hàng** — vì `evaluate.mjs` đặt flag `visible` theo **cửa sổ half-open**, không theo opacity, nên hàng "trong suốt" không tự nhường canvas; test core assert cả `layer.visible === false` lẫn `base` vẫn là hàng đó. (2) `trackIndex` là join key **an toàn** vì [evaluate.mjs:333](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L333) push **đúng một** track entry cho mỗi track đầu vào, theo thứ tự — có check khoá cả `timeline.tracks[i].id === row.trackId` lẫn chiều ngược lại.
- **hành vi không đổi, và đó là điểm bán hàng**: [useTmcutPlayback.ts:112](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L112) giờ là 8 dòng gọi core (trước slice này loop nằm ở `:111-137`, nên `activeVideoClip` từ `:165` thành `:158` — hai anchor đó đã sửa trong audit). Loop cũ được giữ **nguyên văn trong spec** làm `retiredPreviewRow()` và so với đường mới trên **121 cặp** (11 layout × 11 tick) bằng `assert.deepEqual`: single row, half-open boundary, hai hàng overlap, hàng ẩn, gap **trong một hàng**, hand-off giữa hai hàng, hàng `opacity: 0`, hàng rỗng, clip zero-duration, hàng chữ/nhạc chen vào. Spec còn đếm `compared === 121` và `nonNull >= 40`, nên nó **không thể xanh vì vòng lặp không chạy**.
- **đỏ-test bằng 5 mutation, restore byte-identical** (md5 `useTmcutPlayback.ts` = `d840e4866a049fcd106f37923ea4d4ed`, `paintStack.mjs` = `f6f322fc0969a4ce89754ebc550eb544`): (M1) core bỏ bộ lọc `hidden` → app spec fail **3**; (M2) core đổi "hàng đầu thắng" thành `rows.pop()` → **2**; (M3) core bỏ điều-kiện "hàng phải có layer" → **1**; (M4) preview quay lại loop locally-filtered → **1** (check guard bắt đúng điều nó được sinh ra để bắt); (M5) preview join `tracks[0]` thay vì `tracks[base.trackIndex]` → **1** (`expected 'row-b' to be 'row-a'`) **cộng** spec #88 [tmcut_footage_row_rule.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_footage_row_rule.spec.ts) fail check 2 "hiding the top row hands the screen and the file to the row below" — hai cổng độc lập cùng chết trên một bug, đó chính là bằng chứng slice này **có** chủ.
- **test mới**: core **559 → 574/574** (`fail 0`) — 15 check trong [paint-stack.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/paint-stack.test.mjs) (boundary half-open, gap + hand-off, overlap, hidden, thứ tự + `trackIndex`, chữ/nhạc không bao giờ vào stack, zero-duration, transparent-claims-row, shape phẳng của app store, wrapper `{ timeline }`, hai entry-point deep-equal, clamping tick, evaluation hỏng → `{at:0, rows:[], base:null}`); app **6** check trong [tmcut_paint_stack.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts) — trong đó check 3 chạy **composable thật** qua `freshStore()` (harness [tmcut_store_env.ts](file:///D:/Applications/tm-studio/tests/unit/helpers/tmcut_store_env.ts)): `gap-top.mp4` [0,4) ở hàng trên, `gap-bottom.mp4` từ offset 3 s ở hàng dưới → `seek(1)` paint hàng trên, `seek(5)` paint hàng dưới, và `base.trackId` của core tại `tk(5)` chính là id hàng dưới.
- **một câu cũ trong docs phải sửa vì phát hiện này**: chính lúc viết check 3 đã lộ ra rằng header của spec là sai — slice #88 **đã** chạy `useTmcutPlayback()` thật chứ không chỉ đo chuỗi render, và spec của #88 cũng làm vậy. Vì thế câu "hai surface đọc cùng một row footage" ở [dòng G18 của audit](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md#L199) chỉ đúng với bộ lọc **ẩn/hiện**, **không** đúng với **ô trống**: tại `t = 5 s` với hàng trên [0,4) và hàng dưới [3,11), core nói `base = v2`, còn exporter vẫn nói `videoBase = v1` + `extraVideoTracks = [v2]`. Check 4 của spec mới **pin đúng độ lệch đó** để slice composite — sau #94 đã xác định lại là **#95** — phải sửa nó **một cách có chủ đích**, không phải tình cờ.
- **số gate của slice**: `check-boundaries` **PASS — core imports nothing platform-specific**, core `tsc` **exit 0**; `nuxt typecheck` **exit 0 / 0** `error TS` (config ESLint sinh lại **28 535** byte lúc **16:09**), ESLint **0** problem trên **6** file chạm chạy **sau** lần sinh config đó; unit **90/93** exit 1 với **đúng ba** fail quen thuộc và **không** cái nào thuộc slice này (`tmcut_docs_link_integrity` — link chết có từ trước `docs/extraction-plan.md:484 -> docs/user-guide.md`; `tmcut_login_remember` — owner WIP `app/pages/login.vue` ghi plaintext password; `tmcut_process` — `ERR_PACKAGE_IMPORT_NOT_DEFINED "#shared/utils/processStore"` dưới Node **v24.22.2**). Spec mới xanh **6/6** ngay trong lần chạy đó, hai spec láng giềng giữ nguyên **7/7** (`tmcut_footage_row_rule`) và **10/10** (`tmcut_export_track_parity`). **Không thêm key i18n**: slice là luật + test + docs, không có string user-facing mới.
- live trên dev server `:4003` (bằng chứng bundle, không phải DOM): module mới `packages/core/src/paintStack.mjs` đang serve **21 443** byte, chứa `selectPaintRows` **3**, `paintStackAt` **1** và `trackIndex` **3**; barrel `index.mjs` serve **24 352** byte và re-export `paintStack.mjs` **1** lần; `useTmcutPlayback.ts` serve **62 449** byte với `selectPaintRows` **3**, `base.trackIndex` **1** và **0** lần `videoEvaluations` — tức loop pairing cũ đã sạch khỏi module đang chạy, không chỉ sạch trên đĩa.
- **chưa chứng minh**: (a) **pixel** — không có gì mới được render; slice dời **luật chọn hàng**, chưa chứng minh ảnh DOM của preview khớp khung mp4 của cùng project; (b) **export per-tick** — `selectExportTracks` vẫn trả **một** hàng cho **cả file** (độ lệch đã pin ở check 4), nên "cả hai surface đọc core" mới đúng **một nửa**: nửa preview đã về core, nửa file là việc của **#95** (#94 **không** chạm độ lệch đã pin này — nó sửa một defect khác, xem block dưới); (c) **không có hàng nào được composite** — `rows.slice(1)` hôm nay vẫn chỉ là danh sách những hàng bị bỏ, và banner `parallelTracksWarning` vẫn nói đúng sự thật đó; (d) live bundle `:4003` (xem dòng gate phía dưới) là bằng chứng **module đang serve**, không phải bằng chứng **DOM đã paint** — `/tmcut/*` vẫn chắn sau `app/middleware/auth.global.ts`.

**Trạng thái #94 — export học lại "lúc nào", và cổng pixel đầu tiên cho một ô trống (2026-11-03):**

- **slice này đổi việc, và đổi vì số đo chứ không vì sở thích**: kế hoạch khi khép #93 là composite hàng footage thứ hai (G18). Khi đọc `compileVideoPipeline` để tìm chỗ đặt overlay chain, một defect **đứng trước** lộ ra mà §5 của audit chưa có dòng nào ghi: chain footage nối bằng `concat`, nên **`offsetSec` bị bỏ hoàn toàn**. Đo trên project 2 s ở giây 0 + 2 s ở giây 5: `compiled.duration` đã là **7** (extent tính từ offset ở [render/index.ts:69](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts#L69)) nhưng file thật, đọc bằng `resources/ffprobe.exe`, là **4.000000 s / 120 frame** — ba giây hình cuối **không tồn tại**, trong khi audio row ([render/audio.ts:58](file:///D:/Applications/tm-studio/app/utils/tmcut/render/audio.ts#L58)) và cửa `drawtext` vẫn đặt theo thời gian tác giả. Không xếp được hàng thứ hai lên một chain mà hàng thứ nhất còn tự dịch về trước, nên **#94 = placement tuyệt đối** (ghi thành dòng **G19**), composite chuyển thành **#95**.
- **luật mới, một dòng một**: [render/video.ts:93](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L93) `leadingPads(videoClips, ctx)` đi một cursor song song với cursor của fold; mỗi clip nhận `pad = offsetSec − chainStart` nếu nó **≥ một frame** output, và pad emit ở **cuối chain của chính clip** — `tpad=start_mode=add:start_duration=<gap>:color=<canvas>` ([:228](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L228)) — chứ không hàn vào concat. Lane audio của cùng segment nhận `adelay=<ms>|<ms>` ([:234](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L234)) vì `concat=…:v=1:a=1` đòi hai nhánh cùng độ dài; thiếu nó thì tiếng của clip sau chạy sớm đúng một gap.
- **ba quyết định có chủ đích**: (1) project **liền khe** không emit thêm filter nào, nên mọi export cũ giữ nguyên command line **từng byte** — đó là lý do check 1 tồn tại; (2) ô **nhỏ hơn một frame** không pad, vì không vẽ nổi thì pad chỉ viết lại graph của mọi project để đổi lấy phần ba frame; (3) **crossfade là overlap chứ không phải gap**: pad walk và xfade fold hỏi **đúng một** câu qua `overlapSec` ([:70](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L70)), và [tmcut_shared_model.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_shared_model.spec.ts) đã cấm luật cửa sổ có bản thứ hai — check 4 của spec mới đo luôn `offset=1.500` của cặp fade **không đổi**.
- **đỏ-test một mutation, restore byte-identical** (md5 `render/video.ts` = `e971c3ccf211ef4d456481b66d619bfa`): đặt `const pad = 0` làm [tmcut_export_gap_placement.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_gap_placement.spec.ts) fail **ngay check 2** (`three canvas seconds between the plates`), còn `tmcut_render_graph`, `tmcut_export_track_parity`, `tmcut_render_parity`, `tmcut_golden_frame` **vẫn exit 0** — nghĩa là defect này đã đi qua bốn gate export trước khi có spec thứ năm, và spec mới là cổng **đầu tiên** của nó.
- **cổng pixel, và là thứ đáng giá nhất của slice**: check 6 render FFmpeg **thật** project có ô trống, decode **từng** frame RGBA, rồi hỏi `evaluateTimeline(project, tick)` "hàng này có layer sống không". Frame có footage phải đúng là **plate đã authored**, frame không có phải đúng **màu canvas đã authored** (`#102030` → `0x102030` qua `ffmpegColor`): đếm được **120** frame paint / **90** frame canvas / tổng **210** = **7.000000 s**. Expected dựng từ màu tác giả chứ **không** dựng từ ảnh render, nên một ngày pad tô sai màu không thể tự khớp với chính nó.
- **một phát hiện về binary, đã khoá bằng check 7**: bản vẽ đầu dùng `tpad=…:start_color=` và **không render nổi** — `resources/ffmpeg.exe` trả `Error applying option 'start_color' to filter 'tpad': Option not found`, trong khi cùng lệnh với `:color=` exit 0. Check 7 cấm chuỗi `start_color` quay lại trong [render/video.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts) và đếm `fromId ===` **đúng 1** lần + `overlapSec(` **đúng 3** lần (một khai báo, hai chỗ đọc).
- **số gate của slice**: `nuxt typecheck` **exit 0 / 0** `error TS` (config ESLint sinh lại **28 535** byte lúc **16:35**), ESLint **0** problem trên **2** file chạm chạy **sau** lần sinh config đó; unit **91/94** exit 1 với **đúng ba** fail quen thuộc và **không** cái nào thuộc slice này (`tmcut_docs_link_integrity` — link chết có từ trước `docs/extraction-plan.md:484 -> docs/user-guide.md`; `tmcut_login_remember` — owner WIP [app/pages/login.vue](file:///D:/Applications/tm-studio/app/pages/login.vue) ghi plaintext password; `tmcut_process` — `ERR_PACKAGE_IMPORT_NOT_DEFINED "#shared/utils/processStore"` dưới Node **v24.22.2**); spec mới **PASS 7/7** ngay trong lần chạy đó và tổng specs **93 → 94**. Core **không** đổi ở slice này nên `check-boundaries` và `core tsc` giữ nguyên kết quả của #93. **Không thêm key i18n**: không có string user-facing mới.
- **anchor phải sửa vì chính slice này** (guard chỉ bắt "dòng đó có tồn tại", không bắt "dòng đó có đúng chỗ", nên những chỗ này sửa bằng tay): concat chain mà audit cite ở `render/video.ts:237` nay là **[:420](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L420)** vì hai helper mới đẩy nó xuống; `useTmcutPlayback.ts:111` (`footageRow`, sót từ #93) về **:112** ở cả audit lẫn block #88, kèm hai anchor inline `transitionCrossfade` :140 → **:133** và `activeVideoClip` :165 → **:158**; và citation "dòng 496 của audit" trong block #93 thực ra trỏ vào câu ở **dòng G18**, đã đổi thành `#L199`.
- **chưa chứng minh**: (a) **ô trống có hàng khác bên dưới** — pad walk chỉ đọc **một** row (`videoBase`), nên project hai hàng với ô trống ở hàng trên vẫn ra file một hàng; đó là #95, cùng với độ lệch per-file vs per-tick mà check 4 của [tmcut_paint_stack.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts) đang pin; (b) **tốc độ ≠ 1x** — `renderClipDuration` đã chia speed, nhưng chưa có check nào pad một row có clip tăng tốc; (c) **live** — không có bằng chứng bundle cho slice này vì không file nào trong `app/` ngoài [render/video.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts) đổi, và DOM vẫn chắn sau auth; (d) **`range` (In/Out render zone)** — pad tính từ `offsetSec` gốc, còn đường `options.range` cắt ở [render/index.ts:86](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts#L86) chưa có check nào ghép với ô trống.

**Trạng thái #95 — file composite cả chồng hình; G18 khép ở vế export (2026-11-03):**

- **việc của slice**: xếp **mọi** row footage đang hiện vào file, theo đúng thứ tự mà core đã quy ở #93. Luật mới chỉ có một câu: `videoBase` là **đáy** của chồng hình, `extraVideoTracks` là những row **bên trên**, và thứ tự overlay **chính là thứ tự `rows` của `selectPaintRows`** — không còn quyết định nào thứ hai.
- **graph thành hình ra sao**: mỗi row đi qua `compileVideoPipeline` **một lần** với `labelPrefix` riêng (`r<index>_`) rồi `format=rgba`, sau đó `overlay` xuống bus: `[v_stack_tail][v_stack_rgba_0]overlay=enable='…':eof_action=pass:repeatlast=0[v_stack_0]` → `[v_stack_0][v_stack_rgba_1]overlay=…`. `labelPrefix` không phải trang trí: builder đặt tên `[v_concat]` / `[v_chain_i]` **như nhau cho mọi row**, nên hai row trùng tên là ffmpeg **chối cả graph** — đỏ-test bỏ prefix cho đúng lỗi đó.
- **cửa half-open là của core, không phải của filter**: mỗi row chỉ hiện trong `[offsetSec, offsetSec + durationTicks)` của **chính nó** qua `enable='gte(t,A)*lt(t,B)+…'`, nên ô trống giữa hai row vẫn là **nền canvas**, không phải frame của row dưới bị kéo dài.
- **bus phải nối đuôi trước khi overlay**: row trên cùng thường sống **lâu hơn** row đáy, nên `tpad=stop_mode=add:stop_duration=<Δ>:color=<canvas>` mở bus tới hết chồng hình, rồi `settb=1/<fps>,fps=<fps>` trả bus về **đúng lưới frame**. Lý do có số đo: `tpad=stop_mode=add` tự đánh số frame **thấp hơn lưới** — frame 90 ra `2.999990` s và độ trôi lớn dần tới `4e-5` s ở frame 179 — nên `overlay` (ghép frame mới nhất **không trễ hơn** frame bus) chọn nhầm frame kế trước và **row trễ đúng một frame**. Sau `settb/fps`, row [3 s, 5 s) vẽ **chính xác frame 90..149**.
- **composite đặt trước LUT và trước đuôi caption**: màu graded vẫn là màu của **hình**, không của một row đã trộn; caption dài hơn footage vẫn có frame để vẽ.
- **row bên trên không đóng góp tiếng**: `compileVideoPipeline` chạy cho row stacking với `hasAudio: false`, và graph giữ **đúng một** lane audio cho toàn file. Đây là quyết định có chủ đích, đã ghi vào copy hai locale chứ không phải lỗi âm thầm.
- **guard mới [tmcut_export_paint_stack.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_paint_stack.spec.ts): 12 check**, ba check đọc **frame thật** do `resources/ffmpeg.exe` render trên plate màu: (1) row opaque đè row dưới thật; (2) `opacity 0.5` trộn với **row dưới chứ không phải nền canvas** — đo **[125,55,110]**, và khi alpha mất thì ra **[218,17,17]**; (3) ba row chồng nhau trả **đúng dải frame của mình**, frame ngoài cửa là màu canvas đã authored. Màu so với **ngưỡng 5** vì yuv420p drift có thật và đã đo (màu authored `210,40,40` về file thành `208,37,38`).
- **đỏ-test bằng 4 mutation, restore byte-identical** (`md5sum -c` khớp; trạng thái restore: `render/video.ts` = `39cc2b98e9114fd1f7828bbf7d8c57a2`, `render/index.ts` = `fbc84d02a755af433f46e7188bd9fc0d`): tắt `compositePaintRows` → fail "the stacked row must be decoded too"; bỏ `settb/fps` → fail check graph; `gte` → `gt` → fail cửa sổ half-open; `format=rgba` → `gbrp` → **chỉ** check pixel bắt được. Mutation cuối là thứ chứng minh spec này **không** chỉ đọc chuỗi filter.
- **một phát hiện về binary, đã ghi vào comment nguồn**: `overlay` **không** có option `format=rgba` — nó parse option đó như một enum và từ chối tên (`Error… Option not found` khi đo trên binary đi kèm). Alpha đi qua bằng `format=rgba` đặt trên **chính row**, không phải bằng option của overlay.
- **project một row vẫn nguyên từng byte**: `labelPrefix` của row đáy là chuỗi rỗng nên `[v_concat]` / `[a_concat]` không đổi tên, và `compositePaintRows` return ngay khi `rows` rỗng — đó là lý do bốn spec export cũ (`tmcut_render_graph`, `tmcut_render_parity`, `tmcut_golden_frame`, `tmcut_export_gap_placement`) vẫn xanh mà không sửa assertion nào.
- **copy hai locale đã nói lại sự thật mới**: `tmcut.export.parallelTracksWarning` (EN + VI, cùng một dòng) giờ nói file **composite mọi row footage đang hiện theo thứ tự vẽ**, còn **preview vẫn chỉ một row — tức row đáy**; check 6 của [tmcut_footage_row_rule.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_footage_row_rule.spec.ts) chặn câu cũ ("chỉ row trên cùng có hình, cả ở preview lẫn khi xuất file") quay lại, và [tmcut_paint_stack.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts) check 4 đổi từ **pin độ lệch** sang **bất biến**: stack của file == `rows` của core, cùng thứ tự.
- **anchor phải sửa vì chính slice này** (guard chỉ bắt "dòng đó có tồn tại"): `render/video.ts` `overlapSec` :62 → **:70**, `leadingPads` :85 → **:93**, `tpad` pad :125 → **:228**, `adelay` :131 → **:234**, `stillImageInputFlags` :70 → **:242**, concat chain :317 → **:420**; `render/index.ts` chữ-vào-duration :53 → **:76**, extent `extraVideoClips` :58 → **:73**, `tpad` đuôi caption :174 → **:226**, `transitionWindows` TS2345 :151 → **:162**; `render/clip.ts` `selectExportTracks` :149 → **:155** và `toRenderClip` :6 → **:83**.
- **chưa chứng minh**: (a) **preview vẫn một `<video>`** — stacking chỉ có trong file, DOM vẫn chắn sau auth nên không có bằng chứng canvas hai hàng; (b) **blend mode khác `normal` trên row bên trên** — row stacking được composite như overlay thường, chưa có check nào cho `multiply`/`screen` của row thứ hai; (c) **tiếng từ row bên trên** — cố ý không, nhưng chưa có test nào chứng minh hệ quả nghe được; (d) **export thật bấm nút** — mọi số đo ở đây lấy từ `compileTimelineToFfmpeg` + FFmpeg binary trong repo, chưa chạy qua `TmcutExportModal`; (e) **`range` (In/Out) ghép với stacking** — đường cắt vẫn chỉ được đo với một row.

### Phase 3 – GPU Compositor và Transform Engine

- WebGL2 baseline.
- WebGPU backend thử nghiệm.
- Video/image texture pipeline.
- Transform matrix.
- Crop/flip/rotate/scale/pan.
- Alpha/blend.
- Color effects cơ bản.
- Resource lifecycle và GPU context recovery.

**Acceptance criteria:**

- Preview transform và export transform dùng cùng model.
- Có fallback khi WebGPU không khả dụng.
- Không rò rỉ GPU resource trong test dài.
- Có benchmark nhiều layer và nhiều độ phân giải.

### Phase 4 – Media Decode, Proxy và Audio

- Media source abstraction.
- Video decode và timestamp mapping.
- Seek/keyframe-aware decode.
- Frame cache.
- Proxy generation.
- Audio decode/mix.
- AudioWorklet hoặc backend phù hợp.
- Audio/video synchronization.

**Acceptance criteria:**

- Import video dài không phải chờ phát hết.
- Seek tới timestamp và preview được khi media sẵn sàng.
- Đồng bộ audio/video qua các đoạn timeline.
- Có giới hạn decoder concurrency.

### Phase 5 – WebCodecs Export và Muxing

- VideoEncoder.
- AudioEncoder khi được hỗ trợ.
- Mediabunny hoặc muxer phù hợp.
- Encoder backpressure.
- Frame timestamp/duration.
- MP4/WebM output.
- Progress/cancel/error.
- Export capability detection.

**Acceptance criteria:**

- Export composition test thành file hợp lệ.
- Frame count và duration chính xác theo profile.
- Audio/video sync được kiểm tra.
- Có test codec không hỗ trợ.
- Không dùng MediaRecorder làm offline frame renderer chính.

### Phase 6 – Electron Runtime và TMCut Agent

- Electron adapter.
- IPC contract.
- Native process manager: **rút khỏi phạm vi** — Electron không spawn media process (ADR-032).
- TMCut Agent.
- yt-dlp integration.
- FFmpeg adapter: **rút khỏi phạm vi** — ADR-028 supersede ADR-006, và ADR-032 cấm Electron có media engine riêng.
- Local download manager.
- Security hardening.

**Acceptance criteria:**

- Web UI có thể pairing với Agent.
- Không có arbitrary process execution.
- Agent chỉ bind loopback.
- Origin/token validation hoạt động.
- Download progress/cancel/retry hoạt động.

### Phase 7 – Web/Vercel/VPS Deployment

- Nuxt web build.
- Vercel frontend/API.
- VPS worker.
- Queue.
- Object storage.
- Signed URLs.
- Job status API.
- Quota/rate limiting.
- Worker monitoring.

**Acceptance criteria:**

- Vercel không phải giữ request mở trong suốt render.
- Worker restart không làm mất job state.
- Có retry/idempotency.
- Có giới hạn tài nguyên và chi phí.
- User có thể tải output an toàn.

### Phase 8 – Smart Export và Plugin Ecosystem

- Render cache.
- Segment rendering.
- Smart export.
- Effect plugin API.
- Transition plugin API.
- Template packages.
- Custom shader.
- Capability-based backend selection.
- Visual regression suite.

---

## 16. Testing và chất lượng

### 16.1 Unit tests

- Timebase conversion.
- Timeline evaluation.
- Keyframe interpolation.
- Transform matrix.
- Crop/UV mapping.
- Effect parameter evaluation.
- Project serialization/migration.

### 16.2 Rendering tests

- Text/font rendering.
- SVG.
- Alpha blending.
- Transform/crop.
- Color management.
- Transition.
- Frame determinism.
- DOM/GPU integration.

### 16.3 Export tests

- Frame count.
- Duration.
- FPS/rational frame rate.
- Audio/video sync.
- Codec support.
- Muxer validity.
- Cancel/retry.
- Large output/memory usage.

### 16.4 Cross-platform tests

- Electron Windows.
- Electron macOS.
- Electron Linux.
- Chrome/Edge.
- Firefox/Safari theo mức hỗ trợ API thực tế.
- VPS headless runtime.
- Vercel frontend + remote worker.

### 16.5 Performance benchmarks

Benchmark theo matrix:

- 720p / 1080p / 4K.
- 24 / 30 / 60 FPS.
- 1 / 3 / 5 / 10 layers.
- Text-only / image / video / mixed.
- No effects / simple effects / heavy shader.
- Source H.264 / H.265 / VP9 / AV1 khi thiết bị hỗ trợ.
- GPU backend và CPU fallback.

Đo:

- Preview FPS.
- Scrub latency.
- Decode latency.
- Render ms/frame.
- Encode throughput.
- Peak RAM.
- GPU memory.
- Export speed ratio so với realtime.
- Dropped frames trong preview.
- Output correctness.

Không đặt benchmark target trước khi đo trên phần cứng mục tiêu.

---

## 17. Rủi ro và quyết định cần tránh

1. **Không rewrite toàn bộ cùng lúc.** Tách Core và renderer theo giai đoạn.
2. **Không coi DOM là GPU compositor.** DOM capture/rasterization cần thiết kế riêng.
3. **Không phụ thuộc WebGPU tuyệt đối.** WebGL2/Canvas fallback và capability detection.
4. **Không phụ thuộc WebCodecs codec đồng nhất.** Mỗi runtime có codec support khác nhau.
5. **Không render bằng wall-clock animation.** Dùng timestamp evaluation.
6. **Không decode mọi video từ đầu.** Dùng keyframe-aware seek, cache và proxy.
7. **Không mở nhiều worker vô hạn.** Giới hạn theo decoder/GPU/RAM.
8. **Không dùng Vercel Functions làm long-running media worker chính.**
9. **Không dùng Colab Free làm production worker.**
10. **Không mở Local Agent thiếu xác thực.**
11. **Không tự ý upload media riêng tư lên cloud.**
12. **Không biến cú pháp của một binary media thành abstraction.** Effect phải có model độc lập; từ ADR-028 không còn "backend implementation" FFmpeg để chọn giữa hai đường.
13. **Không cam kết pixel-perfect tuyệt đối trên mọi GPU/browser.** Dùng visual regression và tolerance.
14. **Không coi stream copy là luôn khả thi.** Keyframe, codec và timestamp có thể yêu cầu re-encode.

---

## 18. Quyết định kiến trúc đề xuất (ADR Summary)

| ID | Quyết định | Lý do |
|---|---|---|
| ADR-001 | Shared Project/Timeline Core | Project dùng chung mọi platform |
| ADR-002 | HTML-first composition | Linh hoạt typography/template/animation |
| ADR-003 | WebGL2 baseline, WebGPU progressive | Cân bằng tương thích và hiệu năng |
| ADR-004 | Deterministic timestamp renderer | Preview/export cùng logic |
| ADR-005 | WebCodecs + muxer cho browser export | Không bắt buộc FFmpeg |
| ADR-006 | FFmpeg optional backend — **SUPERSEDED 2026-11-03 by [ADR-028](file:///D:/Applications/tm-studio/docs/adr/zero-ffmpeg-decisions.md)** | Rule 1 và 3 của plan browser-first không cho tồn tại backend tùy chọn |
| ADR-007 | Electron + Browser + Node adapters | Đa nền tảng |
| ADR-008 | TMCut Local Agent | Cho Web truy cập native capabilities có kiểm soát |
| ADR-009 | Vercel orchestration, VPS worker | Tách API khỏi tác vụ dài |
| ADR-010 | Colab chỉ prototype | Không ổn định cho production |
| ADR-011 | Project format platform-independent | Dễ di chuyển Desktop/Web/Cloud |
| ADR-012 | Smart Export là phase nâng cao | Tránh tối ưu sớm và sai bitstream |

---

## 19. Kết luận

TMCut V4 nên được xây dựng như một **Universal Video Editing Platform**, không chỉ là một ứng dụng Electron hoặc một HTML-to-MP4 converter.

Kiến trúc đích:

- Nuxt 4 + Vue 3 + Nuxt UI cho shared application.
- Shared Project Core và Timeline Core.
- HTML/CSS/SVG cho composition elements.
- WebGL2/WebGPU cho GPU compositing.
- Deterministic Frame Scheduler cho Preview/Export.
- WebCodecs cho encoding khi runtime hỗ trợ.
- Mediabunny hoặc muxer tương đương để đóng gói.
- Audio engine riêng.
- Electron adapter cho native desktop.
- TMCut Agent cho browser-to-native capabilities.
- VPS worker cho cloud processing.
- Vercel cho frontend, API và job orchestration.
- yt-dlp chạy trên Electron, Local Agent hoặc VPS worker.
- FFmpeg **không** là backend tùy chọn: ADR-028 (2026-11-03) loại nó khỏi repo, build và docs — hàng này từng viết "backend tùy chọn".

### Lộ trình ưu tiên

**Không nên bắt đầu bằng downloader, cloud queue hoặc plugin ecosystem.**

Thứ tự hợp lý nhất:

1. Audit codebase hiện tại.
2. Chuẩn hóa Project/Timeline Core.
3. Xây deterministic `renderAt(timestamp)`.
4. Xây DOM + WebGL2 renderer.
5. Làm transform/effects.
6. Tích hợp media decode/proxy.
7. Hoàn thiện WebCodecs + muxing.
8. Mở rộng Electron/Web runtime.
9. Xây Local Agent và downloader.
10. Xây VPS worker và cloud jobs.
11. Smart Export và plugin ecosystem.

> **Mục tiêu cuối cùng:** Một project TMCut có thể mở trên Desktop hoặc Web, preview và export bằng cùng một rendering logic, xử lý media local hoặc remote theo quyền của người dùng, và không bị khóa vào FFmpeg filter graph.

---

## 20. Tài liệu tham khảo

Các dự án và tài liệu nên nghiên cứu trước khi implementation:

- TMCut repository: https://github.com/tuanmjnh/tm-tools
- HyperFrames: https://github.com/hyperframes-org/hyperframes
- Remotion: https://www.remotion.dev/
- Motion Canvas: https://motioncanvas.io/
- timecut: https://github.com/tungs/timecut
- mcut: https://mcut.io/docs
- WebCodecs API: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- WebGL: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
- Mediabunny: https://mediabunny.dev/
- yt-dlp: https://github.com/yt-dlp/yt-dlp
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- Google Colab FAQ: https://research.google.com/colaboratory/faq.html

**Lưu ý:** Trước khi implementation, kiểm tra lại API, license, browser support, codec support và giới hạn hosting theo phiên bản mới nhất. Tài liệu này là blueprint kiến trúc, không thay thế việc audit code thực tế trong repository.
