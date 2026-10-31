/**
 * Starter Video Factory templates (Roadmap v1 §5 "topics to support first").
 *
 * These are DOCUMENTS, not UI copy: they ship as published version 1.0.0 so
 * the factory has something valid to run on day one, and the studio edits a
 * fork (never the constant). Every call returns a fresh deep clone — a caller
 * that mutates a preset must not poison the built-in list for the session.
 */
import type { VideoTemplate } from '~/types/videoTemplate'
import { createEmptyTemplate } from '~/types/videoTemplate'
import { cloneTemplate } from './videoTemplates'

const SHIPPED_AT = '2026-10-23T00:00:00.000Z'

function productShowcase(): VideoTemplate {
  return createEmptyTemplate({
    templateId: 'tpl_builtin_product_showcase',
    name: 'Product Showcase',
    description: 'Vertical product ad: hook, in-use demo, proof point and a single call to action.',
    topic: 'product-showcase',
    tags: ['product', 'ecommerce', 'vertical'],
    owner: 'system',
    visibility: 'public',
    version: '1.0.0',
    status: 'published',
    createdAt: SHIPPED_AT,
    updatedAt: SHIPPED_AT,
    publishedAt: SHIPPED_AT,
    changelog: [{ version: '1.0.0', date: SHIPPED_AT, changes: ['Initial shipped template'] }],
    inputSchema: [
      {
        id: 'productName',
        label: 'Product name',
        type: 'text',
        required: true,
        validation: { maxLength: 60 }
      },
      {
        id: 'keyBenefit',
        label: 'Key benefit',
        type: 'textarea',
        required: true,
        placeholder: 'One sentence a viewer would repeat',
        validation: { maxLength: 140 }
      },
      {
        id: 'ctaText',
        label: 'Call to action',
        type: 'text',
        required: true,
        defaultValue: 'Shop now'
      },
      {
        id: 'brandColor',
        label: 'Brand accent colour',
        type: 'color',
        required: false,
        defaultValue: '#111111'
      },
      {
        id: 'productShot',
        label: 'Product reference image',
        type: 'media',
        required: false,
        helpText: 'Optional: gives the generator a real product reference.'
      }
    ],
    scriptBlueprint: {
      hook: {
        purpose: 'Name the product and hint the benefit in the first 3 seconds',
        guidance: 'Open on {{productName}} and say why it matters: {{keyBenefit}}',
        maxWords: 20,
        requiredElements: ['product name']
      },
      intro: {
        purpose: 'Set the context the product solves',
        guidance: 'One line of context for {{productName}}, no claims beyond {{keyBenefit}}',
        maxWords: 25
      },
      beats: [
        {
          id: 'demo',
          title: 'Show it working',
          purpose: 'Prove the benefit visually',
          keyPoints: ['{{keyBenefit}}'],
          estimatedDurationSec: 8,
          visualIntent: 'Product in use, hands or environment in frame'
        },
        {
          id: 'proof',
          title: 'Trust signal',
          purpose: 'Reduce hesitation without inventing statistics',
          keyPoints: ['Only facts supplied by the user'],
          estimatedDurationSec: 6,
          visualIntent: 'Close detail shot of build quality'
        }
      ],
      cta: {
        purpose: 'One clear action',
        guidance: 'Say "{{ctaText}}" once, on screen and in voice',
        maxWords: 10
      },
      wordCountLimit: 90,
      durationTargetSec: 23,
      contentVerificationRules: ['No invented statistics', 'No medical or financial claims']
    },
    sceneBlueprints: [
      {
        id: 'scene-hook',
        order: 0,
        role: 'hook',
        shotType: 'closeup',
        cameraMovement: 'dolly-in',
        visualIntent: 'Slow push-in on {{productName}} on a clean surface',
        durationTargetSec: 4,
        narration: '{{productName}} — {{keyBenefit}}',
        onScreenText: '{{productName}}',
        assetPolicy: { source: 'generate', fallbackToGenerate: true },
        providerCapabilities: ['video-gen', 'image-gen']
      },
      {
        id: 'scene-demo',
        order: 1,
        role: 'demo',
        shotType: 'medium',
        cameraMovement: 'tracking-left',
        visualIntent: '{{productName}} being used in a real setting',
        durationTargetSec: 8,
        narration: 'Here is what changes: {{keyBenefit}}',
        onScreenText: '{{keyBenefit}}',
        assetPolicy: { source: 'generate', fallbackToGenerate: true },
        providerCapabilities: ['video-gen']
      },
      {
        id: 'scene-proof',
        order: 2,
        role: 'social-proof',
        shotType: 'extreme-closeup',
        cameraMovement: 'static',
        visualIntent: 'Material and detail of {{productName}}',
        durationTargetSec: 6,
        narration: 'Built to be used every day.',
        onScreenText: 'Detail that lasts',
        assetPolicy: { source: 'generate', fallbackToGenerate: true },
        providerCapabilities: ['video-gen', 'image-gen']
      },
      {
        id: 'scene-cta',
        order: 3,
        role: 'cta',
        shotType: 'graphic',
        visualIntent: '{{productName}} centered with brand accent {{brandColor}}',
        durationTargetSec: 5,
        narration: '{{ctaText}}',
        onScreenText: '{{ctaText}}',
        assetPolicy: { source: 'generate', fallbackToGenerate: true },
        providerCapabilities: ['image-gen']
      }
    ],
    promptBlocks: [
      {
        id: 'style-bible',
        type: 'style-bible',
        content: 'Clean studio lighting, soft shadows, crisp product focus, brand accent {{brandColor}}.',
        appliesTo: ['scene']
      },
      {
        id: 'shot-template',
        type: 'shot-template',
        content: '{{sceneRole}} shot of {{productName}}: {{visualIntent}}. Framed as a {{shotType}} at {{sceneId}} blocking.',
        appliesTo: ['scene']
      },
      {
        id: 'negative-constraints',
        type: 'negative-constraints',
        content: 'No added text artifacts, no extra logos, no distorted product geometry.',
        appliesTo: ['scene']
      }
    ],
    assetPolicy: {
      preferredSource: 'generate',
      maxGenerationsPerScene: 2,
      allowUserOverride: true
    },
    providerPolicy: {
      minimumCapabilities: ['video-gen'],
      allowedProviders: [],
      fallbackOrder: []
    },
    assemblyProfile: {
      trackMapping: [
        { sceneRole: 'hook', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'demo', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'social-proof', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'cta', trackType: 'video', trackIndex: 0, layerPriority: 0 }
      ],
      captionStyle: {
        fontFamily: 'Inter',
        fontSize: 32,
        color: '#ffffff',
        backgroundColor: '#00000099',
        position: 'bottom',
        maxCharsPerLine: 30,
        animation: 'fade'
      },
      musicPolicy: { source: 'marketplace', genre: ['electronic'], mood: ['confident'], duckUnderVoice: true, volumeLevel: 25 },
      transitionProfile: { defaultType: 'fade', defaultDurationSec: 0.4 },
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
      { id: 'scene-count', name: 'Scene count', type: 'scene-count', config: { min: 3, max: 8 }, severity: 'error', message: 'A product showcase needs 3–8 scenes' },
      { id: 'duration', name: 'Duration', type: 'duration', config: { maxSec: 45 }, severity: 'error', message: 'Product showcases stay under 45 seconds' },
      { id: 'aspect-ratio', name: 'Vertical output', type: 'aspect-ratio', config: { aspectRatio: '9:16' }, severity: 'error', message: 'This template outputs 9:16' },
      { id: 'subtitles', name: 'Captions', type: 'subtitle-presence', config: {}, severity: 'error', message: 'Every scene needs on-screen text' }
    ]
  })
}

