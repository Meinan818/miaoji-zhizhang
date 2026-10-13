import dayjs from 'dayjs'

export function formatCurrency(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return '¥0.00'
  }

  return `¥${number.toFixed(2)}`
}

export function formatRecordTime(date, time = '00:00') {
  const recordTime = dayjs(`${date}T${time}`)
  const today = dayjs().startOf('day')

  if (!recordTime.isValid()) {
    return time
  }

  if (recordTime.isSame(today, 'day')) {
    return `今天 ${recordTime.format('HH:mm')}`
  }

  if (recordTime.isSame(today.subtract(1, 'day'), 'day')) {
    return `昨天 ${recordTime.format('HH:mm')}`
  }

  return recordTime.format('M月D日 HH:mm')
}
