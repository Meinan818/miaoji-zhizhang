import { computed, onScopeDispose, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { isValidMonth } from './statistics.js'
import { validDate } from './ledger.js'

function billDate(date, month) { return typeof date === 'string' && validDate(date) && date.startsWith(month + '-') ? date : '' }

export function createBillFilterPath({ month, query = '', type = 'all', category = '', date = '' }) {
  if (!isValidMonth(month)) throw new Error('请选择有效月份。')
  const params = new URLSearchParams({ month })
  if (billDate(date, month)) params.set('date', date)
  if (typeof query === 'string' && query) params.set('q', query.slice(0, 120))
  if (['income', 'expense'].includes(type)) params.set('type', type)
  if (typeof category === 'string' && category) params.set('category', category.slice(0, 120))
  return '/bills?' + params.toString()
}

export function useBillQuery(route, currentMonth = () => dayjs().format('YYYY-MM')) {
  const selectedMonth = ref(isValidMonth(route.query.month) ? route.query.month : currentMonth())
  const selectedDate = ref(billDate(route.query.date, selectedMonth.value))
  const searchText = ref(typeof route.query.q === 'string' ? route.query.q.slice(0, 120) : '')
  const selectedType = ref(['income', 'expense'].includes(route.query.type) ? route.query.type : 'all')
  const selectedCategory = ref(typeof route.query.category === 'string' ? route.query.category.slice(0, 120) : '')
  watch([() => route.query.month, () => route.query.date, () => route.query.q, () => route.query.type, () => route.query.category], () => {
    selectedMonth.value = isValidMonth(route.query.month) ? route.query.month : currentMonth()
    selectedDate.value = billDate(route.query.date, selectedMonth.value)
    searchText.value = typeof route.query.q === 'string' ? route.query.q.slice(0, 120) : ''
    selectedType.value = ['income', 'expense'].includes(route.query.type) ? route.query.type : 'all'
    selectedCategory.value = typeof route.query.category === 'string' ? route.query.category.slice(0, 120) : ''
  }, { flush: 'sync' })
  watch(selectedMonth, month => { if (!billDate(selectedDate.value, month)) selectedDate.value = '' }, { flush: 'sync' })
  function selectMonth(next) {
    if (!isValidMonth(next) || next === selectedMonth.value) return false
    selectedMonth.value = next
    selectedCategory.value = ''
    return true
  }
  function changeMonth(offset) {
    if (!Number.isInteger(offset)) return false
    return selectMonth(dayjs(selectedMonth.value + '-01').add(offset, 'month').format('YYYY-MM'))
  }
  return { selectedMonth, selectedDate, searchText, selectedType, selectedCategory, changeMonth, selectMonth }
}

export function useManualRecordSave(store, router, batchId, { owner } = {}) {
  const saving = ref(false), error = ref(''), savedRecord = ref(null)
  const restoredRecord = ref({}), notice = ref(''), cancelling = ref(false)
  let active = true
  onScopeDispose(() => { active = false })
  const initialOwner = owner?.()
  const ownerCurrent = ref(!owner || Boolean(initialOwner))
  if (owner) watch(owner, value => {
    if (value !== initialOwner) ownerCurrent.value = false
  }, { flush: 'sync' })
  const isCurrent = () => active && ownerCurrent.value
  async function navigateSaved() {
    if (!isCurrent()) return false
    const saved = savedRecord.value
    const failure = await router.push({ path: '/bills', query: { month: saved.date.slice(0, 7), added: saved.id } })
    if (!isCurrent()) return false
    if (failure) throw new Error('账单已保存，暂时未能打开明细，请重试打开；无需再次入账。')
    return true
  }
  async function save(record, originalBatchId = batchId) {
    if (!isCurrent() || saving.value) return false
    saving.value = true; error.value = ''; notice.value = ''
    try {
      if (!savedRecord.value) {
        const saved = await store.addRecord(record, { batchId: originalBatchId, source: 'manual' })
        if (!isCurrent()) return false
        savedRecord.value = saved
      }
      return await navigateSaved()
    } catch (failure) {
      if (isCurrent()) error.value = savedRecord.value ? '账单已保存，暂时未能打开明细，请重试打开；无需再次入账。' : failure.message
      return false
    } finally { if (isCurrent()) saving.value = false }
  }
  async function cancelPending(operation) {
    if (!isCurrent() || saving.value || savedRecord.value) return false
    saving.value = true; cancelling.value = true; error.value = ''; notice.value = ''
    try {
      await store.cancelManualOperation(operation.batchId)
      if (!isCurrent()) return false
      restoredRecord.value = { ...operation.record, id: undefined }
      notice.value = '这笔草稿已取消且未入账。内容已保留，请核对后再保存。'
      return true
    } catch (failure) { if (isCurrent()) error.value = failure.message; return false }
    finally { if (isCurrent()) { saving.value = false; cancelling.value = false } }
  }
  return { saving, error, savedRecord, save, cancelPending, restoredRecord, notice, cancelling, ownerCurrent }
}

export function useLedgerReload(store, { owner } = {}) {
  const reloading = ref(false), reloadError = ref('')
  let active = true
  onScopeDispose(() => { active = false })
  const initialOwner = owner?.()
  const ownerCurrent = ref(!owner || Boolean(initialOwner))
  if (owner) watch(owner, value => {
    if (value !== initialOwner) ownerCurrent.value = false
  }, { flush: 'sync' })
  const isCurrent = () => active && ownerCurrent.value
  async function reloadRecords(force = false) {
    if (!isCurrent() || reloading.value) return false
    reloading.value = true; reloadError.value = ''
    try {
      const loaded = await store.refresh(force === true)
      if (!isCurrent()) return false
      if (!loaded) reloadError.value = store.storageError || '账本暂未完整读到，原账本已保留，请重新读取。'
      return loaded === true
    } catch (failure) {
      if (isCurrent()) reloadError.value = failure?.message || '账本暂时无法读取，请稍后重试。'
      return false
    } finally { if (isCurrent()) reloading.value = false }
  }
  return { reloading, reloadError, reloadRecords }
}

export function useStatsMonthNavigation(route, router, currentMonth = () => dayjs().format('YYYY-MM'), { owner } = {}) {
  const selectedMonth = computed(() => isValidMonth(route.query.month) ? route.query.month : currentMonth())
  const pendingMonth = ref('')
  const navigationError = ref('')
  const navigationMonth = computed(() => pendingMonth.value || selectedMonth.value)
  let generation = 0
  let active = true
  onScopeDispose(() => { active = false; generation++ })
  const initialOwner = owner?.()
  const ownerCurrent = ref(!owner || Boolean(initialOwner))
  if (owner) watch(owner, value => {
    if (value !== initialOwner) ownerCurrent.value = false
  }, { flush: 'sync' })
  const isCurrent = () => active && ownerCurrent.value
  async function selectMonth(next) {
    if (!isCurrent() || !isValidMonth(next) || next === navigationMonth.value) return false
    const current = ++generation
    pendingMonth.value = next; navigationError.value = ''
    try {
      const failure = await router.replace({ query: { ...route.query, month: next }, hash: route.hash || '' })
      if (!isCurrent() || current !== generation) return false
      if (failure || selectedMonth.value !== next) {
        navigationError.value = '月份未能切换，仍显示原月份，请重试。'
        return false
      }
      return true
    } catch {
      if (isCurrent() && current === generation) navigationError.value = '月份暂时无法切换，仍显示原月份，请重试。'
      return false
    } finally {
      if (isCurrent() && current === generation) pendingMonth.value = ''
    }
  }
  function changeMonth(offset) {
    if (!isCurrent() || !Number.isInteger(offset)) return false
    return selectMonth(dayjs(navigationMonth.value + '-01').add(offset, 'month').format('YYYY-MM'))
  }
  return { selectedMonth, pendingMonth, navigationMonth, navigationError, changeMonth, selectMonth, ownerCurrent }
}

// 页面滚动与账单定位各自负责，防止导航回顶覆盖保存后的新行。
export function getScrollPosition(to, from, savedPosition) {
  if (savedPosition) return savedPosition
  if (to.path === from.path) return false
  if (to.path === '/bills' && typeof to.query?.added === 'string' && to.query.added) return false
  return { left: 0, top: 0 }
}
