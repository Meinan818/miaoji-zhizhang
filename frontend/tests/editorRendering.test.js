// 实际组件脚本与Editor模板的离线Vue挂载；native dialog/focus仅核调用，不代表GUI验收。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import dayjs from 'dayjs'
import { isValidMonth } from '../src/utils/statistics.js'
import { CATEGORY_OPTIONS } from '../src/utils/categories.js'
import { validDate, validateRecord } from '../src/utils/ledger.js'
import { createBillFilterPath, useBillQuery, useLedgerReload } from '../src/utils/navigation.js'
import { filterRecords, windowRecordGroups } from '../src/utils/journal.js'
import { centsText, legacyCents, getRecordTotals } from '../src/utils/money.js'
import { createAiDraftApi } from '../src/api/aiDraft.js'
import { formatCurrency } from '../src/utils/format.js'
import { getCategoryArtwork } from '../src/utils/categoryArtwork.js'
import { useLocalDay } from '../src/utils/calendar.js'
import { createBillCsv } from '../src/utils/billCsv.js'
import { renderToString } from '@vue/server-renderer'

function source(file) {
  const { descriptor } = parse(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'))
  return { script: descriptor.scriptSetup.content.replace(/^import .*$/gm, ''), template: descriptor.template.content }
}
function evaluate(script, bindings, returned) {
  return new Function(...Object.keys(bindings), script + ';return {' + returned + '}')(...Object.values(bindings))
}
function node(tag) {
  return { tag, children: [], props: {}, style: {}, parent: null, text: '', focusCount: 0, scrollCount: 0,
    addEventListener() {}, removeEventListener() {},
    getRootNode() { return {} },
    focus() { this.focusCount++ }, scrollIntoView() { this.scrollCount++ }, showModal() { this.open = true }, close() { this.open = false } }
}
const renderer = Vue.createRenderer({
  createElement: node, createText: text => ({ ...node('#text'), text }), createComment: text => ({ ...node('#comment'), text }),
  insert(child, parent, anchor = null) {
    if (child.parent) { const old = child.parent.children.indexOf(child); if (old >= 0) child.parent.children.splice(old, 1) }
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child)
  },
  remove(child) { const index = child.parent?.children.indexOf(child) ?? -1; if (index >= 0) child.parent.children.splice(index, 1); child.parent = null },
  setText: (child, text) => { child.text = text }, setElementText: (child, text) => { child.text = text; child.children = [] },
  parentNode: child => child.parent, nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
  patchProp: (child, key, previous, value) => { child.props[key] = value },
})
const original = { id: 'synthetic', version: 2, type: 'expense', amount: '0.29', category: '餐饮', date: '2026-10-03', remark: '合成账单' }
const editorSource = source('components/record/RecordEditor.vue'), formSource = source('components/record/RecordForm.vue')
test('表单错误等待渲染后滚动且保输入，隐藏元素/错误撤下/卸载后的旧回调不滚动', async () => {
  const props = Vue.reactive({ record: { ...original }, error: '', saving: false, blocked: false })
  const scope = Vue.effectScope(), scrolls = []
  const values = scope.run(() => evaluate(formSource.script, { ...Vue, onBeforeUnmount: () => {}, dayjs, CATEGORY_OPTIONS, validateRecord, SERVER_MODE: true,
    defineProps: () => props, defineEmits: () => () => {}, defineExpose: () => {} }, 'form, localError, errorElement'))
  try {
    const target = { getClientRects: () => [{}], scrollIntoView: options => scrolls.push(options) }
    values.errorElement.value = target
    values.form.value.amount = '13.24'; values.form.value.remark = '未保存输入'
    props.error = '合成较长保存错误'; await Vue.nextTick(); await Vue.nextTick()
    assert.deepEqual(scrolls, [{ block: 'nearest' }])
    assert.equal(values.form.value.amount, '13.24'); assert.equal(values.form.value.remark, '未保存输入')
    target.getClientRects = () => []
    props.error = '隐藏表单错误'; await Vue.nextTick(); await Vue.nextTick()
    assert.equal(scrolls.length, 1)
    target.getClientRects = () => [{}]
    values.localError.value = '将被撤下的错误'; await Vue.nextTick()
    values.localError.value = ''; props.error = ''; await Vue.nextTick(); await Vue.nextTick()
    assert.equal(scrolls.length, 1)
    props.error = '将被卸载的错误'; await Vue.nextTick(); scope.stop(); await Vue.nextTick()
    assert.equal(scrolls.length, 1)
  } finally { scope.stop() }
})

function editorComponent(forms) {
  const RecordForm = { props: ['record', 'saving', 'blocked', 'error'], setup(props, context) {
    const values = evaluate(formSource.script, { ...Vue, dayjs, CATEGORY_OPTIONS, validateRecord, SERVER_MODE: true,
      defineProps: () => props, defineEmits: () => context.emit, defineExpose: context.expose }, 'form, save, localError, props')
    forms.push(values)
    return () => Vue.h('form', { class: 'record-form' }, values.form.value.amount)
  } }
  const Editor = { props: { record: Object, saving: Boolean, progressLabel: String, error: String, allowDelete: Boolean, allowRepeat: Boolean, conflict: Object, draft: Boolean }, components: { RecordForm }, setup(props, context) {
    return evaluate(editorSource.script, { ...Vue, defineProps: () => props, defineEmits: () => context.emit,
      formatCurrency: amount => Number(amount).toFixed(2) },
    'props, emit, dialog, recordForm, repeat, confirmingDelete, deleteTrigger, cancelDeleteButton, startDelete, cancelDelete, close, formatCurrency')
  }, render: new Function('Vue', compile(editorSource.template, { mode: 'function' }).code)(Vue) }
  Editor.render._rc = true
  return Editor
}
function mountEditor() {
  const previousDocument = globalThis.document
  globalThis.document = { body: { style: { overflow: 'scroll' } } }
  const forms = [], events = [], props = Vue.reactive({ record: { ...original }, allowDelete: true, saving: false, conflict: null, error: '' })
  const Editor = editorComponent(forms), root = node('root')
  let view
  const app = renderer.createApp({ render: () => Vue.h(Editor, { ...props, ref: instance => { view = instance },
    onSave: input => events.push(['save', input]), onClose: () => events.push(['close']), onDelete: () => events.push(['delete']), onRepeat: () => events.push(['repeat']) }) })
  app.mount(root)
  return { forms, events, props, get view() { return view }, root, dispose() { app.unmount(); globalThis.document = previousDocument } }
}

test('删除确认返回编辑保留金额/备注/未知时间的同一表单，并调用正确焦点目标', async () => {
  const state = mountEditor()
  try {
    const form = state.forms[0], dialog = state.view.dialog
    assert.equal(dialog.open, true)
    assert.equal(document.body.style.overflow, 'hidden')
    form.form.value.amount = '12.34'; form.form.value.remark = '尚未保存输入'
    for (let cycle = 0; cycle < 2; cycle++) {
      await state.view.startDelete()
      assert.equal(state.view.cancelDeleteButton.focusCount, 1)
      assert.equal(dialog.children.some(child => child.tag === 'form' && child.style.display === 'none'), true)
      await state.view.close(); await Vue.nextTick()
      assert.equal(state.view.confirmingDelete, false)
      assert.equal(state.view.deleteTrigger.focusCount, 1)
    }
    assert.equal(state.forms.length, 1)
    assert.equal(form.form.value.amount, '12.34')
    assert.equal(form.form.value.remark, '尚未保存输入')
    form.save()
    assert.equal(state.events[0][0], 'save')
    assert.equal(state.events[0][1].amount, 12.34)
    assert(!('time' in state.events[0][1]))
    assert.equal(state.events.length, 1)
    state.dispose()
    assert.equal(dialog.open, false)
  } finally { if (state.view) state.dispose() }
})

test('同账单冲突版本更新保留真实Editor表单输入和未知时间，返回删除确认后仍保存原输入', async () => {
  const state = mountEditor()
  try {
    const form = state.forms[0]
    form.form.value.amount = '12.34'; form.form.value.remark = '保留待保存输入'
    state.props.conflict = { current: { ...original, version: 3, amount: 99 } }; await Vue.nextTick()
    assert.equal(state.forms.length, 1); assert.equal(form.form.value.amount, '12.34')
    state.props.record = { ...original, version: 3 }; state.props.conflict = null; await Vue.nextTick()
    await state.view.startDelete(); await state.view.cancelDelete()
    form.save()
    assert.equal(state.events[0][1].amount, 12.34); assert.equal(state.events[0][1].remark, '保留待保存输入')
    assert.equal('time' in state.events[0][1], false); assert.equal(state.forms.length, 1)
  } finally { state.dispose() }
})

test('冲突只阻止写入，不冒称请求中；原输入保留且采用新版本后可以保存', async () => {
  for (const current of [null, { ...original, version: 3, amount: 99 }]) {
    const state = mountEditor()
    try {
      const form = state.forms[0]
      form.form.value.amount = '16.00'; form.form.value.remark = '冲突未保存输入'
      state.props.conflict = { current }; await Vue.nextTick()
      assert.equal(form.props.saving, false)
      assert.equal(form.props.blocked, true)
      form.save(); assert.deepEqual(state.events, [])
      assert.equal(form.form.value.amount, '16.00'); assert.equal(form.form.value.remark, '冲突未保存输入')
      state.props.conflict = null; await Vue.nextTick(); form.save()
      assert.equal(state.events[0][1].amount, 16)
      assert.equal(state.events[0][1].remark, '冲突未保存输入')
      assert.equal('time' in state.events[0][1], false)
    } finally { state.dispose() }
  }
})

test('真实表单冲突模板保留保存按钮名称和可关闭入口，实际请求中才显示进度及锁定取消', async () => {
  const Form = {
    props: { record: Object, saving: Boolean, blocked: Boolean, error: String, submitLabel: String, progressLabel: String },
    components: { CategoryIcon: { render: () => Vue.h('span') } }, template: formSource.template,
    setup(props, context) {
      return evaluate(formSource.script, { ...Vue, dayjs, CATEGORY_OPTIONS, validateRecord, SERVER_MODE: true,
        defineProps: () => props, defineEmits: () => context.emit, defineExpose: context.expose },
      'props, emit, form, localError, categories, changeType, save, revealNote, unknownTime')
    },
  }
  for (const saving of [false, true]) {
    const html = await renderToString(Vue.createSSRApp({ render: () => Vue.h(Form, { record: original, blocked: true, saving, submitLabel: '保存修改' }) }))
    assert.match(html, /<fieldset disabled/)
    assert.match(html, saving ? /<button[^>]*class="primary"[^>]*disabled[^>]*>正在保存…/ : /<button[^>]*class="primary"[^>]*disabled[^>]*>保存修改/)
    assert.match(html, saving ? /<button type="button" disabled>取消/ : /<button type="button">取消/)
    if (!saving) assert.doesNotMatch(html, /正在保存/)
  }
})

test('删除请求期间关闭/Escape不退出窗口，离页后nextTick不聚焦旧按钮并恢复overflow', async () => {
  const state = mountEditor(), priorDocument = document
  try {
    await state.view.startDelete()
    const button = state.view.cancelDeleteButton, dialog = state.view.dialog
    state.props.saving = true; await Vue.nextTick()
    state.view.close()
    assert.equal(state.view.confirmingDelete, true)
    assert.deepEqual(state.events, [])
    state.props.saving = false; await Vue.nextTick()
    const pending = state.view.cancelDelete()
    state.dispose(); await pending
    assert.equal(button.focusCount, 1)
    assert.equal(dialog.open, false)
    assert.equal(priorDocument.body.style.overflow, 'scroll')
  } finally { if (state.view) state.dispose() }
})

