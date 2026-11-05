# TMCut Studio — Đặc tả Giao diện Linear Flat Glassmorphism & Bento UI (Dark & Light Mode)

> **Trạng thái:** ACTIVE — Tài liệu chuẩn thiết kế & triển khai UI/UX (Bản đầy đủ thay thế bản 3D cũ)
> **Cập nhật lần cuối:** 2026-11-01
> **Áp dụng cho:** `tm-studio` (`D:\Applications\tm-studio`, port 4003, App ID `tm-studio_749app`)
> **Nền tảng kỹ thuật:** Nuxt 4 + Vue 3 + **Nuxt UI v4** + **Tailwind CSS v4** + Electron
> **Phong cách chủ đạo:** **Linear-style Flat Glassmorphism & Functional Bento Grid** (Lấy cảm hứng từ giao diện `UDMT` kết hợp bề mặt kính mờ phẳng bán trong suốt, viền mảnh 1px và quầng sáng nền tinh tế).

---

## 1. Triết lý Thiết kế: Linear Flat Glassmorphism & Bento Grid

Thay vì sử dụng đồ họa 3D nặng nề gây phân tán thị giác và tiêu tốn tài nguyên GPU, **TMCut Studio** áp dụng phong cách **Flat Glassmorphism (Kính mờ phẳng chuẩn công nghiệp)**:

1. **Bề mặt Kính Phẳng Tinh tế (Flat Frosted Glass Surfaces):**
   - Các thẻ (Cards), Sidebar, Header và Popover là những tấm kính phẳng bán trong suốt (`bg-elevated/60` ở Dark Mode và `bg-white/75` ở Light Mode) với lớp làm mờ nền `backdrop-blur-md` (`12px–16px`).
   - Định hình khối bằng đường viền siêu mảnh `1px solid` (`border-default`) kết hợp ánh sáng viền trên nội tại (`inset 0 1px 0 0 rgba(255,255,255,0.08)`), không dùng bóng đổ dày hay khối 3D lồi lõm.
2. **Quầng sáng Nền Tĩnh (Subtle Ambient Radial Glow):**
   - Lớp nền dưới cùng (`bg-default`) có một quầng sáng `radial-gradient` màu tím `primary` (`violet-600/12`) và `secondary` (`indigo-600/8`) tỏa nhẹ từ góc trên bên trái. Khi các thẻ kính phẳng nằm đè lên trên, ánh sáng tím này xuyên nhẹ qua lớp `backdrop-blur`, tạo hiệu ứng kính thực thụ mà **không tốn 1% GPU nào cho WebGL/Three.js**.
3. **Kiến trúc Bento 3 Tầng Thực dụng (Functional Bento Hierarchy - Chuẩn `UDMT`):**
   - **Tầng 1 — KPI Stat Cards (4 cột):** Hiển thị các chỉ số cốt lõi bằng nhãn chữ in hoa nhỏ (`text-[11px] uppercase tracking-wider text-muted`), con số lớn (`text-2xl font-bold text-highlighted`), icon mảnh góc phải và dòng chú thích phụ bên dưới.
   - **Tầng 2 — Quick Action Cards (3 hoặc 4 cột):** Các thẻ truy cập nhanh có hộp icon vuông bo góc nền tím nhạt (`bg-primary/10 text-primary border border-primary/20`), tiêu đề đậm và mô tả ngắn gọn 2 dòng.
   - **Tầng 3 — Split Activity & Info View (Tỷ lệ 8:4):** Cột trái (8 phần) là danh sách tác vụ/dự án gần đây phân cách bằng đường kẻ mảnh `divide-y divide-default` kèm nhãn trạng thái (`Completed` / `Verified` màu `teal`, `Failed` màu `red`); cột phải (4 phần) là các thẻ thông tin nhanh và hướng dẫn hệ thống.
4. **Phân tách 2 Layout (Dual-Layout Architecture):**
   - **Console Layout (`default.vue`):** Có thanh Sidebar kính phẳng `260px` cố định bên trái (dùng cho `/`, `/resources/*`, `/system/*`).
   - **Studio Full-Bleed Layout (`studio.vue`):** **Ẩn hoàn toàn Sidebar bên trái** khi vào `/tmcut/*` để tối ưu 100% không gian ngang cho bàn dựng video. Toàn bộ menu được mở qua nút **Flat Glass Popover (`TmcutNavPopover.vue`)** ở góc trên bên trái.

