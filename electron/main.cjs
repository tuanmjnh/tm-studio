const { app, BrowserWindow, Menu, ipcMain, protocol, session } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const { pathToFileURL } = require('url')
const { registerDialogController } = require('./tools/dialog.cjs')
const { registerFileManagerController } = require('./tools/file-manager.cjs')
const { registerAppUpdaterController } = require('./tools/app-updater.cjs')
const { registerTmcutController } = require('./tools/tmcut.controller.cjs')
const { registerAssetCenterController } = require('./tools/asset-center.controller.cjs')
const { registerAiGateway } = require('./tools/ai-gateway.cjs')
// Production process artifacts (stage → artifact → gate): real files under
// userData/tmcut/process, one directory per artifact version.
const { registerProcessController } = require('./tools/process-store.cjs')
const { registerVideoGeneration } = require('./tools/video-generation/controller.mjs')
// MCP server — spawned child with IPC channel
const { spawn } = require('child_process')
// API-key slots are encrypted AT REST with the OS keychain
// (safeStorage: DPAPI/Keychain/libsecret). Boundary rule: the FILE holds
// tokens, process.env holds plaintext.
const { decrypt, isEncryptionAvailable, magicPrefix } = require('./tools/ai-secure.cjs')
// The line transform behind the startup migration AND the vault page's
// "Encrypt now" button is pure (key-migrate.cjs).
const { migrateKeyContent } = require('./tools/key-migrate.cjs')
// The config.env parser is shared by get-config, ai-key-status and
// set-config — one implementation, so "file missing" can never be read
// differently by two handlers. Shape: { exists, values }.
const { readConfigFile, writeConfigValues } = require('./tools/config-file.cjs')
const { applyPublicConfig } = require('./tools/public-config.cjs')
const { createHubLoginBroker } = require('./tools/hub-login-broker.cjs')
const { mediaSchemePrivileges, createMediaHandler } = require('./media-protocol.cjs')

// Secret config slots: ONE definition (secret-slots.cjs) shared by the
// masking/decryption paths here and the at-rest migration.
const { SECRET_SLOT_RE } = require('./tools/secret-slots.cjs')

protocol.registerSchemesAsPrivileged([mediaSchemePrivileges()])

const isDev = !app.isPackaged
// Both ports come from the ONE resolver in tools/ports.cjs; only a real
// TCP port wins, anything else falls back.
const { parsePort, resolveDevPort } = require('./tools/ports.cjs')
const { resolveOrigins } = require('./tools/renderer-origin.cjs')

const PORT = parsePort(process.env.APP_PORT) ?? 3456
// Dev renderer is served by `pnpm dev` (nuxt dev --port 4003). Keep the
// wait-on URL in the `dev:electron` script in sync with this default.
const DEV_PORT = resolveDevPort(process.env)

// The renderer origin (see tools/renderer-origin.cjs). Packaged builds load
// from localhost, never the IP literal: WebAuthn rejects an IP address as a
// relying party ID, so every passkey ceremony threw on 127.0.0.1. localhost
// is also the RP ID the hub issues for the browser build, so one credential
// works in both. The legacy IP origin survives only for the one-time
// localStorage/cookie migration and media:// CORS.
const RENDERER_ORIGINS = resolveOrigins({ isDev, port: PORT, devPort: DEV_PORT })
const RENDERER_ORIGIN = RENDERER_ORIGINS.primary
const LEGACY_ORIGIN = RENDERER_ORIGINS.legacy
// Static, script-free page only used to reach localStorage of an origin
// without booting the Nuxt app there.
const MIGRATION_PAGE = '/__origin-migration.html'
const ORIGIN_MIGRATION_MARKER = '__origin_migration_v1'

// Origins the renderer legitimately runs from; media-protocol uses this
// to decide whether a fetch() gets CORS headers (webSecurity:true).
function appOrigins() {
  return RENDERER_ORIGINS.allowed
}

