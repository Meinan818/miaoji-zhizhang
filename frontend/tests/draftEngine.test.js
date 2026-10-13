import test from 'node:test'
import assert from 'node:assert/strict'
import { createDraft, applyDraftInput, isQuery } from '../src/utils/draftEngine.js'
let id = 0
const options = { date: '2026-10-02', time: '12:00', makeId: p => p + '-' + ++id }
const draft = text => createDraft(text, options)
const send = (g, text) => applyDraftInput(g, text, options)

test('待选编号仅接受单一选择，新明确纠正使用新金额且保留其他笔', () => {
  const original = draft('午饭25，咖啡18').group
  const pending = send(original, '那笔改成15').group
  const complex = send(pending, '第2笔，同时午饭是昨天的')
  assert.deepEqual(complex.group, pending)
  const changed = send(pending, '第2笔改成17').group
  assert.deepEqual(changed.items.map(item => item.amountCents), [2500, 1700])
  assert.equal(changed.status, 'ready')
  const selected = send(pending, '就是第2笔。').group
  assert.deepEqual(selected.items.map(item => item.amountCents), [2500, 1500])
  assert.equal(pending.pending.patch.amountCents, 1500)
})

test('一句话创建两笔，纠正仅更新对应金额与原编号', () => {
  const g = draft('今天吃面25，买咖啡18').group
  assert.equal(g.status, 'ready'); assert.equal(g.items.length, 2)
  assert.deepEqual(g.items.map(i => i.amountCents), [2500, 1800])
  assert.deepEqual(g.items.map(i => i.category), ['餐饮', '餐饮'])
  const result = send(g, '咖啡改成16')
  assert.deepEqual(result.group.items.map(i => i.amountCents), [2500, 1600])
  assert.deepEqual(result.group.items.map(i => i.id), g.items.map(i => i.id))
  assert.match(result.reply, /41\.00/); assert.equal(g.items[1].amountCents, 1800); assert.equal(result.group.items[1].remark, '咖啡')
})
test('缺金额不能确认，18补原草稿，刷新JSON后也能补', () => {
  const g = draft('午饭25，咖啡还没写价格').group
  assert.equal(g.status, 'needs_input'); assert.equal(send(g, '确认').action, undefined)
  assert.match(createDraft('午饭25，咖啡还没写价格', options).reply, /咖啡多少钱/)
  const filled = send(JSON.parse(JSON.stringify(g)), '18').group
  assert.equal(filled.items.length, 2); assert.equal(filled.items[1].amountCents, 1800); assert.equal(filled.status, 'ready')
})
test('多个缺金额逐项补充且不新增条目', () => {
  let g = draft('午饭，咖啡').group
  g = send(g, '25').group; assert.equal(g.status, 'needs_input')
  g = send(g, '18').group; assert.equal(g.status, 'ready'); assert.equal(g.items.length, 2)
})
test('同名咖啡先选择目标，选第二笔只改第二笔', () => {
  const g = draft('两杯咖啡分别18和20').group
  assert.equal(g.items.length, 2)
  const ambiguous = send(g, '咖啡改成16').group
  assert.equal(ambiguous.pending.kind, 'target'); assert.equal(ambiguous.status, 'needs_input')
  assert.deepEqual(ambiguous.items.map(i => i.amountCents), [1800, 2000])
  const selected = send(ambiguous, '第二笔').group
  assert.deepEqual(selected.items.map(i => i.amountCents), [1800, 1600]); assert.equal(selected.status, 'ready')
})
test('昨天日期只减一天，多笔继承日期但可独立覆盖', () => {
  const g = draft('昨天午饭25，咖啡18，今天地铁3').group
  assert.deepEqual(g.items.map(i => i.date), ['2026-10-01', '2026-10-01', '2026-10-02'])
  assert.equal(send(g, '第2笔是昨天的').group.items[1].date, '2026-10-01')
})
test('跨日补金额不改变原业务日期', () => {
  const g = draft('咖啡').group
  const r = applyDraftInput(g, '18', { ...options, date: '2026-10-03' }).group
  assert.equal(r.items[0].date, '2026-10-02')
})
test('合法千分位完整解析，不把日期和时间当金额', () => {
  const g = draft('2026-10-02 下午3点30买衣服1,200.50元').group
  assert.equal(g.items[0].amountCents, 120050); assert.equal(g.items[0].time, '15:30')
  assert.equal(draft('2026-10-02 下午3点30买咖啡').group.items[0].amountCents, null)
})
test('无效金额不截断或取绝对值，0/负数/三位小数均待补充', () => {
  for (const n of ['0', '-20', '1.239']) assert.equal(draft('咖啡' + n + '元').group.status, 'needs_input')
  assert.equal(draft('买衣服1,20元').group, undefined)
})
test('合法小数按分保存', () => { assert.equal(draft('咖啡0.10元').group.items[0].amountCents, 10) })
test('超五笔不静默截断，一组最多五笔', () => {
  assert.equal(draft('咖啡1，午饭2，地铁3，早餐4，晚餐5').group.items.length, 5)
  assert.equal(draft('咖啡1，午饭2，地铁3，早餐4，晚餐5，奶茶6').group, undefined)
  const g = draft('咖啡1，午饭2，地铁3，早餐4，晚餐5').group
  assert.equal(send(g, '再加一笔奶茶6').group.items.length, 5)
})
test('明确追加加入当前组，保留原编号，普通新消费不自动覆盖', () => {
  const g = draft('咖啡18').group
  const added = send(g, '再加一笔地铁3元').group
  assert.equal(added.items.length, 2); assert.equal(added.items[0].id, g.items[0].id)
  assert.deepEqual(send(g, '午饭25').group, g)
})
test('查询不创建草稿，含统计词的消费不是查询', () => {
  assert(isQuery('本月支出多少')); assert(!isQuery('今天买统计书30元'))
  assert.equal(draft('今天买统计书30元').group.items[0].amountCents, 3000)
  const g = draft('咖啡').group; const result = send(g, '本月支出多少')
  assert.equal(result.action, 'query'); assert.deepEqual(result.group, g)
})
test('红包收入/支出区别明确，单写红包追问方向', () => {
  assert.equal(draft('收到红包100元').group.items[0].type, 'income')
  assert.equal(draft('发红包100元').group.items[0].type, 'expense')
  const g = draft('红包100元').group; assert.equal(g.pending.kind, 'type')
  assert.equal(send(g, '支出').group.items[0].type, 'expense')
})
test('混合收支分别保留，确认数量不匹配时不保存', () => {
  const g = draft('收到工资8000，买衣服200').group
  assert.deepEqual(g.items.map(i => i.type), ['income', 'expense'])
  assert.equal(send(g, '确认记下1笔').action, undefined)
  assert.equal(send(g, '确认记下2笔').action, 'confirm')
})
test('无效日期与模糊日期追问，不自动校正', () => {
  for (const text of ['2026-02-30咖啡18', '上周咖啡18']) assert.equal(draft(text).group.pending.kind, 'date')
  const g = send(draft('上周咖啡18').group, '2026-09-30').group
  assert.equal(g.status, 'ready'); assert.equal(g.items[0].date, '2026-09-30')
})
test('普通闲聊/计划消费不创建账单，取消后补充不复活', () => {
  assert.equal(draft('你好').group, undefined); assert.equal(draft('打算买咖啡18').group, undefined)
  const g = send(draft('咖啡18').group, '取消这组').group
  assert.equal(g.status, 'cancelled'); assert.equal(send(g, '改成16').group.status, 'cancelled')
})
test('缺金额时不会把另一个新消费误补成当前金额', () => {
  const g = draft('咖啡').group
  assert.equal(send(g, '午饭25').group.items[0].amountCents, null)
})
test('未找到的纠正目标不擅自修改唯一草稿', () => {
  const g = draft('咖啡18').group
  assert.deepEqual(send(g, '面包改成16').group, g)
})
test('编号补金额尊重指定条目，而不是默认第一笔', () => {
  const g = draft('午饭，咖啡').group
  const filled = send(g, '第2笔18').group
  assert.equal(filled.items[0].amountCents, null); assert.equal(filled.items[1].amountCents, 1800)
})
test('金额与日期同时明确纠正时不忽略其中一项', () => {
  const g = send(draft('咖啡18').group, '咖啡改成16元，昨天的').group
  assert.equal(g.items[0].amountCents, 1600); assert.equal(g.items[0].date, '2026-10-01')
})
test('没有活动草稿时纠正不会被误建成新账单', () => {
  assert.equal(draft('咖啡改成16').group, undefined)
})

