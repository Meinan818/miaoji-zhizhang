import { computed, onScopeDispose, ref } from 'vue'
import { acceptHMRUpdate, skipHydrate } from 'pinia'
import dayjs from 'dayjs'
import { createId, prepareBatch, prepareUpdate, prepareDelete, validDate } from '../utils/ledger.js'
import { legacyCents, getRecordTotals, MAX_CENTS } from '../utils/money.js'
import { mergeBackupRecords } from '../utils/ledgerBackup.js'
import { SERVER_MODE } from '../api/mode.js'
import { createRemoteLedger } from '../api/remoteLedger.js'
import { useAuthStore } from './authStore.js'
import { useLocalDay } from '../utils/calendar.js'
import { defineScopedStore } from '../utils/storeLifecycle.js'

export const RECORD_STORAGE_KEY = 'zhizhang_mock_records'

function createSampleRecords() {
  const month = dayjs().format('YYYY-MM')

  return [
    { id: 'sample-01', type: 'income', amount: 8000, category: '工资', icon: '💵', date: `${month}-01`, time: '09:00', remark: '本月工资' },
    { id: 'sample-02', type: 'expense', amount: 35, category: '餐饮', icon: '🍔', date: `${month}-05`, time: '12:30', remark: '工作日午餐' },
    { id: 'sample-03', type: 'expense', amount: 12, category: '交通', icon: '🚗', date: `${month}-08`, time: '08:20', remark: '地铁通勤' },
    { id: 'sample-04', type: 'expense', amount: 199, category: '购物', icon: '🛍️', date: `${month}-12`, time: '20:15', remark: '日用品补货' },
    { id: 'sample-05', type: 'expense', amount: 68, category: '娱乐', icon: '🎮', date: `${month}-15`, time: '19:30', remark: '周末电影' },
    { id: 'sample-06', type: 'expense', amount: 120, category: '住房', icon: '🏠', date: `${month}-18`, time: '10:00', remark: '水电燃气' },
    { id: 'sample-07', type: 'expense', amount: 88, category: '医疗', icon: '💊', date: `${month}-20`, time: '16:40', remark: '常用药品' },
    { id: 'sample-08', type: 'expense', amount: 76, category: '学习', icon: '📚', date: `${month}-22`, time: '21:10', remark: '专业书籍' },
    { id: 'sample-09', type: 'expense', amount: 260, category: '餐饮', icon: '🍔', date: `${month}-25`, time: '18:40', remark: '朋友聚餐' },
    { id: 'sample-10', type: 'expense', amount: 376, category: '购物', icon: '🛍️', date: `${month}-28`, time: '15:20', remark: '换季衣物' },
  ]
}