test('再记一笔仅在原表单未修改时可用，忙碌/冲突/删除确认/草稿均不丢输入或发事件', async () => {
  const state = mountEditor()
  try {
    state.props.allowRepeat = true; await Vue.nextTick()
    assert.equal(state.view.repeat(), true)
    assert.deepEqual(state.events, [['repeat']]); state.events.length = 0
    const form = state.forms[0].form.value
    form.amount = '12.34'
    assert.equal(state.view.repeat(), false)
    assert.equal(form.amount, '12.34')
    form.amount = String(original.amount)
    for (const blocked of ['saving', 'conflict', 'draft']) {
      state.props[blocked] = blocked === 'conflict' ? {} : true
      await Vue.nextTick()
      assert.equal(state.view.repeat(), false)
      state.props[blocked] = blocked === 'conflict' ? null : false
      await Vue.nextTick()
    }
    await state.view.startDelete()
    assert.equal(state.view.repeat(), false)
    assert.deepEqual(state.events, [])
  } finally { state.dispose() }
})

function mountBills({ records = [{ ...original }], navigate = async () => false, replace = async () => undefined, dateClock = {}, server = false, downloadFailure = false, clipboard = {}, template = false, realEditor = false } = {}) {
  const bills = source('views/Bills.vue'), calls = []
  const route = Vue.reactive({ path: '/bills', hash: '', query: { month: '2026-10' } })
  const auth = Vue.reactive({ user: { id: 'synthetic-owner' } }), downloads = []
  let finish, fail, values
  const store = Vue.reactive({ records, storageError: '', refresh: async () => true,
    updateRecord: (...args) => { calls.push(['update', ...args]); return new Promise((resolve, reject) => { finish = resolve; fail = reject }) },
    deleteRecord: (...args) => { calls.push(['delete', ...args]); return new Promise((resolve, reject) => { finish = resolve; fail = reject }) } })
  const focusTarget = node('notice')
  const stub = { render: () => Vue.h('span') }, forms = []
  const Bills = { components: { CategoryIcon: stub, ManualEntry: stub, NotebookBack: stub, MonthPicker: stub, DatePicker: stub, ChevronLeft: stub, ChevronRight: stub, BottomNav: stub,
    RecordEditor: realEditor ? editorComponent(forms) : { props: ['record'], render() { return Vue.h('section', { class: 'synthetic-editor' }, this.record.remark) } } }, setup() {
    values = evaluate(bills.script, { ...Vue, dayjs, useRecordStore: () => store, useRoute: () => route,
      useRouter: () => ({ push: async target => { calls.push(['navigate', target]); return navigate(target) }, replace: async target => {
        calls.push(['replace', target]); const failure = await replace(target)
        if (!failure) { route.path = target.path; route.query = target.query; route.hash = target.hash }
        return failure
      } }),
      useLocalDay: () => useLocalDay({ eventTarget: null, ...dateClock }),
      createBillFilterPath, useBillQuery, useLedgerReload, isValidMonth, validDate, filterRecords, windowRecordGroups, getRecordTotals, centsText, CATEGORY_OPTIONS,
      window: { location: { origin: 'http://127.0.0.1:5174' } }, navigator: { clipboard },
      SERVER_MODE: server, useAuthStore: () => auth, createBillCsv,
      downloadCsv: (csv, filename) => { if (downloadFailure) throw Error('合成下载失败'); downloads.push({ csv, filename }) } },
    'edit, saveEdit, deleteEdit, repeatRecord, adoptLatestVersion, notice, noticeElement, saving, resettingFilters, pendingMonth, savedEditMonth, syncSavedEditMonth, resetFilterAddress, clearSearchAddress, clearDateAddress, repeating, saveError, editConflict, editingRecord, selectedMonth, selectedDate, manualEntryTarget, searchText, groupedRecords, setRecordElement, loadMoreRecords, visibleLimit, exportBills, exportUnavailable, exportError, selectedType, selectedCategory, reloading, reloadError, clearSearch, searchInput, copyFilterLink, copyLinkUnavailable, copyingLink, filterLinkText, filterLinkMessage, recordStore, ownerCurrent, reloadRecords, monthTitle, monthTotals, needsWideAmounts, monthRecords, changeMonth, filtering, filterCategories, chooseType, chooseCategory, listedRecords, filteredTotals, needsWideFilteredAmounts, resetFilters, hiddenCount, displayedCount, visibleGroups, highlightedId, getSign, currentMonth, canReturnToCurrentMonth, returnToCurrentMonth, chooseMonth, chooseDate')
    values.noticeElement.value = focusTarget
    return template ? { ...values, SERVER_MODE: server, dayjs, centsText, formatCurrency, getCategoryArtwork, miaoWriting: 'synthetic', receiptKitten: 'synthetic' } : () => Vue.h('main')
  } }
  if (template) { Bills.render = new Function('Vue', compile(bills.template, { mode: 'function' }).code)(Vue); Bills.render._rc = true }
  const app = renderer.createApp(Bills), root = node('root')
  app.mount(root); values.edit(original)
  return { values, calls, route, store, auth, downloads, focusTarget, root, forms, finish: result => finish(result), fail: error => fail(error), dispose: () => app.unmount() }
}

test('明细再记一笔只导航携带账单编号，旧身份/离页/删除/冲突/忙碌禁止操作', async () => {
  const state = mountBills({ server: true })
  try {
    const before = JSON.stringify(state.store.records)
    assert.equal(await state.values.repeatRecord(), true)
    assert.deepEqual(state.calls, [['navigate', { path: '/add', query: { repeat: original.id, returnTo: '/bills?month=2026-10' } }]])
    assert.equal(JSON.stringify(state.store.records), before)
    state.calls.length = 0
    state.values.saving.value = true; assert.equal(await state.values.repeatRecord(), false)
    state.values.saving.value = false; state.values.editConflict.value = {}
    assert.equal(await state.values.repeatRecord(), false)
    state.values.editConflict.value = null; state.store.records = []
    assert.equal(await state.values.repeatRecord(), false)
    state.store.records = [{ ...original }]
    state.auth.user = { id: 'other' }; state.auth.user = { id: 'synthetic-owner' }
    assert.equal(await state.values.repeatRecord(), false)
    assert.deepEqual(state.calls, [])
  } finally { state.dispose() }
  const disposed = mountBills(); disposed.dispose()
  assert.equal(await disposed.values.repeatRecord(), false)
  assert.deepEqual(disposed.calls, [])
})

test('再记导航等待锁住重复入口，失败保编辑窗口，身份切回后的迟到结果不回填', async () => {
  for (const stale of [false, true]) {
    let finish
    const state = mountBills({ server: true, navigate: () => new Promise(resolve => { finish = resolve }) })
    try {
      const pending = state.values.repeatRecord()
      assert.equal(state.values.saving.value, true); assert.equal(state.values.repeating.value, true)
      assert.equal(await state.values.repeatRecord(), false); assert.equal(state.calls.length, 1)
      if (stale) { state.auth.user = { id: 'other' }; state.auth.user = { id: 'synthetic-owner' } }
      finish({ type: 'aborted' })
      assert.equal(await pending, false)
      assert.equal(state.values.editingRecord.value.id, original.id)
      assert.equal(state.values.saveError.value, stale ? '' : '暂时未能打开新账单，原账单和编辑窗口已保留，请重试。')
      if (!stale) {
        assert.equal(state.values.saving.value, false); assert.equal(state.values.repeating.value, false)
      }
      assert.deepEqual(state.store.records, [original])
    } finally { state.dispose() }
  }
})

test('明细直接选择跨年月份保搜索收支，非法选择和编辑/旧身份不覆盖状态', async () => {
  const state = mountBills({ server: true, dateClock: { now: () => '2026-10-06' } })
  try {
    assert.equal(state.values.chooseMonth('2024-02'), false)
    state.values.editingRecord.value = null
    state.route.query = { month: '2026-10', q: '保留备注', type: 'income', category: '工资' }
    for (const month of ['', null, '0999-12', '10000-01', '2026-13', ['2024-02'], '2026-10']) assert.equal(state.values.chooseMonth(month), false)
    assert.equal(state.values.selectedCategory.value, '工资')
    assert.equal(await state.values.chooseMonth('2024-02'), true)
    assert.equal(state.values.selectedMonth.value, '2024-02')
    assert.equal(state.values.searchText.value, '保留备注'); assert.equal(state.values.selectedType.value, 'income')
    assert.equal(state.values.selectedCategory.value, '')
    state.auth.user = null; state.auth.user = { id: 'synthetic-owner' }
    assert.equal(state.values.chooseMonth('2025-01'), false)
    assert.equal(state.values.selectedMonth.value, '2024-02'); assert.equal(state.calls.length, 1); assert.equal(state.calls[0][0], 'replace')
  } finally { state.dispose() }
})

test('明细回本月保留搜索/收支，沿用切月重置分类，不写账单且重复入口失效', async () => {
  const state = mountBills({ server: true, dateClock: { now: () => '2026-10-06' } })
  try {
    state.values.editingRecord.value = null
    state.route.query = { month: '2026-09', q: '保留备注', type: 'income', category: '工资' }
    state.values.notice.value = '旧月份提示'
    assert.equal(state.values.canReturnToCurrentMonth.value, true)
    assert.equal(await state.values.returnToCurrentMonth(), true)
    assert.equal(state.values.selectedMonth.value, '2026-10')
    assert.equal(state.values.searchText.value, '保留备注')
    assert.equal(state.values.selectedType.value, 'income')
    assert.equal(state.values.selectedCategory.value, '')
    assert.equal(state.values.notice.value, '')
    assert.equal(state.values.returnToCurrentMonth(), false)
    assert.equal(state.calls.length, 1); assert.equal(state.calls[0][0], 'replace'); assert.deepEqual(state.store.records, [original])
  } finally { state.dispose() }
})

test('明细编辑/保存/身份切回及离页后的回本月入口不覆盖原月份或未保存内容', () => {
  const state = mountBills({ server: true, dateClock: { now: () => '2026-10-06' } })
  try {
    state.values.selectedMonth.value = '2026-09'
    const before = { ...state.values.editingRecord.value }
    assert.equal(state.values.returnToCurrentMonth(), false)
    assert.deepEqual(state.values.editingRecord.value, before)
    state.values.editingRecord.value = null; state.values.saving.value = true
    assert.equal(state.values.returnToCurrentMonth(), false)
    state.values.saving.value = false; state.auth.user = null; state.auth.user = { id: 'synthetic-owner' }
    assert.equal(state.values.returnToCurrentMonth(), false)
    assert.equal(state.values.selectedMonth.value, '2026-09'); assert.deepEqual(state.calls, [])
  } finally { state.dispose() }
  const disposed = mountBills({ dateClock: { now: () => '2026-10-06' } })
  disposed.values.editingRecord.value = null; disposed.values.selectedMonth.value = '2026-09'; disposed.dispose()
  assert.equal(disposed.values.returnToCurrentMonth(), false)
  assert.equal(disposed.values.selectedMonth.value, '2026-09')
})

