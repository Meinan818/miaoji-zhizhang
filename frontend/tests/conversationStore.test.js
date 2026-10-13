import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { useConversationStore } from '../src/stores/conversationStore.js'
import { createDraft, applyDraftInput } from '../src/utils/draftEngine.js'
import { downloadJson } from '../src/utils/download.js'
let data, fail, writes
const key = 'zhizhang_conversation'
beforeEach(() => { data = new Map(); fail = false; writes = 0; globalThis.window = { localStorage: { getItem: k => data.get(k) ?? null, setItem: (k,v) => { if(fail) throw Error('full'); writes++; data.set(k,v) } } }; setActivePinia(createPinia()) })
test('真实AI空候选追问恢复原文，完整草稿允许未指定时间', async () => {
  const pending = { id: 'ai-pending', role: 'assistant', kind: 'draft-group', group: {
    id: 'ai-group', origin: 'ai', status: 'needs_input', items: [], pending: { kind: 'ai', text: '今天吃午饭', question: '花了多少钱？' },
  } }
  const ready = { id: 'ai-ready', role: 'assistant', kind: 'draft-group', group: {
    id: 'ai-ready-group', origin: 'ai', status: 'ready', pending: null,
    items: [{ id: 'ai-item', type: 'expense', amountCents: 2500, category: '餐饮', date: '2026-10-04', remark: '午饭' }],
  } }
  const raw = JSON.stringify([pending, ready]); data.set(key, raw)
  const store = useConversationStore(); assert.equal(store.restorationBlocked, false)
  assert.equal(store.messages[0].group.pending.text, '今天吃午饭'); assert.equal(writes, 0)
  assert.equal(data.get(key), raw)
})
test('真实AI损坏的追问上下文和空待确认组保护原文', () => {
  for (const group of [
    { id: 'g', origin: 'ai', status: 'needs_input', items: [], pending: { kind: 'ai', text: '', question: '多少钱' } },
    { id: 'g', origin: 'ai', status: 'ready', items: [], pending: null },
    { id: 'g', status: 'needs_input', items: [], pending: { kind: 'ai', text: '午饭', question: '多少钱' } },
  ]) {
    setActivePinia(createPinia()); const raw = JSON.stringify([{ id: 'm', role: 'assistant', kind: 'draft-group', group }]); data.set(key, raw)
    const store = useConversationStore(); assert.equal(store.restorationBlocked, true); assert.equal(data.get(key), raw)
  }
})

test('AI追问日期基准持久化后可恢复，非法日期保护原文', async () => {
  const group = { id: 'date-group', origin: 'ai', status: 'needs_input', items: [], createdDate: '2026-10-04',
    pending: { kind: 'ai', text: '昨天午饭', question: '多少钱？', referenceDate: '2026-10-06' } }
  const store = useConversationStore(); store.addMessage({ kind: 'draft-group', group }); await nextTick()
  const raw = data.get(key); setActivePinia(createPinia())
  const restored = useConversationStore()
  assert.equal(restored.restorationBlocked, false); assert.equal(restored.messages.at(-1).group.pending.referenceDate, '2026-10-06')
  assert.equal(data.get(key), raw)
  for (const invalid of ['2026-02-30', '9999-01-01', 42, null]) {
    setActivePinia(createPinia())
    const damaged = JSON.stringify([{ id: 'date-message', role: 'assistant', kind: 'draft-group',
      group: { ...group, pending: { ...group.pending, referenceDate: invalid } } }])
    data.set(key, damaged); const before = writes
    assert.equal(useConversationStore().restorationBlocked, true)
    assert.equal(data.get(key), damaged); assert.equal(writes, before)
  }
})
test('读取旧单笔对话不擅自迁移或覆盖', () => {
  const old = [{id:'old',role:'assistant',kind:'record',confirmed:false,record:{amount:25}}]
  data.set(key,JSON.stringify(old));const store=useConversationStore()
  assert.deepEqual(JSON.parse(JSON.stringify(store.messages)),old);assert.equal(writes,0)
})
test('不完整组草稿可保存和恢复当前追问上下文', async () => {
  const store=useConversationStore();const group={id:'g',status:'needs_input',items:[{id:'i',amountCents:null}],pending:{kind:'amountCents',itemId:'i'}}
  store.addMessage({kind:'draft-group',group});await nextTick();setActivePinia(createPinia())
  const restored=useConversationStore();assert.equal(restored.messages.at(-1).group.pending.itemId,'i');assert.equal(restored.messages.at(-1).group.items[0].amountCents,null)
})
test('对话存储失败提示可见但不抛出未捕获错误', async () => {
  const store=useConversationStore();fail=true;store.addMessage({content:'test'});await nextTick()
  assert.match(store.persistenceError,/未保存/);assert.equal(store.messages.at(-1).content,'test')
})

