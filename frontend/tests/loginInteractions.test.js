// 实际Login setup+验证码helper离线执行；合成认证/邮件回执，不发送邮件或改真实账号。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, onScopeDispose, reactive, ref } from 'vue'
import { useRegistrationChallenge, validRegistrationEmail } from '../src/utils/registration.js'
import { getLoginReturnPath } from '../src/utils/loginRedirect.js'

const script = readFileSync(new URL('../src/views/Login.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
const password = 'Synthetic-Only-123'
function scene(redirect) {
  const scope = effectScope(), calls = [], redirects = [], cleared = []
  const pending = kind => (...args) => new Promise((resolve, reject) => calls.push({ kind, args, resolve, reject }))
  const auth = reactive({ error: '', login: pending('login'), register: pending('register'), requestRegistrationCode: pending('code') })
  const bindings = { ref, onScopeDispose, SERVER_MODE: true, useAuthStore: () => auth, useRoute: () => ({ query: { redirect } }), getLoginReturnPath,
    useRegistrationChallenge, validEmail: validRegistrationEmail,
    setInterval: () => 4, clearInterval: id => cleared.push(id), window: { location: { replace: url => redirects.push(url) } } }
  const view = scope.run(() => new Function(...Object.keys(bindings), script +
    ';return {submit, requestCode, username, password, confirmation, registering, saving, error, code, challenge, sendingCode}')(...Object.values(bindings)))
  view.username.value = 'synthetic@example.invalid'; view.password.value = password
  return { view, calls, redirects, cleared, dispose: () => scope.stop() }
}

test('登录成功返回原明细筛选，外部或循环目的地只回首页', async () => {
  for (const target of ['/bills?month=2026-09&q=coffee#receipt', 'https://example.test', '/login']) {
    const env = scene(target)
    try {
      const pending = env.view.submit(); env.calls[0].resolve(true); await pending
      assert.deepEqual(env.redirects, [target.startsWith('/bills') ? target : '/'])
    } finally { env.dispose() }
  }
})

test('当前登录成功清密码并导航，失败保留输入且重复点击只有一请求', async () => {
  const env = scene()
  try {
    let pending = env.view.submit(); await env.view.submit()
    assert.equal(env.calls.length, 1)
    env.calls[0].reject(Error('合成认证失败')); await pending
    assert.equal(env.view.password.value, password)
    assert.equal(env.view.error.value, '合成认证失败')
    assert.equal(env.view.saving.value, false)
    pending = env.view.submit(); env.calls[1].resolve(true); await pending
    assert.deepEqual(env.redirects, ['/'])
    assert.equal(env.view.password.value, '')
  } finally { env.dispose() }
  assert.deepEqual(env.cleared, [4])
})

test('验证码申请期间编辑邮箱/密码，旧邮件回执不会覆盖输入或注册新邮箱', async () => {
  const env = scene()
  try {
    env.view.registering.value = true
    const pending = env.view.requestCode()
    env.view.username.value = 'another@example.invalid'; env.view.password.value = 'New-Synthetic-123'
    env.calls[0].resolve({ challengeId: 'synthetic-challenge', expiresIn: 300, resendAfter: 60 }); await pending
    assert.equal(env.view.challenge.value, null)
    assert.equal(env.view.password.value, 'New-Synthetic-123')
    env.view.confirmation.value = 'New-Synthetic-123'; env.view.code.value = '123456'
    await env.view.submit()
    assert.equal(env.calls.length, 1)
    assert.match(env.view.error.value, /先申请邮件验证码/)
  } finally { env.dispose() }
})

test('登录迟到成功不能从已离开的页面跳转或清密码', async () => {
  const env = scene(), pending = env.view.submit()
  env.dispose(); env.calls[0].resolve(true); await pending
  assert.deepEqual(env.redirects, [])
  assert.equal(env.view.password.value, password)
})

test('登录迟到失败不回填旧错误，离页旧提交入口不发认证请求', async () => {
  const env = scene(), pending = env.view.submit()
  env.dispose(); env.calls[0].reject(Error('迟到合成认证失败')); await pending
  assert.equal(env.view.error.value, '')
  await env.view.submit()
  assert.equal(env.calls.length, 1)
})

test('当前注册使用对应邮箱/挑战/验证码，重复提交阻断，成功清确认密码并导航', async () => {
  const env = scene()
  try {
    env.view.registering.value = true
    const code = env.view.requestCode()
    env.calls[0].resolve({ challengeId: 'synthetic-challenge', expiresIn: 300, resendAfter: 60 }); await code
    env.view.code.value = '123456'; env.view.confirmation.value = password
    const pending = env.view.submit(); await env.view.submit()
    assert.equal(env.calls.length, 2)
    assert.equal(env.calls[1].kind, 'register')
    assert.deepEqual(env.calls[1].args, ['synthetic@example.invalid', password, 'synthetic-challenge', '123456'])
    env.calls[1].resolve(true); await pending
    assert.equal(env.view.confirmation.value, '')
    assert.deepEqual(env.redirects, ['/'])
  } finally { env.dispose() }
})
