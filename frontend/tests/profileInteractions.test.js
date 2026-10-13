// Execute the actual Profile setup script offline, without browser or requests.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computed, effectScope, nextTick, reactive, ref, unref, watch } from 'vue'
import dayjs from 'dayjs'
import { createProfileApi } from '../src/api/profile.js'
import { BACKUP_FORMAT, buildBackupFile, inspectBackupText } from '../src/utils/ledgerBackup.js'
import { DEFAULT_PROFILE, readLocalProfile, saveLocalProfile } from '../src/utils/localProfile.js'
import { getMonthStatistics } from '../src/utils/statistics.js'
import { filterRecords, getRecentDays } from '../src/utils/journal.js'
import { centsText } from '../src/utils/money.js'
import { useLocalDay } from '../src/utils/calendar.js'
import { useBillQuery, useLedgerReload } from '../src/utils/navigation.js'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'

const original = { nickname: '合成名片', signature: '合成签名', avatar: 'cat', version: 0 }
test('资料保存完成先恢复入口可用DOM，再关闭窗口交还原生焦点', async () => {
  const env = scene(), closes = [], focuses = []
  let renderedDisabled = false
  const stop = watch(env.view.savingProfile, value => { renderedDisabled = value }, { flush: 'post' })
  try {
    env.view.profileDialog.value.open = true
    env.view.profileDialog.value.close = () => { closes.push(renderedDisabled); env.view.profileDialog.value.open = false }
    env.view.profileEditButton.value = { focus: () => focuses.push(renderedDisabled) }
    env.view.profile.value = { ...original }; env.view.profileForm.value = { ...original, nickname: '保存新名' }
    const pending = env.view.saveProfile(); await nextTick()
    assert.equal(renderedDisabled, true)
    env.requests[0].resolve({ ...original, nickname: '保存新名', version: 1 }); await pending
    assert.deepEqual(closes, [false])
    assert.deepEqual(focuses, [false])
    assert.equal(env.view.profile.value.version, 1)
    assert.equal(env.requests.length, 1)
  } finally { stop(); env.dispose() }
})

test('保存回执后恢复入口DOM期间离页或身份变化，不关闭旧窗口或显示成功提示', async () => {
  for (const change of [env => env.dispose(), env => { env.auth.user = { id: 'other' }; env.auth.user = { id: '1' } }]) {
    const env = scene(), closes = []
    const stop = watch(env.view.savingProfile, value => { if (!value) change(env) }, { flush: 'post' })
    try {
      env.view.profileDialog.value.open = true
      env.view.profileDialog.value.close = () => closes.push(true)
      env.view.profileEditButton.value = { focus: () => assert.fail('旧页面不可抢焦点') }
      env.view.profile.value = { ...original }; env.view.profileForm.value = { ...original, nickname: '保存新名' }
      const pending = env.view.saveProfile(); await nextTick()
      env.requests[0].resolve({ ...original, nickname: '保存新名', version: 1 }); await pending; await nextTick()
      assert.deepEqual(closes, [])
      assert.equal(env.view.profileNotice.value, '')
      assert.equal(env.view.profileForm.value.nickname, '保存新名')
      assert.equal(env.requests.length, 1)
    } finally { stop(); env.dispose() }
  }
})

test('普通资料窗口关闭恢复编辑入口焦点，保存中或旧页面关闭入口不拉走焦点', () => {
  for (const phase of ['current', 'saving', 'closed', 'disposed', 'owner']) {
    const env = scene(), focused = []
    try {
      env.view.profileEditButton.value = { focus: () => focused.push(true) }
      env.view.profileDialog.value.open = phase !== 'closed'
      if (phase === 'saving') env.view.savingProfile.value = true
      if (phase === 'disposed') env.dispose()
      if (phase === 'owner') { env.auth.user = { id: 'other' }; env.auth.user = { id: '1' } }
      env.view.closeProfile()
      assert.deepEqual(focused, phase === 'current' ? [true] : [])
      assert.equal(env.requests.length, 0)
      if (phase === 'saving') assert.equal(env.view.profileDialog.value.open, true)
    } finally { env.dispose() }
  }
})

