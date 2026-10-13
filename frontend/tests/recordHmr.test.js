import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createPinia, setActivePinia, disposePinia } from 'pinia'
import { createApp, reactive, markRaw } from 'vue'

const sourceUrl = new URL('../src/stores/recordStore.js', import.meta.url)
const bill = { id: '9abf606b-a0d5-4053-98fb-194505f3d10c', type: 'expense', amount: '0.29',
  date: '2026-10-03', time: '09:15', category: '餐饮', note: '合成小票', version: 0 }
let moduleNumber = 0

async function scene(mode) {
  const saved = Object.fromEntries(['window', 'document', 'setInterval', 'clearInterval', '__recordHot', '__recordAuth'].map(key => [key, globalThis[key]]))
  const listeners = new Map(), timers = new Set(), values = new Map()
  let writes = 0, request = async () => ({ revision: '1', nextAfter: null, records: [{ record: bill }] })
  function target(prefix) {
    return {
      addEventListener(key, fn) { const name = prefix + key; if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
      removeEventListener(key, fn) { listeners.get(prefix + key)?.delete(fn) },
    }
  }
  globalThis.window = { ...target('window:'), localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes++; values.set(key, value) },
  } }
  values.set('zhizhang_mock_records', JSON.stringify([{ ...bill, amount: 0.29, remark: bill.note }]))
  globalThis.document = { ...target('document:'), visibilityState: 'visible' }
  globalThis.setInterval = fn => { timers.add(fn); return fn }
  globalThis.clearInterval = fn => timers.delete(fn)
  const hot = { data: {}, accept() {}, invalidate() { assert.fail('不得刷新页面丢失用户输入') } }
  globalThis.__recordHot = hot
  globalThis.__recordAuth = reactive({ user: { id: '1' }, api: markRaw({ request: (...args) => request(...args) }) })
  const pinia = createPinia(); createApp({}).use(pinia); setActivePinia(pinia)
  async function load() {
    let source = await readFile(sourceUrl, 'utf8')
    source = source.replace("import { SERVER_MODE } from '../api/mode.js'", `const SERVER_MODE = ${mode === 'server'}`)
      .replace("import { useAuthStore } from './authStore.js'", 'const useAuthStore = () => globalThis.__recordAuth')
      .replaceAll('import.meta.hot', 'globalThis.__recordHot')
      .replace(/from '([^']+)'/g, (_, path) => `from '${path.startsWith('.') ? new URL(path, sourceUrl).href : import.meta.resolve(path)}'`)
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleNumber++}`)
  }
  const first = await load(), store = first.useRecordStore(pinia)
  let definition = first.useRecordStore
  const update = first.createRecordStoreHMRHandler(hot)
  return {
    store, hot, timers, listeners, values, get writes() { return writes },
    setRequest(fn) { request = fn },
    async update() { const next = await load(); update(next); definition = next.useRecordStore; assert.equal(definition(pinia), store) },
    recreate() { return definition(pinia) },
    countListeners() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
    dispose() { disposePinia(pinia); for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } },
  }
}

test('正式账本连续热更新保留已读取快照，离线读取失败仍显示原账单', async () => {
  const env = await scene('server')
  try {
    assert.equal(await env.store.refresh(), true)
    const original = structuredClone(env.store.records.map(record => ({ ...record })))
    for (let index = 0; index < 3; index++) {
      await env.update()
      assert.deepEqual(env.store.records, original)
    }
    env.setRequest(async () => { throw Error('合成离线') })
    assert.equal(await env.store.refresh(), false)
    assert.deepEqual(env.store.records, original)
    assert.equal(env.writes, 0)
  } finally { env.dispose() }
})

for (const mode of ['demo', 'server']) test(`${mode}连续热更新只留一组时钟和监听，释放Store后全部移除`, async () => {
  const env = await scene(mode)
  try {
    const count = env.countListeners()
    assert.equal(env.timers.size, 1)
    for (let index = 0; index < 3; index++) {
      await env.update()
      assert.equal(env.countListeners(), count)
      assert.equal(env.timers.size, 1)
    }
    env.store.$dispose()
    assert.equal(env.countListeners(), 0)
    assert.equal(env.timers.size, 0)
    assert.equal(env.writes, 0)
  } finally { env.dispose() }
})

test('正式热更新撤销旧快照响应，换账号清缓存且保留浏览器意图原文', async () => {
  const env = await scene('server')
  try {
    await env.store.refresh()
    let complete
    env.setRequest(() => new Promise(resolve => { complete = resolve }))
    const pending = env.store.refresh(true)
    await env.update()
    complete({ revision: '2', nextAfter: null, records: [{ record: { ...bill, amount: '0.31', version: 1 } }] })
    assert.equal(await pending, false)
    assert.equal(env.store.records[0].amount, 0.29)
    env.values.set('miaoji_account_write_intents_v1_1', '{保留合成原文}')
    globalThis.__recordAuth.user = { id: '2' }
    assert.deepEqual(env.store.records, [])
    assert.deepEqual(env.store.manualRecovery, { operations: [], error: '' })
    assert.equal(env.values.get('miaoji_account_write_intents_v1_1'), '{保留合成原文}')
    env.setRequest(async () => ({ revision: '0', nextAfter: null, records: [] }))
    assert.equal(await env.store.refresh(), true)
    assert.equal(env.writes, 0)
  } finally { env.dispose() }
})

test('演示热更新保留删除事实与组关联，存储事件仍更新当前账本', async () => {
  const env = await scene('demo')
  try {
    const item = env.store.addRecord({ type: 'expense', amount: '0.31', category: '餐饮', date: bill.date, time: bill.time, remark: '合成删除' }, { batchId: 'synthetic-group' })
    env.store.deleteRecord(item.id)
    const writes = env.writes
    await env.update()
    assert.equal(env.store.records.length, 1)
    assert.equal(env.store.batchRecords('synthetic-group').length, 1)
    assert(env.store.batchRecords('synthetic-group')[0].deletedAt)
    env.values.set('zhizhang_mock_records', '[]')
    for (const listener of env.listeners.get('window:storage')) listener({ key: 'zhizhang_mock_records' })
    assert.deepEqual(env.store.records, [])
    assert.equal(env.writes, writes)
  } finally { env.dispose() }
})

test('释放正式Store后换账号再创建，不从Pinia残留状态恢复上个账号快照', async () => {
  const env = await scene('server')
  try {
    await env.store.refresh(); await env.update()
    env.store.$dispose()
    globalThis.__recordAuth.user = { id: '2' }
    const next = env.recreate()
    assert.deepEqual(next.records, [])
    assert.equal(env.timers.size, 1)
  } finally { env.dispose() }
})

test('正式旧编辑在热更新后返回，不覆盖当前快照或再发后续读取', async () => {
  const env = await scene('server')
  try {
    await env.store.refresh()
    let complete, reads = 0
    env.setRequest(method => {
      if (method === 'PUT') return new Promise(resolve => { complete = resolve })
      reads++; throw Error('不应自动读取')
    })
    const pending = env.store.updateRecord(bill.id, { type: bill.type, amount: '0.31', date: bill.date, time: bill.time, category: bill.category, remark: bill.note })
    const rejected = assert.rejects(pending, /身份已变化/)
    await env.update()
    complete({ ...bill, amount: '0.31', version: 1 })
    await rejected
    assert.equal(env.store.records[0].amount, 0.29)
    assert.equal(reads, 0)
    assert.equal(env.writes, 0)
  } finally { env.dispose() }
})

test('热更新后的正式时钟跨月仍更新汇总，快照保持且不请求网络', async () => {
  const OriginalDate = globalThis.Date
  let time = new OriginalDate('2026-10-31T12:00:00')
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [time.getTime()])) }
    static now() { return time.getTime() }
  }
  let env
  try {
    env = await scene('server')
    let reads = 0
    env.setRequest(async () => {
      reads++
      return { revision: '1', nextAfter: null, records: [
        { record: { ...bill, date: '2026-10-31' } },
        { record: { ...bill, id: '9abf606b-a0d5-4053-98fb-194505f3d10d', amount: '0.31', date: '2026-11-01' } },
      ] }
    })
    await env.store.refresh(); await env.update()
    assert.equal(env.store.monthExpense, 0.29)
    time = new OriginalDate('2026-11-01T12:00:00')
    for (const listener of env.listeners.get('window:focus')) listener()
    assert.equal(env.store.monthExpense, 0.31)
    assert.equal(env.store.records.length, 2)
    assert.equal(reads, 1)
    assert.equal(env.writes, 0)
  } finally { env?.dispose(); globalThis.Date = OriginalDate }
})
