// 使用实际Add模板和RecordForm初始化脚本验证Vue挂载时序；不代表浏览器GUI验收。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import dayjs from 'dayjs'
import { CATEGORY_OPTIONS } from '../src/utils/categories.js'
import { validateRecord, validDate } from '../src/utils/ledger.js'
import { useManualRecordSave } from '../src/utils/navigation.js'
import { createRepeatRecord, getRepeatReturnPath } from '../src/utils/repeatRecord.js'

function source(file) {
  const content = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
  return { script: content.split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, ''),
    template: content.split('<template>')[1].split('</template>')[0] }
}
function evaluate(script, bindings, returned) {
  return new Function(...Object.keys(bindings), script + ';return {' + returned + '}')(...Object.values(bindings))
}
function node(tag) { return { tag, children: [], props: {}, style: {}, parent: null, text: '' } }
const renderer = Vue.createRenderer({
  createElement: node, createText: text => ({ ...node('#text'), text }), createComment: text => ({ ...node('#comment'), text }),
  insert(child, parent, anchor = null) {
    if (child.parent) { const old = child.parent.children.indexOf(child); if (old >= 0) child.parent.children.splice(old, 1) }
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child)
  },
  remove(child) { const index = child.parent?.children.indexOf(child) ?? -1; if (index >= 0) child.parent.children.splice(index, 1); child.parent = null },
  setText: (child, text) => { child.text = text },
  setElementText: (child, text) => { child.text = text; child.children = [] },
  parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
  patchProp: (child, key, previous, value) => { child.props[key] = value },
})
const operation = { batchId: 'manual-original', record: { id: 'single', type: 'expense', amount: '0.29',
  date: '2026-10-03', time: '09:15', category: '餐饮', remark: '合成午饭' } }

function mount(pending = false, query = {}) {
  const instances = [], add = source('views/Add.vue'), formSource = source('components/record/RecordForm.vue')
  const auth = Vue.reactive({ user: { id: 'synthetic-owner' } }), navigations = []
  let finish
  const store = Vue.reactive({ records: [{ ...operation.record }], storageError: '', manualRecovery: { operations: pending ? [operation] : [], error: '' },
    cancelManualOperation: () => new Promise(done => { finish = () => { store.manualRecovery = { operations: [], error: '' }; done() } }),
    addRecord: async () => { throw Error('测试禁止自动入账') } })
  const RecordForm = { props: ['record', 'saving', 'error'], setup(props, context) {
    const values = evaluate(formSource.script, { computed: Vue.computed, ref: Vue.ref, nextTick: Vue.nextTick, onBeforeUnmount: Vue.onBeforeUnmount, watch: Vue.watch, dayjs, CATEGORY_OPTIONS, validateRecord,
      SERVER_MODE: true, defineProps: () => props, defineEmits: () => context.emit, defineExpose: context.expose }, 'form, save')
    instances.push(values)
    return () => Vue.h('form', { class: 'record-form' }, values.form.value.amount)
  } }
  const stub = { render: () => Vue.h('span') }
  const Add = { components: { RecordForm, NotebookBack: stub, RouterLink: stub }, setup() {
    return evaluate(add.script, { computed: Vue.computed, ref: Vue.ref, watch: Vue.watch, useAuthStore: () => auth,
      useRoute: () => ({ query }), createRepeatRecord, getRepeatReturnPath,
      useRouter: () => ({ push: async target => { navigations.push(target) } }),
      useRecordStore: () => store, createId: () => 'manual-new', validDate, SERVER_MODE: true, useManualRecordSave, miaoWriting: 'synthetic' },
    'store, router, returnPath, recovery, saving, error, savedRecord, save, cancelPending, restoredRecord, notice, repeatNotice, cancelling, ownerCurrent, miaoWriting, SERVER_MODE, manualForm: typeof manualForm === "undefined" ? null : manualForm')
  }, render: new Function('Vue', compile(add.template, { mode: 'function' }).code)(Vue) }
  Add.render._rc = true
  const root = node('root'), app = renderer.createApp(Add), view = app.mount(root)
  return { store, auth, navigations, view, root, instances, finish: () => finish(), dispose: () => app.unmount() }
}

test('复制收入/支出只保留四项内容，使用指定新日期时间且拒绝已删除和不合法内容', () => {
  for (const [type, category] of [['income', '工资'], ['expense', '餐饮']]) {
    const record = { ...operation.record, type, category, version: 3, draftGroupId: 'old', deletedAt: undefined }
    const copy = createRepeatRecord(record, dayjs('2026-11-01T00:02:00'))
    assert.equal(copy.date, '2026-11-01'); assert.equal(copy.time, '00:02')
    assert.equal(copy.type, type); assert.equal(copy.category, category); assert.equal(copy.amount, 0.29)
    for (const key of ['id', 'version', 'draftGroupId', 'deletedAt']) assert.equal(Object.hasOwn(copy, key), false)
    assert.throws(() => createRepeatRecord({ ...record, deletedAt: '2026-10-06' }))
    assert.throws(() => createRepeatRecord({ ...record, amount: '0' }))
  }
})

