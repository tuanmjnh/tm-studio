export type AiScriptPlatform = 'tiktok-shorts' | 'youtube-explainer' | 'storytelling-vlog' | 'commercial-promo'
export type AiScriptDuration = '15s' | '30s' | '60s' | '120s'

export interface TmcutAiScriptScene {
  id: string
  order: number
  title: string
  durationSec: number
  visualPrompt: string
  voiceover: string
  onScreenText: string
}

export interface TmcutAiScript {
  title: string
  synopsis: string
  platform: AiScriptPlatform
  targetDurationSec: number
  scenes: TmcutAiScriptScene[]
  createdAt: string
}

export interface GenerateScriptOptions {
  prompt: string
  platform: AiScriptPlatform
  duration: AiScriptDuration
  language?: 'vi' | 'en'
}

/**
 * High quality curated fallback templates when AI gateway has no API key or runs in offline mode.
 */
export const CURATED_SCRIPT_PRESETS: TmcutAiScript[] = [
  {
    title: '5 Thói Quen Buổi Sáng Tăng 200% Năng Suất',
    synopsis: 'Video ngắn viral giới thiệu các thói quen bắt đầu ngày mới hiệu quả cho người làm việc.',
    platform: 'tiktok-shorts',
    targetDurationSec: 30,
    createdAt: '2026-10-12T00:00:00.000Z',
    scenes: [
      {
        id: 'scene-1',
        order: 1,
        title: 'Hook Cuốn Hút (0-3s)',
        durationSec: 3,
        visualPrompt: 'Góc nhìn thứ nhất: Tắt chuông báo thức lúc 5h30 sáng, ánh nắng nhẹ qua rèm.',
        voiceover: 'Dừng ngay việc lướt điện thoại ngay khi vừa mở mắt nếu không muốn lãng phí cả ngày!',
        onScreenText: 'DỪNG LƯỚT ĐIỆN THOẠI ⚠️'
      },
      {
        id: 'scene-2',
        order: 2,
        title: 'Thói quen 1 & 2 (3-12s)',
        durationSec: 9,
        visualPrompt: 'Cảnh rót một cốc nước ấm lớn, sau đó mở cửa sổ hít thở sâu.',
        voiceover: 'Thứ nhất: Uống ngay 500ml nước ấm đánh thức trao đổi chất. Thứ hai: Mở cửa đón ánh sáng tự nhiên để cân bằng cortisol.',
        onScreenText: '1. Uống 500ml Nước Ấm 💧\n2. Đón Nắng Sớm ☀️'
      },
      {
        id: 'scene-3',
        order: 3,
        title: 'Thói quen 3 & 4 (12-21s)',
        durationSec: 9,
        visualPrompt: 'Vận động nhẹ giãn cơ, sau đó ngồi vào bàn mở sổ tay ghi 3 việc quan trọng.',
        voiceover: 'Thứ ba: 5 phút giãn cơ nhẹ nhàng. Thứ tư: Viết ra đúng 3 việc quan trọng nhất phải hoàn thành hôm nay.',
        onScreenText: '3. Giãn Cơ 5 Phút 🧘\n4. Viết Top 3 Việc 📝'
      },
      {
        id: 'scene-4',
        order: 4,
        title: 'Kêu Gọi Hành Động (21-30s)',
        durationSec: 9,
        visualPrompt: 'Nụ cười tự tin, cầm ly cà phê bắt đầu làm việc, xuất hiện logo/kênh.',
        voiceover: 'Thử ngay ngày mai và cảm nhận sự khác biệt. Lưu lại video và theo dõi kênh để nhận thêm mẹo phát triển bản thân!',
        onScreenText: 'LƯU LẠI & ÁP DỤNG NGAY 🚀'
      }
    ]
  },
  {
    title: 'Đập Hộp & Đánh Giá Nhanh Công Nghệ Mới',
    synopsis: 'Video review công nghệ cận cảnh, làm nổi bật thiết kế, tính năng và kết luận đáng mua hay không.',
    platform: 'youtube-explainer',
    targetDurationSec: 60,
    createdAt: '2026-10-12T00:00:00.000Z',
    scenes: [
      {
        id: 'scene-tech-1',
        order: 1,
        title: 'Intro & Ấn Tượng Đầu (0-10s)',
        durationSec: 10,
        visualPrompt: 'B-roll macro quay chậm hộp sản phẩm nguyên seal, dao rọc mở hộp sắc nét.',
        voiceover: 'Trên tay mình hôm nay là chiếc tai nghe chống ồn được săn đón nhất tuần qua. Liệu có xứng đáng với mức giá 3 triệu?',
        onScreenText: 'ĐẬP HỘP CHIẾC TAI NGHE HOT NHẤT 🎧'
      },
      {
        id: 'scene-tech-2',
        order: 2,
        title: 'Thiết Kế & Cảm Giác Đeo (10-25s)',
        durationSec: 15,
        visualPrompt: 'Quay cận chất liệu nhôm anodized, đệm tai mút hoạt tính, cảm giác cầm trên tay.',
        voiceover: 'Về thiết kế, độ hoàn thiện cực kỳ cao cấp với bản lề kim loại êm ái và trọng lượng siêu nhẹ chỉ 240g.',
        onScreenText: 'Thiết Kế Kim Loại · Siêu Nhẹ 240g'
      },
      {
        id: 'scene-tech-3',
        order: 3,
        title: 'Chất Âm & Chống Ồn (25-45s)',
        durationSec: 20,
        visualPrompt: 'Đeo tai nghe giữa phố đông người, hiệu ứng sóng âm tắt dần tượng trưng cho chống ồn.',
        voiceover: 'Chống ồn chủ động ANC triệt tiêu tới 95% tiếng ồn đường phố. Dải bass dày, ấm, rất hợp nghe Pop và EDM.',
        onScreenText: 'ANC Triệt Tiêu 95% Ồn · Bass Sâu'
      },
      {
        id: 'scene-tech-4',
        order: 4,
        title: 'Kết Luận & Điểm Số (45-60s)',
        durationSec: 15,
        visualPrompt: 'Đặt sản phẩm lên kệ công nghệ, bảng tóm tắt ưu nhược điểm xuất hiện.',
        voiceover: 'Tổng kết: 8.5/10 điểm trong phân khúc. Chi tiết link mua ưu đãi ở phần mô tả, đừng quên bấm Đăng ký kênh nhé!',
        onScreenText: 'ĐÁNH GIÁ: 8.5/10 · XỨNG ĐÁNG ĐẦU TƯ 👍'
      }
    ]
  }
]

/**
 * Parses duration string to target seconds.
 */
export function durationToSeconds(dur: AiScriptDuration): number {
  switch (dur) {
    case '15s':
      return 15
    case '30s':
      return 30
    case '60s':
      return 60
    case '120s':
      return 120
    default:
      return 30
  }
}

/**
 * Formats a script into readable Markdown text.
 */
export function exportScriptMarkdown(script: TmcutAiScript): string {
  const lines: string[] = []
  lines.push(`# ${script.title}`)
  lines.push(`> **Mô tả:** ${script.synopsis}`)
  lines.push(`> **Thời lượng mục tiêu:** ${script.targetDurationSec}s | **Nền tảng:** ${script.platform}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const s of script.scenes) {
    lines.push(`### Cảnh ${s.order}: ${s.title} (${s.durationSec}s)`)
    if (s.visualPrompt) lines.push(`- **Hình ảnh / B-Roll:** ${s.visualPrompt}`)
    if (s.voiceover) lines.push(`- **Lời thoại / Voiceover:** "${s.voiceover}"`)
    if (s.onScreenText) lines.push(`- **Chữ trên màn hình:** [${s.onScreenText}]`)
    lines.push('')
  }

  return lines.join('\n')
}