function educationalExplainer(): VideoTemplate {
  return createEmptyTemplate({
    templateId: 'tpl_builtin_educational_explainer',
    name: 'Educational Explainer',
    description: 'Landscape explainer: one idea, one example, a recap and a follow prompt.',
    topic: 'educational',
    tags: ['explainer', 'tutorial', 'landscape'],
    owner: 'system',
    visibility: 'public',
    version: '1.0.0',
    status: 'published',
    createdAt: SHIPPED_AT,
    updatedAt: SHIPPED_AT,
    publishedAt: SHIPPED_AT,
    changelog: [{ version: '1.0.0', date: SHIPPED_AT, changes: ['Initial shipped template'] }],
    inputSchema: [
      {
        id: 'topic',
        label: 'Topic',
        type: 'text',
        required: true,
        validation: { maxLength: 80 }
      },
      {
        id: 'audience',
        label: 'Audience',
        type: 'text',
        required: true,
        defaultValue: 'beginners'
      },
      {
        id: 'keyTakeaway',
        label: 'Key takeaway',
        type: 'textarea',
        required: true,
        validation: { maxLength: 160 }
      },
      {
        id: 'ctaText',
        label: 'Call to action',
        type: 'text',
        required: true,
        defaultValue: 'Follow for more'
      }
    ],
    scriptBlueprint: {
      hook: {
        purpose: 'State the question the viewer already has',
        guidance: 'Ask why {{topic}} matters to {{audience}}',
        maxWords: 25
      },
      intro: {
        purpose: 'Promise exactly one thing',
        guidance: 'One takeaway only: {{keyTakeaway}}',
        maxWords: 30
      },
      beats: [
        {
          id: 'problem',
          title: 'The problem',
          purpose: 'Make the gap concrete',
          keyPoints: ['A concrete example for {{audience}}'],
          estimatedDurationSec: 8,
          visualIntent: 'Simple diagram of the gap'
        },
        {
          id: 'explain',
          title: 'The explanation',
          purpose: 'Walk through the idea step by step',
          keyPoints: ['{{keyTakeaway}}'],
          estimatedDurationSec: 12,
          visualIntent: 'Step-by-step motion graphic'
        },
        {
          id: 'recap',
          title: 'Recap',
          purpose: 'One sentence the viewer can repeat',
          keyPoints: ['{{keyTakeaway}}'],
          estimatedDurationSec: 6
        }
      ],
      cta: {
        purpose: 'Invite the next step',
        guidance: 'End with "{{ctaText}}"',
        maxWords: 12
      },
      wordCountLimit: 120,
      durationTargetSec: 33,
      contentVerificationRules: ['Explain only what the script can support', 'No fabricated studies or numbers']
    },
    sceneBlueprints: [
      {
        id: 'scene-intro',
        order: 0,
        role: 'intro',
        shotType: 'wide',
        cameraMovement: 'static',
        visualIntent: 'Host or presenter frame introducing {{topic}}',
        durationTargetSec: 5,
        narration: 'Why does {{topic}} matter for {{audience}}?',
        onScreenText: '{{topic}}',
        assetPolicy: { source: 'mixed', fallbackToGenerate: true },
        providerCapabilities: ['video-gen', 'image-gen']
      },
      {
        id: 'scene-problem',
        order: 1,
        role: 'problem',
        shotType: 'graphic',
        cameraMovement: 'pan-right',
        visualIntent: 'Diagram showing the gap {{audience}} hits',
        durationTargetSec: 8,
        narration: 'Most {{audience}} hit this wall first.',
        onScreenText: 'The wall',
        assetPolicy: { source: 'generate', fallbackToGenerate: true },
        providerCapabilities: ['image-gen']
      },
      {
        id: 'scene-explain',
        order: 2,
        role: 'solution',
        shotType: 'graphic',
        cameraMovement: 'zoom-in',
        visualIntent: 'Three labelled steps resolving {{topic}}',
        durationTargetSec: 12,
        narration: '{{keyTakeaway}}',
        onScreenText: '{{keyTakeaway}}',
        assetPolicy: { source: 'generate', fallbackToGenerate: true },
        providerCapabilities: ['image-gen']
      },
      {
        id: 'scene-recap',
        order: 3,
        role: 'outro',
        shotType: 'medium',
        cameraMovement: 'static',
        visualIntent: 'Presenter recap with the takeaway on screen',
        durationTargetSec: 8,
        narration: 'If you remember one thing: {{keyTakeaway}}',
        onScreenText: '{{ctaText}}',
        assetPolicy: { source: 'mixed', fallbackToGenerate: true },
        providerCapabilities: ['video-gen', 'image-gen']
      }
    ],
    promptBlocks: [
      {
        id: 'style-bible',
        type: 'style-bible',
        content: 'Clear educational look, high legibility, generous negative space, muted palette.',
        appliesTo: ['scene']
      },
      {
        id: 'shot-template',
        type: 'shot-template',
        content: '{{shotType}} for an explainer about {{topic}}: {{visualIntent}}. Audience: {{audience}}.',
        appliesTo: ['scene']
      },
      {
        id: 'localization',
        type: 'localization',
        content: 'Keep on-screen text short enough for one line at {{shotType}} framing.',
        appliesTo: ['scene', 'asset']
      }
    ],
    assetPolicy: {
      preferredSource: 'generate',
      maxGenerationsPerScene: 2,
      allowUserOverride: true
    },
    providerPolicy: {
      minimumCapabilities: ['image-gen'],
      allowedProviders: [],
      fallbackOrder: []
    },
    assemblyProfile: {
      trackMapping: [
        { sceneRole: 'intro', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'problem', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'solution', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'outro', trackType: 'video', trackIndex: 0, layerPriority: 0 }
      ],
      captionStyle: {
        fontFamily: 'Inter',
        fontSize: 28,
        color: '#ffffff',
        backgroundColor: '#000000aa',
        position: 'bottom',
        maxCharsPerLine: 40,
        animation: 'fade'
      },
      musicPolicy: { source: 'marketplace', genre: ['ambient'], mood: ['calm'], duckUnderVoice: true, volumeLevel: 20 },
      transitionProfile: { defaultType: 'dissolve', defaultDurationSec: 0.5 },
      audioDucking: { enabled: true, duckLevel: 35, attackMs: 120, releaseMs: 320 },
      outputProfile: {
        aspectRatio: '16:9',
        resolution: { width: 1920, height: 1080 },
        frameRate: 30,
        codec: 'h264',
        bitrateMbps: 10,
        audioCodec: 'aac',
        audioBitrateKbps: 160
      }
    },
    qualityGates: [
      { id: 'scene-count', name: 'Scene count', type: 'scene-count', config: { min: 3, max: 10 }, severity: 'error', message: 'An explainer needs 3–10 scenes' },
      { id: 'duration', name: 'Duration', type: 'duration', config: { maxSec: 120 }, severity: 'error', message: 'Explainers stay under two minutes' },
      { id: 'aspect-ratio', name: 'Landscape output', type: 'aspect-ratio', config: { aspectRatio: '16:9' }, severity: 'error', message: 'This template outputs 16:9' },
      { id: 'subtitles', name: 'Captions', type: 'subtitle-presence', config: {}, severity: 'error', message: 'Every scene needs on-screen text' }
    ]
  })
}