// Users upgrading from a build that ran on 127.0.0.1 would otherwise open the
// app logged out, with their project index and media bin empty: localStorage
// and cookies are per-origin. Move both across once, copy-only, right before
// the app window loads. Best effort — any failure leaves a clean first-run.
async function migrateLegacyOrigin() {
  if (isDev) return
  const ses = session.defaultSession

  const readMarker = async () => {
    const probe = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
    try {
      await probe.loadURL(`${RENDERER_ORIGIN}${MIGRATION_PAGE}`)
      return await probe.webContents.executeJavaScript(
        `localStorage.getItem(${JSON.stringify(ORIGIN_MIGRATION_MARKER)})`,
        true
      )
    } finally {
      probe.destroy()
    }
  }

  if (await readMarker()) return

  let legacyStorage
  const legacy = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  try {
    await legacy.loadURL(`${LEGACY_ORIGIN}${MIGRATION_PAGE}`)
    legacyStorage = await legacy.webContents.executeJavaScript(`(() => {
      const out = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key !== null) out[key] = localStorage.getItem(key)
      }
      return out
    })()`, true) || {}
  } catch {
    legacyStorage = {}
  } finally {
    legacy.destroy()
  }

  // Cookies are hidden from the renderer, so copy them through the session.
  try {
    const cookies = await ses.cookies.get({ domain: '127.0.0.1' })
    for (const cookie of cookies) {
      const details = { url: RENDERER_ORIGIN, name: cookie.name, value: cookie.value, path: cookie.path || '/' }
      if (cookie.secure) details.secure = true
      if (cookie.httpOnly) details.httpOnly = true
      if (typeof cookie.expirationDate === 'number') details.expirationDate = cookie.expirationDate
      if (cookie.sameSite && cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite
      await ses.cookies.set(details).catch(() => {})
    }
  } catch {
    // no legacy cookies
  }

  const entries = Object.entries(legacyStorage)
  const target = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  try {
    await target.loadURL(`${RENDERER_ORIGIN}${MIGRATION_PAGE}`)
    await target.webContents.executeJavaScript(`(() => {
      const entries = ${JSON.stringify(entries)}
      for (const [key, value] of entries) {
        try { if (localStorage.getItem(key) === null) localStorage.setItem(key, value) } catch {}
      }
      localStorage.setItem(${JSON.stringify(ORIGIN_MIGRATION_MARKER)}, '1')
    })()`, true)
  } catch {
    // leave the new origin empty
  } finally {
    target.destroy()
  }
}

let win = null

function loadUserConfig() {
  const { values } = readConfigFile(path.join(app.getPath('userData'), 'config.env'))
  for (const [key, raw] of Object.entries(values)) {
    // The file holds keychain TOKENS; env carries plaintext so the gateway
    // and every existing consumer stay untouched. decrypt() passes plaintext
    // through (pre-encryption files) and yields null for a corrupt token.
    const value = SECRET_SLOT_RE.test(key) ? decrypt(raw) : raw
    if (!process.env[key] && value !== null) {
      process.env[key] = value
    }
  }
}

/**
 * Hub URL / app id / public JWKs baked at build time. Applied on the shared
 * startup path so dev and packaged resolve the same values: dev loads the
 * renderer from the Nuxt dev server and never starts Nitro, so a call inside
 * `startServer()` alone would leave the auth broker and the AI relay with an
 * empty app id. `applyPublicConfig` only fills keys the environment does not
 * already have, so `config.env` still wins.
 */
function applyBakedPublicConfig() {
  applyPublicConfig(
    app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'public-config.json')
      : path.join(__dirname, '..', 'resources', 'public-config.json')
  )
}

async function startServer() {
  process.env.NITRO_PORT = String(PORT)
  process.env.NITRO_HOST = '127.0.0.1'

  const serverPath = path.join(__dirname, '..', '.output', 'server', 'index.mjs')
  await import(pathToFileURL(serverPath).href)

  return new Promise((resolve, reject) => {
    let attempts = 0
    const maxAttempts = 30
    const poll = () => {
      attempts++
      const req = http.get(`http://127.0.0.1:${PORT}`, (res) => {
        res.resume()
        console.log(`[Electron] Nitro server running on http://127.0.0.1:${PORT}`)
        resolve()
      })
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          reject(new Error(`Server did not start after ${maxAttempts} attempts`))
        } else {
          setTimeout(poll, 300)
        }
      })
      req.end()
    }
    poll()
  })
}