test('资料保存失败后显示最新完整错误，自动滚入已打开窗口但不修改输入或重复请求', async () => {
  const env = scene(), scrolled = []
  try {
    env.view.profileDialog.value.open = true
    env.view.editErrorElement.value = { getClientRects: () => [1], scrollIntoView: options => scrolled.push(options) }
    env.view.profileForm.value.nickname = '保留未保存输入'
    const pending = env.view.saveProfile()
    env.requests[0].reject(Error('合成长保存错误'))
    while (env.requests.length < 2) await new Promise(resolve => setImmediate(resolve))
    env.requests[1].resolve(original); await pending; await nextTick(); await nextTick()
    assert.deepEqual(scrolled, [{ block: 'start', behavior: 'instant' }])
    assert.equal(env.view.profileForm.value.nickname, '保留未保存输入')
    assert.equal(env.view.editError.value, '合成长保存错误')
    assert.equal(env.requests.length, 2)
  } finally { env.dispose() }
})

test('资料错误滚动等待DOM期间清错、关闭、离页或切换身份后旧回调失效', async () => {
  for (const change of [env => { env.view.editError.value = '' }, env => env.view.closeProfile(),
    env => env.dispose(), env => { env.auth.user = { id: 'other' }; env.auth.user = { id: '1' } },
    env => { env.view.editErrorElement.value = null }]) {
    const env = scene(), scrolled = []
    try {
      env.view.profileDialog.value.open = true
      env.view.editErrorElement.value = { getClientRects: () => [1], scrollIntoView: options => scrolled.push(options) }
      env.view.editError.value = '旧错误'
      await nextTick(); change(env); await nextTick(); await nextTick()
      assert.deepEqual(scrolled, [])
      assert.equal(env.requests.length, 0)
    } finally { env.dispose() }
  }
  const env = scene(), scrolled = []
  try {
    env.view.profileDialog.value.open = true
    env.view.editErrorElement.value = { getClientRects: () => [1], scrollIntoView: () => scrolled.push(env.view.editError.value) }
    env.view.editError.value = '旧错误'; await nextTick()
    env.view.editError.value = '最新错误'; await nextTick(); await nextTick()
    assert.deepEqual(scrolled, ['最新错误'])
    env.view.editErrorElement.value = { getClientRects: () => [], scrollIntoView: () => scrolled.push('隐藏') }
    env.view.editError.value = '隐藏错误'; await nextTick(); await nextTick()
    assert.deepEqual(scrolled, ['最新错误'])
  } finally { env.dispose() }
})

function scene({ records = [], dateClock = {}, createPhoto = () => { assert.fail('不可处理真实照片') }, backupDownloads = null, backupRefresh = null } = {}) {
  const requests = [], logoutRequests = [], backupRefreshes = [], cleanup = [], scope = effectScope()
  const auth = reactive({ user: { id: '1' }, api: { request(method, path, options) {
    return new Promise((resolve, reject) => requests.push({ method, path, options, resolve, reject }))
  } }, logout() { return new Promise((resolve, reject) => logoutRequests.push({ resolve, reject })) } })
  const script = readFileSync(new URL('../src/views/Profile.vue', import.meta.url), 'utf8').split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const storeMock = { records, storageError: '', refresh(force) {
    if (!backupRefresh) assert.fail('不可自动读账单')
    backupRefreshes.push(force); return backupRefresh(force)
  } }
  const bindings = { computed, ref, watch, nextTick, dayjs, onMounted() {}, onBeforeUnmount: fn => cleanup.push(fn), SERVER_MODE: true,
    useRecordStore: () => storeMock,
    useAuthStore: () => auth, getMonthStatistics, getRecentDays, centsText, packageInfo: { version: 'synthetic' },
    useLocalDay: () => useLocalDay({ eventTarget: null, ...dateClock }), useLedgerReload,
    DEFAULT_PROFILE, readLocalProfile, saveLocalProfile, createProfileApi, createProfilePhoto: createPhoto,
    BACKUP_FORMAT, buildBackupFile, inspectBackupText,
    downloadJson: (value, filename) => { if (!backupDownloads) assert.fail('不可下载'); backupDownloads.push({ value, filename }) } }
  const view = scope.run(() => new Function(...Object.keys(bindings), script + '; return { month, monthTitle, statistics, recentDays, profile, profileForm, profileError, profileNotice, profileDialog, profileEditButton, loadProfile, openProfile, closeProfile, choosePhoto, processingPhoto, saveProfile, savingProfile, editError, editErrorElement, loadingProfile, logout, loggingOut, logoutError, profileOwnerCurrent, openingProfile, exportBackup, chooseBackup, confirmBackupImport, cancelBackupImport, backupBusy, backupNotice, backupError, backupPreview, backupReady }')(...Object.values(bindings)))
  let opens = 0
  view.profileDialog.value = { open: false, showModal() { opens++; this.open = true }, close() { this.open = false } }
  return { view, requests, logoutRequests, auth, backupRefreshes, get opens() { return opens }, dispose() { cleanup.forEach(fn => fn()); scope.stop() } }
}

