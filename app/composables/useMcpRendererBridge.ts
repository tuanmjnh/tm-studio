// =============================================================================
// TMCut MCP Renderer Bridge — handles forwarded tool calls from MCP server
// =============================================================================

import { onBeforeUnmount, shallowRef } from 'vue'
import { useTmcutAgentTools } from './useTmcutAgentTools'
import { useTmcutAssetCenter } from './useTmcutAssetCenter'
import { useTmcutTemplates } from './useTmcutTemplates'
import { useTmcutExportQueue } from './useTmcutExportQueue'
import { useVideoFactory } from './useVideoFactory'

/**
 * Sets up the MCP renderer-side bridge.
 * Listens for forwarded tool calls from the MCP server (via main process)
 * and dispatches them to the appropriate composables.
 * Returns an unsubscribe function.
 */
export function useMcpRendererBridge() {
  const agent = useTmcutAgentTools()
  const assetCenter = useTmcutAssetCenter()
  const templates = useTmcutTemplates()
  const exportQueue = useTmcutExportQueue()
  const factory = useVideoFactory()

  // Map of tool name to handler function
  const toolHandlers: Record<string, (params: any, projectId: string) => Promise<any>> = {
    // === Context (read) ===
    'project.get_context': async (_params, _projectId) => {
      return await agent.callTool('project.get_context', {})
    },
    'project.get_timeline': async (_params, _projectId) => {
      return await agent.callTool('project.get_timeline', {})
    },
    'project.list_assets': async (params, _projectId) => {
      return await agent.callTool('project.list_assets', params)
    },

    // === Proposal lifecycle ===
    'edit.create_proposal': async (params, _projectId) => {
      return await agent.callTool('edit.create_proposal', params)
    },
    'edit.get_proposal': async (_params, _projectId) => {
      return await agent.callTool('edit.get_proposal', {})
    },
    'edit.validate_proposal': async (_params, _projectId) => {
      return await agent.callTool('edit.validate_proposal', {})
    },
    'edit.discard_proposal': async (_params, _projectId) => {
      return await agent.callTool('edit.discard_proposal', {})
    },
    'edit.apply_proposal': async (_params, _projectId) => {
      return await agent.callTool('edit.apply_proposal', {})
    },

    // === Timeline edits (queue into proposal) ===
    'timeline.add_clip': async (params, _projectId) => {
      return await agent.callTool('timeline.add_clip', params)
    },
    'timeline.move_clip': async (params, _projectId) => {
      return await agent.callTool('timeline.move_clip', params)
    },
    'timeline.trim_clip': async (params, _projectId) => {
      return await agent.callTool('timeline.trim_clip', params)
    },
    'timeline.remove_clip': async (params, _projectId) => {
      return await agent.callTool('timeline.remove_clip', params)
    },
    'timeline.split_clip': async (params, _projectId) => {
      return await agent.callTool('timeline.split_clip', params)
    },
    'timeline.set_volume': async (params, _projectId) => {
      return await agent.callTool('timeline.set_volume', params)
    },
    'timeline.add_caption': async (params, _projectId) => {
      return await agent.callTool('timeline.add_caption', params)
    },
    'timeline.set_transition': async (params, _projectId) => {
      return await agent.callTool('timeline.set_transition', params)
    },
    'timeline.set_effect': async (params, _projectId) => {
      return await agent.callTool('timeline.set_effect', params)
    },

    // === Playback ===
    'playback.seek': async (params, _projectId) => {
      return await agent.callTool('playback.seek', params)
    },
    'playback.play': async (_params, _projectId) => {
      return await agent.callTool('playback.play', {})
    },
    'playback.pause': async (_params, _projectId) => {
      return await agent.callTool('playback.pause', {})
    },

    // === Asset Center (Phase 4) ===
    'asset.list_catalog': async (params, _projectId) => {
      return { ok: true, data: assetCenter.catalogEntries.value.filter(e => {
        if (params.category && e.category !== params.category) return false
        if (params.kind && e.assetKind !== params.kind) return false
        if (params.query && !e.title.toLowerCase().includes(params.query.toLowerCase())) return false
        return true
      }).slice(0, params.limit || 50) }
    },
    'asset.install': async (params, _projectId) => {
      await assetCenter.install(params.entryId)
      return { ok: true }
    },
    'asset.uninstall': async (params, _projectId) => {
      await assetCenter.uninstall(params.entryId)
      return { ok: true }
    },
    'asset.install_status': async (params, _projectId) => {
      const status = await assetCenter.verify(params.entryId)
      return { ok: true, data: status }
    },

    // === Templates (Phase 4) ===
    'template.list': async (params, _projectId) => {
      return { ok: true, data: templates.allTemplates.value.filter(t => {
        if (params.category && params.category !== 'all' && t.category !== params.category) return false
        if (params.aspectRatio && params.aspectRatio !== 'all' && t.aspectRatio !== params.aspectRatio) return false
        if (params.query && !t.name.toLowerCase().includes(params.query.toLowerCase()) && !t.description?.toLowerCase().includes(params.query.toLowerCase())) return false
        return true
      }).slice(0, params.limit || 50) }
    },
    'template.apply': async (params, _projectId) => {
          const template = templates.getTemplateById(templates.allTemplates.value, params.templateId)
          if (!template) return { ok: false, error: { code: 'NOT_FOUND', message: 'Template not found', retryable: false } }
          await templates.createProjectFromTemplate(template, { replacements: params.replacements, projectName: params.projectName })
          return { ok: true }
        },
    'template.save_as': async (params, _projectId) => {
      const result = await templates.saveCurrentProjectAsTemplate(params)
      return { ok: true, data: result }
    },
    'template.delete': async (params, _projectId) => {
      await templates.deleteUserTemplate(params.templateId)
      return { ok: true }
    },
    'template.import': async (params, _projectId) => {
      const result = await templates.importTemplates()
      return { ok: true, data: result }
    },
    'template.export': async (params, _projectId) => {
      const template = templates.allTemplates.value.find(t => t.id === params.templateId)
      if (!template) return { ok: false, error: { code: 'NOT_FOUND', message: 'Template not found', retryable: false } }
      const result = await templates.exportTemplate(template)
      return { ok: true, data: result }
    },

    // === Export Queue (Phase 4) ===
    'export.list_jobs': async (params, _projectId) => {
      const jobs = exportQueue.queue.value.filter(j => {
        if (params.status && params.status !== 'all' && j.status !== params.status) return false
        return true
      }).slice(0, params.limit || 50)
      return { ok: true, data: jobs }
    },
    'export.add_job': async (params, _projectId) => {
          const { useToolTaskManager } = await import('~/composables/useToolTaskManager')
          const taskManager = useToolTaskManager('ffmpeg')
          const task = taskManager.initManager({
                      threads: 1,
                      delay: 1000,
                      maxRetry: 3,
                      timeout: 3600000
                    })
                    const taskInput: ToolTask = {
                      command: 'ffmpeg',
                      args: ['-y', '-i', 'input.mp4', 'output.mp4'],
                      options: { projectId: params.projectId, outputPath: params.outputPath, mode: params.mode, specs: params.specs, duration: params.duration },
                      timeout: 3600000
                    }
                    const result = await exportQueue.enqueueJob({
                      projectId: params.projectId,
                      projectName: 'MCP Export',
                      outputPath: params.outputPath,
                      mode: params.mode,
                      specs: params.specs,
                      duration: params.duration,
                      task: taskInput
                    })
          return { ok: true, data: result }
        },
    'export.pause_job': async (params, _projectId) => {
      await exportQueue.pauseQueue()
      return { ok: true }
    },
    'export.resume_job': async (params, _projectId) => {
      await exportQueue.resumeQueue()
      return { ok: true }
    },
    'export.cancel_job': async (params, _projectId) => {
      await exportQueue.cancelJob(params.jobId)
      return { ok: true }
    },
    'export.retry_job': async (params, _projectId) => {
      const result = await exportQueue.retryJob(params.jobId)
      return { ok: true, data: result }
    },
    'export.clear_history': async (params, _projectId) => {
          await exportQueue.clearDoneJobs()
          return { ok: true }
        },

        // === Video Factory (Phase 7) ===
        'factory.estimate_batch': async (params, _projectId) => {
          const result = factory.preview(params.templateId, params.templateVersion, params.records)
          return { ok: true, data: result }
        },
        'factory.create_batch': async (params, _projectId) => {
          const result = factory.commit(params.templateId, params.templateVersion, params.records, {
            confirmed: params.confirmed,
            inputSource: params.inputSource,
            budget: params.budget
          })
          return { ok: true, data: result }
        },
        'factory.get_batch': async (params, _projectId) => {
              const batch = factory.batch(params.batchId)
              if (!batch) return { ok: false, error: { code: 'NOT_FOUND', message: 'Batch not found', retryable: false } }
              const items = factory.itemsOf(params.batchId)
              const jobs = factory.jobsOf(params.batchId)
              const progress = factory.batchProgress(params.batchId)
              return { ok: true, data: { batch, items, jobs, progress } }
            },
        'factory.pause_batch': async (params, _projectId) => {
          const result = factory.pause(params.batchId)
          return { ok: true, data: result }
        },
        'factory.resume_batch': async (params, _projectId) => {
          const result = factory.resume(params.batchId)
          if (result.ok && params.batchId) {
            await factory.run(params.batchId)
          }
          return { ok: true, data: result }
        },
        'factory.cancel_batch': async (params, _projectId) => {
          const result = factory.cancel(params.batchId)
          return { ok: true, data: result }
        },
        'factory.get_job': async (params, _projectId) => {
          const job = factory.jobs.value.find(j => j.jobId === params.jobId)
          if (!job) return { ok: false, error: { code: 'NOT_FOUND', message: 'Job not found', retryable: false } }
          return { ok: true, data: job }
        },
        'factory.retry_job': async (params, _projectId) => {
          const result = factory.retryJob(params.jobId)
          if (result.ok && params.jobId) {
            // Find the batch for this job
            const job = factory.jobs.value.find(j => j.jobId === params.jobId)
            if (job) await factory.run(job.batchId)
          }
          return { ok: true, data: result }
        },
        'factory.assemble_batch': async (params, _projectId) => {
          // The actual assemble needs the project writer which is editor-specific
          // We return the assembly plan so the caller can invoke the writer
          const result = factory.assemblyPlan(params.batchId)
          return { ok: true, data: result }
        },
      }

  const unsubscribe = shallowRef<() => void>(() => {})

  function setup() {
    // The web runtime has no preload bridge at all, so a warning there is noise
    // on every page load. Only complain when Electron is present but the MCP
    // channel is missing — that is a real broken install.
    if (!window.electronAPI) return
    if (!window.electronAPI.mcp?.onToolInvoke) {
      console.warn('[MCP] electronAPI.mcp.onToolInvoke not available')
      return
    }

    unsubscribe.value = window.electronAPI.mcp.onToolInvoke(async ({ tool, params, requestId, projectId }) => {
      try {
        const handler = toolHandlers[tool]
        if (!handler) {
          throw new Error(`Unknown tool: ${tool}`)
        }

        const result = await handler(params, projectId)

        if (window.electronAPI?.mcp?.respond) {
          window.electronAPI.mcp.respond(requestId, result)
        }
      } catch (err) {
        const errorResult = {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: (err as Error)?.message || 'Renderer MCP bridge error', retryable: true }
        }
        if (window.electronAPI?.mcp?.respond) {
          window.electronAPI.mcp.respond(requestId, errorResult)
        }
      }
    })
  }

  function teardown() {
    if (unsubscribe.value) {
      unsubscribe.value()
      unsubscribe.value = () => {}
    }
  }

  // Auto-setup on mount
  setup()

  // Auto-teardown on unmount
  onBeforeUnmount(() => {
    teardown()
  })

  return { setup, teardown }
}
