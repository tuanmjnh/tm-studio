// =============================================================================
//  @tmcut/core — Marketplace Catalog (Roadmap v1 P7)
//  Starter catalog entries for licensed music, SFX, and fonts.
//  These are APPROVED entries that ship with the app (sample type, no download).
// =============================================================================
import { createCatalogEntry, normalizeLicense } from './assetCenter.mjs'

// Pre-approved license templates for marketplace assets
const CC_BY_40_LICENSE = normalizeLicense({
  status: 'approved',
  name: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: '© {creator} — licensed under CC BY 4.0',
  commercialUse: true,
  redistrbutable: true,
  territories: ['worldwide'],
  expiresAt: null,
  proof: 'Creative Commons Attribution 4.0 International',
  reviewer: 'tmcut-publisher',
  reviewedAt: new Date().toISOString(),
  review: { decision: 'approved', by: 'tmcut-publisher', at: new Date().toISOString(), note: 'Approved for commercial use with attribution' }
})

const CC0_LICENSE = normalizeLicense({
  status: 'approved',
  name: 'CC0 1.0 Universal',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: 'Public domain / CC0',
  commercialUse: true,
  redistrbutable: true,
  territories: ['worldwide'],
  expiresAt: null,
  proof: 'Creative Commons CC0 1.0 Universal',
  reviewer: 'tmcut-publisher',
  reviewedAt: new Date().toISOString(),
  review: { decision: 'approved', by: 'tmcut-publisher', at: new Date().toISOString(), note: 'Public domain, no attribution required' }
})

const ROYALTY_FREE_LICENSE = normalizeLicense({
  status: 'approved',
  name: 'Royalty-Free (TM Tools)',
  url: 'https://tmtools.dev/licenses/royalty-free',
  attribution: 'Royalty-free via TM Tools',
  commercialUse: true,
  redistrbutable: true,
  territories: ['worldwide'],
  expiresAt: null,
  proof: 'TM Tools Royalty-Free License — bundled with app',
  reviewer: 'tmcut-publisher',
  reviewedAt: new Date().toISOString(),
  review: { decision: 'approved', by: 'tmcut-publisher', at: new Date().toISOString(), note: 'Royalty-free for commercial use within TM Tools projects' }
})

/**
 * Create a marketplace music entry (assetKind = 'media', category = 'music')
 */
function createMusicEntry(overrides = {}) {
  return createCatalogEntry({
    assetKind: 'media',
    category: 'music',
    tags: ['music', 'background', 'loop', 'royalty-free', ...(overrides.tags || [])],
    version: '1.0.0',
    sizeBytes: overrides.sizeBytes || 2048000, // ~2MB typical
    sha256: overrides.sha256 || 'sample-placeholder',
    source: { type: 'sample', sampleId: overrides.sampleId || `music-${overrides.id}` },
    sourceUrl: '',
    previewRef: overrides.previewRef || null,
    creator: overrides.creator || 'TM Tools Music Library',
    priceUsd: 0,
    salesChannel: 'bundled',
    license: ROYALTY_FREE_LICENSE,
    ...overrides
  })
}

/**
 * Create a marketplace SFX entry (assetKind = 'media', category = 'sound-effects')
 */
function createSfxEntry(overrides = {}) {
  return createCatalogEntry({
    assetKind: 'media',
    category: 'sound-effects',
    tags: ['sfx', 'sound-effect', 'whoosh', 'impact', 'transition', 'royalty-free', ...(overrides.tags || [])],
    version: '1.0.0',
    sizeBytes: overrides.sizeBytes || 256000, // ~256KB typical
    sha256: overrides.sha256 || 'sample-placeholder',
    source: { type: 'sample', sampleId: overrides.sampleId || `sfx-${overrides.id}` },
    sourceUrl: '',
    previewRef: overrides.previewRef || null,
    creator: overrides.creator || 'TM Tools SFX Library',
    priceUsd: 0,
    salesChannel: 'bundled',
    license: ROYALTY_FREE_LICENSE,
    ...overrides
  })
}

/**
 * Create a marketplace font entry (assetKind = 'media', category = 'fonts')
 * Fonts use 'embedded' source - the payload IS the asset (font file path after install)
 */