test('重复打开资料编辑不能用迟到读取覆盖用户刚填的昵称', async () => {
  const env = scene()
  try {
    const first = env.view.openProfile(), second = env.view.openProfile()
    env.requests[0].resolve(original); await first
    env.view.profileForm.value.nickname = '正在填写的昵称'
    env.requests[1]?.resolve({ ...original, nickname: '迟到旧名片' }); await second
    assert.equal(env.view.profileForm.value.nickname, '正在填写的昵称')
    assert.equal(env.opens, 1)
    assert.equal(env.requests.length, 1)
  } finally { env.dispose() }
})

test('头像本地处理完成保留期间输入的昵称签名，确认前不上传', async () => {
  let complete
  const env = scene({ createPhoto: () => new Promise(resolve => { complete = resolve }) })
  try {
    const opened = env.view.openProfile(); env.requests[0].resolve(original); await opened
    const input = { files: [{ type: 'image/jpeg', size: 24 }], value: 'synthetic-file' }
    const pending = env.view.choosePhoto({ target: input })
    assert.equal(input.value, '')
    assert.equal(env.view.processingPhoto.value, true)
    env.view.profileForm.value.nickname = '处理期间的昵称'
    env.view.profileForm.value.signature = '处理期间的签名'
    complete('data:image/jpeg;base64,/9j/AA=='); await pending
    assert.equal(env.view.profileForm.value.avatar, 'photo')
    assert.equal(env.view.profileForm.value.nickname, '处理期间的昵称')
    assert.equal(env.view.profileForm.value.signature, '处理期间的签名')
    assert.equal(env.view.processingPhoto.value, false)
    assert.equal(env.requests.length, 1)
    assert.equal(env.requests[0].method, 'GET')
  } finally { env.dispose() }
})

test('取消头像处理再打开编辑，旧照片迟到不会替换新名片', async () => {
  let complete
  const env = scene({ createPhoto: () => new Promise(resolve => { complete = resolve }) })
  try {
    const opened = env.view.openProfile(); env.requests[0].resolve(original); await opened
    const pending = env.view.choosePhoto({ target: { files: [{}], value: '' } })
    env.view.closeProfile()
    assert.equal(env.view.processingPhoto.value, false)
    const reopened = env.view.openProfile(); env.requests[1].resolve({ ...original, nickname: '再次编辑' }); await reopened
    env.view.profileForm.value.nickname = '新的输入'
    complete('data:image/jpeg;base64,/9j/AA=='); await pending
    assert.equal(env.view.profileForm.value.avatar, 'cat')
    assert.equal(env.view.profileForm.value.nickname, '新的输入')
    assert.equal(env.view.editError.value, '')
    assert.equal(env.view.processingPhoto.value, false)
    assert.equal(env.requests.length, 2)
  } finally { env.dispose() }
})