test('对话Store释放后迟到重试不再持久化旧快照，原存储保持', async () => {
  const raw = JSON.stringify([{ id: 'prior', role: 'assistant', kind: 'text', content: '合成原存储' }])
  data.set(key, raw)
  const store = useConversationStore()
  fail = true; store.addMessage({ content: '合成未保存消息' }); await nextTick()
  fail = false
  const before = writes, pending = store.retryPersistence()
  store.$dispose()
  assert.equal(await pending, false)
  assert.equal(data.get(key), raw)
  assert.equal(writes, before)
  assert.equal(await store.retryPersistence(), false)
  assert.equal(writes, before)
})

test('对话Store释放后迟到恢复不替换旧实例，当前存储不覆盖', async () => {
  data.set(key, 'corrupted-synthetic')
  const store = useConversationStore(), before = JSON.stringify(store.messages)
  const latest = JSON.stringify([{ id: 'latest', role: 'assistant', kind: 'text', content: '合成修复存储' }])
  data.set(key, latest)
  const pending = store.retryPersistence()
  store.$dispose()
  assert.equal(await pending, false)
  assert.equal(JSON.stringify(store.messages), before)
  assert.equal(data.get(key), latest)
  assert.equal(writes, 0)
})
test('损坏组结构保护原对话，不写入替换内容', async () => {
  const raw=JSON.stringify([{id:'bad',kind:'draft-group',group:{id:'bad',items:null}}]);data.set(key,raw)
  const store=useConversationStore();store.addMessage({content:'new'});await nextTick()
  assert.equal(data.get(key),raw);assert.match(store.persistenceError,/保护/)
})

