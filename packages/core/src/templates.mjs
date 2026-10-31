// =============================================================================
//  @tmcut/core — templates
//  Timeline template engine & built-in catalog (Roadmap J-1).
//  Zero-dependency, pure logic module for creating, instantiating, and
//  managing timeline project templates with placeholders.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'

// Template schema contract (roadmap v3 §6.2 / PART K Phase 3). Every new
// template records the schema version it was written against; imports run
// through migrateTemplate so old files keep loading and FUTURE versions are
// refused instead of being half-read. v1 = the shape every existing template
// (builtins + R131 exports) already uses — version fields are optional
// there, and their ABSENCE is the v1 signal on purpose.
export const TEMPLATE_SCHEMA_VERSION = 1
export const TEMPLATE_MIN_SUPPORTED_VERSION = 1

let templateCounter = 0

function uid(prefix = 'tpl') {
  templateCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${templateCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  return JSON.parse(JSON.stringify(obj))
}

// File name of a src (either path flavour) — display hint only, never a path.
function fileNameFromSrc(src) {
  const parts = String(src).split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

// Stable-ish identity for a local src: the file name. A full absolute path
// would leak another user's directory layout into a shared template, so the
// fingerprint is intentionally name-only (collisions just mean the apply
// flow asks once instead of twice).
function localAssetFingerprint(src) {
  return fileNameFromSrc(src)
}

// =============================================================================
//  Industry template pack
//  ---------------------------------------------------------------------------
//  The six templates below cover FORMATS (opener, promo, split, outro…).
//  This pack covers INDUSTRIES: one or two ready-to-shoot cards per field of
//  business, all built from a handful of layout archetypes so each one is a
//  real editable timeline (media bed + headline beats + CTA), not a mock-up.
//  Copy ships in Vietnamese — the app's default locale — and lives in text
//  clips, so the Customize dialog rewrites it like any other placeholder.
//  `tags` carries the Vietnamese keywords users actually type; filterTemplates
//  searches them, which is what makes "quán ăn" find the F&B cards.
// =============================================================================

/** Industry ids a template can be filed under. UI labels come from i18n. */
export const INDUSTRY_CATALOG = [
  { id: 'general', label: 'Any Industry', icon: 'i-lucide-globe' },
  { id: 'fnb', label: 'Food & Beverage', icon: 'i-lucide-utensils-crossed' },
  { id: 'beauty', label: 'Beauty & Spa', icon: 'i-lucide-sparkles' },
  { id: 'fashion', label: 'Fashion & Retail', icon: 'i-lucide-shirt' },
  { id: 'health', label: 'Health & Fitness', icon: 'i-lucide-dumbbell' },
  { id: 'realestate', label: 'Real Estate', icon: 'i-lucide-building-2' },
  { id: 'education', label: 'Education', icon: 'i-lucide-graduation-cap' },
  { id: 'travel', label: 'Travel & Hospitality', icon: 'i-lucide-plane' },
  { id: 'tech', label: 'Tech & SaaS', icon: 'i-lucide-rocket' },
  { id: 'finance', label: 'Finance & Insurance', icon: 'i-lucide-landmark' },
  { id: 'automotive', label: 'Automotive', icon: 'i-lucide-car' },
  { id: 'medical', label: 'Healthcare & Clinic', icon: 'i-lucide-stethoscope' },
  { id: 'services', label: 'Local Services', icon: 'i-lucide-wrench' },
  { id: 'events', label: 'Wedding & Events', icon: 'i-lucide-heart-handshake' },
  { id: 'ecommerce', label: 'E-commerce', icon: 'i-lucide-shopping-bag' },
  { id: 'pets', label: 'Pets', icon: 'i-lucide-paw-print' },
  { id: 'creator', label: 'Creator & Media', icon: 'i-lucide-clapperboard' }
]

const PACK_CANVAS = {
  '9:16': { width: 1080, height: 1920, fps: 30 },
  '16:9': { width: 1920, height: 1080, fps: 30 },
  '1:1': { width: 1080, height: 1080, fps: 30 }
}

const PACK_ACCENT = '#ffd166'
const packMs = seconds => Math.round(seconds * TICKS_PER_SECOND)

function packSizes(vertical) {
  return vertical
    ? { h1: 76, h2: 46, body: 34, cta: 32, eyebrow: 34 }
    : { h1: 58, h2: 34, body: 28, cta: 26, eyebrow: 26 }
}

function packTextClip(id, def, durationTicks) {
  const start = def.inTicks || 0
  return {
    id,
    type: 'text',
    name: def.name,
    text: def.text,
    color: def.color || '#ffffff',
    fontSize: Math.round(def.fontSize),
    fontFamily: 'Inter',
    bold: def.bold !== false,
    shadow: true,
    align: def.align || 'center',
    animIn: def.animIn || 'slide-up',
    animInDuration: def.animInDuration ?? 0.4,
    animOut: 'fade',
    animOutDuration: 0.3,
    x: Math.round(def.x || 0),
    y: Math.round(def.y || 0),
    scale: 100,
    opacity: 100,
    rotation: 0,
    in: start,
    out: def.outTicks || durationTicks,
    offset: start,
    speed: 1,
    effects: [],
    keyframes: []
  }
}

function packMediaClip(id, name, durationTicks, opacity = 100) {
  return {
    id,
    type: 'video',
    name,
    src: '',
    x: 0,
    y: 0,
    scale: 100,
    opacity,
    rotation: 0,
    fit: 'cover',
    in: 0,
    out: durationTicks,
    offset: 0,
    speed: 1,
    effects: [],
    keyframes: []
  }
}

function packAudioClip(id, name, durationTicks) {
  return {
    id,
    type: 'audio',
    name,
    src: '',
    in: 0,
    out: durationTicks,
    offset: 0,
    speed: 1,
    volume: 70,
    fade: { in: packMs(0.4), out: packMs(0.6) },
    effects: [],
    keyframes: []
  }
}

/**
 * Text-beat archetypes. Each returns clip defs positioned in canvas pixels
 * (x/y are offsets from canvas centre, the same convention the preview and
 * the Inspector use). Keeping them here — instead of hand-writing 24 sets of
 * coordinates — is what makes every card in the pack consistent and testable.
 */
const PACK_LAYOUTS = {
  hook({ H, copy, accent, sizes }) {
    const defs = [{
      key: 'title',
      name: 'Headline',
      text: copy.title,
      y: -0.28 * H,
      fontSize: sizes.h1,
      animIn: 'slide-up',
      animInDuration: 0.5,
      required: true
    }]
    if (copy.subtitle) {
      defs.push({
        key: 'subtitle',
        name: 'Subheadline',
        text: copy.subtitle,
        y: -0.16 * H,
        fontSize: sizes.body,
        bold: false,
        color: '#f2f2f2',
        animIn: 'fade',
        inTicks: packMs(0.2)
      })
    }
    if (copy.cta) {
      defs.push({
        key: 'cta',
        name: 'Call To Action',
        text: copy.cta,
        y: 0.42 * H,
        fontSize: sizes.cta,
        color: accent,
        inTicks: packMs(0.9)
      })
    }
    return defs
  },

  listicle({ H, copy, accent, sizes, durationTicks }) {
    const defs = [{
      key: 'eyebrow',
      name: 'Kicker',
      text: copy.eyebrow,
      y: -0.34 * H,
      fontSize: sizes.eyebrow,
      color: accent,
      animIn: 'fade',
      required: true
    }]
    ;(copy.items || []).forEach((text, index) => {
      defs.push({
        key: `item${index + 1}`,
        name: `List Item ${index + 1}`,
        text,
        y: (-0.16 + index * 0.14) * H,
        fontSize: sizes.h2,
        animIn: 'slide-right',
        inTicks: packMs(0.4 + index * 1.8)
      })
    })
    if (copy.cta) {
      defs.push({
        key: 'cta',
        name: 'Call To Action',
        text: copy.cta,
        y: 0.38 * H,
        fontSize: sizes.cta,
        color: accent,
        inTicks: Math.max(packMs(0.4), durationTicks - packMs(1.6))
      })
    }
    return defs
  },

  banner({ H, copy, accent, sizes }) {
    const defs = [{
      key: 'title',
      name: 'Headline',
      text: copy.title,
      y: -0.1 * H,
      fontSize: sizes.h1,
      animIn: 'slide-up',
      animInDuration: 0.5,
      required: true
    }]
    if (copy.subtitle) {
      defs.push({
        key: 'subtitle',
        name: 'Subheadline',
        text: copy.subtitle,
        y: 0.01 * H,
        fontSize: sizes.body,
        bold: false,
        color: '#eeeeee',
        animIn: 'fade',
        inTicks: packMs(0.25)
      })
    }
    if (copy.cta) {
      defs.push({
        key: 'cta',
        name: 'Call To Action',
        text: copy.cta,
        y: 0.16 * H,
        fontSize: sizes.cta,
        color: accent,
        inTicks: packMs(0.7)
      })
    }
    return defs
  },

  price({ H, copy, accent, sizes }) {
    const defs = [{
      key: 'title',
      name: 'Price / Offer',
      text: copy.title,
      y: 0.04 * H,
      fontSize: sizes.h1 * 1.2,
      color: accent,
      animIn: 'slide-up',
      animInDuration: 0.45,
      required: true
    }]
    if (copy.subtitle) {
      defs.push({
        key: 'subtitle',
        name: 'Offer Details',
        text: copy.subtitle,
        y: 0.16 * H,
        fontSize: sizes.body,
        bold: false,
        color: '#f2f2f2',
        animIn: 'fade',
        inTicks: packMs(0.35)
      })
    }
    if (copy.cta) {
      defs.push({
        key: 'cta',
        name: 'Call To Action',
        text: copy.cta,
        y: 0.28 * H,
        fontSize: sizes.cta,
        color: '#ffffff',
        inTicks: packMs(0.8)
      })
    }
    return defs
  },

  'lower-third'({ H, W, copy, accent, sizes }) {
    const x = -0.22 * W
    const defs = [{
      key: 'title',
      name: 'Name / Subject',
      text: copy.title,
      x,
      y: 0.3 * H,
      fontSize: sizes.h2,
      align: 'left',
      animIn: 'slide-right',
      required: true
    }]
    if (copy.subtitle) {
      defs.push({
        key: 'subtitle',
        name: 'Role / Detail Line',
        text: copy.subtitle,
        x,
        y: 0.345 * H,
        fontSize: Math.round(sizes.body * 0.82),
        bold: false,
        color: accent,
        align: 'left',
        animIn: 'slide-right',
        inTicks: packMs(0.25)
      })
    }
    return defs
  },

  'before-after'({ H, copy, accent, sizes, durationTicks }) {
    const mid = Math.round(durationTicks / 2)
    const defs = []
    if (copy.subtitle) {
      defs.push({
        key: 'subtitle',
        name: 'Context Caption',
        text: copy.subtitle,
        y: -0.36 * H,
        fontSize: sizes.body,
        bold: false,
        color: '#f2f2f2',
        animIn: 'fade',
        inTicks: packMs(0.2),
        required: true
      })
    }
    defs.push({
      key: 'before',
      name: 'Before Label',
      text: copy.before,
      y: -0.02 * H,
      fontSize: sizes.h1 * 0.9,
      outTicks: mid,
      animIn: 'slide-up',
      animInDuration: 0.4,
      required: true
    })
    if (copy.after) {
      defs.push({
        key: 'after',
        name: 'After Label',
        text: copy.after,
        y: -0.02 * H,
        fontSize: sizes.h1 * 0.9,
        color: accent,
        inTicks: mid,
        animIn: 'slide-up',
        animInDuration: 0.4
      })
    }
    return defs
  },

  stack({ H, copy, accent, sizes }) {
    const defs = [{
      key: 'title',
      name: 'Headline',
      text: copy.title,
      y: -0.02 * H,
      fontSize: sizes.h1,
      animIn: 'slide-up',
      animInDuration: 0.5,
      inTicks: packMs(0.2),
      required: true
    }]
    if (copy.eyebrow) {
      defs.unshift({
        key: 'eyebrow',
        name: 'Kicker',
        text: copy.eyebrow,
        y: -0.2 * H,
        fontSize: sizes.eyebrow,
        color: accent,
        animIn: 'fade',
        inTicks: 0
      })
    }
    if (copy.cta) {
      defs.push({
        key: 'cta',
        name: 'Call To Action',
        text: copy.cta,
        y: 0.16 * H,
        fontSize: sizes.cta,
        color: '#ffffff',
        inTicks: packMs(0.8)
      })
    }
    return defs
  }
}

/**
 * Turns one compact spec into a full template: canvas, text beats, media bed,
 * optional music slot, and the placeholder map the Customize dialog reads.
 */
function buildIndustryTemplate(spec) {
  const canvas = PACK_CANVAS[spec.aspectRatio]
  const durationTicks = packMs(spec.seconds)
  const key = spec.id.replace(/^tpl-/, '')
  const accent = spec.accent || PACK_ACCENT
  const vertical = canvas.height > canvas.width
  const sizes = packSizes(vertical)
  const defs = PACK_LAYOUTS[spec.layout]({ H: canvas.height, W: canvas.width, copy: spec.copy, accent, sizes, durationTicks })

  const textTracks = defs.map(def => ({
    id: `tr-${key}-text-${def.key}`,
    type: 'text',
    name: def.name,
    items: [packTextClip(`c-${key}-${def.key}`, def, durationTicks)]
  }))
  const mediaTrackId = `tr-${key}-media`
  const audioTrackId = `tr-${key}-audio`
  const mediaClipId = `c-${key}-media`
  const audioClipId = `c-${key}-audio`

  const mediaTrack = {
    id: mediaTrackId,
    type: 'video',
    name: spec.mediaTrackName || 'Main Footage',
    items: [packMediaClip(mediaClipId, spec.mediaLabel || 'Main Footage', durationTicks, spec.mediaOpacity ?? 100)]
  }
  const audioTrack = {
    id: audioTrackId,
    type: 'audio',
    name: 'Background Music',
    items: [packAudioClip(audioClipId, 'Music Bed', durationTicks)]
  }

  const placeholders = [
    {
      id: `ph-${key}-media`,
      type: 'video',
      label: spec.mediaLabel || 'Main Footage',
      clipId: mediaClipId,
      trackId: mediaTrackId,
      required: true
    },
    ...defs.map(def => ({
      id: `ph-${key}-${def.key}`,
      type: 'text',
      label: def.name,
      clipId: `c-${key}-${def.key}`,
      trackId: `tr-${key}-text-${def.key}`,
      defaultContent: def.text,
      required: !!def.required
    })),
    {
      id: `ph-${key}-audio`,
      type: 'audio',
      label: 'Background Music',
      clipId: audioClipId,
      trackId: audioTrackId,
      required: false
    }
  ]

  return {
    // No schemaVersion on shipped builtins: like the six hand-written cards
    // above, absence IS the v1 signal and migrateTemplate() stamps it on
    // import. Every builtin must keep migrating cleanly.
    id: spec.id,
    version: 1,
    name: spec.name,
    description: spec.description,
    industry: spec.industry,
    tags: spec.tags || [],
    category: spec.category,
    aspectRatio: spec.aspectRatio,
    canvas,
    durationTicks,
    thumbnail: spec.thumbnail,
    isBuiltin: true,
    createdAt: 1776000000000,
    placeholders,
    tracks: [...textTracks, mediaTrack, audioTrack]
  }
}

/**
 * One spec per industry card. `copy` is placeholder text the user replaces in
 * the Customize dialog; `tags` are the search keywords (Vietnamese + English).
 */
const INDUSTRY_TEMPLATE_SPECS = [
  {
    id: 'tpl-fnb-menu-price-reveal',
    name: 'Menu Price Reveal',
    description: 'Vertical F&B price card: dish footage, oversized price, urgency line and visit CTA.',
    industry: 'fnb',
    category: 'promo',
    aspectRatio: '9:16',
    seconds: 6,
    layout: 'price',
    thumbnail: 'i-lucide-utensils-crossed',
    accent: '#ffb703',
    mediaLabel: 'Dish / Combo Footage',
    mediaTrackName: 'Dish Footage',
    tags: ['quán ăn', 'menu', 'giá', 'combo', 'nhà hàng', 'food', 'price', 'restaurant'],
    copy: {
      title: 'COMBO TRƯA 59K',
      subtitle: '1 MÓN CHÍNH + TRÀ ĐÁ + TRÁNG MIỆNG',
      cta: 'GHÉ QUÁN HÔM NAY'
    }
  },
  {
    id: 'tpl-fnb-dish-story',
    name: 'Dish Close-Up Story',
    description: 'Minimal vertical story for one signature dish with a lower-third name card.',
    industry: 'fnb',
    category: 'minimal',
    aspectRatio: '9:16',
    seconds: 5,
    layout: 'lower-third',
    thumbnail: 'i-lucide-chef-hat',
    accent: '#ffd166',
    mediaLabel: 'Signature Dish Footage',
    mediaTrackName: 'Dish Footage',
    tags: ['món ăn', 'review quán', 'đặc sản', 'food review', 'dish'],
    copy: {
      title: 'PHỞ BÒ GIA TRUYỀN',
      subtitle: 'NƯỚC DÙNG 12 TIẾNG · 35K'
    }
  },
  {
    id: 'tpl-beauty-before-after',
    name: 'Before / After Reveal',
    description: 'Skincare and spa proof video: before label, timed reveal, result caption.',
    industry: 'beauty',
    category: 'promo',
    aspectRatio: '9:16',
    seconds: 8,
    layout: 'before-after',
    thumbnail: 'i-lucide-sparkles',
    accent: '#7ef0c3',
    mediaLabel: 'Treatment / Result Footage',
    mediaTrackName: 'Treatment Footage',
    tags: ['spa', 'skincare', 'trước sau', 'beauty', 'da', 'before after'],
    copy: {
      before: 'TRƯỚC KHI DÙNG',
      after: 'SAU 4 TUẦN',
      subtitle: 'LIỆU TRÌNH 4 BƯỚC TẠI SPA'
    }
  },
  {
    id: 'tpl-beauty-service-combo',
    name: 'Service Combo Spotlight',
    description: 'Warm vertical card for a spa/beauty combo with kicker, price and booking CTA.',
    industry: 'beauty',
    category: 'promo',
    aspectRatio: '9:16',
    seconds: 6,
    layout: 'stack',
    thumbnail: 'i-lucide-flower-2',
    accent: '#ff8fab',
    mediaLabel: 'Spa / Salon Footage',
    mediaTrackName: 'Service Footage',
    tags: ['spa', 'combo', 'khuyến mãi', 'làm đẹp', 'salon', 'beauty'],
    copy: {
      eyebrow: 'ƯU ĐÃI THÁNG NÀY',
      title: 'COMBO 3 BƯỚC CHỈ 299K',
      cta: 'ĐẶT LỊCH NGAY'
    }
  },
  {
    id: 'tpl-fashion-new-drop',
    name: 'New Drop Lookbook',
    description: 'Vertical lookbook opener for a new collection drop with shop CTA.',
    industry: 'fashion',
    category: 'promo',
    aspectRatio: '9:16',
    seconds: 6,
    layout: 'stack',
    thumbnail: 'i-lucide-shirt',
    accent: '#ffd166',
    mediaLabel: 'Lookbook Footage',
    mediaTrackName: 'Lookbook',
    tags: ['thời trang', 'lookbook', 'bộ sưu tập', 'shop quần áo', 'fashion'],
    copy: {
      eyebrow: 'BỘ SƯU TẬP MỚI',
      title: 'DROP MỚI ĐÃ LÊN KỆ',
      cta: 'MUA NGAY TẠI SHOP'
    }
  },
  {
    id: 'tpl-fashion-styling-tips',
    name: '3-Way Styling Tips',
    description: 'Three-beat listicle: one item, three outfits, save-for-later CTA.',
    industry: 'fashion',
    category: 'minimal',
    aspectRatio: '9:16',
    seconds: 9,
    layout: 'listicle',
    thumbnail: 'i-lucide-layers',
    accent: '#ffd166',
    mediaLabel: 'Outfit Footage',
    mediaTrackName: 'Outfit B-Roll',
    tags: ['mix đồ', 'phối đồ', 'thời trang', 'tips', 'styling'],
    copy: {
      eyebrow: '1 CHIẾC ÁO - 3 CÁCH MẶC',
      items: ['01 · ĐI LÀM', '02 · ĐI CHƠI', '03 · ĐI BIỂN'],
      cta: 'LƯU LẠI ĐỂ MẶC ĐẸP'
    }
  },
  {
    id: 'tpl-fitness-transformation',
    name: 'Fitness Transformation',
    description: 'Before/after transformation reel with day labels and a result caption.',
    industry: 'health',
    category: 'promo',
    aspectRatio: '9:16',
    seconds: 8,
    layout: 'before-after',
    thumbnail: 'i-lucide-dumbbell',
    accent: '#4ade80',
    mediaLabel: 'Training / Progress Footage',
    mediaTrackName: 'Progress Footage',
    tags: ['giảm cân', 'fitness', 'gym', 'lột xác', 'transformation', 'health'],
    copy: {
      before: 'NGÀY 1',
      after: 'NGÀY 90',
      subtitle: 'KHÔNG GYM VẪN GIẢM 8KG'
    }
  },
  {
    id: 'tpl-fitness-30-day-challenge',
    name: '30-Day Challenge',
    description: 'Habit-challenge listicle with three daily rules and a follow CTA.',
    industry: 'health',
    category: 'minimal',
    aspectRatio: '9:16',
    seconds: 9,
    layout: 'listicle',
    thumbnail: 'i-lucide-flame',
    accent: '#fb923c',
    mediaLabel: 'Workout / Habit Footage',
    mediaTrackName: 'Challenge Footage',
    tags: ['thử thách', 'thói quen', 'sức khỏe', 'health', 'challenge'],
    copy: {
      eyebrow: 'THỬ THÁCH 30 NGÀY',
      items: ['5 PHÚT MỖI SÁNG', 'KHÔNG ĐỒ NGỌT', 'NGỦ ĐỦ 7 TIẾNG'],
      cta: 'THEO DÕI ĐỂ XEM KẾT QUẢ'
    }
  },
  {
    id: 'tpl-realestate-property-tour',
    name: 'Property Tour Card',
    description: 'Widescreen listing card: price line, specs, hotline CTA over the walkthrough.',
    industry: 'realestate',
    category: 'promo',
    aspectRatio: '16:9',
    seconds: 8,
    layout: 'banner',
    thumbnail: 'i-lucide-building-2',
    accent: '#38bdf8',
    mediaLabel: 'Property Walkthrough',
    mediaTrackName: 'Property Footage',
    tags: ['bất động sản', 'căn hộ', 'nhà phố', 'môi giới', 'real estate', 'listing'],
    copy: {
      title: 'CĂN HỘ 2PN · VIEW SÔNG',
      subtitle: '78M² · SỔ HỒNG RIÊNG · NHẬN NHÀ NGAY',
      cta: 'GỌI ĐỂ XEM NHÀ THỰC TẾ'
    }
  },
  {
    id: 'tpl-realestate-open-house',
    name: 'Open House Hook',
    description: 'Three-second hook for a viewing appointment, built to stop the scroll.',
    industry: 'realestate',
    category: 'intro',
    aspectRatio: '9:16',
    seconds: 5,
    layout: 'hook',
    thumbnail: 'i-lucide-map-pin',
    accent: '#38bdf8',
    mediaLabel: 'House Tour Footage',
    mediaTrackName: 'House Footage',
    tags: ['nhà đất', 'mở bán', 'bất động sản', 'hook', 'open house'],
    copy: {
      title: 'NHÀ NÀY CÓ GÌ ĐẶC BIỆT?',
      subtitle: 'XEM HẾT 15 GIÂY LÀ BIẾT',
      cta: 'LƯU TIN ĐỂ ĐI XEM'
    }
  },
  {
    id: 'tpl-education-course-launch',
    name: 'Course Launch Banner',
    description: 'Widescreen course announcement with schedule line and early-bird CTA.',
    industry: 'education',
    category: 'promo',
    aspectRatio: '16:9',
    seconds: 8,
    layout: 'banner',
    thumbnail: 'i-lucide-graduation-cap',
    accent: '#a78bfa',
    mediaLabel: 'Class / Campus Footage',
    mediaTrackName: 'Course Footage',
    tags: ['khóa học', 'đào tạo', 'học excel', 'tuyển sinh', 'education', 'course'],
    copy: {
      title: 'KHOÁ HỌC EXCEL THỰC CHIẾN',
      subtitle: '8 BUỔI · LÀM ĐƯỢC VIỆC NGAY',
      cta: 'ĐĂNG KÝ SỚM ĐỂ GIỮ GIÁ'
    }
  },
  {
    id: 'tpl-education-micro-lesson',
    name: '3 Tips Micro-Lesson',
    description: 'Short-form lesson listicle: three actionable tips and a save CTA.',
    industry: 'education',
    category: 'minimal',
    aspectRatio: '9:16',
    seconds: 9,
    layout: 'listicle',
    thumbnail: 'i-lucide-lightbulb',
    accent: '#a78bfa',
    mediaLabel: 'Study / Teaching Footage',
    mediaTrackName: 'Lesson Footage',
    tags: ['mẹo học', 'sinh viên', 'kỹ năng', 'tips', 'study'],
    copy: {
      eyebrow: '3 MẸO HỌC NHANH',
      items: ['01 · CHIA NHỎ MỤC TIÊU', '02 · ÔN THEO CHU KỲ', '03 · DẠY LẠI NGƯỜI KHÁC'],
      cta: 'LƯU BÀI NÀY LẠI'
    }
  },
  {
    id: 'tpl-travel-destination-hook',
    name: 'Destination Hook',
    description: 'Travel opener with price line and a comment-pinned itinerary CTA.',
    industry: 'travel',
    category: 'intro',
    aspectRatio: '9:16',
    seconds: 6,
    layout: 'hook',
    thumbnail: 'i-lucide-plane',
    accent: '#fbbf24',
    mediaLabel: 'Destination Footage',
    mediaTrackName: 'Travel Footage',
    tags: ['du lịch', 'đà lạt', 'combo', 'homestay', 'travel', 'destination'],
    copy: {
      title: 'ĐỪNG BỎ LỠ ĐÀ LẠT MÙA NÀY',
      subtitle: '3 NGÀY 2 ĐÊM · 2TR5/NGƯỜI',
      cta: 'LỊCH TRÌNH CHI TIẾT Ở BÌNH LUẬN'
    }
  },
  {
    id: 'tpl-travel-room-tour',
    name: 'Hotel Room Tour',
    description: 'Widescreen room-tour card with nightly rate, inclusions and booking CTA.',
    industry: 'travel',
    category: 'promo',
    aspectRatio: '16:9',
    seconds: 8,
    layout: 'banner',
    thumbnail: 'i-lucide-hotel',
    accent: '#fbbf24',
    mediaLabel: 'Room / Resort Footage',
    mediaTrackName: 'Room Footage',
    tags: ['khách sạn', 'resort', 'phòng', 'du lịch', 'hotel', 'room tour'],
    copy: {
      title: 'PHÒNG VIEW BIỂN · 1TR2/ĐÊM',
      subtitle: 'GỒM BUFFET SÁNG VÀ XE ĐƯA ĐÓN',
      cta: 'ĐẶT PHÒNG NGAY HÔM NAY'
    }
  },
  {
    id: 'tpl-tech-product-launch',
    name: 'Product Launch Banner',
    description: 'Widescreen launch announcement: product name, value props, trial CTA.',
    industry: 'tech',
    category: 'promo',
    aspectRatio: '16:9',
    seconds: 6,
    layout: 'banner',
    thumbnail: 'i-lucide-rocket',
    accent: '#60a5fa',
    mediaLabel: 'Product / UI Footage',
    mediaTrackName: 'Product Footage',
    tags: ['sản phẩm', 'ra mắt', 'saas', 'app', 'launch', 'tech'],
    copy: {
      title: 'RA MẮT TMCUT 2.0',
      subtitle: 'DỰNG VIDEO TỰ ĐỘNG · XUẤT 4K · DÙNG THỬ 14 NGÀY',
      cta: 'BẤM DÙNG THỬ NGAY'
    }
  },
  {
    id: 'tpl-tech-feature-walkthrough',
    name: 'Feature Walkthrough',
    description: 'Two-line feature reveal for demo clips: kicker, feature name, try CTA.',
    industry: 'tech',
    category: 'minimal',
    aspectRatio: '16:9',
    seconds: 6,
    layout: 'stack',
    thumbnail: 'i-lucide-mouse-pointer-click',
    accent: '#60a5fa',
    mediaLabel: 'Screen Recording',
    mediaTrackName: 'Screen Capture',
    tags: ['tính năng', 'demo', 'product', 'saas', 'walkthrough'],
    copy: {
      eyebrow: 'TÍNH NĂNG MỚI',
      title: 'AUTOCUT BẰNG AI',
      cta: 'BẤM THỬ NGAY'
    }
  },
  {
    id: 'tpl-finance-loan-explainer',
    name: 'Loan Product Explainer',
    description: 'Three-point explainer for a finance product with a learn-more CTA.',
    industry: 'finance',
    category: 'promo',
    aspectRatio: '9:16',
    seconds: 9,
    layout: 'listicle',
    thumbnail: 'i-lucide-landmark',
    accent: '#34d399',
    mediaLabel: 'Advisor / Office Footage',
    mediaTrackName: 'Finance Footage',
    tags: ['vay vốn', 'tài chính', 'ngân hàng', 'bảo hiểm', 'finance', 'loan'],
    copy: {
      eyebrow: 'VAY TIÊU DÙNG 2026',
      items: ['HỒ SƠ ĐƠN GIẢN', 'DUYỆT NHANH TRONG NGÀY', 'LÃI SUẤT LINH HOẠT'],
      cta: 'TÌM HIỂU ĐIỀU KIỆN VAY'
    }
  },
  {
    id: 'tpl-automotive-car-listing',
    name: 'Car Listing Reel',
    description: 'Widescreen used-car listing: model line, condition specs, contact CTA.',
    industry: 'automotive',
    category: 'promo',
    aspectRatio: '16:9',
    seconds: 8,
    layout: 'banner',
    thumbnail: 'i-lucide-car',
    accent: '#f97316',
    mediaLabel: 'Car Exterior / Interior',
    mediaTrackName: 'Car Footage',
    tags: ['ô tô', 'xe cũ', 'bán xe', 'car', 'auto', 'listing'],
    copy: {
      title: 'VF8 2024 · LƯỚT 12.000KM',
      subtitle: 'XE CHÍNH CHỦ · BẢO HÀNH HÃNG',
      cta: 'LIÊN HỆ XEM XE'
    }
  },
  {
    id: 'tpl-medical-clinic-intro',
    name: 'Clinic Introduction',
    description: 'Clinic opener with opening hours and an online booking CTA.',
    industry: 'medical',
    category: 'intro',
    aspectRatio: '9:16',
    seconds: 6,
    layout: 'hook',
    thumbnail: 'i-lucide-stethoscope',
    accent: '#7dd3fc',
    mediaLabel: 'Clinic / Team Footage',
    mediaTrackName: 'Clinic Footage',
    tags: ['phòng khám', 'nha khoa', 'sức khỏe', 'đặt lịch', 'clinic', 'medical'],
    copy: {
      title: 'PHÒNG KHÁM MỞ CỬA 7H - 21H',
      subtitle: 'ĐẶT LỊCH ONLINE · KHÔNG PHẢI CHỜ',
      cta: 'ĐẶT LỊCH KHÁM NGAY'
    }
  },
  {
    id: 'tpl-services-local-offer',
    name: 'Local Service Offer',
    description: 'Service price card with response-time promise and booking CTA.',
    industry: 'services',
    category: 'promo',
    aspectRatio: '9:16',
    seconds: 6,
    layout: 'price',
    thumbnail: 'i-lucide-wrench',
    accent: '#f97316',
    mediaLabel: 'Service / Job Footage',
    mediaTrackName: 'Service Footage',
    tags: ['dịch vụ', 'sửa chữa', 'điện lạnh', 'vệ sinh', 'local service', 'repair'],
    copy: {
      title: 'VỆ SINH MÁY LẠNH 99K',
      subtitle: 'GỌI LÀ CÓ MẶT TRONG 2 GIỜ',
      cta: 'ĐẶT LỊCH NGAY'
    }
  },
  {
    id: 'tpl-events-wedding-invite',
    name: 'Wedding Invitation',
    description: 'Elegant vertical invitation with couple names, date and RSVP CTA.',
    industry: 'events',
    category: 'intro',
    aspectRatio: '9:16',
    seconds: 8,
    layout: 'stack',
    thumbnail: 'i-lucide-heart-handshake',
    accent: '#f9a8d4',
    mediaLabel: 'Couple / Venue Footage',
    mediaTrackName: 'Wedding Footage',
    tags: ['đám cưới', 'thiệp mời', 'sự kiện', 'wedding', 'event', 'invitation'],
    copy: {
      eyebrow: 'SAVE THE DATE',
      title: 'MINH & LAN · 20.12.2026',
      cta: 'XEM THIỆP MỜI'
    }
  },
  {
    id: 'tpl-ecommerce-unboxing-hook',
    name: 'Unboxing Hook',
    description: 'Unboxing opener that lands the question and price before the reveal.',
    industry: 'ecommerce',
    category: 'minimal',
    aspectRatio: '9:16',
    seconds: 6,
    layout: 'hook',
    thumbnail: 'i-lucide-package-open',
    accent: '#facc15',
    mediaLabel: 'Unboxing Footage',
    mediaTrackName: 'Unboxing',
    tags: ['unboxing', 'bóc hộp', 'review', 'shopee', 'ecommerce', 'haul'],
    copy: {
      title: 'MỞ HỘP ĐƠN 199K NÀY',
      subtitle: 'CÓ ĐÁNG TIỀN KHÔNG?',
      cta: 'MUA TẠI GIỎ HÀNG'
    }
  },
  {
    id: 'tpl-pets-ugc-review',
    name: 'Pet UGC Review',
    description: 'UGC-style pet review with a name card and product detail line.',
    industry: 'pets',
    category: 'minimal',
    aspectRatio: '9:16',
    seconds: 6,
    layout: 'lower-third',
    thumbnail: 'i-lucide-paw-print',
    accent: '#fda4af',
    mediaLabel: 'Pet Footage',
    mediaTrackName: 'Pet B-Roll',
    tags: ['thú cưng', 'mèo', 'chó', 'pate', 'pet', 'ugc'],
    copy: {
      title: 'BÔNG · 2 TUỔI',
      subtitle: 'REVIEW PATE CHO MÈO KÉN ĂN'
    }
  },
  {
    id: 'tpl-creator-channel-outro',
    name: 'Channel Outro Card',
    description: 'Widescreen outro card: thank-you line, subscribe prompt, bell CTA.',
    industry: 'creator',
    category: 'outro',
    aspectRatio: '16:9',
    seconds: 5,
    layout: 'banner',
    thumbnail: 'i-lucide-bell',
    accent: '#ef4444',
    mediaLabel: 'Background Footage',
    mediaTrackName: 'Outro Background',
    tags: ['outro', 'kết video', 'youtube', 'subscribe', 'creator'],
    copy: {
      title: 'CẢM ƠN ĐÃ XEM',
      subtitle: 'ĐĂNG KÝ KÊNH ĐỂ KHÔNG BỎ LỠ VIDEO MỚI',
      cta: 'BẤM CHUÔNG NGAY'
    }
  }
]

/**
 * Standard built-in templates ready to use.
 */
export const BUILTIN_TEMPLATES = [
  {
    id: 'tpl-tiktok-hook-intro',
    name: 'TikTok / Reels Hook Intro',
    description: 'Fast-paced viral vertical opener with high-impact headline text and media placeholder.',
    industry: 'creator',
    category: 'intro',
    aspectRatio: '9:16',
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationTicks: 3 * TICKS_PER_SECOND, // 3 seconds = 360,000 ticks
    thumbnail: 'i-lucide-smartphone',
    isBuiltin: true,
    createdAt: 1776000000000,
    placeholders: [
      {
        id: 'ph-hook-video',
        type: 'video',
        label: 'Hook Footage (3s)',
        clipId: 'c-hook-video-1',
        trackId: 'tr-video-1',
        required: true
      },
      {
        id: 'ph-hook-headline',
        type: 'text',
        label: 'Catchy Headline Text',
        clipId: 'c-hook-text-1',
        trackId: 'tr-text-1',
        defaultContent: 'STOP SCROLLING! ⚡',
        required: true
      },
      {
        id: 'ph-hook-sfx',
        type: 'audio',
        label: 'Whoosh SFX / Audio',
        clipId: 'c-hook-audio-1',
        trackId: 'tr-audio-1',
        required: false
      }
    ],
    tracks: [
      {
        id: 'tr-text-1',
        type: 'text',
        name: 'Text Overlay',
        items: [
          {
            id: 'c-hook-text-1',
            type: 'text',
            name: 'Headline',
            text: 'STOP SCROLLING! ⚡',
            color: '#ffdd00',
            fontSize: 54,
            fontFamily: 'Outfit',
            bold: true,
            stroke: true,
            shadow: true,
            align: 'center',
            animIn: 'zoom-in',
            animInDuration: 0.35,
            x: 0,
            y: -150,
            scale: 100,
            opacity: 100,
            rotation: 0,
            in: 0,
            out: 360000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-video-1',
        type: 'video',
        name: 'Main Video',
        items: [
          {
            id: 'c-hook-video-1',
            type: 'video',
            name: 'Hook Media Placeholder',
            src: '',
            x: 0,
            y: 0,
            scale: 100,
            opacity: 100,
            rotation: 0,
            fit: 'crop',
            in: 0,
            out: 360000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-audio-1',
        type: 'audio',
        name: 'Audio SFX',
        items: [
          {
            id: 'c-hook-audio-1',
            type: 'audio',
            name: 'Whoosh SFX',
            src: '',
            in: 0,
            out: 360000,
            offset: 0,
            speed: 1,
            volume: 90,
            fade: { in: 0, out: TICKS_PER_SECOND * 0.5 },
            effects: [],
            keyframes: []
          }
        ]
      }
    ]
  },
  {
    id: 'tpl-youtube-cinematic-intro',
    name: 'YouTube Cinematic Title',
    description: 'Clean cinematic widescreen intro with smooth fade, elegant typography and ambient atmosphere.',
    industry: 'general',
    category: 'intro',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080, fps: 30 },
    durationTicks: 5 * TICKS_PER_SECOND, // 5 seconds = 600,000 ticks
    thumbnail: 'i-lucide-monitor',
    isBuiltin: true,
    createdAt: 1776000000000,
    placeholders: [
      {
        id: 'ph-cine-video',
        type: 'video',
        label: 'Scenic B-Roll Footage',
        clipId: 'c-cine-video-1',
        trackId: 'tr-cine-video',
        required: true
      },
      {
        id: 'ph-cine-title',
        type: 'text',
        label: 'Cinematic Title',
        clipId: 'c-cine-text-1',
        trackId: 'tr-cine-text',
        defaultContent: 'THE JOURNEY BEGINS',
        required: true
      },
      {
        id: 'ph-cine-bgm',
        type: 'audio',
        label: 'Ambient Intro Music',
        clipId: 'c-cine-audio-1',
        trackId: 'tr-cine-audio',
        required: false
      }
    ],
    tracks: [
      {
        id: 'tr-cine-text',
        type: 'text',
        name: 'Title Text',
        items: [
          {
            id: 'c-cine-text-1',
            type: 'text',
            name: 'Cinematic Title',
            text: 'THE JOURNEY BEGINS',
            color: '#ffffff',
            fontSize: 48,
            fontFamily: 'Inter',
            bold: false,
            shadow: true,
            align: 'center',
            animIn: 'fade',
            animInDuration: 0.8,
            animOut: 'fade',
            animOutDuration: 0.8,
            x: 0,
            y: 0,
            scale: 100,
            opacity: 100,
            rotation: 0,
            in: 0,
            out: 600000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-cine-video',
        type: 'video',
        name: 'Background Video',
        items: [
          {
            id: 'c-cine-video-1',
            type: 'video',
            name: 'Scenic B-Roll',
            src: '',
            x: 0,
            y: 0,
            scale: 100,
            opacity: 100,
            rotation: 0,
            fit: 'fit',
            in: 0,
            out: 600000,
            offset: 0,
            speed: 1,
            fade: { in: TICKS_PER_SECOND, out: TICKS_PER_SECOND },
            effects: [
              { type: 'vignette', params: { intensity: 0.4 } }
            ],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-cine-audio',
        type: 'audio',
        name: 'Background Music',
        items: [
          {
            id: 'c-cine-audio-1',
            type: 'audio',
            name: 'Ambient Soundtrack',
            src: '',
            in: 0,
            out: 600000,
            offset: 0,
            speed: 1,
            volume: 80,
            fade: { in: TICKS_PER_SECOND * 0.5, out: TICKS_PER_SECOND * 0.8 },
            effects: [],
            keyframes: []
          }
        ]
      }
    ]
  },
  {
    id: 'tpl-split-screen-duo',
    name: 'Dual Split-Screen (Top & Bottom)',
    description: 'Two synchronized vertical boxes for reaction videos, comparisons, and dual camera angles.',
    industry: 'creator',
    category: 'split-screen',
    aspectRatio: '9:16',
    canvas: { width: 1080, height: 1920, fps: 30 },
    durationTicks: 6 * TICKS_PER_SECOND, // 6 seconds = 720,000 ticks
    thumbnail: 'i-lucide-columns-2',
    isBuiltin: true,
    createdAt: 1776000000000,
    placeholders: [
      {
        id: 'ph-split-top',
        type: 'video',
        label: 'Top Video (Original / Subject)',
        clipId: 'c-split-v1',
        trackId: 'tr-split-top',
        required: true
      },
      {
        id: 'ph-split-bottom',
        type: 'video',
        label: 'Bottom Video (Reaction / Comparison)',
        clipId: 'c-split-v2',
        trackId: 'tr-split-bottom',
        required: true
      },
      {
        id: 'ph-split-badge',
        type: 'text',
        label: 'Center Separator Badge',
        clipId: 'c-split-badge-1',
        trackId: 'tr-split-badge',
        defaultContent: 'VS',
        required: false
      }
    ],
    tracks: [
      {
        id: 'tr-split-badge',
        type: 'text',
        name: 'Divider Badge',
        items: [
          {
            id: 'c-split-badge-1',
            type: 'text',
            name: 'VS Badge',
            text: 'VS',
            color: '#ff2d55',
            fontSize: 40,
            bold: true,
            stroke: true,
            align: 'center',
            x: 0,
            y: 0,
            scale: 100,
            opacity: 100,
            rotation: 0,
            in: 0,
            out: 720000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-split-top',
        type: 'video',
        name: 'Top Camera',
        items: [
          {
            id: 'c-split-v1',
            type: 'video',
            name: 'Top Screen Footage',
            src: '',
            x: 0,
            y: -480,
            scale: 100,
            opacity: 100,
            rotation: 0,
            fit: 'crop',
            cropRect: { x: 0, y: 0.1, w: 1, h: 0.8 },
            in: 0,
            out: 720000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-split-bottom',
        type: 'video',
        name: 'Bottom Camera',
        items: [
          {
            id: 'c-split-v2',
            type: 'video',
            name: 'Bottom Screen Footage',
            src: '',
            x: 0,
            y: 480,
            scale: 100,
            opacity: 100,
            rotation: 0,
            fit: 'crop',
            cropRect: { x: 0, y: 0.1, w: 1, h: 0.8 },
            in: 0,
            out: 720000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      }
    ]
  },
  {
    id: 'tpl-modern-promo-card',
    name: 'Instagram Square Product Promo',
    description: 'Clean 1:1 square promo card with price tag, headline, and centered product media.',
    industry: 'ecommerce',
    category: 'promo',
    aspectRatio: '1:1',
    canvas: { width: 1080, height: 1080, fps: 30 },
    durationTicks: 4 * TICKS_PER_SECOND, // 4 seconds = 480,000 ticks
    thumbnail: 'i-lucide-square',
    isBuiltin: true,
    createdAt: 1776000000000,
    placeholders: [
      {
        id: 'ph-promo-media',
        type: 'image',
        label: 'Product Photo / Video',
        clipId: 'c-promo-media-1',
        trackId: 'tr-promo-media',
        required: true
      },
      {
        id: 'ph-promo-title',
        type: 'text',
        label: 'Promotion Title',
        clipId: 'c-promo-text-1',
        trackId: 'tr-promo-text',
        defaultContent: 'SPECIAL DEAL 50% OFF',
        required: true
      },
      {
        id: 'ph-promo-cta',
        type: 'text',
        label: 'Call to Action',
        clipId: 'c-promo-text-2',
        trackId: 'tr-promo-text',
        defaultContent: 'TAP TO SHOP NOW',
        required: false
      }
    ],
    tracks: [
      {
        id: 'tr-promo-text',
        type: 'text',
        name: 'Promo Overlay',
        items: [
          {
            id: 'c-promo-text-1',
            type: 'text',
            name: 'Special Deal',
            text: 'SPECIAL DEAL 50% OFF',
            color: '#ffffff',
            fontSize: 42,
            bold: true,
            shadow: true,
            align: 'center',
            animIn: 'slide-up',
            animInDuration: 0.4,
            x: 0,
            y: -360,
            scale: 100,
            opacity: 100,
            rotation: 0,
            in: 0,
            out: 480000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          },
          {
            id: 'c-promo-text-2',
            type: 'text',
            name: 'Call to Action',
            text: 'TAP TO SHOP NOW',
            color: '#00ffcc',
            fontSize: 28,
            bold: true,
            shadow: true,
            align: 'center',
            animIn: 'fade',
            animInDuration: 0.5,
            x: 0,
            y: 380,
            scale: 100,
            opacity: 100,
            rotation: 0,
            in: 60000,
            out: 480000,
            offset: 60000,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-promo-media',
        type: 'video',
        name: 'Product Showcase',
        items: [
          {
            id: 'c-promo-media-1',
            type: 'video',
            name: 'Product Media',
            src: '',
            x: 0,
            y: 10,
            scale: 90,
            opacity: 100,
            rotation: 0,
            fit: 'fit',
            in: 0,
            out: 480000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      }
    ]
  },
  {
    id: 'tpl-outro-social-end',
    name: 'YouTube Outro & Subscribe Card',
    description: 'Widescreen outro screen prompting viewers to like, subscribe and check next video.',
    industry: 'creator',
    category: 'outro',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080, fps: 30 },
    durationTicks: 6 * TICKS_PER_SECOND, // 6 seconds = 720,000 ticks
    thumbnail: 'i-lucide-share-2',
    isBuiltin: true,
    createdAt: 1776000000000,
    placeholders: [
      {
        id: 'ph-outro-video',
        type: 'video',
        label: 'Outro Loop / Background Video',
        clipId: 'c-outro-video-1',
        trackId: 'tr-outro-bg',
        required: false
      },
      {
        id: 'ph-outro-thanks',
        type: 'text',
        label: 'Thank You Message',
        clipId: 'c-outro-text-1',
        trackId: 'tr-outro-text',
        defaultContent: 'THANKS FOR WATCHING!',
        required: true
      },
      {
        id: 'ph-outro-sub',
        type: 'text',
        label: 'Subscribe Text',
        clipId: 'c-outro-text-2',
        trackId: 'tr-outro-text',
        defaultContent: 'LIKE & SUBSCRIBE FOR MORE',
        required: false
      }
    ],
    tracks: [
      {
        id: 'tr-outro-text',
        type: 'text',
        name: 'Outro Titles',
        items: [
          {
            id: 'c-outro-text-1',
            type: 'text',
            name: 'Thanks Message',
            text: 'THANKS FOR WATCHING!',
            color: '#ffffff',
            fontSize: 46,
            bold: true,
            shadow: true,
            align: 'center',
            animIn: 'zoom-in',
            animInDuration: 0.5,
            x: 0,
            y: -220,
            scale: 100,
            opacity: 100,
            rotation: 0,
            in: 0,
            out: 720000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          },
          {
            id: 'c-outro-text-2',
            type: 'text',
            name: 'Subscribe Call',
            text: 'LIKE & SUBSCRIBE FOR MORE',
            color: '#ff3b30',
            fontSize: 30,
            bold: true,
            shadow: true,
            align: 'center',
            animIn: 'slide-up',
            animInDuration: 0.5,
            x: 0,
            y: 260,
            scale: 100,
            opacity: 100,
            rotation: 0,
            in: 96000,
            out: 720000,
            offset: 96000,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-outro-bg',
        type: 'video',
        name: 'Outro Background',
        items: [
          {
            id: 'c-outro-video-1',
            type: 'video',
            name: 'Outro Ambient BG',
            src: '',
            x: 0,
            y: 0,
            scale: 100,
            opacity: 100,
            rotation: 0,
            fit: 'cover',
            in: 0,
            out: 720000,
            offset: 0,
            speed: 1,
            effects: [
              { type: 'blur', params: { radius: 10 } }
            ],
            keyframes: []
          }
        ]
      }
    ]
  },
  {
    id: 'tpl-minimal-vlog-lowerthird',
    name: 'Minimal Vlog & Lower Third',
    description: 'Clean modern documentary overlay with lower-third speaker credit and location tag.',
    industry: 'general',
    category: 'minimal',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080, fps: 30 },
    durationTicks: 5 * TICKS_PER_SECOND, // 5 seconds = 600,000 ticks
    thumbnail: 'i-lucide-subtitles',
    isBuiltin: true,
    createdAt: 1776000000000,
    placeholders: [
      {
        id: 'ph-vlog-footage',
        type: 'video',
        label: 'Interview / Vlog Video',
        clipId: 'c-vlog-video-1',
        trackId: 'tr-vlog-footage',
        required: true
      },
      {
        id: 'ph-vlog-speaker',
        type: 'text',
        label: 'Speaker Name & Role',
        clipId: 'c-vlog-text-1',
        trackId: 'tr-vlog-titles',
        defaultContent: 'ALEX RIVERA · TRAVEL JOURNALIST',
        required: true
      }
    ],
    tracks: [
      {
        id: 'tr-vlog-titles',
        type: 'text',
        name: 'Lower Third Titles',
        items: [
          {
            id: 'c-vlog-text-1',
            type: 'text',
            name: 'Speaker Tag',
            text: 'ALEX RIVERA · TRAVEL JOURNALIST',
            color: '#ffffff',
            fontSize: 26,
            fontFamily: 'Inter',
            bold: true,
            shadow: true,
            align: 'left',
            animIn: 'slide-right',
            animInDuration: 0.45,
            animOut: 'fade',
            animOutDuration: 0.4,
            x: -420,
            y: 380,
            scale: 100,
            opacity: 100,
            rotation: 0,
            in: 60000,
            out: 540000,
            offset: 60000,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      },
      {
        id: 'tr-vlog-footage',
        type: 'video',
        name: 'Main Footage',
        items: [
          {
            id: 'c-vlog-video-1',
            type: 'video',
            name: 'Vlog Interview',
            src: '',
            x: 0,
            y: 0,
            scale: 100,
            opacity: 100,
            rotation: 0,
            fit: 'fit',
            in: 0,
            out: 600000,
            offset: 0,
            speed: 1,
            effects: [],
            keyframes: []
          }
        ]
      }
    ]
  },
  ...INDUSTRY_TEMPLATE_SPECS.map(buildIndustryTemplate)
]

/**
 * Returns a deep copy of built-in templates.
 */
export function getBuiltinTemplates() {
  return deepClone(BUILTIN_TEMPLATES)
}

/**
 * Finds a template by its ID in a given list or builtins.
 */
export function getTemplateById(templates, id) {
  const list = Array.isArray(templates) ? templates : BUILTIN_TEMPLATES
  return list.find(t => t && t.id === id) ?? null
}

/**
 * Validates whether an object matches the TmcutTemplate contract.
 */
export function validateTemplate(template) {
  const errors = []
  if (!template || typeof template !== 'object') {
    return { valid: false, errors: ['Template must be an object'] }
  }
  if (!template.id || typeof template.id !== 'string') {
    errors.push('Missing or invalid template id')
  }
  if (!template.name || typeof template.name !== 'string' || !template.name.trim()) {
    errors.push('Missing or empty template name')
  }
  if (!template.canvas || typeof template.canvas !== 'object') {
    errors.push('Missing template canvas')
  } else {
    if (!Number.isFinite(template.canvas.width) || template.canvas.width <= 0) {
      errors.push('Invalid canvas width')
    }
    if (!Number.isFinite(template.canvas.height) || template.canvas.height <= 0) {
      errors.push('Invalid canvas height')
    }
  }
  if (!Number.isFinite(template.durationTicks) || template.durationTicks <= 0) {
    errors.push('Invalid template durationTicks')
  }
  if (!Array.isArray(template.tracks)) {
    errors.push('Template tracks must be an array')
  }
  // schemaVersion is optional (absent = v1); anything present must be a
  // known, supported version number.
  if (template.schemaVersion !== undefined) {
    if (!Number.isFinite(template.schemaVersion) || !Number.isInteger(template.schemaVersion) || template.schemaVersion < 1) {
      errors.push('Invalid template schemaVersion')
    } else if (template.schemaVersion > TEMPLATE_SCHEMA_VERSION) {
      errors.push(`Template schemaVersion ${template.schemaVersion} is newer than this build supports (${TEMPLATE_SCHEMA_VERSION})`)
    }
  }
  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Migrate a raw (untrusted, possibly older) template object to the current
 * template schema. Returns { migrated, errors }: on any structural problem
 * the template is NOT usable and the caller must refuse it (roadmap §6.4:
 * validate schema + compatibility BEFORE anything else). A missing
 * schemaVersion means v1 (every template written before versioning).
 */
export function migrateTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { migrated: null, errors: ['Template must be an object'] }
  }
  const tpl = deepClone(raw)
  const declared = Number.isInteger(tpl.schemaVersion) && tpl.schemaVersion >= 1
    ? tpl.schemaVersion
    : TEMPLATE_MIN_SUPPORTED_VERSION
  if (declared > TEMPLATE_SCHEMA_VERSION) {
    return {
      migrated: null,
      errors: [`Template was created by a newer TMCut (schema v${declared}); update the app to open it`]
    }
  }
  // v1 -> current: identical shape; stamp the version so downstream code
  // (Asset Center required-asset checks, AI plan builder) can trust it.
  tpl.schemaVersion = TEMPLATE_SCHEMA_VERSION
  const validation = validateTemplate(tpl)
  if (!validation.valid) {
    return { migrated: null, errors: validation.errors }
  }
  return { migrated: tpl, errors: [] }
}

/**
 * Check a template's requiredAssets against the caller's installed-asset
 * view (roadmap §6.4 step 2 — rights/install state BEFORE building).
 * Pure: the host supplies what is installed; this classifies the need.
 *
 * @param {object} template
 * @param {{ installedIds?: string[] }} view - catalog ids that have a
 *   VERIFIED installed version (the Asset Center registry).
 * @returns {{ satisfied: object[], missingAssets: object[], localNeeds: object[] }}
 */
export function checkRequiredAssets(template, view = {}) {
  const installed = new Set(Array.isArray(view.installedIds) ? view.installedIds : [])
  const satisfied = []
  const missingAssets = []
  const localNeeds = []
  for (const ref of (template?.requiredAssets || [])) {
    if (!ref || typeof ref.assetId !== 'string') continue
    if (ref.assetId.startsWith('local:')) {
      // Files the template author had locally: the importing user always
      // resolves these themselves (ask-user), never a silent substitute.
      localNeeds.push(ref)
    } else if (installed.has(ref.assetId)) {
      satisfied.push(ref)
    } else {
      missingAssets.push(ref)
    }
  }
  return { satisfied, missingAssets, localNeeds }
}

/**
 * Filters templates by category, industry, aspect ratio, and search query.
 * Search covers name, description, tags and the industry label — the library
 * ships Vietnamese keywords in `tags` so "quán ăn" finds the F&B cards.
 */
export function filterTemplates(templates, options = {}) {
  const list = Array.isArray(templates) ? templates : BUILTIN_TEMPLATES
  const { category, aspectRatio, search, industry } = options

  return list.filter((tpl) => {
    if (!tpl) return false
    if (category && category !== 'all' && tpl.category !== category) {
      return false
    }
    if (industry && industry !== 'all' && tpl.industry !== industry) {
      return false
    }
    if (aspectRatio && aspectRatio !== 'all' && tpl.aspectRatio !== aspectRatio) {
      return false
    }
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase()
      const industryMeta = INDUSTRY_CATALOG.find(i => i.id === tpl.industry)
      const haystack = [
        tpl.name,
        tpl.description,
        tpl.industry,
        industryMeta ? industryMeta.label : '',
        ...(Array.isArray(tpl.tags) ? tpl.tags : [])
      ]
      const matched = haystack.some(value => String(value || '').toLowerCase().includes(q))
      if (!matched) return false
    }
    return true
  })
}

/**
 * Creates a template snapshot from an existing timeline.
 */
/**
 * Snapshot a host timeline into a reusable template.
 *
 * C16-R3: the host model stores integer TICKS (tmcut-core time.mjs), so
 * flat item geometry (in/out/offset) and marker times are ticks here too.
 * Duration is derived from the largest item end.
 */
export function createTemplateFromTimeline(timeline, meta = {}) {
  const tracks = deepClone(timeline?.tracks || [])
  const markers = deepClone(timeline?.markers || [])

  let maxEndTicks = 0
  const placeholders = []

  // Collect clips and auto-generate placeholders
  tracks.forEach((track, trkIdx) => {
    track.id = track.id || `tr-${trkIdx + 1}`
    if (Array.isArray(track.items)) {
      track.items.forEach((item, itemIdx) => {
        const speed = item.speed || 1
        const inTicks = item.in ?? 0
        const outTicks = item.out ?? 5 * TICKS_PER_SECOND
        const itemEnd = (item.offset ?? 0) + (outTicks - Math.max(0, Number.isFinite(inTicks) ? inTicks : 0)) / speed
        if (itemEnd > maxEndTicks) maxEndTicks = itemEnd

        placeholders.push({
          id: `ph-${track.type}-${trkIdx + 1}-${itemIdx + 1}`,
          type: track.type === 'text' ? 'text' : track.type === 'audio' ? 'audio' : 'video',
          label: item.name || item.text || `Item ${itemIdx + 1}`,
          clipId: item.id,
          trackId: track.id,
          defaultContent: item.text,
          required: false
        })
      })
    }
  })

  const durationTicks = Math.max(TICKS_PER_SECOND, Math.round(maxEndTicks))

  // Roadmap v3 §6.4 step 2: a template records the assets its clips need so
  // applying it can check install/rights state BEFORE building anything.
  // src-bearing non-text clips become references; user-local paths are NOT
  // stable ids, so they are captured as suggestions (fallback 'ask-user')
  // instead of pretending to be catalog entries.
  const requiredAssets = []
  const seenSrc = new Set()
  tracks.forEach((track) => {
    if (!Array.isArray(track.items)) return
    for (const item of track.items) {
      if (!item || track.type === 'text') continue
      const src = typeof item.src === 'string' ? item.src : ''
      if (!src || seenSrc.has(src)) continue
      seenSrc.add(src)
      // asset://<catalog-id> references are stable; everything else is a
      // local file the importing user must supply (ask-user fallback).
      const catalogRef = /^asset:\/\//.test(src) ? src.slice('asset://'.length) : ''
      requiredAssets.push({
        assetId: catalogRef ? `asset:${catalogRef}` : `local:${localAssetFingerprint(src)}`,
        required: true,
        fallback: 'ask-user',
        sourceHint: catalogRef ? '' : fileNameFromSrc(src)
      })
    }
  })

  const template = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: meta.id || uid('usr_tpl'),
    version: 1,
    name: meta.name || 'Custom Template',
    description: meta.description || '',
    category: meta.category || 'custom',
    aspectRatio: meta.aspectRatio || '16:9',
    canvas: meta.canvas ? deepClone(meta.canvas) : { width: 1920, height: 1080, fps: 30 },
    durationTicks,
    thumbnail: meta.thumbnail || 'i-lucide-layout-template',
    tracks,
    markers,
    placeholders: meta.placeholders || placeholders,
    requiredAssets,
    createdAt: meta.createdAt || Date.now(),
    isBuiltin: false,
    // §6.5 provenance label: "ai" for Template Plans, null/absent for the
    // manual "save as template" path. Display metadata only — the builder
    // sets it, validation never depends on it.
    generatedBy: meta.generatedBy || null
  }

  return template
}

/**
 * Instantiates a template into a fresh timeline with unique IDs and optional placeholder replacements.
 *
 * @param {object} template - The template definition
 * @param {object} [options] - Options containing optional replacements: { [placeholderId]: { src, text, name } }
 * @returns {object} { canvas, timeline, durationMs }
 */
export function instantiateTemplate(template, options = {}) {
  const cloned = deepClone(template)
  const replacements = options.replacements || {}

  // Map old clip IDs to placeholder mappings
  const placeholderByClipId = new Map()
  if (Array.isArray(cloned.placeholders)) {
    for (const ph of cloned.placeholders) {
      if (ph.clipId) {
        placeholderByClipId.set(ph.clipId, ph)
      }
    }
  }

  const tracks = (cloned.tracks || []).map((track, trkIdx) => {
    const newTrackId = `t-${track.type || 'track'}-${trkIdx + 1}-${Math.random().toString(36).slice(2, 6)}`
    const items = (track.items || []).map((item) => {
      const newClipId = `clip_${Math.random().toString(36).slice(2, 10)}`
      const newItem = { ...item, id: newClipId }

      // Check if this clip was associated with a placeholder
      const ph = placeholderByClipId.get(item.id)
      if (ph && replacements[ph.id]) {
        const rep = replacements[ph.id]
        if (rep.src !== undefined) newItem.src = rep.src
        if (rep.text !== undefined) newItem.text = rep.text
        if (rep.name !== undefined) newItem.name = rep.name
      }

      return newItem
    })

    return {
      ...track,
      id: newTrackId,
      items
    }
  })

  const durationSec = cloned.durationTicks / TICKS_PER_SECOND
  const durationMs = Math.round(durationSec * 1000)

  return {
    canvas: cloned.canvas,
    timeline: {
      version: 1,
      tracks,
      durationMs,
      markers: cloned.markers || []
    },
    durationMs
  }
}

/**
 * Replaces a placeholder clip in a timeline with new media or text.
 */
export function replacePlaceholder(timeline, clipId, replacement = {}) {
  if (!timeline || !Array.isArray(timeline.tracks)) return false

  let modified = false
  for (const track of timeline.tracks) {
    if (!Array.isArray(track.items)) continue
    for (const item of track.items) {
      if (item && item.id === clipId) {
        if (replacement.src !== undefined) item.src = replacement.src
        if (replacement.text !== undefined) item.text = replacement.text
        if (replacement.name !== undefined) item.name = replacement.name
        if (replacement.thumbPath !== undefined) item.thumbPath = replacement.thumbPath
        modified = true
        break
      }
    }
    if (modified) break
  }
  return modified
}
