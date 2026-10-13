import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKUP_FORMAT, buildBackupFile, inspectBackupText, mergeBackupRecords } from '../src/utils/ledgerBackup.js'

const uuid = n => `9abf606b-a0d5-4053-98fb-${String(n).padStart(12, '0')}`
const row = extra => ({ id: uuid(1), version: 0, type: 'expense', amount: '25.00', date: '2026-10-03', time: '12:30',
  category: '餐饮', note: '午饭', deletedAt: null, createdAt: null, updatedAt: null, ...extra })

test('演示账本导出生成可校验、可回读的标准备份文件', () => {
  const file = buildBackupFile([
    { id: uuid(1), type: 'expense', amount: 25, date: '2026-10-03', time: '12:30', category: '餐饮', remark: '午饭' },
    { id: uuid(2), type: 'income', amount: 0.29, date: '2026-10-04', category: '工资', remark: '咖啡', deletedAt: '2026-10-05T01:02:03.000Z' },
  ], new Date('2026-10-12T05:00:00.000Z'))
  assert.equal(file.format, BACKUP_FORMAT); assert.equal(file.formatVersion, 1)
  assert.equal(file.recordCount, 2); assert.equal(file.exportedAt, '2026-10-12T05:00:00.000Z')
  assert.equal(file.records[0].amount, '25.00'); assert.equal(file.records[0].time, '12:30'); assert.equal(file.records[0].note, '午饭')
  assert.equal(file.records[0].deletedAt, null); assert.equal(file.records[0].createdAt, null)
  assert.equal(file.records[1].amount, '0.29'); assert.equal(file.records[1].time, null)
  assert.equal(file.records[1].deletedAt, '2026-10-05T01:02:03.000Z')
  const inspected = inspectBackupText(JSON.stringify(file))
  assert.equal(inspected.error, undefined)
  assert.equal(inspected.summary.count, 2); assert.equal(inspected.summary.deleted, 1)
  assert.equal(inspected.summary.firstDate, '2026-10-03'); assert.equal(inspected.summary.lastDate, '2026-10-04')
})

test('备份校验拒绝各类不合法文件且不产出预览', () => {
  const cases = [
    ['不是 JSON', 'not json'],
    ['其他应用的 JSON', JSON.stringify({ hello: 1 })],
    ['格式版本不符', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 2, records: [row({})] })],
    ['空记录', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [] })],
    ['编号不合法', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ id: 'not-a-uuid' })] })],
    ['重复编号', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({}), row({ id: uuid(1) })] })],
    ['金额带千分位', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ amount: '1,000' })] })],
    ['金额为零', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ amount: '0' })] })],
    ['金额超过上限', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ amount: '1000000000.00' })] })],
    ['日期不合法', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ date: '2026-02-30' })] })],
    ['时间不合法', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ time: '24:00' })] })],
    ['分类与收支不匹配', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ type: 'income' })] })],
    ['备注超长', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ note: 'x'.repeat(201) })] })],
    ['版本号非法', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ version: -1 })] })],
    ['版本号非整数', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ version: 1.5 })] })],
    ['删除标记非法', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ deletedAt: '2026/10/05' })] })],
    ['删除标记无时区', JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({ deletedAt: '2026-10-05T01:00:00' })] })],
  ]
  for (const [label, text] of cases) {
    const result = inspectBackupText(text)
    assert.ok(result.error, label + ' 应被拒绝')
    assert.equal(result.file, undefined, label + ' 不应产出预览')
  }
  const limit = Array.from({ length: 5001 }, (_, index) => row({ id: uuid(index + 1) }))
  assert.ok(inspectBackupText(JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: limit })).error)
  assert.equal(inspectBackupText(JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, records: [row({})] })).error, undefined)
})

test('演示导入只追加新编号，跳过已存在并保留删除标记', () => {
  const existing = [{ id: uuid(1), type: 'expense', amount: 25, date: '2026-10-03', category: '餐饮', remark: '原账单' }]
  const result = mergeBackupRecords(existing, [
    row({ note: '重复编号不覆盖' }),
    { id: uuid(2), version: 0, type: 'income', amount: '100.00', date: '2026-10-04', time: '08:05', category: '工资', note: '恢复工资', deletedAt: null },
    { id: uuid(3), version: 2, type: 'expense', amount: '5.50', date: '2026-10-04', time: null, category: '交通', note: '已删除地铁', deletedAt: '2026-10-05T01:00:00.000Z' },
  ])
  assert.equal(result.imported, 2); assert.equal(result.skipped, 1)
  assert.equal(result.merged.length, 3)
  assert.equal(result.merged[0], existing[0])
  assert.deepEqual(result.merged[1], { id: uuid(2), type: 'income', amount: 100, date: '2026-10-04', time: '08:05', category: '工资', remark: '恢复工资' })
  assert.deepEqual(result.merged[2], { id: uuid(3), type: 'expense', amount: 5.5, date: '2026-10-04', category: '交通', remark: '已删除地铁', deletedAt: '2026-10-05T01:00:00.000Z' })
})
