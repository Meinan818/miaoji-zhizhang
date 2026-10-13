import test from 'node:test'
import assert from 'node:assert/strict'
import { createBillFilterPath, getScrollPosition } from '../src/utils/navigation.js'
import { useStatsMonthNavigation } from '../src/utils/navigation.js'
import { useManualRecordSave } from '../src/utils/navigation.js'
import { useBillQuery, useLedgerReload } from '../src/utils/navigation.js'
import { effectScope, reactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { getLoginReturnPath } from '../src/utils/loginRedirect.js'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { renderToString } from '@vue/server-renderer'
import { isValidMonth } from '../src/utils/statistics.js'

test('实际底栏模板只给明细与统计携带合法月份，默认与无效月份保持普通入口', async () => {
  const { descriptor } = parse(readFileSync(new URL('../src/components/layout/BottomNav.vue', import.meta.url), 'utf8'))
  const script = descriptor.scriptSetup.content.replace(/^import .*$/gm, '')
  const render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)(Vue)
  render._rc = true
  for (const month of ['', '2026-09', '2026-13']) {
    const view = { props: ['active', 'month'], components: { CatNavIcon: { render: () => Vue.h('span') } },
      setup(props) { return new Function('computed', 'isValidMonth', 'defineProps', script + ';return { navItems }')(Vue.computed, isValidMonth, () => props) }, render }
    const router = createRouter({ history: createMemoryHistory(), routes: ['/', '/bills', '/stats', '/chat', '/profile'].map(path => ({ path, component: view })) })
    const app = Vue.createSSRApp(view, { active: 'bill', month }); app.use(router)
    await router.push('/'); const html = await renderToString(app)
    const suffix = month === '2026-09' ? '?month=2026-09' : ''
    assert(html.includes(`href="/bills${suffix}"`)); assert(html.includes(`href="/stats${suffix}"`))
    for (const path of ['/', '/chat', '/profile']) assert(html.includes(`href="${path}"`))
    assert.equal((html.match(/month=/g) || []).length, month === '2026-09' ? 2 : 0)
  }
})

test('筛选链接编码中文及特殊字符，重建明细和登录返回保留条件，只表达白名单', () => {
  const input = { month: '2026-09', query: '咖啡 & +/#?\n备注', type: 'expense', category: '餐饮&其他', added: 'private-id', user: 'private-owner' }
  const path = createBillFilterPath(input)
  assert.equal(getLoginReturnPath(path), path)
  assert.equal(path.includes('private'), false)
  const scope = effectScope()
  const query = scope.run(() => useBillQuery(reactive({ query: Object.fromEntries(new URL(path, 'https://example.test').searchParams) })))
  try {
    assert.equal(query.selectedMonth.value, input.month)
    assert.equal(query.searchText.value, input.query)
    assert.equal(query.selectedType.value, input.type)
    assert.equal(query.selectedCategory.value, input.category)
  } finally { scope.stop() }
})

test('筛选链接固定站内路径，非法月份拒绝，空条件省略及文本长度与读取保持一致', () => {
  assert.equal(createBillFilterPath({ month: '2026-10' }), '/bills?month=2026-10')
  for (const month of ['0001-01', '2026-13', ['2026-10'], undefined]) assert.throws(() => createBillFilterPath({ month }))
  const path = createBillFilterPath({ month: '2026-10', query: '字'.repeat(140), category: '类'.repeat(140), type: 'external' })
  const params = new URL(path, 'https://example.test').searchParams
  assert.equal(params.get('q').length, 120); assert.equal(params.get('category').length, 120)
  assert.equal(params.has('type'), false)
  assert.equal(createBillFilterPath({ month: '2026-10', query: ['a'], category: ['b'] }), '/bills?month=2026-10')
})

test('登录返回保留站内月份/搜索与锚点，拒绝外站/未知页/循环和控制字符', () => {
  for (const value of ['/bills?month=2026-09&q=%E5%92%96%E5%95%A1#record', '/stats?month=2026-08', '/chat', '/profile', '/add', '/']) {
    assert.equal(getLoginReturnPath(value), value)
  }
  for (const value of [null, undefined, ['/bills'], 'https://example.test', '//example.test/bills', '/\\example.test/bills', '/login?redirect=/bills', '/api/auth/me', '/unknown', '/%2f%2fexample.test', '/bills\n', ' /bills']) {
    assert.equal(getLoginReturnPath(value), '/')
  }
})

