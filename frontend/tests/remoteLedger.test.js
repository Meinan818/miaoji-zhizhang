import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref } from 'vue'
import { createRemoteLedger } from '../src/api/remoteLedger.js'
import { createApiClient } from '../src/api/client.js'
import { createProfileApi, fromProfileView } from '../src/api/profile.js'
import { linkGroupRecords } from '../src/utils/groupRecords.js'
const id = '9abf606b-a0d5-4053-98fb-194505f3d10c'
const value = { id, type: 'expense', amount: '0.29', date: '2026-10-03', time: '09:15', category: '餐饮', note: '合成午饭', version: 0 }
const input = { id: 'item1', type: value.type, amount: value.amount, date: value.date, time: value.time, category: value.category, remark: value.note }

for (const split of [false, true]) {
  test(`同一UUID的大小写别名不能在${split ? '跨页' : '同页'}重复计入，拒读保完整旧账本`, async () => {
    let bad = false
    const scene = setup({ request: async (_method, path) => {
      if (!bad) return { revision: '0', nextAfter: null, records: [{ record: value }] }
      const upper = { record: { ...value, id: id.toUpperCase() } }
      if (!split) return { revision: '1', nextAfter: null, records: [upper, { record: value }] }
      return new URL(path, 'http://localhost').searchParams.has('after')
        ? { revision: '1', nextAfter: null, records: [{ record: value }] }
        : { revision: '1', nextAfter: id.toUpperCase(), records: [upper] }
    } })
    try {
      assert.equal(await scene.store.refresh(), true)
      const original = scene.store.allRecords.value
      bad = true
      assert.equal(await scene.store.refresh(true), false)
      assert.match(scene.store.storageError.value, /重复/)
      assert.strictEqual(scene.store.allRecords.value, original)
    } finally { scene.dispose() }
  })
}

for (const deleted of [false, true]) {
  test(`UUID换大小写仍拒绝${deleted ? '删除终态丢失' : '单笔版本倒退'}`, async () => {
    let changed = false
    const scene = setup({ request: async () => ({ revision: changed ? '3' : '2', nextAfter: null,
      records: [{ record: { ...value, id: changed ? id.toUpperCase() : id, version: changed && !deleted ? 1 : 2 },
        deletedAt: deleted && !changed ? '2026-10-04T00:00:00Z' : null }] }) })
    try {
      assert.equal(await scene.store.refresh(), true)
      const original = JSON.parse(JSON.stringify(scene.store.allRecords.value))
      changed = true
      assert.equal(await scene.store.refresh(true), false)
      assert.match(scene.store.storageError.value, deleted ? /已删除账单.*不一致/ : /账单版本.*倒退/)
      assert.deepEqual(JSON.parse(JSON.stringify(scene.store.allRecords.value)), original)
    } finally { scene.dispose() }
  })
}

test('旧已保存聊天的大小写UUID仍按原顺序关联当前编辑和删除事实，演示编号保持区分', async () => {
  const secondId = 'aabf606b-a0d5-4053-98fb-194505f3d10c'
  const scene = setup({ request: async () => ({ revision: '1', nextAfter: null,
    records: [{ record: { ...value, amount: '0.31', version: 1 } },
      { record: { ...value, id: secondId, version: 1 }, deletedAt: '2026-10-04T00:00:00Z' }] }) })
  try {
    assert.equal(await scene.store.refresh(), true)
    const group = { id: 'saved-case', recordIds: [secondId.toUpperCase(), id.toUpperCase()], items: [{ id: 'item2' }, { id: 'item1' }] }
    const linked = linkGroupRecords(group, scene.store.recordsByIds(group.recordIds))
    assert.equal(linked.length, 2)
    assert.equal(linked[0].id, secondId); assert.ok(linked[0].deletedAt); assert.equal(linked[0].draftItemId, 'item2')
    assert.equal(linked[1].id, id); assert.equal(linked[1].amount, 0.31); assert.equal(linked[1].draftItemId, 'item1')
    assert.equal(linkGroupRecords({ id: 'demo', recordIds: ['A', 'a'], items: [{ id: 'one' }, { id: 'two' }] },
      [{ id: 'A', amount: 1 }, { id: 'a', amount: 2 }])[0].amount, 1)
  } finally { scene.dispose() }
})

test('合法大小写回执和分页游标指向同笔，刷新及编辑保草稿关联', async () => {
  let uppercase = true, revision = '1'
  const secondId = 'aabf606b-a0d5-4053-98fb-194505f3d10c'
  const reads = []
  const scene = setup({ request: async (method, path, options) => {
    if (method === 'PUT' && path.startsWith('/api/drafts/')) return { id: path.split('/').at(-1), version: 0, status: 'OPEN', records: options.body.records }
    if (method === 'POST') return { records: [{ ...value, id: id.toUpperCase() }] }
    if (method === 'PUT') return { ...value, ...options.body.record, id: id.toUpperCase(), version: 1 }
    const after = new URL(path, 'http://localhost').searchParams.get('after')
    reads.push(after)
    return after ? { revision, nextAfter: null, records: [{ record: { ...value, id: secondId.toUpperCase() } }] }
      : { revision, nextAfter: id, records: [{ record: { ...value, id: uppercase ? id.toUpperCase() : id } }] }
  } })
  try {
    const saved = await scene.store.addRecords([input], { batchId: 'case-group' })
    assert.equal(saved[0].id, id)
    assert.deepEqual(reads, [null, id])
    assert.equal(scene.store.batchRecords('case-group')[0].draftItemId, 'item1')
    uppercase = false; revision = '2'
    assert.equal(await scene.store.refresh(true), true)
    const record = scene.store.batchRecords('case-group')[0]
    assert.equal(record.id, id); assert.equal(record.source, 'chat'); assert.equal(record.draftItemId, 'item1')
    const updated = await scene.store.updateRecord(id, { ...input, amount: '0.31' })
    assert.equal(updated.id, id); assert.equal(updated.amount, 0.31)
    assert.equal(updated.draftGroupId, 'case-group'); assert.equal(updated.draftItemId, 'item1')
  } finally { scene.dispose() }
})

test('明细版本冲突读取最新账单供对照，旧编辑版本和输入仍由调用者保持', async () => {
  let amount = '0.29', version = 0
  const scene = setup({ request: async (method, path, options) => {
    if (method === 'PUT') throw Object.assign(Error('账单已变化'), { code: 'STALE_VERSION', status: 409 })
    return { revision: String(version), nextAfter: null, records: [{ record: { ...value, amount, version } }] }
  } })
  try {
    await scene.store.refresh()
    const original = { ...scene.store.records.value[0] }
    amount = '0.31'; version = 1
    let failure
    try { await scene.store.updateRecord(id, { ...input, amount: '0.35' }, { version: original.version }) } catch (error) { failure = error }
    assert.equal(failure.recoveryLoaded, true)
    assert.equal(failure.currentRecord.amount, 0.31)
    assert.equal(scene.store.records.value[0].version, 1)
    assert.equal(original.version, 0)
    assert.equal(original.amount, 0.29)
  } finally { scene.dispose() }
})

