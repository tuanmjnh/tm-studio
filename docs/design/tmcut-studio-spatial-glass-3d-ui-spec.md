# TMCut Studio — Đặc tả Giao diện Spatial 3D Glassmorphism (Dark & Light Mode), Bộ Prompt Google Stitch & Kiến trúc Nuxt UI v4 + Three.js

> **Trạng thái:** ACTIVE — Tài liệu chuẩn thiết kế & triển khai UI/UX (Bản đầy đủ thay thế toàn bộ bản cũ)
> **Cập nhật lần cuối:** 2026-10-31
> **Áp dụng cho:** `tm-studio` (`D:\Applications\tm-studio`, port 4003, App ID `tm-studio_749app`)
> **Nền tảng kỹ thuật:** Nuxt 4 + Vue 3 + **Nuxt UI v4** + **Tailwind CSS v4** + Three.js (TresJS) + Electron

---

## 1. Triết lý Thiết kế Spatial 3D Glassmorphism (Hỗ trợ Dual-Theme: Dark & Light)

Giao diện của **TMCut Studio** được xây dựng trên nền tảng **Nuxt UI v4 + Tailwind CSS v4**, hỗ trợ chuyển đổi mượt mà giữa **Dark Mode (Obsidian Frosted Glass)** và **Light Mode (Daylight Crystal Acrylic)** kết hợp các vật thể 3D khúc xạ ánh sáng bằng **Three.js**.

### 1.1. Nguyên tắc cốt lõi
1. **Single Source of Truth trong `app/app.config.ts`:** Toàn bộ màu sắc của ứng dụng được quản lý tập trung qua 7 semantic tokens của Nuxt UI v4 (`primary`, `secondary`, `neutral`, `info`, `success`, `warning`, `error`). Tuyệt đối không hard-code mã màu rời rạc trong từng component.
2. **Adaptive Dual-Theme Glass 3D:**
   - **Dark Mode (`dark`):** Nền `zinc-950` (`#09090B`), lớp kính mờ tối (`bg-elevated/65`, `border-white/10`), phản quang đỉnh viền sáng nhẹ, vật thể 3D Three.js phát sáng nội tại màu `violet` và `teal`.
   - **Light Mode (`light`):** Nền trắng sáng `zinc-50` (`#FAFAFA`), lớp kính pha lê trắng trong (`bg-white/75`, `border-zinc-200/80`), đổ bóng мягкий (`shadow-zinc-950/5`), nút bấm `TMCut` và trạng thái Active mang sắc tím dịu (`bg-violet-500/10 text-violet-600`).
3. **Phân tách 2 Chế độ Bố cục (Dual-Layout Architecture):**
   - **Console / Dashboard Layout (`default.vue`):** Dùng cho Trang chủ (`/`), Tài nguyên (`/resources/*`) và Hệ thống (`/system/*`). Giữ thanh Sidebar kính mờ cố định bên trái (`260px`) và sử dụng trọn vẹn hiệu ứng Three.js 3D ở lớp nền + các thẻ Bento.
   - **Studio Full-Bleed Layout (`studio.vue`):** Dùng cho toàn bộ 8 phân hệ sản xuất trong `/tmcut/*`. **Loại bỏ hoàn toàn Sidebar cố định bên trái** để dành 100% diện tích ngang cho Preview Canvas, Inspector và Timeline. Toàn bộ cây điều hướng được gom vào một **Floating 3D Glass Popover Menu (`TmcutNavPopover.vue`)** mở ra từ nút bấm góc trên bên trái.
4. **Cách ly Ngữ cảnh GPU (WebGL Context Isolation):** Three.js chỉ hoạt động ở các màn hình Dashboard/Hub. Khi người dùng vào trình dựng phim (`/tmcut/editor`), vòng lặp render của Three.js tự động tạm dừng (`pause`/`dispose`) để nhường 100% băng thông GPU cho **Unified Rendering Engine (WebGL2/WebGPU)** và **WebCodecs**.

---

## 2. Cấu trúc Màu sắc Tập trung (Nuxt UI v4 `app.config.ts` & Tailwind CSS v4)

