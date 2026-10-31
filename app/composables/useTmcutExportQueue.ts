import { ref, computed, watch } from 'vue'
import { useToolTaskManager } from '~/composables/useToolTaskManager'
import type { ToolTask } from '#shared/types/electron'

// Event emitter for MCP job status events
let emitEvent: (event: { type: string; payload: any }) => void = () => {}

export function setMcpEventEmitter(emitter: (event: { type: string; payload: any }) => void) {
  emitEvent = emitter
}

const STORAGE_KEY = 'tmcut:export-queue'
const MAX_QUEUE_ENTRIES = 50

export interface TmcutExportJob {
  id: string
  projectId?: string
  projectName: string
  outputPath: string
  mode: 'video' | 'audio' | 'gif'
  specs: string
  duration: number
  status: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  speed: string
  downloaded: string
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  task: ToolTask
  watchFolder?: boolean
  autoPreview?: boolean
}

// Persist queue to localStorage (survives reload)
function loadQueue(): TmcutExportJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Only restore non-running jobs; running jobs are stale after reload
    return parsed.filter(j => j && typeof j === 'object' && j.status !== 'running')
  } catch {
    return []
  }
}

function saveQueue(jobs: TmcutExportJob[]) {
  try {
    // Auto-prune: keep only last MAX_QUEUE_ENTRIES (by createdAt desc)
    const sorted = [...jobs].sort((a, b) => b.createdAt - a.createdAt)
    const pruned = sorted.slice(0, MAX_QUEUE_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
  } catch {
    // ignore quota/localStorage errors
  }
}

// Module-scoped singleton state shared across the app
const queue = ref<TmcutExportJob[]>(loadQueue())
const activeJobId = ref<string | null>(null)
const isQueuePaused = ref(false)
const queueModalOpen = ref(false)
let isInitialized = false

export function useTmcutExportQueue() {
  const taskManager = useToolTaskManager('ffmpeg')
  const toast = useToast()

  if (!isInitialized) {
    taskManager.setupListeners()
    isInitialized = true
  }

  // Persist queue on any mutation
  watch(queue, (newQueue) => {
    saveQueue(newQueue)
  }, { deep: true })

  const activeJob = computed(() => {
    return queue.value.find(j => j.id === activeJobId.value) || null
  })

  const runningJob = computed(() => {
    return queue.value.find(j => j.status === 'running') || null
  })

  const isProcessing = computed(() => !!runningJob.value)

  const waitingJobs = computed(() => {
    return queue.value.filter(j => j.status === 'waiting')
  })

  const doneJobs = computed(() => {
    return queue.value.filter(j => j.status === 'done')
  })

  const failedJobs = computed(() => {
    return queue.value.filter(j => j.status === 'failed')
  })

  const activeJobsCount = computed(() => {
    return queue.value.filter(j => j.status === 'running' || j.status === 'waiting').length
  })

  // Sync state from taskManager reactive tasks
  watch(() => taskManager.taskList.value, (tasks) => {
    if (!activeJobId.value) return
    const currentActive = queue.value.find(j => j.id === activeJobId.value)
    if (!currentActive || currentActive.status !== 'running') return

    const taskItem = tasks[0]
    if (!taskItem) return

    currentActive.progress = taskItem.progress || 0
    currentActive.speed = taskItem.speed || ''
    currentActive.downloaded = taskItem.downloaded || ''

    // Emit progress event
    emitEvent({ type: 'event:job_progress', payload: { jobId: currentActive.id, progress: currentActive.progress, speed: currentActive.speed, downloaded: currentActive.downloaded, projectId: currentActive.projectId } })

    if (taskItem.status === 'done' || (taskItem.progress >= 100 && currentActive.progress >= 100)) {
      currentActive.status = 'done'
      currentActive.completedAt = Date.now()
      currentActive.progress = 100
      activeJobId.value = null

      // Emit job completed event
      emitEvent({ type: 'event:job_status', payload: { jobId: currentActive.id, status: 'done', progress: 100, projectId: currentActive.projectId } })

      toast.add({
        title: `Export completed: ${currentActive.projectName}`,
        description: currentActive.outputPath,
        color: 'success'
      })

      // Next job in queue
      if (!isQueuePaused.value) {
        processNextJob()
      }
    } else if (taskItem.status === 'failed' || taskItem.status === 'timeout') {
      currentActive.status = 'failed'
      currentActive.error = taskItem.error || 'FFmpeg process failed'
      activeJobId.value = null

      toast.add({
        title: `Export failed: ${currentActive.projectName}`,
        description: currentActive.error,
        color: 'error'
      })

      // Continue to next queued job even if one failed
      if (!isQueuePaused.value) {
        processNextJob()
      }
    }
  }, { deep: true })

  async function processNextJob() {
    if (activeJobId.value) return
    if (isQueuePaused.value) return

    const next = queue.value.find(j => j.status === 'waiting')
    if (!next) {
      // Check if all completed
      if (queue.value.length > 0 && queue.value.every(j => j.status === 'done' || j.status === 'failed' || j.status === 'cancelled')) {
        const completedCount = queue.value.filter(j => j.status === 'done').length
        if (completedCount > 1) {
          toast.add({
            title: 'All export jobs completed',
            description: `${completedCount} files exported successfully`,
            color: 'success'
          })
        }
      }
      return
    }

    activeJobId.value = next.id
    next.status = 'running'
    next.startedAt = Date.now()
    next.progress = 0

    // Emit job started event
    emitEvent({ type: 'event:job_status', payload: { jobId: next.id, status: 'running', progress: 0, projectId: next.projectId } })

    try {
      await taskManager.initManager({
        threads: 1,
        maxRetry: 0,
        timeout: 60 * 60 * 1000
      })
      await taskManager.setTasks([next.task])
      await taskManager.start()
      await taskManager.refreshStatus()
    } catch (err: unknown) {
      next.status = 'failed'
      next.error = err instanceof Error ? err.message : String(err)
      activeJobId.value = null
      emitEvent({ type: 'event:job_status', payload: { jobId: next.id, status: 'failed', progress: next.progress, error: next.error, projectId: next.projectId } })
      processNextJob()
    }
  }

  function enqueueJob(jobInput: {
    projectId?: string
    projectName: string
    outputPath: string
    mode: 'video' | 'audio' | 'gif'
    specs: string
    duration: number
    task: ToolTask
    watchFolder?: boolean
    autoPreview?: boolean
  }, autoStart = true): TmcutExportJob {
    const job: TmcutExportJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      projectId: jobInput.projectId,
      projectName: jobInput.projectName,
      outputPath: jobInput.outputPath,
      mode: jobInput.mode,
      specs: jobInput.specs,
      duration: jobInput.duration,
      status: 'waiting',
      progress: 0,
      speed: '',
      downloaded: '',
      createdAt: Date.now(),
      task: jobInput.task,
      watchFolder: jobInput.watchFolder,
      autoPreview: jobInput.autoPreview
    }

    queue.value.push(job)

    if (autoStart && !activeJobId.value && !isQueuePaused.value) {
      processNextJob()
    }

    return job
  }

  async function cancelJob(jobId: string) {
    const job = queue.value.find(j => j.id === jobId)
    if (!job) return

    if (job.id === activeJobId.value) {
      await taskManager.stopAll()
      job.status = 'cancelled'
      activeJobId.value = null
      emitEvent({ type: 'event:job_status', payload: { jobId: job.id, status: 'cancelled', progress: job.progress, projectId: job.projectId } })
      processNextJob()
    } else if (job.status === 'waiting') {
      job.status = 'cancelled'
      emitEvent({ type: 'event:job_status', payload: { jobId: job.id, status: 'cancelled', progress: job.progress, projectId: job.projectId } })
    }
  }

  async function retryJob(jobId: string) {
    const job = queue.value.find(j => j.id === jobId)
    if (!job) return

    job.status = 'waiting'
    job.progress = 0
    job.error = undefined
    job.speed = ''

    if (!activeJobId.value && !isQueuePaused.value) {
      processNextJob()
    }
  }

  async function removeJob(jobId: string) {
    const job = queue.value.find(j => j.id === jobId)
    if (!job) return

    if (job.id === activeJobId.value) {
      await cancelJob(jobId)
    }

    queue.value = queue.value.filter(j => j.id !== jobId)
  }

  function clearDoneJobs() {
    queue.value = queue.value.filter(j => j.status === 'waiting' || j.status === 'running')
  }

  async function startQueue() {
    isQueuePaused.value = false
    if (!activeJobId.value) {
      await processNextJob()
    }
  }

  async function pauseQueue() {
    isQueuePaused.value = true
    if (activeJobId.value) {
      await taskManager.pause()
    }
  }

  async function resumeQueue() {
    isQueuePaused.value = false
    if (activeJobId.value) {
      await taskManager.resume()
    } else {
      await processNextJob()
    }
  }

  return {
    queue,
    activeJobId,
    activeJob,
    runningJob,
    isProcessing,
    isQueuePaused,
    waitingJobs,
    doneJobs,
    failedJobs,
    activeJobsCount,
    queueModalOpen,
    enqueueJob,
    cancelJob,
    retryJob,
    removeJob,
    clearDoneJobs,
    startQueue,
    pauseQueue,
    resumeQueue
  }
}
