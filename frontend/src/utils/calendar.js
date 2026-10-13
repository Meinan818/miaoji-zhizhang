import { computed, onScopeDispose, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { validDate } from './ledger.js'
import { isValidMonth } from './statistics.js'

export function shiftCalendarMonth(month, offset) {
  if (!isValidMonth(month) || !Number.isSafeInteger(offset)) return null
  const next = dayjs(`${month}-01`).add(offset, 'month').format('YYYY-MM')
  return isValidMonth(next) ? next : null
}

export function getCalendarCells(month, selectedDate, today, records = []) {
  if (!isValidMonth(month)) return []
  const first = dayjs(`${month}-01`), start = first.subtract(first.day(), 'day')
  const dates = new Set((Array.isArray(records) ? records : []).filter(record => record && !record.deletedAt).map(record => record.date))
  return Array.from({ length: 42 }, (_, index) => {
    const date = start.add(index, 'day'), value = date.format('YYYY-MM-DD')
    const isDisabled = !validDate(value)
    return { date: value, day: date.date(), weekday: date.day(), isCurrentMonth: value.slice(0, 7) === month,
      isToday: !isDisabled && value === today, isSelected: !isDisabled && value === selectedDate,
      hasRecord: !isDisabled && dates.has(value), isDisabled }
  })
}

export function useLocalDay({ now = () => dayjs().format('YYYY-MM-DD'), eventTarget = globalThis.window,
  documentTarget = globalThis.document, timers = globalThis } = {}) {
  const initial = now()
  if (!validDate(initial)) throw new Error('本机日期无法读取。')
  const today = ref(initial)
  let active = true
  function refreshToday() {
    if (!active) return
    const next = now()
    if (validDate(next)) today.value = next
  }
  const visible = () => { if (documentTarget?.visibilityState !== 'hidden') refreshToday() }
  let interval = null
  if (eventTarget?.addEventListener) {
    eventTarget.addEventListener('focus', refreshToday)
    documentTarget?.addEventListener('visibilitychange', visible)
    interval = timers.setInterval(refreshToday, 60000)
  }
  onScopeDispose(() => {
    active = false
    if (interval !== null) timers.clearInterval(interval)
    eventTarget?.removeEventListener('focus', refreshToday)
    documentTarget?.removeEventListener('visibilitychange', visible)
  })
  return { today, refreshToday }
}

export function useHomeCalendar(options = {}) {
  const { today, refreshToday } = useLocalDay(options)
  const todayMonth = computed(() => today.value.slice(0, 7))
  const initialOwner = options.owner?.()
  const history = options.rememberHistory ? (options.history ?? globalThis.window?.history) : null
  const location = options.location ?? (options.rememberHistory ? globalThis.window?.location : null)
  const saved = (!location || location.pathname === '/') ? history?.state?.miaojiHomeCalendarV1 : null
  const restored = saved && saved.owner === (initialOwner ?? null) && typeof saved.followToday === 'boolean'
    && validDate(saved.date) && isValidMonth(saved.month) && saved.date.startsWith(saved.month) && !saved.followToday
  const calendarMonth = ref(restored ? saved.month : todayMonth.value), selectedDate = ref(restored ? saved.date : today.value)
  const weekdayLabel = computed(() => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayjs(today.value).day()])
  let active = true
  onScopeDispose(() => { active = false })
  const ownerCurrent = ref(!options.owner || Boolean(initialOwner))
  if (options.owner) watch(options.owner, value => {
    if (value !== initialOwner) ownerCurrent.value = false
  }, { flush: 'sync' })
  const isCurrent = () => active && ownerCurrent.value
  watch(today, (next, previous) => {
    if (isCurrent() && selectedDate.value === previous && calendarMonth.value === previous.slice(0, 7)) {
      selectedDate.value = next; calendarMonth.value = next.slice(0, 7)
    }
  }, { flush: 'sync' })
  // Preserve Vue Router's navigation/scroll fields in this history entry.
  // View state is account-bound and is never copied to ledger storage.
  watch([calendarMonth, selectedDate, today], () => {
    if (!history?.replaceState || !isCurrent() || (location && location.pathname !== '/')
      || !validDate(selectedDate.value) || !isValidMonth(calendarMonth.value) || !selectedDate.value.startsWith(calendarMonth.value)) return
    try {
      history.replaceState({ ...history.state, miaojiHomeCalendarV1: { owner: initialOwner ?? null,
        month: calendarMonth.value, date: selectedDate.value,
        followToday: selectedDate.value === today.value && calendarMonth.value === todayMonth.value } }, '')
    } catch { /* History unavailable: keep normal calendar selection working. */ }
  }, { immediate: true, flush: 'sync' })
  function returnToday() {
    if (!isCurrent()) return
    refreshToday(); calendarMonth.value = todayMonth.value; selectedDate.value = today.value
  }
  function handleMonthChange(month) {
    if (!isCurrent() || !isValidMonth(month)) return
    refreshToday(); calendarMonth.value = month
    selectedDate.value = month === todayMonth.value ? today.value : `${month}-01`
  }
  function handleDateChange(date) {
    if (!isCurrent() || !validDate(date)) return
    calendarMonth.value = date.slice(0, 7); selectedDate.value = date
  }
  return { today, todayMonth, calendarMonth, selectedDate, weekdayLabel, refreshToday, returnToday, handleMonthChange, handleDateChange, ownerCurrent }
}
