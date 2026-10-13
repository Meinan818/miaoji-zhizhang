<script setup>
import CategoryIcon from '@/components/common/CategoryIcon.vue'
import ManualEntry from '@/components/record/ManualEntry.vue'
// 1. 导入
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import RecordEditor from '@/components/record/RecordEditor.vue'
import { centsText, getRecordTotals } from '@/utils/money'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import NotebookBack from '@/components/common/NotebookBack.vue'
import MonthPicker from '@/components/common/MonthPicker.vue'
import DatePicker from '@/components/common/DatePicker.vue'
import miaoWriting from '@/assets/design/mascot/poses/miao-writing.png'
import receiptKitten from '@/assets/design/mascot/poses/cream-receipt.png'
import BottomNav from '@/components/layout/BottomNav.vue'
import { useRecordStore } from '@/stores/recordStore'
import { useAuthStore } from '@/stores/authStore'
import { createBillCsv } from '@/utils/billCsv'
import { downloadCsv } from '@/utils/download'
import { formatCurrency } from '@/utils/format'
import { filterRecords, windowRecordGroups } from '@/utils/journal'
import { CATEGORY_OPTIONS } from '@/utils/categories'
import { getCategoryArtwork } from '@/utils/categoryArtwork'
import { SERVER_MODE } from '@/api/mode'
import { createBillFilterPath, useBillQuery, useLedgerReload } from '@/utils/navigation'
import { useLocalDay } from '@/utils/calendar'
import { isValidMonth } from '@/utils/statistics'
import { validDate } from '@/utils/ledger'

// 2. 组合式函数
const recordStore = useRecordStore()
const auth = SERVER_MODE ? useAuthStore() : null
const { reloading, reloadError, reloadRecords } = useLedgerReload(recordStore, { owner: SERVER_MODE ? () => auth.user?.id : undefined })
const { today } = useLocalDay()
const currentMonth = computed(() => today.value.slice(0, 7))

// 3. 响应式数据
const route = useRoute()
const router = useRouter()
const { selectedMonth, selectedDate, searchText, selectedType, selectedCategory } = useBillQuery(route)
const manualEntryTarget = computed(() => ({ path: '/add', query: {
  ...(selectedDate.value ? { date: selectedDate.value } : {}),
  returnTo: createBillFilterPath({ month: selectedMonth.value, date: selectedDate.value, query: searchText.value,
    type: selectedType.value, category: selectedCategory.value }) + (route.hash || ''),
} }))
const editingRecord = ref(null)
const saving = ref(false)
const resettingFilters = ref(false)
const pendingMonth = ref('')
const savedEditMonth = ref('')
const repeating = ref(false)
const saveError = ref('')
const editConflict = ref(null)
const notice = ref('')
const noticeElement = ref(null)
const searchInput = ref(null)
let active = true
onScopeDispose(() => { active = false })
const owner = auth?.user?.id
const ownerCurrent = ref(!SERVER_MODE || Boolean(owner))
if (SERVER_MODE) watch(() => auth.user?.id, value => {
  if (value !== owner) ownerCurrent.value = false
}, { flush: 'sync' })
const canReturnToCurrentMonth = computed(() => ownerCurrent.value && !saving.value && !resettingFilters.value && !editingRecord.value && selectedMonth.value !== currentMonth.value)
const exportError = ref('')
const copyingLink = ref(false)
const filterLinkText = ref('')
const filterLinkMessage = ref('')
let filterLinkGeneration = 0
const copyLinkUnavailable = computed(() => !active || !ownerCurrent.value || copyingLink.value || saving.value || resettingFilters.value || Boolean(editingRecord.value))
watch([selectedMonth, selectedDate, searchText, selectedType, selectedCategory, editingRecord, ownerCurrent], () => {
  filterLinkGeneration++
  filterLinkText.value = ''; filterLinkMessage.value = ''
}, { flush: 'sync' })
async function copyFilterLink() {
  if (!active || !ownerCurrent.value || copyLinkUnavailable.value) return false
  const generation = ++filterLinkGeneration
  copyingLink.value = true
  filterLinkText.value = ''; filterLinkMessage.value = ''
  const current = () => active && ownerCurrent.value && generation === filterLinkGeneration
  let link = ''
  try {
    link = new URL(createBillFilterPath({ month: selectedMonth.value, query: searchText.value,
      type: selectedType.value, category: selectedCategory.value, date: selectedDate.value }), window.location.origin).href
    if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(link)
    if (!current()) return false
    filterLinkMessage.value = '已复制当前筛选链接。'
    return true
  } catch {
    if (current()) {
      filterLinkText.value = link
      filterLinkMessage.value = link ? '自动复制未完成，请选中下方链接手动复制。' : '链接暂时无法生成，请重试。'
    }
    return false
  } finally { if (active && ownerCurrent.value) copyingLink.value = false }
}
const displayBatchSize = 60
const visibleLimit = ref(displayBatchSize)
watch([selectedMonth, selectedDate, searchText, selectedType, selectedCategory], () => { visibleLimit.value = displayBatchSize })

// 4. 计算属性
const monthTitle = computed(() => dayjs(`${selectedMonth.value}-01`).format('YYYY年M月'))
const monthRecords = computed(() => recordStore.records
  .filter((record) => record.date?.startsWith(selectedMonth.value))
  .sort((left, right) => {
    const leftKey = `${left.date} ${left.time || '00:00'}`
    const rightKey = `${right.date} ${right.time || '00:00'}`
    return rightKey.localeCompare(leftKey)
  }))

const monthTotals = computed(() => getRecordTotals(monthRecords.value))
const needsWideAmounts = computed(() => !monthTotals.value.error && [monthTotals.value.incomeCents, monthTotals.value.expenseCents, monthTotals.value.balanceCents].some(value => centsText(value).length > 7))

