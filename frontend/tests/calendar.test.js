import test from 'node:test'
import assert from 'node:assert/strict'
import { computed, effectScope, reactive } from 'vue'
import dayjs from 'dayjs'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { renderToString } from '@vue/server-renderer'
import { createBillFilterPath, useLedgerReload } from '../src/utils/navigation.js'
import { centsText, getRecordTotals } from '../src/utils/money.js'
import { formatCurrency } from '../src/utils/format.js'
import * as calendarUtils from '../src/utils/calendar.js'
import { validDate } from '../src/utils/ledger.js'
const { useHomeCalendar } = calendarUtils

function scene(date = '2026-10-31', { owner } = {}) {
  const events = new Map(), scope = effectScope()
  let current = date, tick, cleared = false
  const window = { addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) }
  const document = { ...window, visibilityState: 'visible' }
  const calendar = scope.run(() => useHomeCalendar({ owner, now: () => current, eventTarget: window, documentTarget: document,
    timers: { setInterval: (fn, ms) => { assert.equal(ms, 60000); tick = fn; return 1 }, clearInterval: id => { assert.equal(id, 1); cleared = true } } }))
  return { calendar, events, document, setDate: date => { current = date }, tick: () => tick(),
    dispose: () => scope.stop(), cleared: () => cleared }
}

test('日历浏览记录恢复同账号历史日期，保路由字段；默认跟随今日跨月重开不留旧今日', () => {
  const routerState = { back: null, current: '/', forward: '/bills', position: 4, scroll: { top: 50, left: 0 } }
  const history = { state: structuredClone(routerState), replaceState(state) { this.state = state } }
  let now = '2026-10-31'
  const open = () => { const scope = effectScope(); const calendar = scope.run(() => useHomeCalendar({ rememberHistory: true, history,
    owner: () => 'account-1', now: () => now, eventTarget: null, documentTarget: null })); return { calendar, dispose: () => scope.stop() } }
  const original = open(); original.calendar.handleDateChange('2026-09-04'); original.dispose()
  const returned = open()
  assert.equal(returned.calendar.calendarMonth.value, '2026-09'); assert.equal(returned.calendar.selectedDate.value, '2026-09-04')
  for (const [key, value] of Object.entries(routerState)) assert.deepEqual(history.state[key], value)
  returned.calendar.returnToday(); returned.dispose(); now = '2026-11-01'
  const nextDay = open()
  try { assert.equal(nextDay.calendar.selectedDate.value, '2026-11-01'); assert.equal(nextDay.calendar.calendarMonth.value, '2026-11') }
  finally { nextDay.dispose() }
})

test('日历历史状态拒绝异账号/坏日期，旧身份/离页不写他页，历史不可写仍可选日', () => {
  for (const saved of [{ owner: 'account-2', month: '2026-09', date: '2026-09-04', followToday: false },
    { owner: 'account-1', month: '2026-09', date: '2026-09-31', followToday: false }]) {
    const auth = reactive({ id: 'account-1' }), location = { pathname: '/' }, writes = [], scope = effectScope()
    const history = { state: { miaojiHomeCalendarV1: saved }, replaceState(state) { writes.push(state); this.state = state } }
    const calendar = scope.run(() => useHomeCalendar({ rememberHistory: true, history, location, owner: () => auth.id,
      now: () => '2026-10-06', eventTarget: null, documentTarget: null }))
    try {
      assert.equal(calendar.selectedDate.value, '2026-10-06'); const count = writes.length
      location.pathname = '/bills'; calendar.handleDateChange('2026-09-04'); assert.equal(writes.length, count)
      location.pathname = '/'; auth.id = 'account-2'; auth.id = 'account-1'; calendar.handleDateChange('2026-08-04'); assert.equal(writes.length, count)
    } finally { scope.stop() }
    calendar.selectedDate.value = '2026-07-04'; assert.equal(writes.length, 1)
  }
  const scope = effectScope(), calendar = scope.run(() => useHomeCalendar({ rememberHistory: true,
    history: { state: null, replaceState() { throw Error('synthetic history unavailable') } },
    now: () => '2026-10-06', eventTarget: null, documentTarget: null }))
  try { calendar.handleDateChange('2026-09-04'); assert.equal(calendar.selectedDate.value, '2026-09-04') }
  finally { scope.stop() }
})

