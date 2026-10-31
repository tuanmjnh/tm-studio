/**
 * dev:electron launcher — keeps the Electron devtools (CDP) port usable.
 *
 * The bug this fixes: `dev:electron` hard-coded
 * `--remote-debugging-port=9222`. When that loopback port is already bound by
 * another DevTools target on the same machine (a second Chrome profile with
 * --remote-debugging-port=9222, another Electron session, …), Chromium simply
 * logs "Cannot start http server for devtools" and continues without CDP —
 * the app looks fine but is no longer drivable/testable from outside.
 *
 * Contract: prefer ELECTRON_CDP_PORT, then the documented default 9222, and
 * otherwise probe forward for the first FREE loopback port, spawn Electron
 * with it and announce the chosen endpoint on stdout as
 * "[dev-electron] CDP: http://127.0.0.1:<port>" so tooling can attach.
 * Extra CLI arguments are forwarded to Electron unchanged.
 *
 * The dev profile is a repo-local directory (ELECTRON_USER_DATA_DIR to
 * override). Chromium initialises the profile BEFORE the app's main script
 * runs, so a `%APPDATA%/<app>` it cannot create aborts startup with nothing
 * but "crashpad ... not connected" and an opaque exit code — sqlite.cjs's
 * mkdir never gets a chance to run. Creating the directory here and passing
 * --user-data-dir keeps dev state writable and isolated from the packaged
 * build's profile.
 */
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { parsePort } = require('./ports.cjs')

/** Resolve a loopback connect attempt: taken === true, rejected/refused === false. */
function probePort(port, host = '127.0.0.1', timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    let settled = false
    const done = (taken) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(taken)
    }
    socket.once('connect', () => done(true))
    // ECONNREFUSED = nobody listening = free. Other errors count as taken so a
    // probe failure never silently hands out a bound port.
    socket.once('error', () => done(false))
    socket.setTimeout(timeoutMs, () => done(true))
  })
}

/**
 * First free port in [start, start + span). Kept dependency-injectable so the
 * scan contract is unit-testable without real sockets.
 */
async function pickCdpPort(isTaken, start, span = 21) {
  for (let port = start; port < start + span; port++) {
    if (!(await isTaken(port))) return port
  }
  return null // nothing free: caller falls back to Chromium's own error path
}

const ROOT = path.join(__dirname, '..', '..')

/**
 * Directory the dev Electron profile lives in. Kept pure so the resolution
 * contract is unit-testable; the caller owns the mkdir.
 */
function resolveUserDataDir(env = process.env, root = ROOT) {
  const override = env.ELECTRON_USER_DATA_DIR
  if (override && override.trim()) return path.resolve(override.trim())
  return path.join(root, '.dev-user-data')
}

async function main() {
  const preferred = parsePort(process.env.ELECTRON_CDP_PORT) ?? 9222
  const isTaken = port => probePort(port)
  const port = (await pickCdpPort(isTaken, preferred)) ?? preferred

  const userDataDir = resolveUserDataDir()
  fs.mkdirSync(userDataDir, { recursive: true })

  process.stdout.write(`[dev-electron] CDP: http://127.0.0.1:${port}\n`)
  process.stdout.write(`[dev-electron] user-data: ${userDataDir}\n`)

  // A caller-supplied --user-data-dir wins over the dev default.
  const forwardArgs = process.argv.slice(2)
  const hasUserDataArg = forwardArgs.some(arg => arg.startsWith('--user-data-dir'))
  const userDataArgs = hasUserDataArg ? [] : [`--user-data-dir=${userDataDir}`]

  const electronCli = path.join(
    'node_modules', 'electron', 'cli.js' // resolved relative to ROOT via spawn cwd
  )
  const child = spawn(process.execPath, [
    electronCli,
    '.',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    ...userDataArgs,
    ...forwardArgs
  ], {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: false
  })
  child.on('exit', code => process.exit(code ?? 1))
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[dev-electron] launcher failed: ${(err && err.stack) || err}\n`)
    process.exit(1)
  })
}

module.exports = { pickCdpPort, probePort, resolveUserDataDir }