test('重复消息/组/条目编号及未知消息结构保护原文', async () => {
  const text = { id: 'm', role: 'assistant', kind: 'text', content: 'old' }
  const draft = { id: 'g-message', role: 'assistant', kind: 'draft-group', group: { id: 'g', status: 'needs_input', items: [{ id: 'i', amountCents: null }], pending: { kind: 'amountCents', itemId: 'i' } } }
  for (const input of [[text, text], [{ ...text, kind: 'unknown' }], [draft, { ...draft, id: 'other' }], [{ ...draft, group: { ...draft.group, items: [{ id: 'i' }, { id: 'i' }] } }]]) {
    setActivePinia(createPinia()); const raw = JSON.stringify(input); data.set(key, raw)
    const store = useConversationStore(); store.addMessage({ content: 'new' }); await nextTick()
    assert.equal(data.get(key), raw); assert.equal(store.restorationBlocked, true)
  }
})
test('损坏金额/日期/追问引用与目标补丁不能静默恢复', async () => {
  const base = { id: 'g', status: 'needs_input', items: [{ id: 'i', amountCents: null }], pending: { kind: 'amountCents', itemId: 'i' } }
  const groups = [
    { ...base, items: [{ id: 'i', amountCents: -1 }] },
    { ...base, items: [{ id: 'i', date: '2026-02-30' }] },
    { ...base, items: [{ id: 'i', time: '25:00' }] },
    { ...base, pending: { kind: 'amountCents', itemId: 'missing' } },
    { ...base, pending: null },
    { ...base, pending: { kind: 'target', itemIds: ['missing'], patch: { amountCents: 100 } } },
    { ...base, pending: { kind: 'target', itemIds: ['i'], patch: { amountCents: 0 } } },
    { ...base, pending: { kind: 'target', itemIds: ['i'], patch: { category: 'bad' } } },
    { ...base, status: 'ready', pending: null },
  ]
  for (const group of groups) {
    setActivePinia(createPinia()); const raw = JSON.stringify([{ id: 'm', role: 'assistant', kind: 'draft-group', group }]); data.set(key, raw)
    const store = useConversationStore(); await nextTick(); assert.equal(data.get(key), raw)
    assert.equal(store.restorationBlocked, true); assert.match(store.persistenceError, /保护/)
  }
})
test('有效歧义目标上下文原样恢复', () => {
  const group = { id: 'g', status: 'needs_input', items: [{ id: 'a', amountCents: 100 }, { id: 'b', amountCents: 200 }], pending: { kind: 'target', itemIds: ['a','b'], patch: { amountCents: 300 } } }
  const raw = JSON.stringify([{ id: 'm', role: 'assistant', kind: 'draft-group', group }]); data.set(key, raw)
  const store = useConversationStore(); assert.equal(store.restorationBlocked, false)
  assert.equal(JSON.stringify(store.messages), raw); assert.equal(writes, 0)
})
test('完整待确认/已保存草稿正常恢复，历史不截断', () => {
  const item = { id: 'i', type: 'expense', amountCents: 100, category: '餐饮', date: '2026-10-03', time: '12:00', remark: '咖啡' }
  const messages = Array.from({ length: 250 }, (_, i) => ({ id: 'text-' + i, kind: 'text', role: 'user', content: '历史' + i }))
  messages.push({ id: 'ready', role: 'assistant', kind: 'draft-group', group: { id: 'ready', status: 'ready', items: [item], pending: null } },
    { id: 'saved', role: 'assistant', kind: 'draft-group', group: { id: 'saved', status: 'saved', items: [item], pending: null } })
  data.set(key, JSON.stringify(messages)); const store = useConversationStore()
  assert.equal(store.restorationBlocked, false); assert.equal(store.messages.length, 252); assert.equal(writes, 0)
})
test('写入失败后显式重试保存完整本页消息，不影响账本键', async () => {
  const store = useConversationStore(); data.set('zhizhang_mock_records', 'original-ledger')
  fail = true; store.addMessage({ content: '尚未保存' }); await nextTick(); assert.match(store.persistenceError, /未保存/)
  assert.equal(await store.retryPersistence(), false)
  fail = false; assert.equal(await store.retryPersistence(), true)
  assert.equal(store.persistenceError, ''); assert.equal(JSON.parse(data.get(key)).at(-1).content, '尚未保存')
  assert.equal(data.get('zhizhang_mock_records'), 'original-ledger')
})
test('读取失败重试失败仍保护原文，外部恢复有效数据后只读重载', async () => {
  data.set(key, '{bad'); const store = useConversationStore()
  assert.equal(await store.retryPersistence(), false); assert.equal(data.get(key), '{bad'); assert.equal(writes, 0)
  const raw = JSON.stringify([{ id: 'old', role: 'assistant', kind: 'text', content: '恢复的历史' }]); data.set(key, raw)
  assert.equal(await store.retryPersistence(), true); assert.equal(store.messages[0].content, '恢复的历史')
  assert.equal(store.persistenceError, ''); assert.equal(writes, 0); assert.equal(data.get(key), raw)
  store.addMessage({ content: '继续' }); await nextTick(); assert.equal(JSON.parse(data.get(key)).length, 2)
})
test('坏历史保护期间本页新增内容不能被重新读取覆盖，包含同tick重试', async () => {
  for (const settled of [false, true]) {
    setActivePinia(createPinia()); data.set(key, '{bad'); const store = useConversationStore()
    store.addMessage({ content: '本页新消息' }); if (settled) await nextTick()
    const raw = JSON.stringify([{ id: 'old', role: 'user', kind: 'text', content: '旧历史' }]); data.set(key, raw)
    assert.equal(await store.retryPersistence(), false); assert.equal(data.get(key), raw)
    assert.equal(store.messages.at(-1).content, '本页新消息'); assert.match(store.persistenceError, /避免覆盖/)
  }
})
test('空字符串坏存储不当作空历史覆盖，合法空历史原样保留', () => {
  data.set(key, ''); const blocked = useConversationStore(); assert.equal(blocked.restorationBlocked, true)
  setActivePinia(createPinia()); data.set(key, '[]'); const empty = useConversationStore()
  assert.equal(empty.restorationBlocked, false); assert.deepEqual(empty.messages, []); assert.equal(writes, 0)
})
test('存储读取异常保护原文，读取权限恢复后显式重试可用', async () => {
  const raw = JSON.stringify([{ id: 'old', kind: 'text', role: 'assistant', content: '原内容' }]); data.set(key, raw)
  const original = window.localStorage.getItem; window.localStorage.getItem = () => { throw Error('denied') }
  const store = useConversationStore(); assert.equal(store.restorationBlocked, true); assert.equal(writes, 0)
  assert.equal(await store.retryPersistence(), false); window.localStorage.getItem = original
  assert.equal(await store.retryPersistence(), true); assert.equal(JSON.stringify(store.messages), raw); assert.equal(writes, 0)
})
test('规则引擎真实产生的各类追问/歧义/取消/保存上下文可原样恢复', () => {
  const options = { date: '2026-10-03', time: '12:00' }
  const ready = createDraft('咖啡16，地铁3', options).group
  const sameNames = createDraft('咖啡16，咖啡20', options).group
  const groups = [ready, createDraft('咖啡', options).group, createDraft('红包20', options).group,
    createDraft('明天咖啡20', options).group, createDraft('咖啡20元 25:00', options).group,
    applyDraftInput(sameNames, '咖啡改成18', options).group,
    applyDraftInput(ready, '取消这组', options).group, { ...ready, status: 'saved' }]
  for (const group of groups) {
    setActivePinia(createPinia()); const raw = JSON.stringify([{ id: 'm', role: 'assistant', kind: 'draft-group', group }]); data.set(key, raw)
    const store = useConversationStore(); assert.equal(store.restorationBlocked, false, JSON.stringify(group))
    assert.equal(JSON.stringify(store.messages), raw); assert.equal(writes, 0)
  }
})

