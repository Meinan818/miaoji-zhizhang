import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, existsSync, openSync, closeSync } from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function portInUse(port) {
  return new Promise((accept, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); accept(true) })
    socket.once('error', error => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED') accept(false)
      else reject(new Error(`无法检查本机端口${port}。`))
    })
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error(`检查本机端口${port}超时。`)) })
  })
}

export function launchPlan(root = projectRoot, env = process.env) {
  const javaCandidates = [env.JAVA_HOME && join(env.JAVA_HOME, 'bin', 'java.exe'), 'E:/JavaDev/jdk-21/bin/java.exe']
  const java = javaCandidates.find(candidate => candidate && existsSync(candidate)) || 'java'
  const version = spawnSync(java, ['-version'], { encoding: 'utf8', windowsHide: true })
  const major = Number((version.stderr || version.stdout || '').match(/version "(\d+)/)?.[1])
  if (version.error || version.status !== 0 || major < 21 || !major) throw new Error('需要可用的Java 21或更新版本，请先按后端说明准备运行环境。')
  const jar = join(root, 'backend', 'target', 'miaoji-backend-0.1.0.jar')
  const vite = join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(jar)) throw new Error('缺少后端jar，请先按backend/README.md完成package。')
  if (!existsSync(vite)) throw new Error('缺少已有前端依赖，请先按开发说明准备依赖。')
  if (!existsSync(join(root, 'backend', '.env.local.properties'))
    && !['MIAOJI_DB_URL', 'MIAOJI_DB_USERNAME', 'MIAOJI_DB_PASSWORD'].every(key => env[key])) {
    throw new Error('缺少本机数据库配置，请按backend/README.md准备配置；不要改动已有业务库。')
  }
  const temporary = join(root, '.cache', 'backend', 'tmp')
  return {
    root, temporary,
    backend: { command: java, args: [`-Djava.io.tmpdir=${temporary}`, '-jar', jar, '--server.address=127.0.0.1', '--server.port=8080'],
      cwd: join(root, 'backend'), port: 8080, path: '/api/auth/csrf',
      ready: text => { try { const data = JSON.parse(text); return typeof data.token === 'string' && !!data.token && typeof data.headerName === 'string' } catch { return false } } },
    frontend: { command: process.execPath, args: [vite, '--mode', 'server', '--host', '127.0.0.1', '--port', '5174', '--strictPort'],
      cwd: join(root, 'frontend'), port: 5174, path: '/src/api/mode.js',
      ready: text => /"MODE"\s*:\s*"server"/.test(text) },
  }
}

export async function checkPorts(plan) {
  const occupied = []
  for (const service of [plan.backend, plan.frontend]) {
    if (await portInUse(service.port)) occupied.push(service.port)
  }
  return occupied
}

async function waitReady(service, childState, signal, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    if (childState.closed) throw new Error(`本机${service.port}服务已退出，请查看本次启动日志。`)
    try {
      const response = await fetch(`http://127.0.0.1:${service.port}${service.path}`, {
        signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]),
        redirect: 'error',
      })
      if (response.ok && service.ready(await response.text())) return
    } catch { signal?.throwIfAborted() }
    await delay(200, undefined, { signal })
  }
  throw new Error(`本机${service.port}服务未在期限内就绪，请查看本次启动日志。`)
}

export async function startServices(plan, { signal, timeoutMs = 45000, env = process.env, onProgress = () => {} } = {}) {
  const occupied = await checkPorts(plan)
  if (occupied.length) throw new Error(`端口${occupied.join('、')}已被占用。若已启动喵叽智账，请继续使用现有服务；本次不会停止已有进程。`)
  signal?.throwIfAborted()
  mkdirSync(plan.temporary, { recursive: true })
  const logDir = join(plan.root, '.cache', 'local-dev', `run-${Date.now()}-${process.pid}`)
  mkdirSync(logDir, { recursive: true })
  const children = []
  let ending = false, finish, failure = null
  const ended = new Promise(accept => { finish = accept })
  const stop = async () => {
    if (ending) return ended
    ending = true
    for (const state of children) if (!state.closed) state.child.kill()
    await Promise.all(children.map(state => state.done))
    signal?.removeEventListener('abort', onAbort)
    finish(failure)
  }
  const onAbort = () => { void stop() }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (const [name, service] of [['backend', plan.backend], ['frontend', plan.frontend]]) {
      signal?.throwIfAborted()
      if (ending) throw failure || new Error('本次启动已停止。')
      const log = openSync(join(logDir, `${name}.log`), 'a')
      let child
      try {
        child = spawn(service.command, service.args, { cwd: service.cwd,
          env: { ...env, TEMP: plan.temporary, TMP: plan.temporary }, windowsHide: true, stdio: ['ignore', log, log] })
      } finally { closeSync(log) }
      const state = { child, closed: false }
      state.done = new Promise(accept => {
        child.once('error', () => { state.closed = true })
        child.once('close', () => {
          state.closed = true; accept()
          if (!ending) {
            failure = new Error(`本机${service.port}服务意外退出，本次创建的另一项服务也已停止。\n日志：${logDir}`)
            void stop()
          }
        })
      })
      children.push(state)
      onProgress(`${name === 'backend' ? '后端' : '前端'}正在启动…`)
      await waitReady(service, state, signal, timeoutMs)
      if (ending) throw failure || new Error('本次启动已停止。')
    }
    return { stop, ended, logDir }
  } catch (error) {
    await stop()
    throw new Error(`${signal?.aborted ? '本次启动已停止。' : error.message}\n日志：${logDir}`)
  }
}

async function main(args) {
  if (args.some(arg => !['--check', '--help'].includes(arg))) throw new Error('只支持直接启动、--check或--help。')
  if (args.includes('--help')) {
    console.log('喵叽智账本机启动：双击start-local.cmd，或运行node scripts/local-dev.mjs。\n--check只检查已有环境与端口，不启动服务。Ctrl+C停止本次创建的前后端。')
    return
  }
  const plan = launchPlan()
  if (args.includes('--check')) {
    const occupied = await checkPorts(plan)
    console.log(`Java、后端jar、前端依赖及本机配置入口已找到；配置内容未验证。\n8080/5174${occupied.length ? `占用端口：${occupied.join('、')}，不会操作已有服务。` : '空闲，可启动。'}`)
    return
  }
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try {
    const session = await startServices(plan, { signal: controller.signal, onProgress: console.log })
    console.log(`本机前后端已就绪：http://127.0.0.1:5174/login\n日志：${session.logDir}\n保留此窗口；按Ctrl+C停止本次创建的服务。`)
    const failure = await session.ended
    if (failure) throw failure
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