const listedRecords = computed(() => filterRecords(monthRecords.value, { query: searchText.value, type: selectedType.value, category: selectedCategory.value, date: selectedDate.value }))
const filteredTotals = computed(() => getRecordTotals(listedRecords.value))
const needsWideFilteredAmounts = computed(() => !filteredTotals.value.error && [filteredTotals.value.incomeCents, filteredTotals.value.expenseCents].some(value => centsText(value).length > 7))
const filtering = computed(() => Boolean(selectedDate.value || searchText.value.trim() || selectedCategory.value || selectedType.value !== 'all'))
const exportUnavailable = computed(() => !active || !ownerCurrent.value || Boolean(recordStore.storageError || reloadError.value) ||
  reloading.value || saving.value || resettingFilters.value || Boolean(editingRecord.value) || !listedRecords.value.length)
watch([selectedMonth, selectedDate, searchText, selectedType, selectedCategory], () => { exportError.value = '' })
function exportBills() {
  if (exportUnavailable.value || !active) return
  exportError.value = ''; notice.value = ''
  try {
    const snapshot = listedRecords.value.map(record => ({ ...record }))
    const csv = createBillCsv(snapshot)
    downloadCsv(csv, `miaoji-bills-${selectedDate.value || selectedMonth.value}${filtering.value ? '-filtered' : ''}.csv`)
    notice.value = `已发起下载 ${snapshot.length} 笔${filtering.value ? '筛选' : '本月'}账单，请查看浏览器下载记录。`
  } catch (failure) { exportError.value = '导出未完成：' + failure.message }
}
const filterCategories = computed(() => {
  const counts = new Map()
  for (const record of monthRecords.value) {
    if (selectedType.value !== 'all' && record.type !== selectedType.value) continue
    const key = JSON.stringify([record.type, record.category])
    if (!counts.has(key)) counts.set(key, { type:record.type, category:record.category, count:0 })
    counts.get(key).count++
  }
  const options = Object.values(CATEGORY_OPTIONS).flat().map(item => item.label)
  return [...counts.values()].sort((a,b) => options.indexOf(a.category) - options.indexOf(b.category))
})
function chooseType(type) { if (resettingFilters.value) return; selectedType.value = type; selectedCategory.value = '' }
function chooseCategory(item) {
  if (resettingFilters.value) return
  const alreadyChosen = selectedType.value === item.type && selectedCategory.value === item.category
  selectedType.value = item.type
  selectedCategory.value = alreadyChosen ? '' : item.category
}
async function resetFilters() {
  if (!active || !ownerCurrent.value || saving.value || resettingFilters.value || editingRecord.value) return
  selectedType.value = 'all'; selectedCategory.value = ''; selectedDate.value = ''
  await clearSearch()
}
function resetFilterAddress() { return clearFilterAddress(true) }
function clearSearchAddress() { return clearFilterAddress(false) }
function clearDateAddress() { return clearFilterAddress(false, true) }
function chooseDate(date) {
  if (!active || !ownerCurrent.value || saving.value || resettingFilters.value || editingRecord.value || recordStore.storageError
    || typeof date !== 'string' || !validDate(date) || !date.startsWith(selectedMonth.value + '-') || date === selectedDate.value) return false
  const query = { ...route.query, month: selectedMonth.value, date }
  if (searchText.value) query.q = searchText.value
  else delete query.q
  if (selectedType.value === 'all') delete query.type
  else query.type = selectedType.value
  if (selectedCategory.value) query.category = selectedCategory.value
  else delete query.category
  return replaceFilterAddress(query, { errorMessage: '日期暂时未能切换，原条件已保留，请重试。' })
}
async function clearFilterAddress(clearAll, dateOnly = false) {
  const query = { ...route.query, month: selectedMonth.value }
  if (dateOnly && searchText.value) query.q = searchText.value
  else delete query.q
  if (clearAll || dateOnly) delete query.date
  if (clearAll || selectedType.value === 'all') delete query.type
  else query.type = selectedType.value
  if (clearAll || !selectedCategory.value) delete query.category
  else query.category = selectedCategory.value
  return replaceFilterAddress(query, { afterNavigate: () => dateOnly ? focusSearchInput() : clearAll ? resetFilters() : clearSearch() })
}
async function replaceFilterAddress(query, { afterNavigate = async () => {}, errorMessage = '筛选暂时未能重置，原条件已保留，请重试。' } = {}) {
  if (!active || !ownerCurrent.value || saving.value || resettingFilters.value || editingRecord.value) return false
  notice.value = ''
  const keys = ['month', 'date', 'q', 'type', 'category']
  const needsNavigation = keys.some(key => route.query[key] !== query[key] || (key in route.query) !== (key in query))
  if (!needsNavigation) { await afterNavigate(); return true }
  resettingFilters.value = true
  let completed = false
  try {
    const failure = await router.replace({ path: '/bills', query, hash: route.hash || '' })
    if (!active || !ownerCurrent.value) return false
    if (failure) throw new Error('navigation failed')
    if (route.path !== '/bills' || keys.some(key => route.query[key] !== query[key] || (key in route.query) !== (key in query))) return false
    completed = true
  } catch {
    if (active && ownerCurrent.value) notice.value = errorMessage
  } finally {
    if (active && ownerCurrent.value) resettingFilters.value = false
  }
  if (completed) await afterNavigate()
  return completed
}
const groupedRecords = computed(() => {
  const groups = new Map()

  listedRecords.value.forEach((record) => {
    if (!groups.has(record.date)) {
      groups.set(record.date, [])
    }

    groups.get(record.date).push(record)
  })

  return [...groups.entries()].map(([date, records]) => ({
    date,
    label: getDateLabel(date),
    ...getRecordTotals(records),
    records,
  }))
})