test('首页跨日与跨月更新今日汇总、星期及默认选择', () => {
  const state = scene()
  try {
    assert.equal(state.calendar.weekdayLabel.value, '周六')
    state.setDate('2026-11-01'); state.tick()
    assert.equal(state.calendar.today.value, '2026-11-01')
    assert.equal(state.calendar.todayMonth.value, '2026-11')
    assert.equal(state.calendar.calendarMonth.value, '2026-11')
    assert.equal(state.calendar.selectedDate.value, '2026-11-01')
    assert.equal(state.calendar.weekdayLabel.value, '周日')
  } finally { state.dispose() }
})

test('首页日历身份首次变化及切回后，旧选日/切月/回今天不修改选择', () => {
  const auth = reactive({ user: { id: 'synthetic' } }), state = scene('2026-10-31', { owner: () => auth.user?.id })
  try {
    state.calendar.handleDateChange('2026-09-12')
    auth.user = null; auth.user = { id: 'synthetic' }
    state.calendar.handleDateChange('2026-11-02'); state.calendar.handleMonthChange('2026-12'); state.calendar.returnToday()
    assert.equal(state.calendar.selectedDate.value, '2026-09-12'); assert.equal(state.calendar.calendarMonth.value, '2026-09')
  } finally { state.dispose() }
})
test('首页身份变化后跨月时钟不重置旧日历选择，释放监听保持', () => {
  const auth = reactive({ user: { id: 'synthetic' } }), state = scene('2026-10-31', { owner: () => auth.user?.id })
  try {
    auth.user = null; auth.user = { id: 'synthetic' }
    state.setDate('2026-11-01'); state.tick()
    assert.equal(state.calendar.selectedDate.value, '2026-10-31'); assert.equal(state.calendar.calendarMonth.value, '2026-10')
  } finally { state.dispose() }
  assert.equal(state.events.size, 0); assert.equal(state.cleared(), true)
})