test('明细跨月保持历史筛选，再回本月使用最新月份且不修改账本', async () => {
  let day = '2026-10-31', tick
  const state = mountBills({ dateClock: { now: () => day, documentTarget: null,
    eventTarget: { addEventListener() {}, removeEventListener() {} },
    timers: { setInterval: callback => { tick = callback; return 1 }, clearInterval() {} } } })
  try {
    state.values.editingRecord.value = null; state.values.selectedMonth.value = '2026-09'
    state.values.searchText.value = '旧条件'
    day = '2026-11-01'; tick()
    assert.equal(state.values.selectedMonth.value, '2026-09')
    assert.equal(await state.values.returnToCurrentMonth(), true)
    assert.equal(state.values.selectedMonth.value, '2026-11')
    assert.equal(state.values.searchText.value, '旧条件')
    assert.equal(state.calls.length, 1); assert.equal(state.calls[0][0], 'replace'); assert.deepEqual(state.store.records, [original])
  } finally { state.dispose() }
})

test('明细切月等待原月份不提前改变，拒重复并保refs搜索/收支/hash/added，分类只在成功清空', async () => {
  let finish
  const state = mountBills({ replace: () => new Promise(resolve => { finish = resolve }) })
  try {
    state.values.editingRecord.value = null
    state.route.query = { month: '2024-02', q: '旧关键词', type: 'expense', category: '餐饮', added: 'keep-highlight' }
    state.route.hash = '#month'; state.values.searchText.value = '当前关键词'; state.values.selectedType.value = 'income'
    const pending = state.values.changeMonth(1)
    assert.equal(state.values.pendingMonth.value, '2024-03'); assert.equal(state.values.selectedMonth.value, '2024-02')
    assert.equal(state.values.selectedCategory.value, '餐饮'); assert.equal(state.values.resettingFilters.value, true)
    assert.equal(state.values.chooseMonth('2024-04'), false); assert.equal(await state.values.resetFilterAddress(), false)
    assert.deepEqual(state.calls, [['replace', { path: '/bills', query: { month: '2024-03', q: '当前关键词', type: 'income', added: 'keep-highlight' }, hash: '#month' }]])
    finish(undefined); assert.equal(await pending, true)
    assert.equal(state.values.selectedMonth.value, '2024-03'); assert.equal(state.values.selectedCategory.value, '')
    assert.equal(state.values.searchText.value, '当前关键词'); assert.equal(state.values.selectedType.value, 'income')
    assert.equal(state.values.pendingMonth.value, ''); assert.deepEqual(state.store.records, [original])
  } finally { state.dispose() }
})

test('明细月份导航返回失败或抛错保持旧月份/筛选，释放等待后可重试', async () => {
  for (const rejects of [false, true]) {
    let failing = true
    const state = mountBills({ replace: async () => { if (failing) { if (rejects) throw Error('合成读取失败'); return { type: 4 } } } })
    try {
      state.values.editingRecord.value = null
      state.route.query = { month: '2024-02', q: '原关键词', type: 'expense', category: '餐饮' }
      assert.equal(await state.values.chooseMonth('2024-03'), false)
      assert.equal(state.values.selectedMonth.value, '2024-02'); assert.equal(state.values.selectedCategory.value, '餐饮')
      assert.equal(state.values.searchText.value, '原关键词'); assert.equal(state.values.pendingMonth.value, '')
      assert.match(state.values.notice.value, /仍显示原月份/); assert.equal(state.values.resettingFilters.value, false)
      failing = false; assert.equal(await state.values.chooseMonth('2024-03'), true)
      assert.equal(state.values.notice.value, ''); assert.equal(state.values.selectedMonth.value, '2024-03')
      assert.equal(state.calls.length, 2); assert(state.calls.every(call => call[0] === 'replace'))
      assert.deepEqual(state.store.records, [original])
    } finally { state.dispose() }
  }
})

test('明细月份导航离页或身份切换后不追加提示/清新输入/启动后续请求', async () => {
  for (const change of [state => state.dispose(), state => { state.auth.user = { id: 'other-owner' } }]) {
    let finish
    const state = mountBills({ server: true, replace: () => new Promise(resolve => { finish = resolve }) })
    try {
      state.values.editingRecord.value = null
      const pending = state.values.chooseMonth('2024-03'); change(state); state.values.searchText.value = '新输入'
      finish({ type: 8 }); assert.equal(await pending, false)
      assert.equal(state.values.searchText.value, '新输入'); assert.equal(state.values.notice.value, '')
      assert.equal(state.calls.length, 1); assert.equal(state.values.selectedMonth.value, '2026-10')
    } finally { state.dispose() }
  }
})

test('真实Bills→Editor→Form关闭再开另一笔，即使同tick也使用新账单输入和时间语义', async () => {
  const previous = { document: globalThis.document, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot }
  globalThis.document = { activeElement: null, body: { style: { overflow: 'scroll' } }, addEventListener() {}, removeEventListener() {} }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  try {
    for (const sameTick of [false, true]) {
      const state = mountBills({ server: true, template: true, realEditor: true })
      try {
        await Vue.nextTick()
        const oldForm = state.forms[0]; oldForm.form.value.amount = '12.34'; oldForm.form.value.remark = '上一笔未保存'
        const next = { ...original, id: 'next', amount: '8.50', time: '00:00', remark: '下一笔' }
        state.values.editingRecord.value = null
        if (!sameTick) await Vue.nextTick()
        state.values.edit(next); await Vue.nextTick()
        const current = state.forms.at(-1)
        assert.notEqual(current, oldForm)
        assert.equal(current.form.value.amount, '8.50'); assert.equal(current.form.value.remark, '下一笔')
        assert.equal(current.form.value.time, '00:00')
        assert.equal(oldForm.form.value.amount, '12.34'); assert.deepEqual(state.calls, [])
        current.save()
        assert.equal(state.calls[0][1], 'next'); assert.equal(state.calls[0][2].amount, 8.50)
        assert.equal(state.calls[0][2].time, '00:00')
        state.finish({ ...next, amount: 8.50 }); await Vue.nextTick(); await Vue.nextTick()
      } finally { state.dispose() }
    }
  } finally { Object.assign(globalThis, previous) }
})

test('编辑保存拒绝重复请求，离页后成功回执不改本页月份/提示', async () => {
  const state = mountBills()
  const pending = state.values.saveEdit({ amount: 12.34 })
  await state.values.saveEdit({ amount: 56.78 })
  state.dispose()
  state.finish({ ...original, date: '2026-11-02', amount: 12.34 }); await pending
  assert.equal(state.calls.length, 1)
  assert.equal(state.values.selectedMonth.value, '2026-10')
  assert.equal(state.values.notice.value, '')
})

test('离页后删除成功不更新提示或聚焦旧节点', async () => {
  const state = mountBills(), pending = state.values.deleteEdit()
  state.dispose(); state.finish(); await pending
  assert.equal(state.values.notice.value, '')
  assert.equal(state.focusTarget.focusCount, 0)
})

test('离页后版本冲突不回填旧页面错误和冲突内容', async () => {
  const state = mountBills(), pending = state.values.saveEdit({ amount: 12.34 })
  state.dispose()
  state.fail(Object.assign(Error('合成冲突'), { recoveryLoaded: true, currentRecord: { ...original, version: 3 } })); await pending
  assert.equal(state.values.saveError.value, '')
  assert.equal(state.values.editConflict.value, null)
})

test('仍在明细页保存成功切到新日期月份，失败冲突可采用新版本重试', async () => {
  const state = mountBills()
  try {
    let pending = state.values.saveEdit({ amount: 12.34 })
    state.fail(Object.assign(Error('合成冲突'), { recoveryLoaded: true, currentRecord: { ...original, version: 3 } })); await pending
    assert.equal(state.values.saveError.value, '合成冲突')
    await state.values.saveEdit({ amount: 12.34 })
    assert.equal(state.calls.length, 1)
    state.values.adoptLatestVersion()
    pending = state.values.saveEdit({ amount: 12.34 })
    assert.deepEqual(state.calls[1].at(-1), { version: 3 })
    state.finish({ ...original, date: '2026-11-02', amount: 12.34 }); await pending
    assert.equal(state.values.selectedMonth.value, '2026-11')
    assert.equal(state.values.editingRecord.value, null)
    assert.equal(state.values.saving.value, false)
    assert.match(state.values.notice.value, /已保存修改/)
  } finally { state.dispose() }
})

test('跨月编辑保存成功同步新月份地址，保当前筛选/hash/其他参数，只有一次原版本写入', async () => {
  const state = mountBills()
  try {
    state.route.query = { month: '2026-10', q: '原关键词', type: 'expense', category: '餐饮', extra: 'keep' }
    state.route.hash = '#edit'; state.values.searchText.value = '当前关键词'
    const pending = state.values.saveEdit({ amount: 12.34 })
    state.finish({ ...original, date: '2026-11-02', amount: 12.34 }); await pending
    assert.deepEqual(state.calls.map(call => call[0]), ['update', 'replace'])
    assert.deepEqual(state.calls[0].at(-1), { version: original.version })
    assert.deepEqual(state.calls[1][1], { path: '/bills', query: { month: '2026-11', q: '当前关键词', type: 'expense', category: '餐饮', extra: 'keep' }, hash: '#edit' })
    assert.equal(state.values.savedEditMonth.value, ''); assert.equal(state.values.editingRecord.value, null)
    assert.equal(state.values.selectedMonth.value, '2026-11'); assert.match(state.values.notice.value, /已保存修改/)
  } finally { state.dispose() }
})

test('跨月编辑写入成功后导航失败，明确已保存并保新月；显式重试只定位不重复写入', async () => {
  let failing = true
  const state = mountBills({ replace: async () => { if (failing) return { type: 4 } } })
  try {
    const pending = state.values.saveEdit({ amount: 12.34 })
    state.finish({ ...original, date: '2026-11-02', amount: 12.34 }); await pending
    assert.equal(state.values.editingRecord.value, null); assert.equal(state.values.saving.value, false)
    assert.equal(state.values.selectedMonth.value, '2026-11'); assert.equal(state.values.savedEditMonth.value, '2026-11')
    assert.match(state.values.notice.value, /修改已保存.*无需再次保存/)
    assert.equal(state.route.query.month, '2026-10')
    await state.values.saveEdit({ amount: 99 })
    failing = false; assert.equal(await state.values.syncSavedEditMonth(), true)
    assert.equal(state.route.query.month, '2026-11'); assert.equal(state.values.savedEditMonth.value, '')
    assert.deepEqual(state.calls.map(call => call[0]), ['update', 'replace', 'replace'])
    assert.match(state.values.notice.value, /已保存修改/)
  } finally { state.dispose() }
})

test('跨月编辑保存后定位等待中身份变化或离页不清新输入/发布旧成功提示/重写账单', async () => {
  for (const change of [state => state.dispose(), state => { state.auth.user = { id: 'other-owner' } }]) {
    let finish
    const state = mountBills({ server: true, replace: () => new Promise(resolve => { finish = resolve }) })
    try {
      const pending = state.values.saveEdit({ amount: 12.34 })
      state.finish({ ...original, date: '2026-11-02', amount: 12.34 })
      for (let i = 0; i < 4 && !finish; i++) await Vue.nextTick()
      assert(finish); change(state); state.values.searchText.value = '新输入'
      finish({ type: 8 }); await pending
      assert.equal(state.values.searchText.value, '新输入'); assert.equal(state.values.notice.value, '')
      assert.deepEqual(state.calls.map(call => call[0]), ['update', 'replace'])
      assert.equal(await state.values.syncSavedEditMonth(), false)
    } finally { state.dispose() }
  }
})