function podcastHighlight(): VideoTemplate {
  return createEmptyTemplate({
    templateId: 'tpl_builtin_podcast_highlight',
    name: 'Podcast Highlight',
    description: 'Vertical short for podcast or interview highlights: punchy quote hook, guest attribution, soundbed and bold captions.',
    topic: 'podcast-highlight',
    tags: ['podcast', 'interview', 'highlight', 'vertical', 'quote'],
    owner: 'system',
    visibility: 'public',
    version: '1.0.0',
    status: 'published',
    createdAt: SHIPPED_AT,
    updatedAt: SHIPPED_AT,
    publishedAt: SHIPPED_AT,
    changelog: [{ version: '1.0.0', date: SHIPPED_AT, changes: ['Initial shipped template'] }],
    inputSchema: [
      {
        id: 'guestName',
        label: 'Speaker / Guest name',
        type: 'text',
        required: true,
        defaultValue: 'Guest Speaker',
        validation: { maxLength: 50 }
      },
      {
        id: 'episodeTitle',
        label: 'Episode title',
        type: 'text',
        required: true,
        defaultValue: 'Conversations Ep. 12',
        validation: { maxLength: 80 }
      },
      {
        id: 'punchlineQuote',
        label: 'Punchline / Core quote',
        type: 'textarea',
        required: true,
        placeholder: 'The standout insight or statement from the episode',
        validation: { maxLength: 160 }
      },
      {
        id: 'fullEpisodeCta',
        label: 'Call to action',
        type: 'text',
        required: true,
        defaultValue: 'Watch full episode'
      }
    ],
    scriptBlueprint: {
      hook: {
        purpose: 'Start directly with the provocative quote',
        guidance: 'Open on {{punchlineQuote}} with maximum intensity',
        maxWords: 25,
        requiredElements: ['guest quote']
      },
      intro: {
        purpose: 'Identify who is speaking and why they matter',
        guidance: '{{guestName}} on {{episodeTitle}}',
        maxWords: 20
      },
      beats: [
        {
          id: 'context',
          title: 'The context',
          purpose: 'Explain the backstory of {{punchlineQuote}}',
          keyPoints: ['Core context for {{guestName}}'],
          estimatedDurationSec: 8,
          visualIntent: 'Speaker gestures or reaction cut'
        },
        {
          id: 'expansion',
          title: 'Deeper insight',
          purpose: 'Elaborate on the insight',
          keyPoints: ['Impact on the industry or listener'],
          estimatedDurationSec: 10,
          visualIntent: 'Dynamic conversational cut between host and guest'
        }
      ],
      cta: {
        purpose: 'Direct listener to the full conversation',
        guidance: 'End with "{{fullEpisodeCta}}"',
        maxWords: 15
      },
      wordCountLimit: 100,
      durationTargetSec: 30,
      contentVerificationRules: ['Preserve original quotes without alteration', 'Do not misattribute statements']
    },
    sceneBlueprints: [
      {
        id: 'scene-hook',
        order: 0,
        role: 'hook',
        shotType: 'closeup',
        cameraMovement: 'static',
        visualIntent: 'Speaker closeup delivering {{punchlineQuote}}',
        durationTargetSec: 5,
        narration: '{{punchlineQuote}}',
        onScreenText: '{{punchlineQuote}}',
        assetPolicy: { source: 'mixed', fallbackToGenerate: true },
        providerCapabilities: ['video-gen', 'image-gen']
      },
      {
        id: 'scene-intro',
        order: 1,
        role: 'intro',
        shotType: 'medium',
        cameraMovement: 'pan-left',
        visualIntent: 'Host listening with lower-third: {{guestName}} on {{episodeTitle}}',
        durationTargetSec: 5,
        narration: '{{guestName}} sharing a critical insight on {{episodeTitle}}.',
        onScreenText: '{{guestName}} | {{episodeTitle}}',
        assetPolicy: { source: 'mixed', fallbackToGenerate: true },
        providerCapabilities: ['video-gen', 'image-gen']
      },
      {
        id: 'scene-insight',
        order: 2,
        role: 'demo',
        shotType: 'medium',
        cameraMovement: 'zoom-in',
        visualIntent: 'Dynamic conversational cut between host and guest',
        durationTargetSec: 12,
        narration: 'The full breakdown of how {{guestName}} approached this.',
        onScreenText: '{{punchlineQuote}}',
        assetPolicy: { source: 'mixed', fallbackToGenerate: true },
        providerCapabilities: ['video-gen', 'image-gen']
      },
      {
        id: 'scene-cta',
        order: 3,
        role: 'cta',
        shotType: 'wide',
        cameraMovement: 'static',
        visualIntent: 'Studio wide shot with podcast branding and {{fullEpisodeCta}} on screen',
        durationTargetSec: 8,
        narration: 'Catch the rest of this conversation. {{fullEpisodeCta}}.',
        onScreenText: '{{fullEpisodeCta}}',
        assetPolicy: { source: 'mixed', fallbackToGenerate: true },
        providerCapabilities: ['video-gen', 'image-gen']
      }
    ],
    promptBlocks: [
      {
        id: 'style-bible',
        type: 'style-bible',
        content: 'Warm studio lighting, conversational broadcast interview aesthetic, shallow depth of field, high-contrast typography.',
        appliesTo: ['scene']
      },
      {
        id: 'shot-template',
        type: 'shot-template',
        content: '{{shotType}} interview shot: {{visualIntent}}. Subject: {{guestName}} discussing {{episodeTitle}}.',
        appliesTo: ['scene']
      },
      {
        id: 'localization',
        type: 'localization',
        content: 'Keep caption pacing snappy for short-form video.',
        appliesTo: ['scene', 'asset']
      }
    ],
    assetPolicy: {
      preferredSource: 'generate',
      maxGenerationsPerScene: 2,
      allowUserOverride: true
    },
    providerPolicy: {
      minimumCapabilities: ['video-gen', 'image-gen'],
      allowedProviders: [],
      fallbackOrder: []
    },
    assemblyProfile: {
      trackMapping: [
        { sceneRole: 'hook', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'intro', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'demo', trackType: 'video', trackIndex: 0, layerPriority: 0 },
        { sceneRole: 'cta', trackType: 'video', trackIndex: 0, layerPriority: 0 }
      ],
      captionStyle: {
        fontFamily: 'Inter',
        fontSize: 32,
        color: '#ffdd00',
        backgroundColor: '#000000dd',
        position: 'center',
        maxCharsPerLine: 24,
        animation: 'pop'
      },
      musicPolicy: { source: 'marketplace', genre: ['lofi', 'beats'], mood: ['thoughtful', 'rhythmic'], duckUnderVoice: true, volumeLevel: 18 },
      transitionProfile: { defaultType: 'fade', defaultDurationSec: 0.3 },
      audioDucking: { enabled: true, duckLevel: 25, attackMs: 80, releaseMs: 250 },
      outputProfile: {
        aspectRatio: '9:16',
        resolution: { width: 1080, height: 1920 },
        frameRate: 30,
        codec: 'h264',
        bitrateMbps: 8,
        audioCodec: 'aac',
        audioBitrateKbps: 160
      }
    },
    qualityGates: [
      { id: 'scene-count', name: 'Scene count', type: 'scene-count', config: { min: 3, max: 8 }, severity: 'error', message: 'A podcast highlight needs 3–8 scenes' },
      { id: 'duration', name: 'Duration', type: 'duration', config: { maxSec: 60 }, severity: 'error', message: 'Podcast shorts stay under 60 seconds' },
      { id: 'aspect-ratio', name: 'Vertical output', type: 'aspect-ratio', config: { aspectRatio: '9:16' }, severity: 'error', message: 'This template outputs 9:16' },
      { id: 'subtitles', name: 'Captions', type: 'subtitle-presence', config: {}, severity: 'error', message: 'Every scene needs on-screen captions' }
    ]
  })
}

/** Fresh clones of every shipped template (safe for the caller to mutate). */
export function getBuiltinVideoTemplates(): VideoTemplate[] {
  return [productShowcase(), educationalExplainer(), podcastHighlight()].map(template => cloneTemplate(template))
}

export function getBuiltinVideoTemplate(templateId: string): VideoTemplate | undefined {
  return getBuiltinVideoTemplates().find(template => template.templateId === templateId)
}
