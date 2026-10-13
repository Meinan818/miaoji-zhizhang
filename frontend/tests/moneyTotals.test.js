import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CENTS, sumAmounts, centsText, getRecordTotals } from '../src/utils/money.js'
import { effectScope, ref } from 'vue'
import { createRemoteLedger } from '../src/api/remoteLedger.js'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import dayjs from 'dayjs'
import { getCalendarCells, shiftCalendarMonth } from '../src/utils/calendar.js'
import { validDate } from '../src/utils/ledger.js'
import { legacyCents } from '../src/utils/money.js'

test('累计超过安全整数分时明确拒绝，不能把奇数分舍入为偶数分', () => {
  const records = Array.from({ length: 90073 }, () => ({ type: 'expense', amount: MAX_CENTS / 100 }))
  const expected = BigInt(MAX_CENTS) * BigInt(records.length)
  assert.equal(expected.toString(), '9007299999909927')
  assert.throws(() => sumAmounts(records, 'expense'), /安全范围/)
})

test('超限汇总给出明确错误和空金额，不改原账单或冒充零元', () => {
  const records = Array.from({ length: 90073 }, () => ({ type: 'expense', amount: MAX_CENTS / 100 }))
  const totals = getRecordTotals(records)
  assert.match(totals.error, /安全范围/)
  for (const key of ['incomeCents', 'expenseCents', 'balanceCents', 'income', 'expense']) assert.equal(totals[key], null)
  assert.equal(records.length, 90073)
  assert.equal(records[0].amount, MAX_CENTS / 100)
})

test('合法大额汇总用整数分显示，结余不把元小数转回分', () => {
  const records = Array.from({ length: 90071 }, () => ({ type: 'expense', amount: MAX_CENTS / 100 }))
  records.push({ type: 'income', amount: 0.31 })
  const totals = getRecordTotals(records)
  assert.equal(totals.error, '')
  assert.equal(BigInt(totals.expenseCents), BigInt(MAX_CENTS) * 90071n)
  assert.equal(centsText(totals.expenseCents), '90070999999099.29')
  assert.equal(centsText(totals.balanceCents), '-90070999999098.98')
})

test('损坏金额和收支不能变成零，空列表确实返回零元', () => {
  for (const amount of ['NaN', -1, 0, Infinity]) assert.match(getRecordTotals([{ type: 'expense', amount }]).error, /金额/)
  assert.match(getRecordTotals([{ type: 'other', amount: 1 }]).error, /收支/)
  assert.match(getRecordTotals(null).error, /列表/)
  assert.deepEqual(getRecordTotals([]), { incomeCents: 0, expenseCents: 0, balanceCents: 0, income: 0, expense: 0, error: '' })
})

// Render the actual calendar template offline; this is not browser/GUI QA.
async function renderCalendar(totals) {
  const { descriptor } = parse(readFileSync(new URL('../src/components/calendar/CalendarCard.vue', import.meta.url), 'utf8'))
  const script = descriptor.scriptSetup.content.replace(/^import .*$/gm, '')
  const stub = { render: () => Vue.h('svg') }
  const component = { props: ['month', 'selectedDate', 'today', 'records', 'income', 'expense', 'incomeCents', 'expenseCents', 'summaryError'],
    components: { ChevronLeft: stub, ChevronRight: stub, MonthPicker: stub }, setup(props) {
      const bindings = { computed: Vue.computed, nextTick: Vue.nextTick, onScopeDispose: Vue.onScopeDispose, dayjs, getCalendarCells, shiftCalendarMonth, validDate, centsText, legacyCents,
        defineProps: () => props, defineEmits: () => () => {} }
      return new Function(...Object.keys(bindings), script + '; return { shiftCalendarMonth, incomeText, expenseText, wideAmounts, weekdays, monthTitle, calendarCells, changeMonth, selectMonth, selectDate, setDayElement, handleDayKey, getDayClass, getDayNumberClass }')(...Object.values(bindings))
    }, render: new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)(Vue) }
  component.render._rc = true
  return renderToString(Vue.createSSRApp(component, { month: '2026-10', selectedDate: '2026-10-04', today: '2026-10-04', records: [], income: 0, expense: 0,
    incomeCents: totals.incomeCents, expenseCents: totals.expenseCents, summaryError: totals.error }))
}

test('实际日历模板超限提示保留日期按钮，不误显示零元收支', async () => {
  const html = await renderCalendar({ incomeCents: null, expenseCents: null, error: '金额汇总超出安全范围，原账单已保留。' })
  assert.match(html, /role="alert"/)
  assert.match(html, /金额汇总超出安全范围/)
  assert.match(html, /aria-label="上个月"/)
  assert.match(html, /calendar-day/)
  assert(!html.includes('¥0.00'))
  assert(!html.includes('本月支出'))
})

test('实际日历模板合法大额末尾的分保持准确', async () => {
  const html = await renderCalendar({ incomeCents: 31, expenseCents: 9007099999909929, error: '' })
  assert.match(html, /¥90070999999099\.29/)
  assert.match(html, /¥0\.31/)
  assert(!html.includes('role="alert"'))
})

test('正式Store累计超限保留明细，分类与聊天汇总不抛异常或变成零', () => {
  const scope = effectScope()
  const store = scope.run(() => createRemoteLedger({ request() { assert.fail('不可请求网络') } }, ref('1'), {
    storage: { getItem: () => null }, eventTarget: null, dateClock: { now: () => '2026-10-04', eventTarget: null },
  }))
  try {
    store.allRecords.value = Array.from({ length: 90073 }, (_, id) => ({ id: String(id), type: 'expense', amount: MAX_CENTS / 100, category: '餐饮', date: '2026-10-04' }))
    assert.match(store.summaryError.value, /安全范围/)
    assert.equal(store.monthExpense.value, null)
    assert.equal(store.monthExpenseCents.value, null)
    assert.deepEqual(store.categoryExpenses.value, {})
    assert.equal(store.records.value.length, 90073)
    assert.equal(store.storageError.value, '正在读取正式账本…')
  } finally { scope.stop() }
})

test('月累计允许超过单笔上限，收支分别汇总且不改账单', () => {
  const records = [{ type: 'expense', amount: MAX_CENTS / 100 }, { type: 'expense', amount: MAX_CENTS / 100 }, { type: 'income', amount: 0.31 }]
  const before = structuredClone(records)
  assert.equal(sumAmounts(records, 'expense'), 1999999999.98)
  assert.equal(sumAmounts(records, 'income'), 0.31)
  assert.deepEqual(records, before)
})
