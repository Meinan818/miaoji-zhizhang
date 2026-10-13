import { CATEGORY_OPTIONS, getCategoryMeta } from './categories.js'
import { MAX_CENTS, parseCents } from './money.js'

export function createId(prefix = 'id') {
  return prefix + '-' + (globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2))
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1000 || year > 9999) return false
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

export function validateRecord(input) {
  if (!['expense', 'income'].includes(input.type)) throw new Error('请选择收入或支出')
  const cents = input.amountCents == null ? parseCents(input.amount) : input.amountCents
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) throw new Error('请补充正确金额，最多两位小数')
  if (!validDate(input.date)) throw new Error('请选择有效日期')
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time || '')) throw new Error('请选择有效时间')
  if (!CATEGORY_OPTIONS[input.type].some(c => c.label === input.category)) throw new Error('分类与收入/支出不匹配')
  const remark = String(input.remark ?? '').trim()
  if (remark.length > 200) throw new Error('备注不能超过200个字符')
  return {
    type: input.type, amount: cents / 100, category: input.category,
    icon: getCategoryMeta(input.category, input.type).icon,
    date: input.date, time: input.time, remark,
    description: String(input.description || remark || input.category).slice(0, 120),
  }
}

export function prepareBatch(existing, inputs, { batchId, source = 'manual', now = new Date().toISOString() } = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 5) throw new Error('每组请整理1–5笔账单')
  if (!batchId) throw new Error('缺少保存标识')
  const itemIds = inputs.map((r, i) => String(r.id || i))
  if (new Set(itemIds).size !== itemIds.length) throw new Error('草稿编号重复，请重新核对')
  const saved = existing.filter(r => r.draftGroupId === batchId)
  if (saved.length) {
    if (saved.length !== itemIds.length || !itemIds.every(id => saved.some(r => r.draftItemId === id))) {
      throw new Error('这组已保存，请到明细修改，不要重复保存')
    }
    return { records: existing, saved, added: false }
  }
  // Validate the entire group before producing any new record.
  const normalized = inputs.map(validateRecord)
  const newRecords = normalized.map((r, i) => ({
    ...r, id: 'record-' + batchId + '-' + itemIds[i], source,
    draftGroupId: batchId, draftItemId: itemIds[i], createdAt: now, updatedAt: now,
  }))
  return { records: [...newRecords, ...existing], saved: newRecords, added: true }
}

export function prepareUpdate(existing, id, input, now = new Date().toISOString()) {
  const current = existing.find(r => r.id === id)
  if (!current) throw new Error('账单已不存在，请刷新明细')
  if (current.deletedAt) throw new Error('这笔账单已删除，不能用旧编辑恢复，请刷新明细')
  const fields = validateRecord(input)
  // Preserve identity, provenance and batch markers so edited AI bills cannot be duplicated.
  const updated = { ...current, ...fields, id: current.id, updatedAt: now }
  return { records: existing.map(r => r.id === id ? updated : r), updated }
}

// Retain the same ledger entry as a deletion marker so an old draft cannot recreate it.
export function prepareDelete(existing, id, now = new Date().toISOString()) {
  const current = existing.find(r => r.id === id)
  if (!current) throw new Error('账单已不存在，请刷新明细')
  if (current.deletedAt) return { records: existing, updated: current, deleted: false }
  const updated = { ...current, deletedAt: now, updatedAt: now }
  return { records: existing.map(r => r.id === id ? updated : r), updated, deleted: true }
}
