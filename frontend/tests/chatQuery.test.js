import test from 'node:test'
import assert from 'node:assert/strict'
import { getMonthQueryReply } from '../src/utils/chatQuery.js'
const record = (overrides = {}) => ({ id: 'r', type: 'expense', amount: .1, category: '餐饮', date: '2026-10-03', ...overrides })
test('聊天查询复用统计整数分，不计已删除或其他月份', () => {
  const records = [record(), record({ amount: .2 }), record({ amount: 50, deletedAt: '2026-10-03T00:00:00Z' }), record({ amount: 40, date: '2026-09-03' })]
  assert.equal(getMonthQueryReply('查询本月支出', records, '2026-10'), '本月支出合计 ¥0.30。')
  assert.equal(getMonthQueryReply('本月餐饮花了多少', records, '2026-10'), '本月餐饮共花了 ¥0.30。')
})
test('收入分类/总收入与无账单查询使用实际账本', () => {
  const records = [record({ type: 'income', category: '工资', amount: 100 }), record({ amount: 20 })]
  assert.equal(getMonthQueryReply('本月工资收入多少', records, '2026-10'), '本月工资收入合计 ¥100.00。')
  assert.equal(getMonthQueryReply('查询本月收入', records, '2026-10'), '本月收入合计 ¥100.00。')
  assert.equal(getMonthQueryReply('查询本月交通支出', records, '2026-10'), '本月交通共花了 ¥0.00。')
  assert.equal(getMonthQueryReply('查询本月支出', [], '2026-10'), '本月支出合计 ¥0.00。')
})
test('其他日期范围明确不拿本月冒充', () => {
  for (const text of ['查询昨天支出','查询今天支出','查询上个月支出','查询2026-09支出','查询9月支出','查询今年收入','查询明天支出','查询这周支出','查询上月支出','今年全年总支出','全年总收入']) {
    assert.match(getMonthQueryReply(text, null, '2026-10'), /不会拿本月数据冒充/)
  }
})
test('损坏账单或超安全范围不显示假零结果', () => {
  assert.throws(() => getMonthQueryReply('查询本月支出', [record({ amount: 'bad' })], '2026-10'), /金额/)
  const records = Array.from({ length: 100000 }, () => record({ amount: 999999999.99 }))
  assert.throws(() => getMonthQueryReply('查询本月支出', records, '2026-10'), /安全范围/)
})
test('查询不改账本或历史文本，既有未来业务日期仍计入所属月', () => {
  const records = [record({ amount: 12, date: '2026-10-25' })], original = JSON.stringify(records)
  assert.match(getMonthQueryReply('查询本月支出', records, '2026-10'), /12.00/)
  assert.equal(JSON.stringify(records), original)
})

test('未指定月份的总支出查询明确只查本月，不冒充全部历史总额', () => {
  const reply = getMonthQueryReply('总支出', [record({amount:12}),record({amount:100,date:'2026-09-01'})], '2026-10')
  assert.match(reply,/只支持本月/); assert.match(reply,/不是全部历史总额/); assert.match(reply,/本月支出合计 ¥12\.00/)
})
test('明确全部/历史/累计范围的总额暂不支持，不能返回本月冒充', () => {
  for (const text of ['全部总支出','历史总支出','累计支出']) {
    assert.match(getMonthQueryReply(text,null,'2026-10'),/全部历史/)
  }
})
test('明确本月的总支出/总收入按账本回答，不额外要求金额', () => {
  assert.equal(getMonthQueryReply('本月总支出',[record({amount:12})],'2026-10'),'本月支出合计 ¥12.00。')
  assert.equal(getMonthQueryReply('本月总收入',[record({type:'income',amount:20,category:'工资'})],'2026-10'),'本月收入合计 ¥20.00。')
})
