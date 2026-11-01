# TMCut Studio — Asset Sources Catalog & Integration Plan

> **Trạng thái:** ACTIVE — tài liệu tham chiếu cho TMCut Studio (repo `tm-studio`) và tm-hub Connections Admin
> **Ngày tạo:** 2026-10-31
> **Phạm vi:** Danh mục nguồn tài nguyên (ảnh / video / audio / hiệu ứng / template) được phép dùng thương mại, kèm hướng tích hợp kỹ thuật vào TMCut Studio.
> **Liên quan:** `tmcut-v4-universal-rendering-multiplatform-roadmap.md` · `extraction-plan.md` · `docs/ai-and-hub-connections.md`
> **Nguyên tắc:** Mọi nguồn có API key **không được** để credential rời hub — tm-studio chỉ gọi qua `useHub().hubFetch` tới endpoint proxy của hub (đúng mô hình đã dựng cho Pexels/Pixabay stock search). Nguồn keyless (Openverse) gọi trực tiếp, vẫn cần disclaimer license.

---

## 1. Chính sách license (tóm tắt bắt buộc tuân thủ)

| Nhóm license | Ý nghĩa | Ghi công? | Dùng thương mại? | Sửa đổi? |
|---|---|---|---|---|
| **CC0 / Public Domain** | Tác giả từ bỏ quyền | Không | Có | Có |
| **Pexels License** | Miễn phí, thương mại OK | Không (khuyến khích) | Có | Có (không bán lại nguyên bản) |
| **Pixabay Content License** | Miễn phí, thương mại OK | Không | Có | Có (không bán lại nguyên bản) |
| **Unsplash License** | Miễn phí, thương mại OK | Không (khuyến khích) | Có | Có (không bán lại nguyên bản / không build competing service) |
| **Mixkit Free License** | Miễn phí cho web/online ads | Không | Có (trừ TV/Radio/Game/CD/DVD) | Có |
| **ZapSplat Free** | Miễn phí có điều kiện | **Bắt buộc credit** | Có | Có |
| **CC BY** | Miễn phí | **Bắt buộc credit** | Có | Có |
| **CC BY-SA** | Miễn phí | **Bắt buộc credit** | Có | Có — tác phẩm phái sinh cùng license |
| **YouTube Audio Library** | Copyright-safe cho YouTube | Tùy bản nhạc | Có (trong YT) | Có |

**Quy tắc vận hành trong TMCut Studio:**

1. UI luôn hiển thị badge license trên mỗi asset (`CC0` · `Attribution Required` · `Pexels License`…).
2. Khi user kéo asset vào timeline, nếu license yêu cầu credit → tự sinh `attribution.txt`/dòng credit trong `Export Metadata` (roadmap Phase 5 export pipeline).
3. Attribution format mặc định: `"<Tên asset> by <Tác giả> — <Tên nguồn> (<License URL>)"`. Có thể cấu hình mẫu trong Settings.
4. Không cho phép hiển thị/áp dụng asset nếu user bật preset "commercial-safe only" và asset không thỏa.

---

## 2. Nguồn ảnh (Images)

### 2.1 Nguồn chính — API keyless hoặc key-gated