---

## 2. Hệ thống Màu sắc Tập trung (Nuxt UI v4 `app.config.ts` — Hỗ trợ Dark & Light Mode)

Toàn bộ giao diện sử dụng duy nhất 7 Semantic Colors được cấu hình trong `app/app.config.ts`:

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
    }
  }
})
```

### Bảng Ánh xạ Bề mặt Flat Glass (Dark Mode vs Light Mode)

| Thành phần UI | Semantic Class (Nuxt UI v4) | Hiển thị ở Dark Mode (Chuẩn `UDMT` Glass) | Hiển thị ở Light Mode (Daylight Flat Glass) |
|---|---|---|---|
| **Nền chính (App Canvas)** | `bg-default text-default` | `#09090B` (`zinc-950`) + Ambient Violet Glow `12%` | `#FAFAFA` (`zinc-50`) + Ambient Violet Glow `6%` |
| **Thẻ Flat Glass (Bento Card)** | `flat-glass-card` (`bg-elevated/60 backdrop-blur-md border border-default`) | Kính phẳng xám đen `zinc-900/60`, viền mảnh `zinc-800/80`, vệt sáng cạnh trên `white/6%` | Kính phẳng trắng trong `white/80`, viền mảnh `zinc-200/90`, bóng đổ siêu nhẹ |
| **Thẻ khi Hover (Interactive)** | `hover:bg-elevated/85 hover:border-primary/40` | Sáng nhẹ bề mặt kính và viền chuyển sang tím `violet-500/40` | Nền trắng rõ hơn và viền tím `violet-400/50` |
| **Hộp Icon trong Thẻ (Icon Badge)** | `bg-primary/10 text-primary border border-primary/20 rounded-lg` | Nền tím trong suốt `violet-500/10`, icon `violet-400` sắc nét | Nền tím pastel `violet-50`, icon `violet-600` |
| **Nhãn Trạng thái Thành công (`Completed` / `Verified`)** | `bg-success/10 text-success border border-success/25 rounded-md` | Nền xanh ngọc mờ `teal-500/10`, chữ và icon `teal-400` | Nền `teal-50`, viền `teal-200`, chữ `teal-700` |
| **Nhãn Trạng thái Lỗi (`Failed`)** | `bg-error/10 text-error border border-error/25 rounded-md` | Nền đỏ mờ `red-500/10`, chữ và icon `red-400` | Nền `red-50`, viền `red-200`, chữ `red-700` |
| **Font số liệu, Hash, Timecode** | `font-mono text-xs text-muted` | `JetBrains Mono` (hiển thị ID dự án, `v0.1.0`, `CTRL K`, `00:01:24:12`) | `JetBrains Mono` sắc nét trên nền sáng |

---

## 3. Bộ Prompt Chuẩn cho Google Stitch / AI UI Generator (Phong cách Flat Glass Bento)

### 3.1. Prompt 1: Trang chủ TMCut Studio (Phong cách `UDMT` Flat Glass Bento — Dark & Light)