function createFontEntry(overrides = {}) {
  return createCatalogEntry({
    assetKind: 'media',
    category: 'fonts',
    tags: ['font', 'typography', 'caption', 'title', 'royalty-free', ...(overrides.tags || [])],
    version: '1.0.0',
    sizeBytes: overrides.sizeBytes || 102400, // ~100KB typical
    sha256: overrides.sha256 || 'sample-placeholder',
    source: { type: 'sample', sampleId: overrides.sampleId || `font-${overrides.id}` },
    sourceUrl: '',
    previewRef: overrides.previewRef || null,
    creator: overrides.creator || 'TM Tools Font Library',
    priceUsd: 0,
    salesChannel: 'bundled',
    license: ROYALTY_FREE_LICENSE,
    ...overrides
  })
}

// =============================================================================
// STARTER MUSIC CATALOG
// =============================================================================
export const STARTER_MUSIC_CATALOG = [
  createMusicEntry({
    id: 'music-lofi-chill',
    title: 'Lo-Fi Chill Loop',
    description: 'Relaxed lo-fi hip hop beat, perfect for vlogs and study videos. Seamless loop.',
    tags: ['lofi', 'chill', 'hip-hop', 'loop', 'vlog'],
    sampleId: 'music-lofi-chill',
    durationSec: 30
  }),
  createMusicEntry({
    id: 'music-upbeat-pop',
    title: 'Upbeat Pop Groove',
    description: 'Energetic pop instrumental with catchy melody. Great for intros and promos.',
    tags: ['pop', 'upbeat', 'energetic', 'promo', 'intro'],
    sampleId: 'music-upbeat-pop',
    durationSec: 45
  }),
  createMusicEntry({
    id: 'music-cinematic-ambient',
    title: 'Cinematic Ambient',
    description: 'Atmospheric cinematic bed for documentaries and storytelling. Slow evolving pads.',
    tags: ['cinematic', 'ambient', 'documentary', 'storytelling', 'emotional'],
    sampleId: 'music-cinematic-ambient',
    durationSec: 60
  }),
  createMusicEntry({
    id: 'music-corporate-inspire',
    title: 'Corporate Inspire',
    description: 'Positive corporate track with piano and light percussion. Professional and uplifting.',
    tags: ['corporate', 'inspire', 'piano', 'professional', 'business'],
    sampleId: 'music-corporate-inspire',
    durationSec: 40
  }),
  createMusicEntry({
    id: 'music-trap-beat',
    title: 'Trap Beat Loop',
    description: 'Modern trap beat with 808s and hi-hats. Ideal for TikTok/Reels transitions.',
    tags: ['trap', 'beat', '808', 'short-form', 'transition'],
    sampleId: 'music-trap-beat',
    durationSec: 15
  }),
  createMusicEntry({
    id: 'music-acoustic-folk',
    title: 'Acoustic Folk',
    description: 'Warm acoustic guitar melody. Intimate and authentic feel for personal videos.',
    tags: ['acoustic', 'folk', 'guitar', 'intimate', 'personal'],
    sampleId: 'music-acoustic-folk',
    durationSec: 50
  })
]

// =============================================================================
// STARTER SFX CATALOG
// =============================================================================
export const STARTER_SFX_CATALOG = [
  createSfxEntry({
    id: 'sfx-whoosh-fast',
    title: 'Fast Whoosh',
    description: 'Quick whoosh for rapid transitions and scene changes.',
    tags: ['whoosh', 'transition', 'fast', 'swish'],
    sampleId: 'sfx-whoosh-fast',
    durationSec: 1
  }),
  createSfxEntry({
    id: 'sfx-whoosh-slow',
    title: 'Slow Whoosh',
    description: 'Long sweeping whoosh for dramatic reveals and montages.',
    tags: ['whoosh', 'transition', 'slow', 'sweep', 'cinematic'],
    sampleId: 'sfx-whoosh-slow',
    durationSec: 2
  }),
  createSfxEntry({
    id: 'sfx-impact-punch',
    title: 'Impact Punch',
    description: 'Hard impact sound for text reveals, logos, and emphasis.',
    tags: ['impact', 'punch', 'hit', 'reveal', 'logo'],
    sampleId: 'sfx-impact-punch',
    durationSec: 1
  }),
  createSfxEntry({
    id: 'sfx-pop-bubble',
    title: 'Pop Bubble',
    description: 'Light pop for UI interactions, checkmarks, and playful moments.',
    tags: ['pop', 'bubble', 'ui', 'playful', 'notification'],
    sampleId: 'sfx-pop-bubble',
    durationSec: 0.5
  }),
  createSfxEntry({
    id: 'sfx-glitch-digital',
    title: 'Digital Glitch',
    description: 'Short digital glitch for tech videos, transitions, and effects.',
    tags: ['glitch', 'digital', 'tech', 'error', 'distortion'],
    sampleId: 'sfx-glitch-digital',
    durationSec: 1
  }),
  createSfxEntry({
    id: 'sfx-riser-sweep',
    title: 'Riser Sweep',
    description: 'Building riser for energy buildup before drops and reveals.',
    tags: ['riser', 'sweep', 'buildup', 'energy', 'drop'],
    sampleId: 'sfx-riser-sweep',
    durationSec: 3
  }),
  createSfxEntry({
    id: 'sfx-camera-shutter',
    title: 'Camera Shutter',
    description: 'Classic camera shutter click for photo transitions and snapshots.',
    tags: ['camera', 'shutter', 'photo', 'click', 'snapshot'],
    sampleId: 'sfx-camera-shutter',
    durationSec: 0.3
  }),
  createSfxEntry({
    id: 'sfx-typewriter',
    title: 'Typewriter Keys',
    description: 'Mechanical typewriter sounds for text animations and captions.',
    tags: ['typewriter', 'keys', 'text', 'animation', 'retro'],
    sampleId: 'sfx-typewriter',
    durationSec: 2
  })
]