test('替换头像后旧处理失败不干扰最新照片或忙碌状态', async () => {
  const photos = []
  const env = scene({ createPhoto: () => new Promise((resolve, reject) => photos.push({ resolve, reject })) })
  try {
    const opened = env.view.openProfile(); env.requests[0].resolve(original); await opened
    const first = env.view.choosePhoto({ target: { files: [{}], value: '' } })
    const second = env.view.choosePhoto({ target: { files: [{}], value: '' } })
    photos[0].reject(Error('旧图片失败')); await first
    assert.equal(env.view.processingPhoto.value, true)
    assert.equal(env.view.editError.value, '')
    photos[1].resolve('data:image/jpeg;base64,/9j/AQ=='); await second
    assert.equal(env.view.profileForm.value.photo, 'data:image/jpeg;base64,/9j/AQ==')
    assert.equal(env.view.processingPhoto.value, false)
    assert.equal(env.requests.length, 1)
  } finally { env.dispose() }
})

test('晚到的旧读取失败不掩盖较新资料，重试状态正常释放', async () => {
  const env = scene()
  try {
    const first = env.view.loadProfile(), second = env.view.loadProfile()
    env.requests[1].resolve({ ...original, nickname: '较新名片', version: 2 }); await second
    env.requests[0].reject(Error('迟到读取失败')); await first
    assert.equal(env.view.profile.value.nickname, '较新名片')
    assert.equal(env.view.profile.value.version, 2)
    assert.equal(env.view.profileError.value, '')
    assert.equal(env.view.loadingProfile.value, false)
  } finally { env.dispose() }
})

test('照片部分保存与重读失败仍保留昵称输入，重试只PUT不再次上传', async () => {
  const env = scene()
  const waitFor = async count => { while (env.requests.length < count) await new Promise(resolve => setImmediate(resolve)) }
  try {
    const opened = env.view.openProfile(); env.requests[0].resolve(original); await opened
    env.view.profileForm.value = { ...original, nickname: '填写中的新名', avatar: 'photo', photo: 'data:image/jpeg;base64,/9j/AA==' }
    const saving = env.view.saveProfile()
    assert.equal(env.requests[1].method, 'POST')
    env.requests[1].resolve({ ...original, avatar: 'photo', avatarUrl: '/api/profile/avatar', version: 1 })
    await waitFor(3); env.requests[2].reject(Error('合成PUT中断'))
    await waitFor(4); env.requests[3].reject(Error('合成GET中断')); await saving
    assert.equal(env.view.profileForm.value.nickname, '填写中的新名')
    assert.equal(env.view.profileForm.value.photo, '/api/profile/avatar?v=1&expectedAccount=1')
    assert.equal(env.view.profile.value.version, 1)
    assert.match(env.view.editError.value, /照片已保存/)
    assert.match(env.view.profileError.value, /合成GET中断/)
    assert.equal(env.view.savingProfile.value, false)
    const retry = env.view.saveProfile()
    assert.equal(env.requests[4].method, 'PUT')
    assert.equal(env.requests[4].options.body.version, 1)
    env.requests[4].resolve({ ...original, nickname: '填写中的新名', avatar: 'photo', avatarUrl: '/api/profile/avatar', version: 2 })
    await retry
    assert.equal(env.requests.length, 5)
    assert.equal(env.view.profile.value.version, 2)
    assert.equal(env.view.profileError.value, '')
  } finally { env.dispose() }
})

test('离页后的资料读取不再打开已经移除的编辑窗口', async () => {
  const env = scene()
  const pending = env.view.openProfile()
  env.dispose(); env.view.profileDialog.value = null
  env.requests[0].resolve(original)
  await pending
  assert.equal(env.opens, 0)
})

