import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const scrypt = promisify(scryptCallback)
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_LOCK_MS = 15 * 60 * 1000
const dataDirectory = path.resolve(process.env.APP_DATA_DIR || 'data')
const usersPath = path.join(dataDirectory, 'users.json')
const sessions = new Map()
const loginAttempts = new Map()
let users = []
let initialized = false
let writeQueue = Promise.resolve()

const bootstrapAdmin = {
  id: 'builtin-nti-admin',
  username: 'nti',
  passwordSalt: 'TlRJLVBVTFNFLVRFU1QtQURNSU4tMjAyNg',
  passwordHash: 'No5F4aqpKsyi8JJjoceZcToh3GmikH34qQzjlf0SOrtUAD2hQEqoROrCBqBUHgAFx8MnvSubc0WFMIl9sEkqqw',
  role: 'administrator',
  dashboardIds: [],
  disabled: false,
  createdAt: '2026-10-15T00:00:00.000Z',
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    dashboardIds: [...user.dashboardIds],
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
  }
}

async function persistUsers() {
  const operation = writeQueue.then(async () => {
    await mkdir(dataDirectory, { recursive: true })
    const tempPath = `${usersPath}.${randomBytes(8).toString('hex')}.tmp`
    await writeFile(tempPath, `${JSON.stringify(users, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, usersPath)
  })
  writeQueue = operation.catch(() => undefined)
  await operation
}

export async function initializeAuthStore() {
  if (initialized) return
  try {
    const contents = await readFile(usersPath, 'utf8')
    const loadedUsers = JSON.parse(contents)
    if (!Array.isArray(loadedUsers) || loadedUsers.some((user) => (
      typeof user.id !== 'string'
      || typeof user.username !== 'string'
      || typeof user.passwordSalt !== 'string'
      || typeof user.passwordHash !== 'string'
      || !['administrator', 'moderator', 'view'].includes(user.role)
      || !Array.isArray(user.dashboardIds)
    ))) {
      throw new Error('O arquivo de usuários contém dados inválidos.')
    }
    users = loadedUsers
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    users = [{ ...bootstrapAdmin, dashboardIds: [] }]
    await persistUsers()
  }
  if (!users.some((user) => user.role === 'administrator' && !user.disabled)) {
    throw new Error('É necessário manter pelo menos uma conta administradora ativa.')
  }
  initialized = true
}

function ensureInitialized() {
  if (!initialized) throw new Error('O serviço de autenticação ainda não foi inicializado.')
}

export async function authenticateUser(username, password, remoteAddress = 'unknown') {
  ensureInitialized()
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : ''
  const attemptKey = `${remoteAddress}:${normalizedUsername}`
  const attempt = loginAttempts.get(attemptKey)
  if (attempt && attempt.lockedUntil > Date.now()) {
    throw new Error('Muitas tentativas. Aguarde 15 minutos e tente novamente.')
  }

  const user = users.find((entry) => entry.username === normalizedUsername)
  const salt = user ? Buffer.from(user.passwordSalt, 'base64url') : randomBytes(16)
  const expectedHash = user ? Buffer.from(user.passwordHash, 'base64url') : Buffer.alloc(64)
  const candidateHash = await scrypt(typeof password === 'string' ? password : '', salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  const valid = timingSafeEqual(expectedHash, candidateHash)
  if (!user || !valid || user.disabled) {
    const failures = (attempt?.failures || 0) + 1
    loginAttempts.set(attemptKey, {
      failures,
      lockedUntil: failures >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOGIN_LOCK_MS : 0,
    })
    throw new Error('Usuário ou senha inválidos.')
  }
  loginAttempts.delete(attemptKey)

  const token = randomBytes(32).toString('base64url')
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS })
  return { token, user: publicUser(user), expiresIn: SESSION_TTL_MS }
}

export function getAuthenticatedUser(token) {
  ensureInitialized()
  if (typeof token !== 'string') return null
  const session = sessions.get(token)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  const user = users.find((entry) => entry.id === session.userId && !entry.disabled)
  if (!user) {
    sessions.delete(token)
    return null
  }
  return publicUser(user)
}

export function revokeSession(token) {
  if (typeof token === 'string') sessions.delete(token)
}

export function revokeUserSessions(userId) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token)
  }
}

export function listUsers() {
  ensureInitialized()
  return users.map(publicUser).sort((a, b) => a.username.localeCompare(b.username))
}

function validateDashboardIds(dashboardIds, validDashboardIds) {
  if (!Array.isArray(dashboardIds) || dashboardIds.some((id) => (
    typeof id !== 'string' || !validDashboardIds.has(id)
  ))) {
    throw new Error('Atribua apenas painéis existentes ao usuário.')
  }
  return [...new Set(dashboardIds)]
}

export async function addUser(input, validDashboardIds) {
  ensureInitialized()
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Use um usuário de 3 a 40 caracteres (letras, números, ponto, _ ou -).')
  if (users.some((user) => user.username === username)) throw new Error('Esse usuário já existe.')
  if (password.length < 12 || password.length > 200) throw new Error('A senha precisa ter entre 12 e 200 caracteres.')
  if (!['administrator', 'moderator', 'view'].includes(input.role)) throw new Error('Grupo de acesso inválido.')
  const salt = randomBytes(16)
  const passwordHash = await scrypt(password, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  const user = {
    id: randomBytes(18).toString('base64url'),
    username,
    passwordSalt: salt.toString('base64url'),
    passwordHash: passwordHash.toString('base64url'),
    role: input.role,
    dashboardIds: input.role === 'view'
      ? validateDashboardIds(input.dashboardIds || [], validDashboardIds)
      : [],
    disabled: false,
    createdAt: new Date().toISOString(),
  }
  users = [...users, user]
  await persistUsers()
  return publicUser(user)
}

export async function updateUser(userId, input, validDashboardIds) {
  ensureInitialized()
  const index = users.findIndex((user) => user.id === userId)
  if (index < 0) throw new Error('Usuário não encontrado.')
  const current = users[index]
  const role = input.role ?? current.role
  if (!['administrator', 'moderator', 'view'].includes(role)) throw new Error('Grupo de acesso inválido.')
  if (current.id === input.requesterId && (role !== 'administrator' || input.disabled === true)) {
    throw new Error('Não é permitido remover o próprio acesso de administrador.')
  }
  const next = {
    ...current,
    role,
    dashboardIds: role === 'view'
      ? validateDashboardIds(input.dashboardIds ?? current.dashboardIds, validDashboardIds)
      : [],
    disabled: input.disabled === undefined ? current.disabled : Boolean(input.disabled),
  }
  if (input.password !== undefined && input.password !== '') {
    if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 200) {
      throw new Error('A nova senha precisa ter entre 12 e 200 caracteres.')
    }
    const salt = randomBytes(16)
    const passwordHash = await scrypt(input.password, salt, 64, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    })
    next.passwordSalt = salt.toString('base64url')
    next.passwordHash = passwordHash.toString('base64url')
  }
  const nextUsers = [...users]
  nextUsers[index] = next
  if (!nextUsers.some((user) => user.role === 'administrator' && !user.disabled)) {
    throw new Error('É necessário manter pelo menos uma conta administradora ativa.')
  }
  users = nextUsers
  await persistUsers()
  if (next.disabled || input.password) revokeUserSessions(next.id)
  return publicUser(next)
}

export async function deleteUser(userId, requesterId) {
  ensureInitialized()
  const target = users.find((user) => user.id === userId)
  if (!target) throw new Error('Usuário não encontrado.')
  if (target.id === requesterId) throw new Error('Não é permitido excluir a própria conta.')
  const remaining = users.filter((user) => user.id !== userId)
  if (!remaining.some((user) => user.role === 'administrator' && !user.disabled)) {
    throw new Error('É necessário manter pelo menos uma conta administradora ativa.')
  }
  users = remaining
  await persistUsers()
  revokeUserSessions(userId)
}