const highlightedId = computed(() => typeof route.query.added === 'string' ? route.query.added : '')
const visibleGroups = computed(() => windowRecordGroups(groupedRecords.value, { limit: visibleLimit.value, revealId: highlightedId.value }))
const displayedCount = computed(() => visibleGroups.value.reduce((count, group) => count + group.records.length, 0))
const hiddenCount = computed(() => listedRecords.value.length - displayedCount.value)
const recordElements = new Map()
function setRecordElement(id, element) { if (element) recordElements.set(id, element); else recordElements.delete(id) }
async function loadMoreRecords() {
  if (!active || !ownerCurrent.value || editingRecord.value) return
  const query = JSON.stringify([selectedMonth.value, selectedDate.value, searchText.value, selectedType.value, selectedCategory.value, highlightedId.value])
  const nextRecord = listedRecords.value.slice(visibleLimit.value, visibleLimit.value + displayBatchSize)
    .find(record => record.id !== highlightedId.value)
  visibleLimit.value += displayBatchSize
  const limit = visibleLimit.value
  await nextTick()
  if (!active || !ownerCurrent.value || editingRecord.value || limit !== visibleLimit.value ||
    query !== JSON.stringify([selectedMonth.value, selectedDate.value, searchText.value, selectedType.value, selectedCategory.value, highlightedId.value])) return
  const element = recordElements.get(nextRecord?.id)
  element?.focus({ preventScroll: true })
  element?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
}
watch([highlightedId, selectedMonth, () => monthRecords.value.some(record => record.id === highlightedId.value)], async ([id], previous, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  if (!active || !ownerCurrent.value || !id || !monthRecords.value.some(record => record.id === id)) return
  notice.value = '新账单已保存，已定位到刚刚记下的这一笔。'
  resetFilters()
  await nextTick()
  if (!active || !ownerCurrent.value || !current || id !== highlightedId.value || filtering.value || editingRecord.value) return
  const element = recordElements.get(id)
  element?.scrollIntoView({ block: 'center', behavior: 'auto' })
  element?.focus({ preventScroll: true })
}, { immediate: true })

function edit(record) {
  if (!active || !ownerCurrent.value || saving.value || resettingFilters.value || editingRecord.value) return
  savedEditMonth.value = ''
  editingRecord.value = { ...record }; saveError.value = ''; editConflict.value = null; notice.value = ''
}
async function repeatRecord() {
  if (!active || !ownerCurrent.value || saving.value || editConflict.value || !editingRecord.value) return false
  const id = editingRecord.value.id
  if (!recordStore.records.some(record => record.id === id && !record.deletedAt)) return false
  saving.value = true; repeating.value = true; saveError.value = ''
  try {
    const returnTo = createBillFilterPath({ month: selectedMonth.value, query: searchText.value,
      type: selectedType.value, category: selectedCategory.value, date: selectedDate.value }) + (route.hash || '')
    const failure = await router.push({ path: '/add', query: { repeat: id, returnTo } })
    if (!active || !ownerCurrent.value) return false
    if (failure) throw new Error('暂时未能打开新账单，原账单和编辑窗口已保留，请重试。')
    return true
  } catch (failure) {
    if (active && ownerCurrent.value) saveError.value = failure.message
    return false
  } finally { if (active && ownerCurrent.value) { saving.value = false; repeating.value = false } }
}
function handleEditFailure(failure) {
  if (!active || !ownerCurrent.value) return
  saveError.value = failure.message
  if (failure.recoveryLoaded) editConflict.value = { current: failure.currentRecord }
}
function adoptLatestVersion() {
  if (!active || !ownerCurrent.value || saving.value || !editingRecord.value || !editConflict.value?.current) return
  editingRecord.value = { ...editingRecord.value, version: editConflict.value.current.version }
  editConflict.value = null; saveError.value = ''
}
async function saveEdit(input) {
  if (!active || !ownerCurrent.value || saving.value || editConflict.value || !editingRecord.value) return
  saving.value = true; saveError.value = ''
  let saved = false
  try {
    const updated = await recordStore.updateRecord(editingRecord.value.id, input, { version: editingRecord.value.version })
    if (!active || !ownerCurrent.value) return
    selectedMonth.value = updated.date.slice(0, 7); editingRecord.value = null; notice.value = '已保存修改：首页、明细和聊天查询已同步。'
    savedEditMonth.value = route.query.month === selectedMonth.value ? '' : selectedMonth.value
    saved = true
  }
  catch (e) { if (active && ownerCurrent.value) handleEditFailure(e) }
  finally { if (active && ownerCurrent.value) saving.value = false }
  if (saved && active && ownerCurrent.value && savedEditMonth.value) await syncSavedEditMonth()
}
async function syncSavedEditMonth() {
  if (!active || !ownerCurrent.value || saving.value || resettingFilters.value || editingRecord.value || !savedEditMonth.value) return false
  const month = savedEditMonth.value, query = { ...route.query, month }
  if (selectedDate.value) query.date = selectedDate.value
  else delete query.date
  if (searchText.value) query.q = searchText.value
  else delete query.q
  if (selectedType.value === 'all') delete query.type
  else query.type = selectedType.value
  if (selectedCategory.value) query.category = selectedCategory.value
  else delete query.category
  const completed = await replaceFilterAddress(query, { errorMessage: '修改已保存，月份地址暂时未能同步。请重试同步月份，无需再次保存。' })
  if (!active || !ownerCurrent.value || month !== savedEditMonth.value) return false
  if (completed) {
    savedEditMonth.value = ''
    notice.value = '已保存修改：首页、明细和聊天查询已同步。'
  }
  return completed
}

