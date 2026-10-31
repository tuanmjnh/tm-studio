// =============================================================================
// Video Template Schema — Roadmap v1 §5
// Single source of truth for template structure. Versioned, validated, serialized.
// =============================================================================

import type { TmcutTrack, TmcutTimelineItem } from '~/composables/useTmcutProject'
import type { CameraMovement, AspectRatio } from '~/types/providerAdapter'

// -----------------------------------------------------------------------------
// Core identifiers & versioning
// -----------------------------------------------------------------------------

export type TemplateStatus = 'draft' | 'published' | 'archived'
export type TemplateVisibility = 'private' | 'team' | 'public'
export type TemplateTopic = 
  | 'product-showcase'
  | 'social-short'
  | 'educational'
  | 'travel-lifestyle'
  | 'storytelling'
  | 'news-recap'
  | 'podcast-highlight'
  | 'ugc-ad'
  | string // extensible

export interface TemplateIdentity {
  templateId: string // stable UUID, never changes across versions
  name: string
  description: string
  topic: TemplateTopic
  tags: string[]
  owner: string // user ID
  visibility: TemplateVisibility
}

export interface TemplateVersionMeta {
  version: string // semver, immutable once published
  status: TemplateStatus
  schemaVersion: number // template schema version (bump on breaking changes)
  changelog: TemplateChangelogEntry[]
  compatibility: {
    minAppVersion: string
    maxAppVersion?: string
  }
  createdAt: string // ISO 8601
  updatedAt: string
  publishedAt?: string
}

export interface TemplateChangelogEntry {
  version: string
  date: string
  changes: string[]
}

// -----------------------------------------------------------------------------
// Input Schema — what user must provide
// -----------------------------------------------------------------------------

export type InputFieldType = 
  | 'text' | 'textarea' | 'number' | 'select' | 'multiselect'
  | 'media' | 'color' | 'date' | 'boolean' | 'json'

export interface TemplateInputField {
  id: string // stable, used in replacements
  label: string
  type: InputFieldType
  required: boolean
  defaultValue?: unknown
  validation?: {
    minLength?: number
    maxLength?: number
    pattern?: string // regex
    min?: number
    max?: number
    options?: Array<{ value: string; label: string }> // for select
  }
  placeholder?: string
  helpText?: string
  dependsOn?: string // conditional visibility: fieldId
  dependsOnValue?: unknown
}

// -----------------------------------------------------------------------------
// Script Blueprint — narrative structure
// -----------------------------------------------------------------------------

export interface ScriptBlueprint {
  hook: ScriptSegment
  intro: ScriptSegment
  beats: ScriptBeat[]
  cta: ScriptSegment
  outro?: ScriptSegment
  wordCountLimit?: number
  durationTargetSec?: number
  contentVerificationRules?: string[] // e.g., "no fabricated stats", "cite sources"
}

export interface ScriptSegment {
  purpose: string
  guidance: string
  maxWords?: number
  requiredElements?: string[] // e.g., ["brand name", "key benefit"]
}

export interface ScriptBeat {
  id: string
  title: string
  purpose: string
  keyPoints: string[]
  estimatedDurationSec: number
  visualIntent?: string
}

// -----------------------------------------------------------------------------
// Scene Blueprints — shot-level planning
// -----------------------------------------------------------------------------

export interface SceneBlueprint {
  id: string
  order: number
  role: SceneRole
  shotType: ShotType
  cameraMovement?: CameraMovement
  visualIntent: string
  durationTargetSec: number
  narration?: string
  onScreenText?: string
  assetPolicy: SceneAssetPolicy
  providerCapabilities: string[] // e.g., ['video-gen', 'image-gen', 'tts']
}

export type SceneRole = 
  | 'hook' | 'intro' | 'problem' | 'solution' | 'demo' | 'benefit' | 'social-proof' | 'cta' | 'outro'

export type ShotType = 
  | 'wide' | 'medium' | 'closeup' | 'extreme-closeup' | 'pov' | 'drone' | 'screen-record' | 'animation' | 'graphic'

export interface SceneAssetPolicy {
  source: 'marketplace' | 'user-upload' | 'generate' | 'mixed'
  licenseRestrictions?: string[] // e.g., 'commercial-use', 'attribution-required'
  fallbackToGenerate: boolean
}

