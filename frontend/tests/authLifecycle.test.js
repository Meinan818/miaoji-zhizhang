// Real authStore + session + API adapter, entirely synthetic fetch responses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createApp } from 'vue'
import { createPinia, disposePinia } from 'pinia'

let moduleNumber = 0
async function scene() {
  const savedFetch = globalThis.fetch, savedWindow = globalThis.window
  const requests = [], redirects = []
  globalThis.fetch = (path, options) => new Promise(resolve => requests.push({ path, options, finish(status, value) {
    resolve(new Response(status === 204 ? null : JSON.stringify(value), { status }))
  } }))
  globalThis.window = { location: { replace: path => redirects.push(path) } }
  const pinia = createPinia(); createApp({}).use(pinia)
  const sourceUrl = new URL('../src/stores/authStore.js', import.meta.url)
  let source = await readFile(sourceUrl, 'utf8')
  source = source.replace("import { SERVER_MODE } from '../api/mode.js'", 'const SERVER_MODE = true')
    .replace(/from '([^']+)'/g, (_, path) => `from '${path.startsWith('.') ? new URL(path, sourceUrl).href : import.meta.resolve(path)}'`)
  const { useAuthStore } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleNumber++}`)
  return { store: useAuthStore(pinia), recreate: () => useAuthStore(pinia), requests, redirects,
    async flush() { await new Promise(resolve => setImmediate(resolve)) },
    dispose() { disposePinia(pinia); globalThis.fetch = savedFetch; if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow } }
}
const alice = { id: '1', username: 'synthetic-A' }, bob = { id: '2', username: 'synthetic-B' }
const csrf = { headerName: 'X-CSRF-TOKEN', token: 'synthetic-csrf' }

test('同Pinia认证Store重建从unknown开始重新核Cookie，不hydrate旧身份', async () => {
  const env = await scene()
  try {
    const first = env.store.restore(); env.requests[0].finish(200, alice); assert.equal(await first, true)
    env.store.$dispose(); const rebuilt = env.recreate()
    assert.equal(rebuilt.user, null); assert.equal(rebuilt.status, 'unknown'); assert.equal(rebuilt.error, '')
    const latest = rebuilt.restore(); env.requests.at(-1).finish(200, bob); assert.equal(await latest, true)
    assert.equal(rebuilt.user.id, '2'); assert.equal(env.store.user.id, '1'); assert.deepEqual(env.redirects, [])
  } finally { env.dispose() }
})
test('认证Store释放后迟到restore不回填或触发旧身份导航', async () => {
  const env = await scene()
  try {
    const pending = env.store.restore(), old = env.requests[0]; env.store.$dispose()
    const rebuilt = env.recreate(), latest = rebuilt.restore(); env.requests[1].finish(200, bob); await latest
    old.finish(200, alice); assert.equal(await pending, false)
    assert.equal(env.store.user, null); assert.equal(rebuilt.user.id, '2'); assert.deepEqual(env.redirects, [])
  } finally { env.dispose() }
})
test('释放后的迟到login不追加CSRF/身份网络调用，旧实例新动作不发送', async () => {
  const env = await scene()
  try {
    const pending = env.store.login('synthetic-A', 'synthetic-password')
    pending.catch(() => {})
    env.requests[0].finish(200, csrf); await env.flush()
    assert.equal(env.requests[1].path, '/api/auth/login'); env.store.$dispose()
    env.requests[1].finish(204); await env.flush()
    // Drain the pre-fix client's extra requests so a failing assertion leaves no pending timer.
    if (env.requests[2]) { env.requests[2].finish(200, csrf); await env.flush() }
    if (env.requests[3]) env.requests[3].finish(200, alice)
    assert.equal(await pending, false)
    assert.equal(env.requests.length, 2); assert.equal(env.store.user, null)
    assert.equal(await env.store.login('synthetic-A', 'synthetic-password'), false)
    assert.equal(await env.store.restore(), false); assert.equal(await env.store.logout(), false)
    assert.equal(env.requests.length, 2); assert.deepEqual(env.redirects, [])
  } finally { env.dispose() }
})
test('已认证旧Store迟到401不会调用旧expire重定向或清新Store身份', async () => {
  const env = await scene()
  try {
    const restored = env.store.restore(); env.requests[0].finish(200, alice); await restored
    const oldRequest = env.store.api.request('GET', '/api/profile'); env.store.$dispose()
    const rebuilt = env.recreate(), fresh = rebuilt.restore(); env.requests[2].finish(200, bob); await fresh
    env.requests[1].finish(401, { message: 'synthetic-expired' }); await assert.rejects(oldRequest)
    assert.equal(rebuilt.user.id, '2'); assert.deepEqual(env.redirects, [])
  } finally { env.dispose() }
})
test('安全校验等待期间释放后不会发送登录写请求', async () => {
  const env = await scene()
  try {
    const pending = env.store.login('synthetic-A', 'synthetic-password')
    env.store.$dispose(); env.requests[0].finish(200, csrf)
    assert.equal(await pending, false); assert.equal(env.requests.length, 1)
    assert.equal(env.requests[0].path, '/api/auth/csrf'); assert.equal(env.store.user, null)
  } finally { env.dispose() }
})
test('释放后旧注册回执不自动登录，旧验证码动作也不发邮件请求', async () => {
  const env = await scene()
  try {
    const pending = env.store.register('synthetic@example.test', 'synthetic-password', 'synthetic-challenge', '000000')
    env.requests[0].finish(200, csrf); await env.flush()
    assert.equal(env.requests[1].path, '/api/auth/email/register'); env.store.$dispose()
    env.requests[1].finish(204); assert.equal(await pending, false)
    assert.equal(env.requests.length, 2)
    await assert.rejects(env.store.requestRegistrationCode('synthetic@example.test'), { code: 'STALE_SESSION' })
    assert.equal(await env.store.register('synthetic@example.test', 'synthetic-password', 'synthetic', '000000'), false)
    assert.equal(env.requests.length, 2); assert.deepEqual(env.redirects, [])
  } finally { env.dispose() }
})
test('同实例新登录完成后旧POST回执不重置新CSRF或追加身份读取', async () => {
  const env = await scene()
  try {
    const old = env.store.login('synthetic-A', 'synthetic-password'); old.catch(() => {})
    env.requests[0].finish(200, csrf); await env.flush()
    const fresh = env.store.login('synthetic-B', 'synthetic-password'); await env.flush()
    env.requests[2].finish(204); await env.flush()
    env.requests[3].finish(200, csrf); await env.flush()
    env.requests[4].finish(200, bob); assert.equal(await fresh, true)
    const bound = env.store.api.getCsrf(); await env.flush()
    const freshToken = { ...csrf, token: 'synthetic-current-B' }; env.requests[5].finish(200, freshToken); await bound
    const before = env.requests.length
    env.requests[1].finish(204); await env.flush()
    if (env.requests[before]) { env.requests[before].finish(200, { ...csrf, token: 'synthetic-late-A' }); await env.flush() }
    if (env.requests[before + 1]) env.requests[before + 1].finish(200, alice)
    assert.equal(await old, false); assert.equal(env.store.user.id, '2')
    assert.equal(env.requests.length, before); assert.deepEqual(await env.store.api.getCsrf(), freshToken)
  } finally { env.dispose() }
})
test('同实例expire发生在CSRF等待中，旧登录不能继续发送POST', async () => {
  const env = await scene()
  try {
    const pending = env.store.login('synthetic-A', 'synthetic-password'); pending.catch(() => {})
    env.store.expire(); env.requests[0].finish(200, csrf); await env.flush()
    if (env.requests[1]) { env.requests[1].finish(204); await env.flush() }
    if (env.requests[2]) { env.requests[2].finish(200, csrf); await env.flush() }
    if (env.requests[3]) env.requests[3].finish(200, alice)
    assert.equal(await pending, false); assert.equal(env.requests.length, 1)
    assert.equal(env.store.user, null); assert.equal(env.store.status, 'guest')
  } finally { env.dispose() }
})
test('同实例旧退出回执不重置新登录已绑定的CSRF', async () => {
  const env = await scene()
  try {
    const restored = env.store.restore(); env.requests[0].finish(200, alice); await restored
    const initialCsrf = env.store.api.getCsrf(); env.requests[1].finish(200, csrf); await initialCsrf
    const oldLogout = env.store.logout(); await env.flush(); assert.equal(env.requests[2].path, '/api/auth/logout')
    const fresh = env.store.login('synthetic-B', 'synthetic-password'); await env.flush()
    env.requests[3].finish(200, csrf); await env.flush()
    env.requests[4].finish(204); await env.flush()
    env.requests[5].finish(200, csrf); await env.flush()
    env.requests[6].finish(200, bob); await fresh
    const bound = env.store.api.getCsrf(), freshToken = { ...csrf, token: 'synthetic-current-B' }
    env.requests[7].finish(200, freshToken); await bound
    const before = env.requests.length, redirects = env.redirects.length
    env.requests[2].finish(204); assert.equal(await oldLogout, false)
    const cached = env.store.api.getCsrf(); await env.flush()
    if (env.requests[before]) env.requests[before].finish(200, { ...csrf, token: 'unexpected-reset' })
    const currentToken = await cached
    assert.equal(env.requests.length, before); assert.deepEqual(currentToken, freshToken)
    assert.equal(env.store.user.id, '2'); assert.equal(env.redirects.length, redirects)
  } finally { env.dispose() }
})
test('正式身份失效时保留当前站内页面筛选，登录页本身不形成返回循环', async () => {
  const env = await scene()
  try {
    const first = env.store.restore(); env.requests[0].finish(200, alice); await first
    Object.assign(globalThis.window.location, { pathname: '/bills', search: '?month=2026-09&q=coffee', hash: '#receipt' })
    env.store.expire()
    assert.equal(env.redirects[0], '/login?redirect=' + encodeURIComponent('/bills?month=2026-09&q=coffee#receipt'))
    const next = env.store.restore(); env.requests[1].finish(200, alice); await next
    Object.assign(globalThis.window.location, { pathname: '/login', search: '?redirect=/bills', hash: '' })
    env.store.expire(); assert.equal(env.redirects[1], '/login')
  } finally { env.dispose() }
})
