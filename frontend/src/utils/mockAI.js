import dayjs from 'dayjs'
import { findCategoryMatch, getCategoryMeta, getCategoryOptions } from './categories.js'
export { CATEGORY_OPTIONS, getCategoryMeta } from './categories.js'

const RECORD_KEYWORDS = ['花', '买', '吃', '喝', '支出', '消费', '收入', '工资', '收到', '红包', '打车', '地铁']
const QUERY_KEYWORDS = ['多少', '查', '统计', '看看', '花了']

function detectRecordType(text) {
  return /收入|工资|薪水|奖金|红包|收到|退款|报销|兼职|稿费|收益/.test(text) ? 'income' : 'expense'
}

function detectCategory(text, type) {
  const matched = findCategoryMatch(text, type)

  return matched || getCategoryOptions(type).at(-1)
}

function extractAmount(text) {
  const amountWithUnit = text.match(/(\d+(?:\.\d{1,2})?)\s*(?:块(?:钱)?|元|rmb|人民币)/i)

  if (amountWithUnit) {
    return Number(amountWithUnit[1])
  }

  const numbers = [...text.matchAll(/\d+(?:\.\d{1,2})?/g)]
  return numbers.length ? Number(numbers.at(-1)[0]) : 0
}

function extractDate(text) {
  if (text.includes('前天')) {
    return dayjs().subtract(2, 'day').format('YYYY-MM-DD')
  }

  if (text.includes('昨天')) {
    return dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  }

  return dayjs().format('YYYY-MM-DD')
}

function extractTime(text) {
  const matched = text.match(/(?:今天|昨天|前天)?\s*(\d{1,2})(?:[:：点])(\d{1,2})?/)

  if (!matched) {
    return dayjs().format('HH:mm')
  }

  let hour = Number(matched[1])
  const minute = Number(matched[2] || 0)
  const isAfternoonOrEvening = /下午|傍晚|晚上/.test(text)
  const isNoon = /中午/.test(text)

  if (isAfternoonOrEvening && hour < 12) {
    hour += 12
  }

  if (isNoon && hour < 11) {
    hour += 12
  }

  if (/凌晨/.test(text) && hour === 12) {
    hour = 0
  }

  if (hour > 23 || minute > 59) {
    return dayjs().format('HH:mm')
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function buildRecordReply(record) {
  const typeLabel = record.type === 'income' ? '收入' : '支出'
  return `我识别到一笔${record.category}${typeLabel}，核对一下就好 🐣`
}

export function getFakeAIResponse(input, summary = {}) {
  const text = String(input || '').trim()

  if (!text) {
    return {
      type: 'chat',
      reply: '我还在听呢，说说今天花了什么吧～',
    }
  }

  const isQuery = QUERY_KEYWORDS.some((keyword) => text.includes(keyword))
    && /多少|查|统计|看看/.test(text)

  if (isQuery) {
    const type = /收入/.test(text) ? 'income' : 'expense'
    const categoryMeta = findCategoryMatch(text, type)

    if (categoryMeta) {
      const isIncome = type === 'income'
      const categorySource = isIncome ? summary.categoryIncome : summary.categoryExpenses
      const categoryTotal = categorySource?.[categoryMeta.label] || 0
      const reply = isIncome
        ? `本月${categoryMeta.label}收入合计 ¥${categoryTotal.toFixed(2)}。`
        : `本月${categoryMeta.label}共花了 ¥${categoryTotal.toFixed(2)}。`

      return {
        type: 'query',
        reply,
      }
    }

    const total = type === 'income' ? summary.monthIncome || 0 : summary.monthExpense || 0
    const label = type === 'income' ? '收入' : '支出'
    return {
      type: 'query',
      reply: `本月${label}合计 ¥${Number(total).toFixed(2)}。`,
    }
  }

  const isRecordIntent = RECORD_KEYWORDS.some((keyword) => text.includes(keyword))

  if (!isRecordIntent) {
    return {
      type: 'chat',
      reply: '我还没听懂。你可以说“今天吃饭花了35块”，我会帮你整理成账单。',
    }
  }

  const amount = extractAmount(text)

  if (!amount || amount <= 0) {
    return {
      type: 'chat',
      reply: '这笔大概多少钱呀？比如“今天吃饭花了35块”。',
    }
  }

  const type = detectRecordType(text)
  const category = detectCategory(text, type)
  const record = {
    type,
    amount: Number(amount.toFixed(2)),
    category: category.label,
    icon: category.icon,
    date: extractDate(text),
    time: extractTime(text),
    remark: text.slice(0, 40),
  }

  return {
    type: 'record',
    reply: buildRecordReply(record),
    record,
  }
}