test('再记返回仅接受安全明细地址，外站/其他页/数组/控制字符回退普通明细', () => {
  const path = '/bills?month=2024-02&q=%E5%90%88%E6%88%90&type=income&category=%E5%B7%A5%E8%B5%84#receipt'
  assert.equal(getRepeatReturnPath(path), path)
  for (const value of [undefined, [path], '//evil.invalid/bills', 'https://evil.invalid/bills', '/login', '/bills-other', '/bills\\evil', '/bills\n', '/bills/%2e%2e/profile']) {
    assert.equal(getRepeatReturnPath(value), '/bills')
  }
  const query = Vue.reactive({ repeat: operation.record.id, returnTo: path }), state = mount(false, query)
  try {
    assert.equal(state.view.returnPath, path)
    query.returnTo = '/bills?month=2026-11'
    assert.equal(state.view.returnPath, path)
    assert.equal(state.navigations.length, 0)
  } finally { state.dispose() }
})

test('再记一笔仅预填新草稿，当前日期时间与原内容进入表单，不带旧ID且不自动保存', async () => {
  const query = Vue.reactive({ repeat: operation.record.id }), state = mount(false, query)
  try {
    const form = state.instances[0].form.value
    assert.equal(form.amount, '0.29'); assert.equal(form.remark, operation.record.remark)
    assert.equal(form.date, dayjs().format('YYYY-MM-DD'))
    assert.equal(form.time, dayjs().format('HH:mm'))
    assert.equal(state.view.restoredRecord.id, undefined)
    assert.equal(state.view.savedRecord, null); assert.equal(state.navigations.length, 0)
    assert.deepEqual(state.store.records[0], operation.record)
    form.amount = '12.34'
    state.store.records = []; query.repeat = 'another'
    await Vue.nextTick()
    assert.equal(form.amount, '12.34'); assert.equal(state.instances.length, 1)
  } finally { state.dispose() }
})

test('缺失或重复参数的再记一笔不复制账单，不触发保存且仍允许手动填写', () => {
  for (const repeat of ['', 'missing', ['single', 'single']]) {
    const state = mount(false, { repeat })
    try {
      assert.equal(state.instances[0].form.value.amount, '')
      assert.match(state.view.repeatNotice, /未复制内容、未入账/)
      assert.deepEqual(state.view.restoredRecord, {})
      assert.equal(state.navigations.length, 0)
    } finally { state.dispose() }
  }
})

test('实际Vue挂载：取消未入账操作后原日期/金额/备注进入表单初值', async () => {
  const state = mount(true)
  try {
    const pending = state.view.cancelPending(operation)
    await Vue.nextTick(); state.finish(); await pending; await Vue.nextTick()
    const form = state.instances.at(-1).form.value
    assert.equal(form.amount, '0.29')
    assert.equal(form.date, '2026-10-03')
    assert.equal(form.time, '09:15')
    assert.equal(form.remark, '合成午饭')
  } finally { state.dispose() }
})

test('另一页恢复操作出现和消失保持已填写表单的同一实例', async () => {
  const state = mount()
  try {
    const first = state.instances.at(-1)
    first.form.value.amount = '12.34'; first.form.value.remark = '当前未提交输入'
    state.store.manualRecovery = { operations: [operation], error: '' }; await Vue.nextTick()
    state.store.manualRecovery = { operations: [], error: '' }; await Vue.nextTick()
    assert.equal(state.instances.length, 1)
    assert.equal(state.instances.at(-1), first)
    assert.equal(first.form.value.amount, '12.34')
  } finally { state.dispose() }
})

test('另一页待恢复草稿明确取消后仍保留当前用户未提交输入', async () => {
  const state = mount()
  try {
    const first = state.instances.at(-1)
    first.form.value.amount = '12.34'; first.form.value.remark = '当前未提交输入'
    state.store.manualRecovery = { operations: [operation], error: '' }; await Vue.nextTick()
    const pending = state.view.cancelPending(operation)
    await Vue.nextTick(); state.finish(); await pending; await Vue.nextTick()
    assert.equal(state.instances.at(-1).form.value.amount, '12.34')
    assert.equal(state.instances.at(-1).form.value.remark, '当前未提交输入')
    assert.match(state.view.notice, /当前填写的内容已保留/)
  } finally { state.dispose() }
})

test('手动页身份首次变化再切回，旧保存和取消入口不能操作新身份Store', async () => {
  const state = mount(true); let writes = 0, cancellations = 0
  try {
    state.store.addRecord = async () => { writes++; return { id: 'synthetic', date: '2026-10-04' } }
    state.store.cancelManualOperation = async () => { cancellations++ }
    state.auth.user = { id: 'other' }; state.auth.user = { id: 'synthetic-owner' }
    const results = [await state.view.save(operation.record, operation.batchId), await state.view.cancelPending(operation)]
    assert.deepEqual([writes, cancellations, state.navigations.length], [0, 0, 0])
    assert.deepEqual(results, [false, false])
  } finally { state.dispose() }
})

