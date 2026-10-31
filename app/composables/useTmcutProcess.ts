/**
 * Production process store — the ONE place the production pipeline talks to
 * the world.
 *
 * Responsibilities:
 *  - storage adapter: desktop main-process IPC (`process:*`) or the Nitro
 *    routes for the browser build, both writing the same file layout;
 *  - engine calls: every state change goes through utils/process/stageMachine
 *    and is persisted immediately, so a closed tab never loses a signed gate;
 *  - one AI automation per stage, using whatever model the user picked in the
 *    shared model picker (AI_*_PLAN slots on desktop, relay routing on web).
 *
 * The SOP's rules that must NOT be softened here:
 *  - an artifact is written BEFORE the stage completes (content is the proof);
 *  - a human gate is the only way to advance past a `human` stage;
 *  - publishing is never automated (`policy.forbidAutoPublish`);
 *  - rewriting an approved artifact reopens its stage instead of silently
 *    keeping a stale approval.
 */
import { computed, ref } from 'vue'
import type {
  ProcessDefinition,
  ProcessOpResult,
  ProcessRun
} from '~/types/productionProcess'
import type { ProcessRunSummary, ProcessWriteResult } from '~/utils/process/types'
import {
  addArtifact,
  cloneRun,
  completeStage as completeStageOp,
  createRun as createRunOp,
  recordGate as recordGateOp,
  runProgress,
  stageDefinition,
  stageState,
  startStage as startStageOp,
  staleApprovals
} from '~/utils/process/stageMachine'
import { ANIME_SERIES_PROCESS } from '~/utils/process/definition'
import { buildStagePrompt, extractJson } from '~/utils/process/prompts'
import { summarizeIssues, validateStage, type ProcessIssue } from '~/utils/process/validators'
import { DEMO_APPROVED_STAGES, DEMO_ARTIFACTS, DEMO_RUN_ID, DEMO_RUN_TITLE } from '~/utils/process/demoEpisode'
import { useTmcutAi } from './useTmcutAi'

const definition = ref<ProcessDefinition>(ANIME_SERIES_PROCESS)
const runs = ref<ProcessRunSummary[]>([])
const currentRun = ref<ProcessRun | null>(null)
const artifactContents = ref<Record<string, string>>({})
const loading = ref(false)
const busyStage = ref('')
const lastError = ref('')
const storage = ref<'desktop' | 'web' | 'none'>('none')
/** Validator findings for the stage the user last acted on (gate feedback). */
const validationIssues = ref<ProcessIssue[]>([])

const nowIso = () => new Date().toISOString()

function desktopApi() {
  return typeof window !== 'undefined' ? window.electronAPI?.process : undefined
}

function detectStorage() {
  if (desktopApi()) {
    storage.value = 'desktop'
    return
  }
  storage.value = typeof window !== 'undefined' ? 'web' : 'none'
}

// ---------------------------------------------------------------------------
// Storage adapter — identical envelopes on both runtimes
// ---------------------------------------------------------------------------

async function listRuns(): Promise<ProcessRunSummary[]> {
  const api = desktopApi()
  if (api) {
    const res = await api.list()
    if (!res?.ok) throw new Error(res?.error || 'process:list failed')
    return res.data || []
  }
  const res = await $fetch<{ ok: boolean, data: ProcessRunSummary[] }>('/api/v1/process/runs')
  return res?.data || []
}

async function readRun(runId: string): Promise<ProcessRun> {
  const api = desktopApi()
  if (api) {
    const res = await api.read(runId)
    if (!res?.ok || !res.data) throw new Error(res?.error || 'process:read failed')
    return res.data as unknown as ProcessRun
  }
  const res = await $fetch<{ ok: boolean, data: ProcessRun }>(`/api/v1/process/runs/${encodeURIComponent(runId)}`)
  return res.data
}