test('仍在明细页删除错误保留编辑且可重试，成功聚焦提示；离页旧入口不能再次发送', async () => {
  const state = mountBills()
  try {
    let pending = state.values.deleteEdit()
    state.fail(Error('合成删除失败')); await pending
    assert.equal(state.values.editingRecord.value.id, original.id)
    assert.equal(state.values.saveError.value, '合成删除失败')
    pending = state.values.deleteEdit(); state.finish(); await pending
    assert.equal(state.focusTarget.focusCount, 1)
    assert.equal(state.values.saving.value, false)
    assert.match(state.values.notice.value, /已删除/)
    state.dispose(); state.values.edit(original)
    await state.values.deleteEdit(); await state.values.saveEdit({ amount: 12.34 })
    assert.equal(state.calls.length, 2)
  } finally { state.dispose() }
})

test('明细跨日月只更新今日/昨日标签，保留历史月份/搜索/编辑，不写账单并释放时钟', async () => {
  const OriginalDate = globalThis.Date
  let time = new OriginalDate('2026-10-31T12:00:00'), day = '2026-10-31', cleared = false, state, tick
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [time.getTime()])) }
    static now() { return time.getTime() }
  }
  const events = new Map(), records = [{ ...original, date: '2026-10-31' }, { ...original, id: 'other', date: '2026-10-30' }]
  try {
    state = mountBills({ records, dateClock: { now: () => day, documentTarget: null,
      eventTarget: { addEventListener: (name, listener) => events.set(name, listener), removeEventListener: name => events.delete(name) },
      timers: { setInterval: callback => { tick = callback; return 7 }, clearInterval: id => { assert.equal(id, 7); cleared = true } } } })
    assert.deepEqual(state.values.groupedRecords.value.map(group => group.label), ['今天', '昨天'])
    state.values.searchText.value = '合成账单'
    state.values.editingRecord.value.remark = '未保存编辑快照'
    assert.deepEqual(state.values.groupedRecords.value.map(group => group.label), ['今天', '昨天'])
    time = new OriginalDate('2026-11-01T12:00:00'); day = '2026-11-01'; events.get('focus')?.()
    await Vue.nextTick()
    assert.equal(state.values.groupedRecords.value[0].label, '昨天')
    assert.match(state.values.groupedRecords.value[1].label, /^10月30日/)
    time = new OriginalDate('2026-11-02T12:00:00'); day = '2026-11-02'; tick?.()
    await Vue.nextTick()
    assert.match(state.values.groupedRecords.value[0].label, /^10月31日/)
    assert.equal(state.values.selectedMonth.value, '2026-10')
    assert.equal(state.values.searchText.value, '合成账单')
    assert.equal(state.values.editingRecord.value.remark, '未保存编辑快照')
    assert.equal(state.calls.length, 0)
    state.dispose()
    assert.equal(events.size, 0)
    assert.equal(cleared, true)
  } finally { state?.dispose(); globalThis.Date = OriginalDate }
})

test('快速切换新账单定位时旧nextTick不滚动或聚焦，当前定位仍生效', async () => {
  const state = mountBills({ records: [{ ...original }, { ...original, id: 'other' }] })
  const first = node('first'), second = node('second')
  try {
    state.values.editingRecord.value = null
    state.values.setRecordElement(original.id, first); state.values.setRecordElement('other', second)
    state.route.query = { month: '2026-10', added: original.id }
    await Vue.nextTick(() => { state.route.query = { month: '2026-10', added: 'other' } })
    await Vue.nextTick(); await Vue.nextTick()
    assert.equal(first.focusCount, 0)
    assert.equal(first.scrollCount, 0)
    assert.equal(second.focusCount, 1)
    assert.equal(second.scrollCount, 1)
  } finally { state.dispose() }
})

test('新账单定位等待DOM时用户开始搜索，不被旧回调抢走焦点或清筛选', async () => {
  const state = mountBills(), target = node('receipt')
  try {
    state.values.editingRecord.value = null
    state.values.setRecordElement(original.id, target)
    state.route.query = { month: '2026-10', added: original.id }
    await Vue.nextTick(() => { state.values.searchText.value = '合成' })
    await Vue.nextTick()
    assert.equal(target.focusCount, 0)
    assert.equal(target.scrollCount, 0)
    assert.equal(state.values.searchText.value, '合成')
  } finally { state.dispose() }
})

test('连续翻页只由最新展开目标聚焦，正常单次展开仍定位到第一笔新增账单', async () => {
  const records = Array.from({ length: 121 }, (_, id) => ({ ...original, id: String(id) }))
  const state = mountBills({ records }), first = node('row60'), second = node('row120')
  try {
    state.values.editingRecord.value = null
    state.values.setRecordElement('60', first); state.values.setRecordElement('120', second)
    let pending = state.values.loadMoreRecords(); await pending
    assert.equal(first.focusCount, 1)
    first.focusCount = 0; first.scrollCount = 0
    state.values.visibleLimit.value = 60
    pending = state.values.loadMoreRecords()
    const next = state.values.loadMoreRecords()
    await Promise.all([pending, next])
    assert.equal(first.focusCount, 0)
    assert.equal(first.scrollCount, 0)
    assert.equal(second.focusCount, 1)
    assert.equal(second.scrollCount, 1)
  } finally { state.dispose() }
})

test('明细导出全部121笔未展开账单，随后只导出当前月收入/分类/搜索完整交集，不发请求或改原账本', () => {
  const records = Array.from({ length: 121 }, (_, id) => ({ ...original, id: String(id) }))
  records.push({ ...original, id: 'income', type: 'income', category: '工资', remark: '合成工资' },
    { ...original, id: 'other-month', date: '2026-09-03' }, { ...original, id: 'deleted', deletedAt: 'synthetic' })
  const before = JSON.stringify(records), state = mountBills({ records })
  try {
    state.values.editingRecord.value = null
    assert.equal(state.downloads.length, 0)
    state.values.exportBills()
    assert.equal(state.downloads[0].csv.split('\r\n').length, 124)
    assert.equal(state.downloads[0].filename, 'miaoji-bills-2026-10.csv')
    assert.equal(state.values.visibleLimit.value, 60)
    assert.match(state.values.notice.value, /已发起下载 122 笔/)
    state.values.selectedType.value = 'income'; state.values.selectedCategory.value = '工资'; state.values.searchText.value = '合成工资'
    state.values.exportBills()
    assert.equal(state.downloads[1].csv.split('\r\n').length, 3)
    assert.match(state.downloads[1].csv, /"收入","工资","0.29","合成工资"/)
    assert.equal(state.downloads[1].filename, 'miaoji-bills-2026-10-filtered.csv')
    assert.equal(JSON.stringify(records), before); assert.deepEqual(state.calls, [])
  } finally { state.dispose() }
})

test('明细读取错误/重读/保存/编辑/空结果时禁用导出，离页与账号切回后旧入口不能下载', () => {
  const state = mountBills({ server: true })
  try {
    state.values.exportBills(); assert.equal(state.downloads.length, 0)
    state.values.editingRecord.value = null
    for (const key of ['reloading', 'saving']) {
      state.values[key].value = true; assert.equal(state.values.exportUnavailable.value, true); state.values.exportBills(); state.values[key].value = false
    }
    state.store.storageError = '合成读取错误'; state.values.exportBills(); state.store.storageError = ''
    state.values.reloadError.value = '合成重读错误'; state.values.exportBills(); state.values.reloadError.value = ''
    state.values.searchText.value = '没有匹配'; state.values.exportBills(); state.values.searchText.value = ''
    assert.equal(state.downloads.length, 0)
    state.values.exportBills(); assert.equal(state.downloads.length, 1)
    state.auth.user = { id: 'other-owner' }; state.values.exportBills()
    state.auth.user = { id: 'synthetic-owner' }; state.values.exportBills()
    assert.equal(state.downloads.length, 1)
  } finally { state.dispose() }
  const disposed = mountBills()
  disposed.values.editingRecord.value = null; disposed.dispose(); disposed.values.exportBills()
  assert.equal(disposed.downloads.length, 0)
})

test('筛选小计用完整65笔而非60笔显示窗口，收支同名分类隔离、空结果和取消筛选均正确渲染', async () => {
  const previous = { document: globalThis.document, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot }
  globalThis.document = { activeElement: null, body: { style: {} }, addEventListener() {}, removeEventListener() {} }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const records = Array.from({ length: 65 }, (_, i) => ({ ...original, category: '其他', id: 'expense-' + i }))
  records.push({ ...original, category: '其他', id: 'income', type: 'income', amount: '1.00' })
  const state = mountBills({ records, template: true })
  const find = (node, label) => node.props?.['aria-label'] === label ? node : node.children.map(child => find(child, label)).find(Boolean)
  const text = node => (node.text || '') + node.children.map(text).join('')
  try {
    state.values.editingRecord.value = null
    state.values.chooseCategory({ type: 'expense', category: '其他' }); await Vue.nextTick()
    assert.equal(state.values.listedRecords.value.length, 65); assert.equal(state.values.displayedCount.value, 60)
    assert.equal(state.values.filteredTotals.value.expenseCents, 1885); assert.equal(state.values.filteredTotals.value.incomeCents, 0)
    assert.equal(state.values.monthTotals.value.incomeCents, 100)
    assert.match(text(find(state.root, '筛选结果汇总')), /筛选收入¥0.00筛选支出¥18.85/)
    state.values.chooseCategory({ type: 'income', category: '其他' }); await Vue.nextTick()
    assert.match(text(find(state.root, '筛选结果汇总')), /筛选收入¥1.00筛选支出¥0.00/)
    state.values.searchText.value = '不存在'; await Vue.nextTick()
    assert.equal(state.values.listedRecords.value.length, 0)
    assert.match(text(find(state.root, '筛选结果汇总')), /筛选收入¥0.00筛选支出¥0.00/)
    await state.values.resetFilters(); await Vue.nextTick()
    assert.equal(find(state.root, '筛选结果汇总'), undefined)
    assert.equal(state.values.monthTotals.value.expenseCents, 1885); assert.deepEqual(state.calls, [])
  } finally { state.dispose(); Object.assign(globalThis, previous) }
})

test('筛选大额小计按整数分累加，超过单笔上限仍准确并使用宽金额排版', async () => {
  const records = [0, 1].map(i => ({ ...original, id: 'large-' + i, amount: '999999999.99' }))
  const state = mountBills({ records, template: true })
  const find = node => node.props?.['aria-label'] === '筛选结果汇总' ? node : node.children.map(find).find(Boolean)
  const text = node => (node.text || '') + node.children.map(text).join('')
  try {
    state.values.editingRecord.value = null; state.values.chooseType('expense'); await Vue.nextTick()
    assert.equal(state.values.filteredTotals.value.error, '')
    assert.equal(state.values.filteredTotals.value.expenseCents, 199999999998)
    assert.equal(state.values.needsWideFilteredAmounts.value, true)
    assert.match(text(find(state.root)), /¥1999999999.98/)
    assert.deepEqual(state.calls, []); assert.deepEqual(records.map(record => record.amount), ['999999999.99', '999999999.99'])
  } finally { state.dispose() }
})