test('明细删除冲突发现服务器已删除，恢复回执不把旧账单重新加入', async () => {
  let deleted = false
  const scene = setup({ request: async (method) => {
    if (method === 'DELETE') throw Object.assign(Error('账单已变化'), { code: 'STALE_VERSION', status: 409 })
    return { revision: deleted ? '1' : '0', nextAfter: null, records: [{ record: value, deletedAt: deleted ? '2026-10-04T00:00:00Z' : null }] }
  } })
  try {
    await scene.store.refresh(); deleted = true
    await assert.rejects(scene.store.deleteRecord(id), failure => failure.recoveryLoaded === true && failure.currentRecord === null)
    assert.equal(scene.store.records.value.length, 0)
  } finally { scene.dispose() }
})

test('冲突后读取失败仍抛原版本错误，保留原账单不冒称已读最新', async () => {
  let reads = 0
  const scene = setup({ request: async method => {
    if (method === 'PUT') throw Object.assign(Error('账单已变化'), { code: 'STALE_VERSION' })
    if (++reads > 1) throw Error('合成读取中断')
    return { revision: '0', nextAfter: null, records: [{ record: value }] }
  } })
  try {
    await scene.store.refresh()
    await assert.rejects(scene.store.updateRecord(id, input), failure => failure.code === 'STALE_VERSION' && !failure.recoveryLoaded)
    assert.equal(scene.store.records.value[0].version, 0)
    assert.match(scene.store.storageError.value, /读取中断/)
  } finally { scene.dispose() }
})

test('冲突恢复期间账号改变不把新账号账单附给旧编辑错误', async () => {
  let reads = 0, resolve
  const scene = setup({ request: async method => {
    if (method === 'PUT') throw Object.assign(Error('账单已变化'), { code: 'STALE_VERSION' })
    if (++reads > 1) return new Promise(done => { resolve = done })
    return { revision: '0', nextAfter: null, records: [{ record: value }] }
  } })
  try {
    await scene.store.refresh()
    const pending = scene.store.updateRecord(id, input)
    while (!resolve) await new Promise(done => setImmediate(done))
    scene.owner.value = '2'
    resolve({ revision: '1', nextAfter: null, records: [{ record: { ...value, version: 1 } }] })
    await assert.rejects(pending, failure => !failure.recoveryLoaded && !failure.currentRecord)
    assert.equal(scene.store.records.value.length, 0)
  } finally { scene.dispose() }
})
function setup(client) {
  const owner = ref('1'), scope = effectScope(), values = new Map()
  const store = scope.run(() => createRemoteLedger(client, owner, { storage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } }))
  return { store, owner, values, dispose: () => scope.stop() }
}
test('手动回执丢失重开恢复原键，读失败仍待恢复，完成后不覆盖已删除事实', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const keys = []; let lost = true, readFail = false
  const client = { request: async (method, path, options) => {
    if (method === 'PUT') return { id: path.split('/').at(-1), version: 0, status: 'CONFIRMED', records: options.body.records }
    if (method === 'POST') {
      keys.push(options.headers['Idempotency-Key'])
      if (lost) throw Error('合成确认回执丢失')
      return { records: [value] }
    }
    if (readFail) throw Error('合成快照读取失败')
    return { revision: '1', nextAfter: null, records: [{ record: value, deletedAt: '2026-10-04T00:00:00Z' }] }
  } }
  let scope = effectScope(), owner = ref('1')
  let store = scope.run(() => createRemoteLedger(client, owner, { storage }))
  await assert.rejects(store.addRecord(input, { batchId: 'manual-original' }), /回执丢失/)
  scope.stop()
  scope = effectScope()
  store = scope.run(() => createRemoteLedger(client, owner, { storage }))
  try {
    const [operation] = store.manualRecovery.value.operations
    assert.equal(operation.batchId, 'manual-original')
    lost = false; readFail = true
    await assert.rejects(store.addRecord(operation.record, { batchId: operation.batchId }), /已确认保存/)
    assert.equal(store.manualRecovery.value.operations.length, 1)
    readFail = false
    await store.addRecord(operation.record, { batchId: operation.batchId })
    assert.equal(new Set(keys).size, 1)
    assert.equal(store.records.value.length, 0)
    assert.ok(store.recordsByIds([id])[0].deletedAt)
    assert.equal(store.manualRecovery.value.operations.length, 0)
    owner.value = '2'
    assert.equal(store.manualRecovery.value.operations.length, 0)
  } finally { scope.stop() }
})
test('正式账本不读取演示数据，删除事实排除汇总但保留卡片定位', async () => {
  const test = setup({ request: async () => ({ revision: '0', nextAfter: null, records: [{ record: value, deletedAt: '2026-10-03T01:00:00Z' }] }) })
  try { assert.equal(await test.store.refresh(), true); assert.equal(test.store.records.value.length, 0); assert.equal(test.store.recordsByIds([id])[0].deletedAt, '2026-10-03T01:00:00Z'); assert.throws(() => test.store.clearRecords(), /不提供/) }
  finally { test.dispose() }
})

test('另一标签页改变当前账号意图时更新恢复列表，其他账号事件忽略且离页解绑', () => {
  const values = new Map(), owner = ref('1'), scope = effectScope(), listeners = new Map()
  const events = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) } }
  const store = scope.run(() => createRemoteLedger({}, owner, { storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }, eventTarget: events }))
  try {
    assert.deepEqual(store.manualRecovery.value.operations, [])
    values.set('miaoji_account_write_intents_v1_1', JSON.stringify({ 'manual-original': { requestId: id, content: JSON.stringify({ records: [{ type: 'expense', amount: '0.29', date: '2026-10-03', time: '09:15', category: '餐饮', note: '合成午饭' }] }) } }))
    const listener = listeners.get('storage')
    assert.equal(typeof listener, 'function')
    listener({ key: 'miaoji_account_write_intents_v1_2' })
    assert.equal(store.manualRecovery.value.operations.length, 0)
    listener({ key: 'miaoji_account_write_intents_v1_1' })
    assert.equal(store.manualRecovery.value.operations.length, 1)
    owner.value = '2'
    assert.equal(store.manualRecovery.value.operations.length, 0)
  } finally { scope.stop() }
  assert.equal(listeners.size, 0)
})

