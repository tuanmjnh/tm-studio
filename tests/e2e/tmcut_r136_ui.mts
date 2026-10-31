/**
 * R135+R136 UI check (dev-only): the AutoCut step-2 panel exposes the AI
 * triage blend-weight slider (tmcut.autocutV2.aiWeight*) AND persists the
 * whole wizard option set across reloads (docs §200). Verifies on the
 * LIVE page:
 *   1. slider is hidden while the AI triage switch is off;
 *   2. toggling the switch reveals the slider + % readout, default 25%;
 *   3. keyboard steps move the readout (real v-model, not a cosmetic
 *      number);
 *   4. profile / filler / triage / weight / keywords all survive a full
 *      page reload (R136: localStorage prefs, sanitized on read).
 *
 * Needs the same preconditions as tmcut_r124_ui.mts: dev server on
 * TMCUT_DEV_URL, hub stub on TMCUT_HUB_PORT, system Edge/Chrome via
 * CHROME_EXE. Runs headless. Exit 0 on all pass, 1 on any failure.
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
  console.log(`R136 UI ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`)
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
    // Same contract as tmcut_r124_ui.mts: the stub reads HUB_PORT.
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
    // The web runtime deliberately clears the media library on load
    // (blob: URLs do not survive reload), so the ONE ready video asset
    // is pushed through the dev-only QA hook (useTmcutMedia registers
    // window.tmcutQaStore.assets), exactly like tmcut_r124_ui.mts does.
    await page.goto(`${DEV_URL}/tmcut/autocut`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForFunction(() => !!(window as any).tmcutQaStore?.assets, null, { timeout: 30000 })
    await page.evaluate(() => {
      ;(window as any).tmcutQaStore.assets.value = [{
        id: 'qa-asset-r135',
        name: 'r135-source.mp4',
        kind: 'video',
        status: 'ready',
        path: 'D:/qa/r135-source.mp4',
        src: 'data:video/mp4;base64,',
        usedBy: [],
        meta: { durationSec: 12, width: 1920, height: 1080, fps: 30, fileSize: 1000, mtimeMs: 0, probedAt: null, hasVideo: true },
        addedAt: new Date().toISOString()
      }]
    })
    console.log(`R136 UI INFO url=${page.url()}`)

    // Step-1 → step-2 through the media library (no native dialog in
    // web mode; the pushed asset is the source).
    const libBtn = page.locator('button', { hasText: /Choose from Media/i }).first()
    let libBtnVisible = true
    try {
      await libBtn.waitFor({ state: 'visible', timeout: 15000 })
    } catch {
      libBtnVisible = false
    }
    check('media-library button visible on step 1', libBtnVisible)
    if (!libBtnVisible) throw new Error('media-library button not found — cannot reach step 2')
    await libBtn.click()
    await page.waitForTimeout(600)
    // Diagnostic: a stuck step 1 means the media pick found no ready
    // source (toast 'No ready video found').
    const bodyText = await page.locator('body').innerText()
    console.log(`R136 UI INFO onStep2=${bodyText.includes('Filter filler words')}`)

    // Step 2 carries TWO switches (filler filter, then AI triage) — the
    // triage one is the LAST in the options column.
    const switchEl = page.locator('[role="switch"]').last()
    const switchCount = await page.locator('[role="switch"]').count()
    check('step 2 shows the options switches', switchCount >= 2, `switches=${switchCount}`)

    // The weight block is the bordered card rendered under the triage
    // switch; anchor on its unique label.
    const weightBlock = page.locator('div.rounded-lg').filter({
      has: page.getByText('AI influence on scoring')
    }).first()
    const weightSlider = weightBlock.locator('input[type="range"], [role="slider"]').first()

    // 1) slider hidden while the switch is off (default state).
    const hiddenBefore = await weightBlock.isHidden().catch(() => true)
    check('weight block hidden while triage is off', hiddenBefore)

    // 2) toggle triage on → slider + readout appear, default 25%.
    await switchEl.click()
    await page.waitForTimeout(400)
    const blockVisible = await weightBlock.isVisible().catch(() => false)
    check('weight block visible when triage enabled', blockVisible)
    const sliderVisible = await weightSlider.isVisible().catch(() => false)
    check('weight slider rendered inside the block', sliderVisible)
    const readout = weightBlock.locator('span.tabular-nums')
    const readoutText = (await readout.innerText().catch(() => '')).trim()
    check('readout shows the default 25%', readoutText === '25%', `readout=${readoutText}`)

    // 3) keyboard steps on the focused slider (Reka thumb) → the readout
    // must follow: real two-way binding, not a cosmetic number.
    // step 0.05 → two ArrowRight = +0.10 → 35%.
    await weightSlider.click({ position: { x: 5, y: 5 } })
    await weightSlider.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    const readoutText2 = (await readout.innerText().catch(() => '')).trim()
    check('readout follows keyboard steps (25% → 35%)', readoutText2 === '35%', `readout=${readoutText2}`)

    // 4) R136: the whole option set SURVIVES A RELOAD (prefs persist).
    //    Mutate every field, reload, re-enter step 2, expect all back.
    //    Filler switch is the FIRST on step 2, triage the LAST.
    const fillerSwitch = page.locator('[role="switch"]').first()
    await fillerSwitch.click()
    // R137: chips editor. Typing + Enter commits a chip (the draft is
    // ephemeral — persistence rides on the comma string underneath).
    // aria-label keeps the locator stable even once chips hide the
    // placeholder text.
    const keywordsInput = page.getByLabel('Priority highlight keywords').last()
    await keywordsInput.fill('hook')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    await keywordsInput.fill('summary')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    // The chip's remove button sits INSIDE the chip span — filter on
    // the button + text so only real chips match.
    const hookChip = page.locator('span.rounded-full').filter({ has: page.getByRole('button') }).filter({ hasText: 'hook' })
    const summaryChip = page.locator('span.rounded-full').filter({ has: page.getByRole('button') }).filter({ hasText: 'summary' })
    check('chips render after Enter commits', (await hookChip.count()) === 1 && (await summaryChip.count()) === 1)
    const podcastCard = page.locator('div.border-2').filter({ has: page.getByText('Podcast Highlights') }).first()
    await podcastCard.click()
    await page.waitForTimeout(400)

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 })
    // Web runtime clears the media library on load → re-push the asset.
    await page.waitForFunction(() => !!(window as any).tmcutQaStore?.assets, null, { timeout: 30000 })
    await page.evaluate(() => {
      ;(window as any).tmcutQaStore.assets.value = [{
        id: 'qa-asset-r135',
        name: 'r135-source.mp4',
        kind: 'video',
        status: 'ready',
        path: 'D:/qa/r135-source.mp4',
        src: 'data:video/mp4;base64,',
        usedBy: [],
        meta: { durationSec: 12, width: 1920, height: 1080, fps: 30, fileSize: 1000, mtimeMs: 0, probedAt: null, hasVideo: true },
        addedAt: new Date().toISOString()
      }]
    })
    let libBtnAfter = true
    try {
      await libBtn.waitFor({ state: 'visible', timeout: 15000 })
    } catch {
      libBtnAfter = false
    }
    if (!libBtnAfter) throw new Error('media-library button not visible after reload')
    await libBtn.click()
    await page.waitForTimeout(600)

    // Profile card: selection paints border-primary.
    const cardClasses = await podcastCard.evaluate(el => el.className)
    check('profile survives reload (Podcast Highlights selected)', cardClasses.includes('border-primary'))
    // Filler switch was turned OFF before reload.
    const fillerChecked = await fillerSwitch.getAttribute('aria-checked')
    check('filler filter survives reload (still off)', fillerChecked === 'false', `aria=${fillerChecked}`)
    // Triage switch was turned ON before reload.
    const triageSwitch = page.locator('[role="switch"]').last()
    const triageChecked = await triageSwitch.getAttribute('aria-checked')
    check('AI triage survives reload (still on)', triageChecked === 'true', `aria=${triageChecked}`)
    // Weight readout restored at 35% (R135 value persisted by R136).
    const readoutRestored = await weightBlock.locator('span.tabular-nums').innerText().catch(() => '')
    check('aiWeight survives reload (35%)', readoutRestored.trim() === '35%', `readout=${readoutRestored}`)
    const hookChip2 = page.locator('span.rounded-full').filter({ has: page.getByRole('button') }).filter({ hasText: 'hook' })
    const summaryChip2 = page.locator('span.rounded-full').filter({ has: page.getByRole('button') }).filter({ hasText: 'summary' })
    const chipsBack = (await hookChip2.count()) === 1 && (await summaryChip2.count()) === 1
    check('keyword CHIPS survive reload', chipsBack)
    // R137: the X button really removes a chip (and it stays removed —
    // the comma string underneath is the single source of truth).
    await summaryChip2.locator('button').click()
    await page.waitForTimeout(250)
    check('X removes a chip', (await page.locator('span.rounded-full').filter({ has: page.getByRole('button') }).filter({ hasText: 'summary' }).count()) === 0)
    // Backspace on the EMPTY draft drops the LAST chip (classic tag-input
    // muscle memory). Clear the leftover draft text first — fill() does
    // not blur, so focus stays on the field.
    await keywordsInput.fill('')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(250)
    check('Backspace on empty draft drops the last chip', (await page.locator('span.rounded-full').filter({ has: page.getByRole('button') }).filter({ hasText: 'hook' }).count()) === 0)

    check('no pageerror during the run', pageErrors.length === 0, pageErrors.slice(0, 1).join(' '))
  } finally {
    await browser.close()
    if (hubProc) hubProc.kill()
  }
  console.log(`R136 UI result: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
