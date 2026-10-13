import { centsText, parseCents } from '../utils/money.js'
import { validDate, validateRecord } from '../utils/ledger.js'
import { CATEGORY_OPTIONS, getCategoryMeta } from '../utils/categories.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function toRecordInput(input) {
  const value = validateRecord({ ...input, time: input.time ?? '00:00' })
  if (value.date.startsWith('9999-')) throw new Error('正式账单日期最多到9998年')
  return { type: value.type, amount: centsText(parseCents(value.amount)), date: value.date,
    ...(input.time != null ? { time: value.time } : {}), category: value.category, note: value.remark }
}

export function fromRecordView(value) {
  if (!value || typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.amount !== 'string' || !Number.isSafeInteger(value.version) || value.version < 0
    || typeof value.date !== 'string' || !validDate(value.date) || !['income', 'expense'].includes(value.type) || !CATEGORY_OPTIONS[value.type].some(c => c.label === value.category)
    || typeof value.note !== 'string' || value.note.length > 200
    || (value.time != null && (typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time)))) {
    throw new Error('服务账单格式不正确，暂不替换当前账本。')
  }
  const amount = parseCents(value.amount) / 100
  return { id: value.id.toLowerCase(), type: value.type, amount, date: value.date, ...(value.time ? { time: value.time } : {}),
    category: value.category, icon: getCategoryMeta(value.category, value.type).icon,
    remark: value.note || '', description: value.note || value.category, version: value.version }
}

