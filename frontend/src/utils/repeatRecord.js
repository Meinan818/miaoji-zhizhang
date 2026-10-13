import dayjs from 'dayjs'
import { validateRecord } from './ledger.js'
import { getLoginReturnPath } from './loginRedirect.js'

export function getRepeatReturnPath(value) {
  const safe = getLoginReturnPath(value)
  return /^\/bills(?:[?#]|$)/.test(safe) ? safe : '/bills'
}

// Only editable content is copied. Identity, versions and save operation keys belong to the new bill.
export function createRepeatRecord(record, now = dayjs()) {
  if (!record || record.deletedAt) throw new Error('原账单已不存在，请重新选择；尚未创建新账单。')
  return validateRecord({ type: record.type, amount: record.amount, category: record.category,
    remark: record.remark, date: now.format('YYYY-MM-DD'), time: now.format('HH:mm') })
}
