const { spawn } = require('child_process')
const { decodeBuffer } = require('./encoding.cjs')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Force-kill a spawned process and its whole tree.
// On Windows, child.kill() cannot terminate a process tree, so we use
// `taskkill /F /T /PID` which force-kills the process and all children.
function killProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || !child.pid) {
      resolve()
      return
    }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true })
      killer.on('close', () => resolve())
      killer.on('error', () => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
        resolve()
      })
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
      resolve()
    }
  })
}

class TaskProcessManager {
  constructor(threads = 1, sleep = 200, maxRetry = 0, timeout = 10 * 60 * 1000) {
    this.totalThreads = threads
    this.sleep = sleep
    this.maxRetry = maxRetry
    this.defaultTimeout = timeout
    this.tasks = []
    this.taskGroups = []
    this.threads = Array(this.totalThreads).fill(null)
    this.processing = []
    this.processed = []
    this.isProcessing = false
    this.isPaused = false
    this.children = new Map()
    this.retryCount = {}
    this.timeouts = {}
    this.globalRetryLimit = 100
    this.globalRetryCount = 0
    this.taskStatus = {}
    this.stoppedTasks = new Set()
    this.logLevel = 'info'
    this.retryDelay = 1000
  }

  log(level, msg, data) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 }
    if (this.onLog && levels[level] >= levels[this.logLevel]) {
      this.onLog(`[${level.toUpperCase()}] ${msg}`, data)
    }
  }

  resetState() {
    this.processed = []
    this.processing = []
    this.threads = Array(this.totalThreads).fill(null)
    this.children.clear()
    this.retryCount = {}
    Object.values(this.timeouts).forEach(clearTimeout)
    this.timeouts = {}
    this.taskStatus = {}
    this.stoppedTasks.clear()
  }

  setTasks(tasks) {
    this.tasks = tasks
    this.taskGroups = []
    this.resetState()
    tasks.forEach((_, i) => {
      this.taskStatus[i] = 'waiting'
    })
  }

  setGroupedTasks(groups) {
    this.taskGroups = groups
    this.tasks = []
    this.resetState()
  }

  getTasks() {
    return this.tasks
  }

  getGroupTasks() {
    return this.taskGroups
  }

  async start() {
    if (this.isProcessing) {
      throw new Error('Task manager is already running.')
    }
    if (this.beforeStart) await this.beforeStart(this.tasks)
    this.isProcessing = true
    this.isPaused = false
    this.threads = Array(this.totalThreads).fill(null)
    if (this.afterStart) await this.afterStart()
    if (this.taskGroups.length > 0) {
      await this.runGroups()
    } else {
      await this.runSingle()
    }
  }

  async stop() {
    if (this.beforeStop) await this.beforeStop()
    this.isProcessing = false
    this.isPaused = false
    // Mark every running task as manually stopped so its close handler does not retry.
    for (const idx of this.processing) {
      this.stoppedTasks.add(idx)
    }
    await Promise.all([...this.children.entries()].map(([idx, child]) => {
      this.stoppedTasks.add(idx)
      return killProcessTree(child)
    }))
    this.children.clear()
    Object.values(this.timeouts).forEach(clearTimeout)
    this.timeouts = {}
    this.processing = []
    this.processed = []
    this.threads = Array(this.totalThreads).fill(null)
    if (this.afterStop) await this.afterStop()
  }

  async stopTask(index) {
    const task = this.tasks[index]
    if (this.beforeStopTask) await this.beforeStopTask(index, task)
    const child = this.children.get(index)
    if (child) {
      this.stoppedTasks.add(index)
      this.children.delete(index)
      await killProcessTree(child)
      this.processing = this.processing.filter(idx => idx !== index)
      this.threads = this.threads.map(t => (t === index ? null : t))
      if (!this.processed.includes(index)) this.processed.push(index)
    } else {
      // Task was waiting (not started): cancel it so it is never picked up.
      this.stoppedTasks.add(index)
      if (!this.processed.includes(index)) this.processed.push(index)
    }
    if (this.afterStopTask) await this.afterStopTask(index, task)
    if (this.onStopTask) await this.onStopTask(index, task)
    this.taskStatus[index] = 'stopped'
    this.log('info', 'Stop task', { idx: index })
  }

  async pause() {
    if (this.beforePause) await this.beforePause()
    this.isPaused = true
    if (this.afterPause) await this.afterPause()
  }

  async continue() {
    if (!this.isPaused || this.isProcessing) return
    this.isPaused = false
    this.isProcessing = true
    await this.runSingle()
  }

  cancelTask(index) {
    if (this.processing.includes(index)) return
    this.tasks[index] = null
    this.taskStatus[index] = 'cancelled'
    this.log('info', 'Cancel task', { idx: index })
  }

  async runSingle() {
    while (this.isProcessing && this.processed.length < this.tasks.length) {
      if (this.isPaused) {
        await delay(this.sleep)
        continue
      }
      if (this.onTasksRunning) await this.onTasksRunning(this.processing, this.processed, this.threads)
      for (let t = 0; t < this.totalThreads; t++) {
        if (this.threads[t] !== null) continue
        const nextIdx = this.tasks.findIndex((task, i) =>
          task && !this.processing.includes(i) && !this.processed.includes(i) && this.taskStatus[i] !== 'cancelled'
        )
        if (nextIdx === -1) continue
        this.threads[t] = nextIdx
        this.processing.push(nextIdx)
        this.taskStatus[nextIdx] = 'running'
        const task = this.tasks[nextIdx]
        if (this.beforeRunTask) await this.beforeRunTask(t, nextIdx, task)
        this.log('info', 'Start task', { idx: nextIdx })

        const child = spawn(task.command, task.args || [], { ...(task.options || {}), maxBuffer: 10 * 1024 * 1024 })
        this.children.set(nextIdx, child)

        const timeoutMs = task.timeout || this.defaultTimeout
        this.timeouts[nextIdx] = setTimeout(async () => {
          this.taskStatus[nextIdx] = 'timeout'
          if (this.onTaskTimeout) this.onTaskTimeout(nextIdx, task)
          if (this.children.has(nextIdx)) {
            const timedOutChild = this.children.get(nextIdx)
            this.children.delete(nextIdx)
            await killProcessTree(timedOutChild)
            this.processing = this.processing.filter(idx => idx !== nextIdx)
            this.threads[t] = null
            if (!this.processed.includes(nextIdx)) this.processed.push(nextIdx)
            this.log('warn', 'Task timeout', { idx: nextIdx, timeoutMs })
          }
        }, timeoutMs)

        let stdoutBuf = Buffer.alloc(0)
        child.stdout.on('data', (data) => {
          stdoutBuf = Buffer.concat([stdoutBuf, data])
          if (this.onTaskStdout) this.onTaskStdout(t, nextIdx, task, data)
        })
        let stderrBuf = Buffer.alloc(0)
        child.stderr.on('data', (data) => {
          stderrBuf = Buffer.concat([stderrBuf, data])
          if (this.onTaskStderr) this.onTaskStderr(t, nextIdx, task, data)
        })
        child.on('close', async (code, signal) => {
          clearTimeout(this.timeouts[nextIdx])
          delete this.timeouts[nextIdx]
          this.children.delete(nextIdx)
          this.processing = this.processing.filter(idx => idx !== nextIdx)
          if (!this.processed.includes(nextIdx)) this.processed.push(nextIdx)
          this.threads[t] = null
          const wasStopped = this.stoppedTasks.has(nextIdx)
          this.stoppedTasks.delete(nextIdx)
          if (wasStopped) {
            this.taskStatus[nextIdx] = 'stopped'
            this.log('info', 'Task stopped', { idx: nextIdx })
            return
          }
          if (this.afterRunTask) await this.afterRunTask(child.pid, t, nextIdx, task, code, signal, decodeBuffer(stdoutBuf), decodeBuffer(stderrBuf))
          if (this.onTaskError && code !== 0) await this.onTaskError(t, nextIdx, task, code, signal, decodeBuffer(stderrBuf))
          if (code === 0) {
            this.taskStatus[nextIdx] = 'done'
            this.log('info', 'Task done', { idx: nextIdx })
            if (this.onTaskDone) await this.onTaskDone(nextIdx, task)
          } else {
            this.taskStatus[nextIdx] = 'failed'
            this.retryCount[nextIdx] = (this.retryCount[nextIdx] || 0) + 1
            this.globalRetryCount++
            if (this.retryCount[nextIdx] <= this.maxRetry && this.globalRetryCount <= this.globalRetryLimit) {
              this.log('warn', 'Retry task', { idx: nextIdx, retry: this.retryCount[nextIdx] })
              if (this.onTaskRetry) await this.onTaskRetry(nextIdx, this.retryCount[nextIdx])
              this.processed = this.processed.filter(idx => idx !== nextIdx)
              setTimeout(() => {
                if (this.isProcessing) this.runSingle()
              }, this.retryDelay)
            } else if (this.globalRetryCount > this.globalRetryLimit) {
              this.isProcessing = false
              this.log('error', 'Global retry limit reached, stopping all tasks', { globalRetryCount: this.globalRetryCount })
            } else {
              this.log('error', 'Task failed after max retry', { idx: nextIdx })
            }
          }
        })
      }
      await delay(this.sleep)
    }
    this.isProcessing = false
    if (this.onAllTasksDone) await this.onAllTasksDone(this.tasks.length)
  }

  runSingleTask(gIdx, tIdx, task) {
    return new Promise((resolve) => {
      const child = spawn(task.command, task.args || [], { ...(task.options || {}), maxBuffer: 10 * 1024 * 1024 })
      this.log('info', `Run group ${gIdx} task ${tIdx}`, task)

      let stdoutBuf = Buffer.alloc(0)
      let stderrBuf = Buffer.alloc(0)

      child.stdout.on('data', (data) => {
        stdoutBuf = Buffer.concat([stdoutBuf, data])
        if (this.onTaskStdout) this.onTaskStdout(gIdx, tIdx, task, data)
      })
      child.stderr.on('data', (data) => {
        stderrBuf = Buffer.concat([stderrBuf, data])
        if (this.onTaskStderr) this.onTaskStderr(gIdx, tIdx, task, data)
      })
      child.on('close', async (code, signal) => {
        if (code === 0) {
          this.taskStatus[tIdx] = 'done'
          if (this.onTaskDone) await this.onTaskDone(tIdx, task)
        } else {
          this.taskStatus[tIdx] = 'failed'
          if (this.onTaskError) await this.onTaskError(gIdx, tIdx, task, code, signal, decodeBuffer(stderrBuf))
        }
        resolve()
      })
    })
  }

  async runGroups() {
    await Promise.all(
      this.taskGroups.map(async (group, gIdx) => {
        for (const [tIdx, task] of group.entries()) {
          if (!this.isProcessing) break
          await this.runSingleTask(gIdx, tIdx, task)
        }
        if (this.onGroupDone) await this.onGroupDone(gIdx, group)
      })
    )
    this.isProcessing = false
    if (this.onAllTasksDone) await this.onAllTasksDone(this.taskGroups.length)
  }

  async destroy() {
    this.isProcessing = false
    this.isPaused = false
    await Promise.all([...this.children.entries()].map(([idx, child]) => {
      this.stoppedTasks.add(idx)
      return killProcessTree(child)
    }))
    this.children.clear()
    Object.values(this.timeouts).forEach(clearTimeout)
    this.timeouts = {}
    this.tasks = []
    this.threads = []
    this.processing = []
    this.processed = []
    this.stoppedTasks.clear()
    if (this.onDestroy) await this.onDestroy()
  }

  getProcessing() {
    return this.processing
  }

  getProcessed() {
    return this.processed
  }

  getThreads() {
    return this.threads
  }

  isRunning() {
    return this.isProcessing
  }

  isPause() {
    return this.isPaused
  }

  getStatus() {
    return {
      total: this.tasks.length,
      running: this.processing.length,
      done: this.processed.length,
      waiting: Math.max(0, this.tasks.length - this.processing.length - this.processed.length),
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      retryCount: { ...this.retryCount },
      globalRetryCount: this.globalRetryCount,
      globalRetryLimit: this.globalRetryLimit,
      maxRetry: this.maxRetry,
      threads: [...this.threads],
      taskStatus: { ...this.taskStatus }
    }
  }
}

module.exports = { TaskProcessManager, delay }