test('总支出/本月总支出等汇总短句是查询，不生成记账草稿', () => {
  for (const text of ['总支出','本月总支出','总收入','本月总收入','总支出是多少','总支出是多少钱','支出总共多少','收入总额','本月的总支出','这个月总开销','帮我看看本月总支出']) {
    assert.equal(isQuery(text), true, text); assert.equal(draft(text).group, undefined, text)
  }
})
test('存在待补充草稿时询问总支出只查询，不改金额或追问上下文', () => {
  const g = draft('咖啡').group
  for (const text of ['总支出','本月总支出','总收入是多少']) {
    const result = send(g,text); assert.equal(result.action,'query',text); assert.deepEqual(result.group,g)
  }
})
test('商品名带统计/总支出字样的真实消费仍创建草稿', () => {
  for (const text of ['今天买统计书30元','买总支出统计书30元','买总收入手账25','吃午饭25元','今天支出20元']) {
    assert.equal(isQuery(text),false,text); assert(draft(text).group,text)
  }
})
test('明确历史范围的总支出先走查询，不生成草稿', () => {
  for (const text of ['全部总支出','历史总支出','累计支出','今天总支出','上个月总支出']) {
    assert.equal(isQuery(text),true,text); assert.equal(draft(text).group,undefined,text)
  }
})
test('汇总金额陈述不作为实际消费入账，分类汇总短句仍为查询', () => {
  for (const text of ['本月总支出20元','总支出是20元吗','本月餐饮总支出','餐饮总支出是多少','工资总收入']) {
    assert.equal(isQuery(text),true,text); assert.equal(draft(text).group,undefined,text)
  }
})
test('组合查询范围仍识别为查询，书名/商品中的范围词不变成查询', () => {
  for (const text of ['全部历史总支出', '所有历史总收入', '查询全部历史总支出', '今年全年总支出', '全部历史的总收入']) {
    assert.equal(isQuery(text), true, text)
  }
  for (const text of ['买历史书25元', '今天买全部历史书25元', '本月历史课花了20元']) assert.equal(isQuery(text), false, text)
})
