import { computed, onScopeDispose, ref, watch } from 'vue'
import { skipHydrate } from 'pinia'
import { useLocalDay } from '../utils/calendar.js'
import { createId } from '../utils/ledger.js'
import { legacyCents, getRecordTotals } from '../utils/money.js'
import { createLedgerApi, fromRecordView } from './ledger.js'

function validateDeletedAt(value) {
  if (value == null) return
  // The Java snapshot emits Instant.toString(): UTC with optional nanoseconds.
  // Date.parse alone also accepts bare numbers and normalizes invalid dates.
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error('账本分页删除状态不合法，原账本已保留。')
  }
}

export function createRemoteLedger(client, owner, { storage, eventTarget = globalThis.window, dateClock = {} } = {}) {
  // HMR transfers this state, but a newly created account store must read its
  // own snapshot rather than hydrate data left by a previously disposed store.
  const allRecords = skipHydrate(ref([]))
  const storageError = ref('正在读取正式账本…')
  const records = computed(() => allRecords.value.filter(record => !record.deletedAt))
  const { today } = useLocalDay(dateClock)
  const monthRecords = computed(() => records.value.filter(record => record.date.startsWith(today.value.slice(0, 7))))
  const monthTotals = computed(() => getRecordTotals(monthRecords.value))
  const summaryError = computed(() => monthTotals.value.error)
  const monthExpense = computed(() => monthTotals.value.expense)
  const monthIncome = computed(() => monthTotals.value.income)
  const monthExpenseCents = computed(() => monthTotals.value.expenseCents)
  function categories(type) {
    if (summaryError.value) return {}
    const values = new Map()
    for (const record of monthRecords.value.filter(record => record.type === type)) values.set(record.category, (values.get(record.category) || 0) + legacyCents(record.amount))
    return Object.fromEntries([...values].map(([key, value]) => [key, value / 100]))
  }
  const categoryExpenses = computed(() => categories('expense'))
  const categoryIncome = computed(() => categories('income'))
  let generation = 0
  let localChanges = 0
  let snapshotRevision = null
  let latestRevision = null
  let refreshing = null
  let ledger = null
  let links = new Map()
  // Retire pending callbacks with the resource scope (including hot updates).
  onScopeDispose(() => { generation++; ledger = null; refreshing = null })
  const manualEpoch = ref(0)
  watch(owner, value => {
    generation++; localChanges++; snapshotRevision = null; latestRevision = null; allRecords.value = []; refreshing = null; links = new Map()
    storageError.value = value ? '正在读取正式账本…' : '请先登录正式账号。'
    const current = generation
    ledger = value ? createLedgerApi(client, { storage, owner: value, isCurrent: () => current === generation }) : null
    manualEpoch.value++
  }, { immediate: true, flush: 'sync' })
  const manualRecovery = computed(() => {
    manualEpoch.value
    try { return { operations: ledger ? ledger.pendingManual() : [], error: '' } }
    catch (failure) { return { operations: [], error: failure.message } }
  })
  if (eventTarget?.addEventListener) {
    const listener = event => {
      if (event.key == null || event.key === `miaoji_account_write_intents_v1_${owner.value}`) manualEpoch.value++
    }
    eventTarget.addEventListener('storage', listener)
    onScopeDispose(() => eventTarget.removeEventListener('storage', listener))
  }
  function ensure(current) {
    if (!ledger || current !== generation) throw new Error('登录身份已变化，请重新登录并核对账单。')
  }
  async function refresh(force = false, requiredIds = []) {
    if (!ledger) return false
    if (refreshing) { const result = await refreshing; return force === true ? refresh(true, requiredIds) : result }
    const current = generation
    const changesAtStart = localChanges
    const previous = new Map(allRecords.value.map(record => [record.id.toLowerCase(), record]))
    function ensureSnapshotCurrent() {
      ensure(current)
      if (changesAtStart !== localChanges) throw new Error('读取期间账本已更新，已保留最新改动，请重新读取账本。')
    }
    const pending = (async () => {
      try {
        const entries = []
        const seen = new Set()
        let after = null
        let revision = null
        do {
          const query = new URLSearchParams({ size: '500', ...(after ? { after, revision } : {}) })
          const page = await client.request('GET', `/api/records/snapshot/page?${query}`)
          ensureSnapshotCurrent()
          if (!Array.isArray(page?.records) || page.records.length > 500 || typeof page.revision !== 'string'
            || !/^(?:0|[1-9]\d{0,18})$/.test(page.revision) || BigInt(page.revision) > 9223372036854775807n
            || (revision !== null && page.revision !== revision)
            || !(page.nextAfter === null || typeof page.nextAfter === 'string')) {
            throw new Error('账本分页回执不完整或版本已变化，原账本已保留。')
          }
          revision = page.revision
          if (latestRevision !== null && BigInt(revision) < BigInt(latestRevision)) {
            throw new Error('账本版本发生倒退，原账本已保留，请重新读取最新账单。')
          }
          if (after !== null && page.records.length === 0) throw new Error('账本分页续页为空，原账本已保留。')
          let previousId = after?.toLowerCase() ?? null
          for (const entry of page.records) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !entry.record ||
                typeof entry.record !== 'object' || Array.isArray(entry.record)) {
              throw new Error('账本分页记录格式不完整，原账本已保留。')
            }
            // UUID casing does not create a new identity; all snapshot guards
            // and local associations must use the same validated identifier.
            const normalizedRecord = fromRecordView(entry.record)
            const id = normalizedRecord.id
            if (seen.has(id)) throw new Error('账本分页编号重复，原账本已保留。')
            if (typeof id !== 'string' || (previousId !== null && id <= previousId)) throw new Error('账本分页顺序或位置不合法，原账本已保留。')
            if (Number.isSafeInteger(entry.record.version) && previous.has(id) && entry.record.version < previous.get(id).version) {
              throw new Error('账单版本发生倒退，原账本已保留，请重新读取最新账单。')
            }
            if (previous.get(id)?.deletedAt && entry.deletedAt == null) {
              throw new Error('已删除账单的状态与最新回执不一致，原账本已保留，请重新读取。')
            }
            seen.add(id); entries.push({ ...entry, normalizedRecord }); previousId = id
          }
          if (page.nextAfter !== null && (page.records.length === 0 || page.nextAfter.toLowerCase() !== previousId
            || (after !== null && page.nextAfter.toLowerCase() <= after.toLowerCase()))) throw new Error('账本分页位置不合法，原账本已保留。')
          // 仍请求首页核服务器版本；相同已完整加载版本省去剩余分页与整本替换。
          if (after === null && force !== true && snapshotRevision === revision) {
            for (const entry of page.records) {
              validateDeletedAt(entry.deletedAt)
            }
            storageError.value = ''; return true
          }
          after = page.nextAfter
        } while (after !== null)
        const next = entries.map(value => {
          validateDeletedAt(value.deletedAt)
          return { ...previous.get(value.normalizedRecord.id), ...links.get(value.normalizedRecord.id), ...value.normalizedRecord, time: value.record.time ?? undefined,
            ...(value.deletedAt ? { deletedAt: value.deletedAt } : { deletedAt: undefined }) }
        })
        if (new Set(next.map(record => record.id)).size !== next.length) throw new Error('账本回执编号重复')
        if (requiredIds.some(id => !seen.has(id))) throw new Error('最新账本缺少已确认账单，原账本已保留，请用原操作重试。')
        ensureSnapshotCurrent()
        allRecords.value = next; snapshotRevision = revision; latestRevision = revision; storageError.value = ''; return true
      } catch (failure) { if (current === generation) storageError.value = failure.message; return false }
      finally { if (current === generation) refreshing = null }
    })()
    refreshing = pending
    return pending
  }
  async function addRecords(inputs, { batchId = createId('batch'), source = 'chat' } = {}) {
    const current = generation; ensure(current)
    const currentLedger = ledger
    let saved
    try { saved = await currentLedger.createBatch(inputs, batchId); ensure(current) }
    finally { if (current === generation) manualEpoch.value++ }
    localChanges++; snapshotRevision = null
    // 原回执只建立关联，当前事实继续由snapshot读取，不能恢复删除或覆盖编辑。
    for (const record of saved) links.set(record.id, { source, draftGroupId: batchId, draftItemId: record.draftItemId })
    if (!await refresh(true, saved.map(record => record.id))) throw new Error('服务器已确认保存，但最新账本暂未读到。请保留此组并用原操作重试，不要另建一组。')
    ensure(current)
    await currentLedger.completeManual(batchId, saved); ensure(current); manualEpoch.value++
    return saved
  }
  async function addRecord(input, options = {}) { return (await addRecords([{ ...input, id: input.id || 'single' }], { source: 'manual', ...options }))[0] }
  async function cancelManualOperation(batchId) {
    const current = generation; ensure(current)
    const currentLedger = ledger
    try { await currentLedger.cancelManual(batchId); ensure(current) }
    finally { if (current === generation) manualEpoch.value++ }
  }
  async function recoverConflict(failure, id, current) {
    if (current === generation && ['STALE_VERSION', 'RECORD_NOT_FOUND'].includes(failure.code)) {
      const loaded = await refresh(true)
      if (loaded && current === generation) {
        failure.recoveryLoaded = true
        failure.currentRecord = records.value.find(record => record.id === id) || null
      }
    }
    throw failure
  }
  async function updateRecord(id, input, { version } = {}) {
    const current = generation; ensure(current)
    const record = allRecords.value.find(record => record.id === id && !record.deletedAt)
    if (!record) throw new Error('账单不存在，请重新读取明细。')
    let updated
    try { updated = await ledger.update({ ...record, version: version ?? record.version }, input); ensure(current) }
    catch (failure) { return recoverConflict(failure, id, current) }
    localChanges++; snapshotRevision = null
    allRecords.value = allRecords.value.map(record => record.id === id ? updated : record)
    storageError.value = ''; return updated
  }
  async function deleteRecord(id, { version } = {}) {
    const current = generation; ensure(current)
    const record = allRecords.value.find(record => record.id === id && !record.deletedAt)
    if (!record) throw new Error('账单不存在，请重新读取明细。')
    try { await ledger.remove({ ...record, version: version ?? record.version }); ensure(current) }
    catch (failure) { return recoverConflict(failure, id, current) }
    localChanges++; snapshotRevision = null
    const removed = { ...record, deletedAt: new Date().toISOString(), version: record.version + 1 }
    allRecords.value = allRecords.value.map(record => record.id === id ? removed : record)
    storageError.value = ''; return removed
  }
  function batchRecords(id) { return allRecords.value.filter(record => record.draftGroupId === id) }
  function recordsByIds(ids = []) {
    const requested = new Set(ids.filter(id => typeof id === 'string').map(id => id.toLowerCase()))
    return allRecords.value.filter(record => requested.has(record.id.toLowerCase()))
  }
  function clearRecords() { throw new Error('正式账本不提供清空操作。') }
  return { allRecords, records, storageError, summaryError, monthRecords, monthExpense, monthExpenseCents, monthIncome, categoryExpenses, categoryIncome,
    refresh, addRecords, addRecord, updateRecord, deleteRecord, batchRecords, recordsByIds, clearRecords, manualRecovery, cancelManualOperation }
}