### 2.1. Bảng 7 Semantic Colors Chuẩn của Dự án
| Vai trò (`ui.colors`) | Tên Palette | Ứng dụng trong TMCut Studio |
|---|---|---|
| `primary` | **`violet`** | Thương hiệu chính, nút CTA (`TMCut`, `Export`), mục menu đang chọn (Active pill), liên kết `Mở ->`, nhóm công cụ AI |
| `secondary` | **`indigo`** | Điểm nhấn phụ, dải chuyển sắc (gradient) của khối kính 3D, nút chức năng phụ |
| `neutral` | **`zinc`** | Toàn bộ bề mặt nền (`bg-default`, `bg-muted`, `bg-elevated`), khung kính, chữ (`text-highlighted`, `text-muted`) và đường viền (`border-default`) |
| `info` | **`cyan`** | Thông báo hệ thống, thẻ metadata, trạng thái đồng bộ đám mây |
| `success` | **`teal`** | Biểu tượng Wi-Fi kết nối TM Hub góc trên Sidebar, đèn chấm tròn trạng thái `System Root`, kim chỉ Playhead trên Timeline, tiến trình hoàn tất |
| `warning` | **`yellow`** | Cảnh báo hiệu năng GPU/Proxy, giới hạn quota, trạng thái đang chờ |
| `error` | **`red`** | Lỗi render/export, mất kết nối Hub, hành động xóa nguy hiểm |

### 2.2. Ánh xạ Bề mặt Kính theo Chế độ Sáng / Tối (Dark vs Light Surface Matrix)

| Thành phần UI | Nuxt UI v4 Semantic Class | Hiển thị ở Dark Mode (`Dark.PNG`) | Hiển thị ở Light Mode (`Light.PNG`) |
|---|---|---|---|
| **Nền tổng thể (App Canvas)** | `bg-default text-default` | `#09090B` (Zinc 950) / Chữ trắng sáng | `#FFFFFF` – `#FAFAFA` (Zinc 50) / Chữ Zinc 900 |
| **Thanh Sidebar & Top Bar** | `bg-elevated/70 backdrop-blur-xl border-default` | Kính đen mờ `zinc-900/70`, viền `zinc-800` | Kính trắng mờ `white/80`, viền `zinc-200` |
| **3 Thẻ Bento (`TMCut`, `Kết nối`, `Két khóa AI`)** | `bg-elevated/60 backdrop-blur-xl border-default hover:border-primary/50` | Nền kính tối `zinc-900/60`, viền mảnh bắt sáng | Nền kính trắng `white/90`, viền `zinc-200/90`, bóng đổ nhẹ |
| **Hộp Icon 3D trong Thẻ** | `bg-primary/10 text-primary ring-1 ring-primary/20` | Nền tím trầm `violet-500/15`, icon `violet-400` | Nền tím sáng `violet-50`, icon `violet-600` |
| **Mục Menu Active (`Trang chủ`)** | `bg-primary/10 text-primary font-medium` | Thanh pill kính tím phát sáng nhẹ trên nền tối | Thanh pill tím pastel dịu (`violet-500/10`) chữ tím đậm |
| **Nút bấm Header `TMCut`** | `<UButton color="primary" variant="subtle" />` | Nền tím kính tối, chữ và icon tím sáng | Nền tím nhạt `violet-100/80`, chữ `violet-700` |
| **Icon Wi-Fi Kết nối Hub** | `text-success` (`teal`) | Xanh ngọc phát sáng (`teal-400`) | Xanh ngọc rõ nét (`teal-500`) |

---

## 3. Bộ Prompt Chuẩn cho Google Stitch (`https://stitch.withgoogle.com`)

> **Hướng dẫn sử dụng:** Bạn có thể đính kèm trực tiếp ảnh `Dark.PNG` hoặc `Light.PNG` vào Google Stitch và dán các đoạn prompt dưới đây để AI sinh ra thiết kế chuẩn xác với hệ màu Nuxt UI v4 của dự án.