function getAppIcon() {
  const isWin = process.platform === 'win32'
  const iconName = isWin ? 'icon.ico' : 'icon.png'
  const candidatePaths = [
    path.join(__dirname, '..', 'public', iconName),
    path.join(__dirname, '..', '.output', 'public', iconName),
    path.join(__dirname, '..', 'public', 'icon.png'),
    path.join(__dirname, '..', '.output', 'public', 'icon.png')
  ]
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p
  }
  return undefined
}

async function createWindow() {
  Menu.setApplicationMenu(null)

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // Same-origin policy is ON. Local media runs through the privileged
      // media:// scheme, which answers CORS for appOrigins() only.
      webSecurity: true,
      devTools: isDev
    }
  })

  if (isDev) {
    win.loadURL(RENDERER_ORIGIN)
    win.webContents.openDevTools()
  } else {
    try {
      await startServer()
    } catch (err) {
      console.error('[Electron] Failed to start server:', err)
      win.loadURL(`data:text/html,<h1>Server failed to start</h1><pre>${err.message}</pre>`)
      win.show()
      return
    }
    await migrateLegacyOrigin().catch(err => console.error('[Electron] Origin migration failed:', err))
    win.loadURL(RENDERER_ORIGIN)
  }

  // Navigation lockdown (Electron security checklist #17): the main
  // frame must never navigate to a foreign origin.
  const appOrigin = RENDERER_ORIGIN
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin) && !url.startsWith('devtools://')) {
      event.preventDefault()
    }
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (isDev && input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools()
      return
    }
    // F5 reload: the app sets the application menu to null (which removes
    // Electron's default reload roles), so F5 is wired here manually.
    if (input.key === 'F5') {
      event.preventDefault()
      win.webContents.reload()
    }
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  // Handle window.open() calls - allow popups for OAuth flows
  win.webContents.setWindowOpenHandler(({ url }) => {
    const allowedOAuthHosts = [
      'accounts.google.com',
      'github.com',
      'login.microsoftonline.com'
    ]
    try {
      const parsed = new URL(url)
      if (allowedOAuthHosts.some(host => parsed.hostname.includes(host))) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 540,
            height: 680,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true
            }
          }
        }
      }
      // Other external URLs → system browser
      if (url.startsWith('http') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
        const { shell } = require('electron')
        shell.openExternal(url).catch(() => {})
        return { action: 'deny' }
      }
    } catch { /* ignore URL parse errors */ }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 540,
        height: 680,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      }
    }
  })

  registerAppUpdaterController(win)

  win.on('closed', () => {
    win = null
  })
}

const userConfigPath = () => path.join(app.getPath('userData'), 'config.env')

// Keys written before encryption existed sit plaintext in config.env.
// Re-encrypt once on startup (file + live env). Skips anything already
// encrypted; no-ops when the OS keychain is unavailable.
function migrateStoredKeysToSecureStorage() {
  if (!isEncryptionAvailable()) return
  const configFile = userConfigPath()
  let content
  try {
    content = fs.readFileSync(configFile, 'utf8')
  } catch {
    return
  }
  const { content: migrated, changed } = migrateKeyContent(content)
  if (changed) {
    try {
      fs.writeFileSync(configFile, migrated, 'utf8')
    } catch {
      // unwritable file: live env still migrated, file follows next save
    }
  }
}

// IPC sender validation: every privileged handler refuses calls whose
// frame is not the app's own origin. The factory lives in ipcPolicy.cjs.
const { createSenderGate, gateIpcMainHandle } = require('./ipcPolicy.cjs')

const isTrustedSender = createSenderGate({ isDev, port: PORT, devPort: DEV_PORT })

