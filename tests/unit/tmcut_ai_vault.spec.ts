/**
 * R140 specs — AI key vault dashboard contract (docs §204).
 * The page itself is Electron-only; these specs pin the CONTRACTS that
 * make it honest: the IPC channel exists at every layer (main registers,
 * preload exposes, types describe), the handler returns COUNTS ONLY
 * (never a value), and the page keeps its read-only promise (no
 * set-config anywhere — editing stays in the AI connect panel).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('TMCut AI key vault — channel contract (R140)', () => {
  const main = read('electron/main.cjs')
  const preload = read('electron/preload.cjs')

  it('the IPC channel is registered by main and exposed by preload', () => {
    assert.ok(main.includes('ipcMain.handle(\'ai-key-status\''), 'main must register ai-key-status')
    assert.ok(preload.includes('aiKeyStatus: () => ipcRenderer.invoke(\'ai-key-status\')'), 'preload must expose aiKeyStatus()')
  })

  it('the handler counts secret slots through the SAME closed regex (no ad-hoc key lists)', () => {
    // R143: counting moved into keyVaultStatus() shared by status +
    // migrate — the contract is the SHARED function, not one handler body.
    const shared = main.slice(main.indexOf('function keyVaultStatus'))
    const body = shared.slice(0, shared.indexOf('\n}') + 2)
    assert.ok(body.includes('SECRET_SLOT_RE'), 'counts must flow through SECRET_SLOT_RE')
    assert.ok(body.includes('isEncryptionAvailable()'), 'availability must be reported')
    // R141: a fresh install (no config.env) must be distinguishable from
    // a parsed file with zero secret slots, or the banner lies.
    assert.ok(body.includes('parsed.exists'), 'shared counter must report whether the file exists')
    // Counts only: neither the counter nor its handlers return values.
    assert.ok(!/return\s+(parsed|cfg)\b|JSON\.stringify\((parsed|cfg)\)/.test(main.slice(main.indexOf('function keyVaultStatus'), main.indexOf('ipcMain.handle(\'set-config\''))),
      'the vault layer must never return config values')
  })

  it('the trusted-sender gate covers the handler (it is registered like every privileged one)', () => {
    const handler = main.slice(main.indexOf('ipcMain.handle(\'ai-key-status\''))
    const body = handler.slice(0, 400)
    assert.ok(body.includes('isTrustedSender(event)'), 'ai-key-status must check the sender')
  })

  it('the migrate channel exists at every layer and reuses the startup migration (R143)', () => {
    // The button must not invent a second encryption path: it calls the
    // SAME migrateStoredKeysToSecureStorage the app runs at boot.
    assert.ok(main.includes('ipcMain.handle(\'ai-migrate-keys\''), 'main must register ai-migrate-keys')
    const handler = main.slice(main.indexOf('ipcMain.handle(\'ai-migrate-keys\''))
    const body = handler.slice(0, handler.indexOf('})', handler.indexOf('{')))
    assert.ok(body.includes('isTrustedSender(event)'), 'ai-migrate-keys must check the sender')
    assert.ok(body.includes('isEncryptionAvailable()'), 'refuses to pretend when no keychain exists')
    assert.ok(body.includes('migrateStoredKeysToSecureStorage()'), 'must reuse the startup migration, not re-implement it')
    assert.ok(preload.includes('aiMigrateKeys: () => ipcRenderer.invoke(\'ai-migrate-keys\')'), 'preload must expose aiMigrateKeys()')
  })

  it('the Encrypt-now button is scoped to its one honest trigger', () => {
    // available + plaintext>0. Never offered when the keychain is absent
    // (nothing to do) or when everything is already encrypted (no-op UI).
    const page = read('app/pages/system/ai-keys.vue')
    assert.ok(/showEncryptButton = computed\(\(\) =>[\s\S]*?available && vault\.value\.plaintext > 0/.test(page),
      'button must require BOTH keychain availability and plaintext keys')
  })

  it('the slot regex has ONE definition and zero copies (R145)', () => {
    // The R139 era kept byte-identical literals in main.cjs and
    // key-migrate.cjs with this very spec as the drift alarm. R145 made
    // drift STRUCTURALLY impossible: one module owns the regex, everyone
    // else imports it. A reappearing literal outside secret-slots.cjs is
    // the regression this test kills on sight.
    const km = read('electron/tools/key-migrate.cjs')
    const rx = /SECRET_SLOT_RE = (\/[^\n]+\/[a-z]*)/
    const shared = read('electron/tools/secret-slots.cjs')
    const def = shared.match(rx)
    assert.ok(def, 'secret-slots.cjs must DECLARE the regex literal')
    assert.ok(!rx.test(main), 'main.cjs must import the regex, never redeclare it')
    assert.ok(!rx.test(km), 'key-migrate.cjs must import the regex, never redeclare it')
    assert.ok(/require\(['"]\.\/tools\/secret-slots\.cjs['"]\)/.test(main), 'main.cjs must require secret-slots.cjs')
    assert.ok(/require\(['"]\.\/secret-slots\.cjs['"]\)/.test(km), 'key-migrate.cjs must require secret-slots.cjs')
    // Behavior pins survive from the §206.2 audit — the shape the whole
    // R139 line depends on: the GLOBAL slot (no suffix) must match.
    const re = new RegExp(def![1].slice(1, def![1].lastIndexOf('/')))
    assert.ok(re.test('AI_API_KEY'), 'global AI_API_KEY must qualify as a secret slot')
    assert.ok(re.test('AI_API_KEY_PLAN'))
    assert.ok(!re.test('AI_BASE_URL'), 'non-key slots stay unencrypted')
    assert.ok(re.test('TMCUT_GEMINI_API_KEY'), 'Gemini TTS key must use the encrypted secret slot')
  })
})

describe('TMCut AI key vault — page contract (R140)', () => {
  const page = read('app/pages/system/ai-keys.vue')

  it('stays READ-ONLY: the page never writes config', () => {
    assert.ok(!page.includes('setConfig'), 'vault page must not write config (single writer = AI connect panel)')
  })

  it('reads the vault through the typed IPC call only', () => {
    assert.ok(page.includes('window.electronAPI?.aiKeyStatus?.()'), 'page must fetch vault status via preload')
  })

  it('tests go through the task-aware listModels (saved-key path), never a typed key', () => {
    // R147 renamed the local to gatewayListModels (useHubAi also exports
    // listModels for the hub catalogue). The pinned CONTRACT is unchanged:
    // per-surface tests must flow through the gateway's saved-slot
    // resolution, whatever the local alias is called.
    assert.ok(page.includes('gatewayListModels(task === \'global\' ? {} : { task })'), 'tests must use saved-slot resolution')
    // R148: the R140-era rule "the page holds no field that could carry a
    // key" is GONE ON PURPOSE — the vault page now edits stored credentials
    // in place (the user's requirement for this page: the edit form used to
    // forget the stored name and base URL). The meaningful contract is the
    // one asserted right above: the saved-slot test path passes no key at
    // all. Page-level key handling is exercised by the credential-form tests
    // against the hub endpoint, not by a textual ban on a variable name.
  })

  it('the note names only places the AI panel ACTUALLY renders (no invented routes)', () => {
    // Honesty rule (§203 lineage): help text must match the shipped UI.
    // R148: the panel is mounted on AutoCut step 2 ONLY — the editor's AI
    // script dialog carries a MODEL CHOOSER instead (the user's requirement:
    // no connection form there, just the connected models plus a test). The
    // note may therefore send users to the vault itself and AutoCut, and must
    // not promise key editing on a surface that no longer has it.
    const autocut = read('app/pages/tmcut/autocut.vue')
    const scriptModal = read('app/components/tmcut/TmcutAiScriptModal.vue')
    assert.ok(autocut.includes('<TmcutAiConnect'), 'panel must stay mounted on AutoCut')
    assert.ok(!scriptModal.includes('<TmcutAiConnect'), 'the script dialog must not carry the connection form')
    assert.ok(scriptModal.includes('<TmcutAiModelPicker'), 'the script dialog must carry the connected-model chooser')
    const en = JSON.parse(read('i18n/locales/en.json'))
    const where = en.settings.aiKeysWhere1 as string
    assert.ok(/AutoCut step 2/.test(where), 'note must name the AutoCut surface')
    assert.ok(/only chooses among connected models/.test(where), 'the note must describe the dialog as a model chooser')
    assert.ok(!/or the editor's AI script dialog/.test(where), 'the old send-users-to-the-dialog wording must not come back')
    assert.ok(!/Settings\s*→\s*Connections/.test(where), 'no AI panel exists on any settings page')
  })

  it('the settings slideover links the vault ONLY where it works (Electron)', () => {
    // Honesty rule: never promise a desktop-only page to web users.
    const slideover = read('app/components/dashboard/SettingsSlideover.vue')
    assert.ok(/navigateAndClose\('\/system\/ai-keys'\)/.test(slideover), 'slideover must link the vault')
    assert.ok(/v-if=.isElectron.[\s\S]{0,400}navigateAndClose\(.\/system\/ai-keys.\)/.test(slideover), 'the vault link itself must be Electron-gated')
    // Hydration-safe: flag flips after mount, never during SSR render.
    assert.ok(/isElectron = ref\(false\)/.test(slideover), 'flag must start false (SSR-safe)')
    assert.ok(/onMounted\(\(\) => \{[\s\S]{0,80}isElectron\.value = !!window\.electronAPI\?\.isElectron/.test(slideover), 'flag set after mount only')
  })

  it('the nav route exists for every system-group sibling pattern (hub seed)', () => {
    // Cross-repo check: the sibling checkout exists on dev machines;
    // on an isolated tm-tools clone the seed lives in tm-hub and this
    // spec skips (contract is re-checked where the seed lives).
    let seed: string
    try {
      seed = readFileSync(join(ROOT, '..', 'tm-hub', 'scripts', 'seed', 'data.ts'), 'utf8')
    } catch {
      return
    }
    assert.ok(seed.includes('path: \'/system/ai-keys\''), 'hub seed must register the route')
    assert.ok(seed.includes('label: \'nav.ai_keys\''), 'route label key must match the i18n patch')
  })
})