async function deleteEdit() {
  if (!active || !ownerCurrent.value || saving.value || editConflict.value || !editingRecord.value) return
  if (typeof recordStore.deleteRecord !== 'function') { saveError.value = '当前页面仍使用旧版本数据模块。请先退出编辑并刷新页面，原账单尚未删除。'; return }
  saving.value = true; saveError.value = ''
  try {
    await recordStore.deleteRecord(editingRecord.value.id, { version: editingRecord.value.version })
    if (!active || !ownerCurrent.value) return
    editingRecord.value = null; notice.value = '这笔账单已删除：首页、明细和聊天查询已同步。'
    await nextTick(); if (active && ownerCurrent.value) noticeElement.value?.focus()
  }
  catch (e) { if (active && ownerCurrent.value) handleEditFailure(e) }
  finally { if (active && ownerCurrent.value) saving.value = false }
}

// 5. 方法
let searchFocusGeneration = 0
watch([selectedMonth, selectedDate, searchText, selectedType, selectedCategory, editingRecord], () => {
  searchFocusGeneration++
}, { flush: 'sync' })
async function clearSearch() {
  if (!active || !ownerCurrent.value || resettingFilters.value || editingRecord.value) return
  searchText.value = ''
  await focusSearchInput()
}
async function focusSearchInput() {
  const current = ++searchFocusGeneration
  await nextTick()
  if (!active || !ownerCurrent.value || resettingFilters.value || editingRecord.value || current !== searchFocusGeneration) return
  searchInput.value?.focus()
}

function changeMonth(offset) {
  if (!Number.isInteger(offset)) return false
  return chooseMonth(dayjs(selectedMonth.value + '-01').add(offset, 'month').format('YYYY-MM'))
}

function returnToCurrentMonth() {
  if (!active || !canReturnToCurrentMonth.value) return false
  return chooseMonth(currentMonth.value)
}

function chooseMonth(month) {
  if (!active || !ownerCurrent.value || saving.value || resettingFilters.value || editingRecord.value || !isValidMonth(month) || month === selectedMonth.value) return false
  return navigateMonth(month)
}
async function navigateMonth(month) {
  const query = { ...route.query, month }
  delete query.date
  if (searchText.value) query.q = searchText.value
  else delete query.q
  if (selectedType.value === 'all') delete query.type
  else query.type = selectedType.value
  delete query.category
  pendingMonth.value = month
  try { return await replaceFilterAddress(query, { errorMessage: '月份暂时未能切换，仍显示原月份，请重试。' }) }
  finally { if (active && ownerCurrent.value) pendingMonth.value = '' }
}

function getDateLabel(date) {
  const target = dayjs(date)
  const currentDay = dayjs(today.value).startOf('day')

  if (target.isSame(currentDay, 'day')) {
    return '今天'
  }

  if (target.isSame(currentDay.subtract(1, 'day'), 'day')) {
    return '昨天'
  }

  return target.format('M月D日 dddd')
}

function getSign(record) {
  return record.type === 'income' ? '+' : '-'
}
</script>

