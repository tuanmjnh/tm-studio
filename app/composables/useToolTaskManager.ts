import type { Ref } from 'vue'
import type { TaskStatus, ToolTask, ToolsNamespace, YoutubeDownloadResponse, FfmpegRenderResponse } from '#shared/types/electron'

export type ToolKind = 'youtube' | 'ffmpeg'

export interface ToolTaskItem {
  key: number
  task: ToolTask
  status: string
  retry: number
  progress: number
  speed: string
  downloaded: string
  error?: string
}

interface GlobalState {
  exeCheck: Ref<{ status: boolean, data: unknown } | null>
  status: Ref<TaskStatus | null>
  tasks: Ref<Record<number, ToolTaskItem>>
  allDone: Ref<number>
  logs: Ref<string[]>
  listenersSetup: boolean
}

const globalStates: Record<ToolKind, GlobalState> = {
  youtube: {
    exeCheck: ref(null),
    status: ref(null),
    tasks: ref({}),
    allDone: ref(0),
    logs: ref([]),
    listenersSetup: false
  },
  ffmpeg: {
    exeCheck: ref(null),
    status: ref(null),
    tasks: ref({}),
    allDone: ref(0),
    logs: ref([]),
    listenersSetup: false
  }
}

function getNamespace(kind: ToolKind): ToolsNamespace | undefined {
  return window.electronAPI?.tools[kind]
}

function parsePercent(value: number | undefined): number {
  return typeof value === 'number' && !Number.isNaN(value) ? Math.min(100, Math.max(0, value)) : 0
}

function updateTask(state: GlobalState, key: number, patch: Partial<ToolTaskItem>) {
  if (!state.tasks.value[key]) return
  state.tasks.value[key] = { ...state.tasks.value[key], ...patch }
}

function pushLog(state: GlobalState, msg: string) {
  state.logs.value.push(msg)
  if (state.logs.value.length > 200) {
    state.logs.value.splice(0, state.logs.value.length - 200)
  }
}

function setupGlobalListeners(kind: ToolKind, api: ToolsNamespace, state: GlobalState) {
  if (state.listenersSetup) return

  api.onBeforeRunTask((data: YoutubeDownloadResponse | FfmpegRenderResponse) => {
    if (typeof data.taskKey === 'number') {
      updateTask(state, data.taskKey, {
        status: 'running',
        progress: 0,
        speed: data.speed || '0',
        downloaded: data.downloaded || ''
      })
    }
  })

  api.onProgressTask((data: YoutubeDownloadResponse | FfmpegRenderResponse) => {
    if (typeof data.taskKey === 'number') {
      const item = state.tasks.value[data.taskKey]
      if (!item) return
      const done = data.done === true && (data.code === 0 || data.code === undefined)
      const meta = {
        ...item.task.meta,
        fileName: data.fileName ?? item.task.meta?.fileName,
        output: data.output ?? item.task.meta?.output,
        outPath: data.outPath ?? item.task.meta?.outPath
      }
      if (done && (kind === 'youtube')) {
        // console.log(`[useToolTaskManager:done] taskKey=${data.taskKey} fileName=${JSON.stringify(meta.fileName)} output=${JSON.stringify(meta.output)} outPath=${JSON.stringify(meta.outPath)}`)
      }
      updateTask(state, data.taskKey, {
        task: { ...item.task, meta },
        status: done ? 'done' : 'running',
        progress: done ? 100 : parsePercent(data.percent),
        speed: data.speed || '0',
        downloaded: data.downloaded || ''
      })
    }
  })

  api.onErrorTask((data: YoutubeDownloadResponse | FfmpegRenderResponse) => {
    if (typeof data.taskKey === 'number') {
      updateTask(state, data.taskKey, { status: 'failed', error: data.message })
      pushLog(state, `Task ${data.taskKey} failed: ${data.message}`)
    }
  })

  api.onTaskRetry((data: { taskKey: number, retryCount: number }) => {
    updateTask(state, data.taskKey, { status: 'retrying', retry: data.retryCount })
    pushLog(state, `Task ${data.taskKey} retrying (${data.retryCount})`)
  })

  api.onTaskTimeout((data: { taskKey: number }) => {
    updateTask(state, data.taskKey, { status: 'timeout' })
    pushLog(state, `Task ${data.taskKey} timed out`)
  })

  api.onAllTasksDone((data: { total: number }) => {
    state.allDone.value = data.total
    api.getStatus().then((s: TaskStatus) => {
      state.status.value = s
    })
  })

  const handleStop = (data: boolean) => {
    if (data) {
      api.getStatus().then((s: TaskStatus) => {
        state.status.value = s
      })
    }
  }
  api.onStoppedTask(handleStop)
  api.onStoppedTasks(handleStop)

  state.listenersSetup = true
}