### 3.1. Prompt 1A: Màn hình Trang chủ Dashboard — Chế độ Tối (Dark Mode Glass 3D)

```text
Design a desktop application dashboard in DARK MODE for "TMCut Studio" (v0.1.0), an AI video editing and production platform built with Nuxt UI v4 and Tailwind CSS v4, using a Spatial 3D Glassmorphism aesthetic.

NUXT UI v4 SEMANTIC COLOR SYSTEM (DARK MODE):
- Neutral Surface (zinc): Deep zinc-950 (#09090B) canvas, frosted zinc-900/65 glass panels, 1px specular zinc-800/80 borders with top-left white/15% light reflection.
- Primary (violet): Electric violet (#7C3AED / #8B5CF6) for active navigation pills, card icon badges, "Mở ->" links, and the top-right "TMCut" button.
- Secondary (indigo): Indigo (#6366F1) for secondary 3D light refraction.
- Success (teal): Glowing teal (#14B8A6 / #2DD4A8) for the top-left Wi-Fi status icon and bottom-left "System Root" online indicator.
- Info (cyan), Warning (yellow), Error (red).
- Typography: Inter Variable for UI, JetBrains Mono for "v0.1.0" and "CTRL K".

1. LEFT EXPANDED GLASS SIDEBAR (260px width, dark frosted acrylic, 24px blur):
- Header: "TMCut Studio v0.1.0" on left, glowing Teal (success) Wi-Fi icon on right.
- Search bar: Recessed dark glass input "Tìm kiếm" with "CTRL K" mono badge.
- Active Root Item: "Trang chủ" highlighted with a translucent violet (primary/15) glass pill and violet home icon.
- Expandable Group 1 — "TMCut" (8 sub-items): "Bảng điều khiển TMCut", "Trình chỉnh sửa", "Mẫu & Preset", "AutoCut AI", "Studio HTML/CSS", "Studio giọng nói", "Quy trình sản xuất", "Video Factory".
- Expandable Group 2 — "Tài nguyên" (3 sub-items): "Kết nối", "Thông báo", "Hộp thư".
- Expandable Group 3 — "Hệ thống" (5 sub-items): "Hồ sơ", "Tài liệu API", "Cài đặt", "Két khóa AI", "Kết Nối TM Hub".
- Footer: User profile "System Root" with avatar and up/down chevron.

2. TOP HEADER & MAIN STAGE (Three.js + 3 Bento Glass 3D Cards):
- Top Header: Sidebar toggle icon, title "Trang chủ" and subtitle "Không gian biên tập video và sản xuất bằng AI của bạn". Right side has a soft violet glass button "TMCut", notification bell, and settings gear.
- Ambient Three.js Layer: Subtle real-time 3D refractive glass shapes floating in the dark zinc background casting soft violet and indigo glow.
- 3 Bento 3D Glass Cards in a 3-column row (Frosted dark zinc glass, 20px blur, 1px specular gradient border, interactive 3D Three.js violet glass icon inside a rounded square badge on the top-left, title, description, and violet "Mở ->" action link):
  * Card 1: Title "TMCut", Description "Dự án, editor, AutoCut và công cụ AI trong một workspace", with a 3D refractive violet glass clapperboard icon.
  * Card 2: Title "Kết nối", Description "Kết nối nhà cung cấp AI và dịch vụ cho studio sử dụng", with a 3D refractive violet/indigo glass plug node icon.
  * Card 3: Title "Két khóa AI", Description "Lưu khóa nhà cung cấp dạng mã hóa cho quy trình của studio", with a 3D refractive violet/teal glass brain-key icon.
```

---

### 3.2. Prompt 1B: Màn hình Trang chủ Dashboard — Chế độ Sáng (Light Mode Crystal Glass 3D)

