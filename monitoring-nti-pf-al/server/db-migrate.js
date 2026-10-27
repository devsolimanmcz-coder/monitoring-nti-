import 'dotenv/config'
import {
  closeApplicationDatabase,
  initializeApplicationDatabase,
} from './app-database.js'

try {
  await initializeApplicationDatabase()
  console.log('Migração concluída: tabelas da aplicação criadas ou já atualizadas.')
} catch (error) {
  console.error('Falha ao migrar o banco da aplicação:', error.message)
  process.exitCode = 1
} finally {
  await closeApplicationDatabase()
}
