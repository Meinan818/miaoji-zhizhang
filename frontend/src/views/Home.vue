<script setup>
import CatNavIcon from '@/components/common/CatNavIcon.vue'
import JournalSticker from '@/components/common/JournalSticker.vue'
import ManualEntry from '@/components/record/ManualEntry.vue'
// 1. 导入
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import dayjs from 'dayjs'
import CategoryIcon from '@/components/common/CategoryIcon.vue'
import miaoAvatar from '@/assets/design/mascot/miao-avatar.png'
import miaoConfused from '@/assets/design/mascot/poses/miao-confused.png'
import CalendarCard from '@/components/calendar/CalendarCard.vue'
import BottomNav from '@/components/layout/BottomNav.vue'
import { useRecordStore } from '@/stores/recordStore'
import { useAuthStore } from '@/stores/authStore'
import { formatCurrency } from '@/utils/format'
import { centsText, getRecordTotals } from '@/utils/money'
import { SERVER_MODE } from '@/api/mode'
import { createBillFilterPath, useLedgerReload } from '@/utils/navigation'
import { useHomeCalendar } from '@/utils/calendar'

// 2. 组合式函数
const recordStore = useRecordStore()
const auth = SERVER_MODE ? useAuthStore() : null
const { reloading, reloadError, reloadRecords } = useLedgerReload(recordStore, { owner: SERVER_MODE ? () => auth.user?.id : undefined })

// 3. 响应式数据
const { today, calendarMonth, selectedDate, weekdayLabel, returnToday, handleMonthChange, handleDateChange, ownerCurrent } = useHomeCalendar({ rememberHistory: true, owner: SERVER_MODE ? () => auth.user?.id : undefined })
let active = true
onScopeDispose(() => { active = false })

// 4. 计算属性
const visibleMonthRecords = computed(() => recordStore.records.filter((record) => (
  record.date?.startsWith(calendarMonth.value)
)))

const todayRecords = computed(() => recordStore.records.filter(record => record.date === today.value))
const todayTotals = computed(() => getRecordTotals(todayRecords.value))
const monthTotals = computed(() => getRecordTotals(visibleMonthRecords.value))

const selectedRecords = computed(() => recordStore.records
  .filter((record) => record.date === selectedDate.value)
  .sort((left, right) => String(left.time).localeCompare(String(right.time))))
const selectedTotals = computed(() => getRecordTotals(selectedRecords.value))
const selectedDayEntryTarget = computed(() => ({ path: '/add', query: {
  date: selectedDate.value,
  returnTo: createBillFilterPath({ month: calendarMonth.value, date: selectedDate.value }),
} }))
const needsWideDayAmounts = computed(() => !selectedTotals.value.error && [selectedTotals.value.incomeCents, selectedTotals.value.expenseCents].some(value => centsText(value).length > 7))
const dayBatchSize = 60
const visibleDayLimit = ref(dayBatchSize), expandingDay = ref(false)
let dayExpansionGeneration = 0
watch(selectedDate, () => { dayExpansionGeneration++; visibleDayLimit.value = dayBatchSize; expandingDay.value = false }, { flush: 'sync' })
const displayedDayRecords = computed(() => selectedRecords.value.slice(0, visibleDayLimit.value))
const hiddenDayCount = computed(() => selectedRecords.value.length - displayedDayRecords.value.length)
const dayRecordElements = new Map()
function setDayRecordElement(id, element) { if (element) dayRecordElements.set(id, element); else dayRecordElements.delete(id) }
async function loadMoreDayRecords() {
  if (!active || !ownerCurrent.value || recordStore.storageError || expandingDay.value || !hiddenDayCount.value) return false
  const generation = ++dayExpansionGeneration, date = selectedDate.value
  const nextId = selectedRecords.value[visibleDayLimit.value]?.id
  expandingDay.value = true; visibleDayLimit.value += dayBatchSize
  try {
    await nextTick()
    if (!active || !ownerCurrent.value || recordStore.storageError || generation !== dayExpansionGeneration || date !== selectedDate.value) return false
    const element = dayRecordElements.get(nextId)
    element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    return true
  } finally { if (active && ownerCurrent.value && generation === dayExpansionGeneration) expandingDay.value = false }
}

const selectedDateLabel = computed(() => {
  const date = dayjs(selectedDate.value)

  if (date.isSame(dayjs(today.value), 'day')) {
    return `今天 · ${date.format('M月D日')}`
  }

  return date.format('M月D日 dddd')
})