test('同一明细页收到新查询链接同步月/收支/分类/搜索，清除链接条件恢复默认', () => {
  const scope = effectScope(), route = reactive({ query: { month: '2026-10', q: '旧备注', type: 'expense', category: '餐饮' } })
  const query = scope.run(() => useBillQuery(route, () => '2026-10'))
  try {
    route.query = { month: '2026-09', q: '合成工资', type: 'income', category: '工资' }
    assert.equal(query.selectedMonth.value, '2026-09')
    assert.equal(query.searchText.value, '合成工资')
    assert.equal(query.selectedType.value, 'income')
    assert.equal(query.selectedCategory.value, '工资')
    route.query = {}
    assert.equal(query.selectedMonth.value, '2026-10')
    assert.equal(query.searchText.value, '')
    assert.equal(query.selectedType.value, 'all')
    assert.equal(query.selectedCategory.value, '')
  } finally { scope.stop() }
})

test('账本原地重试只读取一次，显式强制参数保持，错误后可继续重试', async () => {
  let finish, calls = 0, fail = true
  const options = [], scope = effectScope()
  const loader = scope.run(() => useLedgerReload({ refresh: force => {
    calls++; options.push(force)
    if (calls === 1) return new Promise(done => { finish = done })
    if (fail) throw Error('合成读取异常')
    return true
  } }))
  try {
    const pending = loader.reloadRecords(true)
    assert.equal(await loader.reloadRecords(true), false)
    finish(false); assert.equal(await pending, false)
    assert.equal(loader.reloading.value, false)
    assert.ok(loader.reloadError.value)
    assert.equal(await loader.reloadRecords(true), false)
    assert.match(loader.reloadError.value, /合成读取异常/)
    fail = false
    assert.equal(await loader.reloadRecords(), true)
    assert.equal(loader.reloadError.value, '')
    assert.deepEqual(options, [true, true, false])
  } finally { scope.stop() }
})

test('离开页面后读取迟到不更新本页错误，释放后不能再次读取', async () => {
  let finish, calls = 0
  const scope = effectScope()
  const loader = scope.run(() => useLedgerReload({ refresh: () => { calls++; return new Promise(done => { finish = done }) } }))
  const pending = loader.reloadRecords(true)
  scope.stop(); finish(false)
  assert.equal(await pending, false)
  assert.equal(loader.reloadError.value, '')
  assert.equal(await loader.reloadRecords(true), false)
  assert.equal(calls, 1)
})

test('非法或数组明细查询安全回退，拒绝1000年以前的月份', () => {
  const scope = effectScope()
  const query = scope.run(() => useBillQuery(reactive({ query: { month: '0001-01', q: ['a'], type: ['income'], category: ['工资'] } }), () => '2026-10'))
  try { assert.equal(query.selectedMonth.value, '2026-10'); assert.equal(query.searchText.value, ''); assert.equal(query.selectedType.value, 'all'); assert.equal(query.selectedCategory.value, '') }
  finally { scope.stop() }
})

test('明细月份不越过上下界，拒绝切月不清现有分类', () => {
  for (const [month, offset] of [['1000-01', -1], ['9999-12', 1]]) {
    const scope = effectScope()
    const query = scope.run(() => useBillQuery(reactive({ query: { month, category: '餐饮' } })))
    try { query.changeMonth(offset); assert.equal(query.selectedMonth.value, month); assert.equal(query.selectedCategory.value, '餐饮') }
    finally { scope.stop() }
  }
})

test('明细新增定位等无关路由参数变化不清用户本页筛选', () => {
  const scope = effectScope(), route = reactive({ query: { month: '2026-10' } })
  const query = scope.run(() => useBillQuery(route))
  try {
    query.searchText.value = '本页输入'
    query.selectedType.value = 'expense'
    query.selectedCategory.value = '餐饮'
    route.query = { ...route.query, added: 'synthetic' }
    assert.equal(query.searchText.value, '本页输入')
    assert.equal(query.selectedType.value, 'expense')
    assert.equal(query.selectedCategory.value, '餐饮')
  } finally { scope.stop() }
})

test('手动账单保存后跳转失败可恢复，重试不重复写入', async () => {
  let writes = 0, fail = true
  const router = { push: async () => fail ? { type: 4 } : undefined }
  const scope = effectScope()
  const saver = scope.run(() => useManualRecordSave({ addRecord: async () => { writes++; return { id: 'synthetic', date: '2026-10-04' } } }, router, 'manual-synthetic'))
  try {
    assert.equal(await saver.save({}), false)
    assert.equal(saver.saving.value, false)
    assert.equal(saver.savedRecord.value.id, 'synthetic')
    assert.match(saver.error.value, /账单已保存/)
    fail = false
    assert.equal(await saver.save({ amount: '改后值' }), true)
    assert.equal(writes, 1)
  } finally { scope.stop() }
})

