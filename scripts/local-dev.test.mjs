import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { launchPlan, startServices, checkPorts, portInUse } from './local-dev.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localRoot = () => join(workspace, '.cache', 'local-dev-tests', randomUUID())
const serverScript = `
  const http = require('node:http');
  const port = Number(process.argv[1]); const content = process.argv[2];
  http.createServer((req, res) => { res.end(content) }).listen(port, '127.0.0.1');
`
const listen = server => new Promise(accept => server.listen(0, '127.0.0.1', () => accept(server.address().port)))
const close = server => new Promise(accept => server.close(accept))
async function unusedPort() {
  const server = createServer(); const port = await listen(server); await close(server); return port
}
async function plan() {
  const root = localRoot(); mkdirSync(root, { recursive: true })
  const backendPort = await unusedPort()
  let frontendPort = await unusedPort()
  while (frontendPort === backendPort) frontendPort = await unusedPort()
  const service = (port, body, ready) => ({ command: process.execPath, args: ['-e', serverScript, String(port), body],
    cwd: root, port, path: '/', ready })
  return { root, temporary: join(root, 'tmp'),
    backend: service(backendPort, '{"ready":true}', text => JSON.parse(text).ready === true),
    frontend: service(frontendPort, 'server-mode', text => text === 'server-mode') }
}

test('缺少jar、前端依赖或本机配置先明确报错，不创建启动缓存', () => {
  const root = localRoot(); mkdirSync(join(root, 'backend', 'target'), { recursive: true })
  assert.throws(() => launchPlan(root, {}), /缺少后端jar/)
  writeFileSync(join(root, 'backend', 'target', 'miaoji-backend-0.1.0.jar'), 'synthetic-placeholder')
  assert.throws(() => launchPlan(root, {}), /缺少已有前端依赖/)
  mkdirSync(join(root, 'frontend', 'node_modules', 'vite', 'bin'), { recursive: true })
  writeFileSync(join(root, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js'), '')
  assert.throws(() => launchPlan(root, {}), /缺少本机数据库配置/)
  assert.equal(existsSync(join(root, '.cache')), false)
})

test('端口已占用时不创建服务或日志，已有HTTP服务继续响应', async () => {
  const existing = createServer((req, res) => res.end('existing-service'))
  const port = await listen(existing)
  try {
    const config = await plan(); config.backend.port = port
    assert.deepEqual(await checkPorts(config), [port])
    await assert.rejects(startServices(config), /已被占用/)
    assert.equal(existsSync(config.temporary), false)
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'existing-service')
  } finally { await close(existing) }
})

test('两项HTTP内容均就绪后返回，停止仅关闭自己创建的进程', async () => {
  const existing = createServer((req, res) => res.end('untouched'))
  const port = await listen(existing)
  const config = await plan(); let session
  try {
    session = await startServices(config, { timeoutMs: 4000 })
    assert.equal(await portInUse(config.backend.port), true)
    assert.equal(await (await fetch(`http://127.0.0.1:${config.frontend.port}`)).text(), 'server-mode')
    assert.ok(existsSync(join(session.logDir, 'backend.log')))
    await session.stop(); await session.stop()
    assert.equal(await portInUse(config.backend.port), false)
    assert.equal(await portInUse(config.frontend.port), false)
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'untouched')
  } finally { await session?.stop(); await close(existing) }
})

test('监听存在但HTTP内容不符不报就绪，超时关闭自己的后端', async () => {
  const config = await plan(); config.backend.ready = () => false
  await assert.rejects(startServices(config, { timeoutMs: 650 }), /未在期限内就绪/)
  assert.equal(await portInUse(config.backend.port), false)
  assert.equal(await portInUse(config.frontend.port), false)
})

test('前端启动失败清理本次后端，不留下只有半个应用运行', async () => {
  const config = await plan(); config.frontend.args = ['-e', 'process.exit(2)']
  await assert.rejects(startServices(config, { timeoutMs: 3000 }), /服务已退出/)
  assert.equal(await portInUse(config.backend.port), false)
})

test('启动中取消关闭已创建的服务，取消前不启动后续服务', async () => {
  const config = await plan(); config.backend.ready = () => false
  const controller = new AbortController()
  await assert.rejects(startServices(config, {
    signal: controller.signal, timeoutMs: 3000,
    onProgress: () => controller.abort(),
  }), /本次启动已停止/)
  assert.equal(await portInUse(config.backend.port), false)
  assert.equal(await portInUse(config.frontend.port), false)
})

test('已取消的操作在创建缓存或进程之前退出', async () => {
  const config = await plan(); const controller = new AbortController(); controller.abort()
  await assert.rejects(startServices(config, { signal: controller.signal }), /aborted/i)
  assert.equal(existsSync(config.temporary), false)
})

test('就绪后任一服务意外退出会告知失败并关闭本次另一服务', async () => {
  const config = await plan()
  config.backend.args[1] += '\nsetTimeout(() => process.exit(2), 1400);'
  const session = await startServices(config, { timeoutMs: 4000 })
  try {
    const failure = await session.ended
    assert.match(failure.message, /意外退出/)
    assert.equal(await portInUse(config.backend.port), false)
    assert.equal(await portInUse(config.frontend.port), false)
  } finally { await session.stop() }
})