```text
Design a modern developer-grade desktop dashboard for "TMCut Studio" (v0.1.0), an AI video editing and production platform built with Nuxt UI v4 and Tailwind CSS v4.
Style: Linear-inspired Flat Glassmorphism & Functional Bento Grid (strictly 2D flat frosted glass, NO 3D sculptures, crisp 1px hairline borders, subtle top-left ambient violet radial glow behind translucent matte cards).

NUXT UI v4 COLOR SYSTEM:
- Neutral (zinc): Deep zinc-950 (#09090B) canvas, translucent flat glass cards (zinc-900/60 with 12px backdrop-blur, 1px solid zinc-800/80 border, and subtle 1px top inner highlight).
- Primary (violet): Violet (#7C3AED / #8B5CF6) for active menu pill, square icon badges (bg-violet-500/10 border-violet-500/20), and primary "TMCut" button.
- Success (teal): Teal (#14B8A6) for the sidebar Wi-Fi status icon and "Completed" / "Ready" status pills.
- Error (red): Red (#EF4444) for "Failed" status pills.
- Fonts: Inter for UI & headings, JetBrains Mono for hashes, version tags (v0.1.0), and timecodes.

LAYOUT STRUCTURE:
1. LEFT FLAT-GLASS SIDEBAR (250px width, translucent zinc-900/50, 1px right border):
   - Header: Logo squircle + "TMCut Studio v0.1.0" + Teal Wi-Fi icon.
   - Search input: "Tìm kiếm" with "CTRL K" mono badge.
   - Full Navigation Tree:
     * "Trang chủ" (Active state with subtle violet/15 flat glass pill).
     * Group "TMCut": "Bảng điều khiển TMCut", "Trình chỉnh sửa", "Mẫu & Preset", "AutoCut AI", "Studio HTML/CSS", "Studio giọng nói", "Quy trình sản xuất", "Video Factory".
     * Group "Tài nguyên": "Kết nối", "Thông báo", "Hộp thư".
     * Group "Hệ thống": "Hồ sơ", "Tài liệu API", "Cài đặt", "Két khóa AI", "Kết Nối TM Hub".
   - Bottom Footer: Status pill "Hub connected" + "System Root" profile + Light/Dark mode toggle.

2. MAIN STAGE (3-TIER FLAT GLASS BENTO GRID):
   - Top Bar: Title "Trang chủ", subtitle "Không gian biên tập video và sản xuất bằng AI của bạn", right side has primary violet button "Mở Studio" and secondary glass button "Tạo dự án".
   - TIER 1 (4 KPI Stat Cards in a row):
     * Card 1: "DỰ ÁN STUDIO" | Big number "12" | "4 dự án đang dựng" (film icon top-right).
     * Card 2: "KẾT NỐI HUB" | Big number "7" | "Cloudinary, R2, Pexels..." (plug icon top-right).
     * Card 3: "AI MODELS" | Big number "21" | "OpenAI, Claude, Gemini..." (cpu icon top-right).
     * Card 4: "RENDER ENGINE" | Big text "Ready" | "WebGL2 · WebCodecs active" (activity icon top-right).
   - TIER 2 (4 Quick Action Flat-Glass Cards with small rounded-lg violet icon badges):
     * Card 1: "Bảng điều khiển TMCut" — "Dự án, editor, AutoCut và công cụ AI trong một workspace."
     * Card 2: "AutoCut AI & Kịch bản" — "Tự động phân tích kịch bản, tách cảnh và lồng tiếng bằng AI."
     * Card 3: "Kết nối & Tài nguyên" — "Quản lý lưu trữ đám mây (R2, S3, Cloudinary) và kho stock media."
     * Card 4: "Két khóa AI (Vault)" — "Lưu khóa nhà cung cấp AI dạng mã hóa cục bộ và đồng bộ TM Hub."
   - TIER 3 (8:4 Split Bottom Bento Row):
     * Left Large Card (8 cols) "Hoạt động & Render gần đây" with "Xem tất cả ->": Clean divided rows showing monospace job ID (e.g., "prj_8f92a1c0"), action ("export · video-1080p", "autocut · script-ai"), bordered status pill ("Completed" in Teal, "Failed" in Red), and relative time ("15m ago").
     * Right Column (4 cols): Top card "Tài nguyên vừa tạo" with "Verified" teal badges; Bottom card "Kiến trúc TMCut V4" with 4 concise bullet points.
```

---

### 3.2. Prompt 2: Không gian Studio Full-Bleed (`/tmcut/*` — Ẩn Sidebar + Mở Menu bằng Flat Glass Popover)