// Install the choke-point BEFORE any controller registers. Every
// ipcMain.handle call from now on is automatically wrapped so a
// non-app-origin frame's invoke resolves to undefined.
gateIpcMainHandle(ipcMain, isTrustedSender)

ipcMain.handle('get-config', (event) => {
  if (!isTrustedSender(event)) return {}
  const parsed = readConfigFile(userConfigPath())
  const result = {}
  for (const [key, raw] of Object.entries(parsed.values)) {
    // The file holds keychain TOKENS for secret slots; a renderer must
    // never see either form. Secret values are masked out entirely.
    if (SECRET_SLOT_RE.test(key)) {
      const plain = decrypt(raw)
      result[key] = plain ? '********' : ''
      continue
    }
    result[key] = raw
  }
  return result
})

// Shared vault-status read for ai-key-status AND ai-migrate-keys. Counts,
// never values.
function keyVaultStatus() {
  const parsed = readConfigFile(userConfigPath())
  let encrypted = 0
  let plaintext = 0
  for (const [key, raw] of Object.entries(parsed.values)) {
    if (!SECRET_SLOT_RE.test(key) || !raw) continue
    if (raw.startsWith(magicPrefix())) encrypted++
    else plaintext++
  }
  return { available: isEncryptionAvailable(), exists: parsed.exists, encrypted, plaintext }
}

ipcMain.handle('ai-key-status', (event) => {
  if (!isTrustedSender(event)) return { ok: false }
  return { ok: true, data: keyVaultStatus() }
})

ipcMain.handle('ai-migrate-keys', (event) => {
  if (!isTrustedSender(event)) return { ok: false }
  if (!isEncryptionAvailable()) return { ok: false, data: keyVaultStatus() }
  migrateStoredKeysToSecureStorage()
  return { ok: true, data: keyVaultStatus() }
})

ipcMain.handle('set-config', (event, values) => {
  if (!isTrustedSender(event)) return { success: false }
  const configFile = userConfigPath()
  const existing = readConfigFile(configFile)
  const incoming = values && typeof values === 'object' ? values : {}
  const merged = { ...existing.values, ...incoming }
  // One writer: the masked-echo rule and at-rest encryption live in
  // config-file.cjs, shared with the device credential broker.
  writeConfigValues(configFile, merged)
  for (const [key, value] of Object.entries(incoming)) {
    if (SECRET_SLOT_RE.test(key) && String(value) === '********') continue
    process.env[key] = String(value)
  }
  return { success: true, path: configFile }
})

// v2 device-auth boundary. The renderer never talks to Hub for a full-session
// auth call: Main derives the device identity, receives the optional device
// service credential, writes it into the vault and returns only the session.
const hubAuth = createHubLoginBroker({
  configFile: userConfigPath,
  readConfigFile,
  writeConfigValues,
  // No keychain, no credential on disk. The session still completes; the user
  // re-enrols on a later sign-in instead of leaving a plaintext secret behind.
  canPersistSecret: isEncryptionAvailable
})

ipcMain.handle('auth:device-info', (event) => {
  if (!isTrustedSender(event)) return null
  return hubAuth.deviceInfo()
})

ipcMain.handle('auth:login', async (event, credentials) => {
  if (!isTrustedSender(event)) return { success: false, code: 'untrusted' }
  const email = String(credentials?.email || '').trim()
  const password = String(credentials?.password || '')
  if (!email || !password) return { success: false, code: 'invalidRequest' }
  return await hubAuth.login({ email, password })
})

ipcMain.handle('auth:verify-totp', async (event, input) => {
  if (!isTrustedSender(event)) return { success: false, code: 'untrusted' }
  return await hubAuth.verifyTotp(input)
})

ipcMain.handle('auth:passkey-start', async (event) => {
  if (!isTrustedSender(event)) return { success: false, code: 'untrusted' }
  return await hubAuth.passkeyStart()
})

