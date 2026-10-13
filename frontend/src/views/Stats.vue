<script setup>
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { SERVER_MODE } from '@/api/mode'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import NotebookBack from '@/components/common/NotebookBack.vue'
import MonthPicker from '@/components/common/MonthPicker.vue'
import CategoryIcon from '@/components/common/CategoryIcon.vue'
import CategoryWheel from '@/components/common/CategoryWheel.vue'
import CatNavIcon from '@/components/common/CatNavIcon.vue'
import BottomNav from '@/components/layout/BottomNav.vue'
import miaoWriting from '@/assets/design/mascot/poses/miao-writing.png'
import receiptKitten from '@/assets/design/mascot/poses/cream-receipt.png'
import { useRecordStore } from '@/stores/recordStore'
import { useAuthStore } from '@/stores/authStore'
import { centsText } from '@/utils/money'
import JournalSticker from '@/components/common/JournalSticker.vue'
import { JOURNAL_COLORS } from '@/utils/journal'
import { useStatsMonthNavigation, useLedgerReload } from '@/utils/navigation'
import { useLocalDay } from '@/utils/calendar'
import { getMonthReview } from '@/utils/monthReview'
const route = useRoute()
const router = useRouter()
const store = useRecordStore()
const auth = SERVER_MODE ? useAuthStore() : null
const { today } = useLocalDay()
const { selectedMonth, pendingMonth, navigationMonth, navigationError, changeMonth, selectMonth, ownerCurrent } = useStatsMonthNavigation(route, router, () => today.value.slice(0, 7), { owner: SERVER_MODE ? () => auth.user?.id : undefined })
const currentMonth = computed(() => today.value.slice(0, 7))
const canReturnToCurrentMonth = computed(() => ownerCurrent.value && !pendingMonth.value && selectedMonth.value !== currentMonth.value)
const { reloading, reloadError, reloadRecords } = useLedgerReload(store, { owner: SERVER_MODE ? () => auth.user?.id : undefined })
const selectedType = ref('expense')
const monthTitle = computed(() => dayjs(selectedMonth.value + '-01').format('YYYY年M月'))
const calculated = computed(() => {
  try { return { review: getMonthReview(store.records, selectedMonth.value), error: '' } }
  catch (error) { return { review: null, error: error.message } }
})
const review = computed(() => calculated.value.review)
const statistics = computed(() => review.value?.current)
const selectedDay = ref('')
const dayChart = ref(null)
const pointedDay = computed(() => review.value?.days.find(day => day.date === selectedDay.value) || review.value?.peak || null)
const maximumDayExpense = computed(() => review.value?.peak?.expenseCents || 0)
const error = computed(() => store.storageError || reloadError.value || calculated.value.error)
const needsWideAmounts = computed(() => statistics.value && [statistics.value.incomeCents, statistics.value.expenseCents, statistics.value.balanceCents].some(value => centsText(value).length > 7))
const categoryRows = computed(() => statistics.value?.categories[selectedType.value] || [])
const leadingCategory = computed(() => categoryRows.value[0] || null)
const typeLabel = computed(() => selectedType.value === 'income' ? '收入' : '支出')
let active = true
let manuallyMoved = false
onScopeDispose(() => { active = false })
const isCurrentView = () => active && ownerCurrent.value
function returnToCurrentMonth() {
  if (!isCurrentView() || !canReturnToCurrentMonth.value) return false
  return selectMonth(currentMonth.value)
}
function keepChartPosition() { if (isCurrentView()) manuallyMoved = true }
function keepChartKeyPosition(event) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) keepChartPosition()
}
function selectDay(date) { if (isCurrentView()) selectedDay.value = date }
function selectType(type) { if (isCurrentView()) selectedType.value = type }
function slideDays(direction) {
  if (!isCurrentView()) return
  keepChartPosition()
  dayChart.value?.scrollBy({ left: direction * 7 * 49, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
watch(selectedMonth, () => { if (isCurrentView()) { selectedDay.value = ''; manuallyMoved = false } }, { flush: 'sync' })
watch([review, selectedMonth], async (_value, _previous, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  const month = selectedMonth.value, snapshot = review.value
  await nextTick()
  if (!isCurrentView() || !current || manuallyMoved || month !== selectedMonth.value || snapshot !== review.value ||
      !dayChart.value || selectedDay.value || !snapshot?.peak) return
  dayChart.value.scrollLeft = Math.max(0, (snapshot.peak.day - 1) * 49 - (dayChart.value.clientWidth - 44) / 2)
}, { immediate: true })
// 正式路由已完成当前身份的账本读取；失败由页面显式重试。
if (!SERVER_MODE) onMounted(reloadRecords)
</script>

<template>
  <div class="journal-stats notebook-evolution">
    <main class="stats-content">
      <header class="stats-header">
        <NotebookBack />
        <img :src="miaoWriting" alt="猫猫陪你整理收支" class="stats-header-cat" />
        <div><h1 class="stats-title">月度复盘</h1><p class="stats-subtitle">翻开这一月 · 看见钱去了哪里</p></div>
      </header>
      <p v-if="!ownerCurrent" class="review-scope-note" role="status">登录身份已变化，请重新打开统计页。</p>
      <template v-if="ownerCurrent">
      <section class="stats-month-card" aria-label="统计月份">
        <div class="stats-month-nav">
          <button type="button" aria-label="上个月" :disabled="navigationMonth === '1000-01'" @click="changeMonth(-1)"><ChevronLeft :size="22" :stroke-width="1.5" /></button>
          <h2>{{ monthTitle }}</h2>
          <button type="button" aria-label="下个月" :disabled="navigationMonth === '9999-12'" @click="changeMonth(1)"><ChevronRight :size="22" :stroke-width="1.5" /></button>
        </div>
        <div class="stats-month-shortcuts"><MonthPicker :month="navigationMonth" :disabled="!ownerCurrent || Boolean(pendingMonth)" label="选择统计月份" @select="selectMonth" /><button type="button" class="stats-current-month" aria-label="回到本月" :disabled="!canReturnToCurrentMonth" @click="returnToCurrentMonth">{{ selectedMonth === currentMonth ? '已在本月' : '回到本月' }}</button></div>
        <p v-if="pendingMonth" class="review-scope-note" role="status">正在翻到 {{ pendingMonth }}，当前仍显示 {{ selectedMonth }}。</p>
        <p v-else-if="navigationError" class="review-scope-note" role="alert">{{ navigationError }}</p>
        <template v-if="!error && statistics">
          <p class="review-kicker">MONTHLY JOURNAL · 本月收支小结</p>
          <dl class="stats-overview" :class="{ 'stats-overview-wide': needsWideAmounts }" aria-label="月度收支统计">
            <div class="stats-total-income"><dt>收入</dt><dd>¥{{ centsText(statistics.incomeCents) }}</dd></div>
            <div class="stats-total-expense"><dt>支出</dt><dd>¥{{ centsText(statistics.expenseCents) }}</dd></div>
            <div class="stats-total-balance"><dt>结余</dt><dd :class="{ negative: statistics.balanceCents < 0 }">¥{{ centsText(statistics.balanceCents) }}</dd></div>
          </dl>
          <div class="stats-count-line"><p>有效账单 <strong>{{ statistics.recordCount }}</strong> 笔</p><router-link :to="{ path: '/bills', query: { month: selectedMonth } }" :aria-label="'查看' + monthTitle + '账单明细'">查看明细 →</router-link></div>
        </template>
      </section>
      <section v-if="error" class="stats-error" :aria-busy="reloading" role="alert"><h2>{{ reloading ? '正在读取账单' : '统计暂时无法显示' }}</h2><p>{{ error }}</p><button type="button" :disabled="reloading" @click="reloadRecords(true)">{{ reloading ? '读取中…' : '重新读取账单' }}</button></section>
      <template v-else-if="statistics">
        <section class="review-trend" aria-labelledby="review-trend-title">
          <div class="review-section-title"><div><p class="edition-kicker">花费足迹 · 每天一小格 · 左右滑动</p><h2 id="review-trend-title">这一月，钱是怎么花的？</h2></div><span>{{ review.activeDays }} 个记录日</span></div>
          <div class="review-cat-guide"><CatNavIcon kind="chart" /><span>本喵的爪爪花费轨迹</span><div class="review-scroll-actions"><button type="button" aria-label="查看前7天" @click="slideDays(-1)">‹</button><button type="button" aria-label="查看后7天" @click="slideDays(1)">›</button></div></div>
          <p class="review-pointed-day" role="status">{{ pointedDay ? pointedDay.date + ' · 支出 ¥' + centsText(pointedDay.expenseCents) : '还没有支出足迹，记下第一笔后再来看看。' }}</p>
          <div ref="dayChart" class="review-day-chart" :style="{ '--day-count': review.days.length }" aria-label="每日支出，点击日期查看数额" @pointerdown="keepChartPosition" @wheel.passive="keepChartPosition" @keydown="keepChartKeyPosition">
            <button v-for="day in review.days" :key="day.date" type="button" class="review-day" :class="{ selected: pointedDay?.date === day.date, recorded: day.count }" :aria-pressed="pointedDay?.date === day.date" :aria-label="day.date + '，支出' + centsText(day.expenseCents) + '元'" @click="selectDay(day.date)"><span class="review-day-track" aria-hidden="true"><i :style="{ height: day.expenseCents ? Math.max(5, day.expenseCents / maximumDayExpense * 100) + '%' : '0%' }"></i></span><span>{{ day.day }}</span></button>
          </div>
          <router-link v-if="pointedDay" class="review-day-link" :to="{ path: '/bills', query: { month: selectedMonth, date: pointedDay.date } }">{{ pointedDay.count ? '翻开这一天的 ' + pointedDay.count + ' 张小票 →' : '这天还没有小票，打开当天明细补记 →' }}</router-link>
          <p class="review-scope-note">按完整业务月份统计，未来日期按所属月计入；记录日包含收入与支出，不是连续打卡。</p>
        </section>
        <section class="review-comparison" aria-label="与上月账本对照">
          <p class="edition-kicker">两页账本的对照 · 非同期比较</p>
          <h2>和上月比一比</h2>
          <p v-if="review.comparisonError" class="review-scope-note">{{ review.comparisonError }}</p>
          <template v-else-if="review.previous?.recordCount">
            <div class="review-compare-pages"><div><span>{{ review.previousMonth }} 支出</span><strong>¥{{ centsText(review.previous.expenseCents) }}</strong></div><div><span>{{ selectedMonth }} 支出</span><strong>¥{{ centsText(statistics.expenseCents) }}</strong></div></div>
            <p class="review-delta">{{ review.expenseDeltaCents === 0 ? '两个账本月份的支出相同。' : '本月比上月' + (review.expenseDeltaCents > 0 ? '多' : '少') + ' ¥' + centsText(Math.abs(review.expenseDeltaCents)) }}</p>
          </template>
          <p v-else class="review-scope-note">上月没有有效账单，先留一页空白；不虚构环比百分比。</p>
        </section>
        <section class="stats-category-card" aria-labelledby="stats-category-title">
          <div class="stats-category-heading"><h2 id="stats-category-title">{{ typeLabel }}分类</h2><div class="stats-type-switch" aria-label="选择分类统计类型"><button v-for="type in ['expense', 'income']" :key="type" type="button" :aria-pressed="selectedType === type" :class="{ selected: selectedType === type }" @click="selectType(type)">{{ type === 'income' ? '收入' : '支出' }}</button></div></div>
          <div v-if="categoryRows.length" class="stats-wheel-scene"><span class="stats-wheel-label edition-ribbon">本月账本色谱</span><CategoryWheel :categories="categoryRows" :type="selectedType" :label="typeLabel + '分类分布，共' + categoryRows.length + '类'"><div class="stats-wheel-center"><span>{{ selectedType === 'income' ? '收入来源' : '支出去向' }}</span><strong>{{ categoryRows.length }}<small>类</small></strong><span>{{ statistics[selectedType + 'Count'] }}笔有效账单</span></div></CategoryWheel><JournalSticker kind="spark" tone="honey" class="stats-wheel-spark" /><JournalSticker kind="flower" tone="lilac" class="stats-wheel-flower" /></div>
          <aside v-if="leadingCategory" class="stats-insight desk-note" aria-label="基于实际账单的小发现"><JournalSticker tone="sage" /><div><p class="edition-kicker">账本小发现 · 非AI预测</p><p>本月{{ typeLabel }}最多的是 <strong>{{ leadingCategory.category }}</strong></p><span>¥{{ centsText(leadingCategory.amountCents) }} · 占{{ leadingCategory.percent.toFixed(1) }}%</span></div></aside>
          <p class="stats-category-note">{{ statistics[selectedType + 'Count'] }} 笔{{ typeLabel }} · 金额从高到低</p>
          <p v-if="categoryRows.length" class="stats-category-link-hint">点分类贴纸，翻开这一类的小票</p>
          <ol v-if="categoryRows.length" class="stats-category-list">
            <li v-for="(item, index) in categoryRows" :key="item.category" class="stats-category-row" :data-category="item.category">
              <router-link class="stats-category-line stats-category-link" :to="{path:'/bills',query:{month:selectedMonth,type:selectedType,category:item.category}}" :aria-label="'查看' + monthTitle + typeLabel + '分类' + item.category + '的账单'"><div class="stats-category-name"><span class="stats-category-stamp" aria-hidden="true"><CategoryIcon :category="item.category" :type="selectedType" /></span><span>{{ item.category }}</span></div><div class="stats-category-value"><strong>¥{{ centsText(item.amountCents) }}</strong><span>{{ item.percent.toFixed(1) }}% · {{ item.count }}笔 <span aria-hidden="true">›</span></span></div></router-link>
              <div class="stats-bar-track" aria-hidden="true"><span class="stats-bar-fill" :class="selectedType" :style="{ width: item.barPercent + '%', background: JOURNAL_COLORS[index % JOURNAL_COLORS.length] }"></span></div>
            </li>
          </ol>
          <div v-else class="stats-empty"><img :src="receiptKitten" alt="奶油小猫拿着空白小票" /><p>{{ statistics.recordCount === 0 ? '这个月还没有账单' : '这个月还没有' + typeLabel + '账单' }}</p><span>{{ statistics.recordCount === 0 ? '记下第一笔后，这里会自动整理收支。' : '切换收支类型，可以查看已有账单。' }}</span></div>
          <p v-if="categoryRows.length" class="stats-rounding-note">占比按{{ typeLabel }}总额计算，显示到一位小数，四舍五入后可能略有差异。</p>
        </section>
        <p class="stats-storage-note">只统计当前账本的有效账单，未确认草稿和已删除账单不计入。{{ SERVER_MODE ? '数据保存在当前账号。' : '数据保存在当前浏览器。' }}</p>
      </template>
      </template>
    </main>
    <BottomNav active="saving" :month="selectedMonth" />
  </div>
</template>

<style scoped>
.stats-category-link-hint { font-size:11px; color:#997c67; margin-top:7px; }
.stats-category-link { padding:5px 7px; margin-inline:-7px; min-height:54px; border-radius:15px; text-decoration:none; color:inherit; }
.stats-category-link:hover { background:#fff0df; }
.stats-category-link:focus-visible { outline:2px solid #94644c; outline-offset:2px; }
.review-kicker { font-size: 10px; letter-spacing: 1.5px; color: #8b725e; margin-bottom: 12px; }
.review-trend { margin: 22px 0; padding: 22px 16px 17px; border-top: 2px solid #cfbaa0; border-bottom: 1px solid #dac8b0; background: repeating-linear-gradient(transparent 0 31px,#f0e5d5 31px 32px),#fffaf0; }
.review-section-title { display: flex; justify-content: space-between; align-items: start; gap: 10px; }.review-section-title h2 { font-size: 18px; margin-top: 5px; }.review-section-title > span { flex-shrink: 0; font-size: 11px; color: #79634f; padding-top: 5px; }
.review-pointed-day { min-height: 42px; padding: 12px 0; font-size: 12px; color: #795b48; }
.review-day-chart { display: grid; grid-template-columns: repeat(var(--day-count),44px); gap: 5px; overflow-x:auto; padding:3px 2px 10px; scrollbar-width:thin; }.review-day { display:flex; align-items:center; flex-direction:column; gap:5px; min-width:0; min-height:72px; font-size:10px; color:#79634f; border-radius:5px; padding:4px 1px; }.review-day-track { display:flex; align-items:end; width:100%; max-width:14px; height:42px; background:#efe7d7; border-radius:3px; overflow:hidden; }.review-day-track i { width:100%; background:#bf877a; border-radius:3px 3px 0 0; }.review-day.selected { background:#eedbc8; color:#573d2d; }.review-day.recorded .review-day-track { background:#e8ddc6; }.review-day:focus-visible { outline:2px solid #785746; outline-offset:1px; }
.review-day-link { display:inline-flex; align-items:center; min-height:44px; margin-top:8px; font-size:12px; color:#715844; text-decoration:underline; text-underline-offset:4px; scroll-margin-block:12px calc(var(--zz-home-bottom-nav-height) + 12px); }.review-scope-note { font-size:11px; color:#79634f; line-height:1.9; margin-top:8px; }
.review-comparison { position:relative; margin:22px 0; padding:20px 16px; background:#eaf0df; border:1px solid #bdc8aa; border-radius:3px 3px 18px 3px; }.review-comparison h2 { font-size:18px; margin:6px 0 14px; }.review-compare-pages { display:grid; grid-template-columns:1fr 1fr; gap:12px; }.review-compare-pages > div { min-width:0; padding:10px 0; border-bottom:1px solid #b9c6a9; }.review-compare-pages span { display:block; font-size:11px; color:#617052; }.review-compare-pages strong { display:block; font-weight:400; font-size:clamp(13px,4vw,18px); margin-top:6px; overflow-wrap:anywhere; }.review-delta { font-size:13px; margin-top:14px; color:#566747; overflow-wrap:anywhere; }
.journal-stats .stats-month-card { border-radius:3px 3px 16px 3px; background:linear-gradient(90deg,transparent 13px,#eedccc 13px 14px,transparent 14px),#fffdf8; box-shadow:2px 4px 0 #e7d6bf; }.journal-stats .stats-overview { grid-template-columns:1fr 1fr; }.journal-stats .stats-overview-wide { grid-template-columns:1fr; }.journal-stats .stats-total-expense { grid-column:1 / -1; grid-row:1; text-align:left; padding:14px 10px; border-bottom:1px solid #ddc5b4; background:transparent; border-radius:0; }.journal-stats .stats-total-expense dd { font-size:clamp(24px,7vw,34px); }.journal-stats .stats-total-income,.journal-stats .stats-total-balance { background:transparent; text-align:left; padding:10px; border-radius:0; }
@media(max-width:359px) { .review-section-title h2 { font-size:16px; }.review-section-title > span { font-size:10px; }.review-day-chart { gap:5px; } }

.stats-wheel-scene { position:relative; display:flex; align-items:center; justify-content:center; padding:32px 0 23px; margin:7px 0 3px; background:radial-gradient(ellipse at center,#f9eedc 0 45%,transparent 66%); }
.stats-wheel-label { position:absolute; top:6px; left:0; }.stats-wheel { width:188px; height:188px; border-radius:50%; display:grid; place-items:center; box-shadow:4px 5px 0 #e0d3c2; outline:1px solid #c5b19a; outline-offset:4px; transform:rotate(-3deg); }
.stats-wheel-center { width:130px; height:130px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; border-radius:50%; border:1px dashed #c5b19a; background:#fffaf0; color:var(--zz-home-ink-soft); transform:rotate(3deg); }.stats-wheel-center span { font-size:11px; }.stats-wheel-center strong { font-size:31px; font-weight:400; line-height:1.2; color:var(--zz-home-ink); }.stats-wheel-center small { font-size:12px; margin-left:5px; }
.stats-wheel-spark { position:absolute; right:14%; top:33px; width:35px; height:35px; }.stats-wheel-flower { position:absolute; left:12%; bottom:11px; width:34px; height:34px; }
.stats-insight { display:flex; align-items:center; gap:10px; padding:13px 11px; margin:6px 0 17px; background:#f1f3e5; }.stats-insight > div { min-width:0; }.stats-insight p { font-size:12px; line-height:1.9; overflow-wrap:anywhere; }.stats-insight strong { font-weight:400; color:#6c7757; background:#e1e8ce; padding:2px 4px; }.stats-insight span { font-size:11px; color:var(--zz-home-ink-soft); }

.journal-stats { min-height: 100dvh; padding: 18px 16px calc(var(--zz-home-bottom-nav-height) + 26px + env(safe-area-inset-bottom, 0px)); background: var(--zz-home-bg); color: var(--zz-home-ink); font-family: var(--zz-home-font); font-weight: 400; }
.stats-content { max-width: var(--zz-home-content-width); margin-inline: auto; }
.stats-header { display: flex; align-items: center; gap: 9px; margin-bottom: 26px; }
.stats-back { display: grid; place-items: center; flex: 0 0 44px; height: 44px; border: 1px solid var(--zz-home-line); border-radius: 16px 13px 17px 14px; background: var(--zz-home-paper); }
.stats-header-cat { width: 72px; height: 78px; flex-shrink: 0; object-fit: contain; transform: rotate(-3deg); }
.stats-title { position: relative; isolation: isolate; width: fit-content; font-size: 24px; font-weight: 400; letter-spacing: 1px; white-space: nowrap; }
.stats-title::before { content: ''; position: absolute; inset: 9px -5px 1px; z-index: -1; background: var(--zz-home-title-brush); border-radius: 62% 45% 58% 42%; transform: rotate(-2deg); }
.stats-subtitle { margin-top: 5px; color: var(--zz-home-ink-soft); font-size: 12px; }
.stats-month-card, .stats-category-card { position: relative; border: 1.5px solid var(--zz-home-line); border-radius: 16px 19px 20px 15px; background: var(--zz-home-paper); box-shadow: 3px 4px 0 var(--zz-home-title-brush); }
.stats-month-card { padding: 22px 14px 16px; }
.stats-month-card::before { content: ''; position: absolute; top: -9px; left: calc(50% - 38px); width: 76px; height: 20px; border: 1px dashed var(--zz-home-line); border-radius: 2px 4px 3px 2px; background: var(--zz-home-pink-soft); transform: rotate(-4deg); pointer-events: none; }
.stats-month-nav { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 14px; }
.stats-month-nav button { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; border-radius: 14px 11px 15px 12px; }
.stats-month-nav button:hover { background: var(--zz-home-title-brush); }
.stats-month-nav h2 { padding: 5px 12px; background: var(--zz-home-title-brush); border-radius: 14px 11px 15px 12px; font-size: 18px; font-weight: 400; }
.stats-month-shortcuts { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; margin-bottom: 14px; }
.stats-month-shortcuts .stats-current-month { min-height: 44px; padding: 5px 12px; border: 1px dashed var(--zz-home-line); border-radius: 12px; font-size: 12px; }
.stats-overview { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.stats-overview > div { min-width: 0; padding: 11px 8px; border-radius: 14px 11px 15px 12px; text-align: center; }
.stats-overview dt { color: var(--zz-home-ink-soft); font-size: 12px; }
.stats-overview dd { margin-top: 4px; font-size: 15px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.stats-overview-wide { grid-template-columns: 1fr; }
.stats-overview-wide > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: right; }
.stats-overview-wide dd { margin-top: 0; white-space: nowrap; }
.stats-total-income { background: var(--zz-home-income-panel); color: var(--zz-home-green); }
.stats-total-expense { background: var(--zz-home-expense-panel); color: var(--zz-home-pink); }
.stats-total-balance { background: var(--zz-home-title-brush); }
.negative { color: var(--zz-home-pink); }
.stats-count-line { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 15px; color: var(--zz-home-ink-soft); font-size: 12px; }
.stats-count-line strong { font-weight: 400; color: var(--zz-home-ink); font-variant-numeric: tabular-nums; }
.stats-count-line a { display: inline-flex; align-items: center; min-height: 44px; padding: 4px 8px; border: 1px dashed var(--zz-home-line); border-radius: 10px; color: var(--zz-home-ink); }
.stats-category-card { margin-top: 24px; padding: 16px; }
.stats-category-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.stats-category-heading h2 { font-size: 18px; font-weight: 400; }
.stats-type-switch { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--zz-home-line); border-radius: 13px; background: var(--zz-home-title-brush); }
.stats-type-switch button { min-height: 44px; min-width: 50px; padding: 7px 10px; border-radius: 10px; font-size: 13px; }
.stats-type-switch .selected { background: var(--zz-home-pink-soft); color: var(--zz-home-ink); }
.stats-type-switch button:last-child.selected { background: var(--zz-home-income-panel); }
.stats-category-note { margin: 10px 0 3px; font-size: 12px; color: var(--zz-home-ink-soft); }
.stats-category-list { display: grid; gap: 17px; margin-top: 16px; }
.stats-category-row { min-width: 0; }
.stats-category-line { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.stats-category-name { display: flex; align-items: start; gap: 9px; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }
.stats-category-name > span:last-child { min-width: 0; align-self: center; }
.stats-category-stamp { display: grid; place-items: center; flex: 0 0 30px; height: 32px; border: 1px dashed var(--zz-home-line); border-radius: 10px 8px 11px 9px; background: var(--zz-home-title-brush); }
.stats-category-value { display: grid; flex-shrink: 0; gap: 4px; max-width: 60%; text-align: right; font-size: 12px; color: var(--zz-home-ink-soft); overflow-wrap: anywhere; }
.stats-category-value strong { font-size: 15px; font-weight: 400; font-variant-numeric: tabular-nums; color: var(--zz-home-ink); }
.stats-bar-track { height: 7px; margin-top: 9px; overflow: hidden; border-radius: 6px; background: #f5eee1; }
.stats-bar-fill { display: block; height: 100%; border-radius: inherit; background: #edbdb2; }
.stats-bar-fill.income { background: #bacda5; }
.stats-rounding-note, .stats-storage-note { font-size: 12px; color: var(--zz-home-ink-soft); line-height: 1.9; }
.stats-rounding-note { margin-top: 18px; }
.stats-storage-note { margin: 18px 4px 0; }
.stats-empty { padding: 22px 4px 12px; text-align: center; }
.stats-empty img { width: 96px; height: 96px; margin: 0 auto 12px; object-fit: contain; }
.stats-empty p { font-size: 15px; }
.stats-empty span { display: block; margin-top: 8px; font-size: 12px; line-height: 1.8; color: var(--zz-home-ink-soft); }
.stats-error { margin-top: 22px; padding: 18px; border: 1px dashed #c39380; border-radius: 16px; background: #fff8ed; }
.stats-error h2 { font-size: 17px; font-weight: 400; }.stats-error p { margin: 12px 0; font-size: 13px; line-height: 1.8; }.stats-error button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--zz-home-line); border-radius: 10px; }
button:disabled { opacity: .4; cursor: not-allowed; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--zz-home-ink); outline-offset: 3px; }
@media (prefers-reduced-motion: no-preference) { .stats-type-switch button { transition: background-color 150ms ease, color 150ms ease; } }
@media (max-width: 359px) { .journal-stats { padding-inline: 12px; }.stats-header { gap: 7px; }.stats-header-cat { width: 58px; height: 65px; }.stats-title { font-size: 23px; }.stats-category-card { padding: 14px; }.stats-type-switch button { min-width: 46px; padding-inline: 8px; } }
</style>
