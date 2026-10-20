export function createTestDatabase() {
  let state = { config: null, users: [], sessions: [] }
  let dashboardUpserts = 0

  function cloneState(value) {
    return structuredClone(value)
  }

  function run(query, values = [], target = state) {
    const sql = query.replace(/\s+/g, ' ').trim().toLowerCase()
    if (sql.startsWith('select payload from app_dashboard_config')) {
      return [[...(target.config === null ? [] : [{ payload: target.config }])]]
    }
    if (sql.startsWith('insert ignore into app_dashboard_config')) {
      if (target.config === null) target.config = values[0]
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('insert into app_dashboard_config')) {
      dashboardUpserts += 1
      target.config = values[0]
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('select user_id, username, password_salt')) {
      return [cloneState(target.users)]
    }
    if (sql.startsWith('select token_hash, user_id, expires_at from app_sessions')) {
      if (sql.includes('where expires_at > ?')) {
        return [cloneState(target.sessions.filter((session) => session.expires_at > values[0]))]
      }
      return [cloneState(target.sessions)]
    }
    if (sql.startsWith('delete from app_users')) {
      if (sql.includes('where user_id = ?')) {
        target.users = target.users.filter((user) => user.user_id !== values[0])
      } else {
        target.users = []
      }
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('delete from app_sessions')) {
      if (sql.includes('where user_id = ?')) {
        target.sessions = target.sessions.filter((session) => session.user_id !== values[0])
      } else if (sql.includes('where token_hash in')) {
        const tokenHashes = new Set(values)
        target.sessions = target.sessions.filter((session) => !tokenHashes.has(session.token_hash))
      } else if (sql.includes('where expires_at <= ?')) {
        target.sessions = target.sessions.filter((session) => session.expires_at > values[0])
      } else {
        target.sessions = []
      }
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('insert into app_users')) {
      const [user_id, username, password_salt, password_hash, role, dashboard_ids, disabled, created_at] = values
      const user = {
        user_id,
        username,
        password_salt,
        password_hash,
        role,
        dashboard_ids,
        disabled,
        created_at,
      }
      const existingIndex = target.users.findIndex((record) => (
        record.user_id === user_id || record.username === username
      ))
      if (existingIndex === -1) target.users.push(user)
      else target.users[existingIndex] = user
      return [{ affectedRows: 1 }]
    }
    if (sql.startsWith('insert into app_sessions')) {
      const [token_hash, user_id, expires_at] = values
      const existingIndex = target.sessions.findIndex((record) => record.token_hash === token_hash)
      const session = { token_hash, user_id, expires_at }
      if (existingIndex === -1) target.sessions.push(session)
      else target.sessions[existingIndex] = session
      return [{ affectedRows: 1 }]
    }
    throw new Error(`SQL não prevista no banco de teste: ${query}`)
  }

  return {
    async query(query, values) {
      return run(query, values)
    },
    async execute(query, values) {
      return run(query, values)
    },
    async getConnection() {
      let transaction
      return {
        async beginTransaction() {
          transaction = cloneState(state)
        },
        async query(query, values) {
          return run(query, values, transaction)
        },
        async execute(query, values) {
          return run(query, values, transaction)
        },
        async commit() {
          state = transaction
        },
        async rollback() {
          transaction = undefined
        },
        release() {},
      }
    },
    async end() {},
    getDashboardUpsertCount() {
      return dashboardUpserts
    },
  }
}