test('实际Home模板当天明细保选定日期月份，空日/读取失败/身份变化隐藏且不清账本', async () => {
  const scope = Vue.effectScope(), auth = reactive({ user: { id: 'synthetic' } })
  const records = [{ id: 'synthetic-record', type: 'expense', amount: 19.29, date: '2026-10-04', category: '餐饮', remark: '私有合成备注' },
    { id: 'synthetic-history', type: 'income', amount: 7, date: '2026-09-04', category: '其他', remark: '合成历史收入' }]
  const store = reactive({ records: structuredClone(records), storageError: '', refresh: () => assert.fail('禁止后台读取') })
  const content = readFileSync(new URL('../src/views/Home.vue', import.meta.url), 'utf8')
  const script = content.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const bindings = { ...Vue, dayjs, centsText, getRecordTotals, formatCurrency, createBillFilterPath, useLedgerReload, SERVER_MODE: true,
    useRecordStore: () => store, useAuthStore: () => auth, useHomeCalendar: options => useHomeCalendar({ ...options, now: () => '2026-10-04', eventTarget: null, documentTarget: null }) }
  const view = scope.run(() => new Function(...Object.keys(bindings), script +
    ';return {recordStore,today,calendarMonth,selectedDate,selectedDayEntryTarget,weekdayLabel,returnToday,handleMonthChange,handleDateChange,todayRecords,todayTotals,monthTotals,selectedRecords,selectedTotals,needsWideDayAmounts,displayedDayRecords,hiddenDayCount,visibleDayLimit,expandingDay,setDayRecordElement,loadMoreDayRecords,selectedDateLabel,getRecordSign,reloading,reloadError,reloadRecords,ownerCurrent: typeof ownerCurrent === "undefined" ? undefined : ownerCurrent}')(...Object.values(bindings)))
  const template = content.slice(content.indexOf('<template>') + 10, content.lastIndexOf('</template>'))
  const stub = { render: () => Vue.h('span') }
  const component = { components: Object.fromEntries(['JournalSticker', 'CatNavIcon', 'ManualEntry', 'CategoryIcon', 'BottomNav', 'CalendarCard'].map(name => [name, stub])),
    setup: () => ({ ...view, dayjs, centsText, formatCurrency, SERVER_MODE: true, miaoAvatar: 'synthetic', miaoConfused: 'synthetic' }),
    render: new Function('Vue', compile(template, { mode: 'function' }).code)(Vue) }
  const targets = []
  component.components.RouterLink = { props: ['to'], render() { targets.push(this.to); return Vue.h('a', this.$slots.default?.()) } }; component.render._rc = true
  const render = () => renderToString(Vue.createSSRApp(component))
  try {
    assert.match(await render(), /私有合成备注/)
    const summary = html => html.match(/<section[^>]*aria-label="当天账单汇总"[^>]*>(.*?)<\/section>/s)?.[1] || ''
    assert.match(summary(await render()), /当天收入.*¥0.00.*当天支出.*¥19.29/s)
    assert.deepEqual(targets.find(target => target?.path === '/bills'), { path: '/bills', query: { month: '2026-10', date: '2026-10-04' } })
    assert.deepEqual(targets.find(target => target?.path === '/add'), { path: '/add', query: { date: '2026-10-04', returnTo: '/bills?month=2026-10&date=2026-10-04' } })
    view.handleDateChange('2026-09-04'); targets.length = 0
    assert.match(await render(), /合成历史收入/)
    assert.match(summary(await render()), /当天收入.*¥7.00.*当天支出.*¥0.00/s)
    assert.deepEqual(targets.find(target => target?.path === '/bills'), { path: '/bills', query: { month: '2026-09', date: '2026-09-04' } })
    assert.equal(targets.find(target => target?.path === '/add').query.date, '2026-09-04')
    view.handleDateChange('2026-09-03'); targets.length = 0
    assert.match(await render(), /点下方「聊着记」/); assert.equal(targets.some(target => target?.path === '/bills'), false)
    assert.deepEqual(targets.find(target => target?.path === '/add'), { path: '/add', query: { date: '2026-09-03', returnTo: '/bills?month=2026-09&date=2026-09-03' } })
    assert.match(summary(await render()), /当天收入.*¥0.00.*当天支出.*¥0.00/s)
    view.handleDateChange('9999-12-01'); targets.length = 0
    assert.doesNotMatch(await render(), /补记这一天/)
    assert.equal(targets.some(target => target?.path === '/add'), false)
    view.handleDateChange('2026-10-04')
    store.records = [0, 1].map(i => ({ ...records[0], id: 'synthetic-large-' + i, amount: '999999999.99' }))
    assert.match(summary(await render()), /home-day-totals-wide.*¥1999999999.98/s)
    store.records[0].amount = 'not-a-number'
    const invalid = summary(await render()); assert.match(invalid, /role="alert"/); assert.doesNotMatch(invalid, /<dd/)
    store.records = Array.from({ length: 121 }, (_, i) => ({ ...records[0], id: 'synthetic-long-' + i, amount: '0.29' }))
    assert.equal((await render()).match(/class="home-record"/g).length, 60)
    assert.match(summary(await render()), /¥35.09/); assert.equal(view.hiddenDayCount.value, 61)
    const focus = [], scroll = []
    view.setDayRecordElement('synthetic-long-60', { focus: options => focus.push(options), scrollIntoView: options => scroll.push(options) })
    const expanding = view.loadMoreDayRecords(); assert.equal(await view.loadMoreDayRecords(), false); assert.equal(await expanding, true)
    assert.equal(view.displayedDayRecords.value.length, 120); assert.equal(view.hiddenDayCount.value, 1)
    assert.deepEqual(focus, [{ preventScroll: true }]); assert.deepEqual(scroll, [{ block: 'nearest', behavior: 'auto' }])
    assert.equal(await view.loadMoreDayRecords(), true); assert.equal(view.displayedDayRecords.value.length, 121)
    assert.doesNotMatch(await render(), /home-load-more/)
    view.handleDateChange('2026-09-04'); view.handleDateChange('2026-10-04')
    assert.equal(view.visibleDayLimit.value, 60)
    const oldExpansion = view.loadMoreDayRecords(); view.handleDateChange('2026-09-04'); view.handleDateChange('2026-10-04')
    assert.equal(await oldExpansion, false); assert.equal(view.visibleDayLimit.value, 60); assert.equal(focus.length, 1)
    store.records = structuredClone(records)
    view.handleDateChange('2026-10-04'); store.storageError = '合成读取失败'; targets.length = 0
    assert.doesNotMatch(await render(), /查看当天明细|私有合成备注/); assert.equal(targets.some(target => target?.path === '/bills'), false)
    assert.equal(targets.some(target => target?.path === '/add'), false)
    assert.equal(summary(await render()), '')
    store.storageError = ''
    auth.user = null; const expired = await render(); auth.user = { id: 'synthetic' }; const returned = await render()
    for (const html of [expired, returned]) {
      assert.doesNotMatch(html, /19.29|私有合成备注|回到今天|查看当天明细|补记这一天|当天账单汇总/)
      assert.match(html, /登录身份已变化/)
    }
    assert.deepEqual(store.records, records)
  } finally { scope.stop() }
})