export function useToolTaskManager(kind: ToolKind) {
  const api = getNamespace(kind)
  const isElectron = computed(() => !!window.electronAPI)

  const state = globalStates[kind]
  const exeCheck = state.exeCheck
  const status = state.status
  const tasks = state.tasks
  const allDone = state.allDone
  const logs = state.logs

  const processing = computed(() => status.value?.isProcessing ?? false)
  const paused = computed(() => status.value?.isPaused ?? false)
  const total = computed(() => status.value?.total ?? 0)
  const done = computed(() => status.value?.done ?? 0)
  const running = computed(() => status.value?.running ?? 0)
  const globalRetryCount = computed(() => status.value?.globalRetryCount ?? 0)
  const taskList = computed(() => Object.values(tasks.value).sort((a, b) => a.key - b.key))

  async function checkExecutable() {
    if (!api) return null
    exeCheck.value = await api.checkExecutable()
    return exeCheck.value
  }

  async function refreshStatus() {
    if (!api) return
    status.value = await api.getStatus()
    if (api.getTasks) {
      try {
        const list = await api.getTasks() as ToolTaskItem[] | undefined
        if (list && list.length > 0) {
          const hasActive = list.some(t => t.status === 'running' || t.status === 'waiting' || t.status === 'retrying')
          if (hasActive) {
            state.tasks.value = {}
            list.forEach((item) => {
              state.tasks.value[item.key] = item
            })
          }
        }
      } catch (e) {
        console.error(e)
      }
    }
  }

  async function initManager(args: { threads?: number, delay?: number, delayUI?: number, maxRetry?: number, timeout?: number } = {}) {
    if (!api) return
    const plainArgs = JSON.parse(JSON.stringify(args))
    await api.initTaskManager(plainArgs)
  }

  async function setTasks(items: ToolTask[]) {
    if (!api) return
    state.tasks.value = {}
    state.allDone.value = 0
    const plainItems = JSON.parse(JSON.stringify(items)) as ToolTask[]
    for (let i = 0; i < plainItems.length; i++) {
      const item = plainItems[i]
      if (!item) continue
      state.tasks.value[i] = { key: i, task: item, status: 'waiting', retry: 0, progress: 0, speed: '0', downloaded: '' }
    }
    await api.setTasks(plainItems)
  }

  async function clearTasks() {
    state.tasks.value = {}
    state.allDone.value = 0
    if (api) {
      await api.setTasks([])
    }
  }

  async function start() {
    if (!api) return
    await api.startTasks()
  }

  async function pause() {
    if (!api) return
    status.value = await api.pauseTasks()
  }

  async function resume() {
    if (!api) return
    status.value = await api.continueTasks()
  }

  async function stopTask(key: number) {
    if (!api) return
    status.value = await api.stopTask(key)
  }

  async function stopAll() {
    if (!api) return
    status.value = await api.stopTasks()
  }

  function setupListeners() {
    if (api) {
      setupGlobalListeners(kind, api, state)
    }
    return () => { }
  }

  return {
    api,
    isElectron,
    exeCheck,
    status,
    tasks,
    taskList,
    logs,
    processing,
    paused,
    total,
    done,
    running,
    globalRetryCount,
    allDone,
    checkExecutable,
    refreshStatus,
    initManager,
    setTasks,
    clearTasks,
    start,
    pause,
    resume,
    stopTask,
    stopAll,
    setupListeners
  }
}
