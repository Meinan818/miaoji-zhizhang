import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession } from '../src/api/session.js'
import { ApiError } from '../src/api/client.js'
import { effectScope, ref, nextTick } from 'vue'
import { useRegistrationChallenge } from '../src/utils/registration.js'

function codeScene(requestRegistrationCode) {
  const scope = effectScope(), username = ref('synthetic@example.test'), registering = ref(true), now = ref(1000), error = ref('')
  const challenge = scope.run(() => useRegistrationChallenge({ requestRegistrationCode }, username, registering, now, ref(false), error, () => now.value))
  return { ...challenge, username, registering, now, error, dispose: () => scope.stop() }
}
const codeReceipt = { challengeId: '7ebf606b-a0d5-4053-98fb-194505f3d10c', expiresIn: 90, resendAfter: 60 }

test('切换邮箱后旧验证码失败不显示在新邮箱表单', async () => {
  let reject
  const scene = codeScene(() => new Promise((_, fail) => { reject = fail }))
  try {
    const pending = scene.requestCode()
    scene.username.value = 'other@example.test'
    await nextTick()
    reject(Error('旧邮箱发送失败'))
    await pending
    assert.equal(scene.error.value, '')
    assert.equal(scene.challenge.value, null)
  } finally { scene.dispose() }
})

test('验证码申请期间注册模式来回切换不接纳旧回执', async () => {
  let resolve
  const scene = codeScene(() => new Promise(done => { resolve = done }))
  try {
    const pending = scene.requestCode()
    scene.registering.value = false
    await nextTick()
    scene.registering.value = true
    await nextTick()
    resolve(codeReceipt)
    await pending
    assert.equal(scene.challenge.value, null)
    assert.equal(scene.codeNote.value, '')
  } finally { scene.dispose() }
})

test('离页后验证码回执不修改原表单', async () => {
  let resolve
  const scene = codeScene(() => new Promise(done => { resolve = done }))
  const pending = scene.requestCode()
  scene.dispose()
  resolve(codeReceipt)
  await pending
  assert.equal(scene.challenge.value, null)
})

test('验证码有效期使用服务回执并标识过期，重发等待不受邮箱变化绕过', async () => {
  const scene = codeScene(async () => codeReceipt)
  try {
    assert.equal(await scene.requestCode(), true)
    assert.equal(scene.challenge.value.expiresAt, 91000)
    assert.match(scene.codeNote.value, /90秒/)
    assert.equal(scene.challengeExpired.value, false)
    scene.now.value = 91000
    assert.equal(scene.challengeExpired.value, true)
    scene.now.value = 1000
    scene.username.value = 'other@example.test'
    await nextTick()
    assert.equal(scene.resendSeconds.value, 60)
    assert.equal(await scene.requestCode(), false)
  } finally { scene.dispose() }
})

test('验证码请求共享等待，重发前清除旧挑战及旧验证码', async () => {
  let resolve, calls = 0
  const scene = codeScene(() => { calls++; return new Promise(done => { resolve = done }) })
  try {
    const first = scene.requestCode()
    assert.equal(await scene.requestCode(), false)
    assert.equal(calls, 1)
    resolve(codeReceipt)
    await first
    scene.code.value = '123456'
    scene.now.value = 62000
    const resend = scene.requestCode()
    assert.equal(scene.challenge.value, null)
    assert.equal(scene.code.value, '')
    resolve({ ...codeReceipt, challengeId: '7ebf606b-a0d5-4053-98fb-194505f3d10d' })
    await resend
    assert.equal(scene.challenge.value.challengeId.endsWith('10d'), true)
    assert.equal(calls, 2)
  } finally { scene.dispose() }
})

const alice = { id: '1', username: 'synthetic_alice' }
const bob = { id: '2', username: 'synthetic_bob' }

test('失效后立即恢复发送新请求，旧响应和finally不清新恢复', async () => {
  const resolvers = []
  const session = createSession({ request: () => new Promise(done => resolvers.push(done)) })
  const first = session.restore()
  session.expire()
  const second = session.restore()
  assert.equal(resolvers.length, 2)
  resolvers[0](alice)
  assert.equal(await first, false)
  const joined = session.restore()
  assert.equal(resolvers.length, 2)
  resolvers[1](bob)
  await Promise.all([second, joined])
  assert.equal(session.user.value.id, '2')
})