<template>
  <div class="journal-bills notebook-evolution">
    <main v-if="ownerCurrent" class="bills-content">
      <header class="bills-header">
        <NotebookBack />
        <img :src="miaoWriting" alt="猫猫抱着账本陪你看明细" class="bills-header-cat" />
        <div class="bills-heading-text">
          <h1 class="bills-title">账单明细</h1>
          <p class="bills-subtitle">喵叽智账 · {{ SERVER_MODE ? '当前账号' : '本地演示' }}</p>
        </div>
      </header>

      <ManualEntry :to="manualEntryTarget" class="bills-manual-link" />
      <div v-if="recordStore.storageError || reloadError" class="bills-alert" role="alert" :aria-busy="reloading"><p>{{ recordStore.storageError || reloadError }}</p><button type="button" :disabled="reloading" @click="reloadRecords(true)">{{ reloading ? '正在读取…' : '重新读取账单' }}</button></div>
      <p v-if="notice" ref="noticeElement" class="bills-notice" role="status" tabindex="-1">{{ notice }}</p>
      <div v-if="savedEditMonth" class="bills-alert"><button type="button" :disabled="saving || resettingFilters || Boolean(editingRecord)" :aria-busy="resettingFilters" @click="syncSavedEditMonth">{{ resettingFilters ? '正在同步月份…' : '同步已保存账单的月份' }}</button></div>

      <section class="bills-summary" aria-label="月度账单汇总">
        <div class="bills-month">
          <button
            type="button"
            class="bills-month-button active:scale-95"
            aria-label="上个月"
            :disabled="resettingFilters || selectedMonth === '1000-01'"
            @click="changeMonth(-1)"
          >
            <ChevronLeft :size="22" :stroke-width="1.5" />
          </button>
          <h2>{{ monthTitle }}</h2>
          <button
            type="button"
            class="bills-month-button active:scale-95"
            aria-label="下个月"
            :disabled="resettingFilters || selectedMonth === '9999-12'"
            @click="changeMonth(1)"
          >
            <ChevronRight :size="22" :stroke-width="1.5" />
          </button>
        </div>
        <p v-if="pendingMonth" class="bills-notice" role="status">正在切换到 {{ dayjs(pendingMonth + '-01').format('YYYY年M月') }}…</p>
        <div class="bills-month-shortcuts"><MonthPicker :month="selectedMonth" :disabled="!ownerCurrent || saving || resettingFilters || Boolean(editingRecord)" label="选择明细月份" @select="chooseMonth" /><button type="button" class="bills-month-button bills-current-month" aria-label="回到本月" :disabled="!canReturnToCurrentMonth" @click="returnToCurrentMonth">{{ selectedMonth === currentMonth ? '已在本月' : '回到本月' }}</button></div>

        <p v-if="!recordStore.storageError && monthTotals.error" class="bills-storage-note" role="alert">{{ monthTotals.error }}</p>
        <dl v-else-if="!recordStore.storageError" class="bills-totals" :class="{ 'bills-totals-wide': needsWideAmounts }">
          <div class="bills-total-income">
            <dt>收入</dt>
            <dd class="bills-income">¥{{ centsText(monthTotals.incomeCents) }}</dd>
          </div>
          <div class="bills-total-expense">
            <dt>支出</dt>
            <dd class="bills-expense">¥{{ centsText(monthTotals.expenseCents) }}</dd>
          </div>
          <div class="bills-total-balance">
            <dt>结余</dt>
            <dd>¥{{ centsText(monthTotals.balanceCents) }}</dd>
          </div>
        </dl>
      </section>

      <div v-if="!recordStore.storageError" class="bills-day-picker"><DatePicker :month="selectedMonth" :date="selectedDate" :disabled="!ownerCurrent || resettingFilters || saving || Boolean(editingRecord)" label="选择明细日期" @select="chooseDate" /></div>
      <div v-if="selectedDate && !recordStore.storageError" class="bills-date-filter" role="group" aria-label="当前日期筛选"><span>只看 {{ selectedDate }}</span><button type="button" :disabled="resettingFilters || saving || Boolean(editingRecord)" :aria-busy="resettingFilters" @click="clearDateAddress">取消日期限制</button></div>
      <section class="bills-search-card" aria-label="只读账单搜索"><label for="bills-search" class="edition-kicker">翻翻本月的小票</label><div class="bills-search-row"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" stroke-linecap="round" /></svg><input ref="searchInput" id="bills-search" v-model="searchText" type="search" maxlength="120" aria-label="搜索本月账单" placeholder="分类、备注、日期或金额…" :disabled="resettingFilters || Boolean(recordStore.storageError)" /><button v-if="searchText" type="button" aria-label="清除搜索条件" :disabled="resettingFilters" :aria-busy="resettingFilters" @click="clearSearchAddress">清除</button></div></section>
      <section v-if="!recordStore.storageError && monthRecords.length" class="bills-filter-shelf" aria-label="按收支和分类筛选">
        <div class="bills-filter-heading"><span>挑一张分类贴纸</span><div class="bills-type-tabs" aria-label="筛选收支"><button v-for="type in ['all','expense','income']" :key="type" type="button" :disabled="resettingFilters" :aria-pressed="selectedType === type" :class="{ selected:selectedType === type }" @click="chooseType(type)">{{ type === 'all' ? '全部' : type === 'income' ? '收入' : '支出' }}</button></div></div>
        <div class="bills-filter-chips hide-scrollbar" aria-label="分类贴纸，可左右滑动"><button v-for="item in filterCategories" :key="item.type + item.category" type="button" class="bills-category-chip" :disabled="resettingFilters" :class="{ selected:selectedType === item.type && selectedCategory === item.category }" :aria-pressed="selectedType === item.type && selectedCategory === item.category" :aria-label="'筛选' + (item.type === 'income' ? '收入' : '支出') + '分类：' + item.category" :style="{ '--chip-paper':getCategoryArtwork(item.category,item.type).paper }" @click="chooseCategory(item)"><CategoryIcon :category="item.category" :type="item.type" /><span>{{ item.category }}</span><small>{{ item.count }}</small></button></div>
      </section>
      <div v-if="filtering && !recordStore.storageError" class="bills-filter-result"><p class="bills-search-feedback" role="status">{{ selectedDate ? selectedDate + ' · ' : '' }}{{ selectedCategory || (selectedType === 'all' ? '全部分类' : selectedType === 'income' ? '收入' : '支出') }} · 找到 {{ listedRecords.length }} 笔<br><span>只筛选小票，本月收支汇总不变</span></p><button type="button" :disabled="resettingFilters" :aria-busy="resettingFilters" @click="resetFilterAddress">{{ resettingFilters ? (pendingMonth || savedEditMonth ? '请稍候…' : '正在重置…') : '查看全部' }}</button></div>
      <section v-if="filtering && !recordStore.storageError" class="bills-filter-summary" aria-label="筛选结果汇总">
        <p class="bills-filter-summary-heading">当前筛选小计<span>包含未展开的小票</span></p>
        <p v-if="filteredTotals.error" class="bills-storage-note" role="alert">{{ filteredTotals.error }}</p>
        <dl v-else class="bills-filter-totals" :class="{ 'bills-filter-totals-wide': needsWideFilteredAmounts }">
          <div><dt>筛选收入</dt><dd class="bills-income">¥{{ centsText(filteredTotals.incomeCents) }}</dd></div>
          <div><dt>筛选支出</dt><dd class="bills-expense">¥{{ centsText(filteredTotals.expenseCents) }}</dd></div>
        </dl>
      </section>
      <div class="bills-export">
        <button type="button" :disabled="exportUnavailable" @click="exportBills">{{ filtering ? '导出筛选账单' : '导出本月账单' }} · CSV</button>
        <button type="button" :disabled="copyLinkUnavailable" :aria-busy="copyingLink" @click="copyFilterLink">{{ copyingLink ? '正在复制…' : '复制当前筛选链接' }}</button>
        <p>下载完整{{ filtering ? '筛选结果' : '月份账单' }}，包含尚未展开的小票</p>
        <p v-if="exportError" class="bills-alert" role="alert">{{ exportError }}</p>
        <p>链接保留月份和筛选条件；打开后查看{{ SERVER_MODE ? '当前登录账号的账本' : '当前浏览器的演示账本' }}。</p>
        <p v-if="filterLinkMessage" role="status">{{ filterLinkMessage }}</p>
        <textarea v-if="filterLinkText" class="bills-filter-link" :value="filterLinkText" readonly rows="3" aria-label="当前筛选链接，选中后可手动复制"></textarea>
      </div>
      <p class="bills-storage-note">{{ SERVER_MODE ? '账单保存在当前账号；这里的修改会同步到首页和聊天查询' : '账单保存在当前浏览器；这里的修改会同步到首页和聊天查询' }}</p>
      <p v-if="groupedRecords.length" class="bills-edit-hint">点账单可编辑</p>

      <section v-if="groupedRecords.length" class="bills-groups" aria-label="按日账单">
        <div v-for="group in visibleGroups" :key="group.date" class="bills-day-group">
          <div class="bills-day-heading">
            <h3>{{ group.label }}</h3>
            <div class="bills-day-totals">
              <span v-if="group.error" role="alert">{{ group.error }}</span>
              <span v-if="!group.error && group.incomeCents" class="bills-income">
                收入 +¥{{ centsText(group.incomeCents) }}
              </span>
              <span v-if="!group.error && group.expenseCents" class="bills-expense">
                支出 -¥{{ centsText(group.expenseCents) }}
              </span>
            </div>
          </div>

          <p v-if="group.records.length < group.totalCount" class="bills-window-note">本日共 {{ group.totalCount }} 笔，已展示 {{ group.records.length }} 笔 · 合计包含全部{{ filtering ? '匹配' : '' }}账单</p>
          <div class="space-y-2">
            <article
              v-for="record in group.records"
              :key="record.id"
              :data-record-id="record.id"
              :ref="element => setRecordElement(record.id, element)"
              class="bills-record"
              :class="{ 'bills-record-highlighted': record.id === highlightedId }"
              role="button"
              tabindex="0"
              :aria-label="'编辑账单：' + record.category + '，' + (record.remark || '无备注') + '，' + formatCurrency(record.amount)"
              @click="edit(record)"
              @keydown.enter.prevent="edit(record)"
              @keydown.space.prevent="edit(record)"
            >
              <div class="bills-record-main">
                <span class="bills-record-stamp" aria-hidden="true"><CategoryIcon :category="record.category" :type="record.type" /></span>
                <div class="bills-record-text">
                  <p>{{ record.category }} <span v-if="record.id === highlightedId" class="bills-added-tag">刚刚记下</span></p>
                  <p class="bills-subtitle">{{ record.time || '--:--' }} · {{ record.remark || '无备注' }}</p>
                </div>
              </div>
              <div class="bills-record-actions">
              <p
                class="bills-record-amount"
                :class="record.type === 'income' ? 'bills-income' : 'bills-expense'"
              >
                {{ getSign(record) }}{{ formatCurrency(record.amount) }}
              </p>
                <ChevronRight class="bills-record-chevron" :size="16" :stroke-width="1.5" aria-hidden="true" />
              </div>
            </article>
          </div>
        </div>
        <div v-if="hiddenCount > 0" class="bills-load-more">
          <p class="bills-window-note" role="status">已展示 {{ displayedCount }} / {{ listedRecords.length }} 笔{{ filtering ? '匹配账单' : '账单' }}</p>
          <button type="button" :disabled="Boolean(recordStore.storageError)" @click="loadMoreRecords">继续翻小票</button>
        </div>
      </section>

      <section v-else-if="!recordStore.storageError" class="bills-empty" aria-label="无账单">
        <img :src="receiptKitten" alt="拿着小票的奶油猫" />
        <p>{{ filtering ? '没有找到符合当前条件的小票' : '这个月还没有小账单' }}</p>
        <p class="bills-subtitle">{{ selectedDate ? '当前只看 ' + selectedDate + '，可以取消日期限制或调整其他条件' : filtering ? '调整关键词、收支或分类，或查看全部' : '点下方「聊着记」或上方「手动记一笔」，本喵帮你记下' }}</p>
      </section>
    </main>

    <main v-else class="bills-content"><NotebookBack /><h1 class="bills-title">账单明细</h1><p class="bills-storage-note" role="status">登录身份已变化，请重新打开账单明细。</p></main>
    <RecordEditor v-if="editingRecord && ownerCurrent" :key="editingRecord.id" :record="editingRecord" :saving="saving" :progress-label="repeating ? '正在打开新账单…' : ''" :error="saveError" :conflict="editConflict" allow-delete allow-repeat @repeat="repeatRecord" @recover="adoptLatestVersion" @delete="deleteEdit" @save="saveEdit" @close="editingRecord = null" />
    <BottomNav active="detail" :month="selectedMonth" />
  </div>
