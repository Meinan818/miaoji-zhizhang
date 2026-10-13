<script setup>
// 1. 导入
import { computed, nextTick, onScopeDispose } from 'vue'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { getCalendarCells, shiftCalendarMonth } from '@/utils/calendar'
import { validDate } from '@/utils/ledger'
import { centsText, legacyCents } from '@/utils/money'
import MonthPicker from '@/components/common/MonthPicker.vue'

// 2. Props
const props = defineProps({
  month: { type: String, required: true },
  selectedDate: { type: String, required: true },
  today: { type: String, default: () => dayjs().format('YYYY-MM-DD') },
  records: { type: Array, default: () => [] },
  income: { type: Number, default: 0 },
  expense: { type: Number, default: 0 },
  incomeCents: { type: Number, default: null },
  expenseCents: { type: Number, default: null },
  summaryError: { type: String, default: '' },
})

const incomeText = computed(() => centsText(props.incomeCents ?? legacyCents(props.income)))
const expenseText = computed(() => centsText(props.expenseCents ?? legacyCents(props.expense)))
const wideAmounts = computed(() => Math.max(incomeText.value.length, expenseText.value.length) > 9)

// 3. Emits
const emit = defineEmits(['update:month', 'update:selected-date'])

// 4. 计算属性
const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const monthTitle = computed(() => shiftCalendarMonth(props.month, 0) ? dayjs(`${props.month}-01`).format('YYYY年M月') : '请选择有效月份')
const calendarCells = computed(() => getCalendarCells(props.month, props.selectedDate, props.today, props.records))
const dayElements = new Map()
let active = true, focusGeneration = 0
onScopeDispose(() => { active = false; focusGeneration++ })

// 5. 方法
function changeMonth(offset) {
  const next = shiftCalendarMonth(props.month, offset)
  if (next) { focusGeneration++; emit('update:month', next) }
}

function selectMonth(month) {
  if (typeof month === 'string' && month !== props.month && validDate(month + '-01')) { focusGeneration++; emit('update:month', month) }
}

function selectDate(cell) {
  if (!cell || !validDate(cell.date) || cell.isDisabled) return
  focusGeneration++
  if (!cell.isCurrentMonth) {
    emit('update:month', cell.date.slice(0, 7))
  }
  emit('update:selected-date', cell.date)
}

function setDayElement(date, element) { if (element) dayElements.set(date, element); else dayElements.delete(date) }
async function handleDayKey(event, cell) {
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
  if (!active || offset === undefined || event.altKey || event.ctrlKey || event.metaKey || !cell || cell.isDisabled || !validDate(cell.date)) return false
  event.preventDefault()
  const date = dayjs(cell.date).add(offset, 'day').format('YYYY-MM-DD')
  if (!validDate(date)) return false
  const source = event.currentTarget
  selectDate({ date, isCurrentMonth: date.slice(0, 7) === props.month })
  const generation = focusGeneration
  await nextTick()
  if (!active || generation !== focusGeneration || props.selectedDate !== date) return false
  const document = globalThis.document
  if (document?.activeElement && document.activeElement !== source && document.activeElement !== document.body) return false
  const element = dayElements.get(date)
  element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  return true
}

function getDayClass(cell) {
  if (cell.isSelected) {
    return 'calendar-day-selected'
  }

  if (cell.isToday) {
    return 'calendar-day-today'
  }

  if (!cell.isCurrentMonth) {
    return 'calendar-day-outside'
  }

  return 'calendar-day-normal'
}

function getDayNumberClass(cell) {
  if (cell.isToday || cell.isSelected) {
    return ''
  }

  if (cell.weekday === 0 || cell.weekday === 6) {
    return 'calendar-weekend'
  }

  return ''
}
</script>