test('CSV字段错误与下载失败明确提示未完成，不能出现已保存文件的回执', () => {
  for (const options of [{ records: [{ ...original, amount: '0.291' }] }, { downloadFailure: true }]) {
    const state = mountBills(options)
    try {
      state.values.editingRecord.value = null; state.values.exportBills()
      assert.match(state.values.exportError.value, /导出未完成/)
      assert.equal(state.values.notice.value, ''); assert.equal(state.downloads.length, 0)
      assert.equal(state.calls.length, 0)
    } finally { state.dispose() }
  }
})

test('查看全部同步清来源地址筛选，保当前月份/hash/added和其他参数，成功后才恢复搜索焦点', async () => {
  let finish
  const state = mountBills({ replace: () => new Promise(resolve => { finish = resolve }) }), input = node('search')
  try {
    state.values.editingRecord.value = null; state.values.searchInput.value = input
    state.route.query = { month: '2024-02', q: '合成', type: 'expense', category: '餐饮', added: 'keep-highlight', extra: ['a', 'b'] }
    state.route.hash = '#source'; state.values.selectedMonth.value = '2024-03'
    const before = JSON.stringify(state.store.records), pending = state.values.resetFilterAddress()
    assert.equal(state.values.resettingFilters.value, true); assert.equal(input.focusCount, 0)
    assert.equal(state.values.searchText.value, '合成')
    assert.equal(await state.values.resetFilterAddress(), false)
    state.values.chooseType('income'); state.values.chooseCategory({ type: 'income', category: '工资' })
    state.values.changeMonth(1); state.values.chooseMonth('2024-05'); state.values.edit(original)
    await state.values.clearSearch()
    assert.equal(state.values.selectedType.value, 'expense'); assert.equal(state.values.selectedMonth.value, '2024-03')
    assert.equal(state.values.editingRecord.value, null); assert.equal(state.values.copyLinkUnavailable.value, true)
    assert.equal(state.values.exportUnavailable.value, true); assert.equal(state.calls.length, 1)
    assert.deepEqual(state.calls[0], ['replace', { path: '/bills', query: { month: '2024-03', added: 'keep-highlight', extra: ['a', 'b'] }, hash: '#source' }])
    finish(undefined); assert.equal(await pending, true)
    assert.equal(state.values.resettingFilters.value, false); assert.equal(input.focusCount, 1)
    assert.equal(state.values.searchText.value, ''); assert.equal(state.values.selectedType.value, 'all')
    assert.equal(state.values.selectedCategory.value, ''); assert.equal(state.route.query.month, '2024-03')
    assert.equal(JSON.stringify(state.store.records), before)
  } finally { state.dispose() }
})

test('重置地址失败保旧筛选且可显式重试，不抛未处理拒绝或写账本', async () => {
  for (const rejection of [false, true]) {
    let failing = true
    const state = mountBills({ replace: async () => { if (failing) { if (rejection) throw Error('合成守卫失败'); return { type: 4 } } } }), input = node('search')
    try {
      state.values.editingRecord.value = null; state.values.searchInput.value = input
      state.route.query = { month: '2024-02', q: '原关键词', type: 'income', category: '工资' }
      assert.equal(await state.values.resetFilterAddress(), false)
      assert.equal(state.values.searchText.value, '原关键词'); assert.equal(state.values.selectedType.value, 'income')
      assert.equal(state.values.selectedCategory.value, '工资'); assert.equal(input.focusCount, 0)
      assert.match(state.values.notice.value, /原条件已保留/); assert.equal(state.values.resettingFilters.value, false)
      failing = false; assert.equal(await state.values.resetFilterAddress(), true)
      assert.equal(state.values.searchText.value, ''); assert.equal(input.focusCount, 1)
      assert.equal(state.calls.length, 2); assert(state.calls.every(call => call[0] === 'replace'))
    } finally { state.dispose() }
  }
})

test('重置地址等待中身份切换/离页不恢复旧焦点或清新输入，入口阻断时0导航', async () => {
  for (const change of [state => { state.auth.user = { id: 'other-owner' } }, state => state.dispose()]) {
    let finish
    const state = mountBills({ server: true, replace: () => new Promise(resolve => { finish = resolve }) }), input = node('search')
    try {
      state.values.editingRecord.value = null; state.values.searchInput.value = input
      state.route.query = { month: '2024-02', q: '合成' }
      const pending = state.values.resetFilterAddress(); change(state); state.values.searchText.value = '新输入'
      finish({ type: 8 }); assert.equal(await pending, false)
      assert.equal(input.focusCount, 0); assert.equal(state.values.searchText.value, '新输入')
      assert.equal(state.values.notice.value, '')
    } finally { state.dispose() }
  }
  const state = mountBills({ server: true })
  try {
    assert.equal(await state.values.resetFilterAddress(), false); assert.equal(state.calls.length, 0)
    state.values.editingRecord.value = null; state.auth.user = { id: 'other' }
    assert.equal(await state.values.resetFilterAddress(), false); assert.equal(state.calls.length, 0)
  } finally { state.dispose() }
})

test('只清搜索地址保当前收支分类而非旧链接条件，拒重复且不写账本', async () => {
  const state = mountBills(), input = node('search')
  try {
    state.values.editingRecord.value = null; state.values.searchInput.value = input
    state.route.query = { month: '2024-02', q: '旧关键词', type: 'expense', category: '餐饮', added: 'keep-highlight' }
    state.route.hash = '#search'; state.values.chooseCategory({ type: 'income', category: '工资' })
    const pending = state.values.clearSearchAddress()
    assert.equal(await state.values.clearSearchAddress(), false)
    assert.equal(await pending, true)
    assert.equal(state.values.searchText.value, ''); assert.equal(state.values.selectedType.value, 'income')
    assert.equal(state.values.selectedCategory.value, '工资'); assert.equal(input.focusCount, 1)
    assert.deepEqual(state.route.query, { month: '2024-02', type: 'income', category: '工资', added: 'keep-highlight' })
    assert.equal(state.route.hash, '#search'); assert.equal(state.calls.length, 1)
  } finally { state.dispose() }
})

test('只清搜索地址失败保输入及分类，不自动重发或旧焦点抢占', async () => {
  const state = mountBills({ replace: async () => ({ type: 4 }) }), input = node('search')
  try {
    state.values.editingRecord.value = null; state.values.searchInput.value = input
    state.route.query = { month: '2024-02', q: '原关键词', type: 'income', category: '工资' }
    assert.equal(await state.values.clearSearchAddress(), false)
    assert.equal(state.values.searchText.value, '原关键词'); assert.equal(state.values.selectedCategory.value, '工资')
    assert.equal(input.focusCount, 0); assert.equal(state.calls.length, 1)
  } finally { state.dispose() }
})

test('来源地址没有筛选时查看全部仅清本地条件，不导航、不读写账本', async () => {
  const state = mountBills(), input = node('search')
  try {
    state.values.editingRecord.value = null; state.values.searchInput.value = input
    state.values.searchText.value = '本页关键词'
    assert.equal(await state.values.resetFilterAddress(), true)
    assert.equal(state.values.searchText.value, ''); assert.equal(input.focusCount, 1)
    assert.equal(state.calls.length, 0)
  } finally { state.dispose() }
})

test('查看全部清三种筛选并保月份，重复操作仅最新回调聚焦搜索，无账本请求', async () => {
  const state = mountBills(), input = node('search')
  try {
    state.values.editingRecord.value = null; state.values.searchInput.value = input
    state.values.selectedMonth.value = '2024-02'; state.values.searchText.value = '合成'
    state.values.selectedType.value = 'expense'; state.values.selectedCategory.value = '餐饮'
    await Promise.all([state.values.resetFilters(), state.values.resetFilters()])
    assert.equal(state.values.selectedMonth.value, '2024-02')
    assert.equal(state.values.searchText.value, ''); assert.equal(state.values.selectedType.value, 'all')
    assert.equal(state.values.selectedCategory.value, ''); assert.equal(input.focusCount, 1)
    assert.equal(state.calls.length, 0)
  } finally { state.dispose() }
})

test('查看全部等待DOM时新搜索/收支/分类/月份/编辑/身份/离页不被旧焦点抢占', async () => {
  for (const change of [state => { state.values.searchText.value = '新关键词' },
    state => { state.values.selectedType.value = 'income' }, state => { state.values.selectedCategory.value = '工资' },
    state => { state.values.selectedMonth.value = '2024-03' }, state => state.values.edit(original),
    state => { state.auth.user = { id: 'other-owner' } }, state => state.dispose()]) {
    const state = mountBills({ server: true }), input = node('search')
    try {
      state.values.editingRecord.value = null; state.values.searchInput.value = input
      state.values.searchText.value = '合成'; state.values.selectedType.value = 'expense'
      const pending = state.values.resetFilters(); change(state); await pending
      assert.equal(input.focusCount, 0); assert.equal(state.calls.length, 0)
    } finally { state.dispose() }
  }
})

test('旧账号/离页/编辑或保存中查看全部不清筛选，也不聚焦或发请求', async () => {
  for (const change of [state => { state.auth.user = { id: 'other-owner' } }, state => state.dispose(),
    state => state.values.edit(original), state => { state.values.saving.value = true }]) {
    const state = mountBills({ server: true }), input = node('search')
    try {
      state.values.editingRecord.value = null; state.values.searchInput.value = input
      state.values.searchText.value = '保留输入'; state.values.selectedType.value = 'expense'; state.values.selectedCategory.value = '餐饮'
      change(state); await state.values.resetFilters()
      assert.equal(state.values.searchText.value, '保留输入'); assert.equal(state.values.selectedType.value, 'expense')
      assert.equal(state.values.selectedCategory.value, '餐饮'); assert.equal(input.focusCount, 0)
      assert.equal(state.calls.length, 0)
    } finally { state.dispose() }
  }
})

test('清除搜索正常聚焦一次，重复清除仅最新回调聚焦', async () => {
  const state = mountBills(), input = node('search')
  try {
    state.values.editingRecord.value = null; state.values.searchInput.value = input; state.values.searchText.value = '合成'
    await state.values.clearSearch()
    assert.equal(state.values.searchText.value, ''); assert.equal(input.focusCount, 1)
    input.focusCount = 0
    await Promise.all([state.values.clearSearch(), state.values.clearSearch()])
    assert.equal(input.focusCount, 1)
  } finally { state.dispose() }
})

test('清除搜索await期间新搜索/编辑/切月/切分类/账号切换/离页不被旧焦点回调抢占', async () => {
  for (const change of [state => { state.values.searchText.value = '新关键词' }, state => state.values.edit(original),
    state => { state.values.selectedMonth.value = '2026-11' }, state => { state.values.selectedCategory.value = '餐饮' },
    state => { state.auth.user = { id: 'other-owner' } }, state => state.dispose()]) {
    const state = mountBills({ server: true }), input = node('search')
    try {
      state.values.editingRecord.value = null; state.values.searchInput.value = input; state.values.searchText.value = '合成'
      const pending = state.values.clearSearch()
      change(state); await pending
      assert.equal(input.focusCount, 0)
    } finally { state.dispose() }
  }
})

test('离页或旧账号清除入口不清新输入也不聚焦', async () => {
  for (const change of [state => state.dispose(), state => { state.auth.user = { id: 'other-owner' } }]) {
    const state = mountBills({ server: true }), input = node('search')
    try {
      state.values.editingRecord.value = null; state.values.searchInput.value = input; state.values.searchText.value = '保留输入'
      change(state); await state.values.clearSearch()
      assert.equal(state.values.searchText.value, '保留输入'); assert.equal(input.focusCount, 0)
    } finally { state.dispose() }
  }
})