test('手动保存等待身份变化再切回，迟到成功不跳转，失败不回填旧错误', async () => {
  for (const rejected of [false, true]) {
    const state = mount(); let finish, fail
    try {
      state.store.addRecord = () => new Promise((resolve, reject) => { finish = resolve; fail = reject })
      const pending = state.view.save(operation.record)
      state.auth.user = { id: 'other' }; state.auth.user = { id: 'synthetic-owner' }
      if (rejected) fail(Error('合成旧保存失败')); else finish({ id: 'synthetic', date: '2026-10-04' })
      const result = await pending
      assert.equal(state.view.savedRecord, null); assert.equal(state.view.error, '')
      assert.equal(result, false); assert.equal(state.navigations.length, 0)
    } finally { state.dispose() }
  }
})

test('手动取消等待身份变化再切回，迟到回执不恢复旧草稿或回填错误', async () => {
  for (const rejected of [false, true]) {
    const state = mount(true); let finish, fail
    try {
      state.store.cancelManualOperation = () => new Promise((resolve, reject) => { finish = resolve; fail = reject })
      const pending = state.view.cancelPending(operation)
      state.auth.user = { id: 'other' }; state.auth.user = { id: 'synthetic-owner' }
      if (rejected) fail(Error('合成旧取消失败')); else finish()
      assert.equal(await pending, false)
      assert.deepEqual(state.view.restoredRecord, {}); assert.equal(state.view.notice, ''); assert.equal(state.view.error, '')
    } finally { state.dispose() }
  }
})

function hasTag(root, tag) { return root.tag === tag || root.children.some(child => hasTag(child, tag)) }
function hasClass(root, value) { return root.props.class?.split(' ').includes(value) || root.children.some(child => hasClass(child, value)) }

test('实际Add模板身份变化撤下原输入和未收尾草稿，切回不复活且不清旧输入快照', async () => {
  for (const pending of [false, true]) {
    const state = mount(pending)
    try {
      const form = state.instances[0]
      form.form.value.amount = '12.34'; form.form.value.remark = '私有未提交输入'
      assert.equal(hasClass(state.root, 'manual-card'), true)
      state.auth.user = null; await Vue.nextTick()
      const beforeReturn = hasClass(state.root, 'manual-card')
      state.auth.user = { id: 'synthetic-owner' }; await Vue.nextTick()
      assert.equal(beforeReturn, false); assert.equal(hasClass(state.root, 'manual-card'), false)
      assert.equal(hasTag(state.root, 'form'), false)
      assert.equal(form.form.value.amount, '12.34'); assert.equal(form.form.value.remark, '私有未提交输入')
      assert.equal(state.store.manualRecovery.operations.length, pending ? 1 : 0)
    } finally { state.dispose() }
  }
})

test('指定日期手动入口只初始化日期与来源，不自动保存也不覆盖后续输入', async () => {
  const query = Vue.reactive({ date:'2024-02-29', returnTo:'/bills?month=2024-02&date=2024-02-29&q=午饭#source' })
  const state = mount(false, query)
  try {
    const form = state.instances[0].form.value
    assert.equal(form.date, '2024-02-29'); assert.equal(form.amount, '')
    assert.match(state.view.repeatNotice, /2024-02-29/)
    assert.equal(state.view.returnPath, getRepeatReturnPath(query.returnTo))
    form.amount = '25'; form.remark = '新填写'; query.date = '2026-10-03'; await Vue.nextTick()
    assert.equal(form.date,'2024-02-29'); assert.equal(form.amount,'25'); assert.equal(form.remark,'新填写')
    assert.equal(state.navigations.length,0)
  } finally { state.dispose() }
})

test('日期预填拒绝数组/非法日/正式上限，恢复原操作及再记一笔仍优先', () => {
  for(const date of [['2024-02-29'], '2024-02-30', '9999-01-01']) {
    const state = mount(false,{date})
    try { assert.equal(state.instances[0].form.value.date,dayjs().format('YYYY-MM-DD')); assert.deepEqual(state.view.restoredRecord,{}) }
    finally { state.dispose() }
  }
  const pending=mount(true,{date:'2024-02-29'})
  try { assert.deepEqual(pending.view.restoredRecord,{});assert.equal(pending.instances[0].form.value.date,dayjs().format('YYYY-MM-DD'));assert.equal(pending.view.recovery.operations[0].record.date,'2026-10-03') }
  finally { pending.dispose() }
  const repeat=mount(false,{date:'2024-02-29',repeat:operation.record.id})
  try { assert.equal(repeat.instances[0].form.value.date,dayjs().format('YYYY-MM-DD'));assert.equal(repeat.instances[0].form.value.amount,'0.29') }
  finally { repeat.dispose() }
})