test('迟到的资料重读不能覆盖已经保存的新版本', async () => {
  const env = scene()
  try {
    const opened = env.view.openProfile(); env.requests[0].resolve(original); await opened
    const reading = env.view.loadProfile()
    env.view.profileForm.value.nickname = '新昵称'
    const saving = env.view.saveProfile()
    env.requests[2].resolve({ ...original, nickname: '新昵称', version: 1 }); await saving
    env.requests[1].resolve(original); await reading
    assert.equal(env.view.profile.value.nickname, '新昵称')
    assert.equal(env.view.profile.value.version, 1)
  } finally { env.dispose() }
})

test('个人页跨月同步月份与7天足迹，保留编辑输入且不读取网络', () => {
  const OriginalDate = globalThis.Date
  let time = new OriginalDate('2026-10-31T12:00:00'), day = '2026-10-31', cleared = false
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [time.getTime()])) }
    static now() { return time.getTime() }
  }
  const events = new Map()
  let env
  try {
    env = scene({ records: [
      { id: 'oct', type: 'expense', amount: 0.29, date: '2026-10-31', category: '餐饮' },
      { id: 'nov', type: 'expense', amount: 0.31, date: '2026-11-01', category: '餐饮' },
    ], dateClock: { now: () => day, documentTarget: null,
      eventTarget: { addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) },
      timers: { setInterval: () => 1, clearInterval: () => { cleared = true } },
    } })
    assert.equal(env.view.statistics.value.expenseCents, 29)
    assert.equal(env.view.recentDays.value.at(-1).date, '2026-10-31')
    env.view.profileForm.value.nickname = '跨月仍在填写'
    time = new OriginalDate('2026-11-01T12:00:00'); day = '2026-11-01'; events.get('focus')?.()
    assert.equal(unref(env.view.monthTitle), '2026年11月')
    assert.equal(env.view.statistics.value.expenseCents, 31)
    assert.equal(env.view.recentDays.value.at(-1).date, '2026-11-01')
    assert.equal(env.view.profileForm.value.nickname, '跨月仍在填写')
    assert.equal(env.requests.length, 0)
  } finally { env?.dispose(); globalThis.Date = OriginalDate }
  assert.equal(events.size, 0)
  assert.equal(cleared, true)
})

test('个人页实际七天爪印日期链接精确匹配，排除他日备注提及日期并保跨月空日', async () => {
  const records = [
    { id: 'day', type: 'expense', amount: 32, date: '2026-10-04', category: '餐饮', remark: '当天小票' },
    { id: 'mention', type: 'expense', amount: 5, date: '2026-10-05', category: '餐饮', remark: '备注提及2026-10-04但非当天' },
  ]
  const env = scene({ records, dateClock: { now: () => '2026-10-06' } }), scope = effectScope(), targets = []
  const content = readFileSync(new URL('../src/views/Profile.vue', import.meta.url), 'utf8')
  const template = content.match(/<section[^>]*class="profile-footprints"[\s\S]*?<\/section>/)[0]
  try {
    const app = createSSRApp({ template, setup: () => ({ recentDays: env.view.recentDays, error: '', recordedDays: 2 }),
      components: { JournalSticker: { template: '<i />' }, RouterLink: { props: ['to'], template: '<a><slot /></a>', setup(props) { targets.push(props.to) } } } })
    assert.match(await renderToString(app), /查看2026-10-04的1笔有效账单/)
    const target = targets.find(target => target.query.date === '2026-10-04' || target.query.q === '2026-10-04')
    const query = scope.run(() => useBillQuery(reactive({ query: target.query })))
    assert.deepEqual(filterRecords(records, { query: query.searchText.value, date: query.selectedDate.value }).map(record => record.id), ['day'])
    assert.deepEqual(target.query, { month: '2026-10', date: '2026-10-04' })
    assert.deepEqual(targets.find(target => target.query.date === '2026-09-30')?.query, { month: '2026-09', date: '2026-09-30' })
    assert.equal(env.requests.length, 0); assert.equal(records[1].remark, '备注提及2026-10-04但非当天')
  } finally { scope.stop(); env.dispose() }
})

