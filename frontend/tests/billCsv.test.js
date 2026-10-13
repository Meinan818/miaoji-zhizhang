import test from 'node:test'
import assert from 'node:assert/strict'
import { createBillCsv } from '../src/utils/billCsv.js'
import { downloadCsv } from '../src/utils/download.js'

const bill = { date: '2026-10-04', type: 'expense', category: '餐饮', amount: '0.29', remark: '合成备注' }

test('CSV中文BOM、CRLF、未知时间留空，逗号/引号/换行完整转义，金额两位小数', () => {
  const records = [{ ...bill, remark: '午饭, "咖啡"\n第二行' }, { ...bill, type: 'income', time: '09:30', amount: '999999999.99' }]
  const before = JSON.stringify(records), csv = createBillCsv(records)
  assert.equal(csv, '\uFEFF"日期","时间","收支","分类","金额（元）","备注"\r\n' +
    '"2026-10-04","","支出","餐饮","0.29","午饭, ""咖啡""\n第二行"\r\n' +
    '"2026-10-04","09:30","收入","餐饮","999999999.99","合成备注"\r\n')
  assert.equal(JSON.stringify(records), before)
})

test('CSV文本字段防止表格公式，包含前置空白/控制符/换行与全角符号', () => {
  for (const text of ['=1+1', '+cmd', '-10', '@SUM(A1)', ' \t=1', '\u0000+1', '\n普通文本', '＝1']) {
    const csv = createBillCsv([{ ...bill, category: text, remark: text }])
    assert(csv.includes('"\'' + text + '"'), JSON.stringify(text))
    assert(csv.includes('"0.29"'))
  }
  assert(createBillCsv([{ ...bill, remark: '普通备注' }]).includes('"普通备注"'))
})

test('CSV拒绝无效/已删除字段和非安全金额，不导出伪造零值或四舍五入结果', () => {
  assert.throws(() => createBillCsv(null), /无法读取/)
  for (const change of [{ deletedAt: 'synthetic' }, { date: '2026-02-30' }, { type: 'other' }, { time: '24:00' }, { category: '' },
    { amount: '0' }, { amount: '0.291' }, { amount: '1000000000' }, { amount: NaN }, { amount: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => createBillCsv([{ ...bill, ...change }]))
  }
  assert.equal(createBillCsv([]).split('\r\n').length, 2)
})

function downloadEnvironment(fail = false) {
  const state = { revoked: 0, removed: 0, clicked: 0 }
  state.anchor = { click() { if (fail) throw Error('合成下载失败'); state.clicked++ }, remove() { state.removed++ } }
  state.environment = { URL: { createObjectURL(blob) { state.blob = blob; return 'blob:synthetic' }, revokeObjectURL() { state.revoked++ } },
    document: { createElement: () => state.anchor, body: { appendChild() {} } }, setTimeout(fn) { state.timer = fn } }
  return state
}

test('CSV下载使用UTF-8字节BOM及CSV MIME，发起点击后释放链接与URL', async () => {
  const state = downloadEnvironment(), csv = createBillCsv([bill])
  downloadCsv(csv, 'bills.csv', state.environment)
  assert.equal(state.blob.type, 'text/csv;charset=utf-8')
  const bytes = new Uint8Array(await state.blob.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191])
  assert.equal(new TextDecoder().decode(bytes), csv.slice(1))
  assert.equal(state.anchor.download, 'bills.csv'); assert.equal(state.anchor.href, 'blob:synthetic')
  assert.equal(state.clicked, 1); assert.equal(state.removed, 1); assert.equal(state.revoked, 0)
  state.timer(); assert.equal(state.revoked, 1)
})

test('CSV下载点击失败释放URL且抛错，不保留定时任务', () => {
  const state = downloadEnvironment(true)
  assert.throws(() => downloadCsv('synthetic', 'bills.csv', state.environment), /合成下载失败/)
  assert.equal(state.revoked, 1); assert.equal(state.removed, 1); assert.equal(state.timer, undefined)
})