test('账本版本未变时跨月仍更新本月汇总，保留完整记录且不写入', async () => {
  const OriginalDate = globalThis.Date
  let time = new OriginalDate('2026-10-31T12:00:00'), reads = 0
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [time.getTime()])) }
    static now() { return time.getTime() }
  }
  const listeners = new Map(), events = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  const scope = effectScope(), owner = ref('1'), storage = { getItem: () => null, setItem: () => { throw Error('禁止写入') } }
  const store = scope.run(() => createRemoteLedger({ request: async method => {
    assert.equal(method, 'GET'); reads++
    return { revision: '0', nextAfter: null, records: [{ record: { ...value, date: '2026-10-31' } },
      { record: { ...value, id: 'eabf606b-a0d5-4053-98fb-194505f3d10c', amount: '0.31', date: '2026-11-01' } }] }
  } }, owner, { storage, dateClock: { eventTarget: events, documentTarget: events,
    timers: { setInterval: () => 1, clearInterval: () => {} } } }))
  try {
    await store.refresh()
    assert.equal(store.monthExpense.value, 0.29)
    time = new OriginalDate('2026-11-01T12:00:00')
    listeners.get('focus')?.()
    await store.refresh()
    assert.equal(store.monthExpense.value, 0.31)
    assert.equal(store.records.value.length, 2)
    assert.equal(reads, 2)
  } finally { scope.stop(); globalThis.Date = OriginalDate }
})
test('重开页面后按回执ID恢复组条目关联，顺序变化及删除不丢最新事实', () => {
  const group = { id: 'g', recordIds: ['a', 'b'], items: [{ id: 'item1' }, { id: 'item2' }] }
  const linked = linkGroupRecords(group, [{ id: 'b', deletedAt: 'synthetic' }, { id: 'a', amount: 12 }])
  assert.equal(linked[0].draftItemId, 'item1'); assert.equal(linked[0].amount, 12)
  assert.equal(linked[1].draftItemId, 'item2'); assert.equal(linked[1].deletedAt, 'synthetic')
})
test('重放回执及读取失败不恢复已删除账单或覆盖当前编辑', async () => {
  let offline = false
  const test = setup({ request: async (method, path, options) => {
    if (method === 'PUT') return { id: path.split('/').at(-1), version: 0, status: 'OPEN', records: options.body.records }
    if (path.endsWith('/confirm')) return { records: [value] }
    return offline ? Promise.reject(Error('offline')) : { revision: '0', nextAfter: null, records: [{ record: { ...value, amount: '0.30', version: 2 }, deletedAt: '2026-10-03T01:00:00Z' }] }
  } })
  try {
    await test.store.refresh(); offline = true
    await assert.rejects(test.store.addRecords([input], { batchId: 'g' }), /服务器已确认/)
    assert.equal(test.store.records.value.length, 0); assert.equal(test.store.recordsByIds([id])[0].amount, 0.30)
    offline = false
    const replay = await test.store.addRecords([input], { batchId: 'g' })
    assert.equal(replay[0].amount, 0.29); assert.equal(replay[0].version, 0)
    const current = test.store.recordsByIds([id])[0]
    assert.equal(current.amount, 0.30); assert.equal(current.version, 2); assert.ok(current.deletedAt)
    assert.equal(current.draftGroupId, 'g'); assert.equal(current.draftItemId, 'item1')
    assert.equal(test.store.records.value.length, 0)
  } finally { test.dispose() }
})
test('确认后快照缺入账编号拒绝完成并保旧账本，原键恢复允许最新编辑与删除', async () => {
  const otherId = 'aabf606b-a0d5-4053-98fb-194505f3d10c'
  const original = [{ ...value }, { ...value, id: otherId, amount: '0.30', note: '合成咖啡' }]
  const inputs = [input, { ...input, id: 'item2', amount: '0.30', remark: '合成咖啡' }]
  for (const manual of [false, true]) {
    const submitted = manual ? inputs.slice(0, 1) : inputs
    const receipt = manual ? original.slice(0, 1) : original
    let phase = 'before'
    const keys = [], puts = []
    const scene = setup({ request: async (method, path, options) => {
      if (method === 'PUT') { puts.push(options.body); return { id: path.split('/').at(-1), version: 0, status: 'CONFIRMED', records: options.body.records } }
      if (method === 'POST') { keys.push(options.headers['Idempotency-Key']); return { records: receipt } }
      return { revision: phase === 'before' ? '0' : '1', nextAfter: null,
        records: phase === 'before' ? [{ record: { ...value, amount: '0.50' } }]
          : phase === 'missing' ? (manual ? [] : [{ record: original[1] }])
          : receipt.map((record, index) => ({ record: { ...record, amount: index ? record.amount : '0.31', version: 1 },
            ...(index === receipt.length - 1 ? { deletedAt: '2026-10-04T01:00:00Z' } : {}) })) }
    } })
    try {
      await scene.store.refresh(); const before = scene.store.allRecords.value
      phase = 'missing'; const batchId = manual ? 'manual-missing' : 'missing'
      await assert.rejects(scene.store.addRecords(submitted, { batchId }), /服务器已确认.*最新账本/)
      assert.strictEqual(scene.store.allRecords.value, before)
      assert.match(scene.store.storageError.value, /缺少已确认账单/)
      if (manual) assert.equal(scene.store.manualRecovery.value.operations.length, 1)
      phase = 'restored'
      await scene.store.addRecords(submitted, { batchId })
      assert.equal(new Set(keys).size, 1); assert.deepEqual(puts[0], puts[1])
      assert.equal(scene.store.recordsByIds(receipt.map(record => record.id)).length, receipt.length)
      assert.equal(scene.store.recordsByIds([id])[0].amount, 0.31)
      assert.equal(scene.store.recordsByIds([id])[0].version, 1)
      assert.equal(scene.store.records.value.length, manual ? 0 : 1)
      if (manual) assert.equal(scene.store.manualRecovery.value.operations.length, 0)
    } finally { scene.dispose() }
  }
})

