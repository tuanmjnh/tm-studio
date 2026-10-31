import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { StorageManager } from '../../electron/src/infrastructure/storage/StorageManager'
import { getDatabase, closeDatabase, getSqlite } from '../../electron/src/infrastructure/database/connection'
import { runMigrations } from '../../electron/src/infrastructure/database/migrator'
import { EventBus } from '../../electron/src/core/EventBus'
import { Logger } from '../../electron/src/core/Logger'
import { OpenDirectoryInputSchema, StorageUsageSchema } from '../../shared/contracts/system.ipc'
import { ok, fail } from '../../shared/contracts/common'
import { eq } from 'drizzle-orm'
import { profileGroups } from '../../electron/src/infrastructure/database/schema/groups'

async function runMilestone1Tests(): Promise<void> {
  console.log('=== [Milestone 1 Test Suite] Starting tests ===\n')

  // 1. Test StorageManager
  console.log('1. Testing StorageManager...')
  const storage = StorageManager.getInstance()
  assert.ok(storage, 'StorageManager instance should exist')
  assert.ok(fs.existsSync(storage.getRootPath()), 'Root userData path should exist')
  assert.ok(fs.existsSync(storage.getDatabasePath()), 'Database path should exist')
  assert.ok(fs.existsSync(storage.getProfilesPath()), 'Profiles path should exist')
  assert.ok(fs.existsSync(storage.getLogsPath()), 'Logs path should exist')
  assert.ok(fs.existsSync(storage.getTempPath()), 'Temp path should exist')

  const profileDir = storage.getProfileStoragePath('test-profile-uuid')
  assert.ok(fs.existsSync(profileDir), 'Profile storage dir should be created on demand')
  fs.rmSync(profileDir, { recursive: true, force: true })

  const usage = storage.getStorageUsage()
  const parsedUsage = StorageUsageSchema.safeParse(usage)
  assert.ok(parsedUsage.success, 'Storage usage must match StorageUsageSchema')
  console.log('   StorageManager test PASSED.')

  // 2. Test SQLite + Drizzle ORM + Migrations
  console.log('2. Testing Database connection and migrations...')
  runMigrations()
  const db = getDatabase()
  assert.ok(db, 'Drizzle db instance should exist')

  const sqlite = getSqlite()
  const tables = sqlite.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all() as { name: string }[]
  const tableNames = tables.map(t => t.name)
  console.log('   Created tables in SQLite:', tableNames.filter(n => !n.startsWith('__')).join(', '))

  assert.ok(tableNames.includes('profiles'), 'Table "profiles" should exist')
  assert.ok(tableNames.includes('browsers'), 'Table "browsers" should exist')
  assert.ok(tableNames.includes('proxies'), 'Table "proxies" should exist')
  assert.ok(tableNames.includes('profile_groups'), 'Table "profile_groups" should exist')
  assert.ok(tableNames.includes('tags'), 'Table "tags" should exist')
  assert.ok(tableNames.includes('tasks'), 'Table "tasks" should exist')
  assert.ok(tableNames.includes('workflows'), 'Table "workflows" should exist')

  // Insert & select test with Drizzle
  const testId = 'test-group-' + Date.now()
  db.insert(profileGroups).values({
    id: testId,
    name: 'Test Group',
    color: '#3b82f6',
    createdAt: new Date(),
    updatedAt: new Date()
  }).run()

  const inserted = db.select().from(profileGroups).where(eq(profileGroups.id, testId)).get()
  assert.ok(inserted, 'Should retrieve inserted group')
  assert.equal(inserted?.name, 'Test Group')

  // Cleanup test row
  sqlite.prepare('DELETE FROM profile_groups WHERE id = ?').run(testId)
  console.log('   Database & Drizzle test PASSED.')

  // 3. Test EventBus
  console.log('3. Testing EventBus...')
  const eventBus = EventBus.getInstance()
  let eventReceived = false
  const listener = (payload: { profileId: string, pid: number, startedAt: number }) => {
    assert.equal(payload.profileId, 'p-123')
    assert.equal(payload.pid, 9999)
    eventReceived = true
  }

  eventBus.onDomain('profile:started', listener)
  eventBus.emitDomain('profile:started', {
    profileId: 'p-123',
    pid: 9999,
    startedAt: Date.now()
  })
  assert.ok(eventReceived, 'EventBus listener should have received the event')
  eventBus.offDomain('profile:started', listener)
  console.log('   EventBus test PASSED.')

  // 4. Test Logger
  console.log('4. Testing Logger...')
  const logger = Logger.getInstance()
  logger.info('Test', 'Milestone 1 test log entry')
  const logFile = path.join(storage.getLogsPath(), 'app.log')
  assert.ok(fs.existsSync(logFile), 'app.log file should exist')
  const logContent = fs.readFileSync(logFile, 'utf8')
  assert.ok(logContent.includes('Milestone 1 test log entry'), 'Log file should contain test entry')
  console.log('   Logger test PASSED.')

  // 5. Test Zod Contracts & Envelope
  console.log('5. Testing Shared Contracts & Validation...')
  const validOk = ok({ foo: 'bar' })
  assert.equal(validOk.success, true)
  assert.equal(validOk.data?.foo, 'bar')

  const validFail = fail('TEST_ERROR', 'Something failed')
  assert.equal(validFail.success, false)
  assert.equal(validFail.error?.code, 'TEST_ERROR')

  const validDir = OpenDirectoryInputSchema.safeParse({ pathType: 'profiles' })
  assert.ok(validDir.success, 'Valid OpenDirectoryInput should parse successfully')

  const invalidDir = OpenDirectoryInputSchema.safeParse({ pathType: 'non_existent_type' })
  assert.ok(!invalidDir.success, 'Invalid OpenDirectoryInput must be rejected by Zod')
  console.log('   Contracts & Validation test PASSED.')

  closeDatabase()
  console.log('\n=== [Milestone 1 Test Suite] ALL TESTS PASSED! ===')
}

runMilestone1Tests().catch((err) => {
  console.error('\n❌ Test Suite FAILED:', err)
  process.exit(1)
})
