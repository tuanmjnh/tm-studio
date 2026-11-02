'use strict'
// R133 — shared IPC trust policy (docs §197).
//
// Two surfaces, one file, both PURE (no electron import at module top so
// unit specs can exercise the logic in plain Node — the electron objects
// are only ever received as arguments):
//
// 1) createSenderGate(): the app-origin check that lived privately in
//    main.cjs since the MCP audit (R124.5). Extracted so controllers that
//    touch the filesystem can apply the SAME rule — the audit's residual
//    risk list flagged tools:file-manager (44 channels of unrestricted
//    absolute-path FS access) as having NO sender validation at all.
//
// 2) PUSH_CHANNELS / OUTBOUND_CHANNELS: the allowlists for the preload
//    bridge's generic send()/on() pass-through. The sandboxed preload
//    (Electron >= 20 defaults sandbox:true) cannot require local files,
//    so it keeps INLINE copies of these arrays; the unit spec
//    tmcut_ipc_policy pins the copies against these originals so the two
//    can never drift apart silently.

// Channels main may PUSH to the renderer via the generic electronAPI.on.
// Derived from the actual webContents.send() call sites: app-updater
// (status-changed), tmcut renderDone, and the ffmpeg task-manager
// controller's event family.
const TASK_EVENT_NAMES = [
  'managerInitialized', 'beforeRunTask', 'progressTask', 'allTasksDone',
  'stoppedTask', 'stoppedTasks', 'errorTask', 'taskRetry', 'taskTimeout', 'updateProgress'
]

const PUSH_CHANNELS = [
  'app-updater:status-changed',
  'tmcut:renderDone',
  // Roadmap v3 PART A: asset download progress pushes (jobId/entryId/
  // loaded/total) — the Asset Center queue's only main->renderer channel.
  'tmcut:assetCenter:progress',
  // Generated-media download progress (bytes loaded of the declared total).
  'tmcut:downloadProgress',
  // MCP server channels (Phase 2)
  'mcp:server:tool:invoke',
  'mcp:server:session:init',
  'mcp:server:session:close',
  'mcp:server:event:proposal_changed',
  'mcp:server:event:project_changed',
  'mcp:server:event:job_status',
  ...TASK_EVENT_NAMES.map(n => `tools:ffmpeg:${n}`)
]

// Channels the renderer may send() into the main process through the
// generic bridge. Nothing legitimately uses ipcRenderer.send today (every
// handler in the app is ipcMain.handle/invoke; grep ipcMain.on = 0 hits),
// so the honest allowlist is EMPTY. A future fire-and-forget channel must
// be added here deliberately, not discovered implicitly.
const OUTBOUND_CHANNELS = [
  // MCP server channels (Phase 3)
  'mcp:server:tool:invoke',
  'mcp:server:session:init',
  'mcp:server:session:close',
  'mcp:server:event:proposal_changed',
  'mcp:server:event:project_changed',
  'mcp:server:event:job_status',
  // MCP server response channels (Phase 3): renderer -> main
  'mcp:forward',
  'mcp:forward:respond'
]

const PUSH_SET = new Set(PUSH_CHANNELS)
const OUTBOUND_SET = new Set(OUTBOUND_CHANNELS)

function isAllowedPushChannel(channel) {
  return typeof channel === 'string' && PUSH_SET.has(channel)
}

function isAllowedOutboundChannel(channel) {
  return typeof channel === 'string' && OUTBOUND_SET.has(channel)
}

/**
 * Build the app-origin sender check. Semantics are byte-for-byte the ones
 * main.cjs used before the extraction (audit R124.5):
 *  - missing/blank frame URL, about:blank and devtools:// pass (Chromium
 *    injects them around trusted app navigations; frame-destroyed reads
 *    must not lock the app out of its own IPC);
 *  - dev accepts the Vite server origin only;
 *  - prod accepts the loopback Nitro server origin only.
 * `port` is the prod server port (string or number); `devPort` is the
 * `pnpm dev` renderer port (default 4003, matches PORT in .env).
 */
function createSenderGate({ isDev, port, devPort = 4003 }) {
  const p = String(port)
  const dp = String(devPort)
  return function isTrustedSender(event) {
    let url
    try {
      url = event.senderFrame ? event.senderFrame.url : ''
    } catch {
      return false
    }
    if (!url || url === 'about:blank' || url.startsWith('devtools://')) return true
    if (isDev) return url.startsWith(`http://localhost:${dp}`) || url.startsWith(`http://127.0.0.1:${dp}`)
    return url.startsWith(`http://127.0.0.1:${p}`) || url.startsWith(`http://localhost:${p}`)
  }
}

/**
 * R134 — ONE choke-point for every privileged invoke channel in the
 * app. Replaces ipcMain.handle with a gated version at startup, so ALL
 * controllers (youtube/ffmpeg/dialog/file-manager/app-updater/profiles/
 * tmcut/ai-gateway), the platform layer's ipcHelper registrations, and
 * any handler added in the future are gated by default — instead of
 * relying on each of ~150 registration sites remembering to check.
 *
 * Semantics:
 *  - a refused sender resolves to undefined (typed-empty, matching what
 *    the R133 file-manager guard returns; no stack trace to fingerprint);
 *  - a handler may STILL do its own early-return (main.cjs root
 *    handlers do) — the checks are idempotent;
 *  - a handler that legitimately takes no event still passes through
 *    the wrapper (the wrapper always receives the event itself).
 *
 * Returns { origHandle, gateCount } — the probe reads gateCount to
 * prove the number of refused calls it provoked.
 */
function gateIpcMainHandle(ipcMain, isTrustedSender) {
  const origHandle = ipcMain.handle.bind(ipcMain)
  const stats = { refused: 0, wrapped: 0 }
  ipcMain.handle = function gatedHandle(channel, fn) {
    stats.wrapped += 1
    return origHandle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        stats.refused += 1
        return undefined
      }
      return fn(event, ...args)
    })
  }
  return { origHandle, stats }
}

module.exports = {
  PUSH_CHANNELS,
  OUTBOUND_CHANNELS,
  TASK_EVENT_NAMES,
  isAllowedPushChannel,
  isAllowedOutboundChannel,
  createSenderGate,
  gateIpcMainHandle
}