test('手动写入等待时重复点击不发第二次写入', async () => {
  let finish, writes = 0
  const keys = []
  const scope = effectScope()
  const saver = scope.run(() => useManualRecordSave({ addRecord: (_, options) => { writes++; keys.push(options.batchId); return new Promise(done => { finish = done }) } }, { push: async () => undefined }, 'manual-synthetic'))
  try {
    const pending = saver.save({})
    assert.equal(await saver.save({}), false)
    finish({ id: 'synthetic', date: '2026-10-04' })
    assert.equal(await pending, true)
    assert.equal(saver.saving.value, false)
    assert.equal(writes, 1)
    assert.deepEqual(keys, ['manual-synthetic'])
  } finally { scope.stop() }
})

test('恢复入口沿用被选原操作标识，导航失败后再点只打开明细', async () => {
  const keys = []; let fail = true
  const scope = effectScope()
  const saver = scope.run(() => useManualRecordSave({ addRecord: async (record, options) => {
    keys.push(options.batchId); assert.equal(record.amount, '0.29')
    return { id: 'synthetic', date: '2026-10-04' }
  } }, { push: async () => fail ? { type: 4 } : undefined }, 'manual-new-mount'))
  try {
    await saver.save({ amount: '0.29' }, 'manual-original')
    fail = false
    await saver.save()
    assert.deepEqual(keys, ['manual-original'])
  } finally { scope.stop() }
})

test('手动写入失败后同次请求键保持，导航异常只重试打开', async () => {
  let failWrite = true, failNavigation = true, writes = 0
  const keys = []
  const scope = effectScope()
  const saver = scope.run(() => useManualRecordSave({ addRecord: async (_, options) => {
    writes++; keys.push(options.batchId)
    if (failWrite) throw Error('合成写入失败')
    return { id: 'synthetic', date: '2026-10-04' }
  } }, { push: async () => { if (failNavigation) throw Error('合成导航失败') } }, 'manual-synthetic'))
  try {
    assert.equal(await saver.save({}), false)
    assert.equal(saver.savedRecord.value, null)
    assert.match(saver.error.value, /写入失败/)
    assert.equal(saver.saving.value, false)
    failWrite = false
    assert.equal(await saver.save({}), false)
    assert.equal(writes, 2)
    assert.deepEqual(keys, ['manual-synthetic', 'manual-synthetic'])
    assert.match(saver.error.value, /账单已保存/)
    failNavigation = false
    assert.equal(await saver.save(), true)
    assert.equal(writes, 2)
    assert.equal(saver.error.value, '')
  } finally { scope.stop() }
})

test('离开手动页后保存迟到成功不把用户拉回明细', async () => {
  let finish, navigations = 0
  const scope = effectScope()
  const saver = scope.run(() => useManualRecordSave({ addRecord: () => new Promise(done => { finish = done }) }, { push: async () => { navigations++ } }, 'manual-synthetic'))
  const pending = saver.save({})
  scope.stop()
  finish({ id: 'synthetic', date: '2026-10-04' })
  assert.equal(await pending, false)
  assert.equal(navigations, 0)
})

test('已保存导航等待期间身份首次变化，旧失败不填错误或解锁，切回旧入口不再次导航', async () => {
  const auth = reactive({ user: { id: 'synthetic-owner' } }), scope = effectScope()
  let fail, navigations = 0, writes = 0
  const saver = scope.run(() => useManualRecordSave({ addRecord: async () => { writes++; return { id: 'synthetic', date: '2026-10-04' } } },
    { push: () => { navigations++; return new Promise((resolve, reject) => { fail = reject }) } }, 'manual-synthetic', { owner: () => auth.user?.id }))
  try {
    const pending = saver.save({}); await new Promise(resolve => setImmediate(resolve))
    auth.user = null; auth.user = { id: 'synthetic-owner' }
    fail(Error('合成旧导航失败')); assert.equal(await pending, false)
    assert.equal(saver.error.value, '')
    assert.equal(await saver.save(), false); assert.equal(navigations, 1); assert.equal(writes, 1)
  } finally { scope.stop() }
})

async function setupMonth(month = '2026-10', hash = '') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/stats', component: {} }] })
  await router.push({ path: '/stats', query: { month, q: '保留筛选' }, hash })
  const scope = effectScope()
  const route = { get query() { return router.currentRoute.value.query }, get hash() { return router.currentRoute.value.hash } }
  const navigation = scope.run(() => useStatsMonthNavigation(route, router, () => '2026-10'))
  return { router, navigation, dispose: () => scope.stop() }
}