test('跨日不抢用户正在看的历史月份，回到今天先核最新日期', () => {
  const state = scene()
  try {
    state.calendar.handleMonthChange('2026-09')
    state.calendar.selectedDate.value = '2026-09-12'
    state.setDate('2026-11-01'); state.events.get('focus')()
    assert.equal(state.calendar.calendarMonth.value, '2026-09')
    assert.equal(state.calendar.selectedDate.value, '2026-09-12')
    state.setDate('2026-11-02'); state.calendar.returnToday()
    assert.equal(state.calendar.selectedDate.value, '2026-11-02')
    assert.equal(state.calendar.calendarMonth.value, '2026-11')
  } finally { state.dispose() }
})

test('后台恢复核日期，非法时钟保留旧日，离页释放全部监听与定时器', () => {
  const state = scene('2026-12-31')
  state.document.visibilityState = 'hidden'; state.setDate('2027-01-01')
  state.events.get('visibilitychange')()
  assert.equal(state.calendar.today.value, '2026-12-31')
  state.document.visibilityState = 'visible'; state.events.get('visibilitychange')()
  assert.equal(state.calendar.today.value, '2027-01-01')
  state.setDate('2027-02-30'); state.tick()
  assert.equal(state.calendar.today.value, '2027-01-01')
  state.calendar.handleMonthChange('0001-01')
  assert.equal(state.calendar.calendarMonth.value, '2027-01')
  state.dispose()
  assert.equal(state.events.size, 0); assert.equal(state.cleared(), true)
  state.setDate('2027-01-02'); state.tick(); state.calendar.returnToday()
  assert.equal(state.calendar.today.value, '2027-01-01')
})

test('选相邻月份具体日期不能被切月重置到第一天，非法日期保持原选择', () => {
  const state = scene()
  try {
    state.calendar.handleMonthChange('2026-11')
    state.calendar.handleDateChange('2026-11-02')
    assert.equal(state.calendar.selectedDate.value, '2026-11-02')
    assert.equal(state.calendar.calendarMonth.value, '2026-11')
    state.calendar.handleDateChange('2026-02-30')
    assert.equal(state.calendar.selectedDate.value, '2026-11-02')
  } finally { state.dispose() }
})

function component(props, emit) {
  const file = readFileSync(new URL('../src/components/calendar/CalendarCard.vue', import.meta.url), 'utf8')
  const script = file.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const names = ['computed', 'nextTick', 'onScopeDispose', 'dayjs', 'defineProps', 'defineEmits', 'validDate', ...Object.keys(calendarUtils)]
  const scope = effectScope()
  const values = scope.run(() => new Function(...names, script + '; return { selectDate, selectMonth, changeMonth, calendarCells, setDayElement, handleDayKey }')(
    computed, Vue.nextTick, Vue.onScopeDispose, dayjs, () => props, () => emit, validDate, ...Object.values(calendarUtils)))
  return { ...values, dispose: () => scope.stop() }
}

test('日历方向键移动闰日及跨月，拒绝越界/修饰键，选日改变及释放后的旧焦点不复活', async () => {
  const props = reactive({ month: '2024-02', selectedDate: '2024-02-28', records: [] }), events = [], focus = []
  const card = component(props, (name, value) => { events.push([name, value]); if (name === 'update:month') props.month = value; else props.selectedDate = value })
  const key = (name, date = props.selectedDate, modifiers = {}) => card.handleDayKey({ key: name, preventDefault() {}, ...modifiers }, { date, isCurrentMonth: date.slice(0, 7) === props.month })
  try {
    card.setDayElement('2024-02-29', { focus: () => focus.push('leap'), scrollIntoView() {} })
    assert.equal(await key('ArrowRight'), true); assert.equal(props.selectedDate, '2024-02-29'); assert.deepEqual(focus, ['leap'])
    assert.equal(await key('ArrowRight'), true); assert.equal(props.selectedDate, '2024-03-01'); assert.equal(props.month, '2024-03')
    await key('ArrowLeft'); await key('ArrowUp'); assert.equal(props.selectedDate, '2024-02-22'); await key('ArrowDown'); assert.equal(props.selectedDate, '2024-02-29')
    const count = events.length
    for (const modifiers of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) assert.equal(await key('ArrowRight', props.selectedDate, modifiers), false)
    for (const [name, date] of [['ArrowLeft', '1000-01-01'], ['ArrowRight', '9999-12-31']]) assert.equal(await key(name, date), false)
    assert.equal(events.length, count)
    const previous = key('ArrowLeft'); card.selectDate({ date: '2024-02-29', isCurrentMonth: true }); assert.equal(await previous, false)
    const disposed = key('ArrowRight'); card.dispose(); assert.equal(await disposed, false)
  } finally { card.dispose() }
})

