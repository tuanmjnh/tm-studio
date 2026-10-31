import assert from 'node:assert/strict'
import { runMigrations } from '../../electron/src/infrastructure/database/migrator'
import { closeDatabase } from '../../electron/src/infrastructure/database/connection'
import { CamoufoxAdapter } from '../../electron/src/infrastructure/adapters/browser/CamoufoxAdapter'
import { DonutAdapter } from '../../electron/src/infrastructure/adapters/browser/DonutAdapter'
import { BrowserOxideAdapter } from '../../electron/src/infrastructure/adapters/browser/BrowserOxideAdapter'
import { StealthHelper } from '../../electron/src/infrastructure/adapters/automation/StealthHelper'
import { BrowserManager } from '../../electron/src/modules/browser/BrowserManager'

async function runMilestone2AdaptersTests(): Promise<void> {
  console.log('=== [Milestone 2 Adapters Extension Test Suite] Starting tests ===\n')

  // Run migrations if needed
  runMigrations()

  // 1. Test Camoufox Adapter
  console.log('1. Testing CamoufoxAdapter...')
  const camoufox = new CamoufoxAdapter()
  assert.equal(camoufox.engine, 'camoufox')
  assert.equal(camoufox.name, 'Camoufox Anti-detect Browser')
  const camoufoxCaps = camoufox.supports()
  assert.equal(camoufoxCaps.cdp, true)
  assert.equal(camoufoxCaps.extensions, true)
  assert.equal(camoufoxCaps.headless, true)
  console.log('   CamoufoxAdapter capability test PASSED.')

  // 2. Test Donut Adapter
  console.log('2. Testing DonutAdapter...')
  const donut = new DonutAdapter()
  assert.equal(donut.engine, 'donut')
  assert.equal(donut.name, 'Donut Browser')
  const donutCaps = donut.supports()
  assert.equal(donutCaps.cdp, true)
  assert.equal(donutCaps.extensions, true)
  assert.equal(donutCaps.incognito, true)
  console.log('   DonutAdapter capability test PASSED.')

  // 3. Test BrowserOxide Adapter
  console.log('3. Testing BrowserOxideAdapter...')
  const oxide = new BrowserOxideAdapter()
  assert.equal(oxide.engine, 'browser_oxide')
  assert.equal(oxide.name, 'Browser Oxide (Rust Engine)')
  const oxideCaps = oxide.supports()
  assert.equal(oxideCaps.cdp, true)
  assert.equal(oxideCaps.extensions, true)
  assert.equal(oxideCaps.headless, true)
  console.log('   BrowserOxideAdapter capability test PASSED.')

  // 4. Test BrowserManager Adapter Registration & Retrieval
  console.log('4. Testing BrowserManager Engine Resolution...')
  const manager = BrowserManager.getInstance()
  assert.equal(manager.getAdapter('camoufox').engine, 'camoufox')
  assert.equal(manager.getAdapter('donut').engine, 'donut')
  assert.equal(manager.getAdapter('browser_oxide').engine, 'browser_oxide')
  assert.equal(manager.getAdapter('chromium').engine, 'chromium')
  assert.equal(manager.getAdapter('firefox').engine, 'firefox')
  assert.equal(manager.getAdapter('custom').engine, 'custom')
  console.log('   BrowserManager Engine Resolution test PASSED.')

  // 5. Test StealthHelper Script Generation
  console.log('5. Testing StealthHelper...')
  const mockProfile = {
    screenResolution: '1920x1080',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    languages: 'en-US,en',
    canvasMode: 'noise',
    audioMode: 'noise',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'
  }

  const script = StealthHelper.generateStealthScript(mockProfile)
  assert.ok(script.length > 500, 'Stealth script should be non-trivial')
  assert.ok(script.includes('navigator, \'webdriver\''), 'Should mask navigator.webdriver')
  assert.ok(script.includes('window.chrome'), 'Should mock window.chrome')
  assert.ok(script.includes('HTMLCanvasElement.prototype.toDataURL'), 'Should inject canvas noise')
  assert.ok(script.includes('WebGLRenderingContext.prototype.getParameter'), 'Should spoof WebGL parameters')
  assert.ok(script.includes('Google Inc. (NVIDIA)'), 'Should contain target WebGL vendor')
  console.log('   StealthHelper test PASSED.')

  // Clean up
  closeDatabase()
  console.log('\n=== All Milestone 2 Specialized Adapters Tests PASSED! ===')
}

runMilestone2AdaptersTests().catch((err) => {
  console.error('Test failed with error:', err)
  process.exit(1)
})