<template>
  <section class="journal-calendar relative flex flex-col" aria-label="记账日历">
    <div class="calendar-heading">
      <button
        type="button"
        class="calendar-month-button active:scale-95"
        aria-label="上个月"
        :disabled="!shiftCalendarMonth(month, -1)"
        @click="changeMonth(-1)"
      >
        <ChevronLeft :size="22" :stroke-width="1.5" />
      </button>

      <h2 class="calendar-month-title">
        {{ monthTitle }}
      </h2>

      <button
        type="button"
        class="calendar-month-button active:scale-95"
        aria-label="下个月"
        :disabled="!shiftCalendarMonth(month, 1)"
        @click="changeMonth(1)"
      >
        <ChevronRight :size="22" :stroke-width="1.5" />
      </button>
    </div>

    <div class="calendar-month-picker"><MonthPicker :month="month" label="选择日历月份" @select="selectMonth" /></div>

    <p v-if="summaryError" class="calendar-totals text-sm" role="alert">{{ summaryError }}</p>
    <div v-else class="calendar-totals">
      <div class="calendar-summary-grid grid grid-cols-2 gap-2" :class="{ 'calendar-summary-grid-wide': wideAmounts }">
        <div class="calendar-summary calendar-summary-income cat-money-note cat-money-note-income">
          <span class="calendar-note-mark" aria-hidden="true">✦</span>
          <div class="min-w-0">
            <p class="text-xs text-[var(--zz-home-ink-soft)]">本月收入</p>
            <p class="calendar-amount text-[var(--zz-home-green)]">¥{{ incomeText }}</p>
          </div>
        </div>
        <div class="calendar-summary calendar-summary-expense cat-money-note cat-money-note-expense">
          <span class="calendar-note-mark" aria-hidden="true">♡</span>
          <div class="min-w-0">
            <p class="text-xs text-[var(--zz-home-ink-soft)]">本月支出</p>
            <p class="calendar-amount text-[var(--zz-home-pink)]">¥{{ expenseText }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="calendar-weekdays">
      <span v-for="(weekday, index) in weekdays" :key="weekday" :class="{ 'calendar-weekend': index === 0 || index === 6 }">
        {{ weekday }}
      </span>
    </div>

    <div class="calendar-grid relative grid grid-cols-7">
      <button
        v-for="cell in calendarCells"
        :key="cell.date"
        :ref="element => setDayElement(cell.date, element)"
        type="button"
        class="calendar-day relative flex items-center justify-center active:scale-95"
        :class="getDayClass(cell)"
        :aria-label="cell.isDisabled ? '超出可查看日期范围' : cell.date"
        :disabled="cell.isDisabled"
        :tabindex="cell.isSelected ? 0 : -1"
        :aria-pressed="cell.isSelected"
        :aria-current="cell.isToday ? 'date' : undefined"
        @click="selectDate(cell)"
        @keydown="handleDayKey($event, cell)"
      >
        <span :class="getDayNumberClass(cell)">{{ cell.day }}</span>
        <span v-if="cell.isToday" class="calendar-today-label" aria-hidden="true">今</span>
        <span
          v-if="cell.hasRecord"
          class="calendar-record-dot"
        />
      </button>
    </div>

    <p class="calendar-key-hint">日期区可用方向键，逐日或逐周查看</p>


  </section>
</template>

<style scoped>
.calendar-month-picker { display:flex; justify-content:center; margin:3px 0 12px; }
.calendar-key-hint { margin-top:8px; font-size:10px; text-align:center; color:var(--zz-home-ink-soft); }
.calendar-day { scroll-margin-block:12px calc(var(--zz-home-bottom-nav-height) + 12px); }
.journal-calendar {
  width: 100%;
  min-width: 0;
  padding: 22px 14px 16px;
  border: 1.5px solid var(--zz-home-line);
  border-radius: 16px 19px 20px 15px;
  background-color: var(--zz-home-paper);
  box-shadow: 3px 4px 0 var(--zz-home-title-brush);
}
.journal-calendar::before { content: ''; position: absolute; width: 76px; height: 20px; top: -9px; left: calc(50% - 38px); border: 1px dashed var(--zz-home-line); border-radius: 2px 4px 3px 2px; background: var(--zz-home-pink-soft); transform: rotate(-4deg); pointer-events: none; }
.calendar-heading { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 12px; }
.calendar-month-button { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: 14px 11px 15px 12px; color: var(--zz-home-ink); }
.calendar-month-button:hover { background: var(--zz-home-title-brush); }
.calendar-month-button:disabled, .calendar-day:disabled { opacity: .45; cursor: default; }
.calendar-month-title { padding: 5px 12px; min-width: 0; font-size: 18px; font-weight: 400; border-radius: 14px 11px 15px 12px; background: var(--zz-home-title-brush); color: var(--zz-home-ink); }
.calendar-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); text-align: center; gap: 2px; margin-bottom: 8px; font-size: 12px; color: var(--zz-home-ink-soft); }
.calendar-weekend { color: var(--zz-home-pink); }
.calendar-grid { grid-template-rows: repeat(6, minmax(38px, 1fr)); gap: var(--zz-home-grid-gap-y) var(--zz-home-grid-gap-x); }
.calendar-day { min-width: 0; min-height: 38px; gap: 2px; border: 1px solid transparent; border-radius: 13px 10px 14px 11px; font-size: 14px; font-weight: 400; color: var(--zz-home-ink); }
.calendar-day-normal { background: transparent; }
.calendar-day-normal:hover { background: var(--zz-home-title-brush); }
.calendar-day-outside { background: transparent; color: var(--zz-home-day-muted); }
.calendar-day-outside span { color: inherit; }
.calendar-day-today { border-color: var(--zz-home-line); background: var(--zz-home-title-brush); }
.calendar-day-selected { border-color: var(--zz-home-line); background: var(--zz-home-pink-soft); }
.calendar-today-label { font-size: 11px; color: var(--zz-home-ink-soft); }
.calendar-record-dot { position: absolute; bottom: 3px; width: 4px; height: 4px; border-radius: 50%; background: var(--zz-home-ink-soft); }
.calendar-totals { margin: 7px 0 15px; padding-bottom: 14px; border-bottom: 1px dashed var(--zz-home-line); }
.calendar-summary {
  position: relative;
  isolation: isolate;
  min-width: 0;
  padding: 13px 12px 15px;
  border: 1px solid var(--note-line);
  border-radius: 3px 3px 7px 3px;
  background-image: repeating-linear-gradient(transparent 0 22px, var(--note-rule) 22px 23px);
  background-position: 0 9px;
  box-shadow: 1px 3px 4px #79634f12;
}
.calendar-summary::before {
  content: '';
  position: absolute;
  top: -7px;
  left: 15px;
  width: 35px;
  height: 13px;
  border-inline: 1px solid #fff9e788;
  background: #fff9dfb5;
  transform: rotate(-5deg);
  pointer-events: none;
}
.calendar-summary::after {
  content: '';
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 12px;
  height: 12px;
  background: linear-gradient(135deg, var(--note-fold) 49%, var(--zz-home-paper) 51%);
  border-radius: 3px 0 0 0;
  pointer-events: none;
}
.calendar-summary > div { position: relative; z-index: 1; }
.calendar-note-mark { position: absolute; top: 8px; right: 9px; color: var(--note-line); font-size: 13px; line-height: 1; }
.calendar-summary-grid { gap: 12px; padding-inline: 2px; }
.calendar-summary-income { --note-line: #acbea0; --note-rule: #c6d5b666; --note-fold: #c6d5b6; transform: rotate(-1deg); }
.calendar-summary-expense { --note-line: #d8aca8; --note-rule: #e5bcb766; --note-fold: #e8bfba; transform: rotate(1deg); }
.calendar-summary-grid-wide .calendar-note-mark { display: none; }
.calendar-summary-grid-wide { grid-template-columns: 1fr; }.calendar-summary-grid-wide .calendar-summary > div { display:flex; align-items:center; justify-content:space-between; gap:8px; }.calendar-summary-grid-wide .calendar-amount { margin-top:0; }
.calendar-summary-income { background: var(--zz-home-income-panel); }
.calendar-summary-expense { background: var(--zz-home-expense-panel); }
.calendar-amount { margin-top: 3px; font-size: clamp(14px, 4vw, 19px); font-weight: 400; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.4; }
button:focus-visible { outline: 2px solid var(--zz-home-ink); outline-offset: 2px; }
@media (pointer: coarse) { .calendar-day { min-height: 42px; } }
</style>
