import dayjs from 'dayjs'
import { getMonthReview, formatMonthReviewReply, isMonthReviewQuery } from './monthReview.js'
import { findCategoryMatch } from './categories.js'
import { getMonthStatistics } from './statistics.js'
import { centsText } from './money.js'

// Query presentation only: the same pure aggregation as Stats, never a second ledger.
export function getMonthQueryReply(text, records, month = dayjs().format('YYYY-MM')) {
  if (isMonthReviewQuery(text)) return formatMonthReviewReply(getMonthReview(records, month))
  text = String(text || '').replace(/\s+/g, '')
  const explicitMonth = /本月|这个月|当月/.test(text)
  if (!explicitMonth && /全部|所有|历史|累计|至今|一直以来/.test(text)) {
    return '全部历史总额暂不支持查询；这版先支持本月汇总，其他月份可到明细查看。本喵不会拿本月数据冒充全部历史。'
  }
  if (/上个月|下个月|去年|今年|全年|昨天|前天|今天|明天|后天|本周|这周|上周|下周|上月|下月|本年|年度|\d{4}[-年]|\d{1,2}月/.test(text)) {
    return '这版查询先支持本月汇总；其他日期请到明细切月查看。本喵不会拿本月数据冒充其他日期。'
  }
  const statistics = getMonthStatistics(records, month)
  const type = /收入/.test(text) ? 'income' : 'expense'
  const category = findCategoryMatch(text, type)
  const cents = category
    ? statistics.categories[type].find(item => item.category === category.label)?.amountCents || 0
    : statistics[type + 'Cents']
  const scopeNote = !explicitMonth && /总|总额|总计|总共|一共|合计/.test(text)
    ? '目前只支持本月查询，不是全部历史总额。' : ''
  if (category) return scopeNote + (type === 'income'
    ? '本月' + category.label + '收入合计 ¥' + centsText(cents) + '。'
    : '本月' + category.label + '共花了 ¥' + centsText(cents) + '。')
  return scopeNote + '本月' + (type === 'income' ? '收入' : '支出') + '合计 ¥' + centsText(cents) + '。'
}
