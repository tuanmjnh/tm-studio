// =============================================================================
//  Production process profiles.
//
//  `ANIME_SERIES_PROCESS` is the machine-readable twin of
//  docs/production-process/quy-trinh-san-xuat-anime-ai-chong-trung-lap.md:
//  twelve stages, each with the artifacts it reads/writes and the gate that
//  must be signed before the pipeline moves on. Adding a different process is
//  adding another definition here (or a JSON profile later) — never editing
//  the engine.
// =============================================================================

import type { ProcessDefinition } from '~/types/productionProcess'

export const ANIME_SERIES_PROCESS: ProcessDefinition = {
  id: 'anime-series',
  version: '1.0.0',
  titleKey: 'tmcut.process.profile.animeTitle',
  descriptionKey: 'tmcut.process.profile.animeDesc',
  artifactRoot: 'production/episodes/{{runId}}',
  stages: [
    {
      id: 'brief',
      titleKey: 'tmcut.process.stage.brief',
      kind: 'manual',
      requires: [],
      produces: ['episode-brief.md'],
      gate: 'human',
      hintKey: 'tmcut.process.hint.brief'
    },
    {
      id: 'continuity',
      titleKey: 'tmcut.process.stage.continuity',
      kind: 'ai',
      requires: ['episode-brief.md'],
      produces: ['continuity-brief.json'],
      gate: 'human',
      automation: {
        task: 'plan',
        promptId: 'continuity',
        contextArtifacts: ['episode-brief.md'],
        expectsJson: true
      },
      hintKey: 'tmcut.process.hint.continuity'
    },
    {
      id: 'ideas',
      titleKey: 'tmcut.process.stage.ideas',
      kind: 'ai',
      requires: ['continuity-brief.json'],
      produces: ['ideas.md'],
      gate: 'human',
      automation: {
        task: 'plan',
        promptId: 'ideas',
        contextArtifacts: ['episode-brief.md', 'continuity-brief.json']
      }
    },
    {
      id: 'novelty',
      titleKey: 'tmcut.process.stage.novelty',
      kind: 'ai',
      requires: ['ideas.md'],
      produces: ['novelty-report.md'],
      gate: 'human',
      automation: {
        task: 'plan',
        promptId: 'novelty',
        contextArtifacts: ['ideas.md']
      },
      hintKey: 'tmcut.process.hint.novelty'
    },
    {
      id: 'outline',
      titleKey: 'tmcut.process.stage.outline',
      kind: 'ai',
      requires: ['novelty-report.md'],
      produces: ['outline.md'],
      gate: 'human',
      automation: {
        task: 'plan',
        promptId: 'outline',
        contextArtifacts: ['ideas.md', 'novelty-report.md']
      }
    },
    {
      id: 'script',
      titleKey: 'tmcut.process.stage.script',
      kind: 'ai',
      requires: ['outline.md'],
      produces: ['script.md'],
      gate: 'human',
      automation: {
        task: 'plan',
        promptId: 'script',
        contextArtifacts: ['outline.md', 'continuity-brief.json']
      }
    },
    {
      id: 'shots',
      titleKey: 'tmcut.process.stage.shots',
      kind: 'ai',
      requires: ['script.md'],
      produces: ['shot-list.json'],
      gate: 'human',
      automation: {
        task: 'plan',
        promptId: 'shots',
        contextArtifacts: ['script.md'],
        expectsJson: true
      },
      hintKey: 'tmcut.process.hint.shots'
    },
    {
      id: 'assets',
      titleKey: 'tmcut.process.stage.assets',
      kind: 'render',
      requires: ['shot-list.json'],
      produces: ['asset-manifest.json'],
      gate: 'human',
      hintKey: 'tmcut.process.hint.assets'
    },
    {
      id: 'edit',
      titleKey: 'tmcut.process.stage.edit',
      kind: 'manual',
      requires: ['asset-manifest.json'],
      produces: ['edit-notes.md'],
      gate: 'human',
      hintKey: 'tmcut.process.hint.edit'
    },
    {
      id: 'qa',
      titleKey: 'tmcut.process.stage.qa',
      kind: 'compute',
      requires: ['edit-notes.md'],
      produces: ['qa-report.md'],
      gate: 'human',
      hintKey: 'tmcut.process.hint.qa'
    },
    {
      id: 'publish',
      titleKey: 'tmcut.process.stage.publish',
      kind: 'manual',
      requires: ['qa-report.md'],
      produces: ['publish-package.md'],
      gate: 'human',
      hintKey: 'tmcut.process.hint.publish'
    },
    {
      id: 'canon',
      titleKey: 'tmcut.process.stage.canon',
      kind: 'manual',
      requires: ['publish-package.md'],
      produces: ['episode-ledger.json'],
      gate: 'human',
      hintKey: 'tmcut.process.hint.canon'
    }
  ],
  policy: {
    requireCanonApproved: true,
    forbidAutoPublish: true,
    maxRetries: 2,
    blockOnCritical: true
  }
}

/** Every profile the UI can start today (JSON profiles can extend this). */
export const PROCESS_DEFINITIONS: ProcessDefinition[] = [ANIME_SERIES_PROCESS]

export function findProcessDefinition(id: string): ProcessDefinition | null {
  return PROCESS_DEFINITIONS.find(def => def.id === id) || null
}

/** "production/episodes/{{runId}}" → "production/episodes/S01E001". */
export function artifactRootFor(def: ProcessDefinition, runId: string): string {
  return def.artifactRoot.replace(/\{\{runId\}\}/g, runId)
}
