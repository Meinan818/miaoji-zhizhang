// Real Vue Router in memory + project guard + session; no browser or network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import dayjs from 'dayjs'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createSession } from '../src/api/session.js'
import { getScrollPosition, useStatsMonthNavigation, useLedgerReload } from '../src/utils/navigation.js'
import { centsText } from '../src/utils/money.js'
import { getMonthReview } from '../src/utils/monthReview.js'
import { useLocalDay } from '../src/utils/calendar.js'
import { getLoginReturnPath } from '../src/utils/loginRedirect.js'
import { getMonthStatistics } from '../src/utils/statistics.js'
import { getRecentDays } from '../src/utils/journal.js'
import { createProfileApi } from '../src/api/profile.js'
import { DEFAULT_PROFILE, readLocalProfile, saveLocalProfile } from '../src/utils/localProfile.js'

const source = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/component: \(\) => import\('[^']+'\)/g, 'component: {}')
  .replace('createWebHistory(import.meta.env.BASE_URL)', 'createMemoryHistory()')
  .replace('export default router', 'return router')
function scene({ delayedLedger = false, ledgerLoaded = true } = {}) {
  const reads = [], logins = [], ledger = []
  const watches = []
  let ledgerReads = 0
  const session = createSession({ request: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    login: () => new Promise(resolve => logins.push(resolve)) })
  const auth = Vue.reactive(session)
  const store = Vue.reactive({ records: [], storageError: ledgerLoaded ? '' : '合成读取失败', refresh: async () => {
    ledgerReads++
    if (delayedLedger) await new Promise((resolve, reject) => ledger.push(Object.assign(resolve, { reject })))
    return ledgerLoaded
  } })
  const watch = (...args) => {
    const entry = { active: true }, stop = Vue.watch(...args)
    watches.push(entry)
    return () => { entry.active = false; stop() }
  }
  const router = new Function('createRouter', 'createMemoryHistory', 'getScrollPosition', 'getLoginReturnPath', 'SERVER_MODE', 'useAuthStore', 'useRecordStore', 'watch', source)(
    createRouter, createMemoryHistory, getScrollPosition, getLoginReturnPath, true, () => auth, () => store, watch)
  return { router, auth, session, reads, logins, ledger, store, watches, setLedgerLoaded: value => { ledgerLoaded = value }, get ledgerReads() { return ledgerReads },
    flush: () => new Promise(resolve => setImmediate(resolve)) }
}
const account = { id: '1', username: 'synthetic' }
test('账本await期间退出并重新登录同账号，旧导航永久取消，新导航重新读取', async () => {
  const env = scene({ delayedLedger: true })
  env.session.expire(); await env.router.push('/login')
  const login = env.session.login('synthetic', 'synthetic-password'); env.logins[0](account); await login
  const pending = env.router.push('/bills?month=2026-09'); await env.flush()
  assert.equal(env.ledgerReads, 1)
  env.session.expire()
  const relogin = env.session.login('synthetic', 'synthetic-password'); env.logins[1](account); await relogin
  env.ledger[0](); await pending
  assert.equal(env.router.currentRoute.value.name, 'Login')
  assert.equal(env.ledgerReads, 1); assert.ok(env.watches.every(entry => !entry.active))
  const retry = env.router.push('/bills?month=2026-09'); await env.flush()
  env.ledger[1](); await retry
  assert.equal(env.router.currentRoute.value.name, 'Bills'); assert.equal(env.ledgerReads, 2)
  assert.ok(env.watches.every(entry => !entry.active))
})
test('同tick身份A到B再切回A，旧账本回执不能放行导航', async () => {
  const env = scene({ delayedLedger: true }), pending = env.router.push('/stats')
  await env.flush(); env.reads[0].resolve(account); await env.flush()
  env.auth.user = { id: '2', username: 'synthetic-other' }; env.auth.user = account
  env.ledger[0](); await pending
  assert.notEqual(env.router.currentRoute.value.name, 'Stats')
  assert.equal(env.ledgerReads, 1); assert.ok(env.watches.every(entry => !entry.active))
})
test('账本等待正常、异常及被新导航取代后，临时身份watch都释放', async () => {
  for (const outcome of ['success', 'error', 'superseded']) {
    const env = scene({ delayedLedger: true })
    env.router.onError(() => {})
    const pending = env.router.push('/bills'); const settled = pending.catch(error => error)
    await env.flush(); env.reads[0].resolve(account); await env.flush()
    assert.equal(env.watches.filter(entry => entry.active).length, 1)
    let latest
    if (outcome === 'superseded') { latest = env.router.push('/stats'); await env.flush() }
    if (outcome === 'error') env.ledger[0].reject(Error('synthetic-ledger-failure'))
    else env.ledger[0]()
    const result = await settled
    if (latest) { env.ledger[1](); await latest }
    if (outcome === 'error') assert.equal(result.message, 'synthetic-ledger-failure')
    else assert.equal(env.router.currentRoute.value.name, latest ? 'Stats' : 'Bills')
    assert.ok(env.watches.every(entry => !entry.active))
  }
})
test('并发导航共享正在恢复的身份，恢复前不误判访客，最新目的地保留', async () => {
  const env = scene(), first = env.router.push('/bills'); await env.flush()
  assert.equal(env.auth.status, 'loading'); assert.equal(env.reads.length, 1)
  const second = env.router.push('/stats'); await env.flush()
  const interimRoute = env.router.currentRoute.value.name
  env.reads[0].resolve(account); await Promise.all([first, second])
  assert.notEqual(interimRoute, 'Login')
  assert.equal(env.router.currentRoute.value.name, 'Stats'); assert.equal(env.reads.length, 1)
  assert.equal(env.ledgerReads, 1)
})
test('登录中的loading不会额外恢复身份，受保护目标仍需有效登录', async () => {
  const env = scene(), login = env.session.login('synthetic', 'synthetic-password')
  await env.router.push('/bills')
  assert.equal(env.router.currentRoute.value.name, 'Login'); assert.equal(env.reads.length, 0)
  assert.equal(env.ledgerReads, 0); env.logins[0](account); await login
})
test('共享恢复失败时最新受保护目标回登录，恢复后可再次导航', async () => {
  const env = scene(), first = env.router.push('/bills'); await env.flush()
  const second = env.router.push('/stats'); await env.flush()
  env.reads[0].reject(Error('synthetic-offline')); await env.flush()
  // Redirecting to Login may itself retry an unavailable session; finish that synthetic read.
  if (env.reads[1]) env.reads[1].reject(Error('synthetic-still-offline'))
  await Promise.all([first, second])
  assert.equal(env.router.currentRoute.value.name, 'Login'); assert.equal(env.auth.user, null)
  assert.equal(env.ledgerReads, 0)
  const retry = env.router.push('/stats'); await env.flush(); env.reads.at(-1).resolve(account); await retry
  assert.equal(env.router.currentRoute.value.name, 'Stats'); assert.equal(env.ledgerReads, 1)
})
test('账本等待期间身份失效，迟到读取不再放行受保护页面', async () => {
  const env = scene({ delayedLedger: true }), pending = env.router.push('/bills'); await env.flush()
  env.reads[0].resolve(account); await env.flush(); assert.equal(env.ledgerReads, 1)
  env.session.expire(); env.ledger[0](); await pending
  assert.equal(env.router.currentRoute.value.name, 'Login'); assert.equal(env.auth.user, null)
})
test('访客跳登录保留明细完整目的地，已认证访问登录返回安全站内目标', async () => {
  const env = scene(), target = '/bills?month=2026-09&q=coffee#receipt'
  env.session.expire(); await env.router.push(target)
  assert.equal(env.router.currentRoute.value.name, 'Login')
  assert.equal(env.router.currentRoute.value.query.redirect, target)
  const login = env.session.login('synthetic', 'synthetic-password'); env.logins[0](account); await login
  // Visit a new login URL; pushing the current identical URL skips guards in Vue Router.
  await env.router.push({ name: 'Login', query: { redirect: target, visit: 'synthetic' } })
  assert.equal(env.router.currentRoute.value.fullPath, target)
  await env.router.push({ name: 'Login', query: { redirect: '//example.test' } })
  assert.equal(env.router.currentRoute.value.name, 'Home')
})