| # | Nguồn | URL | License | API? | Key? | Ghi chú tích hợp |
|---|---|---|---|---|---|---|
| I1 | **Unsplash** | https://unsplash.com | Unsplash License | Có (`api.unsplash.com`) | **Có** (`client_id`) | Rate limit 50 req/h demo; production cần approval. Proxy qua hub. |
| I2 | **Burst (Shopify)** | https://burst.shopify.com | CC0 | Không | Không | Scrape-safe theo ToS; khuyến nghị chỉ hiển thị attribution optional. |
| I3 | **Picjumbo** | https://picjumbo.com | Free for commercial | Không | Không | Không bán lại / không re-upload nguyên bản. |
| I4 | **StockSnap** | https://stocksnap.io | CC0 | Có (REST) | Không | API đơn giản, không cần key. Có thể gọi trực tiếp. |
| I5 | **Kaboompics** | https://kaboompics.com | Free for commercial | Không | Không | Cần attribution "optional nhưng khuyến khích". |
| I6 | **Life of Pix** | https://lifeofpix.com | Free for commercial | Không | Không | Ảnh do studio Pháp đóng góp; chất lượng cao. |
| I7 | **PxHere** | https://pxhere.com | CC0 | Không | Không | Ảnh tổng hợp — cần kiểm tra kỹ từng ảnh (một số có model release). |
| I8 | **Pixnio** | https://pixnio.com | Public Domain | Không | Không | — |
| I9 | **LibreShot** | https://libreshot.com | CC0 | Không | Không | — |
| I10 | **Skitterphoto** | https://skitterphoto.com | CC0 | Không | Không | Cập nhật hàng ngày. |
| I11 | **Dreamstime CC0** | https://dreamstime.com/cc0 | CC0 | Không | Không | Chỉ filter section CC0; phần trả phí không dùng. |
| I12 | **WordPress Photo Directory** | https://wordpress.org/photos | CC0 | Có (WP REST) | Không | Truy cập qua `wordpress.org/photos/wp-json/...`; ổn định, keyless. |
| I13 | **Snappygoat** | https://snappygoat.com | Meta-search (CC0/PD) | Không (scrape) | Không | Dùng như công cụ tổng hợp, không phải nguồn gốc. |

### 2.2 Công cụ tổng hợp (meta-search)

| # | Công cụ | URL | License filter | Ghi chú |
|---|---|---|---|---|
| M1 | **Openverse** | https://openverse.org | Có filter license (`cc0`, `by`, `by-sa`…) | API keyless `api.openverse.org/v1/images/` — đã dùng trong `stockProviders.ts` hiện tại. Rate limit nhẹ. |
| M2 | **Flickr (CC filter)** | https://flickr.com/search | Filter `license=1,2,4,5,9,10` cho commercial use | API cần key (`api_key`). **Không dùng chung credential với các nguồn khác**; proxy qua hub. |

> **Lưu ý Openverse:** Có cả ảnh và audio. `stockProviders.ts` hiện đã tích hợp cho ảnh (`source=openverse`, keyless). Có thể mở rộng audio cùng endpoint.

### 2.3 Trạng thái tích hợp hiện tại trong TMCut Studio

Theo `extraction-plan.md` mục **"TMCut stock library"**:

