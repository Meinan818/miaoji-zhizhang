// All new amounts are validated and calculated in integer cents.
export const MAX_CENTS = 99_999_999_999

export function parseCents(value) {
  const text = String(value ?? '').trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('金额请填写大于0的数字，最多两位小数；千分位格式如1,200.50')
  }
  const [whole, fraction = ''] = text.replaceAll(',', '').split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) {
    throw new Error('金额须大于0且不超过999,999,999.99元')
  }
  return cents
}

export function centsText(cents) {
  if (!Number.isSafeInteger(cents)) throw new Error('金额计算无效')
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return sign + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0')
}

export function legacyCents(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function sumCents(records, type) {
  if (!Array.isArray(records)) throw new Error('账单列表无法读取，暂时无法显示准确汇总。')
  let total = 0
  for (const record of records) {
    if (!record || !['income', 'expense'].includes(record.type)) throw new Error('账单收支类型无效，暂时无法显示准确汇总。')
    if (type && record.type !== type) continue
    const amount = legacyCents(record.amount)
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_CENTS) throw new Error('账单金额无效，暂时无法显示准确汇总。')
    const next = total + amount
    if (!Number.isSafeInteger(next)) throw new Error('金额汇总超出安全范围，暂时无法显示准确金额；原账单已保留。')
    total = next
  }
  return total
}

export function sumAmounts(records, type) {
  return sumCents(records, type) / 100
}

// A failed summary must not replace actual bills or render a fabricated zero.
export function getRecordTotals(records) {
  try {
    const incomeCents = sumCents(records, 'income'), expenseCents = sumCents(records, 'expense')
    const balanceCents = incomeCents - expenseCents
    return { incomeCents, expenseCents, balanceCents, income: incomeCents / 100, expense: expenseCents / 100, error: '' }
  } catch (failure) {
    return { incomeCents: null, expenseCents: null, balanceCents: null, income: null, expense: null, error: failure.message }
  }
}
