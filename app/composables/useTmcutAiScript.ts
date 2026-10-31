import { ref } from 'vue'
import { secToTicks } from '@tmcut-core'
import { useTmcutAi } from './useTmcutAi'
import { useTmcutProject } from './useTmcutProject'
import type { TmcutProject } from './useTmcutProject'
import {
  durationToSeconds,
  CURATED_SCRIPT_PRESETS,
  exportScriptMarkdown,
  type TmcutAiScript,
  type GenerateScriptOptions
} from '../utils/tmcut/aiScript'
import {
  planSystemPrompt,
  planUserMessage,
  parsePlanScript,
  type AiPlanContext
} from '../utils/tmcut/aiTasks'

export * from '../utils/tmcut/aiScript'
export * from '../utils/tmcut/aiTasks'

/**
 * Composable providing AI Scriptwriting & Storyboard generation capabilities.
 */
export function useTmcutAiScript() {
  const { complete, status, tasks } = useTmcutAi()
  const { createProject, addClipToTrack, switchCanvas, currentProject } = useTmcutProject()

  const generating = ref(false)
  const error = ref<string | null>(null)
  const generatedScript = ref<TmcutAiScript | null>(null)
  const hasAiKey = ref(false)

  async function checkGatewayStatus() {
    try {
      const [st, surfaceTasks] = await Promise.all([status(), tasks()])
      // The hub model picker writes per-surface slots (AI_*_PLAN) only — the
      // global gateway key stays empty, so the global `hasKey` boolean alone
      // reports a fully configured surface as "no AI key".
      const planSurface = surfaceTasks?.plan
      hasAiKey.value = Boolean(st?.hasKey || (planSurface && planSurface.configured))
      return hasAiKey.value
    } catch {
      hasAiKey.value = false
      return false
    }
  }

  /**
   * Generates a video storyboard script based on user prompt and parameters.
   */
  async function generateScript(options: GenerateScriptOptions): Promise<TmcutAiScript> {
    generating.value = true
    error.value = null

    const targetSec = durationToSeconds(options.duration)

    try {
      const keyAvailable = await checkGatewayStatus()

      if (!keyAvailable) {
        // Fallback to curated preset matched by platform
        const matched = CURATED_SCRIPT_PRESETS.find(p => p.platform === options.platform) || CURATED_SCRIPT_PRESETS[0]!
        const customized: TmcutAiScript = {
          ...matched,
          title: options.prompt ? `Kịch bản: ${options.prompt.slice(0, 50)}` : matched.title,
          platform: options.platform,
          targetDurationSec: targetSec,
          createdAt: new Date().toISOString()
        }
        generatedScript.value = customized
        return customized
      }

      // Prompt + JSON contract + validation all come from the task
      // registry (utils/tmcut/aiTasks.ts) — components never own prompts.
      const ctx: AiPlanContext = {
        prompt: options.prompt,
        platform: options.platform,
        duration: options.duration,
        targetSec,
        language: options.language
      }

      const aiResponse = await complete({
        task: 'plan',
        messages: [
          { role: 'system', content: planSystemPrompt(ctx) },
          { role: 'user', content: planUserMessage(ctx) }
        ],
        jsonMode: true,
        // Reasoning models (GLM, Nemotron…) spend their first tokens
        // thinking: 8 tokens would land inside the reasoning block and a
        // healthy model would report "no message content". 2048 gives the
        // generated plan room to actually complete.
        maxTokens: 2048,
        temperature: 0.7
      })

      const script = parsePlanScript(aiResponse.content, ctx)

      generatedScript.value = script
      return script
    } catch (err: unknown) {
      // If AI call failed, provide a curated preset gracefully
      const matched = CURATED_SCRIPT_PRESETS.find(p => p.platform === options.platform) || CURATED_SCRIPT_PRESETS[0]!
      const fallbackScript: TmcutAiScript = {
        ...matched,
        title: options.prompt ? `Kịch bản: ${options.prompt.slice(0, 50)}` : matched.title,
        platform: options.platform,
        targetDurationSec: targetSec,
        createdAt: new Date().toISOString()
      }
      generatedScript.value = fallbackScript
      error.value = err instanceof Error ? err.message : String(err)
      return fallbackScript
    } finally {
      generating.value = false
    }
  }

  /**
   * Creates a brand new project populated with text overlay clips from the script.
   */
  function createProjectFromScript(script: TmcutAiScript): TmcutProject {
    const proj = createProject(script.title || 'Dự án Kịch bản AI')

    // Set canvas aspect ratio based on platform
    if (script.platform === 'tiktok-shorts') {
      switchCanvas(1080, 1920) // 9:16 vertical
    } else {
      switchCanvas(1920, 1080) // 16:9 horizontal
    }

    let runningOffset = 0
    for (const scene of script.scenes) {
      const dur = Math.max(1, scene.durationSec)
      addClipToTrack('text', {
        name: scene.title,
        text: scene.onScreenText || scene.title,
        offset: Math.round(secToTicks(runningOffset)),
        in: 0,
        out: Math.round(secToTicks(dur)),
        fontSize: script.platform === 'tiktok-shorts' ? 52 : 44,
        color: '#FFFFFF'
      })
      runningOffset += dur
    }

    return proj
  }

  /**
   * Inserts text overlay clips from the script into the currently active project timeline.
   */
  function insertScriptToCurrentTimeline(script: TmcutAiScript, startOffsetSec = 0): number {
    if (!currentProject.value) return 0

    let runningOffset = startOffsetSec
    let addedCount = 0

    for (const scene of script.scenes) {
      const dur = Math.max(1, scene.durationSec)
      addClipToTrack('text', {
        name: scene.title,
        text: scene.onScreenText || scene.title,
        offset: Math.round(secToTicks(runningOffset)),
        in: 0,
        out: Math.round(secToTicks(dur)),
        fontSize: 48,
        color: '#FFFFFF'
      })
      runningOffset += dur
      addedCount++
    }

    return addedCount
  }

  return {
    generating,
    error,
    generatedScript,
    hasAiKey,
    checkGatewayStatus,
    generateScript,
    createProjectFromScript,
    insertScriptToCurrentTimeline,
    exportScriptMarkdown
  }
}