- `utils/tmcut/stockProviders.ts` đã có: `buildStockRequest` (hỗ trợ `deferAuth` cho hub proxy), `buildStockFeedRequest` (Pexels curated / Pixabay editors' choice / **Openverse newest CC**), `stockHasMore` (phân trang), `stockPageSize`.
- `composables/useTmcutStock.ts`: preload feed + infinite scroll + token chống race.
- Hub endpoint: `tm-hub/server/api/v1/apps/[id]/connections/[provider]/stock-search.post.ts` — chỉ nhận URL thuộc endpoint search/curated/popular của provider, inject auth, timeout 15s, cap 2 MiB.
- **Nguồn đang active:** Openverse (keyless, luôn hiện). Pexels/Pixabay chỉ hiện khi `connection.status === 'connected'`.

**Cần bổ sung cho các nguồn I1–I13 + M2:**

- Mở rộng allowlist provider trong `stock-search.post.ts` cho: `unsplash`, `stocksnap`, `wordpress-photo`, `flickr`.
- Thêm entry trong `stockProviders.ts` cho từng nguồn (URL builder + `hasMore` parser).
- Provider definitions trong hub (`/apps/:id/connections`) — thêm provider mới cho các nguồn có key.

---

## 3. Nguồn Video Stock

| # | Nguồn | URL | License | API? | Key? | Ghi chú tích hợp |
|---|---|---|---|---|---|---|
| V1 | **Mixkit** | https://mixkit.co/free-stock-video | Mixkit Free License | Không | Không | Không dùng cho TV/Radio/Game/CD/DVD — phải hiển thị disclaimer trong UI khi user chọn "Broadcast use". |
| V2 | **Coverr** | https://coverr.co | Free for commercial | Có (REST) | Không | Tốt cho background loopable; API keyless. |
| V3 | **Videvo** | https://videvo.net | Đa license (Royalty-Free / CC3) | Có | **Có** (partner key) | **Cần đọc từng clip** — cùng site có clip CC3 (yêu cầu credit) và clip chỉ free cho editor. Không đưa vào "commercial-safe only" mặc định. |
| V4 | **Life of Vids** | https://lifeofvids.com | CC0 | Không | Không | — |
| V5 | **LoveYouMotion** | https://loveyoumotion.com | Free commercial, no watermark | Không | Không | Thư viện tổng hợp (stock + template + music + SFX + green-screen). ToS cho phép dùng không cần credit. |

### 3.1 Hiện trạng trong codebase

Chưa có module video stock riêng trong `server/api/v1/stock` hiện tại (theo `extraction-plan.md`, `api/v1/stock/**` đã chuyển sang `tm-studio` nhưng chỉ xử lý ảnh). Đề xuất mở rộng:

- Thêm `server/api/v1/stock/video-search.post.ts` mirror cơ chế `stock-search.post.ts` của ảnh.
- Thêm `mediaKind: 'video' | 'image'` vào `stockProviders.ts` để `buildStockRequest` sinh URL đúng endpoint video.
- Cache metadata video (duration, codec) để tránh tải lại khi user kéo vào timeline.

---

## 4. Nguồn Nhạc & Hiệu ứng âm thanh (SFX)

| # | Nguồn | URL | License | API? | Key? | Ghi chú tích hợp |
|---|---|---|---|---|---|---|
| A1 | **YouTube Audio Library** | https://studio.youtube.com (Audio Library) | YouTube-safe; có bản CC BY | Không (chỉ UI) | Không | **Không có API công khai** — chỉ dùng thủ công. Nếu tích hợp, phải scrape-safe hoặc để user import file. Chỉ dùng cho video đăng YouTube; **cảnh báo** nếu export cho mục đích khác. |
| A2 | **Pixabay Music/SFX** | https://pixabay.com/music · /sound-effects | Pixabay Content License | Có (music API) | **Có** | Proxy qua hub. Cùng endpoint pattern Pexels/Pixabay. |
| A3 | **Mixkit Music/SFX** | https://mixkit.co/free-stock-music · /free-sound-effects | Mixkit Free License | Không | Không | Cùng disclaimer broadcast như V1. |
| A4 | **ZapSplat** | https://zapsplat.com | Free tier **bắt buộc credit** | Có (REST) | **Có** | UI phải hiển thị "Attribution required" + auto-gen credit line khi export. |
| A5 | **Unminus** | https://unminus.com | Free commercial, remix OK | Không | Không | — |
| A6 | **SFX Kit (GitHub)** | https://github.com/... (320 SFX gốc) | CC0 | Không | Không | Có thể bundle sẵn vào app (`resources/`) làm "SFX starter pack" không cần internet. |

### 4.1 Đề xuất tích hợp

- **Bundled SFX (offline):** Đóng gói SFX Kit + một số asset CC0 vào `resources/sfx/` để TMCut Studio dùng được khi offline (desktop).
- **Online catalog:** `useTmcutAudio` composable tương tự `useTmcutStock`; preload list, lazy load preview.
- **Audio preview trong editor:** Web Audio API decode + preview ngay trong media panel; cache trong OPFS.
- **Attribution auto-gen:** Với ZapSplat/CC BY, ghi credit vào `project.attributions[]` để export pipeline đọc.

---

## 5. Nguồn Hiệu ứng Video (Overlays, Transitions) & Template

| # | Nguồn | URL | Loại | License | Ghi chú tích hợp |
|---|---|---|---|---|---|
| E1 | **FX Elements** | https://fxelements.com | VFX overlay (light leaks, film grain, dust, bokeh) | Free tier riêng | Cần account free; gói free giới hạn số download/tháng. Proxy qua hub cho credential (nếu có API key). |
| E2 | **Mixkit Overlays & Transitions** | https://mixkit.co/free-stock-video (filter overlay/transition) | Overlay, transition, title template | Mixkit Free License | Cùng disclaimer broadcast như V1. |
| E3 | **Videezy** | https://videezy.com | Overlay (After Effects, template) | Đa license | Như V3 — phải lọc từng clip. |
| E4 | **Jitter** | https://jitter.video | Motion template (Figma-like) | Free tier có giới hạn export | Không có API public; user export MP4/Lottie thủ công rồi import vào TMCut. |
| E5 | **LottieFiles** | https://lottiefiles.com | Lottie animation (JSON) | Đa license (nhiều bản CC0/MIT) | API có (partner); keyless public JSON download OK. `lottie-web` render trực tiếp trong timeline. |
| E6 | **SVGator** | https://svgator.com | Animated SVG template | Free commercial | Export SVG/Lottie/GIF/MP4 (nền trong suốt) — import qua media panel. |
| E7 | **Typoanim** | https://typoanim.com | Text/title template (AE/PR) | Free, no watermark | Export là file `.aep`/`.prproj` — **không dùng trực tiếp trong web**. Chỉ hữu ích nếu user có Adobe; không tích hợp vào TMCut. |

### 5.1 Hiện trạng trong codebase

Theo `extraction-plan.md`, `components/tmcut/TmcutFxThumb.vue` (mới) đã có thumbnail CSS-only cho FX registry, nhóm theo category, chọn card 2 cột. Registry hiện có **effect definitions** nội bộ, chưa gắn với nguồn ngoài.

**Đề xuất mở rộng plugin registry (roadmap Phase 8):**

- `packages/effects/src/registry.ts` — đăng ký effect từ 3 nguồn:
  1. **Built-in** — shader viết trong repo (`renderer-webgl/effects/*.ts`).
  2. **gl-transitions** — import shader string từ bộ sưu tập MIT.
  3. **Remote catalog** — qua hub, fetch metadata + shader URL (asset tải về cache OPFS).
- Mỗi effect record: `{ id, source, license, attribution?, paramsSchema, shaderUrl }`.
- UI inspector hiển thị badge license như stock ảnh.

---

## 6. Capability Matrix — Tích hợp theo Runtime

| Nguồn | Runtime áp dụng | Cần credential | Proxy hub? | Offline bundle? |
|---|---|---|---|---|
| Unsplash | Web + Desktop | Có | Có | Không |
| Burst | Web + Desktop | Không | Không | Không |
| Picjumbo | Web + Desktop | Không | Không | Không |
| StockSnap | Web + Desktop | Không | Không | Không |
| Kaboompics | Web + Desktop | Không | Không | Không |
| Life of Pix | Web + Desktop | Không | Không | Không |
| PxHere | Web + Desktop | Không | Không | Không |
| Pixnio | Web + Desktop | Không | Không | Không |
| LibreShot | Web + Desktop | Không | Không | Không |
| Skitterphoto | Web + Desktop | Không | Không | Không |
| Dreamstime CC0 | Web + Desktop | Không | Không | Không |
| WordPress Photo Dir. | Web + Desktop | Không | Không | Không |
| Snappygoat | Web + Desktop | Không | Không | Không |
| **Openverse** | Web + Desktop | **Không** | **Không** (keyless) | Không |
| Flickr | Web + Desktop | Có | Có | Không |
| Mixkit (video/music/overlay) | Web + Desktop | Không | Không | **Có (bundle một phần)** |
| Coverr | Web + Desktop | Không | Không | Không |
| Videvo | Web + Desktop | Có | Có | Không |
| Life of Vids | Web + Desktop | Không | Không | Không |
| LoveYouMotion | Web + Desktop | Không | Không | Không |
| YouTube Audio Library | Desktop (manual import) | Không | Không | Không |
| Pixabay Music/SFX | Web + Desktop | Có | Có | Không |
| ZapSplat | Web + Desktop | Có | Có | Không |
| Unminus | Web + Desktop | Không | Không | Không |
| SFX Kit (GitHub) | Web + Desktop | Không | Không | **Có (bundle toàn bộ)** |
| FX Elements | Web + Desktop | Có | Có | Không |
| Videezy | Web + Desktop | Có | Có | Không |
| Jitter | Desktop (manual import) | Không | Không | Không |
| **LottieFiles** | Web + Desktop | Không (public JSON) | Không | Không |
| SVGator | Desktop (manual import) | Không | Không | Không |
| Typoanim | Desktop (manual import, AE/PR) | Không | Không | Không |

---

## 7. Kiến trúc tích hợp (Implementation Notes)

### 7.1 Luồng chuẩn cho nguồn có credential
