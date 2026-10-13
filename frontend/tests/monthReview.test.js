import test from 'node:test'
import assert from 'node:assert/strict'
import { getMonthReview, formatMonthReviewReply, isMonthReviewQuery } from '../src/utils/monthReview.js'
import { getMonthQueryReply } from '../src/utils/chatQuery.js'
import { isQuery, createDraft, applyDraftInput } from '../src/utils/draftEngine.js'
const bill = (extra = {}) => ({ id: 'r', type: 'expense', amount: .1, category: '餐饮', date: '2026-10-03', time: '12:00', ...extra })
test('复盘同源整数分/删除排除/完整月份，原文不改', () => {
  const rows = [bill(), bill({amount:.2}), bill({amount:7,date:'2026-10-25'}), bill({amount:100,deletedAt:'deleted'}), bill({type:'income',category:'工资',amount:20})]
  const raw = JSON.stringify(rows), r = getMonthReview(rows,'2026-10')
  assert.equal(r.current.expenseCents,730); assert.equal(r.current.balanceCents,1270); assert.equal(r.activeDays,2)
  assert.equal(r.peak.date,'2026-10-25'); assert.equal(r.peak.expenseCents,700); assert.equal(JSON.stringify(rows),raw)
})
test('跨年上月与支出差额使用实际账单', () => {
  const r=getMonthReview([bill({amount:10,date:'2026-01-02'}),bill({amount:20,date:'2025-12-02'})],'2026-01')
  assert.equal(r.previousMonth,'2025-12');assert.equal(r.expenseDeltaCents,-1000)
})
test('闰年月份包含29天，非闰年28天', () => {
  assert.equal(getMonthReview([],'2024-02').days.length,29);assert.equal(getMonthReview([],'2025-02').days.length,28)
})
test('无上月基数不虚构百分比，无支出不虚构峰值', () => {
  const r=getMonthReview([bill({type:'income',amount:3})],'2026-10')
  assert.equal(r.peak,null);assert.equal(r.previous.recordCount,0);assert.match(formatMonthReviewReply(r),/不作环比百分比/)
})
test('上月坏金额只明确对照不可用，不覆盖本月事实或显示假零', () => {
  const r=getMonthReview([bill({amount:12}),bill({amount:'bad',date:'2026-09-01'})],'2026-10')
  assert.equal(r.current.expenseCents,1200);assert.equal(r.previous,null);assert.equal(r.expenseDeltaCents,null);assert.match(r.comparisonError,/无法准确/)
})
test('本月坏数据或坏月份明确失败', () => {
  assert.throws(()=>getMonthReview([bill({amount:'bad'})],'2026-10'));assert.throws(()=>getMonthReview([],'2026-13'));assert.throws(()=>getMonthReview(null,'2026-10'))
})
test('同额峰值固定选择最早日期', () => {
  const r=getMonthReview([bill({amount:1,date:'2026-10-08'}),bill({amount:1,date:'2026-10-01'})],'2026-10')
  assert.equal(r.peak.date,'2026-10-01')
})
test('最早支持年不会伪造不支持的上月', () => {
  const r=getMonthReview([],'1000-01');assert.equal(r.previous,null);assert.equal(r.days.length,31)
})
test('复盘作为查询，允许标点，但商品名称含复盘不被查询吞掉', () => {
  for(const s of ['本月复盘','帮我复盘本月？','查看本月复盘']) {assert(isQuery(s));assert(isMonthReviewQuery(s))}
  assert.equal(isMonthReviewQuery('买月报书20元'),false);assert.equal(isQuery('买复盘笔记20元'),false)
})
test('待补金额时复盘不修改草稿或入账', () => {
  const {group}=createDraft('买咖啡');const raw=JSON.stringify(group);const result=applyDraftInput(group,'本月复盘')
  assert.equal(result.action,'query');assert.equal(JSON.stringify(result.group),raw)
})
test('聊天复盘明确月份/预测边界，不把账本事实称为演示，读取新账单值', () => {
  const rows=[bill({amount:12}),bill({amount:20,date:'2026-09-02'})]
  const text=getMonthQueryReply('本月复盘',rows,'2026-10');assert.match(text,/按完整业务月份统计/);assert.doesNotMatch(text,/规则演示/);assert.match(text,/支出 ¥12.00/);assert.match(text,/少 ¥8.00/);assert.match(text,/不是AI预测/)
  rows[0].amount=9;assert.match(getMonthQueryReply('本月复盘',rows,'2026-10'),/支出 ¥9.00/)
})