test('退出迟到回执不清除退出后新登录的身份', async () => {
  let finishLogout
  let account = alice
  const session = createSession({ login: async () => account, logout: () => new Promise(done => { finishLogout = done }) })
  await session.login('a', 'synthetic')
  const pending = session.logout()
  account = bob
  await session.login('b', 'synthetic')
  finishLogout()
  await pending
  assert.equal(session.user.value.id, '2')
  assert.equal(session.status.value, 'authenticated')
})

test('注册迟到成功在身份失效后不继续登录或恢复旧操作', async () => {
  let finishRegistration
  let logins = 0
  const session = createSession({ request: () => new Promise(done => { finishRegistration = done }), login: async () => { logins++; return alice } })
  const pending = session.register('synthetic@example.test', 'SyntheticPass123!', 'synthetic', '123456')
  session.expire()
  finishRegistration()
  assert.equal(await pending, false)
  assert.equal(logins, 0)
  assert.equal(session.user.value, null)
})

test('退出开始时阻断先前未完成登录，迟到登录不恢复身份', async () => {
  let finishLogin
  const session = createSession({ login: () => new Promise(done => { finishLogin = done }), logout: async () => {} })
  const login = session.login('a', 'synthetic')
  await session.logout()
  finishLogin(alice)
  assert.equal(await login, false)
  assert.equal(session.user.value, null)
})

test('旧恢复的网络失败不冒泡干扰已成功登录的新身份', async () => {
  let rejectRestore
  const session = createSession({ request: () => new Promise((_, fail) => { rejectRestore = fail }), login: async () => bob })
  const pending = session.restore()
  await session.login('b', 'synthetic')
  rejectRestore(new ApiError('旧账号网络失败'))
  assert.equal(await pending, false)
  assert.equal(session.error.value, '')
  assert.equal(session.user.value.id, '2')
})
test('恢复只读真实会话，401保持未登录，不假造演示用户', async () => {
  const session = createSession({ request: async () => { throw new ApiError('expired', { status: 401 }) } })
  assert.equal(await session.restore(), false); assert.equal(session.user.value, null); assert.equal(session.status.value, 'guest')
})
test('服务不可用不当成未登录或演示数据', async () => {
  const session = createSession({ request: async () => { throw new ApiError('offline') } })
  await assert.rejects(session.restore(), /offline/)
  assert.equal(session.status.value, 'unavailable'); assert.equal(session.user.value, null)
})
test('切换账号及退出发送身份变化，让所有业务缓存立即隔离', async () => {
  const changes = []; let account = alice
  const session = createSession({ login: async () => account, logout: async () => {} }, { onIdentityChange: (...args) => changes.push(args) })
  await session.login('a', 'synthetic'); account = bob; await session.login('b', 'synthetic'); await session.logout()
  assert.deepEqual(changes, [['1', null], [null, '1'], ['2', null], [null, '2']]); assert.equal(session.user.value, null)
})
test('过期后迟到的会话响应不能恢复之前身份', async () => {
  let resolve
  const session = createSession({ request: () => new Promise(done => { resolve = done }) })
  const pending = session.restore(); session.expire(); resolve(alice)
  assert.equal(await pending, false); assert.equal(session.user.value, null)
})
test('并发恢复只发送一次，旧恢复不能覆盖新账号登录', async () => {
  let resolve; let count = 0
  const session = createSession({ request: () => { count++; return new Promise(done => { resolve = done }) }, login: async () => bob })
  const first = session.restore(); const second = session.restore()
  await session.login('b', 'synthetic'); resolve(alice); await Promise.all([first, second])
  assert.equal(count, 1); assert.equal(session.user.value.id, '2')
})
test('注册成功后实际登录；注册失败不创建身份', async () => {
  const calls = []
  const session = createSession({ request: async (...args) => calls.push(args), login: async () => alice })
  await session.register('a', 'synthetic')
  assert.equal(calls[0][1], '/api/auth/email/register'); assert.equal(session.user.value.id, '1')
  const failed = createSession({ request: async () => { throw new ApiError('taken', { status: 409 }) } })
  await assert.rejects(failed.register('a', 'synthetic'), /taken/); assert.equal(failed.user.value, null)
})

