import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本机整库备份：读取 backend/.env.local.properties 的数据库配置（只读使用，不打印凭据），
// 用 mysqldump 导出一份 .sql 到项目 backups/ 目录。只做只读导出，不改动任何数据。
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(projectRoot, 'backend', '.env.local.properties')

function readConfig() {
  if (!existsSync(configPath)) throw new Error('缺少 backend/.env.local.properties，请先按 backend/README.md 准备本机配置。')
  const values = {}
  for (const line of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z0-9_.]+)\s*=\s*(.*)$/.exec(trimmed)
    if (match) values[match[1]] = match[2].trim()
  }
  return values
}

function databaseConfig(values) {
  const match = /^jdbc:mysql:\/\/([^:/?]+):(\d+)\/([^?]+)/.exec(values.MIAOJI_DB_URL || '')
  if (!match || !values.MIAOJI_DB_USERNAME || !values.MIAOJI_DB_PASSWORD) {
    throw new Error('数据库连接配置不完整，请检查 .env.local.properties 的 MIAOJI_DB_URL、MIAOJI_DB_USERNAME、MIAOJI_DB_PASSWORD。')
  }
  return { host: match[1], port: match[2], database: match[3], user: values.MIAOJI_DB_USERNAME, password: values.MIAOJI_DB_PASSWORD }
}

function dumpBinary() {
  const candidates = [
    'E:/MySQL/MySQL Server 8.4/bin/mysqldump.exe',
    'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe',
  ]
  const found = candidates.find(candidate => existsSync(candidate))
  if (!found) throw new Error('没有找到 mysqldump，请确认 MySQL 已按开发文档安装。')
  return found
}

async function main() {
  const values = readConfig()
  const database = databaseConfig(values)
  const binary = dumpBinary()
  const folder = join(projectRoot, 'backups')
  mkdirSync(folder, { recursive: true })
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const name = `miaoji-dev-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.sql`
  const target = join(folder, name)
  const args = [`--host=${database.host}`, `--port=${database.port}`, `--user=${database.user}`,
    `--password=${database.password}`, '--single-transaction', '--quick', '--routines', '--events',
    '--default-character-set=utf8mb4', database.database]
  await new Promise((accept, reject) => {
    const child = spawn(binary, args, { windowsHide: true })
    const output = createWriteStream(target)
    child.stdout.pipe(output)
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      output.end(() => {
        if (code === 0) accept()
        else reject(new Error(`mysqldump 退出码 ${code}${stderr ? '：' + stderr.trim().slice(0, 300) : ''}`))
      })
    })
  })
  console.log(`备份完成：${target}（${(statSync(target).size / 1024).toFixed(1)} KB）`)
  console.log('建议把这份文件复制到其他磁盘或网盘；重装系统后可用它恢复整个数据库。')
}

main().catch(error => { console.error('备份未完成：' + error.message); process.exitCode = 1 })
