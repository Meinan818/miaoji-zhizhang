import dayjs from 'dayjs'
import { validDate } from './ledger.js'
import { centsText, legacyCents } from './money.js'
export const JOURNAL_COLORS = Object.freeze(['#b6c9ab', '#dfb0a5', '#dfc98d', '#b2c6ce', '#c3adcc', '#cdb69a'])

// Read-only search: never reorders, writes or resurrects deleted records.
export function searchRecords(records, query = '') {
  if (!Array.isArray(records)) throw new Error('账单列表无法读取')
  const terms = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean)
  return records.filter(record => {
    if (!record || record.deletedAt) return false
    if (!terms.length) return true
    const cents = legacyCents(record.amount)
    const amount = Number.isSafeInteger(cents) ? centsText(cents) : ''
    const searchable = [record.category, record.remark, record.description, record.date, record.time, record.amount, amount,
      record.type === 'income' ? '收入' : '支出'].map(value => String(value ?? '')).join(' ').toLowerCase()
    return terms.every(term => searchable.includes(term))
  })
}

// 类型/分类精确匹配，文字搜索仍按原规则；筛选绝不改变月汇总或原账本。
export function filterRecords(records, { query = '', type = 'all', category = '', date = '' } = {}) {
  if (!['all', 'income', 'expense'].includes(type) || typeof category !== 'string' || typeof date !== 'string' || (date !== '' && !validDate(date))) throw new Error('筛选条件无效')
  return searchRecords(records, query).filter(record => (
    (type === 'all' || record.type === type) && (!category || record.category === category) && (!date || record.date === date)
  ))
}

// 只限制展示条目，分组金额仍来自完整筛选结果；新增目标可在窗口外单独露出。
export function windowRecordGroups(groups, { limit = 60, revealId = '' } = {}) {
  if (!Array.isArray(groups) || !Number.isSafeInteger(limit) || limit < 1) throw new Error('账单显示范围无效')
  let offset = 0
  return groups.flatMap(group => {
    const count = Math.max(0, limit - offset)
    const records = group.records.slice(0, count)
    const target = revealId ? group.records.find(record => record.id === revealId) : null
    if (target && !records.includes(target)) records.push(target)
    offset += group.records.length
    return records.length ? [{ ...group, records, totalCount: group.records.length }] : []
  })
}

// Geometry from actual cents. All labels/amounts remain normal accessible page text.
export function getCategoryWheel(categories) {
  if (!Array.isArray(categories)) throw new Error('分类数据无法读取')
  if (!categories.length) return { background: '#eee5d6', segments: [] }
  let total = 0
  for (const item of categories) {
    if (!Number.isSafeInteger(item.amountCents) || item.amountCents <= 0) throw new Error('分类金额无效')
    total += item.amountCents
    if (!Number.isSafeInteger(total)) throw new Error('分类金额超出安全范围')
  }
  let cursor = 0
  const segments = categories.map((item, index) => {
    const start = cursor
    cursor = index === categories.length - 1 ? 100 : cursor + item.amountCents / total * 100
    return { category: item.category, color: JOURNAL_COLORS[index % JOURNAL_COLORS.length], start, end: cursor }
  })
  return { segments, background: 'conic-gradient(' + segments.map(segment => `${segment.color} ${segment.start}% ${segment.end}%`).join(', ') + ')' }
}

// Footprints are counts of actual business dates, not a fabricated continuous check-in streak.
export function getRecentDays(records, today) {
  if (!Array.isArray(records) || !validDate(today)) throw new Error('记录日期无法读取')
  const counts = new Map()
  for (const record of records) {
    if (record && !record.deletedAt && ['expense', 'income'].includes(record.type) && typeof record.date === 'string' && validDate(record.date)) {
      counts.set(record.date, (counts.get(record.date) || 0) + 1)
    }
  }
  return Array.from({ length: 7 }, (_, index) => {
    const date = dayjs(today).subtract(6 - index, 'day').format('YYYY-MM-DD')
    return { date, day: dayjs(date).format('DD'), count: counts.get(date) || 0 }
  })
}