```text
Design the exact same desktop application dashboard in LIGHT MODE (Daylight Frosted Crystal Glass aesthetic) for "TMCut Studio" (v0.1.0), following the Nuxt UI v4 semantic color system.

NUXT UI v4 SEMANTIC COLOR SYSTEM (LIGHT MODE):
- Neutral Surface (zinc): Pure daylight zinc-50 (#FAFAFA to #FFFFFF) background canvas, translucent white/80 frosted crystal glass cards, crisp 1px zinc-200/80 borders with pearlescent white inner highlights and soft ambient shadows (rgba(9,9,11,0.04)). Text in sharp zinc-900 and muted zinc-500.
- Primary (violet): Soft violet-500/10 pill backgrounds with vibrant violet-600 (#7C3AED) text and icons for the active "Trang chủ" menu item, the 3 card icon boxes, "Mở ->" links, and the top-right "TMCut" subtle button.
- Secondary (indigo) & Info (cyan): Subtle refractive caustics inside the 3D glass icons.
- Success (teal): Crisp teal-500 (#14B8A6) Wi-Fi status icon in the sidebar header.

LAYOUT & 3D CRYSTAL GLASS DETAILS:
- Left Sidebar (260px): Translucent white/75 frosted glass, search bar "Tìm kiếm (CTRL K)", active violet-50 pill on "Trang chủ", and the full expanded tree ("TMCut" 8 items, "Tài nguyên" 3 items, "Hệ thống" 5 items), footer "System Root".
- Main Stage: Top header "Trang chủ — Không gian biên tập video và sản xuất bằng AI của bạn" + soft violet "TMCut" button.
- 3 Bento Crystal Glass Cards ("TMCut", "Kết nối", "Két khóa AI"): Each card looks like a polished white quartz/acrylic slab floating over a subtle Three.js daylight refractive background, featuring a 3D clear-glass violet-tinted icon in a soft violet-50 rounded square badge, crisp typography, and "Mở ->" link.
```

---

### 3.3. Prompt 2: Màn hình Studio Workspace (Ẩn Sidebar + Mở Menu bằng Glass Popover — Adaptive Dark/Light)

```text
Design a full-bleed, sidebar-less Studio Workspace layout for "TMCut Studio" built with Nuxt UI v4 (supporting both Dark zinc-950 and Light zinc-50 themes, shown in Dark Mode with Violet primary, Indigo secondary, Cyan info, and Teal success accents).

FULL-BLEED STUDIO LAYOUT (NO LEFT SIDEBAR):
- Completely remove the fixed 260px left navigation sidebar when inside studio routes (/tmcut/*) to give 100% horizontal width to the video preview stage, inspector, and multi-track timeline.
- Top Ultra-Slim Glass Header Bar (48px height, bg-elevated/75 backdrop-blur-xl border-b border-default):
  * Top-Left Trigger: A 3D glass "App Launcher / Menu Popover" button showing the TMCut logo, a grid icon, and current module name "Trình chỉnh sửa" with a down chevron.
  * Center/Right Action Bar: 4 AI Intelligence buttons ("AI Script", "Edit Plan", "Agent", "Audio Sync") in primary/soft violet glass, a divider, a neutral/soft "Save" button, and a solid Violet (primary) "Export" CTA button.

FLOATING 3D GLASS NAVIGATION POPOVER (OPEN STATE):
- Anchored right below the Top-Left Trigger button is a floating 3D Frosted Glass Popover Mega-Menu (560px width, 28px backdrop blur, 1px specular border, deep ambient shadow).
- Inside the Popover (2-Column Bento Layout):
  * Left Column ("KHÔNG GIAN TMCUT" - 8 modules): Interactive glass items with 3D violet icons for "Bảng điều khiển TMCut", "Trình chỉnh sửa" (Active state in primary violet glass), "Mẫu & Preset", "AutoCut AI", "Studio HTML/CSS", "Studio giọng nói", "Quy trình sản xuất", "Video Factory", plus a "Trang chủ" shortcut.
  * Right Column ("TÀI NGUYÊN" & "HỆ THỐNG"): Compact list for "Kết nối", "Thông báo", "Hộp thư", "Hồ sơ", "Tài liệu API", "Cài đặt", "Két khóa AI", "Kết Nối TM Hub", and a bottom bar with a glowing Teal (success) dot for "System Root", a Dark/Light theme toggle button, and "CTRL K" badge.
```