test('复制当前refs的筛选链接包含空结果条件，重复点击只写一次，不导航或读写账本', async () => {
  const writes = []; let finish
  const state = mountBills({ records: [], clipboard: { writeText: text => { writes.push(text); return new Promise(done => { finish = done }) } } })
  try {
    state.values.editingRecord.value = null
    state.values.selectedMonth.value = '2026-09'; state.values.searchText.value = '咖啡 & +/#'
    state.values.selectedType.value = 'expense'; state.values.selectedCategory.value = '餐饮'
    state.store.refresh = () => { throw Error('复制不得读取账本') }
    const pending = state.values.copyFilterLink()
    assert.equal(state.values.copyingLink.value, true)
    assert.equal(await state.values.copyFilterLink(), false)
    assert.equal(writes.length, 1)
    const url = new URL(writes[0])
    assert.equal(url.origin, 'http://127.0.0.1:5174'); assert.equal(url.pathname, '/bills')
    assert.deepEqual(Object.fromEntries(url.searchParams), { month: '2026-09', q: '咖啡 & +/#', type: 'expense', category: '餐饮' })
    assert.deepEqual(state.route.query, { month: '2026-10' }); assert.deepEqual(state.calls, [])
    finish(); assert.equal(await pending, true)
    assert.equal(state.values.copyingLink.value, false); assert.match(state.values.filterLinkMessage.value, /已复制/)
    assert.equal(state.values.filterLinkText.value, '')
  } finally { state.dispose() }
})

test('剪贴板不支持或失败提供相同链接手动复制，重试成功清除文本', async () => {
  for (const clipboard of [{}, { writeText: () => { throw Error('合成拒绝') } }, { writeText: async () => { throw Error('合成异步拒绝') } }]) {
    const state = mountBills({ clipboard })
    try {
      state.values.editingRecord.value = null
      assert.equal(await state.values.copyFilterLink(), false)
      assert.equal(state.values.filterLinkText.value, 'http://127.0.0.1:5174/bills?month=2026-10')
      assert.match(state.values.filterLinkMessage.value, /手动复制/)
      clipboard.writeText = async () => {}
      assert.equal(await state.values.copyFilterLink(), true)
      assert.equal(state.values.filterLinkText.value, '')
      assert.match(state.values.filterLinkMessage.value, /已复制/)
    } finally { state.dispose() }
  }
})

test('复制等待期间筛选变化再恢复或进入编辑，旧成功/失败不显示，当前条件仍可重新复制', async () => {
  for (const change of [state => { state.values.searchText.value = '新搜索'; state.values.searchText.value = '' },
    state => { state.values.selectedMonth.value = '2026-11' }, state => { state.values.selectedType.value = 'income' },
    state => { state.values.selectedCategory.value = '工资' }, state => state.values.edit(original)]) {
    for (const rejected of [false, true]) {
      let finish, fail
      const clipboard = { writeText: () => new Promise((resolve, reject) => { finish = resolve; fail = reject }) }
      const state = mountBills({ clipboard })
      try {
        state.values.editingRecord.value = null
        const pending = state.values.copyFilterLink(); change(state)
        if (rejected) fail(Error('合成拒绝')); else finish()
        assert.equal(await pending, false)
        assert.equal(state.values.filterLinkMessage.value, ''); assert.equal(state.values.filterLinkText.value, '')
        assert.equal(state.values.copyingLink.value, false)
        state.values.editingRecord.value = null; clipboard.writeText = async () => {}
        assert.equal(await state.values.copyFilterLink(), true)
      } finally { state.dispose() }
    }
  }
})

test('离页和身份变化再切回永久拒绝旧复制入口及迟到回执，不继续系统剪贴板操作', async () => {
  for (const leave of [state => state.dispose(), state => { state.auth.user = { id: 'other' }; state.auth.user = { id: 'synthetic-owner' } }]) {
    for (const rejected of [false, true]) {
      let finish, fail, writes = 0
      const state = mountBills({ server: true, clipboard: { writeText: () => { writes++; return new Promise((resolve, reject) => { finish = resolve; fail = reject }) } } })
      try {
        state.values.editingRecord.value = null
        const pending = state.values.copyFilterLink(); leave(state)
        if (rejected) fail(Error('合成拒绝')); else finish()
        assert.equal(await pending, false)
        assert.equal(state.values.filterLinkMessage.value, ''); assert.equal(state.values.filterLinkText.value, '')
        assert.equal(await state.values.copyFilterLink(), false); assert.equal(writes, 1)
      } finally { state.dispose() }
    }
  }
})

test('编辑或保存期间拒绝复制，筛选变化和账号失效撤下手动链接', async () => {
  const state = mountBills({ server: true })
  try {
    assert.equal(await state.values.copyFilterLink(), false)
    state.values.editingRecord.value = null; state.values.saving.value = true
    assert.equal(await state.values.copyFilterLink(), false)
    state.values.saving.value = false
    await state.values.copyFilterLink(); assert.ok(state.values.filterLinkText.value)
    state.values.searchText.value = '新搜索'
    assert.equal(state.values.filterLinkText.value, ''); assert.equal(state.values.filterLinkMessage.value, '')
    await state.values.copyFilterLink(); assert.ok(state.values.filterLinkText.value)
    state.auth.user = null
    assert.equal(state.values.filterLinkText.value, ''); assert.equal(state.values.filterLinkMessage.value, '')
    assert.equal(await state.values.copyFilterLink(), false)
  } finally { state.dispose() }
})

test('明细已打开编辑后重复或其他记录旧入口不替换当前目标，保存沿用首笔id和版本', async () => {
  const state = mountBills({ server: true })
  try {
    const snapshot = { ...state.values.editingRecord.value }
    state.values.saveError.value = '保留待复核错误'
    state.values.edit({ ...original, id: 'other', version: 9, remark: '不得替换' })
    state.values.edit({ ...original, remark: '重复入口也不得重置' })
    assert.deepEqual(state.values.editingRecord.value, snapshot)
    assert.equal(state.values.saveError.value, '保留待复核错误')
    const pending = state.values.saveEdit({ amount: 12.34 })
    state.finish({ ...snapshot, amount: 12.34 }); await pending
    assert.equal(state.calls[0][1], snapshot.id)
    assert.deepEqual(state.calls[0][3], { version: snapshot.version })
    state.values.edit({ ...original, id: 'other', version: 9 })
    assert.equal(state.values.editingRecord.value.id, 'other')
  } finally { state.dispose() }
})

test('明细身份首次变化再切回，旧编辑/保存/删除/采用冲突入口不能操作或改旧输入', async () => {
  const state = mountBills({ server: true })
  try {
    state.values.editConflict.value = { current: { ...original, version: 3 } }
    state.values.saveError.value = '保留旧错误'
    state.auth.user = { id: 'other' }; state.auth.user = { id: 'synthetic-owner' }
    state.values.adoptLatestVersion()
    state.values.edit({ ...original, remark: '不得替换旧输入' })
    const pending = state.values.saveEdit({ amount: 12.34 })
    if (state.calls.length) state.finish({ ...original })
    await pending
    const deletion = state.values.deleteEdit()
    if (state.calls.length > 1) state.finish()
    await deletion
    assert.deepEqual(state.calls, [])
    assert.equal(state.values.editingRecord.value.version, 2)
    assert.equal(state.values.editingRecord.value.remark, original.remark)
    assert.equal(state.values.saveError.value, '保留旧错误')
  } finally { state.dispose() }
})

test('明细身份切回后的旧保存和删除入口各自不发Store请求', async () => {
  for (const action of ['saveEdit', 'deleteEdit']) {
    const state = mountBills({ server: true })
    try {
      state.auth.user = null; state.auth.user = { id: 'synthetic-owner' }
      const pending = state.values[action]({ amount: 12.34 })
      if (state.calls.length) state.finish({ ...original })
      await pending
      assert.deepEqual(state.calls, [])
    } finally { state.dispose() }
  }
})

test('复制禁用状态已缓存为可用时离页，旧入口仍不调用系统剪贴板', async () => {
  let writes = 0
  const state = mountBills({ clipboard: { writeText: async () => { writes++ } } })
  try {
    state.values.editingRecord.value = null
    assert.equal(state.values.copyLinkUnavailable.value, false)
    state.dispose()
    assert.equal(await state.values.copyFilterLink(), false)
    assert.equal(writes, 0)
  } finally { state.dispose() }
})

test('编辑或删除等待身份变化再切回，迟到成功/冲突不回填，不改月/关闭旧输入或聚焦', async () => {
  for (const action of ['saveEdit', 'deleteEdit']) {
    for (const rejected of [false, true]) {
      const state = mountBills({ server: true })
      try {
        const pending = state.values[action]({ amount: 12.34 })
        state.auth.user = null; state.auth.user = { id: 'synthetic-owner' }
        if (rejected) state.fail(Object.assign(Error('合成旧冲突'), { recoveryLoaded: true, currentRecord: { ...original, version: 3 } }))
        else state.finish({ ...original, date: '2026-11-02' })
        await pending
        assert.equal(state.values.selectedMonth.value, '2026-10')
        assert.equal(state.values.editingRecord.value.id, original.id)
        assert.equal(state.values.notice.value, ''); assert.equal(state.values.saveError.value, '')
        assert.equal(state.values.editConflict.value, null); assert.equal(state.focusTarget.focusCount, 0)
      } finally { state.dispose() }
    }
  }
})

function hasClass(root, className) { return typeof root.props.class === 'string' && root.props.class.split(' ').includes(className) || root.children.some(child => hasClass(child, className)) }

test('实际Bills模板身份变化撤下旧搜索和编辑窗口，切回不复活，账本/输入快照保留', async () => {
  const previousDocument = globalThis.document, previousDocumentType = globalThis.Document, previousShadowType = globalThis.ShadowRoot
  globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {} }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const state = mountBills({ server: true, template: true })
  try {
    state.values.searchText.value = '私有搜索'; state.values.editingRecord.value.remark = '私有未保存输入'
    await Vue.nextTick()
    assert.equal(hasClass(state.root, 'synthetic-editor'), true)
    assert.equal(hasClass(state.root, 'bills-search-card'), true)
    state.auth.user = null; await Vue.nextTick()
    const hidden = !hasClass(state.root, 'synthetic-editor') && !hasClass(state.root, 'bills-search-card')
    state.auth.user = { id: 'synthetic-owner' }; await Vue.nextTick()
    assert.equal(hidden, true)
    assert.equal(hasClass(state.root, 'synthetic-editor'), false); assert.equal(hasClass(state.root, 'bills-search-card'), false)
    assert.equal(state.values.searchText.value, '私有搜索')
    assert.equal(state.values.editingRecord.value.remark, '私有未保存输入')
    assert.equal(state.store.records.length, 1)
  } finally { state.dispose(); globalThis.document = previousDocument; globalThis.Document = previousDocumentType; globalThis.ShadowRoot = previousShadowType }
})