// -----------------------------------------------------------------------------
// Prompt Blocks — provider-agnostic prompt templates
// -----------------------------------------------------------------------------

export interface PromptBlock {
  id: string
  type: 'system' | 'style-bible' | 'shot-template' | 'negative-constraints' | 'localization'
  content: string // template with {{variable}} placeholders
  providerMapping?: Record<string, string> // provider-specific overrides
  appliesTo: ('script' | 'scene' | 'asset' | 'voice')[]
  requiredCapabilities?: string[]
}

// -----------------------------------------------------------------------------
// Asset & Provider Policies
// -----------------------------------------------------------------------------

export interface AssetPolicy {
  preferredSource: 'marketplace' | 'user-upload' | 'generate'
  licenseFilter?: string[] // filter marketplace by license
  maxGenerationsPerScene?: number
  allowUserOverride: boolean
}

export interface ProviderPolicy {
  minimumCapabilities: string[] // e.g., ['video-gen:1080p', 'tts:multilingual']
  allowedProviders: string[] // provider IDs from registry
  fallbackOrder: string[] // provider IDs in priority order
  providerSpecificPrompts?: Record<string, PromptBlock[]> // per-provider prompt overrides
  costCapPerSceneUsd?: number
  rateLimitPerMinute?: number
}

// -----------------------------------------------------------------------------
// Assembly Profile — how outputs map to timeline
// -----------------------------------------------------------------------------

export interface AssemblyProfile {
  trackMapping: TrackMappingRule[]
  captionStyle: CaptionStyle
  musicPolicy: MusicPolicy
  transitionProfile: TransitionProfile
  audioDucking: AudioDuckingConfig
  outputProfile: OutputProfile
}

export interface TrackMappingRule {
  sceneRole: SceneRole
  trackType: 'video' | 'text' | 'audio'
  trackIndex: number // 0 = bottom
  layerPriority: number // higher = on top
}

export interface CaptionStyle {
  fontFamily: string
  fontSize: number
  color: string
  backgroundColor?: string
  position: 'bottom' | 'top' | 'center'
  maxCharsPerLine: number
  animation?: 'fade' | 'typewriter' | 'pop' | 'none'
}

export interface MusicPolicy {
  source: 'marketplace' | 'generate' | 'user-upload' | 'none'
  genre?: string[]
  mood?: string[]
  duckUnderVoice: boolean
  volumeLevel: number // 0-100
}

export interface TransitionProfile {
  defaultType: string // transition key from catalog
  defaultDurationSec: number
  perSceneOverrides?: Record<string, { type: string; durationSec: number }>
}

export interface AudioDuckingConfig {
  enabled: boolean
  duckLevel: number // 0-100 (percentage of original)
  attackMs: number
  releaseMs: number
}

export interface OutputProfile {
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5'
  resolution: { width: number; height: number }
  frameRate: number
  codec: 'h264' | 'hevc' | 'vp9'
  bitrateMbps: number
  audioCodec: 'aac' | 'opus'
  audioBitrateKbps: number
}

// -----------------------------------------------------------------------------
// Quality Gates — validation rules
// -----------------------------------------------------------------------------

export interface QualityGate {
  id: string
  name: string
  type: 'scene-count' | 'duration' | 'aspect-ratio' | 'subtitle-presence' | 'moderation' | 'custom'
  config: Record<string, unknown>
  severity: 'error' | 'warning' | 'info'
  message: string
}

// -----------------------------------------------------------------------------
// Complete Template Document
// -----------------------------------------------------------------------------

export interface VideoTemplate extends TemplateIdentity, TemplateVersionMeta {
  inputSchema: TemplateInputField[]
  scriptBlueprint: ScriptBlueprint
  sceneBlueprints: SceneBlueprint[]
  promptBlocks: PromptBlock[]
  assetPolicy: AssetPolicy
  providerPolicy: ProviderPolicy
  assemblyProfile: AssemblyProfile
  qualityGates: QualityGate[]

  // Preview / test
  thumbnailUrl?: string
  previewVideoUrl?: string
  testRun?: TemplateTestRun
}

export interface TemplateTestRun {
  draftVersion: string
  sampleInputs: Record<string, unknown>
  outputSummary: {
    sceneCount: number
    totalDurationSec: number
    estimatedCostUsd: number
    providerBreakdown: Record<string, number>
  }
  failures: TemplateTestFailure[]
  reviewStatus: 'pending' | 'approved' | 'rejected'
  reviewedAt?: string
  reviewedBy?: string
}

