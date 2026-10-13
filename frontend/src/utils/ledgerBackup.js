import { CATEGORY_OPTIONS } from './categories.js'
import { centsText, parseCents } from './money.js'
import { validDate } from './ledger.js'

export const BACKUP_FORMAT = 'miaoji-ledger-backup'
export const BACKUP_FORMAT_VERSION = 1
export const MAX_BACKUP_RECORDS = 5000
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AMOUNT_TEXT = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/
const TIME_TEXT = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const INSTANT_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

/** 演示账本导出：与后端导出使用同一备份格式，便于以后迁入正式账号。 */
export function buildBackupFile(rawRecords, now = new Date()) {
  const records = rawRecords.map(record => ({
    id: record.id,
    version: Number.isSafeInteger(record.version) && record.version >= 0 ? record.version : 0,
    type: record.type,
    amount: centsText(parseCents(String(record.amount))),
    date: record.date,
    time: typeof record.time === 'string' && record.time ? record.time : null,
    category: record.category,
    note: typeof record.remark === 'string' ? record.remark : '',
    deletedAt: record.deletedAt ?? null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
  }))
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: now.toISOString(),
    recordCount: records.length, records }
}

/** 校验备份文件文本；失败返回 { error }，成功返回 { file, summary }。 */
export function inspectBackupText(text) {
  let parsed
  try { parsed = JSON.parse(String(text)) } catch {
    return { error: '这个文件不是有效的 JSON 备份文件，请选择「导出全部账单」下载的文件。' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.format !== BACKUP_FORMAT
    || parsed.formatVersion !== BACKUP_FORMAT_VERSION || !Array.isArray(parsed.records)
    || parsed.records.length < 1 || parsed.records.length > MAX_BACKUP_RECORDS) {
    return { error: '备份文件格式不正确，或账单数量超出上限（1–5000笔），请选择「导出全部账单」下载的文件。' }
  }
  const seen = new Set()
  let deleted = 0, firstDate = null, lastDate = null
  for (const row of parsed.records) {
    const problem = inspectBackupRecord(row)
    if (problem) return { error: `备份文件包含不合法账单（${problem}），本次没有导入任何账单。` }
    const id = row.id.toLowerCase()
    if (seen.has(id)) return { error: '备份文件包含重复的账单编号，请重新导出后再试。' }
    seen.add(id)
    if (row.deletedAt) deleted += 1
    if (firstDate === null || row.date < firstDate) firstDate = row.date
    if (lastDate === null || row.date > lastDate) lastDate = row.date
  }
  return { file: parsed, summary: { count: parsed.records.length, deleted, firstDate, lastDate } }
}

function inspectBackupRecord(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '记录结构'
  if (typeof row.id !== 'string' || !UUID_TEXT.test(row.id)) return '账单编号'
  if (!Number.isSafeInteger(row.version) || row.version < 0) return '版本号'
  if (!['income', 'expense'].includes(row.type)) return '收支类型'
  if (typeof row.amount !== 'string' || !AMOUNT_TEXT.test(row.amount)) return '金额'
  try { parseCents(row.amount) } catch { return '金额' }
  if (typeof row.date !== 'string' || !validDate(row.date)) return '日期'
  if (row.time != null && (typeof row.time !== 'string' || !TIME_TEXT.test(row.time))) return '时间'
  if (typeof row.category !== 'string' || !CATEGORY_OPTIONS[row.type].some(item => item.label === row.category)) return '分类'
  if (typeof row.note !== 'string' || row.note.length > 200) return '备注'
  for (const field of ['deletedAt', 'createdAt', 'updatedAt']) {
    if (row[field] != null && (typeof row[field] !== 'string' || !INSTANT_TEXT.test(row[field]) || !Number.isFinite(Date.parse(row[field])))) return '时间标记'
  }
  return ''
}

/** 演示模式合并：跳过已存在编号，只把新账单追加进当前账本；不删除、不覆盖。 */
export function mergeBackupRecords(existing, rows) {
  const known = new Set(existing.map(record => record.id.toLowerCase()))
  const fresh = []
  let skipped = 0
  for (const row of rows) {
    if (known.has(row.id.toLowerCase())) { skipped += 1; continue }
    known.add(row.id.toLowerCase())
    fresh.push({
      id: row.id, type: row.type, amount: parseCents(row.amount) / 100, date: row.date,
      ...(row.time ? { time: row.time } : {}), category: row.category, remark: row.note,
      ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
    })
  }
  return { merged: [...existing, ...fresh], imported: fresh.length, skipped }
}