</template>

<style scoped>
.bills-export { margin-top:16px; text-align:center; color:var(--zz-home-ink-soft); font-size:11px; line-height:1.8; }
.bills-export button { min-height:44px; margin:3px; padding:9px 16px; border:1px solid #b79076; border-radius:13px; background:#fff7ec; color:#785640; font-size:12px; }
.bills-export button:disabled { opacity:.5; cursor:not-allowed; }
.bills-export button:focus-visible { outline:2px solid var(--zz-home-ink); outline-offset:3px; }
.bills-filter-link { display:block; width:100%; box-sizing:border-box; margin-top:8px; padding:10px; border:1px solid #b79076; border-radius:10px; background:#fffaf3; color:var(--zz-home-ink); font-size:12px; overflow-wrap:anywhere; resize:vertical; }
.bills-export p { margin-top:6px; }
.bills-filter-shelf { margin-top:18px; }
.bills-filter-heading { display:flex; align-items:center; justify-content:space-between; gap:6px; color:#846450; font-size:12px; }
.bills-type-tabs { display:flex; gap:3px; border:1px solid #e5cbb5; border-radius:15px; background:#fff7ec; padding:3px; }
.bills-type-tabs button { min-height:38px; padding:0 11px; border-radius:12px; }
.bills-type-tabs button.selected { background:#f4d2d9; color:#814d60; box-shadow:0 2px 0 #e8bac6; }
.bills-filter-chips { display:flex; gap:9px; overflow-x:auto; padding:13px 2px 9px; }
.bills-category-chip { display:flex; align-items:center; gap:5px; position:relative; flex:0 0 auto; padding:7px 11px 7px 6px; min-height:52px; border:1.5px solid #e2c8b4; border-radius:18px; background:#fffaf1; box-shadow:0 3px 0 #edd9c4; color:#775440; font-size:12px; }
.bills-category-chip .category-icon { width:34px; height:34px; }
.bills-category-chip small { color:#8b7262; font-size:10px; padding-left:2px; }
.bills-category-chip.selected { background:var(--chip-paper); border-color:#b68b77; box-shadow:0 3px 0 #d5b4a1; }
.bills-day-picker { margin-top:16px; }
.bills-date-filter { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-top:16px; padding:8px 12px; border:1px dashed #dfbfa7; border-radius:14px; background:#fffaf0; color:#815b46; font-size:12px; }
.bills-date-filter button { min-height:44px; padding:6px 10px; border:1px solid #dfbfa7; border-radius:12px; }
.bills-date-filter button:focus-visible { outline:2px solid #91664e; outline-offset:2px; }
.bills-filter-result { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:9px; padding:11px 12px; border-radius:14px; background:#fff1e0; }
.bills-filter-result .bills-search-feedback { margin:0; color:#815b46; }
.bills-filter-result .bills-search-feedback span { color:#a18470; }
.bills-filter-result button { flex-shrink:0; min-height:44px; padding:6px 10px; border:1px solid #dfbfa7; border-radius:12px; background:#fffaf0; font-size:12px; }
.bills-filter-summary { margin-top:9px; padding:12px; border:1px dashed var(--zz-home-line); border-radius:14px; background:var(--zz-home-paper); }
.bills-filter-summary-heading { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 8px; color:var(--zz-home-ink-soft); font-size:11px; }
.bills-filter-summary-heading span { font-size:10px; }
.bills-filter-totals { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:9px; }
.bills-filter-totals > div { min-width:0; }.bills-filter-totals dt { font-size:11px; color:var(--zz-home-ink-soft); }.bills-filter-totals dd { margin-top:3px; font-size:16px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.bills-filter-totals-wide { grid-template-columns:1fr; }.bills-filter-totals-wide > div { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }.bills-filter-totals-wide dd { margin:0; }
.bills-type-tabs button:focus-visible, .bills-category-chip:focus-visible, .bills-filter-result button:focus-visible { outline:2px solid #91664e; outline-offset:2px; }
.bills-search-card { position: relative; margin-top: 21px; padding: 13px 13px 11px; background: #ede6f0; border: 1px solid #c8b8d0; border-radius: 9px 16px 10px 15px; }
.bills-search-card::before { content: ''; position:absolute; width:44px; height:14px; background:#f3e3bc; opacity:.8; top:-7px; left:17px; transform:rotate(-5deg); }
.bills-search-row { display: flex; align-items: center; gap: 9px; margin-top: 4px; min-height:44px; color:#8a7591; }.bills-search-row input { min-width:0; width:100%; font-size:14px; background:transparent; color:#624f6b; outline:none; }.bills-search-row input:focus-visible { outline: none; }
.bills-search-card:focus-within { border-color: #94749f; box-shadow: 0 0 0 3px #e5d9ec80; }
.bills-search-row button:focus-visible { outline: 2px solid #92749f; outline-offset: 2px; border-radius: 8px; }.bills-search-row input::placeholder { color:#755d7d; opacity:1; }
@media (prefers-reduced-motion: no-preference) {
  .bills-search-card { transition: border-color 160ms ease, box-shadow 160ms ease; }
  .bills-record { transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease; }
}
.bills-record:active { border-color: #c5a58f; box-shadow: 1px 2px 0 #e9ddcc; }
.bills-search-row button { min-height:44px; min-width:44px; font-size:12px; flex-shrink:0; }.bills-search-feedback { margin-top:5px; font-size:11px; line-height:1.8; color:#7b6984; }

.bills-manual-link { margin-bottom: 18px; }
.bills-record-actions { display: flex; flex-direction: row; align-items: flex-end; gap: 5px; flex-shrink: 0; min-width: 75px; max-width: 43%; }
.bills-record-chevron { flex-shrink: 0; color: #b6a18d; }
.bills-edit-hint { margin: 7px 0 0; text-align: center; font-size: 12px; color: var(--zz-home-ink-soft); }
.bills-record[role="button"] { cursor: pointer; }
.bills-record:hover { background: #fff8ed; }
.bills-record:focus-visible { outline: 2px solid var(--zz-home-ink); outline-offset: 3px; }
.bills-alert { color: #aa594d; font-size: 12px; margin-bottom: 12px; }
.bills-alert button { min-height: 44px; margin-top: 8px; padding: 8px 12px; border: 1px solid #d9c5a9; border-radius: 12px; background: #fff7e8; color: #624f6b; }.bills-alert button:disabled { opacity: .55; }.bills-alert button:focus-visible { outline: 2px solid #91664e; outline-offset: 3px; }
.bills-notice { font-size: 12px; margin-bottom: 12px; padding: 10px 12px; border: 1px solid #d7d9ba; border-radius: 12px; background: #f2f4e5; line-height: 1.8; }
.bills-record.bills-record-highlighted { border-color: #ce9e8c; background: #fff4e5; }
.bills-added-tag { display: inline-block; margin-left: 4px; padding: 2px 5px; border-radius: 6px; background: #f8dfd5; color: #a16556; font-size: 11px; vertical-align: middle; }
.journal-bills { min-height: 100dvh; padding: 18px 16px calc(var(--zz-home-bottom-nav-height) + 26px + env(safe-area-inset-bottom, 0px)); background: var(--zz-home-bg); color: var(--zz-home-ink); font-family: var(--zz-home-font); font-weight: 400; }
.bills-content { max-width: var(--zz-home-content-width); margin-inline: auto; }
.bills-header { display: flex; align-items: center; gap: 9px; margin-bottom: 26px; }
.bills-back { display: grid; place-items: center; flex: 0 0 44px; height: 44px; border: 1px solid var(--zz-home-line); border-radius: 16px 13px 17px 14px; background: var(--zz-home-paper); }
.bills-header-cat { width: 72px; height: 78px; object-fit: contain; flex-shrink: 0; transform: rotate(-3deg); }
.bills-heading-text { min-width: 0; }
.bills-title { position: relative; isolation: isolate; width: fit-content; font-size: 24px; font-weight: 400; letter-spacing: 1px; white-space: nowrap; }
.bills-title::before { content: ''; position: absolute; inset: 9px -5px 1px; z-index: -1; border-radius: 62% 45% 58% 42%; background: var(--zz-home-title-brush); transform: rotate(-2deg); }
.bills-subtitle { margin-top: 5px; font-size: 12px; color: var(--zz-home-ink-soft); overflow-wrap: anywhere; }
.bills-summary { position: relative; padding: 22px 14px 16px; border: 1.5px solid var(--zz-home-line); border-radius: 16px 19px 20px 15px; background: var(--zz-home-paper); box-shadow: 3px 4px 0 var(--zz-home-title-brush); }
.bills-summary::before { content: ''; position: absolute; top: -9px; left: calc(50% - 38px); width: 76px; height: 20px; border: 1px dashed var(--zz-home-line); border-radius: 2px 4px 3px 2px; background: var(--zz-home-pink-soft); transform: rotate(-4deg); pointer-events: none; }
.bills-month { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 14px; }
.bills-month-button { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: 14px 11px 15px 12px; }
.bills-month-button:hover { background: var(--zz-home-title-brush); }
.bills-month h2 { padding: 5px 12px; background: var(--zz-home-title-brush); border-radius: 14px 11px 15px 12px; font-size: 18px; font-weight: 400; }
.bills-month-shortcuts { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; margin-bottom: 14px; }
.bills-month-button.bills-current-month { width: auto; min-height: 44px; padding: 5px 12px; border: 1px dashed var(--zz-home-line); font-size: 12px; }
.bills-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.bills-totals > div { min-width: 0; padding: 11px 8px; border-radius: 14px 11px 15px 12px; text-align: center; }
.bills-totals dt { color: var(--zz-home-ink-soft); font-size: 12px; }
.bills-totals dd { margin-top: 4px; font-size: 15px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.bills-totals-wide { grid-template-columns: 1fr; }
.bills-totals-wide > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: right; }
.bills-totals-wide dd { margin-top: 0; white-space: nowrap; }
.bills-total-income { background: var(--zz-home-income-panel); }
.bills-total-expense { background: var(--zz-home-expense-panel); }
.bills-total-balance { background: var(--zz-home-title-brush); }
.bills-income { color: var(--zz-home-green); }
.bills-expense { color: var(--zz-home-pink); }
.bills-storage-note { margin: 17px 0 0; color: var(--zz-home-ink-soft); font-size: 12px; text-align: center; }
.bills-groups { display: grid; gap: 22px; margin-top: 22px; }
.bills-window-note { margin: 5px 0 10px; font-size: 11px; line-height: 1.8; color: #815b46; }
.bills-load-more { text-align: center; padding: 8px 0 14px; }
.bills-load-more button { min-height: 44px; padding: 9px 22px; border: 1px solid #b79076; border-radius: 12px; background: #f5e7ca; color: #785640; box-shadow: 0 3px 0 #d7bea0; font-size: 13px; }
.bills-load-more button:focus-visible { outline: 2px solid var(--zz-home-ink); outline-offset: 3px; }
.bills-load-more button:disabled { opacity: .6; }
.bills-day-heading { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; margin: 0 2px 10px; }
.bills-day-heading h3 { font-weight: 400; font-size: 16px; }
.bills-day-totals { display: flex; flex-wrap: wrap; gap: 5px 10px; font-size: 12px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.bills-record { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px; border: 1.5px solid var(--zz-home-line); border-radius: 16px 19px 20px 15px; background: var(--zz-home-paper); box-shadow: 3px 4px 0 var(--zz-home-title-brush); }
.bills-record-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.bills-record-stamp { display: grid; place-items: center; flex: 0 0 36px; height: 38px; border: 1px dashed var(--zz-home-line); border-radius: 11px 9px 12px 10px; background: var(--zz-home-title-brush); }
.bills-record-text { min-width: 0; font-size: 15px; overflow-wrap: anywhere; }
.bills-record-text .bills-subtitle { white-space: pre-wrap; }
.bills-record-amount { flex-shrink: 0; max-width: none; width: auto; text-align: right; font-size: 16px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.bills-empty { margin-top: 27px; padding: 27px 16px; border: 1px dashed var(--zz-home-line); border-radius: 16px 19px 20px 15px; background: var(--zz-home-paper); text-align: center; font-size: 15px; }
.bills-empty img { display: block; width: 112px; height: 112px; object-fit: contain; margin: 0 auto 13px; }
.bills-back:focus-visible, .bills-month-button:focus-visible { outline: 2px solid var(--zz-home-ink); outline-offset: 3px; }
.bills-month-button:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 359px) {
  .journal-bills { padding-inline: 12px; }
  .bills-header { gap: 7px; }
  .bills-header-cat { width: 58px; height: 65px; }
  .bills-title { font-size: 23px; }
}
</style>
