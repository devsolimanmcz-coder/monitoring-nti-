import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getApplicationDatabase, initializeApplicationDatabase } from './app-database.js'

const scrypt = promisify(scryptCallback)
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_LOCK_MS = 15 * 60 * 1000
const dataDirectory = path.resolve(process.env.APP_DATA_DIR || 'data')
const legacyUsersPath = path.join(dataDirectory, 'users.json')
const legacySessionsPath = path.join(dataDirectory, 'sessions.json')
const sessions = new Map()
const loginAttempts = new Map()
let users = []
let initialized = false
let userMutationQueue = Promise.resolve()

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

async function writeUserRecord(connection, user) {
  await connection.execute(
    `INSERT INTO app_users
      (user_id, username, password_salt, password_hash, role, dashboard_ids, disabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       password_salt = VALUES(password_salt),
       password_hash = VALUES(password_hash),
       role = VALUES(role),
       dashboard_ids = VALUES(dashboard_ids),
       disabled = VALUES(disabled),
       created_at = VALUES(created_at)`,
    [
      user.id,
      user.username,
      user.passwordSalt,
      user.passwordHash,
      user.role,
      JSON.stringify(user.dashboardIds),
      user.disabled ? 1 : 0,
      user.createdAt,
    ],
  )
}

async function persistUsers(records) {
  const database = getApplicationDatabase()
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    for (const user of records) {
      await writeUserRecord(connection, user)
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function persistUser(user, revokeSessions = false) {
  const database = getApplicationDatabase()
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    await writeUserRecord(connection, user)
    if (revokeSessions) {
      await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [user.id])
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function deletePersistedUser(userId) {
  const database = getApplicationDatabase()
  const connection = await database.getConnection()
  try {
    await connection.beginTransaction()
    await connection.execute('DELETE FROM app_users WHERE user_id = ?', [userId])
    await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [userId])
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

async function persistSession(tokenHash, session) {
  const database = getApplicationDatabase()
  await database.execute('DELETE FROM app_sessions WHERE expires_at <= ?', [Date.now()])
  await database.execute(
    `INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), expires_at = VALUES(expires_at)`,
    [tokenHash, session.userId, session.expiresAt],
  )
}

async function deletePersistedSessions(tokenHashes) {
  if (!tokenHashes.length) return
  const placeholders = tokenHashes.map(() => '?').join(', ')
  await getApplicationDatabase().execute(
    `DELETE FROM app_sessions WHERE token_hash IN (${placeholders})`,
    tokenHashes,
  )
}

async function deletePersistedUserSessions(userId) {
  await getApplicationDatabase().execute('DELETE FROM app_sessions WHERE user_id = ?', [userId])
}

function serializeUserMutation(operation) {
  const result = userMutationQueue.then(operation)
  userMutationQueue = result.catch(() => undefined)
  return result
}

export async function initializeAuthStore() {
  if (initialized) return
  await initializeApplicationDatabase()
  const database = getApplicationDatabase()
  const [userRows] = await database.query(
    `SELECT user_id, username, password_salt, password_hash, role,
            dashboard_ids, disabled, created_at
     FROM app_users ORDER BY username`,
  )
  if (userRows.length) {
    users = userRows.map((row) => ({
      id: row.user_id,
      username: row.username,
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
      role: row.role,
      dashboardIds: JSON.parse(row.dashboard_ids),
      disabled: Boolean(row.disabled),
      createdAt: row.created_at,
    }))
  } else {
    try {
      const contents = await readFile(legacyUsersPath, 'utf8')
      users = JSON.parse(contents)
      if (!Array.isArray(users) || users.some((user) => (
        typeof user.id !== 'string'
        || typeof user.username !== 'string'
        || typeof user.passwordSalt !== 'string'
        || typeof user.passwordHash !== 'string'
        || !['administrator', 'moderator', 'view'].includes(user.role)
        || !Array.isArray(user.dashboardIds)
      ))) {
        throw new Error('O arquivo de usuários contém dados inválidos.')
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      users = [{ ...bootstrapAdmin, dashboardIds: [] }]
    }
    await persistUsers(users)
  }
  if (!users.some((user) => user.role === 'administrator' && !user.disabled)) {
    throw new Error('É necessário manter pelo menos uma conta administradora ativa.')
  }

  const now = Date.now()
  await database.execute('DELETE FROM app_sessions WHERE expires_at <= ?', [now])
  const [sessionRows] = await database.execute(
    'SELECT token_hash, user_id, expires_at FROM app_sessions WHERE expires_at > ?',
    [now],
  )
  const invalidSessionHashes = []
  if (sessionRows.length) {
    for (const row of sessionRows) {
      const user = users.find((entry) => entry.id === row.user_id && !entry.disabled)
      if (!user) {
        invalidSessionHashes.push(row.token_hash)
        continue
      }
      sessions.set(row.token_hash, { userId: row.user_id, expiresAt: Number(row.expires_at) })
    }
    await deletePersistedSessions(invalidSessionHashes)
  } else {
    let loadedSessions = []
    try {
      loadedSessions = JSON.parse(await readFile(legacySessionsPath, 'utf8'))
      if (!Array.isArray(loadedSessions) || loadedSessions.some((session) => (
        typeof session.tokenHash !== 'string'
        || !/^[a-f0-9]{64}$/.test(session.tokenHash)
        || typeof session.userId !== 'string'
        || !Number.isFinite(session.expiresAt)
      ))) {
        throw new Error('O arquivo de sessões contém dados inválidos.')
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    for (const session of loadedSessions) {
      const user = users.find((entry) => entry.id === session.userId && !entry.disabled)
      if (!user || session.expiresAt <= Date.now()) continue
      sessions.set(session.tokenHash, { userId: session.userId, expiresAt: session.expiresAt })
    }
    if (sessions.size) {
      for (const [tokenHash, session] of sessions) {
        await persistSession(tokenHash, session)
      }
    }
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
  const tokenHash = hashSessionToken(token)
  const session = { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS }
  await persistSession(tokenHash, session)
  sessions.set(tokenHash, session)
  return { token, user: publicUser(user), expiresIn: SESSION_TTL_MS }
}

export function getAuthenticatedUser(token) {
  ensureInitialized()
  if (typeof token !== 'string') return null
  const tokenHash = hashSessionToken(token)
  const session = sessions.get(tokenHash)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash)
    return null
  }
  const user = users.find((entry) => entry.id === session.userId && !entry.disabled)
  if (!user) {
    sessions.delete(tokenHash)
    return null
  }
  return publicUser(user)
}

export async function revokeSession(token) {
  if (typeof token !== 'string') return
  const tokenHash = hashSessionToken(token)
  if (!sessions.has(tokenHash)) return
  await deletePersistedSessions([tokenHash])
  sessions.delete(tokenHash)
}

export async function revokeUserSessions(userId) {
  await deletePersistedUserSessions(userId)
  for (const [tokenHash, session] of sessions) {
    if (session.userId === userId) sessions.delete(tokenHash)
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
  return serializeUserMutation(async () => {
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
    await persistUser(user)
    const nextUsers = [...users, user]
    users = nextUsers
    return publicUser(user)
  })
}

export async function updateUser(userId, input, validDashboardIds) {
  return serializeUserMutation(async () => {
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
    const shouldRevokeSessions = next.disabled || Boolean(input.password)
    await persistUser(next, shouldRevokeSessions)
    users = nextUsers
    if (shouldRevokeSessions) {
      for (const [tokenHash, session] of sessions) {
        if (session.userId === next.id) sessions.delete(tokenHash)
      }
    }
    return publicUser(next)
  })
}

export async function deleteUser(userId, requesterId) {
  return serializeUserMutation(async () => {
    ensureInitialized()
    const target = users.find((user) => user.id === userId)
    if (!target) throw new Error('Usuário não encontrado.')
    if (target.id === requesterId) throw new Error('Não é permitido excluir a própria conta.')
    const remaining = users.filter((user) => user.id !== userId)
    if (!remaining.some((user) => user.role === 'administrator' && !user.disabled)) {
      throw new Error('É necessário manter pelo menos uma conta administradora ativa.')
    }
    await deletePersistedUser(userId)
    users = remaining
    for (const [tokenHash, session] of sessions) {
      if (session.userId === userId) sessions.delete(tokenHash)
    }
  })
}
