import dayjs from 'dayjs'
import { isMonthReviewQuery } from './monthReview.js'
import { CATEGORY_OPTIONS, findCategoryMatch } from './categories.js'
import { centsText, parseCents } from './money.js'
import { createId, validDate } from './ledger.js'

const nouns = ['饭', '面', '咖啡', '奶茶', '牛奶', '面包', '蛋糕', '午餐', '晚餐', '早餐', '红包', '房租', '水费', '电费', '书', '打车', '地铁', '公交', '超市', '工资', '奖金']
const categoryLabels = Object.values(CATEGORY_OPTIONS).flat().map(c => c.label)
export function isQuery(input) {
  const text = String(input || '').trim()
  if (isMonthReviewQuery(text)) return true
  // Summary shorthand must never become a bill. Anchor the whole phrase so product names still work.
  let summary = text.replace(/\s+/g, '').replace(/[？?。！!]+$/, '')
    .replace(/^(?:(?:请|帮我|我想知道|想知道|我想|看看|看下|查一下|查询|查看|统计|汇总|算一下|算算))+/, '')
    .replace(/^(?:(?:本月|这个月|当月|今天|昨天|前天|上个月|上月|下个月|下月|今年|去年|全年|本周|上周|全部|所有|历史)(?:的)?)+/, '')
  const category = categoryLabels.find(label => summary.startsWith(label))
  if (category) summary = summary.slice(category.length)
  if (/^(?:(?:总|总共|一共|累计|合计)(?:支出|收入|开销|花费)|(?:支出|收入|开销|花费)(?:总额|总计|总共|一共|合计))(?:的)?(?:(?:是|有)?多少(?:钱|元|块)?|呢|呀|啊|吗|(?:是|为)?[\d,]+(?:\.\d+)?(?:元|块)?(?:吗|对吗)?)?$/.test(summary)) return true
  return !/(?:买|购买|花了|支出|收到).*[\d,]+(?:\.\d+)?\s*(?:元|块)/.test(text)
    && (/^(?:请|帮我)?(?:查一下|查询|查看|看看|统计|汇总)/.test(text)
      || /(?:本月|这个月|当月).*(?:多少|合计|统计|查询)/.test(text)
      || /(?:支出|收入|花了)(?:了|是|有)?多少/.test(text))
}