test('账号改变立即清内存，旧账号迟到响应不进入新账本', async () => {
  let resolve
  const test = setup({ request: () => new Promise(done => { resolve = done }) })
  try { const pending = test.store.refresh(); test.owner.value = '2'; resolve({ revision: '0', nextAfter: null, records: [{ record: value }] }); assert.equal(await pending, false); assert.equal(test.store.records.value.length, 0) }
  finally { test.dispose() }
})
test('写入必须等待新快照，不能用先前正在读取的旧账本报告同步', async () => {
  let resolve; let reads = 0
  const test = setup({ request: async (method, path, options) => {
    if (method === 'PUT') return { id: path.split('/').at(-1), version: 0, status: 'OPEN', records: options.body.records }
    if (path.endsWith('/confirm')) return { records: [value] }
    reads++; if (reads === 1) return new Promise(done => { resolve = done })
    return { revision: '0', nextAfter: null, records: [{ record: value, deletedAt: null }] }
  } })
  try {
    const previous = test.store.refresh(); const save = test.store.addRecords([input], { batchId: 'g' })
    await Promise.resolve(); resolve({ revision: '0', nextAfter: null, records: [] }); await previous; await save
    assert.equal(reads, 2); assert.equal(test.store.records.value.length, 1); assert.equal(test.store.batchRecords('g').length, 1)
  } finally { test.dispose() }
})
test('旧编辑版本用于改删，不借用刷新后的新版本覆盖其他修改', async () => {
  const writes = []
  const test = setup({ request: async (...args) => {
    if (args[0] === 'GET') return { revision: '0', nextAfter: null, records: [{ record: { ...value, version: 3 } }] }
    writes.push(args); throw Error('stale')
  } })
  try {
    await test.store.refresh(); await assert.rejects(test.store.updateRecord(id, input, { version: 0 })); await assert.rejects(test.store.deleteRecord(id, { version: 0 }))
    assert.equal(writes[0][2].body.version, 0); assert.match(writes[1][1], /version=0$/)
    assert.equal(test.store.records.value[0].version, 3)
  } finally { test.dispose() }
})
test('畸形快照及网络失败保护最后已确认账本，不写浏览器演示键', async () => {
  let snapshot = { revision: '0', nextAfter: null, records: [{ record: value }] }
  const test = setup({ request: async () => snapshot })
  try {
    await test.store.refresh(); snapshot = { revision: '0', nextAfter: null, records: [{ record: value }, { record: value }] }
    assert.equal(await test.store.refresh(), false); assert.equal(test.store.records.value.length, 1); assert.equal(test.values.size, 0)
  } finally { test.dispose() }
})
test('旧revision重读与force均保当前编辑和删除，超安全整数版本不丢精度且账号隔离', async () => {
  for (const [latest, older] of [['10', '9'], ['9007199254740993', '9007199254740992']]) {
    let revision = latest, current = true
    const scene = setup({ request: async () => ({ revision, nextAfter: null,
      records: [{ record: { ...value, amount: current ? '0.31' : '0.29', version: current ? 2 : 0 },
        ...(current ? { deletedAt: '2026-10-04T01:00:00Z' } : {}) }] }) })
    try {
      await scene.store.refresh(); const original = scene.store.allRecords.value
      revision = older; current = false
      for (const force of [false, true]) {
        assert.equal(await scene.store.refresh(force), false)
        assert.strictEqual(scene.store.allRecords.value, original)
        assert.equal(scene.store.records.value.length, 0)
        assert.match(scene.store.storageError.value, /账本版本.*倒退/)
      }
      revision = latest; current = true
      assert.equal(await scene.store.refresh(true), true)
      assert.equal(scene.store.recordsByIds([id])[0].version, 2)
      scene.owner.value = '2'; revision = '0'; current = false
      assert.equal(await scene.store.refresh(), true)
      assert.equal(scene.store.records.value[0].amount, 0.29)
    } finally { scene.dispose() }
  }
})

test('revision严格按Java非负Long字符串，非法超范围版本不替换或污染后续恢复', async () => {
  let revision = '10'
  const scene = setup({ request: async () => ({ revision, nextAfter: null, records: [{ record: value }] }) })
  try {
    await scene.store.refresh(); const original = scene.store.allRecords.value
    for (const invalid of ['00', '01', '9223372036854775808', '9'.repeat(1000)]) {
      revision = invalid
      assert.equal(await scene.store.refresh(true), false)
      assert.strictEqual(scene.store.allRecords.value, original)
      assert.match(scene.store.storageError.value, /账本分页回执不完整/)
      revision = '10'; assert.equal(await scene.store.refresh(), true)
    }
    revision = '9223372036854775807'; assert.equal(await scene.store.refresh(true), true)
  } finally { scene.dispose() }
})

test('本页编辑删除使缓存失效后仍拒绝已知较旧revision', async () => {
  for (const remove of [false, true]) {
    let revision = '10'
    const scene = setup({ request: async (method, path, options) => {
      if (method === 'PUT') return { ...value, ...options.body.record, version: 1 }
      if (method === 'DELETE') return null
      return { revision, nextAfter: null, records: [{ record: value }] }
    } })
    try {
      await scene.store.refresh()
      if (remove) await scene.store.deleteRecord(id)
      else await scene.store.updateRecord(id, { ...input, amount: '0.35' })
      const original = scene.store.allRecords.value; revision = '9'
      assert.equal(await scene.store.refresh(true), false)
      assert.strictEqual(scene.store.allRecords.value, original)
      assert.equal(scene.store.recordsByIds([id])[0].version, 1)
      assert.equal(scene.store.records.value.length, remove ? 0 : 1)
      if (!remove) assert.equal(scene.store.records.value[0].amount, 0.35)
    } finally { scene.dispose() }
  }
})

test('新revision或缓存同版本夹带旧单笔version均保当前编辑与删除', async () => {
  for (const deleted of [false, true]) {
    for (const nextRevision of ['10', '11']) {
      let revision = '10', version = 2, amount = '0.31'
      const scene = setup({ request: async () => ({ revision, nextAfter: null, records: [{ record: { ...value, amount, version },
        ...(deleted && version === 2 ? { deletedAt: '2026-10-04T01:00:00Z' } : {}) }] }) })
      try {
        await scene.store.refresh(); const original = scene.store.allRecords.value
        revision = nextRevision; version = 1; amount = '0.29'
        for (const force of [false, true]) {
          assert.equal(await scene.store.refresh(force), false)
          assert.strictEqual(scene.store.allRecords.value, original)
          assert.match(scene.store.storageError.value, /账单版本.*倒退/)
          assert.equal(scene.store.recordsByIds([id])[0].amount, 0.31)
          assert.equal(scene.store.records.value.length, deleted ? 0 : 1)
        }
        revision = '11'; version = 2; amount = '0.31'
        assert.equal(await scene.store.refresh(true), true)
        assert.equal(scene.store.recordsByIds([id])[0].version, 2)
      } finally { scene.dispose() }
    }
  }
})

test('本页编辑后更高revision不能带回旧单笔version', async () => {
  let revision = '10'
  const scene = setup({ request: async (method, path, options) => method === 'PUT'
    ? { ...value, ...options.body.record, version: 1 }
    : { revision, nextAfter: null, records: [{ record: value }] } })
  try {
    await scene.store.refresh(); await scene.store.updateRecord(id, { ...input, amount: '0.35' })
    const original = scene.store.allRecords.value; revision = '11'
    assert.equal(await scene.store.refresh(), false)
    assert.strictEqual(scene.store.allRecords.value, original)
    assert.equal(scene.store.records.value[0].amount, 0.35)
  } finally { scene.dispose() }
})

test('已删除账单不能因删除状态缺失而复活，兼容合法服务端删除时间精度', async () => {
  for (const nextVersion of [2, 3]) {
    let revision = '10', version = 2, deletedAt = '2026-10-04T01:00:00Z'
    const scene = setup({ request: async () => ({ revision, nextAfter: null,
      records: [{ record: { ...value, version }, ...(deletedAt !== undefined ? { deletedAt } : {}) }] }) })
    try {
      await scene.store.refresh(); const original = scene.store.allRecords.value
      for (const nextRevision of ['10', '11']) {
        revision = nextRevision; version = nextVersion
        for (const missing of [undefined, null]) {
          deletedAt = missing
          for (const force of [false, true]) {
            assert.equal(await scene.store.refresh(force), false)
            assert.strictEqual(scene.store.allRecords.value, original)
            assert.match(scene.store.storageError.value, /已删除账单.*状态.*不一致/)
            assert.equal(scene.store.records.value.length, 0)
          }
        }
      }
      revision = '11'; version = 3; deletedAt = '2026-10-04T01:00:00.000123Z'
      assert.equal(await scene.store.refresh(true), true)
      assert.equal(scene.store.recordsByIds([id])[0].deletedAt, deletedAt)
      assert.equal(scene.store.records.value.length, 0)
    } finally { scene.dispose() }
  }
})