test('个人页退出重复点击只发一次合成认证操作', async () => {
  const env = scene()
  try {
    const first = env.view.logout(), second = env.view.logout(), count = env.logoutRequests.length
    env.logoutRequests.forEach(request => request.resolve())
    await Promise.all([first, second])
    assert.equal(count, 1); assert.equal(env.requests.length, 0)
  } finally { env.dispose() }
})

test('个人页离页或账号变化后退出失败不回填旧页面资料错误', async () => {
  for (const change of [env => env.dispose(), env => { env.auth.user = { id: 'other' } }]) {
    const env = scene(), before = env.view.profileError.value
    try {
      const pending = env.view.logout()
      change(env); env.logoutRequests[0].reject(Error('合成退出失败')); await pending
      assert.equal(env.view.profileError.value, before)
    } finally { env.dispose() }
  }
})

test('旧个人页退出入口不能在离页或新账号后追加认证操作', async () => {
  for (const change of [env => env.dispose(), env => { env.auth.user = { id: 'other' } }]) {
    const env = scene()
    try {
      change(env); const pending = env.view.logout(), count = env.logoutRequests.length
      env.logoutRequests.forEach(request => request.resolve()); await pending
      assert.equal(count, 0)
    } finally { env.dispose() }
  }
})

test('正常退出失败只提示退出错误并解除忙碌，可以重试，资料/编辑输入不被污染', async () => {
  const env = scene()
  try {
    env.view.profileError.value = ''; env.view.profileForm.value.nickname = '尚未保存昵称'
    const pending = env.view.logout()
    assert.equal(env.view.loggingOut.value, true)
    env.logoutRequests[0].reject(Error('合成网络中断')); await pending
    assert.equal(env.view.loggingOut.value, false); assert.equal(env.view.logoutError.value, '合成网络中断')
    assert.equal(env.view.profileError.value, ''); assert.equal(env.view.profileForm.value.nickname, '尚未保存昵称')
    const retry = env.view.logout()
    assert.equal(env.view.logoutError.value, ''); env.logoutRequests[1].resolve(); await retry
    assert.equal(env.view.loggingOut.value, false); assert.equal(env.view.logoutError.value, '')
    assert.equal(env.requests.length, 0)
  } finally { env.dispose() }
})

test('退出等待期间账号变化后切回，旧失败和旧入口仍失效', async () => {
  const env = scene()
  try {
    const pending = env.view.logout()
    env.auth.user = { id: 'other' }; env.auth.user = { id: '1' }
    env.logoutRequests[0].reject(Error('旧退出失败')); await pending
    assert.equal(env.view.logoutError.value, '')
    await env.view.logout(); assert.equal(env.logoutRequests.length, 1)
  } finally { env.dispose() }
})

test('资料读取期间身份变化后切回原账号，旧回执仍失效且不回填旧名片', async () => {
  const env = scene(), before = { ...env.view.profile.value }
  try {
    const pending = env.view.loadProfile()
    env.auth.user = { id: 'other' }; env.auth.user = { id: '1' }
    env.requests[0].resolve({ ...original, nickname: '旧会话名片' })
    assert.equal(await pending, false)
    assert.deepEqual(env.view.profile.value, before)
  } finally { env.dispose() }
})

test('照片处理期间身份变化后切回，不应用旧照片或旧错误到仍打开的编辑窗口', async () => {
  for (const fail of [false, true]) {
    let complete, reject
    const env = scene({ createPhoto: () => new Promise((resolve, rejectPhoto) => { complete = resolve; reject = rejectPhoto }) })
    try {
      const opened = env.view.openProfile(); env.requests[0].resolve(original); await opened
      const pending = env.view.choosePhoto({ target: { files: [{}], value: 'synthetic' } })
      env.auth.user = { id: 'other' }; env.auth.user = { id: '1' }
      env.view.profileForm.value.nickname = '新会话输入'
      if (fail) reject(Error('旧照片失败')); else complete('data:image/jpeg;base64,/9j/AA==')
      await pending
      assert.equal(env.view.profileForm.value.avatar, 'cat')
      assert.equal(env.view.editError.value, '')
      assert.equal(env.view.profileForm.value.nickname, '新会话输入')
      assert.equal(env.requests.length, 1)
    } finally { env.dispose() }
  }
})

