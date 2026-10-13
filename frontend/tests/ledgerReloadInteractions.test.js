// 实际四页setup与共用重读helper，全部合成Store，不运行mounted或真实网络。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import dayjs from 'dayjs'
import * as navigation from '../src/utils/navigation.js'
import * as money from '../src/utils/money.js'
import * as journal from '../src/utils/journal.js'
import * as statistics from '../src/utils/statistics.js'
import * as localProfile from '../src/utils/localProfile.js'
import { getMonthReview } from '../src/utils/monthReview.js'
import { createProfileApi } from '../src/api/profile.js'
import { useLocalDay, useHomeCalendar } from '../src/utils/calendar.js'

function scene(page) {
  const scope = Vue.effectScope(), calls = [], auth = Vue.reactive({ user: { id: 'synthetic-owner' }, api: { request: () => assert.fail('禁止真实资料请求') } })
  const pending = [], store = Vue.reactive({ records: [], storageError: '', refresh: force => {
    calls.push(force); return new Promise((resolve, reject) => pending.push({ resolve, reject }))
  } })
  const route = Vue.reactive({ query: { month: '2026-10' } })
  const script = readFileSync(new URL('../src/views/' + page + '.vue', import.meta.url), 'utf8')
    .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const bindings = { ...Vue, ...navigation, ...money, ...journal, ...statistics, ...localProfile, dayjs, getMonthReview, createProfileApi,
    SERVER_MODE: true, useAuthStore: () => auth, useRecordStore: () => store, useRoute: () => route, useRouter: () => ({ replace: () => assert.fail('禁止自动导航') }),
    packageInfo: { version: 'synthetic' }, onMounted() {}, onBeforeUnmount() {},
    useLocalDay: () => useLocalDay({ eventTarget: null, documentTarget: null }),
    useHomeCalendar: () => useHomeCalendar({ eventTarget: null, documentTarget: null }) }
  const view = scope.run(() => new Function(...Object.keys(bindings), script + ';return { reloadRecords, reloadError, reloading }')(...Object.values(bindings)))
  return { view, auth, calls, pending, store, dispose: () => scope.stop() }
}

test('四页账本重读入口身份首次变化再切回，旧入口不访问新身份Store', async t => {
  for (const page of ['Home', 'Stats', 'Bills', 'Profile']) await t.test(page, async () => {
    const env = scene(page)
    try {
      env.auth.user = null; env.auth.user = { id: 'synthetic-owner' }
      const pending = env.view.reloadRecords(true)
      env.pending[0]?.resolve(true)
      assert.equal(await pending, false)
      assert.deepEqual(env.calls, [])
    } finally { env.dispose() }
  })
})

test('四页重读等待期间身份变化，迟到成功/返回false/拒绝均不回填旧状态', async t => {
  for (const page of ['Home', 'Stats', 'Bills', 'Profile']) await t.test(page, async () => {
    for (const outcome of ['success', 'false', 'reject']) {
      const env = scene(page)
      try {
        const pending = env.view.reloadRecords(true)
        assert.equal(env.view.reloading.value, true)
        env.auth.user = { id: 'other' }; env.auth.user = { id: 'synthetic-owner' }
        env.store.storageError = '新身份独立错误'
        if (outcome === 'reject') env.pending[0].reject(Error('合成旧请求失败'))
        else env.pending[0].resolve(outcome === 'success')
        const result = await pending
        assert.equal(env.view.reloadError.value, '')
        assert.equal(result, false)
        assert.equal(await env.view.reloadRecords(true), false)
        assert.deepEqual(env.calls, [true])
      } finally { env.dispose() }
    }
  })
})

test('带身份重读保留正常单次锁、force、失败重试与当前错误', async () => {
  const env = scene('Home')
  try {
    let pending = env.view.reloadRecords(true)
    assert.equal(await env.view.reloadRecords(true), false)
    env.pending[0].reject(Error('合成暂时离线')); assert.equal(await pending, false)
    assert.equal(env.view.reloading.value, false); assert.equal(env.view.reloadError.value, '合成暂时离线')
    pending = env.view.reloadRecords(); env.pending[1].resolve(true)
    assert.equal(await pending, true); assert.equal(env.view.reloadError.value, '')
    assert.deepEqual(env.calls, [true, false])
  } finally { env.dispose() }
})

test('无初始身份的重读实例不发请求，后续登录须由新页面实例接手', async () => {
  const scope = Vue.effectScope(), auth = Vue.reactive({ user: null }); let reads = 0
  const view = scope.run(() => navigation.useLedgerReload({ refresh: async () => { reads++; return true } }, { owner: () => auth.user?.id }))
  try {
    const before = await view.reloadRecords(true)
    auth.user = { id: 'synthetic' }; const after = await view.reloadRecords(true)
    assert.equal(reads, 0); assert.deepEqual([before, after], [false, false])
  } finally { scope.stop() }
})

test('带身份重读在离页后永久拒绝入口和迟到错误', async () => {
  const env = scene('Home'), pending = env.view.reloadRecords(true)
  env.dispose(); env.pending[0].reject(Error('合成迟到失败'))
  assert.equal(await pending, false); assert.equal(env.view.reloadError.value, '')
  assert.equal(await env.view.reloadRecords(true), false); assert.deepEqual(env.calls, [true])
})