test('本页删除后合法服务端时间可替换本地时间，但丢删除状态不能重新入汇总', async () => {
  let revision = '10', serverDeleted = false
  const scene = setup({ request: async method => method === 'DELETE' ? null : { revision, nextAfter: null,
    records: [{ record: { ...value, version: revision === '10' ? 0 : 1 },
      ...(serverDeleted ? { deletedAt: '2026-10-04T01:00:00.123456Z' } : {}) }] } })
  try {
    await scene.store.refresh(); await scene.store.deleteRecord(id)
    const original = scene.store.allRecords.value; revision = '11'
    assert.equal(await scene.store.refresh(true), false)
    assert.strictEqual(scene.store.allRecords.value, original)
    serverDeleted = true; assert.equal(await scene.store.refresh(true), true)
    assert.equal(scene.store.recordsByIds([id])[0].deletedAt, '2026-10-04T01:00:00.123456Z')
    assert.equal(scene.store.records.value.length, 0)
  } finally { scene.dispose() }
})

test('分页读取超过5000条也完整替换且保留删除事实', async () => {
  const entries = Array.from({ length: 5001 }, (_, index) => ({ record: { ...value,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }, deletedAt: index === 0 ? '2026-10-03T01:00:00Z' : null }))
  const calls = []
  const test = setup({ request: async (method, path) => {
    calls.push(path); const params = new URL(path, 'http://synthetic').searchParams
    const after = params.get('after'); const start = after ? entries.findIndex(entry => entry.record.id === after) + 1 : 0
    if (after) assert.equal(params.get('revision'), '15')
    const records = entries.slice(start, start + 500)
    return { revision: '15', records, nextAfter: start + 500 < entries.length ? records.at(-1).record.id : null }
  } })
  try {
    assert.equal(await test.store.refresh(), true); assert.equal(calls.length, 11)
    assert.equal(test.store.records.value.length, 5000)
    assert.equal(test.store.recordsByIds([entries[0].record.id])[0].deletedAt, entries[0].deletedAt)
  } finally { test.dispose() }
})

test('分页第二页网络中断保留完整旧快照，重试从首页以新版本完整读取', async () => {
  const entries = Array.from({ length: 501 }, (_, index) => ({ record: { ...value,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }, deletedAt: index === 500 ? '2026-10-04T00:00:00Z' : null }))
  let phase = 'initial'
  const paths = []
  const scene = setup({ request: async (_, path) => {
    paths.push(path)
    if (phase === 'initial') return { revision: '0', nextAfter: null, records: [{ record: value }] }
    const after = new URL(path, 'http://synthetic').searchParams.get('after')
    if (after && phase === 'interrupted') throw Error('合成第二页网络中断')
    return after ? { revision: '1', nextAfter: null, records: entries.slice(500) }
      : { revision: '1', nextAfter: entries[499].record.id, records: entries.slice(0, 500) }
  } })
  try {
    await scene.store.refresh()
    phase = 'interrupted'
    assert.equal(await scene.store.refresh(), false)
    assert.equal(scene.store.records.value.length, 1)
    assert.equal(scene.store.records.value[0].id, id)
    phase = 'retry'
    const start = paths.length
    assert.equal(await scene.store.refresh(), true)
    assert.equal(new URL(paths[start], 'http://synthetic').searchParams.has('after'), false)
    assert.equal(scene.store.records.value.length, 500)
    assert.ok(scene.store.recordsByIds([entries[500].record.id])[0].deletedAt)
    assert.equal(scene.store.storageError.value, '')
  } finally { scene.dispose() }
})

test('分页页内逆序或回退编号不能冒充完整账本', async () => {
  let bad = false
  const first = '00000000-0000-4000-8000-000000000010', second = '00000000-0000-4000-8000-000000000001'
  const scene = setup({ request: async () => bad ? { revision: '1', nextAfter: null, records: [{ record: { ...value, id: first } }, { record: { ...value, id: second } }] }
    : { revision: '0', nextAfter: null, records: [{ record: value }] } })
  try {
    await scene.store.refresh(); bad = true
    assert.equal(await scene.store.refresh(), false)
    assert.equal(scene.store.records.value.length, 1)
    assert.equal(scene.store.records.value[0].id, id)
  } finally { scene.dispose() }
})
test('分页中途版本变化或重复游标保留上次完整账本', async () => {
  let mode = 'initial'; let calls = 0
  const secondId = 'aabf606b-a0d5-4053-98fb-194505f3d10c'
  const test = setup({ request: async () => {
    calls++
    if (mode === 'initial') return { revision: '0', nextAfter: null, records: [{ record: value }] }
    if (calls === 1) return { revision: '1', nextAfter: id, records: [{ record: value }] }
    if (mode === 'changed') return { revision: '2', nextAfter: null, records: [{ record: { ...value, id: secondId } }] }
    return { revision: '1', nextAfter: id, records: [{ record: value }] }
  } })
  try {
    assert.equal(await test.store.refresh(), true)
    mode = 'changed'; calls = 0; assert.equal(await test.store.refresh(), false)
    assert.equal(test.store.records.value.length, 1); assert.match(test.store.storageError.value, /版本已变化/)
    mode = 'duplicate'; calls = 0; assert.equal(await test.store.refresh(), false)
    assert.equal(test.store.records.value[0].id, id); assert.match(test.store.storageError.value, /重复/)
  } finally { test.dispose() }
})