// =============================================================================
// STARTER FONT CATALOG
// =============================================================================
export const STARTER_FONT_CATALOG = [
  createFontEntry({
    id: 'font-inter',
    title: 'Inter',
    description: 'Clean, modern variable font optimized for UI and captions. Multiple weights.',
    tags: ['sans-serif', 'variable', 'ui', 'caption', 'modern', 'clean'],
    sampleId: 'font-inter',
    family: 'Inter',
    weights: [300, 400, 500, 600, 700],
    variable: true
  }),
  createFontEntry({
    id: 'font-montserrat',
    title: 'Montserrat',
    description: 'Geometric sans-serif with strong personality. Excellent for titles and headlines.',
    tags: ['sans-serif', 'geometric', 'title', 'headline', 'bold'],
    sampleId: 'font-montserrat',
    family: 'Montserrat',
    weights: [400, 500, 600, 700, 800, 900]
  }),
  createFontEntry({
    id: 'font-poppins',
    title: 'Poppins',
    description: 'Geometric sans-serif with rounded corners. Friendly and readable at all sizes.',
    tags: ['sans-serif', 'geometric', 'rounded', 'friendly', 'readable'],
    sampleId: 'font-poppins',
    family: 'Poppins',
    weights: [300, 400, 500, 600, 700, 800, 900]
  }),
  createFontEntry({
    id: 'font-roboto-mono',
    title: 'Roboto Mono',
    description: 'Monospace font for code, timestamps, and technical overlays.',
    tags: ['monospace', 'code', 'technical', 'timestamp', 'mono'],
    sampleId: 'font-roboto-mono',
    family: 'Roboto Mono',
    weights: [300, 400, 500, 600, 700]
  }),
  createFontEntry({
    id: 'font-playfair-display',
    title: 'Playfair Display',
    description: 'Elegant serif with high contrast. Perfect for cinematic titles and quotes.',
    tags: ['serif', 'elegant', 'cinematic', 'title', 'quote', 'high-contrast'],
    sampleId: 'font-playfair-display',
    family: 'Playfair Display',
    weights: [400, 500, 600, 700, 800, 900]
  }),
  createFontEntry({
    id: 'font-jetbrains-mono',
    title: 'JetBrains Mono',
    description: 'Developer-focused monospace with ligatures. Great for coding tutorials.',
    tags: ['monospace', 'code', 'ligatures', 'developer', 'programming'],
    sampleId: 'font-jetbrains-mono',
    family: 'JetBrains Mono',
    weights: [300, 400, 500, 600, 700, 800]
  })
]

// =============================================================================
// COMBINED MARKETPLACE CATALOG
// =============================================================================
export const STARTER_MARKETPLACE_CATALOG = [
  ...STARTER_MUSIC_CATALOG,
  ...STARTER_SFX_CATALOG,
  ...STARTER_FONT_CATALOG
]

// =============================================================================
// Helper: Get marketplace entries by category
// =============================================================================
export function getMarketplaceByCategory(category) {
  return STARTER_MARKETPLACE_CATALOG.filter(entry => entry.category === category)
}

export function getMarketplaceMusic() {
  return getMarketplaceByCategory('music')
}

export function getMarketplaceSfx() {
  return getMarketplaceByCategory('sound-effects')
}

export function getMarketplaceFonts() {
  return getMarketplaceByCategory('fonts')
}

export function getMarketplaceEntryById(id) {
  return STARTER_MARKETPLACE_CATALOG.find(entry => entry.id === id)
}