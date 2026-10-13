import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCents, centsText, sumAmounts } from '../src/utils/money.js'
import { prepareBatch, prepareUpdate, prepareDelete, validateRecord, validDate } from '../src/utils/ledger.js'
const item = (extra = {}) => ({ id: 'a', type: 'expense', amount: '25.50', category: '餐饮', date: '2026-10-02', time: '12:00', remark: '午饭', ...extra })
test('金额严格校验及整数分汇总', () => {
  assert.equal(parseCents('1,234.56'), 123456); assert.equal(centsText(41), '0.41'); assert.equal(centsText(-41), '-0.41')
  for (const n of ['', '-1', '0', '1.005', '1e3', '1,23', 'NaN', '1000000000']) assert.throws(() => parseCents(n))
  assert.equal(sumAmounts([{ type: 'expense', amount: .1 }, { type: 'expense', amount: .2 }], 'expense'), .3)
})
test('日期与时间分类一致性校验', () => {
  assert(validDate('2024-02-29')); assert(!validDate('2026-02-29')); assert(!validDate('2026-04-31'))
  assert.throws(() => validateRecord(item({ time: '24:00' }))); assert.throws(() => validateRecord(item({ category: '工资' })))
})
test('批量保存全部先校验，不会仅写入第一笔', () => {
  const old = [item({ id: 'kept' })]
  assert.throws(() => prepareBatch(old, [item(), item({ id: 'b', amount: '-5' })], { batchId: 'batch' }))
  assert.equal(old.length, 1)
})
test('稳定标识重复提交和重新载入不会重复入账', () => {
  const inputs = [item(), item({ id: 'b', amount: '16' })]
  const first = prepareBatch([], inputs, { batchId: 'batch', source: 'chat' })
  assert.equal(first.records.length, 2); assert.equal(first.saved[0].source, 'chat')
  const reloaded = JSON.parse(JSON.stringify(first.records))
  const second = prepareBatch(reloaded, inputs, { batchId: 'batch' })
  assert.equal(second.added, false); assert.equal(second.records.length, 2)
})
test('直接修改不改变ID与草稿防重元数据，之后重复确认仍返回已改数据', () => {
  const inputs = [item()]
  const first = prepareBatch([], inputs, { batchId: 'batch', source: 'chat' }).records
  const changed = prepareUpdate(first, first[0].id, item({ id: 'tampered', amount: '16', date: '2026-09-30', type: 'income', category: '退款' }))
  assert.equal(changed.updated.id, first[0].id); assert.equal(changed.updated.draftGroupId, 'batch'); assert.equal(changed.updated.draftItemId, 'a')
  assert.equal(changed.updated.amount, 16); assert.equal(changed.updated.category, '退款')
  const repeat = prepareBatch(changed.records, inputs, { batchId: 'batch' })
  assert.equal(repeat.saved[0].amount, 16); assert.equal(repeat.records.length, 1)
})
test('不存在账单、部分重复组和重复条目编号均阻止误写', () => {
  assert.throws(() => prepareUpdate([], 'missing', item()))
  assert.throws(() => prepareBatch([], [item(), item()], { batchId: 'batch' }))
  const saved = prepareBatch([], [item()], { batchId: 'batch' }).records
  assert.throws(() => prepareBatch(saved, [item(), item({ id: 'b' })], { batchId: 'batch' }))
})

test('单笔删除只标记目标，保留来源/草稿标识和其他账单', () => {
  const original = prepareBatch([], [item(), item({ id: 'b', amount: '16' })], { batchId: 'batch', source: 'chat' }).records
  const timestamp = '2026-10-03T12:00:00.000Z'
  const result = prepareDelete(original, original[0].id, timestamp)
  assert.equal(result.deleted, true); assert.equal(result.updated.deletedAt, timestamp)
  assert.equal(result.updated.updatedAt, timestamp); assert.equal(result.updated.id, original[0].id)
  assert.equal(result.updated.draftGroupId, 'batch'); assert.equal(result.updated.draftItemId, 'a')
  assert.equal(result.updated.source, 'chat'); assert.deepEqual(result.records[1], original[1])
  assert.equal(original[0].deletedAt, undefined)
})
test('重复删除不改原删除时间，不存在目标明确失败', () => {
  const old = prepareBatch([], [item()], { batchId: 'batch' }).records
  const first = prepareDelete(old, old[0].id, '2026-10-03T12:00:00.000Z')
  const again = prepareDelete(first.records, old[0].id, '2026-10-04T12:00:00.000Z')
  assert.equal(again.deleted, false); assert.equal(again.updated.deletedAt, first.updated.deletedAt)
  assert.throws(() => prepareDelete(old, 'missing'), /不存在/)
})
test('已删除账单不能通过旧编辑恢复', () => {
  const old = prepareBatch([], [item()], { batchId: 'batch' }).records
  const removed = prepareDelete(old, old[0].id).records
  assert.throws(() => prepareUpdate(removed, old[0].id, item({ amount: '99' })), /已删除/)
})
test('部分删除后重复整组确认保留删除事实，不重复生成账单', () => {
  const inputs = [item(), item({ id: 'b' })]
  const old = prepareBatch([], inputs, { batchId: 'batch' }).records
  const removed = prepareDelete(old, old[0].id).records
  const repeat = prepareBatch(removed, inputs, { batchId: 'batch' })
  assert.equal(repeat.added, false); assert.equal(repeat.saved.length, 2)
  assert.equal(repeat.saved.filter(r => r.deletedAt).length, 1); assert.deepEqual(repeat.records, removed)
})
test('整组全部删除后重新载入再确认也不能恢复', () => {
  const old = prepareBatch([], [item()], { batchId: 'batch' }).records
  const removed = JSON.parse(JSON.stringify(prepareDelete(old, old[0].id).records))
  const repeat = prepareBatch(removed, [item()], { batchId: 'batch' })
  assert.equal(repeat.added, false); assert.equal(repeat.records.length, 1); assert(repeat.saved[0].deletedAt)
})