test('日历直接选月沿首页选日规则，合法两端与闰月可选，无效和同月不发事件', () => {
  const state = scene('2026-10-31'), events = [], props = reactive({ month: '2026-10', selectedDate: '2026-10-31', records: [] })
  const card = component(props, (name, value) => {
    events.push([name, value]); state.calendar.handleMonthChange(value)
    props.month = state.calendar.calendarMonth.value; props.selectedDate = state.calendar.selectedDate.value
  })
  try {
    for (const month of ['2024-02', '1000-01', '9999-12']) {
      card.selectMonth(month); assert.equal(state.calendar.calendarMonth.value, month); assert.equal(state.calendar.selectedDate.value, month + '-01')
    }
    card.selectMonth('2026-10'); assert.equal(state.calendar.selectedDate.value, '2026-10-31')
    const count = events.length
    for (const month of ['', '0999-12', '10000-01', '2026-13', ['2024-02'], null, '2026-10']) card.selectMonth(month)
    assert.equal(events.length, count)
  } finally { state.dispose() }
})

test('实际日历脚本选相邻月份后保留点击日期，边界切月不发出越界事件', () => {
  const state = scene(), events = []
  try {
    const card = component({ month: '2026-10', selectedDate: '2026-10-31', records: [] }, (name, value) => {
      events.push([name, value])
      if (name === 'update:month') state.calendar.handleMonthChange(value)
      else state.calendar.selectedDate.value = value
    })
    card.selectDate({ date: '2026-11-02', isCurrentMonth: false })
    assert.equal(state.calendar.selectedDate.value, '2026-11-02')
    for (const [month, offset] of [['1000-01', -1], ['9999-12', 1]]) {
      const boundary = component({ month, selectedDate: month + '-01', records: [] }, (...args) => events.push(args))
      const before = events.length; boundary.changeMonth(offset)
      assert.equal(events.length, before)
    }
  } finally { state.dispose() }
})

test('六周日历保留闰日，越界外月格禁用，记录点排除已删除账单', () => {
  const cells = calendarUtils.getCalendarCells('2028-02', '2028-02-29', '2028-02-29', [
    { date: '2028-02-29' }, { date: '2028-02-28', deletedAt: 'synthetic' },
  ])
  assert.equal(cells.length, 42)
  assert.equal(cells.filter(cell => cell.isCurrentMonth).length, 29)
  assert.equal(cells.find(cell => cell.date === '2028-02-29').isSelected, true)
  assert.equal(cells.find(cell => cell.date === '2028-02-29').hasRecord, true)
  assert.equal(cells.find(cell => cell.date === '2028-02-28').hasRecord, false)
  for (const month of ['1000-01', '9999-12']) {
    const boundary = calendarUtils.getCalendarCells(month, month + '-01', month + '-01')
    assert.equal(boundary.length, 42)
    assert.equal(boundary.filter(cell => cell.isDisabled && cell.isCurrentMonth).length, 0)
    assert.ok(boundary.some(cell => cell.isDisabled))
  }
  assert.deepEqual(calendarUtils.getCalendarCells('bad', '', ''), [])
})

test('查看历史日时今日标签随新today属性更新，非法选日不发事件', () => {
  const props = reactive({ month: '2026-10', selectedDate: '2026-10-01', today: '2026-10-04', records: [] })
  const events = [], card = component(props, (...args) => events.push(args))
  assert.equal(card.calendarCells.value.find(cell => cell.isToday).date, '2026-10-04')
  props.today = '2026-10-05'
  assert.equal(card.calendarCells.value.find(cell => cell.isToday).date, '2026-10-05')
  card.selectDate({ date: '2026-02-30', isCurrentMonth: false })
  assert.equal(events.length, 0)
})