function mountDraftGroup(group) {
  const previousDocument = globalThis.document
  globalThis.document = { body: { style: { overflow: 'scroll' } } }
  const forms = [], events = [], draft = source('components/common/DraftGroupCard.vue')
  const props = Vue.reactive({ group, savedRecords: [], busy: false, saving: false, error: '' })
  let values
  const Group = { props: ['group', 'savedRecords', 'busy', 'saving', 'error'], components: { RecordEditor: editorComponent(forms),
    CategoryIcon: { render: () => Vue.h('span') }, RouterLink: { render: () => Vue.h('span') } },
    setup(componentProps, context) {
      values = evaluate(draft.script, { ...Vue, centsText, legacyCents, defineProps: () => componentProps, defineEmits: () => context.emit },
        'props, emit, editing, editRecord, update, items, saved, status, deletedCount, statusLabel, totals, centsText')
      return values
    }, render: new Function('Vue', compile(draft.template, { mode: 'function' }).code)(Vue) }
  Group.render._rc = true
  const app = renderer.createApp({ render: () => Vue.h(Group, { ...props, onUpdate: value => events.push(value) }) }), root = node('root')
  app.mount(root)
  return { props, values, forms, events, root, dispose() { app.unmount(); globalThis.document = previousDocument } }
}

test('实际AI草稿卡→Editor→Form仅改金额时保留已定时间（未说时间自动补记录时刻），显式午夜/其他时间仍原样提交', async () => {
  for (const time of [undefined, '00:00', '09:15']) {
    const api = createAiDraftApi({ request: async () => ({ model: 'glm-4-flash-250414', status: 'ready', question: '',
      records: [{ type: 'expense', amount: '25.00', date: '2026-10-04', category: '餐饮', note: '合成午饭', ...(time ? { time } : {}) }] }) })
    const { group } = await api.parse('合成午饭25', { date: '2026-10-04' })
    const expected = time ?? group.items[0].time
    assert.match(expected, /^\d{2}:\d{2}$/)
    const snapshot = JSON.stringify(group), state = mountDraftGroup(group)
    try {
      state.values.editing.value = group.items[0].id; await Vue.nextTick()
      const form = state.forms[0]
      assert.equal(form.form.value.time, expected)
      form.form.value.amount = '16.00'; form.save()
      assert.equal(state.events.length, 1)
      assert.equal(state.events[0].record.amount, 16)
      assert.equal(state.events[0].record.time, expected)
      assert.equal(JSON.stringify(group), snapshot)
    } finally { state.dispose() }
  }
  const legacyApi = createAiDraftApi({ request: async () => ({ model: 'glm-4-flash-250414', status: 'ready', question: '',
    records: [{ type: 'expense', amount: '25.00', date: '2026-10-04', category: '餐饮', note: '合成午饭' }] }) })
  const legacy = (await legacyApi.parse('合成午饭25', { date: '2026-10-04' })).group
  delete legacy.items[0].time
  const legacyState = mountDraftGroup(legacy)
  try {
    legacyState.values.editing.value = legacy.items[0].id; await Vue.nextTick()
    const form = legacyState.forms[0]
    assert.equal(form.form.value.time, '')
    form.form.value.amount = '16.00'; form.save()
    assert.equal(legacyState.events.length, 1)
    assert.equal(legacyState.events[0].record.amount, 16)
    assert.equal(Object.hasOwn(legacyState.events[0].record, 'time'), false)
  } finally { legacyState.dispose() }
})

async function syntheticAiGroup() {
  return (await createAiDraftApi({ request: async () => ({ model: 'glm-4-flash-250414', status: 'ready', question: '',
    records: [{ type: 'expense', amount: '25.00', date: '2026-10-04', category: '餐饮', note: '合成午饭' }] }) })
    .parse('午饭25', { date: '2026-10-04' })).group
}

test('草稿整理或重读只显示处理中，真实入账才显示保存，所有等待均禁确认/取消/编辑', async () => {
  const state = mountDraftGroup(await syntheticAiGroup())
  const textTree = root => root.text + root.children.map(textTree).join('')
  const buttons = root => [ ...(root.tag === 'button' ? [root] : []), ...root.children.flatMap(buttons) ]
  try {
    state.props.busy = true; await Vue.nextTick()
    assert.match(textTree(state.root), /处理中…/); assert.doesNotMatch(textTree(state.root), /正在保存/)
    assert.equal(buttons(state.root).every(button => button.props.disabled), true)
    state.props.saving = true; await Vue.nextTick()
    assert.match(textTree(state.root), /正在保存…/)
    state.props.busy = false; await Vue.nextTick()
    assert.equal(buttons(state.root).every(button => button.props.disabled), true)
    assert.match(textTree(state.root), /正在保存…/)
    state.props.saving = false; await Vue.nextTick()
    assert.match(textTree(state.root), /确认记下1笔/)
    assert.equal(buttons(state.root).some(button => button.props.disabled), false)
  } finally { state.dispose() }
})

test('草稿卡忙碌时已打开的表单与旧更新回调均不提交或关闭，结束后保留输入可更新', async () => {
  const group = await syntheticAiGroup(), state = mountDraftGroup(group)
  try {
    state.values.editing.value = group.items[0].id; await Vue.nextTick()
    const form = state.forms[0]; form.form.value.amount = '16.00'; form.form.value.remark = '尚未更新草稿'
    state.props.busy = true; await Vue.nextTick()
    form.save(); state.values.update({ ...original, amount: 18 })
    assert.deepEqual(state.events, [])
    assert.equal(state.values.editing.value, group.items[0].id)
    assert.equal(form.form.value.amount, '16.00'); assert.equal(form.form.value.remark, '尚未更新草稿')
    state.props.busy = false; await Vue.nextTick(); form.save()
    assert.equal(state.events.length, 1); assert.equal(state.events[0].record.amount, 16)
    assert.equal(state.events[0].record.remark, '尚未更新草稿')
  } finally { state.dispose() }
})

test('实际草稿编辑窗口明确只更新草稿，已保存账单窗口保持同步说明', async () => {
  const group = await syntheticAiGroup(), state = mountDraftGroup(group)
  const textTree = root => root.text + root.children.map(textTree).join('')
  try {
    state.values.editing.value = group.items[0].id; await Vue.nextTick()
    const text = textTree(state.root)
    assert.match(text, /编辑这笔草稿/)
    assert.match(text, /确认整组后才会入账/)
    assert.doesNotMatch(text, /保存后，明细、首页和聊天查询都会使用最新数据/)
  } finally { state.dispose() }
  const existing = mountEditor()
  try { assert.match(textTree(existing.root), /保存后，明细、首页和聊天查询都会使用最新数据/) }
  finally { existing.dispose() }
})

test('草稿已保存或取消时撤下旧编辑窗口，旧回调不更新或改变原输入快照', async () => {
  for (const status of ['saved', 'cancelled']) {
    const group = await syntheticAiGroup(), state = mountDraftGroup(group)
    try {
      state.values.editing.value = group.items[0].id; await Vue.nextTick()
      const form = state.forms[0]; form.form.value.amount = '16.00'
      state.props.group = { ...group, status }; await Vue.nextTick()
      const visible = hasClass(state.root, 'bill-editor')
      state.values.update({ ...original, amount: 18 })
      assert.equal(visible, false); assert.deepEqual(state.events, [])
      assert.equal(form.form.value.amount, '16.00')
    } finally { state.dispose() }
  }
})

test('实际明细日期筛选保整月总额，搜索清空保日期，CSV/复制/再记一笔携带当天，查看全部与切月清日期', async () => {
  const day = { ...original, amount:32, date:'2026-10-04', remark:'当天午饭' }
  const other = { ...original, id:'other-day', amount:5, date:'2026-10-05', remark:'提及2026-10-04当天午饭' }
  const env = mountBills({ records:[day,other], server:true })
  const v = env.values
  try {
    v.editingRecord.value = null
    env.route.query = { month:'2026-10', date:'2026-10-04', q:'午饭' }
    assert.deepEqual(v.listedRecords.value.map(r => r.id), [day.id])
    assert.equal(v.monthTotals.value.expenseCents, 3700); assert.equal(v.filteredTotals.value.expenseCents, 3200)
    await v.clearSearchAddress(); assert.equal(v.searchText.value, ''); assert.equal(v.selectedDate.value, '2026-10-04')
    v.exportBills(); assert.equal(env.downloads.length, 1); assert.equal(env.downloads[0].filename, 'miaoji-bills-2026-10-04-filtered.csv'); assert.match(env.downloads[0].csv, /32\.00/); assert.doesNotMatch(env.downloads[0].csv, /提及/)
    await v.copyFilterLink(); assert.equal(new URL(v.filterLinkText.value).searchParams.get('date'), '2026-10-04')
    v.edit(day); await v.repeatRecord()
    const target = env.calls.find(c => c[0] === 'navigate')[1]
    assert.equal(new URL(target.query.returnTo, 'https://example.test').searchParams.get('date'), '2026-10-04')
    v.editingRecord.value = null; await v.resetFilterAddress()
    assert.equal(v.selectedDate.value, ''); assert.equal(env.route.query.date, undefined); assert.equal(v.listedRecords.value.length, 2)
    env.route.query = { month:'2026-10', date:'2026-10-04' }
    await v.chooseMonth('2026-09'); assert.equal(v.selectedDate.value, ''); assert.equal(env.route.query.date, undefined)
  } finally { env.dispose() }
})

test('独立清日期保最新文字/收支/分类与hash，失败不提前清，等待与编辑不重复导航', async () => {
  let resolve
  const env = mountBills({ server:true, replace: () => new Promise(done => { resolve = done }) })
  const v = env.values
  try {
    v.editingRecord.value = null; env.route.hash = '#source'
    env.route.query = { month:'2026-10', date:'2026-10-03', q:'旧', type:'expense', category:'餐饮' }
    v.searchText.value = '最新午饭'
    const target = node('search'); v.searchInput.value = target
    const pending = v.clearDateAddress()
    assert.equal(v.selectedDate.value, '2026-10-03'); assert.equal(v.resettingFilters.value, true)
    assert.equal(await v.clearDateAddress(), false); assert.equal(env.calls.filter(c => c[0] === 'replace').length, 1)
    resolve({ type:4 }); assert.equal(await pending, false)
    assert.equal(v.selectedDate.value, '2026-10-03'); assert.equal(v.searchText.value, '最新午饭'); assert.equal(target.focusCount, 0)
    const retry = v.clearDateAddress(); resolve(undefined); assert.equal(await retry, true)
    assert.equal(v.selectedDate.value, ''); assert.equal(v.searchText.value, '最新午饭'); assert.equal(v.selectedType.value, 'expense'); assert.equal(v.selectedCategory.value, '餐饮')
    assert.deepEqual(env.route.query, { month:'2026-10', q:'最新午饭', type:'expense', category:'餐饮' }); assert.equal(env.route.hash, '#source')
    assert.equal(target.focusCount, 1)
    env.route.query = { month:'2026-10', date:'2026-10-03' }; v.edit(original)
    assert.equal(await v.clearDateAddress(), false); assert.equal(v.selectedDate.value, '2026-10-03')
    v.editingRecord.value = null; env.auth.user.id = 'other-owner'
    assert.equal(await v.clearDateAddress(), false); assert.equal(v.selectedDate.value, '2026-10-03')
  } finally { env.dispose() }
})

const datePickerSource = source('components/common/DatePicker.vue')
function mountPicker(initial = {}) {
  const props = Vue.reactive({ month: '2026-10', date: '', disabled: false, label: '选择日期', ...initial })
  const events = []
  const values = evaluate(datePickerSource.script, { ...Vue, dayjs, isValidMonth, validDate,
    defineProps: () => props, defineEmits: () => (...args) => events.push(args) }, 'select, minimum, maximum')
  return { props, events, values, change(value, valid = true) {
    const input = { value, validity: { valid } }
    values.select({ target: input })
    return input
  } }
}