test('统计同页切月保留查询与锚点，回本月不丢完整地址', async () => {
  const scene = await setupMonth('2026-09', '#month')
  try {
    assert.equal(await scene.navigation.changeMonth(1), true)
    assert.deepEqual(scene.router.currentRoute.value.query, { month: '2026-10', q: '保留筛选' })
    assert.equal(scene.router.currentRoute.value.hash, '#month')
  } finally { scene.dispose() }
})

test('原草稿取消后保留表单内容，取消失败不放行也不导航或重新写入', async () => {
  let fail = true, cancellations = 0
  const scope = effectScope()
  const saver = scope.run(() => useManualRecordSave({ cancelManualOperation: async batchId => {
    assert.equal(batchId, 'manual-original'); cancellations++
    if (fail) throw Error('合成取消未确认')
  }, addRecord: () => { throw Error('不得自动入账') } }, { push: () => { throw Error('不得自动跳转') } }, 'manual-new'))
  const operation = { batchId: 'manual-original', record: { id: 'single', amount: '0.29', date: '2026-10-04', remark: '合成' } }
  try {
    assert.equal(await saver.cancelPending(operation), false)
    assert.match(saver.error.value, /取消未确认/)
    assert.deepEqual(saver.restoredRecord.value, {})
    fail = false
    assert.equal(await saver.cancelPending(operation), true)
    assert.equal(saver.restoredRecord.value.amount, '0.29')
    assert.equal(saver.restoredRecord.value.id, undefined)
    assert.match(saver.notice.value, /未入账/)
    assert.equal(cancellations, 2)
  } finally { scope.stop() }
})

test('取消等待时阻断恢复或第二次取消，离页迟到不显示已取消状态', async () => {
  let finish, calls = 0
  const scope = effectScope()
  const saver = scope.run(() => useManualRecordSave({ cancelManualOperation: () => { calls++; return new Promise(done => { finish = done }) } }, {}, 'manual-new'))
  const operation = { batchId: 'manual-original', record: { amount: '0.29' } }
  const pending = saver.cancelPending(operation)
  assert.equal(await saver.cancelPending(operation), false)
  assert.equal(await saver.save(operation.record, operation.batchId), false)
  scope.stop(); finish()
  assert.equal(await pending, false)
  assert.equal(calls, 1)
  assert.equal(saver.notice.value, '')
})

test('统计月份导航被拒绝时，月份仍与真实路由和账本一致', async () => {
  const scene = await setupMonth()
  try {
    scene.router.beforeEach(() => false)
    assert.equal(await scene.navigation.changeMonth(1), false)
    assert.equal(scene.navigation.selectedMonth.value, '2026-10')
    assert.equal(scene.router.currentRoute.value.query.month, '2026-10')
  } finally { scene.dispose() }
})

test('慢导航完成前不展示尚未成功切换月份，连续点击累积到最终月份', async () => {
  const scene = await setupMonth()
  let release
  const blocked = new Promise(done => { release = done })
  scene.router.beforeEach(() => blocked)
  try {
    const first = scene.navigation.changeMonth(1)
    const second = scene.navigation.changeMonth(1)
    assert.equal(scene.navigation.selectedMonth.value, '2026-10')
    release(true)
    await Promise.all([first, second])
    assert.equal(scene.navigation.selectedMonth.value, '2026-12')
    assert.equal(scene.router.currentRoute.value.query.month, '2026-12')
    assert.equal(scene.router.currentRoute.value.query.q, '保留筛选')
  } finally { release(true); scene.dispose() }
})

test('统计月份守卫抛错时不产生未处理拒绝，后续可以重新切月', async () => {
  const scene = await setupMonth()
  scene.router.onError(() => {})
  let fail = true
  scene.router.beforeEach(() => { if (fail) throw Error('合成读取失败') })
  try {
    assert.equal(await scene.navigation.changeMonth(-1), false)
    assert.equal(scene.navigation.selectedMonth.value, '2026-10')
    assert.match(scene.navigation.navigationError.value, /暂时无法切换/)
    assert.equal(scene.navigation.pendingMonth.value, '')
    fail = false
    assert.equal(await scene.navigation.changeMonth(-1), true)
    assert.equal(scene.navigation.selectedMonth.value, '2026-09')
    assert.equal(scene.navigation.navigationError.value, '')
  } finally { scene.dispose() }
})

