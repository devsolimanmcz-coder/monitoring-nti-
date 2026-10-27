import 'dotenv/config'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { closeApplicationDatabase } from './app-database.js'
import { createInitialAdmin } from './auth.js'

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Este comando precisa ser executado em um terminal interativo.')
  }

  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  stdin.resume()

  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (error) => {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
      stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') {
          finish(new Error('Operação cancelada.'))
          return
        }
        if (character === '\r' || character === '\n') {
          finish()
          return
        }
        if (character === '\u0008' || character === '\u007f') {
          value = [...value].slice(0, -1).join('')
          continue
        }
        if (character >= ' ') value += character
      }
    }
    stdin.on('data', onData)
  })
}

const prompt = readline.createInterface({ input: stdin, output: stdout })

try {
  if (!stdin.isTTY) {
    throw new Error('Este comando precisa ser executado em um terminal interativo.')
  }
  const username = await prompt.question('Usuário do administrador: ')
  prompt.close()
  const password = await readHidden('Senha (8 a 200 caracteres; entrada oculta): ')
  const confirmation = await readHidden('Confirme a senha: ')
  if (password !== confirmation) throw new Error('As senhas não conferem.')

  const administrator = await createInitialAdmin(username, password)
  console.log(`Administrador "${administrator.username}" criado com sucesso.`)
} catch (error) {
  console.error('Não foi possível criar o administrador:', error.message)
  process.exitCode = 1
} finally {
  prompt.close()
  await closeApplicationDatabase()
}