---

## 4. Master Prompt cho AI Coding Agent (Để AI luôn lấy màu từ `app.config.ts`)

> **Cách sử dụng:** Bạn hãy copy đoạn prompt dưới đây đưa vào System Prompt, `AGENTS.md`, `CLAUDE.md` hoặc dán trực tiếp vào khung chat của AI (Cursor, Claude, Windsurf, Copilot...) mỗi khi yêu cầu AI viết hoặc sửa giao diện cho `tm-studio`.

```markdown
### QUY TẮC BẮT BUỘC VỀ MÀU SẮC, THEME DARK/LIGHT & LAYOUT (NUXT 4 + NUXT UI v4 + TAILWIND v4)

1. **Quản lý màu sắc tập trung trong `app/app.config.ts`:**
   Dự án sử dụng Nuxt UI v4 với hệ thống 7 semantic colors được định nghĩa duy nhất tại `app/app.config.ts`:
   - `primary`: `'violet'` (Thương hiệu, nút CTA chính, trạng thái active, nhóm công cụ AI)
   - `secondary`: `'indigo'` (Điểm nhấn phụ, dải gradient 3D)
   - `neutral`: `'zinc'` (Bề mặt nền, khung kính, viền, văn bản)
   - `info`: `'cyan'` (Thông tin, metadata)
   - `success`: `'teal'` (Đèn báo kết nối Hub/Wi-Fi, Playhead timeline, trạng thái hoàn tất)
   - `warning`: `'yellow'` (Cảnh báo)
   - `error`: `'red'` (Lỗi, xóa)

2. **Cấm tuyệt đối Hard-code Mã màu (No Hardcoded Colors):**
   - **KHÔNG ĐƯỢC** viết các class màu cố định như `bg-violet-600`, `text-zinc-900 dark:text-zinc-100`, `border-zinc-200 dark:border-zinc-800`, hoặc mã hex `#6D28D9` trực tiếp trong các file `.vue`.
   - **BẮT BUỘC** sử dụng Semantic Utility Classes của Nuxt UI v4 (tự động thích ứng cả Dark Mode và Light Mode):
     * Bề mặt (Surfaces): `bg-default`, `bg-muted`, `bg-elevated`, `bg-accented`, kết hợp độ trong suốt kính mờ như `bg-elevated/70 backdrop-blur-xl`.
     * Văn bản (Typography): `text-highlighted` (tiêu đề chính), `text-default` (nội dung), `text-toned` (nhãn phụ), `text-muted` (mô tả), `text-dimmed` (placeholder/disabled).
     * Đường viền & Khung kính (Borders & Rings): `border-default`, `border-muted`, `border-accented`, `ring-default`.
     * Màu ngữ nghĩa (Semantic Accents): `text-primary`, `bg-primary/10`, `border-primary/40`, `text-secondary`, `text-success`, `bg-success`, `text-info`, `text-warning`, `text-error`.
   - Với các component của Nuxt UI (`UButton`, `UBadge`, `UCard`, `UPopover`, `UDropdownMenu`...), luôn truyền prop `color="primary" | "secondary" | "neutral" | "info" | "success" | "warning" | "error"`.

3. **Đồng bộ Three.js với `app.config.ts` và Dark/Light Mode:**
   - Khi khởi tạo vật liệu kính 3D (`MeshPhysicalMaterial`) hoặc ánh sáng trong Three.js, không gán cứng mã màu. Hãy đọc biến CSS động từ `getComputedStyle(document.documentElement)` (ví dụ `--ui-primary`, `--ui-secondary`, `--ui-success`) và lắng nghe `useColorMode()` để tự động điều chỉnh độ trong suốt (`transmission`), độ nhám (`roughness`) và cường độ đèn khi người dùng chuyển đổi giữa Dark Mode và Light Mode.