async function saveRun(run: ProcessRun): Promise<void> {
  const api = desktopApi()
  if (api) {
    const res = await api.save({ runId: run.runId, run })
    if (!res?.ok) throw new Error(res?.error || 'process:save failed')
    return
  }
  await $fetch(`/api/v1/process/runs/${encodeURIComponent(run.runId)}`, {
    method: 'PUT',
    body: { run }
  })
}

async function writeArtifactFile(runId: string, name: string, content: string): Promise<ProcessWriteResult> {
  const api = desktopApi()
  if (api) {
    const res = await api.writeArtifact({ runId, name, content })
    if (!res?.ok || !res.data) throw new Error(res?.error || 'process:writeArtifact failed')
    return res.data
  }
  const res = await $fetch<{ ok: boolean, data: ProcessWriteResult }>('/api/v1/process/artifact', {
    method: 'POST',
    body: { runId, name, content }
  })
  return res.data
}

async function readArtifactFile(runId: string, name: string, version?: number): Promise<string> {
  const api = desktopApi()
  if (api) {
    const res = await api.readArtifact({ runId, name, version })
    if (!res?.ok || !res.data) throw new Error(res?.error || 'process:readArtifact failed')
    return res.data.content
  }
  const query = new URLSearchParams({ runId, name })
  if (version) query.set('version', String(version))
  const res = await $fetch<{ ok: boolean, data: { content: string } }>(`/api/v1/process/artifact?${query.toString()}`)
  return res.data.content
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useTmcutProcess() {
  const ai = useTmcutAi()

  const stage = (id: string) => stageDefinition(definition.value, id)
  const progress = computed(() => (currentRun.value ? runProgress(currentRun.value) : 0))
  const stale = computed(() => (currentRun.value ? staleApprovals(currentRun.value) : []))
  const currentStageState = computed(() => {
    if (!currentRun.value) return null
    return stageState(currentRun.value, currentRun.value.currentStage)
  })

  function fail(message: string): false {
    lastError.value = message
    return false
  }

  function adopt(result: ProcessOpResult): ProcessRun | null {
    if (!result.ok) {
      lastError.value = result.error.message
      // A blocked gate still mutated the run (needs_revision + reason): keep
      // the UI in sync with what will be written to disk.
      if (result.run) currentRun.value = result.run
      return null
    }
    currentRun.value = result.run
    lastError.value = ''
    return result.run
  }

  async function persist(run: ProcessRun | null) {
    if (!run) return
    try {
      await saveRun(run)
      runs.value = await listRuns()
    } catch (err) {
      lastError.value = String((err as Error)?.message || err)
    }
  }

  async function refreshRuns() {
    detectStorage()
    loading.value = true
    try {
      runs.value = await listRuns()
      lastError.value = ''
    } catch (err) {
      runs.value = []
      lastError.value = String((err as Error)?.message || err)
    } finally {
      loading.value = false
    }
  }

  async function openRun(runId: string) {
    loading.value = true
    try {
      currentRun.value = await readRun(runId)
      artifactContents.value = {}
      lastError.value = ''
    } catch (err) {
      lastError.value = String((err as Error)?.message || err)
    } finally {
      loading.value = false
    }
  }

  async function createRun(input: { runId: string, title?: string }) {
    const created = createRunOp(definition.value, {
      runId: input.runId.trim().toUpperCase().replace(/\s+/g, '-'),
      title: input.title?.trim() || input.runId,
      now: nowIso()
    })
    if (!created.ok) return fail(created.error.message)
    currentRun.value = created.run
    artifactContents.value = {}
    await persist(created.run)
    return true
  }

  /**
   * Write one artifact version and record it on the run. Order matters: the
   * file (and its hash) must exist before the stage can claim it produced it.
   */
  async function writeArtifact(name: string, content: string, actor: 'user' | 'agent' = 'user') {
    const run = currentRun.value
    if (!run) return fail('No run open')
    try {
      const written = await writeArtifactFile(run.runId, name, content)
      adopt(addArtifact(run, definition.value, {
        name,
        version: written.version,
        hash: written.hash,
        file: written.file,
        actor,
        now: nowIso()
      }))
      artifactContents.value = { ...artifactContents.value, [name]: content }
      await persist(currentRun.value)
      return true
    } catch (err) {
      return fail(String((err as Error)?.message || err))
    }
  }

  async function loadArtifact(name: string, version?: number) {
    const run = currentRun.value
    if (!run) return
    try {
      artifactContents.value = {
        ...artifactContents.value,
        [name]: await readArtifactFile(run.runId, name, version)
      }
    } catch (err) {
      fail(String((err as Error)?.message || err))
    }
  }

  async function startStage(stageId: string) {
    const run = currentRun.value
    if (!run) return fail('No run open')
    const result = startStageOp(run, definition.value, stageId, { now: nowIso() })
    const next = adopt(result)
    if (next) await persist(next)
    return !!next
  }

  /**
   * Complete a stage. The outputs are read BACK from disk (not trusted from
   * the cache) and validated first: a CRITICAL finding blocks the gate, so a
   * stage can only be signed off on artifacts that exist and pass their rules.
   */
  async function completeStage(stageId: string) {
    const run = currentRun.value
    if (!run) return fail('No run open')
    const stage = stageDefinition(definition.value, stageId)
    if (!stage) return fail(`Unknown stage: ${stageId}`)

    const contents: Record<string, string> = {}
    for (const name of stage.produces) {
      contents[name] = artifactContents.value[name]
        ?? await readArtifactFile(run.runId, name).catch(() => '')
    }
    validationIssues.value = validateStage(definition.value, stageId, contents)

    const result = completeStageOp(run, definition.value, stageId, {
      now: nowIso(),
      issues: validationIssues.value
    })
    const next = adopt(result)
    if (!next && lastError.value && validationIssues.value.length > 0) {
      lastError.value = summarizeIssues(validationIssues.value)
      if (result.ok === false && result.run) await persist(result.run)
      return false
    }
    if (next) await persist(next)
    return !!next
  }

  async function decideGate(stageId: string, decision: 'approved' | 'revise' | 'rejected', reason = '', reviewer = 'local user') {
    const run = currentRun.value
    if (!run) return fail('No run open')
    const result = recordGateOp(run, definition.value, stageId, {
      decision,
      reviewer,
      reason,
      now: nowIso()
    })
    const next = adopt(result)
    if (next) await persist(next)
    return !!next
  }

  /**
   * Start (when needed) → ask the chosen model for the stage artifact →
   * store it → complete the stage (which parks it at the human gate).
   */
  async function runAutomation(stageId: string) {
    const run = currentRun.value
    if (!run) return fail('No run open')
    const def = stageDefinition(definition.value, stageId)
    const state = stageState(run, stageId)
    if (!def || !state) return fail(`Unknown stage: ${stageId}`)
    if (!def.automation) return fail('This stage has no AI automation')
    if (run.currentStage !== stageId) return fail(`Stage "${stageId}" is not the current stage`)

    busyStage.value = stageId
    try {
      // A stage already in `running` (a previous AI call failed, the user hit
      // Complete) resumes at the model call instead of being restarted — a
      // restart would bump `attempts` for nothing.
      if (state.status !== 'running') {
        const started = startStageOp(run, definition.value, stageId, { now: nowIso(), actor: 'agent' })
        const next = adopt(started)
        if (!next) return false
        await persist(next)
      }

      const active = currentRun.value!
      const contextArtifacts = def.automation.contextArtifacts || def.requires
      const context: Record<string, string> = {}
      for (const name of contextArtifacts) {
        context[name] = artifactContents.value[name]
          ?? await readArtifactFile(active.runId, name).catch(() => '')
      }

      const prompt = buildStagePrompt(def.automation.promptId, {
        runId: active.runId,
        title: active.title,
        artifacts: context
      })
      const completion = await ai.complete({
        task: 'plan',
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ],
        maxTokens: 4096,
        timeoutMs: 120_000
      })

      let content = String(completion.content || '').trim()
      if (!content) return fail('The model returned an empty answer')
      if (def.automation.expectsJson) {
        const parsed = extractJson(content)
        if (!parsed.ok) return fail(`The model did not return valid JSON: ${parsed.error}`)
        content = parsed.text
      }

      const target = def.produces[0]
      if (!target) return fail('This stage declares no output artifact')
      const written = await writeArtifactFile(active.runId, target, content)
      const recorded = adopt(addArtifact(active, definition.value, {
        name: target,
        version: written.version,
        hash: written.hash,
        file: written.file,
        actor: 'agent',
        now: nowIso()
      }))
      if (!recorded) return false
      artifactContents.value = { ...artifactContents.value, [target]: content }
      await persist(recorded)

      // The same validator the manual path uses: an AI answer that fails a
      // CRITICAL rule parks the stage at needs_revision instead of the gate.
      validationIssues.value = validateStage(definition.value, stageId, { [target]: content })
      const completed = completeStageOp(recorded, definition.value, stageId, {
        now: nowIso(),
        actor: 'agent',
        issues: validationIssues.value
      })
      const done = adopt(completed)
      if (done) {
        await persist(done)
      } else if (completed.ok === false && completed.run) {
        await persist(completed.run)
      }
      return !!done
    } catch (err) {
      return fail(String((err as Error)?.message || err))
    } finally {
      busyStage.value = ''
    }
  }

  /**
   * Seed the demo episode: original sample artifacts, five signed gates, the
   * pipeline parked at `script` so the AI step can be tried with a real model.
   * Idempotent — an existing S01E001 is opened instead of duplicated.
   */
  async function createDemoRun() {
    const existing = runs.value.find(row => row.runId === DEMO_RUN_ID)
    if (existing) {
      await openRun(DEMO_RUN_ID)
      return true
    }
    const created = createRunOp(definition.value, {
      runId: DEMO_RUN_ID,
      title: `${DEMO_RUN_TITLE} (demo)`,
      now: nowIso()
    })
    if (!created.ok) return fail(created.error.message)

    let run = cloneRun(created.run)
    try {
      for (const artifact of DEMO_ARTIFACTS) {
        const written = await writeArtifactFile(run.runId, artifact.name, artifact.content)
        const step = addArtifact(run, definition.value, {
          name: artifact.name,
          version: written.version,
          hash: written.hash,
          file: written.file,
          actor: 'user',
          now: nowIso()
        })
        if (!step.ok) return fail(step.error.message)
        run = step.run
      }

      for (const stageId of DEMO_APPROVED_STAGES) {
        const started = startStageOp(run, definition.value, stageId, { now: nowIso() })
        if (!started.ok) return fail(started.error.message)
        const completed = completeStageOp(started.run, definition.value, stageId, { now: nowIso() })
        if (!completed.ok) return fail(completed.error.message)
        const decided = recordGateOp(completed.run, definition.value, stageId, {
          decision: 'approved',
          reviewer: 'demo-seed',
          now: nowIso()
        })
        if (!decided.ok) return fail(decided.error.message)
        run = decided.run
      }

      currentRun.value = run
      artifactContents.value = Object.fromEntries(DEMO_ARTIFACTS.map(item => [item.name, item.content]))
      await persist(run)
      return true
    } catch (err) {
      return fail(String((err as Error)?.message || err))
    }
  }

  async function openStorageFolder() {
    const api = desktopApi()
    if (!api) return false
    const res = await api.openRoot()
    if (!res?.ok) return fail(res?.error || 'Cannot open the process folder')
    return true
  }

  return {
    // state
    definition,
    runs,
    currentRun,
    artifactContents,
    loading,
    busyStage,
    lastError,
    storage,
    validationIssues,
    // derived
    progress,
    stale,
    currentStageState,
    // helpers
    stage,
    // actions
    refreshRuns,
    openRun,
    createRun,
    createDemoRun,
    startStage,
    completeStage,
    decideGate,
    writeArtifact,
    loadArtifact,
    runAutomation,
    openStorageFolder
  }
}