test('身份变化后切回原账号，旧个人页读取/保存入口不追加资料请求', async () => {
  for (const action of ['loadProfile', 'saveProfile']) {
    const env = scene()
    try {
      env.auth.user = { id: 'other' }; env.auth.user = { id: '1' }
      const pending = env.view[action](), count = env.requests.length
      env.requests.forEach(request => request.resolve(original)); await pending
      assert.equal(count, 0)
    } finally { env.dispose() }
  }
})

test('照片上传合成回执前身份变化后切回，原资料适配器不继续PUT或重读', async () => {
  const env = scene()
  try {
    const opened = env.view.openProfile(); env.requests[0].resolve(original); await opened
    env.view.profileForm.value = { ...original, avatar: 'photo', photo: 'data:image/jpeg;base64,/9j/AA==' }
    const pending = env.view.saveProfile()
    assert.equal(env.requests[1].method, 'POST')
    env.auth.user = { id: 'other' }; env.auth.user = { id: '1' }
    env.requests[1].resolve({ ...original, avatar: 'photo', avatarUrl: '/api/profile/avatar', version: 1 })
    await pending
    assert.equal(env.requests.length, 2); assert.equal(env.view.profile.value.avatar, 'cat')
    assert.equal(env.view.editError.value, '')
  } finally { env.dispose() }
})

test('旧个人页选照片入口在离页或身份变化后不读取文件或清输入', async () => {
  let photoCalls = 0
  for (const change of [env => env.dispose(), env => { env.auth.user = { id: 'other' }; env.auth.user = { id: '1' } }]) {
    const env = scene({ createPhoto: () => { photoCalls++; return 'synthetic' } })
    try {
      env.view.profileDialog.value.open = true; change(env)
      const input = { files: [{}], value: '保留输入' }
      await env.view.choosePhoto({ target: input })
      assert.equal(input.value, '保留输入')
    } finally { env.dispose() }
  }
  assert.equal(photoCalls, 0)
})

test('实际名片模板在身份变化后隐藏旧昵称和私有照片，切回后仍不显示旧快照', async () => {
  const env = scene()
  const content = readFileSync(new URL('../src/views/Profile.vue', import.meta.url), 'utf8')
  const template = content.match(/<section[^>]*class="profile-identity"[\s\S]*?<\/section>/)[0]
  const render = () => renderToString(createSSRApp({ template, setup: () => ({ ...env.view, SERVER_MODE: true, auth: env.auth }),
    components: { CatNavIcon: { template: '<i />' }, JournalSticker: { template: '<i />' }, ChevronRight: { template: '<i />' } } }))
  try {
    env.view.profile.value = { ...original, nickname: '私有合成昵称', avatar: 'photo', photo: 'synthetic-private-photo' }
    assert.match(await render(), /私有合成昵称/)
    assert.match(await render(), /synthetic-private-photo/)
    env.auth.user = { id: 'other' }
    assert.doesNotMatch(await render(), /私有合成昵称|synthetic-private-photo/)
    env.auth.user = { id: '1' }
    assert.doesNotMatch(await render(), /私有合成昵称|synthetic-private-photo/)
    assert.equal(env.requests.length, 0)
  } finally { env.dispose() }
})