4. **Quy tắc 2 Layout (Dual-Layout):**
   - Các trang quản trị / chung (`/`, `/resources/**`, `/system/**`) sử dụng `layouts/default.vue` (có Sidebar 260px bên trái).
   - Toàn bộ các trang trong `/tmcut/**` sử dụng `layouts/studio.vue` (Full-bleed, **ẩn hoàn toàn Sidebar bên trái**, và đặt component `<TmcutNavPopover />` ở góc trên bên trái thanh Header để mở menu dạng kính nổi).
```

---

## 5. Code Cấu hình Chuẩn cho Dự án (`tm-studio`)

### 5.1. File `app/app.config.ts` (Quản lý màu sắc & cấu hình Glass 3D tập trung)

```ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'violet',
      secondary: 'indigo',
      neutral: 'zinc',
      info: 'cyan',
      success: 'teal',
      warning: 'yellow',
      error: 'red'
    },
    card: {
      slots: {
        root: 'rounded-2xl bg-elevated/65 backdrop-blur-xl border border-default shadow-sm transition-all duration-200'
      }
    },
    popover: {
      slots: {
        content: 'rounded-2xl bg-elevated/85 backdrop-blur-2xl border border-default shadow-2xl ring-1 ring-white/10 dark:ring-white/15'
      }
    },
    button: {
       slots: {
        base: 'rounded-xl font-medium transition-all duration-150'
      }
    }
  }
})
```

---

### 5.2. File `app/assets/css/main.css` (Tailwind CSS v4 + Biến Kính 3D Tự động đổi theo Dark/Light)

```css
@import "tailwindcss";
@import "@nuxt/ui";

@theme {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace;
}

:root {
  /* Light Mode (Daylight Crystal Glass) */
  --studio-glass-bg: color-mix(in oklab, var(--ui-bg-elevated) 78%, transparent);
  --studio-glass-border: color-mix(in oklab, var(--ui-border) 85%, white 15%);
  --studio-glass-specular: rgba(255, 255, 255, 0.75);
  --studio-glass-shadow: 0 12px 32px -4px rgba(9, 9, 11, 0.06);
}

.dark {
  /* Dark Mode (Obsidian Frosted Glass) */
  --studio-glass-bg: color-mix(in oklab, var(--ui-bg-elevated) 65%, transparent);
  --studio-glass-border: color-mix(in oklab, var(--ui-border) 80%, white 20%);
  --studio-glass-specular: rgba(255, 255, 255, 0.16);
  --studio-glass-shadow: 0 20px 50px -8px rgba(0, 0, 0, 0.65);
}

@utility glass-surface {
  background: var(--studio-glass-bg);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--studio-glass-border);
  box-shadow:
    var(--studio-glass-shadow),
    inset 0 1px 0 0 var(--studio-glass-specular);
}
```

---

### 5.3. Composable `app/composables/useStudioThemeColors.ts` (Cầu nối Màu `app.config.ts` sang Three.js)

Composable này giúp mọi cảnh 3D của Three.js tự động đổi màu theo đúng cấu hình trong `app.config.ts` và tự thích nghi khi người dùng bấm nút chuyển đổi Dark / Light Mode:

```ts
import { computed, ref, watch, onMounted } from 'vue'