// Vite carries this registry to the next module so a hot setup can retire the
// previous listeners without replacing the live store or reloading the page.
const lifetimes = import.meta.hot ? (import.meta.hot.data.recordLifetimes ??= new WeakMap()) : new WeakMap()
export const useRecordStore = defineScopedStore('record', () => {
  if (SERVER_MODE) {
    const auth = useAuthStore()
    return createRemoteLedger(auth.api, computed(() => auth.user?.id), { storage: window.localStorage })
  }
  const storageError = ref('')
  function readLatest(fallback = createSampleRecords()) {
    try {
      if (typeof window === 'undefined') return fallback
      const raw = window.localStorage.getItem(RECORD_STORAGE_KEY)
      if (raw == null) return fallback
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed) || parsed.some(r => !r || typeof r !== 'object' || typeof r.id !== 'string'
        || !['expense', 'income'].includes(r.type) || !Number.isFinite(Number(r.amount)) || Number(r.amount) <= 0 || Number(r.amount) * 100 > MAX_CENTS
        || !validDate(r.date) || typeof r.category !== 'string'
        || (r.deletedAt !== undefined && (typeof r.deletedAt !== 'string' || !Number.isFinite(Date.parse(r.deletedAt)))))
        || new Set(parsed.map(r => r.id)).size !== parsed.length) throw new Error('invalid records')
      return parsed
    } catch {
      throw new Error('本地账单读取失败，为保护原数据暂不写入。请先备份浏览器数据，不要清除存储。')
    }
  }
  let initial
  try { initial = readLatest() } catch (e) { initial = []; storageError.value = e.message }
  const allRecords = skipHydrate(ref(initial))
  // All pages read active bills; batch lookup also retains deletion facts for old chat cards.
  const records = computed(() => allRecords.value.filter(r => !r.deletedAt))
  const { today } = useLocalDay()
  const monthRecords = computed(() => records.value.filter(r => r.date?.startsWith(today.value.slice(0, 7))))
  const monthTotals = computed(() => getRecordTotals(monthRecords.value))
  const summaryError = computed(() => monthTotals.value.error)
  const monthExpense = computed(() => monthTotals.value.expense)
  const monthIncome = computed(() => monthTotals.value.income)
  const monthExpenseCents = computed(() => monthTotals.value.expenseCents)
  function categories(type) {
    if (summaryError.value) return {}
    const cents = new Map()
    for (const r of monthRecords.value.filter(r => r.type === type)) cents.set(r.category, (cents.get(r.category) || 0) + legacyCents(r.amount))
    return Object.fromEntries([...cents].map(([k, v]) => [k, v / 100]))
  }
  const categoryExpenses = computed(() => categories('expense'))
  const categoryIncome = computed(() => categories('income'))

  function persist(next, errorMessage = '账单未保存：浏览器存储不可用或空间不足。草稿已保留，请稍后重试。') {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(RECORD_STORAGE_KEY, JSON.stringify(next))
    } catch {
      throw new Error(errorMessage)
    }
    allRecords.value = next
    storageError.value = ''
  }
  function refresh() {
    try { allRecords.value = readLatest(allRecords.value); storageError.value = ''; return true }
    catch (e) { storageError.value = e.message; return false }
  }
  function addRecords(inputs, { batchId = createId('batch'), source = 'chat' } = {}) {
    const latest = readLatest(allRecords.value)
    const result = prepareBatch(latest, inputs, { batchId, source })
    if (result.added) persist(result.records)
    else { allRecords.value = latest; storageError.value = '' }
    return result.saved
  }
  function addRecord(input, options = {}) {
    return addRecords([{ ...input, id: input.id || 'single' }], { source: 'manual', ...options })[0]
  }
  function updateRecord(id, input) {
    const result = prepareUpdate(readLatest(allRecords.value), id, input)
    persist(result.records)
    return result.updated
  }
  function deleteRecord(id) {
    const latest = readLatest(allRecords.value)
    const result = prepareDelete(latest, id)
    if (result.deleted) persist(result.records, '删除未完成：浏览器存储不可用或空间不足，原账单没有改变。请稍后重试。')
    else { allRecords.value = latest; storageError.value = '' }
    return result.updated
  }
  function batchRecords(id) { return allRecords.value.filter(r => r.draftGroupId === id) }
  function clearRecords() { persist([]) }
  // 备份导入：只追加不覆盖，已存在编号跳过；任何一条不合法都保持原账本。
  function importRecords(rows) {
    const latest = readLatest(allRecords.value)
    const result = mergeBackupRecords(latest, rows)
    if (result.imported) persist(result.merged, '导入未完成：浏览器存储不可用或空间不足，原账单没有改变。请稍后重试。')
    else { allRecords.value = latest; storageError.value = '' }
    return { imported: result.imported, skipped: result.skipped }
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    const listener = e => { if (e.key === RECORD_STORAGE_KEY || e.key == null) refresh() }
    window.addEventListener('storage', listener)
    onScopeDispose(() => window.removeEventListener('storage', listener))
  }
  return { allRecords, records, storageError, summaryError, monthRecords, monthExpense, monthExpenseCents, monthIncome, categoryExpenses, categoryIncome,
    addRecord, addRecords, updateRecord, deleteRecord, batchRecords, refresh, clearRecords, importRecords }
}, lifetimes)

// Keep an already-open development page on the current actions/getters without clearing its ledger.
export function createRecordStoreHMRHandler(hot) {
  return hot ? acceptHMRUpdate(useRecordStore, hot) : undefined
}
if (import.meta.hot) {
  // Vite needs this literal accept call to identify the store as a hot-update boundary.
  import.meta.hot.accept(createRecordStoreHMRHandler(import.meta.hot))
}
