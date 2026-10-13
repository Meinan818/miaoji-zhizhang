import test from 'node:test'
import assert from 'node:assert/strict'
import { getMonthStatistics, isValidMonth } from '../src/utils/statistics.js'
const record = extra => ({ id: 'record', type: 'expense', amount: 25, category: '餐饮', date: '2026-10-03', time: '12:00', ...extra })
test('月收支/结余与有效笔数按同一账本汇总', () => {
  const s = getMonthStatistics([record({}), record({ id: 'coffee', amount: 16 }), record({ id: 'salary', type: 'income', category: '工资', amount: 100 })], '2026-10')
  assert.equal(s.expenseCents, 4100); assert.equal(s.incomeCents, 10000); assert.equal(s.balanceCents, 5900)
  assert.equal(s.recordCount, 3); assert.equal(s.expenseCount, 2); assert.equal(s.incomeCount, 1)
  assert.equal(s.categories.expense[0].amountCents, 4100); assert.equal(s.categories.expense[0].count, 2)
})
test('只取业务日期对应月份，排除其他月和删除标记但不排除未来日期', () => {
  const s = getMonthStatistics([record({}), record({ date: '2026-09-30', amount: 9 }), record({ date: '2026-11-01', amount: 10 }), record({ deletedAt: '2026-10-03T12:00:00.000Z', amount: 11 }), record({ date: '2026-10-28', amount: 12 })], '2026-10')
  assert.equal(s.recordCount, 2); assert.equal(s.expenseCents, 3700)
})
test('0.1加0.2按整数分为30分，结余允许负数', () => {
  const s = getMonthStatistics([record({ amount: .1 }), record({ amount: .2 })], '2026-10')
  assert.equal(s.expenseCents, 30); assert.equal(s.balanceCents, -30)
})
test('分类按金额降序，同额有稳定次序，不修改输入数组', () => {
  const input = [record({ category: 'B', amount: 20 }), record({ category: 'A', amount: 20 }), record({ category: 'C', amount: 30 })]
  const before = JSON.stringify(input); const s = getMonthStatistics(input, '2026-10')
  assert.deepEqual(s.categories.expense.map(c => c.category), ['C', 'A', 'B']); assert.equal(JSON.stringify(input), before)
})
test('分类占比以该收支类型总额为分母，与收入金额无关', () => {
  const s = getMonthStatistics([record({ category: 'A', amount: 1 }), record({ category: 'B', amount: 2 }), record({ type: 'income', category: '工资', amount: 100 })], '2026-10')
  assert.equal(s.categories.expense.find(c => c.category === 'A').percent, 33.3)
  assert.equal(s.categories.expense.find(c => c.category === 'B').percent, 66.7)
  assert.equal(s.categories.income[0].percent, 100)
})
test('空月份返回零和空分类，不产生NaN/虚构分类', () => {
  const s = getMonthStatistics([record({})], '2026-09')
  assert.equal(s.recordCount, 0); assert.equal(s.incomeCents, 0); assert.equal(s.expenseCents, 0); assert.equal(s.balanceCents, 0)
  assert.deepEqual(s.categories, { expense: [], income: [] })
})
test('仅收入时支出分类为空，收入分类仍有金额和占比', () => {
  const s = getMonthStatistics([record({ type: 'income', category: '工资', amount: '200.50' })], '2026-10')
  assert.equal(s.incomeCents, 20050); assert.deepEqual(s.categories.expense, []); assert.equal(s.categories.income[0].percent, 100)
})
test('旧分类名和原型同名字段可统计，不污染对象', () => {
  const s = getMonthStatistics([record({ category: '__proto__', amount: 1 }), record({ category: 'constructor', amount: 2 })], '2026-10')
  assert.equal(s.categories.expense.length, 2); assert.equal(s.expenseCents, 300)
})
test('月份格式/范围错误明确拒绝', () => {
  for (const month of ['2026-13','2026-00','2026-1','0000-01','abc',null]) { assert.equal(isValidMonth(month), false); assert.throws(() => getMonthStatistics([], month), /月份/) }
  assert(isValidMonth('1000-01')); assert(isValidMonth('9999-12'))
})
test('金额/类型损坏时不能用假零掩盖错误', () => {
  for (const amount of ['NaN',0,-1,Infinity]) assert.throws(() => getMonthStatistics([record({ amount })], '2026-10'), /金额/)
  assert.throws(() => getMonthStatistics([record({ type: 'unknown' })], '2026-10'), /收支类型/)
  assert.throws(() => getMonthStatistics(null, '2026-10'), /账单数据/)
})
test('超出安全整数汇总范围时明确失败，不显示错误金额', () => {
  const many = Array.from({ length: 100000 }, (_, id) => record({ id: String(id), amount: 999999999.99 }))
  assert.throws(() => getMonthStatistics(many, '2026-10'), /安全范围/)
})
