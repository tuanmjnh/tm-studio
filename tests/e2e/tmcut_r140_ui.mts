/**
 * R140/141 UI check (dev-only): the AI key vault page renders clean in the
 * WEB runtime. The vault is Electron-gated by design (window.electronAPI is
 * undefined in the browser), so the honest web behavior is: title +
 * description render, the desktop-only note appears, and NOTHING throws.
 * A crash here means the page assumed Electron before the gate — the exact
 * class of bug this harness exists to catch.
 *
 * Same preconditions as tmcut_r136_ui.mts (dev server, hub stub, Edge via
 * CHROME_EXE). Headless. Exit 0 on all pass.
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const DEV_URL = process.env.TMCUT_DEV_URL || 'http://localhost:4002'
const HUB_PORT = process.env.TMCUT_HUB_PORT || '4000'
const browserExe = process.env.CHROME_EXE || ''

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`R140 UI ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`)
  if (ok) pass++
  else fail++
}

async function main() {
  const alive = await fetch(`http://localhost:${HUB_PORT}/api/v1/auth/me`).then(
    () => true,
    () => false
  )
  let hubProc: ReturnType<typeof spawn> | null = null
  if (!alive) {
    hubProc = spawn(process.execPath, [path.join(ROOT, 'tests/e2e/hub-stub.cjs')], {
      cwd: ROOT,
      env: { ...process.env, HUB_PORT },
      stdio: 'ignore'
    })
    await new Promise(r => setTimeout(r, 1200))
  }

  const browser = await chromium.launch({
    executablePath: browserExe,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio']
  })
  const context = await browser.newContext({ viewport: { width: 1480, height: 920 } })
  await context.addCookies([
    { url: DEV_URL + '/login', name: 'accessToken', value: 'qa-token' },
    { url: DEV_URL + '/login', name: 'refreshToken', value: 'qa-refresh' }
  ])
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', err => pageErrors.push(String(err)))

  try {
    await page.goto(`${DEV_URL}/system/ai-keys`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    // BasePage title renders from settings.aiKeysTitle ("AI Key Vault").
    const title = page.getByRole('heading', { name: 'AI Key Vault' })
    await title.first().waitFor({ state: 'visible', timeout: 30000 })
    check('page renders the vault title', true)

    // Web runtime has no Electron: the honest desktop-only note appears...
    const note = page.getByText('AI connection setup runs in the desktop app')
    check('desktop-only note visible in web runtime', await note.isVisible())
    // ...and the Electron-only blocks (banner, per-surface rows) do NOT.
    const surface = page.getByText('Editor · script')
    check('per-surface rows hidden without Electron', !(await surface.isVisible()))

    // No thrown errors anywhere (the page must gate on electronAPI before
    // touching any IPC-backed composable).
    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
  } catch (err) {
    check(`harness crashed: ${(err as Error).message.slice(0, 140)}`, false)
  } finally {
    await browser.close()
    if (hubProc) hubProc.kill()
    console.log(`\nR140 UI result: ${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  }
}

void main()