```text
Design a full-bleed, sidebar-less Video Editor & Studio Workspace for "TMCut Studio" in the exact same Linear-style Flat Glassmorphism aesthetic (matte translucent zinc-900/65 panels, 1px hairline borders, violet primary accents, teal status/playhead, NO 3D clutter).

FULL-BLEED STUDIO LAYOUT (NO LEFT SIDEBAR):
- Remove the 250px left sidebar completely to maximize 100% horizontal width for the NLE workspace.
- Top Slim Flat-Glass Bar (48px height):
  * Left: An interactive flat-glass "App Switcher / Menu Popover" button showing logo + "Trình chỉnh sửa" + chevron.
  * Right: 4 soft-violet glass AI tool buttons ("Kịch bản AI", "Kế hoạch dựng", "AI Agent", "Âm thanh"), a vertical 1px divider, a neutral glass "Lưu" button, and a solid violet "Xuất video" CTA button.

FLOATING FLAT-GLASS POPOVER MENU (OPEN STATE):
- Anchored below the top-left trigger is a crisp 2-column Flat Frosted Glass Popover (540px width, backdrop-blur-xl, bg-zinc-900/85, 1px border-white/10, clean drop shadow).
- Column 1 ("KHÔNG GIAN TMCUT"): 8 compact rows with small violet icon boxes for "Bảng điều khiển TMCut", "Trình chỉnh sửa" (Active), "Mẫu & Preset", "AutoCut AI", "Studio HTML/CSS", "Studio giọng nói", "Quy trình sản xuất", "Video Factory".
- Column 2 ("TÀI NGUYÊN & HỆ THỐNG"): Clean links for "Kết nối", "Thông báo", "Hộp thư", "Hồ sơ", "Tài liệu API", "Cài đặt", "Két khóa AI", "Kết Nối TM Hub", plus a footer with a Teal "System Root" dot, Dark/Light toggle, and "CTRL K" badge.
```

---

## 4. Master Prompt cho AI Coding Agent (Chuẩn hóa Code theo Flat Glass & `app.config.ts`)

> **Hướng dẫn:** Dán đoạn quy tắc này vào `AGENTS.md`, `CLAUDE.md` hoặc cửa sổ chat của Cursor / Claude để AI luôn viết code đúng chuẩn **Linear Flat Glass** và đồng bộ màu qua `app.config.ts`.

```markdown
### QUY TẮC THIẾT KẾ UI: LINEAR FLAT GLASSMORPHISM & NUXT UI v4 SEMANTIC TOKENS

1. **Phong cách chủ đạo (Linear Flat Glass & Functional Bento):**
   - Giao diện tuân thủ phong cách phẳng, sắc nét, thực dụng như Linear / Vercel / UDMT kết hợp hiệu ứng kính mờ phẳng (`Flat Glassmorphism`).
   - **KHÔNG** sử dụng thư viện 3D (Three.js/WebGL) cho các thẻ UI trang trí.
   - Tạo chiều sâu bằng:
     * Quầng sáng nền tĩnh cực nhẹ (`radial-gradient` với `bg-primary/10 blur-3xl pointer-events-none`) phía sau trang.
     * Các thẻ kính phẳng sử dụng class `.flat-glass-card` (`bg-elevated/60 backdrop-blur-md border border-default shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]`).
     * Viền mảnh `1px` (`border-default`, `divide-default`), hộp icon vuông bo góc `rounded-lg bg-primary/10 border border-primary/20 text-primary`.
     * Nhãn trạng thái (Status Pills) dùng viền mảnh: Thành công dùng `bg-success/10 text-success border border-success/25`, Lỗi dùng `bg-error/10 text-error border border-error/25`.
     * Mọi mã ID, phiên bản, dung lượng file, thông số FPS và Timecode bắt buộc dùng `font-mono` (`JetBrains Mono`).

2. **Quản lý màu sắc tập trung tuyệt đối tại `app/app.config.ts`:**
   - Chỉ sử dụng 7 semantic colors: `primary` (`violet`), `secondary` (`indigo`), `neutral` (`zinc`), `info` (`cyan`), `success` (`teal`), `warning` (`yellow`), `error` (`red`).
   - **CẤM** hard-code mã màu (`bg-zinc-900`, `text-violet-400`, `#7c3aed`...) trong các component. Luôn dùng semantic classes của Nuxt UI v4 (`bg-default`, `bg-muted`, `bg-elevated`, `text-highlighted`, `text-toned`, `text-muted`, `text-dimmed`, `border-default`, `text-primary`, `text-success`, `text-error`) để tự động tương thích 100% cả **Dark Mode** và **Light Mode**.

