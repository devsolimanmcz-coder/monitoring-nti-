import mysql from 'mysql2/promise'

let pool
let schemaPromise

export function getApplicationDatabase() {
  if (pool) return pool

  const required = ['APP_DB_NAME', 'APP_DB_USER', 'APP_DB_PASSWORD']
  const missing = required.filter((key) => !process.env[key])
  if (missing.length) {
    throw new Error(`Configuração ausente no .env para o banco da aplicação: ${missing.join(', ')}`)
  }

  pool = mysql.createPool({
    host: process.env.APP_DB_HOST || '127.0.0.1',
    port: Number(process.env.APP_DB_PORT || 3306),
    database: process.env.APP_DB_NAME,
    user: process.env.APP_DB_USER,
    password: process.env.APP_DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: Number(process.env.APP_DB_CONNECTION_LIMIT || 5),
    maxIdle: 2,
    idleTimeout: 60_000,
    queueLimit: 20,
    enableKeepAlive: true,
    decimalNumbers: true,
  })
  return pool
}

export function setApplicationDatabaseForTests(database) {
  pool = database
  schemaPromise = Promise.resolve()
}

export async function initializeApplicationDatabase() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const database = getApplicationDatabase()
      await database.query(`
        CREATE TABLE IF NOT EXISTS app_dashboard_config (
          config_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
          payload LONGTEXT NOT NULL
        ) ENGINE=InnoDB
      `)
      await database.query(`
        CREATE TABLE IF NOT EXISTS app_users (
          user_id VARCHAR(128) NOT NULL PRIMARY KEY,
          username VARCHAR(40) NOT NULL UNIQUE,
          password_salt VARCHAR(128) NOT NULL,
          password_hash VARCHAR(128) NOT NULL,
          role VARCHAR(32) NOT NULL,
          dashboard_ids LONGTEXT NOT NULL,
          disabled TINYINT(1) NOT NULL DEFAULT 0,
          created_at VARCHAR(40) NOT NULL
        ) ENGINE=InnoDB
      `)
      await database.query(`
        CREATE TABLE IF NOT EXISTS app_sessions (
          token_hash CHAR(64) NOT NULL PRIMARY KEY,
          user_id VARCHAR(128) NOT NULL,
          expires_at BIGINT NOT NULL,
          INDEX app_sessions_user_id (user_id),
          INDEX app_sessions_expires_at (expires_at)
        ) ENGINE=InnoDB
      `)
    })().catch((error) => {
      schemaPromise = undefined
      throw error
    })
  }
  await schemaPromise
}

export async function closeApplicationDatabase() {
  if (pool) {
    const currentPool = pool
    pool = undefined
    schemaPromise = undefined
    await currentPool.end()
  }
}