// 5. 方法

function getRecordSign(record) {
  return record.type === 'income' ? '+' : '-'
}
</script>

<template>
  <div class="journal-home notebook-evolution">
    <main class="home-content">
      <header class="home-header">
        <img :src="miaoAvatar" alt="手绘猫猫" class="home-header-cat" />
        <div>
          <h1 class="home-title">喵叽智账</h1>
          <p class="home-subtitle">日常开销 · {{ SERVER_MODE ? '当前账号' : '本地演示' }}</p>
        </div>
        <span class="home-header-note">每一笔，都好好记下</span>
      </header>

      <p v-if="!ownerCurrent" class="home-subtitle" role="status">登录身份已变化，请重新打开首页。</p>
      <template v-if="ownerCurrent">
      <section class="home-desk-hero desk-note" aria-label="今日记账便签">
        <div class="home-date-bookmark" aria-label="今天的日期"><span>{{ dayjs(today).format('M月') }}</span><strong>{{ dayjs(today).format('DD') }}</strong><span>{{ weekdayLabel }}</span></div>
        <div class="home-note-copy"><p class="edition-kicker">每天一页 · 慢慢记下</p><h2>把小开销，写成小日子</h2><p v-if="!recordStore.storageError && !todayTotals.error" class="home-today-line">今天 {{ todayRecords.length }} 笔 · 支出 ¥{{ centsText(todayTotals.expenseCents) }}</p><p v-else-if="!recordStore.storageError" class="home-today-line" role="alert">今天 {{ todayRecords.length }} 笔 · {{ todayTotals.error }}</p><p v-else class="home-today-line">先保留账本，再慢慢整理</p><router-link to="/chat" class="journal-action home-chat-action">和本喵聊着记 <span aria-hidden="true">↗</span></router-link></div>
        <JournalSticker kind="spark" tone="honey" class="home-hero-sticker" />
      </section>
      <div class="home-tools"><ManualEntry class="home-manual-link" /><button type="button" class="home-return-today" @click="returnToday"><CatNavIcon kind="calendar" /><span>回到今天</span></button></div>
      <div v-if="recordStore.storageError || reloadError" class="home-storage-error" role="alert" :aria-busy="reloading"><p>{{ recordStore.storageError || reloadError }}</p><button type="button" class="home-return-today" :disabled="reloading" @click="reloadRecords(true)">{{ reloading ? '正在读取…' : '重新读取账单' }}</button></div>

      <CalendarCard v-if="!recordStore.storageError"
        :month="calendarMonth"
        :today="today"
        :selected-date="selectedDate"
        :records="recordStore.records"
        :income-cents="monthTotals.incomeCents"
        :expense-cents="monthTotals.expenseCents"
        :summary-error="monthTotals.error"
        @update:month="handleMonthChange"
        @update:selected-date="handleDateChange"
      />

      <section v-if="!recordStore.storageError" class="home-ledger" aria-label="当天账单">
        <div class="home-ledger-heading">
          <div>
            <p class="home-subtitle">当天的小账单</p>
            <h2>{{ selectedDateLabel }}</h2>
          </div>
          <div class="home-ledger-tools">
            <span class="home-count">{{ selectedRecords.length }} 笔</span>
            <router-link v-if="selectedRecords.length" class="home-day-details" :to="{ path: '/bills', query: { month: selectedDate.slice(0, 7), date: selectedDate } }" :aria-label="'查看' + selectedDate + '账单明细'">查看当天明细 <span aria-hidden="true">→</span></router-link>
            <router-link v-if="!SERVER_MODE || !selectedDate.startsWith('9999-')" class="home-day-details home-day-entry" :to="selectedDayEntryTarget" :aria-label="'为' + selectedDate + '手动记一笔'">补记这一天 <span aria-hidden="true">＋</span></router-link>
          </div>
        </div>

        <section class="home-day-summary" aria-label="当天账单汇总">
          <p v-if="selectedTotals.error" class="home-subtitle" role="alert">{{ selectedTotals.error }}</p>
          <dl v-else class="home-day-totals" :class="{ 'home-day-totals-wide': needsWideDayAmounts }">
            <div><dt>当天收入</dt><dd class="home-amount-income">¥{{ centsText(selectedTotals.incomeCents) }}</dd></div>
            <div><dt>当天支出</dt><dd class="home-amount-expense">¥{{ centsText(selectedTotals.expenseCents) }}</dd></div>
          </dl>
        </section>

        <div v-if="selectedRecords.length" class="space-y-3">
          <article
            v-for="record in displayedDayRecords"
            :key="record.id"
            :ref="element => setDayRecordElement(record.id, element)"
            class="home-record"
            :class="{ 'home-record-wide': formatCurrency(record.amount).length > 8 }"
            tabindex="-1"
          >
            <div class="home-record-main">
              <span class="home-record-stamp" aria-hidden="true"><CategoryIcon :category="record.category" :type="record.type" /></span>
              <div class="home-record-text">
                <p>{{ record.category }}</p>
                <p class="home-subtitle">{{ record.time || '--:--' }} · {{ record.remark || '无备注' }}</p>
              </div>
            </div>
            <p
              class="home-record-amount"
              :class="record.type === 'income' ? 'home-amount-income' : 'home-amount-expense'"
            >
              {{ getRecordSign(record) }}{{ formatCurrency(record.amount) }}
            </p>
          </article>
          <button v-if="hiddenDayCount" type="button" class="home-load-more" :disabled="expandingDay" :aria-busy="expandingDay" @click="loadMoreDayRecords">再翻 {{ Math.min(60, hiddenDayCount) }} 张小票 · 还有 {{ hiddenDayCount }} 张</button>
        </div>

        <div v-else class="home-empty">
          <img :src="miaoConfused" alt="摊爪的猫猫" />
          <div>
            <p>这天还没有小账单</p>
            <p v-if="!SERVER_MODE || !selectedDate.startsWith('9999-')" class="home-subtitle">点「补记这一天」沿用所选日期，或点下方「聊着记」</p>
            <p v-else class="home-subtitle">点下方「聊着记」，本喵陪你记一笔</p>
          </div>
        </div>
      </section>
      </template>
    </main>

    <BottomNav active="bill" :month="calendarMonth" />
  </div>