// 先持久化确认意图再发请求；超时/重开页面仍复用同键，不使用演示账本键。
export function createLedgerApi(client, { storage, owner, newUuid = () => globalThis.crypto.randomUUID(), isCurrent = () => true,
  locks = globalThis.navigator?.locks, requireLocks = typeof globalThis.window !== 'undefined' } = {}) {
  if (!/^\d+$/.test(String(owner))) throw new Error('缺少正式账号身份')
  const key = `miaoji_account_write_intents_v1_${owner}`
  const beforeSend = () => { if (!isCurrent()) throw new Error('登录身份已变化，本次操作没有发送。') }
  const activeIntents = new Map()
  const receiptIntents = new WeakMap()
  async function withIntentLock(work) {
    beforeSend()
    if (locks?.request) return locks.request(`${key}:write`, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) throw new Error('另一页面正在处理当前账号的保存操作，请稍后用原操作重试。')
      beforeSend()
      return work()
    })
    if (requireLocks) throw new Error('当前浏览器暂不支持跨页面安全保存，请使用新版Chrome或Edge；原草稿已保留。')
    // 非浏览器的离线测试可注入锁；浏览器写入不能静默降级为无互斥存储。
    return work()
  }
  function intents() {
    const raw = storage.getItem(key)
    if (raw === null) return {}
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.values(value).some(v => !v || !UUID.test(v.requestId) || typeof v.content !== 'string'
        || (v.draftVersion != null && (!Number.isSafeInteger(v.draftVersion) || v.draftVersion < 0))
        || (v.manualComplete != null && typeof v.manualComplete !== 'boolean'))) {
      throw new Error('确认记录无法读取，原内容已保护，请勿清除存储。')
    }
    return value
  }
  function intent(batchId, content) {
    if (typeof batchId !== 'string' || !batchId || ['__proto__', 'constructor', 'prototype'].includes(batchId)) throw new Error('缺少有效确认标识')
    const values = intents()
    if (Object.hasOwn(values, batchId)) {
      if (values[batchId].content !== content) throw new Error('这次确认的内容已改变，请先核对账单，不要重新入账。')
      return values[batchId].requestId
    }
    if (batchId.startsWith('manual-') && pendingManual().length) throw new Error('还有原手动保存操作待恢复，请先核对，不要另建一笔。')
    const requestId = newUuid()
    if (!UUID.test(requestId)) throw new Error('无法生成安全的确认标识')
    values[batchId] = { requestId, content }
    try { storage.setItem(key, JSON.stringify(values)) }
    catch { throw new Error('确认标识无法保存，尚未发送入账请求。请保留草稿后再试。') }
    return requestId
  }
  function assertIntent(batchId, expected = activeIntents.get(batchId)) {
    beforeSend()
    const actual = intents()[batchId]
    if (!expected || !actual || expected.requestId !== actual.requestId || expected.content !== actual.content) {
      throw new Error('原确认意图已变化，请保留内容并核对账单，不要重新入账。')
    }
  }
  function rememberDraftVersion(batchId, version) {
    const values = intents()
    const saved = values[batchId]
    if (!saved) throw new Error('确认标识已变化，请保留内容并核对账单。')
    if (saved.draftVersion != null && saved.draftVersion !== version) throw new Error('服务端草稿版本已变化，请重新核对，不要重复入账。')
    if (saved.draftVersion == null) {
      values[batchId] = { ...saved, draftVersion: version }
      try { storage.setItem(key, JSON.stringify(values)) }
      catch { throw new Error('草稿版本无法保存，尚未发送确认请求。请保留内容后再试。') }
    }
    return values[batchId].draftVersion
  }
  async function createBatchUnlocked(inputs, batchId) {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 5) throw new Error('每次确认1–5笔账单')
    const ids = inputs.map((value, index) => String(value.id ?? index))
    if (new Set(ids).size !== ids.length) throw new Error('草稿编号重复')
    const body = { records: inputs.map(toRecordInput) }
    const content = JSON.stringify(body)
    const requestId = intent(batchId, content)
    const expected = { requestId, content }
    activeIntents.set(batchId, expected)
    const guard = () => assertIntent(batchId, expected)
    guard()
    const draft = await client.request('PUT', `/api/drafts/${requestId}`, { body, beforeSend: guard })
    guard()
    if (draft?.id !== requestId || !Number.isSafeInteger(draft.version) || draft.version < 0
      || !['OPEN', 'CONFIRMED'].includes(draft.status) || !Array.isArray(draft.records) || draft.records.length !== body.records.length
      || draft.records.some((record, index) => ['type', 'amount', 'date', 'category', 'note', 'time']
        .some(field => (record?.[field] ?? null) !== (body.records[index][field] ?? null)))) {
      throw new Error('服务端草稿状态或内容不一致，请保留原操作并核对账单。')
    }
    const version = rememberDraftVersion(batchId, draft.version)
    const response = await client.request('POST', `/api/drafts/${requestId}/confirm`, {
      body: { version }, headers: { 'Idempotency-Key': requestId }, beforeSend: guard })
    guard()
    const receipt = response?.records
    if (!Array.isArray(receipt) || receipt.length !== inputs.length) throw new Error('保存回执不完整，请用原操作重试。')
    const records = receipt.map((value, index) => ({ ...fromRecordView(value), draftGroupId: batchId, draftItemId: ids[index] }))
    if (new Set(records.map(record => record.id.toLowerCase())).size !== records.length) {
      throw new Error('保存回执编号重复，请保留这组并用原操作重试。')
    }
    if (receipt.some((record, index) => record.version !== 0 || ['type', 'amount', 'date', 'category', 'note', 'time']
      .some(field => (record[field] ?? null) !== (body.records[index][field] ?? null)))) {
      throw new Error('保存回执内容与原草稿不一致，请保留这组并用原操作重试。')
    }
    receiptIntents.set(records, expected)
    return records
  }
  async function update(current, input) {
    const record = toRecordInput(input)
    const response = await client.request('PUT', `/api/records/${current.id}`, { body: { version: current.version, record }, beforeSend })
    const updated = fromRecordView(response)
    if (updated.id !== current.id || updated.version !== current.version + 1
      || ['type', 'amount', 'date', 'category', 'note', 'time'].some(field => (response[field] ?? null) !== (record[field] ?? null))) {
      throw new Error('修改回执与本次操作不一致，原账本已保留。请关闭编辑并刷新明细核对，暂勿重复保存。')
    }
    return { ...current, ...updated, time: updated.time }
  }
  async function remove(current) {
    return client.request('DELETE', `/api/records/${current.id}?version=${current.version}`, { beforeSend })
  }
  function pendingManual() {
    beforeSend()
    try {
      return Object.entries(intents()).filter(([batchId, value]) => batchId.startsWith('manual-') && !value.manualComplete).map(([batchId, value]) => {
        const body = JSON.parse(value.content)
        if (!Array.isArray(body?.records) || body.records.length !== 1) throw Error('invalid manual content')
        const original = body.records[0]
        const record = { ...original, remark: original.note, id: 'single' }
        if (JSON.stringify({ records: [toRecordInput(record)] }) !== value.content) throw Error('invalid manual content')
        return { batchId, record }
      })
    } catch { throw new Error('原手动保存操作无法读取，请保留浏览器数据并核对账单，暂不另建一笔。') }
  }
  function markManualComplete(batchId, expected) {
    if (!batchId.startsWith('manual-')) return
    assertIntent(batchId, expected)
    const values = intents()
    if (!Object.hasOwn(values, batchId)) throw new Error('原手动保存操作已变化，请核对账单。')
    values[batchId] = { ...values[batchId], manualComplete: true }
    try { storage.setItem(key, JSON.stringify(values)) }
    catch { throw new Error('服务器已保存，恢复状态暂未保存，请用原操作重试，不要另建一笔。') }
  }
  async function cancelManualUnlocked(batchId) {
    beforeSend()
    const operation = pendingManual().find(value => value.batchId === batchId)
    if (!operation) throw new Error('原手动操作已变化，请使用原操作恢复并核对账单。')
    const saved = intents()[batchId]
    const expected = { requestId: saved.requestId, content: saved.content }
    activeIntents.set(batchId, expected)
    const guard = () => assertIntent(batchId, expected)
    const body = JSON.parse(saved.content)
    const sameRecords = records => Array.isArray(records) && records.length === body.records.length
      && records.every((record, index) => ['type', 'amount', 'date', 'category', 'note', 'time']
        .every(field => (record?.[field] ?? null) === (body.records[index][field] ?? null)))
    const draft = await client.request('GET', `/api/drafts/${saved.requestId}`, { beforeSend: guard })
    guard()
    if (draft?.id !== saved.requestId || !Number.isSafeInteger(draft.version) || draft.version < 0
      || (saved.draftVersion != null && saved.draftVersion !== draft.version)
      || !['OPEN', 'CANCELLED'].includes(draft.status)
      || !sameRecords(draft.records)) {
      throw new Error('草稿已确认或状态/内容已变化，请使用原操作恢复并核对账单。')
    }
    if (draft.status === 'OPEN') {
      const cancelled = await client.request('POST', `/api/drafts/${saved.requestId}/cancel`, { body: { version: draft.version }, beforeSend: guard })
      guard()
      if (cancelled?.id !== saved.requestId || cancelled.status !== 'CANCELLED' || cancelled.version !== draft.version
        || !sameRecords(cancelled.records)) throw new Error('取消回执不完整，请保留原操作恢复，暂不另建一笔。')
    }
    markManualComplete(batchId, expected)
  }
  async function createBatch(inputs, batchId) { return withIntentLock(() => createBatchUnlocked(inputs, batchId)) }
  async function cancelManual(batchId) { return withIntentLock(() => cancelManualUnlocked(batchId)) }
  async function completeManual(batchId, receipt) {
    if (!batchId.startsWith('manual-')) return
    const expected = receipt ? receiptIntents.get(receipt) : activeIntents.get(batchId)
    return withIntentLock(() => markManualComplete(batchId, expected))
  }
  return { createBatch, update, remove, pendingManual, completeManual, cancelManual }
}