test('两个页面顺序写入时旧快照不能覆盖最新历史，冲突本页消息仍保留', async () => {
  const a = useConversationStore(); setActivePinia(createPinia()); const b = useConversationStore()
  a.addMessage({ content: '页面A新消息' }); await nextTick(); const latest = data.get(key), before = writes
  b.addMessage({ content: '页面B新消息' }); await nextTick()
  assert.equal(data.get(key), latest); assert.equal(writes, before)
  assert.equal(b.messages.at(-1).content, '页面B新消息'); assert.equal(b.storageConflict, true)
  assert.equal(b.hasUnsavedChanges, true); assert.match(b.persistenceError, /另一页面|其他页面/)
  assert.equal(await b.retryPersistence(), false); assert.equal(data.get(key), latest)
  assert.equal(b.messages.at(-1).content, '页面B新消息')
})
test('已经保存过的页面没有未保存内容时可以显式读取另一页面新历史', async () => {
  const a = useConversationStore(); a.addMessage({ content: '已保存的A内容' }); await nextTick()
  setActivePinia(createPinia()); const b = useConversationStore(); b.addMessage({ content: 'B新内容' }); await nextTick()
  const latest = data.get(key), before = writes
  assert.equal(a.hasUnsavedChanges, false)
  // No storage event mock here: retry must also perform the pre-write check.
  assert.equal(await a.retryPersistence(), false); assert.equal(a.storageConflict, true)
  assert.equal(await a.retryPersistence(), true)
  assert.equal(JSON.stringify(a.messages), latest); assert.equal(data.get(key), latest); assert.equal(writes, before)
  a.addMessage({ content: '读取后继续' }); await nextTick()
  assert.equal(JSON.parse(data.get(key)).length, 4); assert.equal(a.hasUnsavedChanges, false)
})
test('对话写入失败期间外部历史改变，重试不得覆盖任何一份内容', async () => {
  const store = useConversationStore(); fail = true; store.addMessage({ content: '写入失败的本页内容' }); await nextTick()
  const external = JSON.stringify([{ id:'external', role:'assistant', kind:'text', content:'其他页面内容' }]); data.set(key, external); fail = false
  assert.equal(await store.retryPersistence(), false); assert.equal(data.get(key), external)
  assert.equal(store.messages.at(-1).content, '写入失败的本页内容'); assert.equal(store.storageConflict, true)
  assert.equal(await store.retryPersistence(), false); assert.equal(data.get(key), external)
})

