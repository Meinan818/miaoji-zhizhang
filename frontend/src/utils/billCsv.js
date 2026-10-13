import { validDate } from './ledger.js'
import { parseCents, centsText } from './money.js'

function cell(value) {
  let text = String(value ?? '')
  // Quoting alone does not stop spreadsheets from evaluating formulas.
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}

// Snapshot only; callers supply the complete month/filter result, not a UI window.
export function createBillCsv(records) {
  if (!Array.isArray(records)) throw new Error('账单列表无法读取，暂时不能导出。')
  const rows = [['日期', '时间', '收支', '分类', '金额（元）', '备注']]
  for (const record of records) {
    if (!record || record.deletedAt || !['income', 'expense'].includes(record.type) ||
        typeof record.date !== 'string' || !validDate(record.date) ||
        (record.time != null && record.time !== '' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.time)) ||
        typeof record.category !== 'string' || !record.category) {
      throw new Error('账单字段无效，暂时不能导出；原账单已保留。')
    }
    rows.push([record.date, record.time || '', record.type === 'income' ? '收入' : '支出',
      record.category, centsText(parseCents(record.amount)), record.remark ?? ''])
  }
  // BOM lets common spreadsheet apps recognize Chinese UTF-8; CRLF is CSV's row separator.
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