test('大账本无变化只读首页核版本，强制刷新及远端变更仍完整分页', async () => {
  const entries = Array.from({ length: 1201 }, (_, index) => ({ record: { ...value,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` } }))
  let reads = 0, revision = '8'
  const test = setup({ request: async (method, path) => {
    reads++; const params = new URL(path, 'http://synthetic').searchParams
    const after = params.get('after'), start = after ? entries.findIndex(entry => entry.record.id === after) + 1 : 0
    const records = entries.slice(start, start + 500)
    return { revision, records, nextAfter: start + 500 < entries.length ? records.at(-1).record.id : null }
  } })
  try {
    assert.equal(await test.store.refresh(), true); assert.equal(reads, 3)
    const original = test.store.records.value
    assert.equal(await test.store.refresh(), true); assert.equal(reads, 4)
    assert.equal(test.store.records.value, original)
    assert.equal(await test.store.refresh(true), true); assert.equal(reads, 7)
    revision = '9'; entries[0].record = { ...entries[0].record, amount: '0.30', version: 1 }
    assert.equal(await test.store.refresh(), true); assert.equal(reads, 10)
    assert.equal(test.store.records.value[0].amount, 0.30)
  } finally { test.dispose() }
})

test('同版本首段畸形仍拒绝，不能借版本缓存跳过字段校验', async () => {
  let page = { revision: '8', records: [{ record: value }], nextAfter: null }
  const test = setup({ request: async () => page })
  try {
    assert.equal(await test.store.refresh(), true)
    for (const record of [{ ...value, amount: 'bad' }, { ...value, version: -1 }]) {
      page = { ...page, records: [{ record }] }
      assert.equal(await test.store.refresh(), false); assert.equal(test.store.records.value[0].amount, 0.29)
    }
    page = { ...page, records: [{ record: value, deletedAt: 'bad' }] }
    assert.equal(await test.store.refresh(), false); assert.equal(test.store.records.value.length, 1)
  } finally { test.dispose() }
})

test('新版本和同版本分页缺失记录结构均给出可读错误并保留原完整账本', async () => {
  let page = { revision: '8', records: [{ record: value }], nextAfter: null }
  const scene = setup({ request: async () => page })
  try {
    assert.equal(await scene.store.refresh(), true)
    const original = scene.store.records.value
    for (const revision of ['9', '8']) {
      for (const entry of [null, false, 1, 'bad', [], {}, { record: null }, { record: [] }]) {
        page = { revision, records: [entry], nextAfter: null }
        assert.equal(await scene.store.refresh(), false)
        assert.equal(scene.store.records.value, original)
        assert.equal(scene.store.storageError.value, '账本分页记录格式不完整，原账本已保留。')
      }
    }
    page = { revision: '9', records: [{ record: { ...value, amount: '0.31', version: 1 } }], nextAfter: null }
    assert.equal(await scene.store.refresh(true), true)
    assert.equal(scene.store.records.value[0].amount, 0.31)
    assert.equal(scene.store.storageError.value, '')
  } finally { scene.dispose() }
})

test('删除时间必须是有效UTC时间，畸形值不能隐藏账单或借同版本缓存通过', async () => {
  let page = { revision: '8', records: [{ record: value, deletedAt: null }], nextAfter: null }
  const scene = setup({ request: async () => page })
  try {
    assert.equal(await scene.store.refresh(), true)
    const original = scene.store.allRecords.value
    for (const revision of ['9', '8']) {
      for (const deletedAt of ['0', '', '2026-10-04', '2026-02-30T00:00:00Z', '2026-10-04T24:00:00Z',
        '2026-10-04T00:00:00', false, 0, {}, []]) {
        page = { revision, records: [{ record: value, deletedAt }], nextAfter: null }
        assert.equal(await scene.store.refresh(), false, `不能接受删除时间 ${JSON.stringify(deletedAt)}`)
        assert.equal(scene.store.allRecords.value, original)
        assert.equal(scene.store.records.value.length, 1)
        assert.match(scene.store.storageError.value, /删除.*原账本已保留/)
      }
    }
    for (const deletedAt of ['2026-10-04T00:00:00Z', '2026-10-04T00:00:00.123Z', '2026-10-04T00:00:00.123456Z', '2026-10-04T00:00:00.123456789Z']) {
      page = { revision: '9', records: [{ record: value, deletedAt }], nextAfter: null }
      assert.equal(await scene.store.refresh(true), true)
      assert.equal(scene.store.records.value.length, 0)
      assert.equal(scene.store.recordsByIds([id])[0].deletedAt, deletedAt)
    }
    // 合法null在新账号独立读取验证；同一账单删除后不能构造无恢复接口的复活。
    scene.owner.value = '2'
    page = { revision: '10', records: [{ record: value, deletedAt: null }], nextAfter: null }
    assert.equal(await scene.store.refresh(true), true)
    assert.equal(scene.store.records.value.length, 1)
  } finally { scene.dispose() }
})

test('空账本可完整读取，带继续游标的空页或续页为空时不能覆盖旧快照', async () => {
  let mode = 'old', calls = []
  const scene = setup({ request: async (method, path) => {
    const after = new URL(path, 'http://synthetic').searchParams.get('after'); calls.push(after)
    if (mode === 'old') return { revision: '8', records: [{ record: value }], nextAfter: null }
    if (mode === 'empty-more') return { revision: '9', records: [], nextAfter: id }
    if (mode === 'empty-tail') return { revision: '9', records: after ? [] : [{ record: { ...value, amount: '0.31' } }], nextAfter: after ? null : id }
    return { revision: '10', records: [], nextAfter: null }
  } })
  try {
    assert.equal(await scene.store.refresh(), true)
    const original = scene.store.allRecords.value
    for (const modeValue of ['empty-more', 'empty-tail']) {
      mode = modeValue; calls = []
      assert.equal(await scene.store.refresh(), false, modeValue)
      assert.equal(scene.store.allRecords.value, original)
      assert.equal(scene.store.records.value[0].amount, 0.29)
      assert.match(scene.store.storageError.value, /分页.*原账本已保留/)
      assert.deepEqual(calls, mode === 'empty-tail' ? [null, id] : [null])
    }
    mode = 'empty'; calls = []
    assert.equal(await scene.store.refresh(true), true)
    assert.equal(scene.store.allRecords.value.length, 0)
    assert.equal(scene.store.storageError.value, '')
    assert.deepEqual(calls, [null])
  } finally { scene.dispose() }
})

test('分页收支类型严格限定字符串，原型名称与数组不能替换账本或借缓存通过', async () => {
  let page = { revision: '8', records: [{ record: value }], nextAfter: null }
  const scene = setup({ request: async () => page })
  try {
    assert.equal(await scene.store.refresh(), true)
    const original = scene.store.allRecords.value
    for (const revision of ['9', '8']) {
      for (const type of ['constructor', '__proto__', 'toString', ['expense'], ['income'], {}, null, 0, false]) {
        page = { revision, records: [{ record: { ...value, type, category: '其他' } }], nextAfter: null }
        assert.equal(await scene.store.refresh(), false, JSON.stringify(type))
        assert.equal(scene.store.allRecords.value, original)
        assert.equal(scene.store.storageError.value, '服务账单格式不正确，暂不替换当前账本。')
      }
    }
    for (const type of ['expense', 'income']) {
      page = { revision: '9', records: [{ record: { ...value, type, category: '其他' } }], nextAfter: null }
      assert.equal(await scene.store.refresh(true), true)
      assert.equal(scene.store.records.value[0].type, type)
      assert.equal(scene.store.storageError.value, '')
    }
  } finally { scene.dispose() }
})

test('分页日期和时间不能隐式转换JSON数组，新版本及同版本均保留原账本', async () => {
  let page = { revision: '8', records: [{ record: value }], nextAfter: null }
  const scene = setup({ request: async () => page })
  try {
    assert.equal(await scene.store.refresh(), true)
    const original = scene.store.allRecords.value
    for (const revision of ['9', '8']) {
      for (const patch of [{ date: [value.date] }, { date: {} }, { time: [value.time] }, { time: {} }]) {
        page = { revision, records: [{ record: { ...value, ...patch } }], nextAfter: null }
        assert.equal(await scene.store.refresh(), false, JSON.stringify(patch))
        assert.equal(scene.store.allRecords.value, original)
        assert.equal(scene.store.storageError.value, '服务账单格式不正确，暂不替换当前账本。')
      }
    }
    for (const time of [null, undefined, '00:00', '23:59']) {
      page = { revision: '9', records: [{ record: { ...value, time } }], nextAfter: null }
      assert.equal(await scene.store.refresh(true), true)
      assert.equal(scene.store.records.value[0].time, time ?? undefined)
    }
  } finally { scene.dispose() }
})

test('强制刷新等待已有读取后仍完整分页，不能降为版本缓存检查', async () => {
  let reads = 0, release
  const first = { revision: '8', records: [{ record: value }], nextAfter: id }
  const second = { revision: '8', records: [{ record: { ...value, id: 'aabf606b-a0d5-4053-98fb-194505f3d10c' } }], nextAfter: null }
  const test = setup({ request: async (method, path) => {
    reads++
    if (reads === 3) return new Promise(done => { release = done })
    return new URL(path, 'http://synthetic').searchParams.has('after') ? second : first
  } })
  try {
    await test.store.refresh(); assert.equal(reads, 2)
    const pending = test.store.refresh(), forced = test.store.refresh(true)
    release(first); assert.equal(await pending, true); assert.equal(await forced, true)
    assert.equal(reads, 5); assert.equal(test.store.records.value.length, 2)
  } finally { test.dispose() }
})

test('修改回执须匹配目标编号下一版本及提交内容，异常保完整旧账本且不自动重试', async () => {
  const record = { ...input, amount: '0.31' }
  let reply = { ...value, amount: '0.31', version: 1 }, writes = 0, reads = 0
  const scene = setup({ request: async method => {
    if (method === 'PUT') { writes++; return reply }
    reads++; return { revision: '0', records: [{ record: value }], nextAfter: null }
  } })
  try {
    await scene.store.refresh()
    const original = scene.store.allRecords.value
    for (const patch of [{ id: 'aabf606b-a0d5-4053-98fb-194505f3d10c' }, { version: 0 }, { version: 2 },
      { amount: '0.32' }, { date: '2026-10-04' }, { type: 'income', category: '其他' }, { note: '别的修改' }, { time: null }]) {
      reply = { ...value, amount: '0.31', version: 1, ...patch }
      await assert.rejects(scene.store.updateRecord(id, record), /修改回执.*原账本已保留/)
      assert.equal(scene.store.allRecords.value, original)
      assert.equal(scene.store.records.value[0].amount, 0.29)
      assert.equal(scene.store.records.value[0].version, 0)
    }
    assert.equal(writes, 8); assert.equal(reads, 1)
    reply = { ...value, amount: '0.31', version: 1 }
    const updated = await scene.store.updateRecord(id, record)
    assert.equal(updated.id, id); assert.equal(updated.amount, 0.31); assert.equal(updated.version, 1)
    assert.equal(writes, 9); assert.equal(reads, 1)
  } finally { scene.dispose() }
})

test('编辑成功后迟到的旧分页快照不能覆盖新金额或新版本', async () => {
  let release, reading = false, latest = value
  const test = setup({ request: async (method) => {
    if (method === 'PUT') { latest = { ...value, amount: '0.31', version: 1 }; return latest }
    if (reading) return new Promise(done => { release = done })
    return { revision: String(latest.version), nextAfter: null, records: [{ record: latest }] }
  } })
  try {
    await test.store.refresh(); reading = true
    const pending = test.store.refresh()
    await test.store.updateRecord(id, { ...input, amount: '0.31' })
    release({ revision: '0', nextAfter: null, records: [{ record: value }] })
    assert.equal(await pending, false)
    assert.equal(test.store.records.value[0].amount, 0.31); assert.equal(test.store.records.value[0].version, 1)
    reading = false; assert.equal(await test.store.refresh(), true)
    assert.equal(test.store.storageError.value, '')
  } finally { test.dispose() }
})

test('删除成功后迟到旧快照不能恢复条目，下一次读取保存删除事实', async () => {
  let release, reading = false, deleted = false
  const test = setup({ request: async (method) => {
    if (method === 'DELETE') { deleted = true; return null }
    if (reading) return new Promise(done => { release = done })
    return { revision: deleted ? '1' : '0', nextAfter: null, records: [{ record: { ...value, version: deleted ? 1 : 0 },
      deletedAt: deleted ? '2026-10-04T01:00:00Z' : null }] }
  } })
  try {
    await test.store.refresh(); reading = true
    const pending = test.store.refresh(); await test.store.deleteRecord(id)
    release({ revision: '0', nextAfter: null, records: [{ record: value }] })
    assert.equal(await pending, false); assert.equal(test.store.records.value.length, 0)
    assert.equal(test.store.recordsByIds([id])[0].version, 1)
    reading = false; assert.equal(await test.store.refresh(), true)
    assert.equal(test.store.records.value.length, 0)
    assert.equal(test.store.recordsByIds([id])[0].deletedAt, '2026-10-04T01:00:00Z')
  } finally { test.dispose() }
})

test('账号切换不复用旧版本缓存，即使两个账号版本相同也读新账号分页', async () => {
  let reads = 0
  const secondId = 'aabf606b-a0d5-4053-98fb-194505f3d10c'
  const test = setup({ request: async () => {
    reads++
    if (reads <= 2) return { revision: '0', nextAfter: null, records: [{ record: value }] }
    if (reads === 3) return { revision: '0', nextAfter: id, records: [{ record: value }] }
    return { revision: '0', nextAfter: null, records: [{ record: { ...value, id: secondId } }] }
  } })
  try {
    await test.store.refresh(); await test.store.refresh(); test.owner.value = '2'
    assert.equal(await test.store.refresh(), true); assert.equal(reads, 4)
    assert.equal(test.store.records.value.length, 2)
  } finally { test.dispose() }
})
test('CSRF等待期间账号变化，真正发送写请求之前阻断', async () => {
  let resolve, current = true, writes = 0
  const api = createApiClient({ fetcher: async path => {
    if (path.endsWith('csrf')) return new Promise(done => { resolve = done })
    writes++; return new Response('{}')
  } })
  const pending = api.request('POST', '/api/records/batch', { body: {}, beforeSend: () => { if (!current) throw Error('identity changed') } })
  current = false; resolve(new Response(JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })))
  await assert.rejects(pending, /identity changed/); assert.equal(writes, 0)
})
test('资料仅使用固定私有头像地址，拒绝外部URL', () => {
  const value = { nickname: '猫', signature: '', avatar: 'photo', version: 1, avatarUrl: '/api/profile/avatar' }
  assert.equal(fromProfileView(value).photo, '/api/profile/avatar?v=1')
  assert.equal(fromProfileView(value, '1').photo, '/api/profile/avatar?v=1&expectedAccount=1')
  assert.throws(() => fromProfileView({ ...value, avatarUrl: 'https://example.com/private' }))
})
test('读取资料拒绝空白昵称和超出Unicode字数的回执，合法边界保持', () => {
  const original = { nickname: '猫', signature: '', avatar: 'cat', version: 0 }
  for (const wrong of [{ ...original, nickname: '' }, { ...original, nickname: ' \u0085\u3000 ' },
    { ...original, nickname: '猫'.repeat(21) }, { ...original, nickname: '🐱'.repeat(21) },
    { ...original, signature: '签'.repeat(61) }, { ...original, signature: '🐱'.repeat(61) }]) {
    assert.throws(() => fromProfileView(wrong), /账号资料格式不正确/)
  }
  assert.equal(fromProfileView({ ...original, nickname: '🐱'.repeat(20), signature: '🐱'.repeat(60) }).nickname, '🐱'.repeat(20))
  assert.equal(fromProfileView({ ...original, nickname: '\uFEFF猫' }).nickname, '\uFEFF猫')
})

test('新照片保存时才上传并使用返回版本更新资料，部分失败如实提示', async () => {
  const calls = [], profile = { nickname: '猫', signature: '', avatar: 'cat', version: 0 }
  const api = createProfileApi({ request: async (...args) => {
    calls.push(args); if (args[0] === 'POST') return { ...profile, avatar: 'photo', avatarUrl: '/api/profile/avatar', version: 1 }
    throw Error('synthetic profile conflict')
  } })
  await assert.rejects(api.save(profile, { ...profile, avatar: 'photo', photo: 'data:image/jpeg;base64,/9j/' }), /照片已保存.*昵称或签名的保存尚未确认/)
  assert.equal(calls[0][2].multipart, true); assert.equal(calls[1][2].body.version, 1)
})
test('预置资料保存不上传照片，Unicode超长不发请求', async () => {
  let calls = 0; const profile = { nickname: '猫', signature: '', avatar: 'cat', version: 0 }
  const api = createProfileApi({ request: async () => { calls++; return { ...profile, version: 1 } } })
  await api.save(profile, profile); assert.equal(calls, 1)
  await assert.rejects(api.save(profile, { ...profile, nickname: '😀'.repeat(21) })); assert.equal(calls, 1)
})

test('资料200回执须匹配下一版本与提交内容，失败保原资料及输入', async () => {
  const current = { nickname: '旧猫', signature: '旧签名', avatar: 'cat', version: 2 }
  const form = { ...current, nickname: ' 新猫 ', signature: ' 新签名 ', avatar: 'flower' }
  const valid = { nickname: '新猫', signature: '新签名', avatar: 'flower', version: 3 }
  for (const wrong of [{ ...valid, version: 2 }, { ...valid, version: 4 }, { ...valid, nickname: '别人' },
    { ...valid, signature: '别的签名' }, { ...valid, avatar: 'paw' }]) {
    const calls = []
    const api = createProfileApi({ request: async (...args) => { calls.push(args); return wrong } })
    await assert.rejects(api.save(current, form), /资料保存回执.*不一致/)
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'PUT')
    assert.deepEqual(calls[0][2].body, { ...valid, version: 2 })
    assert.equal(current.nickname, '旧猫'); assert.equal(current.version, 2); assert.equal(form.nickname, ' 新猫 ')
  }
  const api = createProfileApi({ request: async (method, path, options) => {
    assert.deepEqual(options.body, { ...valid, version: 2 }); return valid
  } })
  assert.equal((await api.save(current, { ...form, nickname: '\u0085新猫\u0085', signature: '\u0085新签名\u0085' })).nickname, '新猫')
})

test('照片200回执须匹配下一版本和原资料，异常不继续PUT或标部分保存', async () => {
  const current = { nickname: '旧猫', signature: '旧签名', avatar: 'cat', version: 0 }
  const form = { ...current, nickname: '新猫', avatar: 'photo', photo: 'data:image/jpeg;base64,/9j/' }
  const valid = { ...current, avatar: 'photo', avatarUrl: '/api/profile/avatar', version: 1 }
  for (const wrong of [{ ...valid, version: 0 }, { ...valid, version: 2 }, { ...valid, avatar: 'paw' },
    { ...valid, nickname: '别人' }, { ...valid, signature: '别的签名' }]) {
    const calls = []
    const api = createProfileApi({ request: async (...args) => { calls.push(args); return wrong } })
    await assert.rejects(api.save(current, form), error => /照片保存回执.*不一致/.test(error.message) && !error.partialProfile)
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'POST'); assert.equal(current.version, 0)
    assert.equal(form.photo, 'data:image/jpeg;base64,/9j/')
  }
})

test('照片部分保存失败提供已保存版本，重试只保存文字不重复上传', async () => {
  const calls = [], original = { nickname: '猫', signature: '', avatar: 'cat', version: 0 }
  let fail = true
  const api = createProfileApi({ request: async (method, path, options) => {
    calls.push(method)
    if (method === 'POST') return { ...original, avatar: 'photo', avatarUrl: '/api/profile/avatar', version: 1 }
    if (fail) throw Object.assign(Error('offline'), { code: 'NETWORK_ERROR', status: 0 })
    assert.equal(options.body.version, 1)
    return { ...original, ...options.body, avatarUrl: '/api/profile/avatar', version: 2 }
  } }, { owner: '1' })
  const form = { ...original, nickname: '新昵称', signature: '未保存签名', avatar: 'photo', photo: 'data:image/jpeg;base64,/9j/' }
  let failure
  try { await api.save(original, form) } catch (error) { failure = error }
  assert.equal(failure.partialProfile.version, 1); assert.equal(failure.code, 'NETWORK_ERROR')
  assert.equal(failure.partialProfile.photo, '/api/profile/avatar?v=1&expectedAccount=1')
  fail = false
  const result = await api.save(failure.partialProfile, { ...form, photo: failure.partialProfile.photo })
  assert.equal(result.nickname, '新昵称'); assert.equal(result.signature, '未保存签名')
  assert.deepEqual(calls, ['POST', 'PUT', 'PUT'])
})

test('照片上传后账号变化阻断文字保存，旧资料读取迟到也不能接收', async () => {
  const original = { nickname: '猫', signature: '', avatar: 'cat', version: 0 }
  let current = true, calls = 0
  const api = createProfileApi({ request: async () => {
    calls++; current = false; return { ...original, avatar: 'photo', avatarUrl: '/api/profile/avatar', version: 1 }
  } }, { isCurrent: () => current })
  await assert.rejects(api.save(original, { ...original, avatar: 'photo', photo: 'data:image/jpeg;base64,/9j/' }), /身份已变化/)
  assert.equal(calls, 1)
  current = true; await assert.rejects(api.read(), /身份已变化/); assert.equal(calls, 2)
  await assert.rejects(api.save(original, original), /身份已变化/); assert.equal(calls, 2)
})

test('资料保存等待CSRF期间账号变化，在真实写入发送前停止', async () => {
  let release, current = true, writes = 0
  const client = createApiClient({ fetcher: async path => {
    if (path.endsWith('/csrf')) return new Promise(done => { release = done })
    writes++; return new Response('{}')
  } })
  const api = createProfileApi(client, { isCurrent: () => current })
  const profile = { nickname: '猫', signature: '', avatar: 'cat', version: 0 }
  const pending = api.save(profile, profile)
  current = false; release(new Response(JSON.stringify({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' })))
  await assert.rejects(pending, /身份已变化/); assert.equal(writes, 0)
})