test('更早的取消结果不会清空新导航的等待月份', async () => {
  const scene = await setupMonth()
  let release
  const blocked = new Promise(done => { release = done })
  scene.router.beforeEach(() => blocked)
  try {
    const first = scene.navigation.changeMonth(1)
    const second = scene.navigation.changeMonth(1)
    await first
    assert.equal(scene.navigation.pendingMonth.value, '2026-12')
    assert.equal(scene.navigation.navigationError.value, '')
    release(true)
    await second
    assert.equal(scene.navigation.pendingMonth.value, '')
  } finally { release(true); scene.dispose() }
})

test('离页释放后，旧导航异常不再修改页面状态', async () => {
  const scene = await setupMonth()
  scene.router.onError(() => {})
  let reject
  scene.router.beforeEach(() => new Promise((_, fail) => { reject = fail }))
  const pending = scene.navigation.changeMonth(1)
  while (!reject) await new Promise(done => setImmediate(done))
  scene.dispose()
  reject(Error('合成离页后失败'))
  assert.equal(await pending, false)
  assert.equal(scene.navigation.navigationError.value, '')
  assert.equal(await scene.navigation.changeMonth(1), false)
})

test('统计月份上下界不发导航，异常查询使用当前月份', async () => {
  for (const [month, offset] of [['1000-01', -1], ['9999-12', 1]]) {
    const scene = await setupMonth(month)
    try { assert.equal(await scene.navigation.changeMonth(offset), false); assert.equal(scene.navigation.selectedMonth.value, month) }
    finally { scene.dispose() }
  }
  const scene = await setupMonth(['2026-01', '2026-02'])
  try {
    assert.equal(scene.navigation.selectedMonth.value, '2026-10')
    assert.equal(await scene.navigation.changeMonth(-1), true)
    assert.equal(scene.navigation.selectedMonth.value, '2026-09')
  } finally { scene.dispose() }
})

const route = (path, query = {}) => ({ path, query })
test('普通跨页导航从顶部开始', () => {
  assert.deepEqual(getScrollPosition(route('/stats'), route('/')), { left: 0, top: 0 })
})
test('浏览器返回恢复原位置，不创建第二份位置', () => {
  const position = { left: 0, top: 308 }
  assert.equal(getScrollPosition(route('/'), route('/stats'), position), position)
})
test('返回顶部的已保存位置仍有优先权', () => {
  const position = { left: 0, top: 0 }
  assert.equal(getScrollPosition(route('/bills', { added: 'new' }), route('/add'), position), position)
})
test('同页查询变化不抢走阅读或编辑位置', () => {
  assert.equal(getScrollPosition(route('/bills', { q: '咖啡' }), route('/bills')), false)
})
test('保存后跳转由明细定位新账单，不再回顶', () => {
  assert.equal(getScrollPosition(route('/bills', { added: 'new-record' }), route('/add')), false)
})
test('空新增标记不阻止普通导航回顶', () => {
  assert.deepEqual(getScrollPosition(route('/bills', { added: '' }), route('/')), { left: 0, top: 0 })
})
test('数组查询参数不能冒充单笔新增目标', () => {
  assert.deepEqual(getScrollPosition(route('/bills', { added: ['a', 'b'] }), route('/')), { left: 0, top: 0 })
})
test('其他页带同名参数仍从顶部开始', () => {
  assert.deepEqual(getScrollPosition(route('/stats', { added: 'new' }), route('/')), { left: 0, top: 0 })
})
test('首次进入没有查询对象也可回顶', () => {
  assert.deepEqual(getScrollPosition({ path: '/' }, { path: '' }), { left: 0, top: 0 })
})

test('日期筛选链接与明细地址只接收当月有效日期，同页更新和切月清旧日期', () => {
  const path = createBillFilterPath({ month:'2024-02', date:'2024-02-29', query:'午饭', type:'expense' })
  const params = new URL(path, 'https://example.test').searchParams
  assert.equal(params.get('date'), '2024-02-29')
  const scope = effectScope(), route = reactive({ query:Object.fromEntries(params) })
  const query = scope.run(() => useBillQuery(route))
  try {
    assert.equal(query.selectedDate.value, '2024-02-29')
    for(const date of ['2024-02-30', '2024-03-01', ['2024-02-29'], undefined]) {
      route.query = { month:'2024-02', date }
      assert.equal(query.selectedDate.value, '')
      assert.equal(new URL(createBillFilterPath({ month:'2024-02', date }), 'https://example.test').searchParams.has('date'), false)
    }
    route.query = { month:'2024-02', date:'2024-02-29' }
    assert.equal(query.selectedDate.value, '2024-02-29')
    query.selectMonth('2024-03'); assert.equal(query.selectedDate.value, '')
  } finally { scope.stop() }
})