function storageEvents() {
  const listeners = new Set()
  window.addEventListener = (type, listener) => { if (type === 'storage') listeners.add(listener) }
  window.removeEventListener = (type, listener) => { if (type === 'storage') listeners.delete(listener) }
  return { emit: event => { for (const listener of listeners) listener(event) }, count: () => listeners.size }
}
const textHistory = content => JSON.stringify([{ id:'external', role:'assistant', kind:'text', content }])
test('同Pinia重建只读当前历史，追加不会把已保存旧快照覆盖回来', async () => {
  const old = useConversationStore(); old.addMessage({ content: '此前已保存' }); await nextTick()
  old.setThinking(true); old.setMascotMood('thinking'); old.$dispose()
  const latest = textHistory('释放期间另一页面更新'); data.set(key, latest)
  const before = writes, rebuilt = useConversationStore()
  await nextTick()
  assert.equal(JSON.stringify(rebuilt.messages), latest); assert.equal(writes, before)
  assert.equal(rebuilt.isThinking, false); assert.equal(rebuilt.mascotMood, 'happy')
  rebuilt.addMessage({ content: '新实例继续' }); await nextTick()
  assert.equal(JSON.parse(data.get(key))[0].content, '释放期间另一页面更新')
  assert.equal(JSON.parse(data.get(key)).length, 2)
})
test('同Pinia重建识别新损坏历史，旧正常状态不解除保护', async () => {
  const old = useConversationStore(); old.$dispose(); data.set(key, '{new-damaged')
  const rebuilt = useConversationStore(); await nextTick()
  assert.equal(rebuilt.restorationBlocked, true); assert.match(rebuilt.persistenceError, /保护/)
  rebuilt.addMessage({ content: '合成本页草稿' }); await nextTick()
  assert.equal(data.get(key), '{new-damaged'); assert.equal(writes, 0)
})
test('同Pinia重建清除已过期读取错误，当前有效历史可继续保存', async () => {
  data.set(key, '{prior-damaged'); const old = useConversationStore(); old.$dispose()
  const latest = textHistory('已修复合成历史'); data.set(key, latest)
  const rebuilt = useConversationStore(); await nextTick()
  assert.equal(rebuilt.restorationBlocked, false); assert.equal(rebuilt.persistenceError, '')
  assert.equal(JSON.stringify(rebuilt.messages), latest); assert.equal(writes, 0)
  rebuilt.addMessage({ content: '继续保存' }); await nextTick()
  assert.equal(JSON.parse(data.get(key)).length, 2)
})
test('重建保留失败写入的草稿与原基准，外部新历史不能被重试覆盖', async () => {
  data.set(key, textHistory('原基准')); const old = useConversationStore()
  fail = true; old.addMessage({ content: '失败写入的本页草稿' }); await nextTick(); old.$dispose()
  fail = false; const latest = textHistory('另一页新历史'); data.set(key, latest)
  const rebuilt = useConversationStore(), before = writes; await nextTick()
  assert.equal(rebuilt.messages.at(-1).content, '失败写入的本页草稿')
  assert.equal(rebuilt.hasUnsavedChanges, true); assert.equal(rebuilt.storageConflict, true)
  assert.equal(await rebuilt.retryPersistence(), false)
  assert.equal(data.get(key), latest); assert.equal(writes, before)
})
test('重建保留同tick释放前尚未执行监听的草稿，可显式重试且脱离旧实例引用', async () => {
  const old = useConversationStore(); old.addMessage({ content: '同tick未保存草稿' }); old.$dispose()
  const rebuilt = useConversationStore(); await nextTick()
  assert.equal(rebuilt.hasUnsavedChanges, true); assert.equal(writes, 0)
  old.messages.at(-1).content = '旧实例迟到修改'
  assert.equal(rebuilt.messages.at(-1).content, '同tick未保存草稿')
  assert.equal(await rebuilt.retryPersistence(), true)
  assert.equal(JSON.parse(data.get(key)).at(-1).content, '同tick未保存草稿')
})
test('重建保留坏历史期间新增草稿，多次释放仍保护两份内容', async () => {
  data.set(key, '{protected-damaged'); const old = useConversationStore()
  old.addMessage({ content: '坏历史期间本页草稿' }); await nextTick(); old.$dispose()
  const latest = textHistory('外部修复历史'); data.set(key, latest)
  const first = useConversationStore(); first.$dispose(); const rebuilt = useConversationStore()
  assert.equal(rebuilt.messages.at(-1).content, '坏历史期间本页草稿')
  assert.equal(await rebuilt.retryPersistence(), false)
  assert.equal(data.get(key), latest); assert.equal(writes, 0)
})
let serverModuleNumber = 0
async function loadServerConversation(auth) {
  const sourceUrl = new URL('../src/stores/conversationStore.js', import.meta.url)
  let source = await readFile(sourceUrl, 'utf8')
  globalThis.__conversationAuth = auth
  source = source.replace("import { SERVER_MODE } from '../api/mode.js'", 'const SERVER_MODE = true')
    .replace("import { useAuthStore } from './authStore.js'", 'const useAuthStore = () => globalThis.__conversationAuth')
    .replace(/from '([^']+)'/g, (_, path) => `from '${path.startsWith('.') ? new URL(path, sourceUrl).href : import.meta.resolve(path)}'`)
  const { useConversationStore: useServerConversation } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${serverModuleNumber++}`)
  return useServerConversation
}
test('正式同Pinia重建按账号键隔离，A未保存草稿不回填或写入B历史', async () => {
  const auth = reactive({ user: { id: 'synthetic-A' } })
  const useServerConversation = await loadServerConversation(auth)
  const aKey = 'miaoji_account_conversation_v1_synthetic-A', bKey = 'miaoji_account_conversation_v1_synthetic-B'
  const aRaw = textHistory('A历史'), bRaw = textHistory('B历史'); data.set(aKey, aRaw); data.set(bKey, bRaw)
  try {
    const a = useServerConversation(); fail = true; a.addMessage({ content: 'A未保存草稿' }); await nextTick(); a.$dispose()
    fail = false; auth.user = { id: 'synthetic-B' }
    const b = useServerConversation(); await nextTick()
    assert.equal(JSON.stringify(b.messages), bRaw); assert.equal(b.hasUnsavedChanges, false)
    assert.equal(b.persistenceError, ''); assert.equal(writes, 0)
    b.addMessage({ content: 'B继续' }); await nextTick()
    assert.equal(JSON.parse(data.get(bKey))[0].content, 'B历史'); assert.equal(data.get(aKey), aRaw)
    b.$dispose(); auth.user = { id: 'synthetic-A' }; const restoredA = useServerConversation()
    assert.equal(restoredA.messages.at(-1).content, 'A未保存草稿')
    assert.equal(await restoredA.retryPersistence(), true)
    assert.equal(JSON.parse(data.get(aKey)).at(-1).content, 'A未保存草稿'); restoredA.$dispose()
  } finally { delete globalThis.__conversationAuth }
})
test('身份先变化再释放，A未保存草稿保留到回到A的新实例，B不能读取', async () => {
  const auth = reactive({ user: { id: 'synthetic-A' } }), useServerConversation = await loadServerConversation(auth)
  const aKey = 'miaoji_account_conversation_v1_synthetic-A', bKey = 'miaoji_account_conversation_v1_synthetic-B'
  const aRaw = textHistory('A原历史'), bRaw = textHistory('B原历史'); data.set(aKey, aRaw); data.set(bKey, bRaw)
  try {
    const a = useServerConversation(); fail = true; a.addMessage({ content: 'A身份变化前未保存' }); await nextTick(); fail = false
    auth.user = { id: 'synthetic-B' }
    assert.deepEqual(a.messages, []); assert.equal(await a.retryPersistence(), false)
    assert.throws(() => a.createBackup(), /账号或页面已变化/)
    a.$dispose(); const b = useServerConversation()
    assert.equal(JSON.stringify(b.messages), bRaw); assert.equal(writes, 0); b.$dispose()
    auth.user = { id: 'synthetic-A' }; const newA = useServerConversation()
    assert.equal(newA.messages.at(-1).content, 'A身份变化前未保存')
    assert.equal(newA.hasUnsavedChanges, true); assert.equal(await newA.retryPersistence(), true)
    assert.equal(JSON.parse(data.get(aKey)).at(-1).content, 'A身份变化前未保存')
    assert.equal(data.get(bKey), bRaw); newA.$dispose()
  } finally { delete globalThis.__conversationAuth }
})
test('身份改变期间旧恢复回执不认成功，切回同账号也不能复活旧实例', async () => {
  const auth = reactive({ user: { id: 'synthetic-A' } }), useServerConversation = await loadServerConversation(auth)
  const aKey = 'miaoji_account_conversation_v1_synthetic-A'
  try {
    data.set(aKey, '{bad-A'); const a = useServerConversation(), latest = textHistory('恢复A原文')
    data.set(aKey, latest); const pending = a.retryPersistence(); await nextTick()
    assert.equal(JSON.stringify(a.messages), latest)
    auth.user = null
    assert.equal(await pending, false); assert.deepEqual(a.messages, [])
    assert.match(a.persistenceError, /账号已变化/)
    auth.user = { id: 'synthetic-A' }
    assert.equal(await a.retryPersistence(), false); assert.deepEqual(a.messages, [])
    assert.equal(data.get(aKey), latest); assert.equal(writes, 0); a.$dispose()
  } finally { delete globalThis.__conversationAuth }
})
test('同tick身份改变前草稿可保留，旧实例迟到消息不回填新身份', async () => {
  const auth = reactive({ user: { id: 'synthetic-A' } }), useServerConversation = await loadServerConversation(auth)
  try {
    const a = useServerConversation(); a.addMessage({ content: '同tick A草稿' }); auth.user = { id: 'synthetic-B' }
    a.addMessage({ content: '旧实例迟到消息' }); a.setThinking(true); a.setMascotMood('thinking'); await nextTick()
    assert.deepEqual(a.messages, []); assert.equal(a.isThinking, false); assert.equal(writes, 0)
    a.$dispose(); auth.user = { id: 'synthetic-A' }; const newA = useServerConversation()
    assert.equal(newA.messages.at(-1).content, '同tick A草稿'); assert.equal(newA.hasUnsavedChanges, true)
    newA.$dispose()
  } finally { delete globalThis.__conversationAuth }
})
test('存储事件只提示冲突，不自动重读或覆盖，显式重读不产生写入', async () => {
  const events = storageEvents(), store = useConversationStore(), before = JSON.stringify(store.messages)
  const latest = textHistory('另一页面最新历史'); data.set(key, latest); events.emit({ key, newValue: latest })
  assert.equal(store.storageConflict, true); assert.equal(store.hasUnsavedChanges, false)
  assert.equal(JSON.stringify(store.messages), before); assert.equal(writes, 0)
  assert.equal(await store.retryPersistence(), true); assert.equal(JSON.stringify(store.messages), latest)
  assert.equal(data.get(key), latest); assert.equal(writes, 0); assert.equal(store.storageConflict, false)
})
test('恢复渲染期间新增消息正常保存，回执不能把尚未写入的编辑当已保存', async () => {
  data.set(key, '{bad'); const store = useConversationStore(), latest = textHistory('恢复原文')
  data.set(key, latest); const pending = store.retryPersistence(); await nextTick()
  assert.equal(JSON.stringify(store.messages), latest)
  store.addMessage({ content: '恢复渲染期间的新消息' })
  assert.equal(await pending, true)
  assert.equal(JSON.parse(data.get(key)).at(-1).content, '恢复渲染期间的新消息')
  assert.equal(store.hasUnsavedChanges, false); assert.equal(store.persistenceError, '')
})
test('恢复期间编辑写入失败保留未保存标记，显式重试后才能清除', async () => {
  data.set(key, '{bad'); const store = useConversationStore(), latest = textHistory('恢复原文')
  data.set(key, latest); const pending = store.retryPersistence(); await nextTick()
  fail = true; store.addMessage({ content: '恢复期间未保存消息' })
  assert.equal(await pending, false); assert.equal(store.hasUnsavedChanges, true)
  assert.match(store.persistenceError, /未保存/); assert.equal(data.get(key), latest)
  fail = false; assert.equal(await store.retryPersistence(), true)
  assert.equal(JSON.parse(data.get(key)).at(-1).content, '恢复期间未保存消息')
})
test('恢复期间新编辑和外部更新并存，不重读覆盖新编辑也不写外部历史', async () => {
  data.set(key, '{bad'); const store = useConversationStore(), latest = textHistory('恢复原文')
  data.set(key, latest); const pending = store.retryPersistence(); await nextTick()
  store.addMessage({ content: '恢复期间新草稿' }); const external = textHistory('又一次外部更新'); data.set(key, external)
  assert.equal(await pending, false); assert.equal(store.hasUnsavedChanges, true)
  assert.equal(store.storageConflict, true); assert.match(store.persistenceError, /未保存/)
  assert.equal(await store.retryPersistence(), false)
  assert.equal(store.messages.at(-1).content, '恢复期间新草稿')
  assert.equal(data.get(key), external); assert.equal(writes, 0)
})
test('同tick与恢复期间重复重试被阻断，首次只读恢复不会额外写入', async () => {
  data.set(key, '{bad'); const store = useConversationStore(), latest = textHistory('恢复原文')
  data.set(key, latest); const first = store.retryPersistence(), second = store.retryPersistence()
  assert.equal(await second, false); assert.equal(await first, true)
  assert.equal(data.get(key), latest); assert.equal(writes, 0)
  data.set(key, textHistory('另一页面')); const pending = store.retryPersistence()
  assert.equal(await store.retryPersistence(), false); assert.equal(await pending, false)
  assert.equal(store.storageConflict, true)
  const recovering = store.retryPersistence(); await nextTick()
  assert.equal(await store.retryPersistence(), false); assert.equal(await recovering, true)
  assert.equal(writes, 0)
})
test('无关键/sessionStorage/延迟旧事件不会误锁已同步快照', async () => {
  const events = storageEvents(), store = useConversationStore()
  store.addMessage({ content:'当前已保存' }); await nextTick(); const latest = data.get(key)
  events.emit({ key:'zhizhang_mock_records', newValue:'other' })
  events.emit({ key, storageArea:{}, newValue:'session-only' })
  events.emit({ key, newValue:'older-delayed-snapshot' })
  assert.equal(store.storageConflict, false); assert.equal(data.get(key), latest); assert.equal(store.persistenceError, '')
})
test('Store销毁会移除storage监听，不残留事件动作', () => {
  const events = storageEvents(), store = useConversationStore(); assert.equal(events.count(), 1)
  store.$dispose(); assert.equal(events.count(), 0)
  data.set(key, textHistory('外部')); events.emit({ key }); assert.equal(store.storageConflict, false)
})
test('另一页移除对话键或clear事件时不自动重新生成/覆盖历史', async () => {
  for (const eventKey of [key, null]) {
    setActivePinia(createPinia()); data.set(key, textHistory('初始历史')); const events = storageEvents(), store = useConversationStore()
    data.delete(key); events.emit({ key:eventKey, newValue:null }); const before = writes
    store.addMessage({ content:'旧页面新消息' }); await nextTick()
    assert.equal(data.has(key), false); assert.equal(store.storageConflict, true); assert.equal(writes, before)
    assert.equal(await store.retryPersistence(), false); assert.equal(data.has(key), false)
  }
})
test('外部历史损坏后显式重读仍保护原文，不写入替换内容', async () => {
  const events = storageEvents(), store = useConversationStore(); data.set(key, '{bad-external'); events.emit({ key })
  assert.equal(await store.retryPersistence(), false); assert.equal(store.restorationBlocked, true)
  assert.equal(data.get(key), '{bad-external'); assert.equal(writes, 0)
  const valid = textHistory('修复后的原历史'); data.set(key, valid)
  assert.equal(await store.retryPersistence(), true); assert.equal(JSON.stringify(store.messages), valid); assert.equal(writes, 0)
})
test('冲突后同tick新增草稿与重读，先排空监听再保护本页内容', async () => {
  const events = storageEvents(), store = useConversationStore(), group = createDraft('咖啡', {date:'2026-10-03',time:'12:00'}).group
  const latest = textHistory('其他页面'); data.set(key, latest); events.emit({ key })
  store.addMessage({ kind:'draft-group', group })
  assert.equal(await store.retryPersistence(), false); assert.equal(data.get(key), latest)
  assert.equal(store.messages.at(-1).group.id, group.id); assert.equal(store.messages.at(-1).group.pending.kind, 'amountCents')
})
test('普通写入前读取失败保留未保存状态，权限恢复且快照未变可重试', async () => {
  const store = useConversationStore(), get = window.localStorage.getItem
  window.localStorage.getItem = () => { throw Error('denied') }
  store.addMessage({ content:'权限异常的新消息' }); await nextTick()
  assert.equal(store.hasUnsavedChanges, true); assert.equal(writes, 0)
  window.localStorage.getItem = get; assert.equal(await store.retryPersistence(), true)
  assert.equal(store.hasUnsavedChanges, false); assert.equal(JSON.parse(data.get(key)).at(-1).content, '权限异常的新消息')
})
test('重读时外部再次更新不能假报成功或写回已过期历史', async () => {
  const events = storageEvents(), store = useConversationStore(); const older = textHistory('第一份外部历史'), latest = textHistory('重读时又更新')
  data.set(key, older); events.emit({ key }); const get = window.localStorage.getItem; let calls = 0
  window.localStorage.getItem = k => { if(k === key && calls++ === 0){ data.set(key,latest);return older }return get(k) }
  assert.equal(await store.retryPersistence(), false); assert.equal(store.storageConflict, true)
  assert.equal(data.get(key), latest); assert.equal(writes, 0)
  window.localStorage.getItem = get; assert.equal(await store.retryPersistence(), true); assert.equal(JSON.stringify(store.messages), latest)
})
test('冲突页确认账单仍走同一账本，历史未覆盖且重复确认不能重复入账', async () => {
  const { useRecordStore } = await import('../src/stores/recordStore.js')
  const group = createDraft('咖啡16', {date:'2026-10-03',time:'12:00'}).group
  const conversation = useConversationStore(); conversation.addMessage({id:'draft',kind:'draft-group',group}); await nextTick()
  data.set('zhizhang_mock_records','[]'); const ledger = useRecordStore()
  const latest = textHistory('外部更新'); data.set(key, latest)
  const saved = ledger.addRecords(group.items, {batchId:group.id, source:'chat'})
  conversation.updateGroup('draft', {...group,status:'saved'}); conversation.addMessage({content:'已记下一笔'}); await nextTick()
  assert.equal(data.get(key), latest); assert.equal(conversation.storageConflict, true); assert.equal(conversation.hasUnsavedChanges, true)
  assert.equal(saved.length,1); assert.equal(ledger.records.length,1)
  ledger.addRecords(group.items, {batchId:group.id,source:'chat'}); assert.equal(ledger.records.length,1)
  assert.equal(conversation.messages.find(m=>m.id==='draft').group.status,'saved')
})
test('显式备份保留本页未保存草稿和损坏存储原文，不改变存储或错误', () => {
  const raw = '{bad-history'; data.set(key, raw); const store = useConversationStore()
  store.addMessage({ content: '本页未保存草稿' })
  const priorError = store.persistenceError, backup = store.createBackup()
  assert.equal(backup.hasUnsavedChanges, true); assert.equal(backup.mode, 'demo')
  assert.equal(backup.messages.at(-1).content, '本页未保存草稿')
  assert.deepEqual(backup.storedHistory, { readable: true, raw })
  backup.messages.at(-1).content = '修改备份副本'
  assert.equal(store.messages.at(-1).content, '本页未保存草稿')
  assert.equal(store.persistenceError, priorError); assert.equal(data.get(key), raw); assert.equal(writes, 0)
  store.$dispose(); assert.throws(() => store.createBackup(), /账号或页面已变化/)
})
test('冲突备份同时保留本页快照与另一页面当前原文，未读取无关存储键', async () => {
  const events = storageEvents(), store = useConversationStore(); fail = true; store.addMessage({ content: '本页草稿' }); await nextTick()
  fail = false; const raw = textHistory('外部原文'); data.set(key, raw); events.emit({ key })
  const reads = [], get = window.localStorage.getItem
  window.localStorage.getItem = name => { reads.push(name); return get(name) }
  const backup = store.createBackup()
  assert.equal(backup.messages.at(-1).content, '本页草稿'); assert.equal(backup.storedHistory.raw, raw)
  assert.deepEqual(reads, [key]); assert.equal(writes, 0); assert.equal(store.storageConflict, true)
})
test('浏览器存储不可读时仍能备份本页，明确标识缺少存储原文', () => {
  const store = useConversationStore(); store.addMessage({ content: '合成本页内容' })
  window.localStorage.getItem = () => { throw Error('denied') }
  const backup = store.createBackup()
  assert.deepEqual(backup.storedHistory, { readable: false, raw: null })
  assert.equal(backup.messages.at(-1).content, '合成本页内容'); assert.equal(writes, 0)
  store.$dispose()
})
test('备份下载生成完整JSON，仅点击本机链接且延后释放对象URL', async () => {
  let blob, clicked = 0, removed = 0, timer, revoked = 0
  const anchor = { click() { clicked++ }, remove() { removed++ } }
  const environment = { URL: { createObjectURL(value) { blob = value; return 'blob:synthetic' }, revokeObjectURL(value) { assert.equal(value, 'blob:synthetic'); revoked++ } },
    document: { createElement(name) { assert.equal(name, 'a'); return anchor }, body: { appendChild(value) { assert.equal(value, anchor) } } },
    setTimeout(fn, delay) { assert.equal(delay, 1000); timer = fn } }
  const backup = { messages: [{ content: '本页草稿' }], storedHistory: { readable: true, raw: '{damaged' } }
  downloadJson(backup, 'conversation.json', environment)
  assert.deepEqual(JSON.parse(await blob.text()), backup); assert.equal(blob.type, 'application/json;charset=utf-8')
  assert.equal(anchor.href, 'blob:synthetic'); assert.equal(anchor.download, 'conversation.json')
  assert.equal(clicked, 1); assert.equal(removed, 1); assert.equal(revoked, 0)
  timer(); assert.equal(revoked, 1)
})
test('备份下载启动失败时仍释放链接和对象URL，不吞掉失败', () => {
  let removed = 0, revoked = 0
  const environment = { URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL: () => { revoked++ } },
    document: { createElement: () => ({ click() { throw Error('download failed') }, remove() { removed++ } }), body: { appendChild() {} } },
    setTimeout() { assert.fail('失败不保留定时任务') } }
  assert.throws(() => downloadJson({}, 'conversation.json', environment), /download failed/)
  assert.equal(removed, 1); assert.equal(revoked, 1)
})