export function useStudioThemeColors() {
  const appConfig = useAppConfig()
  const colorMode = useColorMode()

  const resolvedColors = ref({
    primary: '#7c3aed',
    secondary: '#6366f1',
    success: '#14b8a6',
    info: '#06b6d4',
    bgCanvas: '#09090b'
  })

  function syncFromCssVariables() {
    if (import.meta.server) return
    const style = getComputedStyle(document.documentElement)
    resolvedColors.value = {
      primary: style.getPropertyValue('--ui-primary').trim() || '#7c3aed',
      secondary: style.getPropertyValue('--ui-secondary').trim() || '#6366f1',
      success: style.getPropertyValue('--ui-success').trim() || '#14b8a6',
      info: style.getPropertyValue('--ui-info').trim() || '#06b6d4',
      bgCanvas: style.getPropertyValue('--ui-bg').trim() || (colorMode.value === 'dark' ? '#09090b' : '#fafafa')
    }
  }

  onMounted(() => {
    syncFromCssVariables()
  })

  watch(
    [() => colorMode.value, () => appConfig.ui?.colors],
    () => {
      requestAnimationFrame(syncFromCssVariables)
    },
    { deep: true }
  )

  const threeGlassMaterialProps = computed(() => {
    const isDark = colorMode.value === 'dark'
    return {
      transmission: isDark ? 0.92 : 0.85,
      ior: 1.45,
      roughness: isDark ? 0.15 : 0.08,
      thickness: 1.2,
      attenuationColor: resolvedColors.value.primary,
      attenuationDistance: isDark ? 2.5 : 4.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1
    }
  })

  return {
    paletteNames: computed(() => appConfig.ui.colors),
    isDark: computed(() => colorMode.value === 'dark'),
    resolvedColors,
    threeGlassMaterialProps,
    syncFromCssVariables
  }
}
```

---

### 5.4. Component `TmcutNavPopover.vue` (Chuẩn Semantic Token Nuxt UI v4 — Tự động hỗ trợ Dark & Light)

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const colorMode = useColorMode()
const isNavOpen = ref(false)

interface NavItem {
  label: string
  to: string
  icon: string
  description?: string
}

const tmcutRoutes: NavItem[] = [
  { label: 'Bảng điều khiển TMCut', to: '/tmcut', icon: 'i-lucide-layout-grid', description: 'Quản lý dự án & tạo nhanh' },
  { label: 'Trình chỉnh sửa', to: '/tmcut/editor', icon: 'i-lucide-film', description: 'Timeline đa lớp & GPU Render' },
  { label: 'Mẫu & Preset', to: '/tmcut/templates', icon: 'i-lucide-layout-template', description: 'Kho mẫu dựng sẵn' },
  { label: 'AutoCut AI', to: '/tmcut/autocut', icon: 'i-lucide-scissors', description: 'Tự động cắt & kịch bản AI' },
  { label: 'Studio HTML/CSS', to: '/tmcut/html-video', icon: 'i-lucide-code-2', description: 'Render motion từ code web' },
  { label: 'Studio giọng nói', to: '/tmcut/voice', icon: 'i-lucide-audio-lines', description: 'TTS & lồng tiếng đa giọng' },
  { label: 'Quy trình sản xuất', to: '/tmcut/process', icon: 'i-lucide-workflow', description: 'SOP & tự động hóa khâu dựng' },
  { label: 'Video Factory', to: '/tmcut/factory', icon: 'i-lucide-factory', description: 'Sản xuất video hàng loạt' }
]

const resourceRoutes: NavItem[] = [
  { label: 'Kết nối', to: '/resources/connections', icon: 'i-lucide-plug-zap' },
  { label: 'Thông báo', to: '/resources/notifications', icon: 'i-lucide-bell' },
  { label: 'Hộp thư', to: '/resources/inbox', icon: 'i-lucide-inbox' }
]

const systemRoutes: NavItem[] = [
  { label: 'Hồ sơ', to: '/system/profile/security', icon: 'i-lucide-user' },
  { label: 'Tài liệu API', to: '/system/docs', icon: 'i-lucide-book-open' },
  { label: 'Cài đặt', to: '/system/settings', icon: 'i-lucide-settings' },
  { label: 'Két khóa AI', to: '/system/ai-keys', icon: 'i-lucide-key-round' },
  { label: 'Kết Nối TM Hub', to: '/system/hub-integration', icon: 'i-lucide-radio-tower' }
]

const currentRouteLabel = computed(() => {
  const all = [...tmcutRoutes, ...resourceRoutes, ...systemRoutes]
  return all.find(item => item.to === route.path)?.label || 'TMCut Studio'
})

function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <UPopover
    v-model:open="isNavOpen"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
    :ui="{
      content: 'w-[560px] glass-surface p-4 z-50'
    }"
  >
    <!-- Nút Trigger ở góc trái thanh Top Bar của Studio -->
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      class="group rounded-xl border border-default bg-elevated/60 hover:bg-primary/10 hover:border-primary/40 px-2.5 py-1.5"
      aria-label="Mở menu điều hướng TMCut Studio"
    >
      <div class="flex items-center gap-2">
        <img src="/logo.svg" alt="" class="w-5 h-5 shrink-0" decoding="async" />
        <UIcon
          name="i-lucide-layout-grid"
          class="w-4 h-4 text-muted group-hover:text-primary transition-colors"
        />
        <span class="text-xs font-medium text-highlighted tracking-tight">{{ currentRouteLabel }}</span>
        <UIcon
          name="i-lucide-chevron-down"
          class="w-3.5 h-3.5 text-dimmed group-hover:text-toned transition-transform duration-200"
          :class="{ 'rotate-180 text-primary': isNavOpen }"
        />
      </div>
    </UButton>

    <!-- Nội dung Menu dạng Bento 2 Cột (Tự động đổi màu theo Dark/Light) -->
    <template #content>
      <div class="grid grid-cols-12 gap-4">
        <!-- Cột trái (7/12): 8 Phân hệ TMCut Studio -->
        <div class="col-span-7 space-y-2 border-r border-default pr-3">
          <div class="flex items-center justify-between px-2 pb-1">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Không gian TMCut
            </span>
            <NuxtLink
              to="/"
              class="text-[11px] text-muted hover:text-highlighted flex items-center gap-1 transition-colors"
              @click="isNavOpen = false"
            >
              <UIcon name="i-lucide-home" class="w-3 h-3" />
              <span>Trang chủ</span>
            </NuxtLink>
          </div>

          <div class="grid grid-cols-1 gap-1">
            <NuxtLink
              v-for="item in tmcutRoutes"
              :key="item.to"
              :to="item.to"
              class="group flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs transition-all duration-150 border"
              :class="route.path === item.to
                ? 'bg-primary/15 text-highlighted border-primary/40'
                : 'text-toned hover:bg-muted hover:text-highlighted border-transparent'"
              @click="isNavOpen = false"
            >
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border transition-colors"
                :class="route.path === item.to
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'bg-muted border-default text-primary group-hover:border-primary/30'"
              >
                <UIcon :name="item.icon" class="w-4 h-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-medium truncate">{{ item.label }}</p>
                <p v-if="item.description" class="text-[10px] text-muted truncate">
                  {{ item.description }}
                </p>
              </div>
            </NuxtLink>
          </div>
        </div>

        <!-- Cột phải (5/12): Tài nguyên, Hệ thống & Chuyển đổi Dark/Light -->
        <div class="col-span-5 flex flex-col justify-between">
          <div class="space-y-3">
            <div>
              <p class="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-dimmed">
                Tài nguyên
              </p>
              <div class="space-y-0.5">
                <NuxtLink
                  v-for="item in resourceRoutes"
                  :key="item.to"
                  :to="item.to"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted hover:bg-muted hover:text-highlighted transition-colors"
                  @click="isNavOpen = false"
                >
                  <UIcon :name="item.icon" class="w-3.5 h-3.5 text-dimmed" />
                  <span>{{ item.label }}</span>
                </NuxtLink>
              </div>
            </div>

            <div>
              <p class="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-dimmed">
                Hệ thống
              </p>
              <div class="space-y-0.5">
                <NuxtLink
                  v-for="item in systemRoutes"
                  :key="item.to"
                  :to="item.to"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted hover:bg-muted hover:text-highlighted transition-colors"
                  @click="isNavOpen = false"
                >
                  <UIcon :name="item.icon" class="w-3.5 h-3.5 text-dimmed" />
                  <span>{{ item.label }}</span>
                </NuxtLink>
              </div>
            </div>
          </div>

          <!-- Footer: System Root (Success Teal) + Nút đổi giao diện Sáng/Tối -->
          <div class="pt-2.5 border-t border-default flex items-center justify-between px-2 text-[11px] text-muted">
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span class="text-toned font-medium">System Root</span>
            </span>

            <div class="flex items-center gap-1.5">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                :icon="colorMode.value === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'"
                aria-label="Chuyển đổi giao diện Sáng / Tối"
                @click="toggleTheme"
              />
              <kbd class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-toned border border-default">
                CTRL K
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
```