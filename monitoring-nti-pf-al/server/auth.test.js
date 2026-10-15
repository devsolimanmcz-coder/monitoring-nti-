import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'monitoring-auth-'))
process.env.APP_DATA_DIR = temporaryDirectory
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

test('restores sessions after a server restart without storing raw tokens', async () => {
  const session = await authenticateUser('nti', 'ntim4ster', '127.0.0.4')
  const records = await readFile(path.join(temporaryDirectory, 'sessions.json'), 'utf8')
  assert.equal(records.includes(session.token), false)

  const childCode = `
    const auth = await import(${JSON.stringify(new URL('./auth.js', import.meta.url).href)})
    await auth.initializeAuthStore()
    console.log(JSON.stringify(auth.getAuthenticatedUser(${JSON.stringify(session.token)})))
  `
  const restored = spawnSync(process.execPath, ['--input-type=module', '-e', childCode], {
    encoding: 'utf8',
    env: { ...process.env, APP_DATA_DIR: temporaryDirectory },
  })
  assert.equal(restored.status, 0, restored.stderr)
  assert.equal(JSON.parse(restored.stdout).username, 'nti')

  const { revokeSession } = await import('./auth.js')
  await revokeSession(session.token)
  const afterLogout = spawnSync(process.execPath, ['--input-type=module', '-e', childCode], {
    encoding: 'utf8',
    env: { ...process.env, APP_DATA_DIR: temporaryDirectory },
  })
  assert.equal(afterLogout.status, 0, afterLogout.stderr)
  assert.equal(JSON.parse(afterLogout.stdout), null)
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
