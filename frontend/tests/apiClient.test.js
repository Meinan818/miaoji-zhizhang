import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiClient, ApiError } from '../src/api/client.js'
import { createLedgerApi, fromRecordView, toRecordInput } from '../src/api/ledger.js'

const response = (status, data) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const token = { headerName: 'X-CSRF-TOKEN', token: 'synthetic-csrf' }

test('旧账号401或身份变化回执不撤销已切换的新账号', async () => {
  for (const [status, code] of [[401, 'UNAUTHORIZED'], [409, 'ACCOUNT_CHANGED']]) {
    let owner = '1', changed = 0, resolve
    const api = createApiClient({ getOwner: () => owner, onUnauthorized: () => changed++, fetcher: () => new Promise(done => { resolve = done }) })
    const pending = api.request('GET', '/api/auth/me')
    owner = '2'
    resolve(response(status, { code }))
    await assert.rejects(pending, failure => failure.status === status)
    assert.equal(changed, 0)
  }
})

test('同账号重新登录重置校验后，旧401不撤销新会话或清新token', async () => {
  let finishOld, expired = 0, csrfReads = 0
  const api = createApiClient({ getOwner: () => '1', onUnauthorized: () => expired++, fetcher: async path => {
    if (path.endsWith('/csrf')) { csrfReads++; return response(200, token) }
    return new Promise(done => { finishOld = done })
  } })
  const pending = api.request('GET', '/api/records/snapshot')
  api.resetCsrf()
  await api.getCsrf()
  finishOld(response(401, {}))
  await assert.rejects(pending, failure => failure.status === 401)
  assert.equal(expired, 0)
  await api.getCsrf()
  assert.equal(csrfReads, 1)
})

test('写入拿到校验后beforeSend重置同账号校验时，旧token不得发出', async () => {
  let writes = 0
  const api = createApiClient({ getOwner: () => '1', fetcher: async path => {
    if (path.endsWith('/csrf')) return response(200, token)
    writes++; return response(200, {})
  } })
  await assert.rejects(api.request('POST', '/api/profile', { body: {}, beforeSend: () => api.resetCsrf() }), failure => failure.code === 'STALE_CSRF')
  assert.equal(writes, 0)
})
const id = '7ebf606b-a0d5-4053-98fb-194505f3d10c'
const input = { id: 'item1', type: 'expense', amount: '0.29', date: '2026-10-03', time: '09:15', category: '餐饮', remark: '合成午饭' }
test('AI可设置更长的单次期限，普通请求保持原默认期限', async () => {
  const client = createApiClient({ timeoutMs: 5, fetcher: async (path, { signal }) => {
    if (path.endsWith('/csrf')) return response(200, token)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(response(200, { ok: true })), 20)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('abort')) }, { once: true })
    })
  } })
  assert.deepEqual(await client.request('POST', '/api/ai/parse', { body: {}, requestTimeoutMs: 100 }), { ok: true })
  await assert.rejects(client.request('GET', '/api/records/snapshot'), /中断或超时/)
})
const view = { id, type: 'expense', amount: '0.29', date: input.date, time: input.time, category: input.category, note: input.remark, version: 0 }
function memory() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('写请求获取CSRF、同源Cookie与十进制JSON，不持有密码令牌', async () => {
  const calls = []
  const api = createApiClient({ fetcher: async (path, options) => { calls.push({ path, ...options }); return response(200, path.endsWith('csrf') ? token : view) } })
  await api.request('POST', '/api/records', { body: { amount: '0.29' }, headers: { 'Idempotency-Key': id } })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].headers['X-CSRF-TOKEN'], token.token)
  assert.equal(calls[1].credentials, 'same-origin')
  assert.equal(calls[1].body, '{"amount":"0.29"}')
  assert.equal(calls[1].headers['Idempotency-Key'], id)
})
test('并发读取CSRF只产生一次请求', async () => {
  let calls = 0
  const api = createApiClient({ fetcher: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return response(200, token) } })
  await Promise.all([api.getCsrf(), api.getCsrf()]); assert.equal(calls, 1)
})

