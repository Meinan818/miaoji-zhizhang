import { legacyCents, MAX_CENTS } from './money.js'
import { validDate } from './ledger.js'

export function isValidMonth(month) {
  return typeof month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) >= 1000
}
function addCents(total, amount) {
  const next = total + amount
  if (!Number.isSafeInteger(next)) throw new Error('统计金额汇总超出安全范围，暂时无法显示准确金额')
  return next
}
// Read the same ledger only; do not rewrite dates, create bills, or infer facts from chat drafts.
export function getMonthStatistics(records, month) {
  if (!isValidMonth(month)) throw new Error('请选择有效月份')
  if (!Array.isArray(records)) throw new Error('账单数据无法读取')
  const totals = { expense: 0, income: 0 }
  const counts = { expense: 0, income: 0 }
  const maps = { expense: new Map(), income: new Map() }
  for (const record of records) {
    if (!record || typeof record !== 'object') throw new Error('账单数据格式无效')
    if (record.deletedAt) continue
    if (typeof record.date !== 'string' || !validDate(record.date)) throw new Error('账单日期无效')
    if (record.date.slice(0, 7) !== month) continue
    if (!['expense', 'income'].includes(record.type)) throw new Error('账单收支类型无效')
    const amountCents = legacyCents(record.amount)
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_CENTS) throw new Error('账单金额无效，暂时无法显示准确统计')
    const category = record.category || '未分类'
    const map = maps[record.type]
    const item = map.get(category) || { category, amountCents: 0, count: 0 }
    item.amountCents = addCents(item.amountCents, amountCents); item.count++
    map.set(category, item)
    totals[record.type] = addCents(totals[record.type], amountCents); counts[record.type]++
  }
  const categories = {}
  for (const type of ['expense', 'income']) {
    categories[type] = [...maps[type].values()]
      .sort((a, b) => b.amountCents - a.amountCents || String(a.category).localeCompare(String(b.category), 'zh-CN'))
      .map(item => ({ ...item, percent: Math.round(item.amountCents / totals[type] * 1000) / 10, barPercent: item.amountCents / totals[type] * 100 }))
  }
  return { month, incomeCents: totals.income, expenseCents: totals.expense, balanceCents: totals.income - totals.expense,
    recordCount: counts.income + counts.expense, incomeCount: counts.income, expenseCount: counts.expense, categories }
}
