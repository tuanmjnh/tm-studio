# TMCut V4 – Universal HTML/GPU Video Rendering & Multi-Platform Architecture

> **Tài liệu định hướng kiến trúc và roadmap triển khai**
>
> Trạng thái: Proposal / Architecture Blueprint  
> Phiên bản tài liệu: 1.0  
> Nền tảng hiện tại: Nuxt 4 + Vue 3 + Nuxt UI + Electron  
> Mục tiêu: Xây dựng TMCut thành nền tảng biên tập và xử lý video đa nền tảng, dùng chung Project Core, Timeline Core và Rendering Core.

---

## 1. Tóm tắt định hướng

TMCut V4 được định hướng chuyển từ mô hình:

**HTML Preview → chuyển đổi thành FFmpeg Filter Graph → FFmpeg Export**

sang mô hình:

**Shared Project/Timeline Core → Unified HTML/GPU Rendering Engine → Frame Pipeline → WebCodecs/Muxer**

FFmpeg không còn là thành phần bắt buộc của đường render chính. Nó trở thành **Native Media Backend tùy chọn**, dùng khi cần xử lý codec, remux, media operation chuyên biệt, fallback hoặc các tác vụ mà browser stack chưa đáp ứng tốt.

### 1.1 Các nguyên tắc cốt lõi

1. **HTML-first, GPU-accelerated:** HTML/CSS/SVG phù hợp với typography, subtitle, template, vector và motion graphics; GPU compositor xử lý video/image layers, transforms, compositing và effects.
2. **Preview/Export dùng chung logic:** Cùng Project Core, Timeline Core, effect definitions, transform model và timestamp evaluation.
3. **Deterministic rendering:** Render theo timestamp/frame index xác định, không phụ thuộc đồng hồ thực hoặc tốc độ playback.
4. **Platform-independent project:** Project JSON không phụ thuộc Electron, browser, VPS hay Vercel.
5. **Runtime adapters:** Native APIs, filesystem, process, downloader, storage và remote jobs được trừu tượng hóa qua adapter.
6. **Progressive enhancement:** WebGPU/WebCodecs được sử dụng khi hỗ trợ; có fallback phù hợp như WebGL2, Canvas2D hoặc native backend.
7. **Local-first, cloud-capable:** Người dùng có thể xử lý media tại máy; cloud worker là lựa chọn bổ sung, không bắt buộc.
8. **FFmpeg optional:** Không thiết kế renderer phụ thuộc FFmpeg filter graph; chỉ gọi FFmpeg qua adapter/backend khi thực sự cần.

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
    AGENT --> NATIVE["yt-dlp · Optional FFmpeg · Native tools"]
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

## 9. Export pipeline không bắt buộc FFmpeg

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
| Native fallback | Optional FFmpeg backend |

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

