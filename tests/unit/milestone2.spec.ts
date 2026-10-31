import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { runMigrations } from '../../electron/src/infrastructure/database/migrator'
import { closeDatabase } from '../../electron/src/infrastructure/database/connection'
import { ChromiumBrowserAdapter } from '../../electron/src/infrastructure/adapters/browser/ChromiumAdapter'
import { FirefoxBrowserAdapter } from '../../electron/src/infrastructure/adapters/browser/FirefoxAdapter'
import { CustomBrowserAdapter } from '../../electron/src/infrastructure/adapters/browser/CustomAdapter'
import { BrowserRepository } from '../../electron/src/modules/browser/BrowserRepository'
import { BrowserManager } from '../../electron/src/modules/browser/BrowserManager'
import { BrowserProcessManager } from '../../electron/src/modules/browser/BrowserProcessManager'
import { EventBus } from '../../electron/src/core/EventBus'
import {
  AddCustomBrowserInputSchema,
  TestExecutableInputSchema
} from '../../shared/contracts/browser.ipc'
import type { BrowserProcess } from '../../electron/src/domain/browser/BrowserProcess'

async function runMilestone2Tests(): Promise<void> {
  console.log('=== [Milestone 2 Test Suite] Starting tests ===\n')

  // Ensure database is migrated
  runMigrations()

  // 1. Test Browser Adapters capabilities & instances
  console.log('1. Testing Browser Adapters...')
  const chromiumAdapter = new ChromiumBrowserAdapter()
  const firefoxAdapter = new FirefoxBrowserAdapter()
  const customAdapter = new CustomBrowserAdapter()

  assert.equal(chromiumAdapter.engine, 'chromium')
  assert.equal(chromiumAdapter.supports().cdp, true)
  assert.equal(firefoxAdapter.engine, 'firefox')
  assert.equal(firefoxAdapter.supports().cdp, false)
  assert.equal(customAdapter.engine, 'custom')

  // Run detection on adapter
  const detectedChromium = await chromiumAdapter.detect()
  console.log(`   Detected ${detectedChromium.length} Chromium-based browsers:`, detectedChromium.map(d => `${d.name} (v${d.version})`).join(', ') || 'none')
  console.log('   Browser Adapters test PASSED.')

  // 2. Test BrowserRepository
  console.log('2. Testing BrowserRepository...')
  const repo = BrowserRepository.getInstance()
  const testBrowserId = 'test-browser-' + Date.now()

  const created = repo.create({
    id: testBrowserId,
    name: 'Unit Test Chrome',
    engine: 'chromium',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    version: '130.0.0.0',
    isDefault: false,
    isCustom: true,
    status: 'available',
    createdAt: new Date(),
    updatedAt: new Date()
  })

  assert.equal(created.id, testBrowserId)
  assert.equal(created.name, 'Unit Test Chrome')

  const found = repo.findById(testBrowserId)
  assert.ok(found, 'Should find browser by ID')
  assert.equal(found?.version, '130.0.0.0')

  repo.update(testBrowserId, { version: '131.0.0.0' })
  const updated = repo.findById(testBrowserId)
  assert.equal(updated?.version, '131.0.0.0')

  repo.setDefault(testBrowserId)
  const defaultBrowser = repo.findDefault()
  assert.equal(defaultBrowser?.id, testBrowserId)

  repo.delete(testBrowserId)
  const deleted = repo.findById(testBrowserId)
  assert.equal(deleted, undefined, 'Browser should be deleted')
  console.log('   BrowserRepository test PASSED.')

  // 3. Test BrowserManager detection & management
  console.log('3. Testing BrowserManager...')
  const browserManager = BrowserManager.getInstance()
  const browsers = await browserManager.detectBrowsers()
  console.log(`   BrowserManager detected ${browsers.length} installed browsers in system:`, browsers.map(b => `${b.name} (${b.engine})`).join(', ') || 'none')

  const list = browserManager.listBrowsers()
  assert.ok(Array.isArray(list), 'List of browsers should be an array')

  // Test executable validator
  const testRes = await browserManager.testExecutable('C:\\non_existent_file_xyz.exe')
  assert.equal(testRes.valid, false, 'Non-existent file should be invalid')
  console.log('   BrowserManager test PASSED.')

  // 4. Test BrowserProcessManager lifecycle & EventBus integration
  console.log('4. Testing BrowserProcessManager & Events...')
  const processManager = BrowserProcessManager.getInstance()
  const eventBus = EventBus.getInstance()

  let startedEventReceived = false
  let stoppedEventReceived = false

  const onProfileStarted = (payload: { profileId: string, pid: number }) => {
    if (payload.profileId === 'mock-profile-1') {
      startedEventReceived = true
    }
  }

  const onProfileStopped = (payload: { profileId: string }) => {
    if (payload.profileId === 'mock-profile-1') {
      stoppedEventReceived = true
    }
  }

  eventBus.onDomain('profile:started', onProfileStarted)
  eventBus.onDomain('profile:stopped', onProfileStopped)

  // Create mock ChildProcess
  const mockEmitter = new EventEmitter()
  const mockChild = Object.assign(mockEmitter, {
    pid: 88888,
    kill: () => {
      mockEmitter.emit('exit', 0, null)
      return true
    }
  }) as unknown as import('node:child_process').ChildProcess

  const mockProcess: BrowserProcess = {
    pid: 88888,
    profileId: 'mock-profile-1',
    browserId: 'b-mock',
    engine: 'chromium',
    startedAt: new Date(),
    process: mockChild,
    userDataDir: 'C:\\fake\\user\\data'
  }

  processManager.registerProcess(mockProcess)
  assert.ok(processManager.isProfileRunning('mock-profile-1'), 'Profile should be marked running')
  assert.equal(processManager.getRunningProcess('mock-profile-1')?.pid, 88888)
  assert.equal(processManager.getProcessByPid(88888)?.profileId, 'mock-profile-1')
  assert.ok(startedEventReceived, 'Event profile:started should be fired')

  // Simulate process exit
  mockChild.emit('exit', 0, null)
  assert.equal(processManager.isProfileRunning('mock-profile-1'), false, 'Profile should no longer be running after exit')
  assert.ok(stoppedEventReceived, 'Event profile:stopped should be fired')

  eventBus.offDomain('profile:started', onProfileStarted)
  eventBus.offDomain('profile:stopped', onProfileStopped)
  console.log('   BrowserProcessManager test PASSED.')

  // 5. Test Zod Schemas
  console.log('5. Testing Zod Schemas for Browser IPC...')
  const validAdd = AddCustomBrowserInputSchema.safeParse({
    name: 'Custom Ungoogled Chromium',
    engine: 'chromium',
    executablePath: 'C:\\Tools\\ungoogled.exe'
  })
  assert.ok(validAdd.success, 'Valid custom browser input must pass')

  const invalidAdd = AddCustomBrowserInputSchema.safeParse({
    name: '',
    engine: 'unknown_engine',
    executablePath: ''
  })
  assert.ok(!invalidAdd.success, 'Invalid input must be rejected')

  const validTest = TestExecutableInputSchema.safeParse({
    executablePath: 'C:\\test.exe'
  })
  assert.ok(validTest.success)
  console.log('   Zod Schemas test PASSED.')

  closeDatabase()
  console.log('\n=== [Milestone 2 Test Suite] ALL TESTS PASSED! ===')
}

runMilestone2Tests().catch((err) => {
  console.error('\n❌ Milestone 2 Test Suite FAILED:', err)
  process.exit(1)
})
