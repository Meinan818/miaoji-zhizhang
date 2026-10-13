import dayjs from 'dayjs'
import { getMonthStatistics, isValidMonth } from './statistics.js'
import { legacyCents, centsText } from './money.js'

export function isMonthReviewQuery(input) {
  const text = String(input || '').replace(/\s+/g, '').replace(/[？?。！!]+$/, '')
  return ['本月复盘', '复盘本月', '本月月报', '帮我复盘本月', '总结本月账本', '查看本月复盘'].includes(text)
}

// 整个业务月份的账本事实，不是截至今天的同期比较，更不是消费预测。
export function getMonthReview(records, month) {
  const current = getMonthStatistics(records, month)
  const previousMonth = dayjs(month + '-01').subtract(1, 'month').format('YYYY-MM')
  let previous = null, comparisonError = ''
  try { if (isValidMonth(previousMonth)) previous = getMonthStatistics(records, previousMonth) }
  catch { comparisonError = '上月账单无法准确统计，暂不作对照。' }
  const days = Array.from({ length: dayjs(month + '-01').daysInMonth() }, (_, i) => ({
    date: month + '-' + String(i + 1).padStart(2, '0'), day: i + 1, expenseCents: 0, incomeCents: 0, count: 0,
  }))
  for (const record of records) {
    if (record.deletedAt || record.date.slice(0, 7) !== month) continue
    const day = days[Number(record.date.slice(8)) - 1]
    day[record.type + 'Cents'] += legacyCents(record.amount)
    day.count++
  }
  const peak = days.reduce((best, day) => day.expenseCents > (best?.expenseCents || 0) ? day : best, null)
  return { current, previous, previousMonth, comparisonError, days, peak,
    activeDays: days.filter(day => day.count > 0).length,
    expenseDeltaCents: previous ? current.expenseCents - previous.expenseCents : null }
}

export function formatMonthReviewReply(review) {
  const s = review.current
  const lines = ['本月账本复盘（按完整业务月份统计）',
    '收入 ¥' + centsText(s.incomeCents) + ' · 支出 ¥' + centsText(s.expenseCents) + ' · 结余 ¥' + centsText(s.balanceCents),
    '有效账单 ' + s.recordCount + ' 笔，分布在 ' + review.activeDays + ' 个记录日。']
  if (review.peak) lines.push('花费最多的一天：' + review.peak.date + '，¥' + centsText(review.peak.expenseCents) + '。')
  const leading = s.categories.expense[0]
  if (leading) lines.push('最大支出分类：' + leading.category + '，¥' + centsText(leading.amountCents) + '。')
  if (review.comparisonError) lines.push(review.comparisonError)
  else if (review.previous?.recordCount) lines.push('上月支出 ¥' + centsText(review.previous.expenseCents) + '；本月' +
    (review.expenseDeltaCents === 0 ? '与上月相同。' : (review.expenseDeltaCents > 0 ? '多' : '少') + ' ¥' + centsText(Math.abs(review.expenseDeltaCents)) + '。'))
  else lines.push('上月没有有效账单，不作环比百分比。')
  lines.push('这是账本事实，不是AI预测；未确认/已删除项不计入，未来业务日期仍按所属月计入。')
  return lines.join('\n')
}