function mountStats(env, server = true) {
  const scope = Vue.effectScope(), mounted = []
  const script = readFileSync(new URL('../src/views/Stats.vue', import.meta.url), 'utf8')
    .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const bindings = { ...Vue, dayjs, centsText, getMonthReview, useStatsMonthNavigation, useLedgerReload, SERVER_MODE: server,
    onMounted: callback => mounted.push(callback), useRecordStore: () => env.store, useAuthStore: () => env.auth,
    useRoute: () => ({ get query() { return env.router.currentRoute.value.query } }), useRouter: () => env.router,
    useLocalDay: () => useLocalDay({ eventTarget: null, documentTarget: null }) }
  const view = scope.run(() => new Function(...Object.keys(bindings), script + ';return {reloadRecords, reloadError, error}')(...Object.values(bindings)))
  return { view, async runMounted() { for (const callback of mounted) await callback() }, dispose: () => scope.stop() }
}

test('真实guard进入正式Stats后，mounted复用本次读取，不再请求第二次账本', async () => {
  const env = scene(), navigation = env.router.push('/stats?month=2026-09')
  await env.flush(); env.reads[0].resolve(account); await navigation
  const stats = mountStats(env)
  try {
    assert.equal(env.ledgerReads, 1)
    await stats.runMounted()
    assert.equal(env.ledgerReads, 1)
    assert.equal(stats.view.error.value, '')
  } finally { stats.dispose() }
})

