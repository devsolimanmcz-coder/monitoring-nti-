import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTestDatabase } from './test-database.js'

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'monitoring-auth-'))
process.env.APP_DATA_DIR = temporaryDirectory
const testDatabase = createTestDatabase()
const { setApplicationDatabaseForTests } = await import('./app-database.js')
setApplicationDatabaseForTests(testDatabase)
const {
  addUser,
  authenticateUser,
  deleteUser,
  getAuthenticatedUser,
  initializeAuthStore,
  listUsers,
  updateUser,
} = await import('./auth.js')

await initializeAuthStore()

after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true })
})

test('bootstraps a test administrator and authenticates with a revocable session', async () => {
  const session = await authenticateUser('NTI', 'ntim4ster', '127.0.0.1')
  assert.equal(session.user.username, 'nti')
  assert.equal(session.user.role, 'administrator')
  assert.equal(getAuthenticatedUser(session.token).id, session.user.id)

  await assert.rejects(authenticateUser('nti', 'wrong-password', '127.0.0.2'), /Usuário ou senha inválidos/)
})

test('persists session hashes without storing raw tokens', async () => {
  const [beforeLogin] = await testDatabase.query(
    'SELECT token_hash, user_id, expires_at FROM app_sessions',
  )
  const session = await authenticateUser('nti', 'ntim4ster', '127.0.0.4')
  const [records] = await testDatabase.query(
    'SELECT token_hash, user_id, expires_at FROM app_sessions',
  )
  assert.equal(records.length, beforeLogin.length + 1)
  assert.equal(records.some((record) => record.token_hash === session.token), false)
  assert.equal(getAuthenticatedUser(session.token).username, 'nti')

  const { revokeSession } = await import('./auth.js')
  await revokeSession(session.token)
  const [afterLogout] = await testDatabase.query(
    'SELECT token_hash, user_id, expires_at FROM app_sessions',
  )
  assert.equal(afterLogout.length, beforeLogin.length)
})

test('does not lose accounts created concurrently', async () => {
  const validDashboardIds = new Set()
  await Promise.all([
    addUser({ username: 'parallel-one', password: 'senha-paralela-123', role: 'moderator' }, validDashboardIds),
    addUser({ username: 'parallel-two', password: 'senha-paralela-456', role: 'moderator' }, validDashboardIds),
  ])

  assert.equal(listUsers().some((user) => user.username === 'parallel-one'), true)
  assert.equal(listUsers().some((user) => user.username === 'parallel-two'), true)
})

test('manages viewer access, validates password strength, and revokes disabled accounts', async () => {
  const validDashboardIds = new Set(['network-dashboard', 'ops-dashboard'])
  await assert.rejects(addUser({
    username: 'viewer',
    password: 'short',
    role: 'view',
    dashboardIds: ['network-dashboard'],
  }, validDashboardIds), /12 e 200 caracteres/)

  const viewer = await addUser({
    username: 'viewer',
    password: 'segura-senha-123',
    role: 'view',
    dashboardIds: ['network-dashboard'],
  }, validDashboardIds)
  assert.deepEqual(viewer.dashboardIds, ['network-dashboard'])
  await assert.rejects(addUser({
    username: 'unassigned',
    password: 'segura-senha-123',
    role: 'view',
    dashboardIds: ['unknown-dashboard'],
  }, validDashboardIds), /Atribua apenas painéis existentes/)

  const session = await authenticateUser('viewer', 'segura-senha-123', '127.0.0.3')
  const updated = await updateUser(viewer.id, { disabled: true }, validDashboardIds)
  assert.equal(updated.disabled, true)
  assert.equal(getAuthenticatedUser(session.token), null)
  const [remainingSessions] = await testDatabase.query(
    'SELECT token_hash, user_id, expires_at FROM app_sessions',
  )
  assert.equal(remainingSessions.some((record) => record.user_id === viewer.id), false)
  assert.equal(listUsers().some((user) => user.username === 'viewer'), true)
  await deleteUser(viewer.id, 'builtin-nti-admin')
  assert.equal(listUsers().some((user) => user.username === 'viewer'), false)
})

test('prevents an administrator from removing their own access or the final admin', async () => {
  await assert.rejects(updateUser('builtin-nti-admin', {
    role: 'moderator',
    requesterId: 'builtin-nti-admin',
  }, new Set()), /próprio acesso/)
  await assert.rejects(deleteUser('builtin-nti-admin', 'another-admin'), /pelo menos uma conta administradora/)
})