3. **Kiến trúc 2 Layout (Dual-Layout):**
   - Các route `/`, `/resources/**`, `/system/**` dùng `layouts/default.vue` (có Sidebar phẳng 250px bên trái).
   - Toàn bộ các route `/tmcut/**` dùng `layouts/studio.vue` (Full-bleed **ẩn Sidebar bên trái**, mở menu điều hướng qua `<TmcutNavPopover />` ở góc trái thanh Top Bar).
```

---

## 5. Code Cấu hình & Component Chuẩn (`tm-studio`)

### 5.1. File `app/app.config.ts` (Cấu hình Nuxt UI v4 Flat Glass Tập trung)

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
        root: 'flat-glass-card rounded-xl transition-colors duration-150',
        header: 'p-4 sm:px-5',
        body: 'p-4 sm:p-5',
        footer: 'p-4 sm:px-5 border-t border-default'
      }
    },
    popover: {
      slots: {
        content: 'flat-glass-popover rounded-xl border border-default shadow-2xl'
      }
    },
    button: {
      slots: {
        base: 'rounded-lg font-medium transition-all duration-150'
      }
    },
    badge: {
      slots: {
        base: 'rounded-md font-medium'
      }
    }
  }
})
```

---

### 5.2. File `app/assets/css/main.css` (Định nghĩa Flat Glass cho cả Dark Mode & Light Mode)

```css
@import "tailwindcss";
@import "@nuxt/ui";

@theme {
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace;
}

:root {
  /* Light Mode: Daylight Flat Frosted Glass */
  --flat-glass-bg: color-mix(in oklab, var(--ui-bg-elevated) 78%, transparent);
  --flat-glass-hover-bg: color-mix(in oklab, var(--ui-bg-elevated) 92%, transparent);
  --flat-glass-popover-bg: color-mix(in oklab, var(--ui-bg-elevated) 90%, transparent);
  --flat-glass-top-shine: rgba(255, 255, 255, 0.85);
  --flat-glass-shadow: 0 2px 10px -2px rgba(9, 9, 11, 0.04);
  --ambient-glow-opacity: 0.07;
}

.dark {
  /* Dark Mode: Linear UDMT Matte Frosted Glass */
  --flat-glass-bg: color-mix(in oklab, var(--ui-bg-elevated) 62%, transparent);
  --flat-glass-hover-bg: color-mix(in oklab, var(--ui-bg-elevated) 82%, transparent);
  --flat-glass-popover-bg: color-mix(in oklab, var(--ui-bg-elevated) 86%, transparent);
  --flat-glass-top-shine: rgba(255, 255, 255, 0.06);
  --flat-glass-shadow: 0 4px 20px -4px rgba(0, 0, 0, 0.45);
  --ambient-glow-opacity: 0.14;
}

@utility flat-glass-card {
  background: var(--flat-glass-bg);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid var(--ui-border);
  box-shadow:
    var(--flat-glass-shadow),
    inset 0 1px 0 0 var(--flat-glass-top-shine);
}

@utility flat-glass-card-interactive {
  background: var(--flat-glass-bg);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid var(--ui-border);
  box-shadow:
    var(--flat-glass-shadow),
    inset 0 1px 0 0 var(--flat-glass-top-shine);
  transition: background-color 150ms ease, border-color 150ms ease;

  &:hover {
    background: var(--flat-glass-hover-bg);
    border-color: color-mix(in oklab, var(--ui-primary) 45%, var(--ui-border));
  }
}

@utility flat-glass-popover {
  background: var(--flat-glass-popover-bg);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  box-shadow:
    0 20px 48px -12px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 0 var(--flat-glass-top-shine);
}

@utility studio-ambient-glow {
  background: radial-gradient(
    800px circle at 18% 0%,
    color-mix(in oklab, var(--ui-primary) calc(var(--ambient-glow-opacity) * 100%), transparent),
    color-mix(in oklab, var(--ui-secondary) calc(var(--ambient-glow-opacity) * 50%), transparent) 45%,
    transparent 80%
  );
}
```

---

### 5.3. Mẫu Trang chủ `app/pages/index.vue` (Chuẩn Phong cách `UDMT` Flat Glass Bento)