Google Colab notebook có thể cài và chạy yt-dlp/FFmpeg trên Linux runtime, sau đó lưu output vào Google Drive hoặc tải xuống.

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
- Native FFmpeg khi cần.
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
4. Desktop có Agent/native backend → có thể dùng native media operation.
5. Cloud job → gửi VPS worker.
6. Optional FFmpeg chỉ được gọi khi job yêu cầu hoặc backend chính không đáp ứng.

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
- Adapter giờ có consumer thật (2026-11-01, khép nửa đầu G3): `useTmcutPlatform()` ([useTmcutPlatform.ts:227](file:///D:/Applications/tm-studio/app/composables/useTmcutPlatform.ts#L227)) dựng một adapter cho cả hai host — `info` qua `createPlatformInfo`, `media.resolveSrc` ủy quyền cho `useTmcutMedia`, `encoder` chọn queue desktop hay endpoint render Nitro — và preview engine ([useTmcutPreviewEngine.ts:49](file:///D:/Applications/tm-studio/app/composables/useTmcutPreviewEngine.ts#L49)) cùng modal export ([TmcutExportModal.vue:650](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutExportModal.vue#L650)) đọc capability thay vì sniff `window.electronAPI`.
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
- ADR-018 đã chốt và code xong (2026-11-01): mọi consumer của timeline dùng chung một quy tắc nửa mở `[start, end)` — export chữ `enable='gte(t,start)*lt(t,end)'` ([text.ts:128](file:///D:/Applications/tm-studio/app/utils/tmcut/render/text.ts#L128)), `activeTextClips` đọc layer từ `evaluateTimeline` thay vì tự tính cửa sổ, và playhead ở đúng cuối **nội dung** lùi về đầu frame cuối qua `lastRenderableTicks` ([clipTime.ts:113](file:///D:/Applications/tm-studio/app/utils/tmcut/clipTime.ts#L113)).
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
  - `transitionWindows` phải **nới khai báo** (`track: TmcutTrack | { items?: readonly unknown[] } | null | undefined`) vì `TmcutTrack` của app không phải DSL `TmcutTrack` của core (TS2345 ở [index.ts:151](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts#L151)); nới ở `index.d.ts` chứ không cast `as never` tại chỗ gọi, vì runtime thật sự nhận cả hai shape nhờ `clipSpan`.
  - Gate leg 2: core **461/461**, boundaries PASS, core `tsc` exit 0, typecheck exit 0 / **0** `error TS`, eslint **5 file chạm** exit 0 (sau typecheck), unit **82/82**, electron **59/59**, shared-model **16/16**, parity **14/14**, render-graph **21/21**, 3 guard docs (line-length / link-integrity / citations) exit 0 sau khi sửa tài liệu.
  - **Gate live chạy được lần đầu** (`electron.exe` nghe `:9222`, `:4003` trả `200`): quét 8 route `/tmcut*` qua CDP = **0 exception, 0 console error**, chỉ còn cảnh báo CSP dev-only của Electron — và **một phát hiện ngoài phạm vi render** ghi thành **G17**: `POST /api/v1/auth/refresh` trả `401 (error.refreshTokenInvalid)` ngay sau `/tmcut/autocut`, và lần quét thứ hai thì mọi route đã bị đẩy về `/login` (mất phiên). Thủ phạm khớp hình dạng mã: `let refreshPromise` nằm **trong** `useAuth()` nên mỗi instance có khoá riêng, trái với hai biến module-level kế nó — nhưng **chưa repro được** hai request chồng nhau, nên đó là hypothesis, không phải kết luận.
  - **Slice đóng cơ chế G17 (ngay sau gate live):** promote `refreshPromise` từ trong `useAuth()` lên module scope ([useAuth.ts:57](file:///D:/Applications/tm-studio/app/composables/useAuth.ts#L57)) — `grep -rln "useAuth()" app/` = **25** file, nên bản cũ là 25 khoá song song chứ không phải một. Red-test trước khi sửa: `2 !== 1` request `/auth/refresh` khi instance của component và của plugin cùng refresh (check mới dựng đúng tình huống app: plugin kích hoạt bằng `$fetch` bị 401, `appStatuses = [401, 200]`); sau khi sửa **24/24** và `requests.me === 1`, tức bên đến sau **join** chứ không tự verify lần hai. Share được mà không rò phiên: [auth.global.ts:4](file:///D:/Applications/tm-studio/app/middleware/auth.global.ts#L4) return sớm khi `import.meta.server`, nên `refresh()` không chạy trong SSR. **Chưa kết luận được**: chính lần 401 hôm đó là do race (refresh token của phiên dev cũng có thể đã hết hạn từ trước); bằng chứng ngược chỉ là quét lại **5 route authenticated sau khi sửa** = **0** finding ngoài CSP và session còn nguyên. Slice không thêm chuỗi nào nên không đụng `i18n/`, và không tự nhập credentials.
  - **Slice đóng tên transition bằng phép đo (2026-11-02):** `FFMPEG_XFADE_NAMES` vốn là một bản chép tay từ bảng tài liệu FFmpeg, nên nó có thể lệch khỏi binary thật sự chạy graph mà không ai biết — và một tên sai không phải cảnh báo: `xfade` khởi tạo lỗi là **cả export chết**. [tmcut_fx_catalog.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_catalog.spec.ts) giờ hỏi thẳng `resources/ffmpeg.exe` (=`N-126482-g903325e279-20260909`, advertise **59** tên) và so **set equality** với danh sách **59** tên; **45** entry catalog quy về **44** tên distinct, **0** `custom`. Red-test 5 mutation: (A)/(B) thêm-xoá một tên **chỉ** đỏ ở check mới, (C)/(D) đỏ ở check cũ, (E) regex parse rỗng đỏ vì set equality (nên assertion `>= 50` chưa chứng minh được giá trị thực chiến). Binary được phân giải giống hệt hai host ([server/config/index.ts:36](file:///D:/Applications/tm-studio/server/config/index.ts#L36), [paths.cjs:37](file:///D:/Applications/tm-studio/electron/tools/paths.cjs#L37)); clone chưa có binary in `SKIPPED` thay vì xanh im lặng. Đây là bước đóng nợ "tên FFmpeg lấy từ bảng tài liệu" chứ chưa phải QA pixel của transition.
  - **Nợ phát hiện ngay khi viết tài liệu (đã đóng tại chỗ):** hai dòng audit thêm ở bullet trước **render sai** vì `|` nằm trong code span — GFM chia ô theo mọi `|` chưa escape, nên row 4 cột hoá 6 ô mà không một guard nào báo. Thêm [tmcut_doc_table_shape.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_doc_table_shape.spec.ts) (**3** test: corpus thật, mọi dòng đúng số ô của header, escape được tôn trọng và corpus thật có dùng), unit lên **83/83**; hai dòng lỗi sửa bằng cách **bỏ pipe** chứ không escape nửa vời. Đỏ-test: chèn `a || b` vào row G17 cho `198 has 6 cells, header :180 has 4`, và bỏ bước strip escape làm test 3 đỏ; cả hai file restore byte-identical.
  - **Slice G5 — cầu nối flat↔v3 không được mất field (2026-11-02):** [v1compat.mjs](file:///D:/Applications/tm-studio/packages/core/src/v1compat.mjs) chở flat → DSL v3 rồi sync ngược, nhưng **im lặng bỏ** `mask`, `blend`, `speedPoints` và ba màu chữ của text. Không phải lỗi trình bày: core op nào *sinh clip mới* (paste/duplicate/ripple/split qua `applyV3Edit`) dựng flat item từ patch của bridge, nên clip đó **mất vĩnh viễn** mask + chế độ hoà + speed ramp trong store — và export đọc store. Đo trước khi sửa: view v3 trả `ABSENT` cả ba, paste trả `LOST` cả ba. Sau khi chở đủ 6 field + cho `matchesV3` so chúng thật ([sameMask](file:///D:/Applications/tm-studio/packages/core/src/v1compat.mjs#L299) / [sameRamp](file:///D:/Applications/tm-studio/packages/core/src/v1compat.mjs#L316)), cùng fixture clip 24 s ramp 0,5×→1,5× cho `evaluateTimeline` đổi từ `ramped=false` + `mask=null` + nguồn chạy dọc sang `ramped=true` + `mask=rectangle` + **9,000 s ở giây 12** (lệch −3,000 s ở giữa, −2,250 s ở 25/75%). Preview chưa từng sai vì mask/ramp: [useTmcutPlayback.ts:90](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L90) đưa project phẳng thẳng vào evaluator, evaluator nhận cả hai shape.
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
- **Slice G16 — preview đọc hình học do core sở hữu (2026-11-02, ĐÓNG G16 ở phần hình học):** [transitions.mjs:242](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L242) khai `XFADE_PREVIEW` — đúng **một dòng cho mỗi trong 45** khoá của `KNOWN_TRANSITIONS`, mỗi dòng là `{shape, from, law, fidelity, note}` với `law` lấy từ [XFADE_POSITION_LAWS](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L204) (8 hàm `p → travel`) và hình học/CSS phát ra từ [previewTransitionRamp:383](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L383) dưới dạng **chuỗi CSS thuần** + một số `coverage`, nên [TmcutPreviewPlayer.vue:697](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L697) chỉ còn `xfadeRamp = previewTransitionRamp(cf.type, cf.progress)`; `incomingRamp()` (switch 4 nhánh, nguồn của gap) đã bị xoá và **0** tham chiếu còn lại. Khai báo kiểu ở `packages/core/src/index.d.ts` nên app đọc bảng này có type, không đọc comment.
- **Cách đo từng dòng số liệu:** hai plate đặc đen→trắng qua `xfade=transition=<name>:duration=0.4:offset=0.8` ở `320x180` (`0.8` = cửa hợp lệ `độ dài clip đầu − duration`; slice #82 quét lại toàn bộ **45** khoá trên đúng cửa đó và các con số dưới đây tái hiện không đổi), xuất `rawvideo -pix_fmt gray`, decode **hết** frame, luminance trung bình của 12 frame chuyển tiếp **chính là** phần box clip vào đã phủ (0 và 255 làm phép đo thành tuyệt đối, không cần oracle). Kết quả trên `resources/ffmpeg.exe` (`N-126482-g903325e279-20260909`): **17** khoá `exact` (lệch frame lớn nhất **1.6%**), **19** `shape` (lớn nhất **5.1%**), **9** `approximate`; **4** khoá `circle*`/`radial` trả `coverage = null` vì diện tích bị cắt theo tỉ lệ canvas mà core không biết. Bảng đầy đủ: [v4-phase-0-audit.md §8.1](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md).
- **Hai bất biến preview rút ra được từ phép đo, ghi thành test chứ không thành comment:** (1) player vẽ clip **đến** đè lên clip đi, nên mọi phép reveal phải nằm trên lớp incoming — cắt/mask lớp outgoing chỉ làm lộ nền đen của canvas; bất biến này red-test được bằng cách mutate `corner`/`hole`/`squeeze` về lớp outgoing, và chỉ họ `slide` là được quyền dời cả hai lớp. (2) một mặt trước **mềm** rộng 37–70% trục không thể đạt alpha 0 tại `p=0` và alpha 1 tại `p=1` (CSS kẹp stop ngược thứ tự), nên các key soft-wipe/band vẽ biên cứng và tự khai `fidelity: 'shape'` + `note` nói rõ cái gì mất — thay vì để lộ một mảnh clip đến ở hai đầu mút như bản gradient.
- **Model sửa lại vì chính spec bắt được:** bản đầu của bảng coi `travel` của họ `diag*` là **diện tích** với law `quad` — phép đo 12 frame trả lệch tới **21.4%**, vượt trần `shape` 15%. Fit lại 9 ứng viên law × đường chéo (cả raw lẫn bình phương) trên **ba** canvas (`320x180`, `180x320`, `200x200`) cho thấy diện tích là `travel²` với `travel = inOutQuad(p)` (RMSE **2.3%**, lệch lớn nhất **5.1%**), và đường cong diện tích **không đổi** giữa ba canvas (trải **0.10%**) — vì mặt trước là đường 45° theo **tỉ lệ**, không theo pixel. Law `quad` vì thế bị bỏ khỏi `XFADE_POSITION_LAWS` (không còn khoá nào dùng), và spec giờ kiểm luôn tính bất biến aspect-free thay vì biện luận tay như với `circleopen`.
- **`squeezev` KHÔNG phải lỗi đặt tên — và slice #81 chỉ ra rằng nó cũng không phải "lỗi binary" vô điều kiện:** bản đo cũ (probe plate `d=1.2`, `duration=0.4`, `offset=0.6`) in ra **28/60** frame rồi chết `0xC0000005`, trong khi `squeezeh` đi hết 60 frame, nên registry ghi `unavailable` và cả preview lẫn export vẽ fade thường. Phép đo lại chỉ đổi **một** tham số: cửa hợp lệ của hai plate 1.2 s là `offset=0.8`, không phải `0.6`. Ở cửa hợp lệ, `squeezev` chạy **xong 60/60 frame, exit 0** — cả từ plate lavfi, cả từ file mp4, và cả từ filtergraph `compileTimelineToFfmpeg` sinh ra ở `320x180` lẫn `1920x1080`; ở cửa sai thì nó chết **4/4** lần và số frame nó kịp xuất ra thay đổi giữa các lần (22 / 23 / 27), đúng dáng của một lỗi đọc ngoài biên chứ không phải một quyết định từ chối của filter. Ba giả nhân khác bị đo và loại: `format=yuv420p`, `settb=AVTB`/`settb=1/30`+`fps=30`, nguồn lavfi-vs-mp4. Phần bỏ ngỏ — hình học thật của nó trên cửa hợp lệ — slice **#82** đã đo, và nó **không** vẽ fade: xem bullet #82. Con số 28/60 nói trên vẫn là probe sống trong [tmcut_transition_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_transition_preview.spec.ts), nhưng file đó giờ assert **cả hai phía** của đường ranh giới cửa (chết ở `0.6`, in đủ frame ở `0.8`) thay vì chỉ phía sai
- **Slice #80 đóng nốt phía export của G16 — và sửa luôn một giả định sai:** [video.ts:23](file:///D:/Applications/tm-studio/app/utils/tmcut/render/video.ts#L23) `mapXfadeTransition` đưa tên vừa giải ra qua [renderableXfadeName](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L511), nên một khoá bị đo `unavailable` phát `fade` với **đúng** duration và offset cũ — timeline không dịch chỗ nào, và graph không còn tự chọn một cái tên mà registry đã đo là không vẽ được — Ghi lại cả giả định sai: **không** cần chuỗi UI mới, vì cách xử lý đúng là vẽ đúng cái preview đã vẽ (fade), không phải báo lỗi bằng một câu chữ khác; guard mới chạy ở **cả ba** tầng — core (mọi khoá đều trả tên render được, và chỉ `squeezev->fade` bị degrade), compile graph (`xfade=transition=fade`, không còn chuỗi `squeezev`), và FFmpeg thật (chain sau khi degrade phải xuất đủ 12 frame trên đúng hai plate). Phép đo live: dev server standalone serve đúng module đã nối dây, và **5/5** route tmcut sạch console, **nhưng** cả năm route dừng ở `/login` vì không có phiên hub — wiring được xác nhận ở bundle đang chạy, chưa phải ở một transition thật. **Rút lại ở #82:** cả tầng degrade `unavailable -> fade` đó đã bị **xoá**, vì không khoá nào trong catalogue bị từ chối trên cửa hợp lệ
- **Và một câu của #80 phải rút lại, vì nó hóa ra là lỗi cửa transpose chứ không phải "binary từ chối tên":** probe G16 dùng `d=1.2` + `duration=0.4` + `offset=0.6`, trong khi cửa hợp lệ của xfade là `offset = độ dài clip đầu − duration = 0.8`. Đổi đúng một tham số đó: `squeezev` chạy **xong 60/60 frame, exit 0** — từ plate lavfi, từ file mp4 thật, và từ filtergraph mà `compileTimelineToFfmpeg` sinh ra ở cả `320x180` lẫn `1920x1080`. Ở cửa sai nó chết **4/4** lần chạy và số frame kịp xuất ra **không ổn định** (22 / 23 / 27), đúng dáng một phép đọc ngoài biên hơn là một quyết định từ chối. Ba giả nhân khác đã đo và loại: `format=yuv420p` trước xfade, `settb=AVTB`/`settb=1/30` + `fps=30`, và nguồn lavfi-vs-mp4. **#82 đã trả lời câu hỏi đó:** trên cửa hợp lệ `squeezev` là squeeze với mặt trước chạy dọc `x`, `fidelity: exact` (0.3% / 12-12 frame); `unavailable` và tầng degrade bị xoá — xem bullet #82 ngay dưới.
- **Slice #81 — parity pixel của một project thật, không chỉ của một chuỗi lọc (V4 G2, 2026-11-02):** [tmcut_render_smoke.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_smoke.spec.ts) giờ dựng **hai plate đặc** (đen → trắng) thành **một project hai clip** rồi đưa qua `compileTimelineToFfmpeg`, tức thứ được chấm là pipeline mà export thật chạy (container, encoder, hai lane audio), không phải một `[0:v][1:v]xfade=…` nối tay. Số đo của `wipe-left`: diện tích lệch **0.3%** so với `coverage` của model, và vì diện tích của một cú wipe **trùng từng điểm** với của một cú crossfade, block này chấm thêm **vị trí** — cột trái/giữa/phải lệch **0.8% / 1.2% / 1.3%** trong trần **3%**, với đường bao kỳ vọng đọc từ chính `clipPath` mà [previewTransitionRamp](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L383) trả về chứ không viết tay trong test. Test cũng tự chứng minh nó phân biệt được: cùng project đó chạy `fade` rồi chấm theo model của wipe ra **74.9% / 33.3% / 75.3%**, và con số đó nằm trong một assert `> 15%` — nếu một ngày phép chấm cột không còn tách được wipe khỏi fade thì smoke đỏ thay vì âm thầm vô dụng.
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
- **Gate của #83–#84 và hai chỗ vẫn blocked (2026-11-03):** core **505/505** (`fail 0`), unit **83/84** — fail duy nhất là guard link docs, đỏ vì `docs/user-guide.md` bị xoá trong working tree của **owner** (HEAD vẫn có file, nên không phải lỗi slice này; slice không đụng `extraction-plan.md`), `nuxt typecheck` **BLOCKED** với **3** `error TS2321` nằm trọn ở `app/composables/useHub.ts:51` (WIP owner, **0** error ở mọi file khác — không sửa/stash để làm gate im lặng), ESLint **0** problem trên **6** file chạm chạy **sau** khi typecheck sinh lại `.nuxt/eslint.config.mjs`. Live bằng `dev:electron` của user (`:4003` HTTP 200): module core mà dev server đang serve chứa `XFADE_COMB_PERIOD` + `combTooth`, và khớp source từng dòng ở `SOFT_EDGE` (291) cùng `previewTransitionRamp` (454) — geometry mới nằm trong bundle thật, không chỉ trong file.
    Hai chi tiết probe đáng ghi: URL phải là `/_nuxt/@fs/D:/.../transitions.mjs`, vì `/@fs/...` không prefix trả về **200 kèm SPA shell** (thân HTML, 0 symbol) nên một probe quên prefix sẽ kết luận sai là geometry chưa được serve; và `renderableXfadeName` **0** lần trong module core đang serve, còn `render/video.ts` đang serve có `mapXfadeTransition` trả đúng `xfadeNameFor(type)` — tức cả phía #83 cũng nằm trong bundle chạy thật.
    CDP của chính app tm-studio là `:9223` (User-Agent `tm-studio/0.1.0 Electron/44.10.0`), **không phải** `:9222` (app đó là tm-tools, `tm-tools/1.0.0`); nhưng cửa sổ `:9223` đang mở dashboard tm-tools ở `:4002`, nên không đọc console renderer của tm-studio được — đọc console ở đó là bằng chứng của app khác, và điều hướng cửa sổ user đang dùng thì không phải đọc-không. **Chưa chứng minh:** transition trên footage thật, DOM của card trong browser, cú bấm render thật, packaged build.

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

- Xây `renderAt(timestamp)`.
- Xây DOM renderer.
- Xây frame scheduler.
- Render text, image, SVG, shape.
- Preview và export gọi cùng timeline evaluator.
- Tạo golden-frame tests.

**Acceptance criteria:**

- Render được composition mẫu ở timestamp tùy chọn.
- Kết quả không phụ thuộc wall-clock.
- Seek đến timestamp bất kỳ trong composition.
- Không dùng `sleep()` làm cơ chế frame timing.

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
- Native process manager.
- TMCut Agent.
- yt-dlp integration.
- Optional FFmpeg adapter.
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
12. **Không biến FFmpeg filter graph thành abstraction trung tâm mới.** Effects nên có model độc lập; backend chỉ là implementation.
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
| ADR-006 | FFmpeg optional backend | Giữ khả năng tương thích native khi cần |
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
- FFmpeg là backend tùy chọn, không phải nền tảng bắt buộc của rendering architecture.

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