export interface TemplateTestFailure {
  sceneId: string
  stage: 'script' | 'storyboard' | 'generation' | 'assembly' | 'validation'
  error: string
  provider?: string
  recoverable: boolean
}

// -----------------------------------------------------------------------------
// Template Instantiation — runtime shape
// -----------------------------------------------------------------------------

export interface InstantiatedTemplate {
  canvas: { width: number; height: number; fps: { numerator: number; denominator: number } }
  timeline: {
    version: number
    tracks: TmcutTrack[]
    durationMs: number
    markers: Array<{ id: string; at: number; label?: string; color?: string }>
  }
  durationMs: number
  replacements: Record<string, { src?: string; text?: string; name?: string }>
  assetReadiness: AssetReadinessReport
}

export interface AssetReadinessReport {
  missingAssets: Array<{ assetId: string; reason: string }>
  localNeeds: Array<{ assetId: string; sourceHint: string }>
  installedAssets: string[]
  totalAssets: number
  readyAssets: number
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

export interface TemplateValidationResult {
  valid: boolean
  errors: TemplateValidationError[]
  warnings: TemplateValidationWarning[]
}

export interface TemplateValidationError {
  path: string // JSON pointer e.g., "/sceneBlueprints/0/durationTargetSec"
  code: string
  message: string
}

export interface TemplateValidationWarning {
  path: string
  code: string
  message: string
}

// -----------------------------------------------------------------------------
// Factory functions
// -----------------------------------------------------------------------------

export function createEmptyTemplate(overrides: Partial<VideoTemplate> = {}): VideoTemplate {
  const now = new Date().toISOString()
  return {
    templateId: crypto.randomUUID(),
    name: 'Untitled Template',
    description: '',
    topic: 'social-short',
    tags: [],
    owner: '',
    visibility: 'private',
    version: '0.1.0',
    status: 'draft',
    schemaVersion: 1,
    changelog: [],
    compatibility: { minAppVersion: '4.0.0' },
    createdAt: now,
    updatedAt: now,
    inputSchema: [],
    scriptBlueprint: {
      hook: { purpose: 'Grab attention in first 3 seconds', guidance: 'Visual + audio hook', maxWords: 30 },
      intro: { purpose: 'Introduce topic and value proposition', guidance: 'Clear, concise', maxWords: 50 },
      beats: [],
      cta: { purpose: 'Drive action', guidance: 'Single clear action', maxWords: 20 },
      wordCountLimit: 150,
      durationTargetSec: 30
    },
    sceneBlueprints: [],
    promptBlocks: [],
    assetPolicy: { preferredSource: 'marketplace', allowUserOverride: true },
    providerPolicy: { minimumCapabilities: [], allowedProviders: [], fallbackOrder: [] },
    assemblyProfile: {
      trackMapping: [],
      captionStyle: {
        fontFamily: 'Inter',
        fontSize: 28,
        color: '#ffffff',
        position: 'bottom',
        maxCharsPerLine: 32,
        animation: 'fade'
      },
      musicPolicy: { source: 'marketplace', duckUnderVoice: true, volumeLevel: 30 },
      transitionProfile: { defaultType: 'fade', defaultDurationSec: 0.5 },
      audioDucking: { enabled: true, duckLevel: 30, attackMs: 100, releaseMs: 300 },
      outputProfile: {
        aspectRatio: '9:16',
        resolution: { width: 1080, height: 1920 },
        frameRate: 30,
        codec: 'h264',
        bitrateMbps: 8,
        audioCodec: 'aac',
        audioBitrateKbps: 128
      }
    },
    qualityGates: [
      { id: 'min-scenes', name: 'Minimum Scenes', type: 'scene-count', config: { min: 3 }, severity: 'error', message: 'Template must have at least 3 scenes' },
      { id: 'duration', name: 'Duration Check', type: 'duration', config: { maxSec: 180 }, severity: 'warning', message: 'Video exceeds recommended duration for shorts' },
      { id: 'subtitles', name: 'Subtitles Present', type: 'subtitle-presence', config: {}, severity: 'error', message: 'All scenes must have captions' }
    ],
    ...overrides
  }
}