test('备份导出：接口成功后触发下载并提示笔数，接口失败只报未完成', async () => {
  const downloads = []
  const env = scene({ backupDownloads: downloads })
  try {
    const first = env.view.exportBackup()
    assert.equal(env.requests.length, 1); assert.equal(env.requests[0].method, 'GET'); assert.equal(env.requests[0].path, '/api/records/export')
    assert.equal(env.view.backupBusy.value, true)
    const blocked = env.view.exportBackup()
    assert.equal(env.requests.length, 1); await blocked
    env.requests[0].resolve({ format: BACKUP_FORMAT, formatVersion: 1, exportedAt: '2026-10-12T05:00:00.000Z', recordCount: 2,
      records: [{ id: 'a' }, { id: 'b' }] })
    await first
    assert.equal(downloads.length, 1)
    assert.equal(downloads[0].filename, `miaoji-ledger-backup-${dayjs().format('YYYY-MM-DD')}.json`)
    assert.match(env.view.backupNotice.value, /已发起下载，共 2 笔/)
    assert.equal(env.view.backupBusy.value, false)
    const failing = env.view.exportBackup()
    env.requests[1].reject(new Error('服务器忙'))
    await failing
    assert.match(env.view.backupError.value, /导出未完成：服务器忙/)
    assert.equal(downloads.length, 1)
  } finally { env.dispose() }
})

test('备份导入：选文件先预览、确认后提交并刷新账本；取消与重新选择不发送多余请求', async () => {
  const env = scene({ backupRefresh: async () => true })
  try {
    const file = { name: 'backup.json', size: 2048, text: async () => JSON.stringify({
      format: BACKUP_FORMAT, formatVersion: 1, exportedAt: '2026-10-12T05:00:00.000Z', recordCount: 2,
      records: [
        { id: '9abf606b-a0d5-4053-98fb-000000000001', version: 0, type: 'expense', amount: '25.00', date: '2026-10-03', time: '12:30', category: '餐饮', note: '午饭', deletedAt: null, createdAt: null, updatedAt: null },
        { id: '9abf606b-a0d5-4053-98fb-000000000002', version: 0, type: 'income', amount: '100.00', date: '2026-10-04', time: null, category: '工资', note: '工资', deletedAt: '2026-10-05T01:00:00.000Z', createdAt: null, updatedAt: null },
      ] }) }
    const target = { files: [file], value: 'picked' }
    await env.view.chooseBackup({ target })
    assert.equal(target.value, '')
    assert.equal(env.view.backupPreview.value.summary.count, 2)
    assert.equal(env.view.backupPreview.value.summary.deleted, 1)
    assert.equal(env.view.backupPreview.value.name, 'backup.json')
    assert.equal(env.requests.length, 0)
    const pending = env.view.confirmBackupImport()
    assert.equal(env.requests.length, 1); assert.equal(env.requests[0].method, 'POST'); assert.equal(env.requests[0].path, '/api/records/import')
    assert.equal(env.requests[0].options.body.format, BACKUP_FORMAT)
    const blocked = env.view.confirmBackupImport(); await blocked
    assert.equal(env.requests.length, 1)
    env.requests[0].resolve({ imported: 2, skipped: 0, total: 2, revision: '5' })
    await pending
    assert.deepEqual(env.backupRefreshes, [true])
    assert.equal(env.view.backupPreview.value, null)
    assert.match(env.view.backupNotice.value, /已导入 2 笔账单/)
    assert.equal(env.view.backupBusy.value, false)
    await env.view.chooseBackup({ target: { files: [file], value: '' } })
    env.view.cancelBackupImport()
    assert.equal(env.view.backupPreview.value, null)
    assert.equal(env.requests.length, 1)
  } finally { env.dispose() }
})

test('备份导入：不合法或过大的文件给出明确错误且不产生预览', async () => {
  const env = scene()
  try {
    await env.view.chooseBackup({ target: { files: [{ name: 'x.json', size: 10, text: async () => 'hello' }], value: '' } })
    assert.equal(env.view.backupPreview.value, null)
    assert.match(env.view.backupError.value, /JSON/)
    await env.view.chooseBackup({ target: { files: [{ name: 'big.json', size: 9 * 1024 * 1024, text: async () => { assert.fail('不应读取超大文件') } }], value: '' } })
    assert.match(env.view.backupError.value, /8MB/)
    assert.equal(env.requests.length, 0)
  } finally { env.dispose() }
})