```vue
<script setup lang="ts">
const kpiStats = [
  { label: 'DỰ ÁN STUDIO', value: '12', sub: '4 dự án đang biên tập', icon: 'i-lucide-film' },
  { label: 'KẾT NỐI HUB', value: '7', sub: 'Cloudinary, R2, S3, Pexels...', icon: 'i-lucide-plug-zap' },
  { label: 'MÔ HÌNH AI', value: '21', sub: 'Đồng bộ qua TM Hub R147', icon: 'i-lucide-cpu' },
  { label: 'RENDER ENGINE', value: 'Ready', sub: 'WebGL2 · WebCodecs active', icon: 'i-lucide-activity' }
]

const quickActions = [
  {
    title: 'Bảng điều khiển TMCut',
    description: 'Quản lý dự án, trình chỉnh sửa đa lớp, AutoCut và bộ công cụ sản xuất AI trong một workspace.',
    icon: 'i-lucide-clapperboard',
    to: '/tmcut'
  },
  {
    title: 'AutoCut AI & Kịch bản',
    description: 'Tự động lên kịch bản, tách phân cảnh thông minh, ghép stock media và lồng tiếng đa giọng đọc.',
    icon: 'i-lucide-scissors',
    to: '/tmcut/autocut'
  },
  {
    title: 'Kết nối & Kho tài nguyên',
    description: 'Cấu hình lưu trữ đám mây (Cloudflare R2, S3, Cloudinary) và nguồn video Pexels, Pixabay.',
    icon: 'i-lucide-plug',
    to: '/resources/connections'
  },
  {
    title: 'Két khóa AI (Local Vault)',
    description: 'Lưu trữ khóa nhà cung cấp AI dạng mã hóa cục bộ trên Electron và phân quyền mô hình từ Hub.',
    icon: 'i-lucide-key-round',
    to: '/system/ai-keys'
  }
]

const recentOperations = [
  { id: '8f92a1c0', action: 'export · intro-product-1080p', status: 'Completed', time: '12m ago' },
  { id: '3b41e9d2', action: 'autocut · kich-ban-review-ai', status: 'Completed', time: '45m ago' },
  { id: '7c04f8a1', action: 'voice · tts-vietnamese-pro', status: 'Completed', time: '1h ago' },
  { id: '01e42c64', action: 'render · html-motion-template', status: 'Failed', time: '2h ago' },
  { id: '9a23b11f', action: 'sync · hub-ai-catalog', status: 'Completed', time: '3h ago' }
]

const recentArtifacts = [
  { name: 'intro-product-1080p.mp4', meta: '12m ago · 42.8 MiB', badge: 'Verified' },
  { name: 'voiceover-main-vi.wav', meta: '1h ago · 8.4 MiB', badge: 'Verified' },
  { name: 'lower-third-glass.json', meta: '3h ago · 24.0 KiB', badge: 'Verified' }
]
</script>

<template>
  <div class="relative min-h-full bg-default text-default p-6 space-y-6 overflow-x-hidden">
    <!-- Quầng sáng nền tĩnh xuyên qua lớp kính phẳng (0% GPU load) -->
    <div class="pointer-events-none fixed inset-0 studio-ambient-glow z-0" />

    <div class="relative z-10 space-y-6">
      <!-- TẦNG 1: 4 Thẻ chỉ số KPI (KPI Stat Cards) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div
          v-for="stat in kpiStats"
          :key="stat.label"
          class="flat-glass-card rounded-xl p-4 flex flex-col justify-between"
        >
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-muted">
              {{ stat.label }}
            </span>
            <UIcon :name="stat.icon" class="w-4 h-4 text-dimmed" />
          </div>
          <div class="my-2 text-2xl font-bold text-highlighted tracking-tight">
            {{ stat.value }}
          </div>
          <div class="text-xs text-muted font-mono">
            {{ stat.sub }}
          </div>
        </div>
      </div>

      <!-- TẦNG 2: 4 Thẻ tác vụ nhanh (Quick Action Flat Glass Cards) -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <NuxtLink
          v-for="item in quickActions"
          :key="item.to"
          :to="item.to"
          class="flat-glass-card-interactive rounded-xl p-5 flex flex-col justify-between group"
        >
          <div class="space-y-3">
            <div class="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:bg-primary/15 transition-colors">
              <UIcon :name="item.icon" class="w-4 h-4" />
            </div>
            <h3 class="text-sm font-semibold text-highlighted group-hover:text-primary transition-colors">
              {{ item.title }}
            </h3>
            <p class="text-xs text-muted leading-relaxed">
              {{ item.description }}
            </p>
          </div>
        </NuxtLink>
      </div>

      <!-- TẦNG 3: Bố cục 8:4 (Nhật ký tiến trình & Tài nguyên mới nhất) -->
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <!-- Cột trái (8 cột): Nhật ký hoạt động -->
        <div class="xl:col-span-8 flat-glass-card rounded-xl overflow-hidden flex flex-col">
          <div class="px-5 py-4 border-b border-default flex items-center justify-between">
            <h3 class="text-sm font-semibold text-highlighted">
              Tiến trình & Hoạt động gần đây
            </h3>
            <NuxtLink
              to="/tmcut/process"
              class="text-xs text-toned hover:text-primary flex items-center gap-1 transition-colors"
            >
              <span>Tất cả tiến trình</span>
              <UIcon name="i-lucide-arrow-right" class="w-3.5 h-3.5" />
            </NuxtLink>
          </div>

          <div class="divide-y divide-default">
            <div
              v-for="op in recentOperations"
              :key="op.id"
              class="px-5 py-3.5 flex items-center justify-between hover:bg-muted/40 transition-colors"
            >
              <div class="space-y-0.5">
                <p class="font-mono text-xs text-muted">
                  {{ op.id }}
                </p>
                <p class="text-xs font-semibold text-highlighted">
                  {{ op.action }}
                </p>
              </div>

              <div class="flex items-center gap-6">
                <span
                  class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium border"
                  :class="op.status === 'Completed'
                    ? 'bg-success/10 text-success border-success/25'
                    : 'bg-error/10 text-error border-error/25'"
                >
                  <UIcon
                    :name="op.status === 'Completed' ? 'i-lucide-check-circle-2' : 'i-lucide-x-circle'"
                    class="w-3.5 h-3.5"
                  />
                  {{ op.status }}
                </span>

                <span class="font-mono text-xs text-muted w-16 text-right">
                  {{ op.time }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Cột phải (4 cột): Tài nguyên xuất bản & Cơ chế hoạt động -->
        <div class="xl:col-span-4 space-y-4">
          <div class="flat-glass-card rounded-xl p-5 space-y-4">
            <div class="flex items-center gap-2 text-sm font-semibold text-highlighted">
              <UIcon name="i-lucide-history" class="w-4 h-4 text-muted" />
              <span>Tài nguyên vừa xuất bản</span>
            </div>

            <div class="divide-y divide-default">
              <div
                v-for="art in recentArtifacts"
                :key="art.name"
                class="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
              >
                <div class="min-w-0">
                  <p class="text-xs font-semibold text-highlighted truncate">
                    {{ art.name }}
                  </p>
                  <p class="font-mono text-[11px] text-muted">
                    {{ art.meta }}
                  </p>
                </div>
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-success/10 text-success border border-success/25 shrink-0">
                  <UIcon name="i-lucide-check-circle-2" class="w-3 h-3" />
                  {{ art.badge }}
                </span>
              </div>
            </div>
          </div>

          <div class="flat-glass-card rounded-xl p-5 space-y-3">
            <div class="flex items-center gap-2 text-sm font-semibold text-highlighted">
              <UIcon name="i-lucide-shield-check" class="w-4 h-4 text-muted" />
              <span>Cơ chế vận hành TMCut V4</span>
            </div>
            <ul class="space-y-2 text-xs text-muted list-disc pl-4 leading-relaxed">
              <li>Project & Timeline đánh giá theo timestamp xác định (`120,000 ticks/s`).</li>
              <li>Giao diện Flat Glass tiết kiệm 100% GPU cho WebGL2/WebGPU Video Compositor.</li>
              <li>Khóa AI lưu trữ an toàn tại Local Vault và đồng bộ danh mục qua TM Hub.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
```