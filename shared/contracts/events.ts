export interface EventBusContracts {
  // Profile lifecycle events
  'profile:started': {
    profileId: string
    pid: number
    startedAt: number
  }
  'profile:stopped': {
    profileId: string
    exitCode: number | null
  }
  'profile:crashed': {
    profileId: string
    error: string
  }

  // Browser Runtime lifecycle events
  'browser:started': {
    browserId: string
    pid: number
  }
  'browser:closed': {
    browserId: string
    pid: number
  }

  // Task Automation lifecycle events
  'task:started': {
    taskId: string
    profileId?: string
    startedAt: number
  }
  'task:progress': {
    taskId: string
    progress: number
    stepName: string
  }
  'task:completed': {
    taskId: string
    result?: unknown
    finishedAt: number
  }
  'task:failed': {
    taskId: string
    error: string
    finishedAt: number
  }
}