ipcMain.handle('auth:passkey-finish', async (event, credential) => {
  if (!isTrustedSender(event)) return { success: false, code: 'untrusted' }
  return await hubAuth.passkeyFinish(credential)
})

ipcMain.handle('auth:register', async (event, input) => {
  if (!isTrustedSender(event)) return { success: false, code: 'untrusted' }
  const email = String(input?.email || '').trim()
  const password = String(input?.password || '')
  const name = String(input?.name || '').trim()
  if (!email || !password || !name) return { success: false, code: 'invalidRequest' }
  return await hubAuth.register({ email, password, name })
})

ipcMain.handle('open-path', async (event, fullPath) => {
  if (!isTrustedSender(event)) return false
  const { shell } = require('electron')
  const exists = typeof fullPath === 'string' && fs.existsSync(fullPath)
  if (!exists) return false
  try {
    const err = await shell.openPath(fullPath)
    return err === ''
  } catch {
    return false
  }
})

ipcMain.handle('open-external', async (event, url) => {
  if (!isTrustedSender(event)) return false
  const { shell } = require('electron')
  try {
    if (!url || typeof url !== 'string') return false
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('show-item-in-folder', async (event, fullPath) => {
  if (!isTrustedSender(event)) return false
  const { shell } = require('electron')
  if (typeof fullPath !== 'string' || !fs.existsSync(fullPath)) return false
  shell.showItemInFolder(fullPath)
  return true
})

ipcMain.handle('verify-path', async (_event, { filePath, type }) => {
  const { verifyExecutable } = require('./tools/paths.cjs')
  try {
    const isValid = await verifyExecutable(filePath, type)
    return { status: isValid }
  } catch {
    return { status: false }
  }
})

// The media:// protocol itself lives in media-protocol.cjs: with
// webSecurity on, only requests from appOrigins() receive CORS headers.

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(process.execPath)
  }
  // User config is loaded for every session so dev and prod see the same
  // env (set-if-unset semantics), then any pre-encryption plaintext keys
  // are migrated to keychain tokens before anything else touches the file.
  // The baked public config is applied right after it because the Hub URL and
  // app id gate the auth broker and the AI relay in both modes.
  loadUserConfig()
  applyBakedPublicConfig()
  migrateStoredKeysToSecureStorage()
  protocol.handle('media', createMediaHandler(appOrigins))

  registerDialogController()
  // The filesystem surface requires the same app-origin check as the
  // privileged root handlers.
  registerFileManagerController({ isTrustedSender })
  registerTmcutController()
  // No HTML-video renderer here (ADR-023): the job runs on the Nitro server's
  // one engine on both hosts, and this process is served by that same server.
  // On-demand Asset Center. The queue lives renderer-side (core state
  // machine); this controller is the thin download/registry I/O adapter.
  // getWindow() is a getter because `win` is recreated on macOS activate.
  registerAssetCenterController(() => win)
  registerAiGateway()
  registerProcessController()
  registerVideoGeneration()

  // MCP server — spawn child process with IPC channel
  let mcpServerProcess = null
  // Scaffolding for the MCP server lifecycle; the renderer-driven IPC handlers
  // below are the live path today, so the spawn is intentionally idle.
  // eslint-disable-next-line no-unused-vars
  function spawnMcpServer() {
    if (mcpServerProcess) return mcpServerProcess
    const serverPath = path.join(__dirname, 'tools', 'mcp', 'server.mjs')
    mcpServerProcess = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        MCP_IDLE_TIMEOUT_MS: '300000'
      }
    })
    mcpServerProcess.on('error', (err) => {
      console.error('[MCP] Server spawn error:', err)
      mcpServerProcess = null
    })
    mcpServerProcess.on('exit', (code, signal) => {
      console.log(`[MCP] Server exited: code=${code}, signal=${signal}`)
      mcpServerProcess = null
    })
    // Forward MCP server stderr to our logs
    if (mcpServerProcess.stderr) {
      mcpServerProcess.stderr.on('data', (data) => {
        const text = data.toString().trim()
        if (text) console.error('[MCP Server]', text)
      })
    }
    return mcpServerProcess
  }

  // IPC handlers for MCP server -> main communication
  ipcMain.handle('mcp:server:tool:invoke', async (event, { tool, params, requestId, projectId }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    try {
      if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
      return new Promise((resolve) => {
        const responseChannel = `mcp:forward:respond`
        const handler = (_evt, { requestId: respId, result }) => {
          if (respId === requestId) {
            ipcMain.removeHandler(responseChannel, handler)
            resolve(result)
          }
        }
        ipcMain.on(responseChannel, handler)
        win.webContents.send('mcp:forward', { tool, params, requestId, projectId })
        setTimeout(() => {
          ipcMain.removeHandler(responseChannel, handler)
          resolve({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Timeout', retryable: true } })
        }, 10000)
      })
    } catch (err) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: String(err), retryable: true } }
    }
  })

  ipcMain.handle('mcp:server:session:init', async (event, { projectId }) => {
    if (!isTrustedSender(event)) return { ok: false }
    return { ok: true, projectId }
  })

  ipcMain.handle('mcp:server:session:close', async (event) => {
    if (!isTrustedSender(event)) return { ok: false }
    return { ok: true }
  })

  // Renderer -> main: proposal changed / project changed events from MCP server
  ipcMain.handle('mcp:server:event:proposal_changed', (event, proposal) => {
    if (!isTrustedSender(event)) return
    console.error(JSON.stringify({ type: 'event:proposal_changed', payload: proposal }))
  })

  ipcMain.handle('mcp:server:event:project_changed', (event, summary) => {
    if (!isTrustedSender(event)) return
    console.error(JSON.stringify({ type: 'event:project_changed', payload: summary }))
  })

  ipcMain.handle('mcp:server:event:job_status', (event, job) => {
    if (!isTrustedSender(event)) return
    console.error(JSON.stringify({ type: 'event:job_status', payload: job }))
  })

  // Asset Center, Templates, Export Queue handlers — forward to renderer
  // via mcp:forward channel
  // ============================================================

  // Asset Center
  ipcMain.handle('mcp:asset:list_catalog', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('asset.list_catalog', { params, projectId })
  })

  ipcMain.handle('mcp:asset:install', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('asset.install', { params, projectId })
  })

  ipcMain.handle('mcp:asset:uninstall', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('asset.uninstall', { params, projectId })
  })

  ipcMain.handle('mcp:asset:install_status', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('asset.install_status', { params, projectId })
  })

  // Templates
  ipcMain.handle('mcp:template:list', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('template.list', { params, projectId })
  })

  ipcMain.handle('mcp:template:apply', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('template.apply', { params, projectId })
  })

  ipcMain.handle('mcp:template:save_as', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('template.save_as', { params, projectId })
  })

  ipcMain.handle('mcp:template:delete', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('template.delete', { params, projectId })
  })

  ipcMain.handle('mcp:template:import', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('template.import', { params, projectId })
  })

  ipcMain.handle('mcp:template:export', async (event, { projectId, params }) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender', retryable: false } }
    if (!win || win.isDestroyed()) return { ok: false, error: { code: 'NO_PROJECT', message: 'No window available', retryable: true } }
    return forwardToRenderer('template.export', { params, projectId })
  })

  // Forward helper: sends mcp:forward to renderer, waits for mcp:forward:respond
  function forwardToRenderer(tool, payload) {
    return new Promise((resolve) => {
      const requestId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const responseChannel = 'mcp:forward:respond'
      const handler = (_evt, { requestId: respId, result }) => {
        if (respId === requestId) {
          ipcMain.removeHandler(responseChannel, handler)
          resolve(result)
        }
      }
      ipcMain.on(responseChannel, handler)
      win.webContents.send('mcp:forward', { tool, params: payload, requestId, projectId: payload.projectId })
      setTimeout(() => {
        ipcMain.removeHandler(responseChannel, handler)
        resolve({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Timeout', retryable: true } })
      }, 30000)
    })
  }

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (win === null) createWindow()
})