test('DatePicker边界跟随所选月份并覆盖闰年二月，无效月份不设置限制', () => {
  const picker = mountPicker()
  assert.equal(picker.values.minimum.value, '2026-10-01'); assert.equal(picker.values.maximum.value, '2026-10-31')
  picker.props.month = '2026-02'
  assert.equal(picker.values.minimum.value, '2026-02-01'); assert.equal(picker.values.maximum.value, '2026-02-28')
  picker.props.month = '2024-02'; assert.equal(picker.values.maximum.value, '2024-02-29')
  picker.props.month = '0999-12'; assert.equal(picker.values.minimum.value, ''); assert.equal(picker.values.maximum.value, '')
  picker.props.month = ''; assert.equal(picker.values.minimum.value, ''); assert.equal(picker.values.maximum.value, '')
})

test('DatePicker仅同月合法且与当前值不同的选择发出事件，清空/同值/禁用/越界恢复受控值', () => {
  const picker = mountPicker({ date: '2026-10-02' })
  const chosen = picker.change('2026-10-04')
  assert.deepEqual(picker.events, [['select', '2026-10-04']]); assert.equal(chosen.value, '2026-10-02')
  assert.equal(picker.change('2026-10-02').value, '2026-10-02'); assert.equal(picker.events.length, 1)
  assert.equal(picker.change('', false).value, '2026-10-02'); assert.equal(picker.events.length, 1)
  // 伪造validity仍被月份前缀与日期校验的防御性检查拒绝
  assert.equal(picker.change('2026-09-30').value, '2026-10-02'); assert.equal(picker.events.length, 1)
  assert.equal(picker.change('2026-10-32').value, '2026-10-02'); assert.equal(picker.events.length, 1)
  picker.props.disabled = true
  assert.equal(picker.change('2026-10-05').value, '2026-10-02'); assert.equal(picker.events.length, 1)
})

test('实际Bills模板存储错误时撤下日期选择器，正常时提供选择入口与只看当天提示', async () => {
  const previousDocument = globalThis.document, previousDocumentType = globalThis.Document, previousShadowType = globalThis.ShadowRoot
  globalThis.document = { activeElement: null, addEventListener() {}, removeEventListener() {} }
  globalThis.Document = class {}; globalThis.ShadowRoot = class {}
  const state = mountBills({ server: true, template: true })
  try {
    state.values.editingRecord.value = null
    await Vue.nextTick()
    assert.equal(hasClass(state.root, 'bills-day-picker'), true)
    assert.equal(hasClass(state.root, 'bills-date-filter'), false)
    state.values.selectedDate.value = '2026-10-04'; await Vue.nextTick()
    assert.equal(hasClass(state.root, 'bills-date-filter'), true)
    state.store.storageError = '合成读取错误'; await Vue.nextTick()
    assert.equal(hasClass(state.root, 'bills-day-picker'), false); assert.equal(hasClass(state.root, 'bills-date-filter'), false)
    state.store.storageError = ''; await Vue.nextTick()
    assert.equal(hasClass(state.root, 'bills-day-picker'), true); assert.equal(hasClass(state.root, 'bills-date-filter'), true)
  } finally { state.dispose(); globalThis.document = previousDocument; globalThis.Document = previousDocumentType; globalThis.ShadowRoot = previousShadowType }
})

test('明细直接选日保搜索/收支/分类/hash和其他参数，成功同步日期且不写账本', async () => {
  const state = mountBills({ server: true })
  try {
    state.values.editingRecord.value = null
    state.route.query = { month: '2026-10', q: '旧关键词', type: 'expense', category: '餐饮', added: 'keep-highlight', extra: ['a', 'b'] }
    state.route.hash = '#filter'; state.values.searchText.value = '最新关键词'
    const before = JSON.stringify(state.store.records)
    assert.equal(state.values.selectedDate.value, '')
    assert.equal(await state.values.chooseDate('2026-10-04'), true)
    assert.deepEqual(state.calls, [['replace', { path: '/bills', query: { month: '2026-10', date: '2026-10-04', q: '最新关键词', type: 'expense', category: '餐饮',
      added: 'keep-highlight', extra: ['a', 'b'] }, hash: '#filter' }]])
    assert.equal(state.values.selectedDate.value, '2026-10-04'); assert.equal(state.values.resettingFilters.value, false)
    assert.equal(state.values.searchText.value, '最新关键词'); assert.equal(state.values.selectedType.value, 'expense')
    assert.equal(state.values.selectedCategory.value, '餐饮'); assert.equal(JSON.stringify(state.store.records), before)
  } finally { state.dispose() }
})

test('明细选日接受同月首末日期，拒绝跨月跨年非法与错误类型且不导航', async () => {
  const state = mountBills({ server: true })
  try {
    state.values.editingRecord.value = null
    for (const date of ['', '2026-10', '2026-10-00', '2026-10-32', '2026-13-01', '2026-9-30', '0999-10-04', '2026-09-30', '2026-11-01', '2025-10-04', null, 20261004, ['2026-10-04']]) {
      assert.equal(await state.values.chooseDate(date), false)
    }
    assert.deepEqual(state.calls, [])
    assert.equal(await state.values.chooseDate('2026-10-01'), true)
    assert.equal(state.values.selectedDate.value, '2026-10-01')
    assert.equal(await state.values.chooseDate('2026-10-01'), false)
    assert.equal(await state.values.chooseDate('2026-10-31'), true)
    assert.equal(state.values.selectedDate.value, '2026-10-31')
    assert.deepEqual(state.calls.map(call => call[0]), ['replace', 'replace'])
    assert.deepEqual(state.store.records, [original])
  } finally { state.dispose() }
})

test('明细选日导航等待拒绝重复且不提前改日期，释放后同一日期可重试成功', async () => {
  let count = 0, finish
  const state = mountBills({ replace: () => { count++; return count === 1 ? new Promise(resolve => { finish = resolve }) : undefined } })
  try {
    state.values.editingRecord.value = null
    const pending = state.values.chooseDate('2026-10-04')
    assert.equal(state.values.resettingFilters.value, true); assert.equal(state.values.selectedDate.value, '')
    assert.equal(await state.values.chooseDate('2026-10-05'), false)
    assert.equal(state.values.selectedMonth.value, '2026-10'); assert.equal(state.calls.length, 1)
    finish({ type: 4 }); assert.equal(await pending, false)
    assert.equal(state.values.selectedDate.value, ''); assert.equal(state.values.resettingFilters.value, false)
    assert.match(state.values.notice.value, /日期暂时未能切换.*原条件已保留/)
    assert.equal(await state.values.chooseDate('2026-10-04'), true)
    assert.equal(state.values.selectedDate.value, '2026-10-04'); assert.equal(state.values.notice.value, '')
    assert.equal(state.calls.length, 2)
  } finally { state.dispose() }
})

test('明细选日导航抛错保持原日期和条件，离页或身份切换后的旧回执不提示', async () => {
  const state = mountBills({ replace: async () => { throw Error('合成守卫失败') } })
  try {
    state.values.editingRecord.value = null
    state.route.query = { month: '2026-10', q: '原关键词', type: 'expense', category: '餐饮' }
    assert.equal(await state.values.chooseDate('2026-10-04'), false)
    assert.equal(state.values.selectedDate.value, ''); assert.equal(state.values.searchText.value, '原关键词')
    assert.equal(state.values.selectedType.value, 'expense'); assert.equal(state.values.selectedCategory.value, '餐饮')
    assert.match(state.values.notice.value, /日期暂时未能切换.*原条件已保留/)
    assert.equal(state.values.resettingFilters.value, false)
    assert.equal(state.calls.length, 1); assert.deepEqual(state.store.records, [original])
  } finally { state.dispose() }
  for (const change of [state => state.dispose(), state => { state.auth.user = { id: 'other-owner' } }]) {
    let finish
    const state = mountBills({ server: true, replace: () => new Promise(resolve => { finish = resolve }) })
    try {
      state.values.editingRecord.value = null
      const pending = state.values.chooseDate('2026-10-04'); change(state); state.values.searchText.value = '新输入'
      finish({ type: 8 }); assert.equal(await pending, false)
      assert.equal(state.values.selectedDate.value, ''); assert.equal(state.values.searchText.value, '新输入')
      assert.equal(state.values.notice.value, ''); assert.equal(state.calls.length, 1)
    } finally { state.dispose() }
  }
})

test('明细选日保存/编辑/读取错误/旧身份阻断且0导航，离页旧入口永不导航', async () => {
  const state = mountBills({ server: true })
  try {
    state.values.editingRecord.value = null
    state.values.saving.value = true; assert.equal(await state.values.chooseDate('2026-10-04'), false); state.values.saving.value = false
    state.values.edit(original); assert.equal(await state.values.chooseDate('2026-10-04'), false); state.values.editingRecord.value = null
    state.store.storageError = '合成读取错误'; assert.equal(await state.values.chooseDate('2026-10-04'), false); state.store.storageError = ''
    assert.deepEqual(state.calls, []); assert.equal(state.values.selectedDate.value, '')
    assert.equal(await state.values.chooseDate('2026-10-04'), true); assert.equal(state.calls.length, 1)
    state.auth.user = null; state.auth.user = { id: 'synthetic-owner' }
    assert.equal(await state.values.chooseDate('2026-10-31'), false)
    assert.equal(state.calls.length, 1); assert.equal(state.values.selectedDate.value, '2026-10-04')
  } finally { state.dispose() }
  const disposed = mountBills()
  disposed.values.editingRecord.value = null; disposed.dispose()
  assert.equal(await disposed.values.chooseDate('2026-10-04'), false)
  assert.deepEqual(disposed.calls, [])
})

test('备注聚焦仅当前可见框与操作区重叠时滚动，失焦/忙碌/离页不执行迟到回调', async () => {
  const props=Vue.reactive({record:{...original},saving:false,blocked:false}), scrolls=[], hooks=[], doc={}
  let overlap=true
  const field={isConnected:true,ownerDocument:doc,getBoundingClientRect:()=>({top:700,bottom:800}),closest:()=>({querySelector:()=>({getBoundingClientRect:()=>({top:overlap?760:900,bottom:960})})}),scrollIntoView:options=>scrolls.push(options)}
  doc.activeElement=field
  const scope=Vue.effectScope()
  const view=scope.run(()=>evaluate(formSource.script,{...Vue,onBeforeUnmount:fn=>hooks.push(fn),dayjs,CATEGORY_OPTIONS,validateRecord,SERVER_MODE:true,defineProps:()=>props,defineEmits:()=>()=>{},defineExpose:()=>{}},'revealNote'))
  try {
    await view.revealNote({currentTarget:field});assert.deepEqual(scrolls,[{block:'center',behavior:'instant'}])
    overlap=false;await view.revealNote({currentTarget:field});assert.equal(scrolls.length,1)
    overlap=true
    const old=view.revealNote({currentTarget:field});doc.activeElement={};await old;assert.equal(scrolls.length,1)
    doc.activeElement=field;props.saving=true;await view.revealNote({currentTarget:field});assert.equal(scrolls.length,1)
    props.saving=false;const leaving=view.revealNote({currentTarget:field});hooks.forEach(fn=>fn());await leaving;assert.equal(scrolls.length,1)
  } finally {scope.stop()}
})