</template>

<style scoped>
.home-desk-hero { display: flex; align-items: center; gap: 14px; padding: 16px 15px 15px 12px; margin: 14px 0 20px; overflow: hidden; }
.home-date-bookmark { width: 64px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 9px 4px 12px; border: 1px solid #cbb99b; border-radius: 4px 4px 16px 3px; background: #e5ebda; color: #657859; transform: rotate(-4deg); }
.home-date-bookmark strong { font-weight: 400; font-size: 32px; line-height: 1.15; font-variant-numeric: tabular-nums; }.home-date-bookmark span { font-size: 11px; }
.home-note-copy { min-width: 0; position: relative; z-index: 1; }.home-note-copy h2 { font-size: 16px; font-weight: 400; margin: 3px 0 6px; line-height: 1.7; }.home-today-line { color: var(--zz-home-ink-soft); font-size: 11px; line-height: 1.8; }
.home-chat-action { display: inline-flex; align-items: center; gap: 12px; min-height: 44px; margin-top: 5px; color: #755743; padding: 0 10px; border: 1px solid #d3b694; border-radius: 13px 6px 14px 7px; background: #f6e3c9; box-shadow: 2px 2px 0 #e4d1b7; font-size: 12px; text-decoration: none; }
.home-hero-sticker { position: absolute; right: -3px; top: 3px; opacity: .6; }
.home-tools { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 21px; }.home-tools .home-manual-link { margin-bottom: 0; }
.home-return-today { min-height: 44px; padding: 8px 10px; font-size: 12px; color: #786650; border-bottom: 1px dashed #bcaa94; }.home-return-today:focus-visible, .home-chat-action:focus-visible { outline: 2px solid #785746; outline-offset: 3px; }
@media(max-width:359px) { .home-desk-hero { gap: 10px; padding-inline: 10px; }.home-date-bookmark { width: 53px; }.home-note-copy h2 { font-size: 14px; }.home-today-line { font-size: 10px; } }

.home-manual-link { margin-bottom: 18px; }
.home-storage-error { font-size: 12px; color: #aa594d; margin-bottom: 12px; }
.journal-home {
  min-height: 100dvh;
  padding: 18px 16px calc(var(--zz-home-bottom-nav-height) + 26px + env(safe-area-inset-bottom, 0px));
  background-color: var(--zz-home-bg);
  color: var(--zz-home-ink);
  font-family: var(--zz-home-font);
  font-weight: 400;
}
.home-content { max-width: var(--zz-home-content-width); margin-inline: auto; }
.home-header { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; }
.home-header-cat { width: 66px; height: 62px; object-fit: contain; flex-shrink: 0; transform: rotate(-5deg); }
.home-title { position: relative; isolation: isolate; width: fit-content; font-size: 24px; font-weight: 400; letter-spacing: 1px; white-space: nowrap; }
.home-title::before { content: ''; position: absolute; inset: 9px -5px 1px; z-index: -1; border-radius: 62% 45% 58% 42%; background: var(--zz-home-title-brush); transform: rotate(-2deg); }
.home-subtitle { margin-top: 5px; font-size: 12px; color: var(--zz-home-ink-soft); overflow-wrap: anywhere; }
.home-header-note { margin-left: auto; padding: 5px 8px; border-radius: 9px 6px 8px 5px; background: var(--zz-home-title-brush); color: var(--zz-home-ink-soft); font-size: 11px; transform: rotate(3deg); }
.home-ledger { margin-top: 25px; }
.home-ledger-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 13px; }
.home-ledger-heading h2 { font-size: 18px; font-weight: 400; margin-top: 3px; }
.home-count { padding: 4px 10px; border: 1px solid var(--zz-home-line); border-radius: 11px 9px 12px 10px; background: var(--zz-home-paper); font-size: 12px; color: var(--zz-home-ink-soft); white-space: nowrap; }
.home-ledger-tools { display:flex; flex-direction:column; align-items:flex-end; flex-shrink:0; }
.home-day-details { display:flex; align-items:center; gap:5px; min-height:44px; color:var(--zz-home-ink); font-size:12px; }
.home-day-details:focus-visible { outline:2px solid var(--zz-home-ink); outline-offset:3px; border-radius:6px; }
.home-day-summary { padding:12px; margin-bottom:13px; border:1px dashed var(--zz-home-line); border-radius:14px; background:var(--zz-home-paper); }
.home-day-totals { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.home-day-totals > div { min-width:0; }.home-day-totals dt { color:var(--zz-home-ink-soft); font-size:12px; }.home-day-totals dd { margin-top:4px; font-size:16px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.home-day-totals-wide { grid-template-columns:1fr; }.home-day-totals-wide > div { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }.home-day-totals-wide dd { margin:0; }
.home-record { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1.5px solid var(--zz-home-line); border-radius: 16px 19px 20px 15px; background: var(--zz-home-paper); padding: 13px; box-shadow: 3px 4px 0 var(--zz-home-title-brush); }
.home-record-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.home-record-stamp { display: grid; place-items: center; flex: 0 0 36px; height: 38px; border: 1px dashed var(--zz-home-line); border-radius: 11px 9px 12px 10px; background: var(--zz-home-title-brush); }
.home-record-text { min-width: 0; font-size: 15px; overflow-wrap: anywhere; }
.home-record-text .home-subtitle { white-space: pre-wrap; }
.home-record-amount { flex-shrink: 0; max-width: 43%; text-align: right; font-size: 16px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.home-record-wide { flex-wrap:wrap; }.home-record-wide .home-record-main { width:100%; }.home-record-wide .home-record-amount { width:100%; max-width:none; white-space:nowrap; }
.home-load-more { width:100%; min-height:44px; padding:10px; border:1px dashed var(--zz-home-line); border-radius:14px; background:var(--zz-home-paper); font-size:13px; }
.home-load-more:focus-visible, .home-record:focus-visible { outline:2px solid var(--zz-home-ink); outline-offset:3px; }
.home-record { scroll-margin-block:12px calc(var(--zz-home-bottom-nav-height) + 12px); }
.home-amount-income { color: var(--zz-home-green); }
.home-amount-expense { color: var(--zz-home-pink); }
.home-empty { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 20px 14px; border: 1px dashed var(--zz-home-line); border-radius: 16px 19px 20px 15px; background: var(--zz-home-paper); font-size: 14px; }
.home-empty img { width: 84px; height: 84px; object-fit: contain; flex-shrink: 0; }
@media (max-width: 359px) {
  .journal-home { padding-inline: 12px; }
  .home-header { gap: 8px; }
  .home-header-cat { width: 56px; height: 53px; }
  .home-header-note { display: none; }
}
</style>