function detectType(text) {
  if (/(?:发|给|送).*红包|支出|花了|消费|买/.test(text)) return 'expense'
  if (/收到|收入|工资|薪水|奖金|退款|报销|兼职|稿费|收益/.test(text)) return 'income'
  return text.includes('红包') ? null : 'expense'
}
function hasIntent(text) {
  return /花|买|喝|吃|消费|收入|支出|收到|发红包/.test(text) || nouns.some(n => text.includes(n)) || categoryLabels.some(n => text.includes(n))
}
function parseDate(text, base) {
  const explicit = text.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (explicit) return validDate(explicit) ? { date: explicit } : { date: null, error: '日期无效，请用YYYY-MM-DD补充' }
  if (/大前天|上周|上个月|前几天|某天|明天|后天/.test(text)) return { date: null, error: '请补充具体日期（YYYY-MM-DD）' }
  if (text.includes('前天')) return { date: dayjs(base).subtract(2, 'day').format('YYYY-MM-DD') }
  if (text.includes('昨天')) return { date: dayjs(base).subtract(1, 'day').format('YYYY-MM-DD') }
  if (text.includes('今天')) return { date: base }
  return { date: base }
}
function timeFrom(text, base) {
  const m = text.match(/(\d{1,2})(?:[:：点])(\d{1,2})?/)
  if (!m) return { time: base }
  let hour = Number(m[1]); const minute = Number(m[2] || 0)
  if (/下午|傍晚|晚上/.test(text) && hour < 12) hour += 12
  if (/中午/.test(text) && hour < 11) hour += 12
  if (/凌晨/.test(text) && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return { time: null, error: '请补充有效时间，如12:30' }
  return { time: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') }
}
function moneyFrom(text) {
  const clean = text.replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/\d{1,2}(?:[:：点])\d{0,2}/g, '')
    .replace(/第[一二三四五\d]+笔/g, '').replace(/\d+\s*(?:杯|个|份|笔|次|件)/g, '')
  const tokens = clean.match(/[+-]?\d[\d,]*(?:\.\d+)?/g) || []
  if (!tokens.length) return { amountCents: null }
  if (tokens.length !== 1) return { amountCents: null, error: '这笔有多个数字，请明确金额' }
  try { return { amountCents: parseCents(tokens[0]) } }
  catch (e) { return { amountCents: null, error: e.message } }
}
function descriptionFrom(text, category) {
  const noun = nouns.find(n => text.includes(n))
  const cleaned = text.replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/\d{1,2}(?:[:：点])\d{0,2}/g, '')
    .replace(/[+-]?\d[\d,]*(?:\.\d+)?\s*(?:元|块钱?|人民币|rmb)?/gi, '')
    .replace(/今天|昨天|前天|下午|晚上|早上|中午|上午|买了?|吃了?|喝了?|花了?|支出|消费|收到|收入|再加一笔|还没写价格|不知道多少钱|金额未写|没写金额|多少钱|分别|还没说|一笔|了/g, '').trim()
  return cleaned.slice(0, 40) || noun || category || '这笔'
}
function normalizeSeparators(text) {
  // Validate digit-comma-digit tokens before treating comma as a list separator.
  const tokens = text.match(/\d+(?:,\d+)*(?:\.\d+)?/g) || []
  for (const token of tokens.filter(t => t.includes(','))) {
    if (!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(token)) throw new Error('千分位格式不明确，请写成1,200.50或用中文逗号分隔账单')
  }
  return text.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, t => t.replaceAll(',', ''))
    .replace(/(\d(?:元|块钱?)?)\s*(?:和|以及|还有)\s*(?=[^\d\s])/g, '$1，')
}
function parseItems(text, { date, time, makeId }) {
  let normalized
  try { normalized = normalizeSeparators(text) } catch (e) { return { error: e.message } }
  const segments = normalized.split(/[，,、;；。\n]+|然后|另外/).map(s => s.trim()).filter(Boolean)
  const expanded = segments.flatMap(segment => {
    const separate = segment.match(/^(.+?)分别(.+)$/)
    return separate ? separate[2].split(/和|及|、/).map(amount => separate[1] + amount) : [segment]
  })
  if (expanded.length > 5) return { error: '每组最多5笔，请拆成两次发送。本次没有创建草稿。' }
  if (!expanded.length || expanded.some(s => !hasIntent(s))) return { error: '本喵还不能可靠区分这些项目，请分别写事项和金额，如“午饭25，咖啡18”。' }
  const first = expanded[0].match(/^(今天|昨天|前天|\d{4}-\d{2}-\d{2})/)
  const sharedDate = first ? parseDate(first[0], date).date : date
  const items = expanded.map(segment => {
    const type = detectType(segment)
    const category = findCategoryMatch(segment, type || 'income')?.label || '其他'
    const parsedDate = /今天|昨天|前天|大前天|上周|上个月|前几天|某天|明天|后天|\d{4}-\d{2}-\d{2}/.test(segment) ? parseDate(segment, date) : { date: sharedDate, error: sharedDate ? '' : '请补充有效日期' }
    const parsedTime = timeFrom(segment, time)
    const money = moneyFrom(segment)
    return { id: makeId('item'), type, category, description: descriptionFrom(segment, category),
      amountCents: money.amountCents, date: parsedDate.date, time: parsedTime.time,
      remark: descriptionFrom(segment, category), errors: { amount: money.error || '', date: parsedDate.error || '', time: parsedTime.error || '' } }
  })
  return { items }
}
export function resolveGroup(group) {
  if (['saved', 'cancelled'].includes(group.status)) return group
  if (group.pending?.kind === 'target') { group.status = 'needs_input'; return group }
  group.pending = null
  for (const item of group.items) {
    for (const field of (group.origin === 'ai' ? ['type', 'date', 'amountCents'] : ['type', 'date', 'time', 'amountCents'])) {
      if (item[field] == null) { group.pending = { kind: field, itemId: item.id }; group.status = 'needs_input'; return group }
    }
  }
  group.status = 'ready'
  return group
}
export function groupReply(group) {
  const p = group.pending
  if (p?.kind === 'target') return '要修改第几笔呀？请说“第1笔”或“第2笔”，本喵先不猜。'
  const item = group.items.find(i => i.id === p?.itemId)
  if (p?.kind === 'amountCents') return (item.errors?.amount ? item.errors.amount + '。' : '') + item.description + '多少钱呀？补齐后再一起确认。'
  if (p?.kind === 'type') return item.description + '是收到还是支出呀？请说“收入”或“支出”。'
  if (p?.kind === 'date') return item.description + '请补充具体有效日期，如2026-10-03。'
  if (p?.kind === 'time') return item.description + '请补充有效时间，如12:30。'
  const expense = group.items.filter(i => i.type === 'expense').reduce((n, i) => n + i.amountCents, 0)
  const income = group.items.filter(i => i.type === 'income').reduce((n, i) => n + i.amountCents, 0)
  const totals = [expense ? '支出合计¥' + centsText(expense) : '', income ? '收入合计¥' + centsText(income) : ''].filter(Boolean).join('，')
  return '本喵整理好' + group.items.length + '笔啦，' + totals + '。核对后确认再记下。'
}
export function createDraft(text, { date = dayjs().format('YYYY-MM-DD'), time = dayjs().format('HH:mm'), makeId = createId } = {}) {
  if (/改成|改为|改到|那笔|第[1-5一二三四五]笔/.test(text)) return { reply: '当前没有待修改的草稿。已经记下的账单，请到明细直接修改。' }
  if (/想买|打算|准备买|计划买|如果/.test(text)) return { reply: '计划消费先不记账，实际花费后再告诉本喵吧。' }
  if (!hasIntent(text) || isQuery(text)) return { reply: '本喵在听呢。记账可以说“午饭25，咖啡18”；也可以用手动记账。' }
  const parsed = parseItems(text, { date, time, makeId })
  if (parsed.error) return { reply: parsed.error }
  const group = resolveGroup({ id: makeId('draft'), items: parsed.items, status: 'needs_input', pending: null, createdDate: date })
  return { group, reply: groupReply(group) }
}
function numberTarget(text) {
  const m = text.match(/第([1-5一二三四五])笔/)
  if (!m) return null
  return /^[1-5]$/.test(m[1]) ? Number(m[1]) - 1 : '一二三四五'.indexOf(m[1])
}
function targetsFor(group, text) {
  const index = numberTarget(text)
  if (index != null) return group.items[index] ? [group.items[index]] : []
  const named = group.items.filter(i => text.includes(i.description) || nouns.some(n => text.includes(n) && i.description.includes(n)))
  if (named.length) return named
  return /^(?:把|将)?(?:那笔|这笔|这一笔|那一笔|金额)?$/.test(text.trim()) ? group.items : []
}
function applyPatch(item, patch) {
  Object.assign(item, patch)
  item.errors = { amount: '', date: '', time: '' }
  if (!CATEGORY_OPTIONS[item.type || 'expense'].some(c => c.label === item.category)) item.category = '其他'
}
export function applyDraftInput(original, text, options = {}) {
  const group = JSON.parse(JSON.stringify(original))
  if (['saved', 'cancelled'].includes(group.status)) return { group, reply: '这组已结束，已保存账单请到明细修改。' }
  if (isQuery(text)) return { group, action: 'query' }
  if (/^(?:取消(?:这组|这些|草稿)?|不记了|这组不记了|算了)[。！!]?$/u.test(text.trim())) {
    group.status = 'cancelled'; group.pending = null
    return { group, reply: '这组已取消，没有写入账单。' }
  }
  if (/^(?:确认(?:记下|记账|保存)?(?:\d+笔)?|就这些[，,]?记下吧|记下吧|保存这组|全部记下)[。！!]?$/u.test(text.trim())) {
    if (group.status !== 'ready') return { group, reply: '还有信息没补齐，暂时不能记下。' + groupReply(group) }
    const count = text.match(/(\d+)笔/)
    if (count && Number(count[1]) !== group.items.length) return { group, reply: '当前是' + group.items.length + '笔，请核对数量再确认。' }
    return { group, action: 'confirm' }
  }
  if (/^(?:再加(?:一笔)?|另外加(?:一笔)?|追加)/.test(text)) {
    const content = text.replace(/^(?:再加(?:一笔)?|另外加(?:一笔)?|追加)\s*/, '')
    const parsed = parseItems(content, { date: options.date || group.createdDate, time: options.time || dayjs().format('HH:mm'), makeId: options.makeId || createId })
    if (parsed.error) return { group, reply: parsed.error }
    if (group.items.length + parsed.items.length > 5) return { group, reply: '当前组最多5笔，请先确认或取消。本次没有追加。' }
    group.items.push(...parsed.items); group.pending = null; resolveGroup(group)
    return { group, reply: groupReply(group) }
  }
  // 新的明确纠正替换旧意图；只有纯编号回答才能应用待选择的旧修改。
  const correction = /改成|改为|改到|改一下|那笔|第[1-5一二三四五]笔.*(?:是|金额|日期)/.test(text)
  const targetReply = text.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, token => token.replaceAll(',', ''))
    .replace(/[。！!?？]+$/u, '')
  if (group.pending?.kind === 'target' && /[，,、;；。\n]|然后|另外|同时|以及|还有|并且|和|与/.test(targetReply)) {
    return { group, reply: '请先用单独编号选择要修改的条目，再逐笔补充修改。本喵先保留原草稿。' }
  }
  if (group.pending?.kind === 'target' && !correction) {
    if (!/^(?:是|就是|选|选择)?第[1-5一二三四五]笔[。！!?？]*$/u.test(text.trim())) return { group, reply: groupReply(group) }
    const idx = numberTarget(text)
    const item = group.items[idx]
    if (!item || !group.pending.itemIds.includes(item.id)) return { group, reply: groupReply(group) }
    applyPatch(item, group.pending.patch); group.pending = null; resolveGroup(group)
    return { group, reply: groupReply(group) }
  }
  // Explicit corrections take precedence over answering the next missing field.
  if (correction) {
    const targetText = text.split(/改成|改为|改到|改一下|是/)[0]
    const targets = targetsFor(group, targetText)
    if (!targets.length) return { group, reply: '本喵没找到这笔，请用卡片上的编号。' }
    let patch
    if (/昨天|今天|前天|\d{4}-\d{2}-\d{2}/.test(text)) {
      const value = parseDate(text, options.date || dayjs().format('YYYY-MM-DD'))
      if (!value.date) return { group, reply: value.error }
      const amount = moneyFrom(text)
      if (amount.error) return { group, reply: amount.error }
      patch = amount.amountCents == null ? { date: value.date } : { date: value.date, amountCents: amount.amountCents }
    } else {
      const money = moneyFrom(text)
      if (money.amountCents == null) return { group, reply: money.error || '请明确修改后的金额，如“第2笔改成16”。' }
      patch = { amountCents: money.amountCents }
    }
    if (targets.length > 1) { group.pending = { kind: 'target', itemIds: targets.map(i => i.id), patch }; group.status = 'needs_input' }
    else { applyPatch(targets[0], patch); group.pending = null; resolveGroup(group) }
    return { group, reply: groupReply(group) }
  }
  const pendingItem = group.items.find(i => i.id === group.pending?.itemId)
  if (pendingItem) {
    const kind = group.pending.kind
    let patch
    if (kind === 'amountCents' && /\d/.test(text) && !isQuery(text)) {
      const named = group.items.filter(i => nouns.some(n => text.includes(n) && i.description.includes(n)))
      if (named.length > 1) return { group, reply: '有多笔同名项目，请用编号补充金额。' }
      const money = moneyFrom(text)
      if (money.amountCents == null) return { group, reply: money.error || groupReply(group) }
      if (hasIntent(text) && !named.length) return { group, reply: '要追加请说“再加一笔…”，本喵不会把新消费当成上一笔金额。' }
      const index = numberTarget(text)
      if (index != null && !group.items[index]) return { group, reply: '请用卡片上已有的编号。' }
      const item = index != null ? group.items[index] : named[0] || pendingItem
      applyPatch(item, { amountCents: money.amountCents }); group.pending = null; resolveGroup(group)
      return { group, reply: groupReply(group) }
    }
    if (kind === 'type' && /收入|收到|支出|发出|发红包/.test(text)) patch = { type: /收入|收到/.test(text) ? 'income' : 'expense' }
    if (kind === 'date' && /今天|昨天|前天|\d{4}-\d{2}-\d{2}/.test(text)) {
      const d = parseDate(text, options.date || dayjs().format('YYYY-MM-DD')); if (d.date) patch = { date: d.date }
    }
    if (kind === 'time' && /^\d{1,2}[:：]\d{2}$/.test(text.trim())) {
      const t = timeFrom(text, ''); if (t.time) patch = { time: t.time }
    }
    if (patch) { applyPatch(pendingItem, patch); group.pending = null; resolveGroup(group); return { group, reply: groupReply(group) } }
  }
  return { group, reply: '这组还没确认。要修改请说“咖啡改成16”，要追加请说“再加一笔地铁3元”；也可以直接编辑卡片。' }
}