test('账号已创建但自动登录失败时明确指引登录，保留原错误类型且不重复注册', async () => {
  for (const status of [401, 503]) {
    const calls = []
    const session = createSession({
      request: async (...args) => { calls.push(args[1]) },
      login: async () => { calls.push('login'); throw new ApiError('合成自动登录失败', { status, code: 'SYNTHETIC_LOGIN_FAILED' }) },
    })
    await assert.rejects(session.register('synthetic@example.test', 'SyntheticPass123!', 'synthetic-challenge', '123456'), failure => {
      assert(failure instanceof ApiError)
      assert.match(failure.message, /注册已成功/)
      assert.match(failure.message, /切换到登录/)
      assert.match(failure.message, /合成自动登录失败/)
      assert.equal(failure.status, status); assert.equal(failure.code, 'SYNTHETIC_LOGIN_FAILED')
      return true
    })
    assert.deepEqual(calls, ['/api/auth/email/register', 'login'])
    assert.equal(session.user.value, null)
    assert.equal(session.status.value, status === 401 ? 'guest' : 'unavailable')
  }
})

test('注册后的自动登录等待中释放或失效，迟到失败不冒称注册完成或复活账号', async () => {
  for (const action of ['dispose', 'expire']) {
    let rejectLogin
    const session = createSession({ request: async () => {}, login: () => new Promise((_, reject) => { rejectLogin = reject }) })
    const pending = session.register('synthetic@example.test', 'SyntheticPass123!', 'synthetic-challenge', '123456')
    await Promise.resolve()
    assert.equal(typeof rejectLogin, 'function')
    session[action](); const errorBefore = session.error.value
    rejectLogin(new ApiError('迟到合成登录失败', { status: 503 }))
    assert.equal(await pending, false); assert.equal(session.error.value, errorBefore); assert.equal(session.user.value, null)
  }
})
test('退出网络失败保留当前会话并提示，401可正常清理', async () => {
  let fail = 0
  const session = createSession({ login: async () => alice, logout: async () => { throw new ApiError('failed', { status: fail }) } })
  await session.login('a', 'synthetic'); await assert.rejects(session.logout()); assert.equal(session.user.value.id, '1')
  fail = 401; await session.logout(); assert.equal(session.user.value, null)
})
test('畸形服务身份拒绝登录，密码不放入会话状态', async () => {
  const session = createSession({ login: async () => ({ id: '../other', username: 'bad' }) })
  await assert.rejects(session.login('a', 'SyntheticPass123!'), /身份格式/)
  assert.equal(session.user.value, null); assert.equal(Object.hasOwn(session, 'password'), false)
})
test('邮箱验证码申请只接收挑战回执，注册传邮箱验证码并等待真实登录', async () => {
  const calls = []; const challengeId = '7ebf606b-a0d5-4053-98fb-194505f3d10c'
  const session = createSession({ request: async (...args) => {
    calls.push(args)
    return args[1].endsWith('/code') ? { challengeId, expiresIn: 300, resendAfter: 60 } : null
  }, login: async (email, password) => {
    assert.equal(email, 'synthetic@example.test'); assert.equal(password, 'SyntheticPass123!')
    return { id: '1', username: email }
  } })
  assert.equal((await session.requestRegistrationCode('synthetic@example.test')).challengeId, challengeId)
  await session.register('synthetic@example.test', 'SyntheticPass123!', challengeId, '123456')
  assert.deepEqual(calls[1][2].body, { email: 'synthetic@example.test', password: 'SyntheticPass123!', challengeId, code: '123456' })
  assert.equal(session.user.value.username, 'synthetic@example.test')
  assert.equal(Object.hasOwn(session, 'code'), false); assert.equal(Object.hasOwn(session, 'password'), false)
})
test('验证码申请回执缺字段拒绝冒称已发送，注册失败不伪造登录', async () => {
  const session = createSession({ request: async () => ({ challengeId: '../bad', expiresIn: 300, resendAfter: 60 }) })
  await assert.rejects(session.requestRegistrationCode('synthetic@example.test'), /回执不完整/)
  assert.equal(session.user.value, null)
})