test('安全校验重置后不复用旧请求，旧回执和finally不覆盖新校验', async () => {
  const resolvers = []
  const headers = []
  const api = createApiClient({ fetcher: (path, options) => {
    if (path.endsWith('/csrf')) return new Promise(done => resolvers.push(done))
    headers.push(options.headers['X-CSRF-TOKEN'])
    return Promise.resolve(response(200, {}))
  } })
  const first = api.getCsrf()
  api.resetCsrf()
  const second = api.getCsrf()
  assert.equal(resolvers.length, 2)
  resolvers[0](response(200, { ...token, token: 'old-synthetic' }))
  await assert.rejects(first, /安全校验.*变化/)
  const joined = api.getCsrf()
  assert.equal(resolvers.length, 2)
  resolvers[1](response(200, { ...token, token: 'current-synthetic' }))
  await Promise.all([second, joined])
  await api.request('POST', '/api/profile', { body: {} })
  assert.deepEqual(headers, ['current-synthetic'])
})

test('账号变化期间安全校验旧回执不缓存，写请求不发出', async () => {
  let owner = '1', resolve, writes = 0
  const api = createApiClient({ getOwner: () => owner, fetcher: (path) => {
    if (path.endsWith('/csrf')) return new Promise(done => { resolve = done })
    writes++; return Promise.resolve(response(200, {}))
  } })
  const pending = api.request('POST', '/api/profile', { body: {} })
  owner = '2'
  resolve(response(200, token))
  await assert.rejects(pending, /身份.*变化|安全校验.*变化/)
  const next = api.getCsrf()
  assert.equal(writes, 0)
  let settled = false
  next.then(() => { settled = true })
  await new Promise(done => setImmediate(done))
  assert.equal(settled, false)
  resolve(response(200, { ...token, token: 'other-synthetic' }))
  assert.equal((await next).token, 'other-synthetic')
})
test('请求断言当前账号，跨标签Cookie变化的409撤销旧页面身份', async () => {
  let changed = 0, header
  const api = createApiClient({ getOwner: () => '1', onUnauthorized: () => changed++, fetcher: async (path, options) => {
    header = options.headers['X-Expected-Account']
    return response(409, { code: 'ACCOUNT_CHANGED', message: '账号已变化' })
  } })
  await assert.rejects(api.request('GET', '/api/records/snapshot'), error => error.code === 'ACCOUNT_CHANGED')
  assert.equal(header, '1'); assert.equal(changed, 1)
})
test('登录以表单提交并重新获取token；退出不保存密码', async () => {
  const calls = []
  const api = createApiClient({ fetcher: async (path, options) => {
    calls.push({ path, ...options })
    return path.endsWith('/csrf') ? response(200, { ...token, token: 'csrf-' + calls.length })
      : path.endsWith('/me') ? response(200, { id: '1', username: 'synthetic' }) : response(204)
  } })
  await api.login('synthetic', 'SyntheticPass123!')
  assert.equal(calls[1].body, 'username=synthetic&password=SyntheticPass123%21')
  assert.equal(calls[2].path, '/api/auth/csrf')
  await api.logout(); assert.equal(calls[4].headers['X-CSRF-TOKEN'], 'csrf-3')
})
test('401通知清正式缓存，网络错误不自动重发写操作', async () => {
  let expired = 0; let writes = 0
  const api = createApiClient({ onUnauthorized: () => expired++, fetcher: async (path) => {
    if (path.endsWith('/csrf')) return response(200, token)
    if (path.endsWith('/me')) return response(401, {})
    writes++; throw new Error('synthetic network error')
  } })
  await assert.rejects(api.request('GET', '/api/auth/me'), error => error instanceof ApiError && error.status === 401)
  assert.equal(expired, 1)
  await assert.rejects(api.request('POST', '/api/records', { body: {} }), /连接不到/)
  assert.equal(writes, 1)
})
test('超时停止请求，HTML错误和未知CSRF头不能显示或转发', async () => {
  const timed = createApiClient({ timeoutMs: 10, fetcher: (path, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')))) })
  await assert.rejects(timed.request('GET', '/api/auth/me'), /超时/)
  const html = createApiClient({ fetcher: async () => new Response('<p>synthetic private diagnostic</p>', { status: 503 }) })
  await assert.rejects(html.request('GET', '/api/auth/me'), error => !error.message.includes('private'))
  const malformed = createApiClient({ fetcher: async () => response(200, { headerName: 'Authorization', token: 'bad' }) })
  await assert.rejects(malformed.getCsrf(), /安全校验/)
  await assert.rejects(html.request('GET', 'https://example.com'), /同源/)
})
test('multipart不手写Content-Type，让浏览器生成boundary', async () => {
  const calls = []
  const api = createApiClient({ fetcher: async (path, options) => { calls.push(options); return response(200, path.endsWith('csrf') ? token : {}) } })
  const body = new FormData(); body.append('image', new Blob(['synthetic']))
  await api.request('POST', '/api/profile/avatar?version=0', { body, multipart: true })
  assert.equal(calls[1].body, body); assert.equal(Object.hasOwn(calls[1].headers, 'Content-Type'), false)
})
test('注册201允许空回执，查询成功仍拒绝非JSON正文', async () => {
  const api = createApiClient({ fetcher: async path => path.endsWith('/csrf') ? response(200, token) : new Response(null, { status: 201 }) })
  assert.equal(await api.request('POST', '/api/auth/register', { body: { username: 'synthetic', password: 'SyntheticPass123!' } }), null)
  const malformed = createApiClient({ fetcher: async () => new Response('<html>synthetic</html>', { status: 200 }) })
  await assert.rejects(malformed.request('GET', '/api/auth/me'), /格式不正确/)
})
test('金额双向适配保留分精度和未知时间，不信任畸形回执', () => {
  assert.equal(toRecordInput(input).amount, '0.29')
  assert.equal(toRecordInput({ ...input, amount: '999999999.99' }).amount, '999999999.99')
  assert.equal(fromRecordView(view).amount, 0.29)
  const { time, ...unknown } = view
  assert.equal(Object.hasOwn(fromRecordView(unknown), 'time'), false)
  for (const patch of [{ amount: 0.29 }, { version: -1 }, { id: '../other' }, { date: '2026-02-30' }, { time: '24:00' }, { type: 'invalid' }]) {
    assert.throws(() => fromRecordView({ ...view, ...patch }))
  }
})
test('服务账单标识拒绝数组，不把JSON自动转换当作有效UUID', () => {
  assert.throws(() => fromRecordView({ ...view, id: [view.id] }), /服务账单格式不正确/)
  assert.equal(fromRecordView(view).id, view.id)
})
test('读取契约按收支枚举拒收跨类型分类，收入餐饮与支出工资不替换账本', () => {
  assert.throws(() => fromRecordView({ ...view, type: 'income', category: '餐饮' }), /服务账单格式不正确/)
  assert.throws(() => fromRecordView({ ...view, category: '工资' }), /服务账单格式不正确/)
  assert.equal(fromRecordView({ ...view, type: 'income', category: '其他' }).category, '其他')
})

test('超时及新实例重试复用持久化UUID，账户相同操作独立', async () => {
  const storage = memory(); const keys = []; let fail = true
  const client = { request: async (method, path, options) => {
    if (method === 'PUT') return { id: path.split('/').at(-1), version: 0, status: 'OPEN', records: options.body.records }
    keys.push(options.headers['Idempotency-Key']); if (fail) throw new Error('timeout'); return { records: [view] }
  } }
  const first = createLedgerApi(client, { storage, owner: '1', newUuid: () => id })
  await assert.rejects(first.createBatch([input], 'group1'), /timeout/)
  fail = false
  const next = createLedgerApi(client, { storage, owner: '1', newUuid: () => { throw new Error('must reuse') } })
  const receipt = await next.createBatch([input], 'group1')
  assert.deepEqual(keys, [id, id]); assert.equal(receipt[0].draftGroupId, 'group1')
  const otherId = '7ebf606b-a0d5-4053-98fb-194505f3d10d'
  await createLedgerApi(client, { storage, owner: '2', newUuid: () => otherId }).createBatch([input], 'group1')
  assert.equal(keys.at(-1), otherId)
  assert.equal(storage.values.has('zhizhang_mock_records'), false)
})
test('整组确认回执编号必须唯一，畸形回执失败后原键重试保持候选关联', async () => {
  const storage = memory(), calls = []
  const otherId = '7ebf606b-a0d5-4053-98fb-194505f3d10d'
  const inputs = [input, { ...input, id: 'item2', amount: '0.30' }]
  let malformed = 'duplicate', generated = 0
  const api = createLedgerApi({ request: async (method, path, options) => {
    calls.push({ method, path, options })
    if (method === 'PUT') return { id, version: 0, status: 'CONFIRMED', records: options.body.records }
    return { records: [view, { ...view, id: malformed === 'duplicate' ? id : malformed === 'case-alias' ? id.toUpperCase() : otherId, amount: '0.30' }] }
  } }, { storage, owner: '1', newUuid: () => { generated++; return id } })
  await assert.rejects(api.createBatch(inputs, 'group-unique'), /保存回执编号重复.*原操作重试/)
  const savedIntent = storage.getItem('miaoji_account_write_intents_v1_1')
  assert.equal(JSON.parse(savedIntent)['group-unique'].requestId, id)
  malformed = 'case-alias'
  await assert.rejects(api.createBatch(inputs, 'group-unique'), /保存回执编号重复.*原操作重试/)
  assert.equal(storage.getItem('miaoji_account_write_intents_v1_1'), savedIntent)
  malformed = ''
  const saved = await api.createBatch(inputs, 'group-unique')
  assert.deepEqual(saved.map(record => record.id), [id, otherId])
  assert.deepEqual(saved.map(record => record.draftItemId), ['item1', 'item2'])
  assert(saved.every(record => record.draftGroupId === 'group-unique'))
  assert.equal(generated, 1)
  assert.deepEqual(calls.filter(call => call.method === 'PUT').map(call => call.options.body), [calls[0].options.body, calls[0].options.body, calls[0].options.body])
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.options.headers['Idempotency-Key']), [id, id, id])
  assert.equal(storage.getItem('miaoji_account_write_intents_v1_1'), savedIntent)
})

test('原始确认回执字段及顺序须匹配草稿，新实例重试仍复用原意图', async () => {
  const storage = memory(), otherId = '7ebf606b-a0d5-4053-98fb-194505f3d10d'
  const inputs = [input, { ...input, id: 'item2', amount: '0.30' }]
  const first = { ...view }, second = { ...view, id: otherId, amount: '0.30' }
  let receipt = [], generated = 0
  const confirmations = [], puts = []
  const client = { request: async (method, path, options) => {
    if (method === 'PUT') { puts.push(options.body); return { id, version: 0, status: 'CONFIRMED', records: options.body.records } }
    confirmations.push(options); return { records: receipt }
  } }
  const reopen = () => createLedgerApi(client, { storage, owner: '1', newUuid: () => { assert.equal(generated++, 0); return id } })
  const malformed = [{ ...first, amount: '0.31' }, { ...first, version: 1 }, { ...first, date: '2026-10-04' },
    { ...first, type: 'income', category: '其他' }, { ...first, note: '别的组' }, { ...first, time: null }]
  for (const records of [...malformed.map(value => [value, second]), [second, first]]) {
    receipt = records
    await assert.rejects(reopen().createBatch(inputs, 'group-canonical'), /保存回执内容.*原操作重试/)
  }
  const savedIntent = storage.getItem('miaoji_account_write_intents_v1_1')
  receipt = [first, second]
  const saved = await reopen().createBatch(inputs, 'group-canonical')
  assert.deepEqual(saved.map(record => record.id), [id, otherId])
  assert.deepEqual(saved.map(record => record.draftItemId), ['item1', 'item2'])
  assert.equal(generated, 1); assert.equal(storage.getItem('miaoji_account_write_intents_v1_1'), savedIntent)
  assert(puts.every(body => JSON.stringify(body) === JSON.stringify(puts[0])))
  assert(confirmations.every(options => options.headers['Idempotency-Key'] === id && options.body.version === 0))
})

test('同次确认内容变化拒绝发请求，防止超时后改稿重复入账', async () => {
  let requests = 0
  const api = createLedgerApi({ request: async (method, path, options) => {
    if (method === 'PUT') return { id, version: 0, status: 'OPEN', records: options.body.records }
    requests++; return { records: [view] }
  } }, { storage: memory(), owner: '1', newUuid: () => id })
  await api.createBatch([input], 'g')
  await assert.rejects(api.createBatch([{ ...input, amount: '0.30' }], 'g'), /内容已改变/)
  assert.equal(requests, 1)
})
test('防重标识保存失败或旧意图损坏时不发送请求也不覆盖原文', async () => {
  let calls = 0
  const client = { request: async () => { calls++ } }
  const failing = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  await assert.rejects(createLedgerApi(client, { storage: failing, owner: '1', newUuid: () => id }).createBatch([input], 'g'), /尚未发送/)
  const storage = memory(); storage.setItem('miaoji_account_write_intents_v1_1', '{broken')
  await assert.rejects(createLedgerApi(client, { storage, owner: '1' }).createBatch([input], 'g'))
  assert.equal(storage.getItem('miaoji_account_write_intents_v1_1'), '{broken'); assert.equal(calls, 0)
})
test('草稿版本先持久化再确认，新实例拒绝已变化的服务端版本', async () => {
  const storage = memory(); let version = 0; const calls = []
  const client = { request: async (method, path, options) => {
    calls.push({ method, path, options })
    if (method === 'PUT') return { id, version, status: 'OPEN', records: options.body.records }
    assert.equal(JSON.parse(storage.getItem('miaoji_account_write_intents_v1_1')).g.draftVersion, 0)
    assert.deepEqual(options.body, { version: 0 }); throw Error('lost confirmation response')
  } }
  await assert.rejects(createLedgerApi(client, { storage, owner: '1', newUuid: () => id }).createBatch([input], 'g'), /lost confirmation/)
  version = 1
  await assert.rejects(createLedgerApi(client, { storage, owner: '1' }).createBatch([input], 'g'), /版本已变化/)
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
})
test('草稿版本持久化失败或服务端内容不符时不发送确认', async () => {
  let writes = 0; let content = null; let saved = null
  const properStorage = { getItem: () => saved, setItem: (key, value) => {
    if (JSON.parse(value).g?.draftVersion != null) throw Error('quota')
    saved = value
  } }
  const client = { request: async (method, path, options) => {
    if (method === 'POST') { writes++; return { records: [view] } }
    return { id, version: 0, status: 'OPEN', records: content ?? options.body.records }
  } }
  await assert.rejects(createLedgerApi(client, { storage: properStorage, owner: '1', newUuid: () => id }).createBatch([input], 'g'), /尚未发送确认/)
  content = [{ ...toRecordInput(input), amount: '9.99' }]
  await assert.rejects(createLedgerApi(client, { storage: properStorage, owner: '1' }).createBatch([input], 'g'), /内容不一致/)
  assert.equal(writes, 0)
})
test('手动未知确认重开后恢复原内容与原键，完成后不再列为待恢复', async () => {
  const storage = memory(); let fail = true; const keys = []
  const client = { request: async (method, path, options) => {
    if (method === 'PUT') return { id, version: 0, status: 'OPEN', records: options.body.records }
    keys.push(options.headers['Idempotency-Key'])
    if (fail) throw Error('合成回执丢失')
    return { records: [view] }
  } }
  await assert.rejects(createLedgerApi(client, { storage, owner: '1', newUuid: () => id }).createBatch([input], 'manual-original'))
  const reopened = createLedgerApi(client, { storage, owner: '1', newUuid: () => { throw Error('不可换键') } })
  const [operation] = reopened.pendingManual()
  assert.equal(operation.batchId, 'manual-original')
  assert.deepEqual(toRecordInput(operation.record), toRecordInput(input))
  assert.deepEqual(createLedgerApi(client, { storage, owner: '2' }).pendingManual(), [])
  fail = false
  await reopened.createBatch([operation.record], operation.batchId)
  await reopened.completeManual(operation.batchId)
  assert.deepEqual(keys, [id, id])
  assert.deepEqual(reopened.pendingManual(), [])
  assert.equal(JSON.parse(storage.getItem('miaoji_account_write_intents_v1_1'))['manual-original'].requestId, id)
})

test('恢复仅列出单笔手动操作，损坏内容或存储不可用保持原文且不发送', () => {
  const storage = memory(); let calls = 0
  const original = JSON.stringify({ 'manual-broken': { requestId: id, content: '{broken' }, chat: { requestId: id, content: '{}' } })
  storage.setItem('miaoji_account_write_intents_v1_1', original)
  const api = createLedgerApi({ request: () => { calls++ } }, { storage, owner: '1' })
  assert.throws(() => api.pendingManual(), /原手动保存操作无法读取/)
  assert.equal(storage.getItem('miaoji_account_write_intents_v1_1'), original)
  assert.equal(calls, 0)
})

test('未收尾手动操作禁止另建标识，收尾存储失败仍保留恢复入口', async () => {
  const storage = memory(); let calls = 0
  const client = { request: async (method, path, options) => {
    calls++
    if (method === 'PUT') return { id, version: 0, status: 'OPEN', records: options.body.records }
    throw Error('lost receipt')
  } }
  const api = createLedgerApi(client, { storage, owner: '1', newUuid: () => id })
  await assert.rejects(api.createBatch([input], 'manual-original'))
  await assert.rejects(api.createBatch([input], 'manual-new'), /原手动保存操作待恢复/)
  assert.equal(calls, 2)
  const original = storage.getItem('miaoji_account_write_intents_v1_1')
  storage.setItem = () => { throw Error('quota') }
  await assert.rejects(api.completeManual('manual-original'), /恢复状态暂未保存/)
  assert.equal(storage.getItem('miaoji_account_write_intents_v1_1'), original)
  assert.equal(api.pendingManual().length, 1)
})

test('明确结束手动操作须核原内容并收到取消回执，已确认或未知状态不能放行', async () => {
  for (const status of ['OPEN', 'CANCELLED', 'CONFIRMED', 'UNKNOWN']) {
    const storage = memory()
    storage.setItem('miaoji_account_write_intents_v1_1', JSON.stringify({ 'manual-original': { requestId: id, content: JSON.stringify({ records: [toRecordInput(input)] }), draftVersion: 0 } }))
    const calls = []
    const client = { request: async (method, path, options) => {
      calls.push({ method, path, options })
      const record = toRecordInput(input)
      return { id, version: 0, status: method === 'GET' ? status : 'CANCELLED', records: [Object.fromEntries(Object.entries(record).reverse())] }
    } }
    const api = createLedgerApi(client, { storage, owner: '1' })
    if (['OPEN', 'CANCELLED'].includes(status)) {
      await api.cancelManual('manual-original')
      assert.equal(api.pendingManual().length, 0)
      assert.equal(calls.length, status === 'OPEN' ? 2 : 1)
      if (status === 'OPEN') { assert.match(calls[1].path, /\/cancel$/); assert.deepEqual(calls[1].options.body, { version: 0 }) }
    } else {
      await assert.rejects(api.cancelManual('manual-original'), /原操作恢复/)
      assert.equal(api.pendingManual().length, 1)
      assert.equal(calls.length, 1)
    }
  }
})

test('取消响应丢失、内容改变或身份变化保持待恢复，不自动创建新键', async () => {
  for (const mode of ['lost', 'changed', 'identity']) {
    const storage = memory(); let current = true, calls = 0
    storage.setItem('miaoji_account_write_intents_v1_1', JSON.stringify({ 'manual-original': { requestId: id, content: JSON.stringify({ records: [toRecordInput(input)] }) } }))
    const original = storage.getItem('miaoji_account_write_intents_v1_1')
    const api = createLedgerApi({ request: async method => {
      calls++
      if (method === 'POST') throw Error('合成取消响应丢失')
      if (mode === 'identity') current = false
      return { id, version: 0, status: 'OPEN', records: [toRecordInput(mode === 'changed' ? { ...input, amount: '0.30' } : input)] }
    } }, { storage, owner: '1', isCurrent: () => current })
    await assert.rejects(api.cancelManual('manual-original'))
    assert.equal(storage.getItem('miaoji_account_write_intents_v1_1'), original)
    assert.equal(calls, mode === 'lost' ? 2 : 1)
  }
})

test('等待草稿或确认期间原意图被另一页改变，拒绝旧请求及收尾覆盖', async () => {
  for (const stage of ['draft', 'confirm', 'complete']) {
    const storage = memory(); let posts = 0
    const replacementId = '7ebf606b-a0d5-4053-98fb-194505f3d10d'
    const replace = () => {
      const values = JSON.parse(storage.getItem('miaoji_account_write_intents_v1_1'))
      values['manual-original'].requestId = replacementId
      storage.setItem('miaoji_account_write_intents_v1_1', JSON.stringify(values))
    }
    const api = createLedgerApi({ request: async (method, path, options) => {
      if (method === 'PUT') {
        if (stage === 'draft') replace()
        return { id, version: 0, status: 'OPEN', records: options.body.records }
      }
      posts++
      if (stage === 'confirm') replace()
      return { records: [view] }
    } }, { storage, owner: '1', newUuid: () => id })
    if (stage === 'complete') {
      await api.createBatch([input], 'manual-original'); replace()
      await assert.rejects(api.completeManual('manual-original'), /确认意图已变化/)
    } else await assert.rejects(api.createBatch([input], 'manual-original'), /确认意图已变化/)
    assert.equal(posts, stage === 'draft' ? 0 : 1)
    const original = JSON.parse(storage.getItem('miaoji_account_write_intents_v1_1'))['manual-original']
    assert.equal(original.requestId, replacementId)
    assert.equal(original.manualComplete, undefined)
  }
})

test('修改删除带服务器版本，回执保留组标识', async () => {
  const calls = []
  const api = createLedgerApi({ request: async (...args) => { calls.push(args); return { ...view, version: 1 } } }, { storage: memory(), owner: '1' })
  const current = { ...fromRecordView(view), draftGroupId: 'g' }
  const updated = await api.update(current, input); assert.equal(updated.draftGroupId, 'g')
  assert.equal(calls[0][2].body.version, 0); assert.equal(updated.version, 1)
  await api.remove(updated); assert.equal(calls[1][1], `/api/records/${id}?version=1`)
})

test('修改回执未知时间覆盖旧时间，保留草稿关联且不改原对象', async () => {
  const { time, ...unknownView } = view
  const { time: inputTime, ...unknownInput } = input
  const api = createLedgerApi({ request: async () => ({ ...unknownView, version: 1 }) }, { storage: memory(), owner: '1' })
  const current = { ...fromRecordView(view), draftGroupId: 'g', draftItemId: 'item1', source: 'chat' }
  const updated = await api.update(current, unknownInput)
  assert.equal(updated.time, undefined)
  assert.equal(updated.version, 1)
  assert.equal(updated.draftGroupId, 'g'); assert.equal(updated.draftItemId, 'item1'); assert.equal(updated.source, 'chat')
  assert.equal(current.time, '09:15'); assert.equal(current.version, 0)
})

test('跨页账号锁占用时不生成第二个UUID或发请求，释放后复用原键', async () => {
  let held = false, release, calls = 0, uuids = 0
  const lockNames = []
  const locks = { request: async (name, options, callback) => {
    lockNames.push(name); assert.equal(options.mode, 'exclusive'); assert.equal(options.ifAvailable, true)
    if (held) return callback(null)
    held = true
    try { return await callback({ name }) } finally { held = false }
  } }
  const storage = memory()
  const first = createLedgerApi({ request: async (method, path, options) => {
    calls++
    if (method === 'PUT') return new Promise(done => { release = () => done({ id, version: 0, status: 'OPEN', records: options.body.records }) })
    return { records: [view] }
  } }, { storage, owner: '1', locks, newUuid: () => { uuids++; return id } })
  const second = createLedgerApi({ request: async (method, path, options) => {
    calls++
    return method === 'PUT' ? { id, version: 0, status: 'CONFIRMED', records: options.body.records } : { records: [view] }
  } }, { storage, owner: '1', locks, newUuid: () => { uuids++; return id } })
  const pending = first.createBatch([input], 'manual-original')
  await assert.rejects(second.createBatch([input], 'manual-original'), /另一页面正在处理/)
  assert.equal(uuids, 1); assert.equal(calls, 1)
  release(); await pending
  await second.createBatch([input], 'manual-original')
  assert.equal(uuids, 1)
  assert.equal(new Set(lockNames).size, 1)
})

test('浏览器不支持跨页锁时拒绝写入，锁回调前身份变化也不留新意图', async () => {
  const storage = memory(); let calls = 0
  const client = { request: () => { calls++ } }
  await assert.rejects(createLedgerApi(client, { storage, owner: '1', locks: null, requireLocks: true }).createBatch([input], 'manual-new'), /浏览器.*安全保存/)
  let current = true
  const locks = { request: async (name, options, callback) => { current = false; return callback({ name }) } }
  await assert.rejects(createLedgerApi(client, { storage, owner: '1', locks, isCurrent: () => current }).createBatch([input], 'manual-new'), /登录身份已变化/)
  assert.equal(storage.values.size, 0)
  assert.equal(calls, 0)
})

test('服务端合法200字符备注可读后原样修改金额，超限201仍拒绝读写', () => {
  for(const note of ['合'.repeat(200), '😺'.repeat(100)]) {
    const record = fromRecordView({ ...view, note })
    const changed = toRecordInput({ ...record, amount:'0.31' })
    assert.equal(changed.note, note); assert.equal(changed.amount,'0.31')
  }
  const note = '合'.repeat(201)
  assert.throws(() => fromRecordView({ ...view,note }), /服务账单格式/)
  assert.throws(() => toRecordInput({ ...input,remark:note }), /备注/)
})