test('正式guard读取失败时Stats保持错误和显式重试，不在mounted后台追加请求', async () => {
  const env = scene({ ledgerLoaded: false }), navigation = env.router.push('/stats')
  await env.flush(); env.reads[0].resolve(account); await navigation
  const stats = mountStats(env)
  try {
    await stats.runMounted()
    assert.equal(env.ledgerReads, 1); assert.equal(stats.view.error.value, '合成读取失败')
    env.setLedgerLoaded(true); env.store.storageError = ''
    assert.equal(await stats.view.reloadRecords(true), true)
    assert.equal(env.ledgerReads, 2); assert.equal(stats.view.error.value, '')
  } finally { stats.dispose() }
})

test('演示Stats没有正式guard，mounted仍正常读取本地账本', async () => {
  const env = scene(), stats = mountStats(env, false)
  try { await stats.runMounted(); assert.equal(env.ledgerReads, 1); assert.equal(stats.view.error.value, '') }
  finally { stats.dispose() }
})

function mountProfile(env, server = true) {
  const scope = Vue.effectScope(), mounted = [], cleanup = [], profileReads = []
  const script = readFileSync(new URL('../src/views/Profile.vue', import.meta.url), 'utf8')
    .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  env.auth.api = { async request(method, path) {
    profileReads.push({ method, path })
    assert.equal(method, 'GET'); assert.equal(path, '/api/profile')
    return { nickname: '合成账号名片', signature: '合成签名', avatar: 'cat', version: 0 }
  } }
  const bindings = { ...Vue, dayjs, centsText, getMonthStatistics, getRecentDays, useLedgerReload,
    createProfileApi, DEFAULT_PROFILE, readLocalProfile, saveLocalProfile, SERVER_MODE: server,
    createProfilePhoto() { assert.fail('不可读取真实照片') }, packageInfo: { version: 'synthetic' },
    window: { localStorage: { getItem: () => null } },
    onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => cleanup.push(callback),
    useRecordStore: () => env.store, useAuthStore: () => env.auth,
    useLocalDay: () => useLocalDay({ eventTarget: null, documentTarget: null }) }
  const view = scope.run(() => new Function(...Object.keys(bindings), script + ';return { reloadRecords, error, profile, profileError }')(...Object.values(bindings)))
  return { view, profileReads, async runMounted() { for (const callback of mounted) await callback(); await env.flush() },
    dispose() { cleanup.forEach(callback => callback()); scope.stop() } }
}

test('真实guard进入正式Profile后mounted复用账本读取，独立读取账号资料保持', async () => {
  const env = scene(), navigation = env.router.push('/profile')
  await env.flush(); env.reads[0].resolve(account); await navigation
  const profile = mountProfile(env)
  try {
    assert.equal(env.ledgerReads, 1)
    await profile.runMounted()
    assert.equal(env.ledgerReads, 1)
    assert.deepEqual(profile.profileReads, [{ method: 'GET', path: '/api/profile' }])
    assert.equal(profile.view.profile.value.nickname, '合成账号名片')
    assert.equal(profile.view.profileError.value, ''); assert.equal(profile.view.error.value, '')
  } finally { profile.dispose() }
})

test('Profile guard账本失败不会mounted后台重试；资料独立显示，显式重读可恢复', async () => {
  const env = scene({ ledgerLoaded: false }), navigation = env.router.push('/profile')
  await env.flush(); env.reads[0].resolve(account); await navigation
  const profile = mountProfile(env)
  try {
    await profile.runMounted()
    assert.equal(env.ledgerReads, 1); assert.equal(profile.view.error.value, '合成读取失败')
    assert.equal(profile.view.profile.value.nickname, '合成账号名片')
    env.setLedgerLoaded(true); env.store.storageError = ''
    assert.equal(await profile.view.reloadRecords(true), true)
    assert.equal(env.ledgerReads, 2); assert.equal(profile.view.error.value, '')
    assert.equal(profile.profileReads.length, 1)
  } finally { profile.dispose() }
})

test('演示Profile无正式guard时mounted仍读本地账本及本地名片，不请求账号资料', async () => {
  const env = scene(), profile = mountProfile(env, false)
  try {
    await profile.runMounted()
    assert.equal(env.ledgerReads, 1); assert.deepEqual(profile.profileReads, [])
    assert.equal(profile.view.profile.value.nickname, DEFAULT_PROFILE.nickname)
    assert.equal(profile.view.error.value, '')
  } finally { profile.dispose() }
})
