<script setup>
import ManualEntry from '@/components/record/ManualEntry.vue'
// 1. 导入
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import NotebookBack from '@/components/common/NotebookBack.vue'
import JournalSticker from '@/components/common/JournalSticker.vue'
import CatNavIcon from '@/components/common/CatNavIcon.vue'
import ChatBubble from '@/components/common/ChatBubble.vue'
import ChatInput from '@/components/common/ChatInput.vue'
import ConfirmCard from '@/components/common/ConfirmCard.vue'
import DraftGroupCard from '@/components/common/DraftGroupCard.vue'
import { createDraft, applyDraftInput, groupReply, isQuery, resolveGroup } from '@/utils/draftEngine'
import { centsText, legacyCents } from '@/utils/money'
import { validateRecord } from '@/utils/ledger'
import miaoAvatar from '@/assets/design/mascot/miao-avatar-fluffy-v1.png'
import miaoThinking from '@/assets/design/mascot/poses/miao-thinking.png'
import { useConversationStore } from '@/stores/conversationStore'
import { useRecordStore } from '@/stores/recordStore'
import { formatCurrency } from '@/utils/format'
import { getMonthQueryReply } from '@/utils/chatQuery'
import { linkGroupRecords } from '@/utils/groupRecords'
import { SERVER_MODE } from '@/api/mode'
import { createAiDraftApi, draftControl } from '@/api/aiDraft'
import { useAuthStore } from '@/stores/authStore'
import { downloadJson } from '@/utils/download'

// 2. 组合式函数
const conversationStore = useConversationStore()
const recordStore = useRecordStore()
const auth = SERVER_MODE ? useAuthStore() : null
const owner = auth?.user?.id
let disposed = false
const ownerCurrent = ref(!SERVER_MODE || Boolean(owner))
function isCurrentView() { return !disposed && ownerCurrent.value }
const aiDraft = SERVER_MODE ? createAiDraftApi(auth.api, { isCurrent: isCurrentView }) : null
const aiElapsed = ref(0)
const aiRunning = ref(false)
let aiController = null
let aiTimer = null
let sendGeneration = 0
let sending = false
function clearAiWait() {
  if (aiTimer) window.clearInterval(aiTimer)
  aiTimer = null; aiRunning.value = false; aiElapsed.value = 0
}
function stopAiWait() {
  if (!isCurrentView() || !aiController) return
  aiController.abort(); aiController = null; clearAiWait(); sendGeneration++
  sending = false; conversationStore.setThinking(false); conversationStore.setMascotMood('happy')
  reply('本次整理已停止，未入账。原草稿保留；平台任务可能仍在结束中，请稍后再发。')
}

// Temporary display name; user naming is planned, not implemented.
const catDisplayName = '小宝'

// 3. 响应式数据
const messagesContainer = ref(null)
let moodTimer = null
if (SERVER_MODE) watch(() => auth.user?.id, value => {
  if (value === owner) return
  ownerCurrent.value = false
  sending = false; sendGeneration++
  aiController?.abort(); aiController = null; clearAiWait()
  if (moodTimer) { window.clearTimeout(moodTimer); moodTimer = null }
}, { flush: 'sync' })

// 4. 计算属性
const monthExpenseText = computed(() => recordStore.storageError ? '暂不可读取'
  : recordStore.summaryError ? '暂无法准确汇总' : `¥${centsText(recordStore.monthExpenseCents)}`)

// 5. 方法
function scrollToBottom() {
  nextTick(() => {
    if (isCurrentView() && messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
}

function resetMoodLater() {
  if (!isCurrentView()) return
  if (moodTimer) {
    window.clearTimeout(moodTimer)
  }

  moodTimer = window.setTimeout(() => {
    if (isCurrentView()) conversationStore.setMascotMood('happy')
  }, 1800)
}

const savingGroup = ref(null)
const actionErrors = ref({})
const activeDraftMessage = computed(() => {
  const messages = conversationStore.messages
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.kind === 'draft-group' && m.group && ['needs_input', 'ready'].includes(m.group.status)
      && recordStore.batchRecords(m.group.id).length === 0) return m
  }
  return null
})
// Display a window, not a storage limit. Older active drafts stay reachable.
const historyBatchSize = 40
const visibleLimit = ref(historyBatchSize)
const recentMessages = computed(() => conversationStore.messages.slice(-visibleLimit.value))
const pinnedDraft = computed(() => activeDraftMessage.value && !recentMessages.value.includes(activeDraftMessage.value) ? activeDraftMessage.value : null)
const visibleMessages = computed(() => pinnedDraft.value ? [pinnedDraft.value, ...recentMessages.value] : recentMessages.value)
const hiddenCount = computed(() => Math.max(0, conversationStore.messages.length - visibleMessages.value.length))
const loadingHistory = ref(false)
const retryingPersistence = ref(false)
const backupNote = ref('')
function backupConversation() {
  if (!isCurrentView()) return
  try {
    const backup = conversationStore.createBackup()
    downloadJson(backup, `miaoji-conversation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    backupNote.value = backup.storedHistory.readable
      ? '已发起备份下载，请确认文件已保存后再刷新。'
      : '已发起本页备份下载。浏览器中的旧对话仍无法读取，请保留本页且不要清除存储。'
  } catch { backupNote.value = '备份下载未启动，请保留本页内容，稍后重试。' }
}
async function loadEarlier() {
  if (!isCurrentView() || loadingHistory.value) return
  loadingHistory.value = true
  const container = messagesContainer.value
  const previousHeight = container?.scrollHeight || 0
  const previousTop = container?.scrollTop || 0
  visibleLimit.value += historyBatchSize
  await nextTick()
  if (!isCurrentView()) return
  if (container && container === messagesContainer.value) container.scrollTop = previousTop + container.scrollHeight - previousHeight
  loadingHistory.value = false
}
async function retryConversation() {
  if (!isCurrentView() || retryingPersistence.value || conversationStore.isThinking || savingGroup.value) return
  retryingPersistence.value = true
  try {
    const restored = await conversationStore.retryPersistence()
    if (!isCurrentView()) return
    if (restored) {
      actionErrors.value = {}
      visibleLimit.value = historyBatchSize
      scrollToBottom()
    }
  } finally { if (isCurrentView()) retryingPersistence.value = false }
}
function reply(content) { if (isCurrentView()) conversationStore.addMessage({ role: 'assistant', kind: 'text', content }) }
async function queryReply(text) {
  if (!isCurrentView()) return
  const loaded = await recordStore.refresh()
  if (!isCurrentView()) return
  if (!loaded) { reply(recordStore.storageError); return }
  try { reply(getMonthQueryReply(text, recordStore.records)) }
  catch (error) { reply('本月查询暂时无法显示：' + error.message + '。账单没有改变。') }
}
async function saveDraft(messageId) {
  const message = conversationStore.messages.find(m => m.id === messageId)
  if (!isCurrentView() || !message?.group || message.group.status !== 'ready' || savingGroup.value || retryingPersistence.value) return
  savingGroup.value = messageId
  actionErrors.value[messageId] = ''
  try {
    const saved = await recordStore.addRecords(message.group.items, { batchId: message.group.id, source: 'chat' })
    if (!isCurrentView()) return
    conversationStore.updateGroup(messageId, { ...message.group, status: 'saved', pending: null, recordIds: saved.map(record => record.id) })
    reply('本喵已记下' + saved.length + '笔，首页和明细已同步。之后直接改明细，查询也会读取最新账单。')
    conversationStore.setMascotMood('success'); resetMoodLater()
  } catch (e) { if (isCurrentView()) { actionErrors.value[messageId] = e.message; reply(e.message) } }
  finally { if (isCurrentView()) { savingGroup.value = null; scrollToBottom() } }
}
function cancelDraft(messageId) {
  if (!isCurrentView()) return
  const message = conversationStore.messages.find(m => m.id === messageId)
  if (!message?.group || conversationStore.isThinking || savingGroup.value || retryingPersistence.value || recordStore.batchRecords(message.group.id).length) return
  const result = message.group.origin === 'ai'
    ? { group: { ...message.group, status: 'cancelled', pending: null }, reply: '这组已取消，没有写入账单。' }
    : applyDraftInput(message.group, '取消这组')
  conversationStore.updateGroup(messageId, result.group); actionErrors.value[messageId] = ''; reply(result.reply)
}
function editDraft(messageId, { itemId, record }) {
  if (!isCurrentView()) return
  const message = conversationStore.messages.find(m => m.id === messageId)
  if (!message?.group || conversationStore.isThinking || savingGroup.value || retryingPersistence.value || ['saved', 'cancelled'].includes(message.group.status) || recordStore.batchRecords(message.group.id).length) return
  const group = JSON.parse(JSON.stringify(message.group))
  const item = group.items.find(i => i.id === itemId)
  if (!item) return
  try {
    const omitTime = SERVER_MODE && group.origin === 'ai' && !item.time && !record.time
    const normalized = validateRecord({ ...record, time: omitTime ? '00:00' : record.time })
    if (omitTime) delete normalized.time
    Object.assign(item, normalized, { amountCents: legacyCents(normalized.amount), description: normalized.remark || normalized.category, errors: { amount: '', date: '', time: '' } })
    if (group.origin !== 'ai') { group.pending = null; resolveGroup(group) }
    conversationStore.updateGroup(messageId, group); actionErrors.value[messageId] = ''; reply(group.pending?.kind === 'ai' ? group.pending.question : groupReply(group))
  } catch (e) { actionErrors.value[messageId] = e.message }
}
async function handleSend(userInput) {
  const text = String(userInput || '').trim()
  if (!isCurrentView() || !text || conversationStore.isThinking || savingGroup.value || retryingPersistence.value) return
  const generation = ++sendGeneration
  sending = true
  conversationStore.addMessage({ role: 'user', kind: 'text', content: text })
  conversationStore.setThinking(true); conversationStore.setMascotMood('thinking'); scrollToBottom()
  try {
    if (SERVER_MODE) { await handleServerSend(text); return }
    await wait(600)
    if (!isCurrentView() || generation !== sendGeneration) return
    await recordStore.refresh()
    if (!isCurrentView() || generation !== sendGeneration) return
    const active = activeDraftMessage.value
    if (active) {
      const result = applyDraftInput(active.group, text)
      if (result.action === 'query') await queryReply(text)
      else if (result.action === 'confirm') await saveDraft(active.id)
      else { conversationStore.updateGroup(active.id, result.group); actionErrors.value[active.id] = ''; reply(result.reply) }
    } else if (isQuery(text)) await queryReply(text)
    else {
      const result = createDraft(text)
      reply(result.reply)
      if (result.group) conversationStore.addMessage({ role: 'assistant', kind: 'draft-group', group: result.group })
    }
  } catch { reply('本喵这次没整理好，草稿没有入账。可以再说清楚一些，或者用手动记账。') }
  finally { if (isCurrentView() && generation === sendGeneration) { sending = false; conversationStore.setThinking(false); conversationStore.setMascotMood('happy'); scrollToBottom() } }
}
async function handleServerSend(text) {
  if (!isCurrentView()) return
  const active = activeDraftMessage.value
  if (isQuery(text)) { await queryReply(text); return }
  const control = draftControl(text)
  if (control) {
    if (!active) { reply('当前没有待确认草稿。记账可以直接告诉本喵开销。'); return }
    if (control === 'cancel') {
      conversationStore.updateGroup(active.id, { ...active.group, status: 'cancelled', pending: null })
      reply('这组已取消，没有写入账单。'); return
    }
    const count = text.match(/(\d+)笔/)
    if (active.group.status !== 'ready') { reply('还有信息需要补充，暂时不能保存。'); return }
    if (count && Number(count[1]) !== active.group.items.length) { reply('当前是' + active.group.items.length + '笔，请核对数量再确认。'); return }
    await saveDraft(active.id); return
  }
  const controller = new AbortController()
  aiController = controller; aiRunning.value = true; aiElapsed.value = 0
  const started = Date.now()
  aiTimer = window.setInterval(() => {
    if (isCurrentView() && aiController === controller) aiElapsed.value = Math.floor((Date.now() - started) / 1000)
  }, 1000)
  try {
    const result = await aiDraft.parse(text, { date: dayjs().format('YYYY-MM-DD'), group: active?.group, signal: controller.signal })
    if (!isCurrentView() || controller.signal.aborted) return
    if (active) { conversationStore.updateGroup(active.id, result.group); actionErrors.value[active.id] = '' }
    else conversationStore.addMessage({ role: 'assistant', kind: 'draft-group', group: result.group })
    reply(result.reply)
  } catch (error) { if (!controller.signal.aborted && isCurrentView()) reply(error.message + '。原草稿保留，尚未入账。') }
  finally { if (aiController === controller) { aiController = null; clearAiWait() } }
}
function legacySaved(message) { return message.confirmed || recordStore.batchRecords('legacy-' + message.id).length > 0 }
function legacyRecord(message) { return recordStore.batchRecords('legacy-' + message.id)[0] || recordStore.recordsByIds?.([message.record?.id])[0] || message.record }
function savedRecords(group) {
  return recordStore.recordsByIds && Array.isArray(group.recordIds)
    ? linkGroupRecords(group, recordStore.recordsByIds(group.recordIds)) : recordStore.batchRecords(group.id)
}
function handleUpdateRecord(messageId, updatedRecord) {
  if (!isCurrentView()) return
  const message = conversationStore.messages.find(m => m.id === messageId)
  if (retryingPersistence.value) return
  if (!message || legacySaved(message)) { reply('这笔已入账，请直接到明细修改。'); return }
  conversationStore.updateRecord(messageId, updatedRecord)
  reply('已经帮你改好啦，再核对一下就可以记账了。')
}
async function handleConfirmRecord(messageId, record) {
  const message = conversationStore.messages.find(m => m.id === messageId)
  if (!isCurrentView() || !message || retryingPersistence.value || savingGroup.value || legacySaved(message)) return
  savingGroup.value = messageId
  try {
    const saved = await recordStore.addRecord(record, { batchId: 'legacy-' + messageId, source: 'chat' })
    if (!isCurrentView()) return
    conversationStore.updateRecord(messageId, saved)
    conversationStore.markRecordConfirmed(messageId)
    reply('本喵已记下一笔，明细和查询使用同一份最新账单。')
  } catch (e) { reply(e.message) }
  finally { if (isCurrentView()) savingGroup.value = null }
  scrollToBottom()
}

function handleVoice() {
  if (!isCurrentView()) return
  conversationStore.setMascotMood('confused')
  resetMoodLater()
}

// 6. 监听
watch(
  () => [conversationStore.messages.length, conversationStore.isThinking],
  scrollToBottom,
  { flush: 'post' },
)

// 7. 生命周期
onMounted(scrollToBottom)

onBeforeUnmount(() => {
  if (sending && isCurrentView()) { conversationStore.setThinking(false); conversationStore.setMascotMood('happy') }
  sending = false; sendGeneration++
  disposed = true
  aiController?.abort(); aiController = null; clearAiWait()
  if (moodTimer) {
    window.clearTimeout(moodTimer)
  }
})
</script>

<template>
  <div v-if="ownerCurrent" class="miao-chat notebook-evolution">
    <header class="miao-header">
      <div class="miao-header-content">
        <div class="miao-brand">
          <NotebookBack />
          <img :src="miaoAvatar" alt="手绘猫猫" class="miao-header-cat" />
          <div class="min-w-0">
            <h1 class="miao-chat-heading">
              <span class="miao-title">和{{ catDisplayName }}聊聊</span>
              <span class="miao-subtitle">今天的开销 · 本喵在听</span>
            </h1>
          </div>
          <JournalSticker kind="flower" tone="lilac" class="chat-header-flower" />
        </div>
      </div>
      <div class="miao-summary">
        <p class="chat-month-note"><CatNavIcon kind="receipt" />本月支出 <span>{{ monthExpenseText }}</span></p>
        <span class="miao-demo-label">{{ SERVER_MODE ? 'GLM草稿整理 · 确认后才入账' : '规则演示 · 每组最多5笔' }}</span>
        <ManualEntry class="miao-manual-link" />
      </div>
      <div class="chat-query-tools" aria-label="安全查询快捷入口"><span>想先看看？</span><button type="button" class="chat-query-chip" :disabled="conversationStore.isThinking || Boolean(savingGroup) || retryingPersistence" @click="handleSend('本月总支出')">本月支出</button><button type="button" class="chat-query-chip income" :disabled="conversationStore.isThinking || Boolean(savingGroup) || retryingPersistence" @click="handleSend('本月总收入')">本月收入</button><button type="button" class="chat-query-chip review" :disabled="conversationStore.isThinking || Boolean(savingGroup) || retryingPersistence" @click="handleSend('本月复盘')">本月复盘</button></div>
    </header>

    <main ref="messagesContainer" class="miao-messages">
      <div class="miao-thread" aria-live="polite">
        <section v-if="conversationStore.messages.every(message => message.id === 'welcome-message')" class="chat-welcome" aria-label="聊天记账引导">
          <div class="chat-welcome-art"><img :src="miaoThinking" alt="猫猫陪你慢慢记账" /><JournalSticker kind="flower" tone="lilac" /><JournalSticker tone="pink" /></div>
          <p class="chat-welcome-label">本喵的聊天小客厅</p><h2>小开销，也值得好好记下</h2><p>说说今天买了什么，<br />整理好、核对过，再放进小账本。</p>
          <div class="chat-welcome-steps"><span><b>1</b> 说开销</span><span><b>2</b> 核对草稿</span><span><b>3</b> 确认记下</span></div>
        </section>
        <p v-else class="chat-thread-marker"><JournalSticker tone="sage" /> 每一笔小日子 · 确认后才记下 <JournalSticker kind="flower" tone="lilac" /></p>
        <p v-if="recordStore.storageError" class="miao-storage-error" role="alert">{{ recordStore.storageError }}</p>
        <p v-if="SERVER_MODE" class="miao-history-note">整理时，你发送的文字和当前候选草稿会交给智谱处理；每组最多5笔，核对后再确认。</p>
        <div v-if="conversationStore.persistenceError" class="miao-storage-error" role="alert">
          <p>{{ conversationStore.persistenceError }}</p>
          <div class="miao-storage-actions">
            <button type="button" class="miao-history-button" @click="backupConversation">下载对话备份</button>
            <button type="button" class="miao-history-button" :disabled="retryingPersistence || conversationStore.isThinking || Boolean(savingGroup)" @click="retryConversation">{{ conversationStore.storageConflict ? '重新读取最新对话' : conversationStore.restorationBlocked ? '重新读取旧对话' : '重试对话保存' }}</button>
          </div>
          <p class="miao-backup-note">备份含本页消息及浏览器中的对话原文，仅下载到你的设备。</p>
          <p v-if="backupNote" role="status">{{ backupNote }}</p>
        </div>
        <div v-if="hiddenCount" class="miao-history-controls">
          <button type="button" class="miao-history-button" :disabled="loadingHistory || conversationStore.isThinking || Boolean(savingGroup) || retryingPersistence" @click="loadEarlier">查看更早对话（还有{{ hiddenCount }}条）</button>
          <p>这里只分批显示，全部历史仍保留。</p>
        </div>
        <div v-for="message in visibleMessages" :key="message.id" :data-message-id="message.id">
          <p v-if="pinnedDraft?.id === message.id" class="miao-history-note">更早的未完成草稿 · 可以继续补充或确认</p>
          <ChatBubble v-if="message.kind === 'text'" :message="message" cat-appearance />
          <DraftGroupCard
            v-if="message.kind === 'draft-group' && message.group"
            :group="message.group"
            :saved-records="savedRecords(message.group)"
            :busy="savingGroup === message.id || conversationStore.isThinking || retryingPersistence"
            :saving="savingGroup === message.id"
            :error="actionErrors[message.id]"
            @confirm="saveDraft(message.id)"
            @cancel="cancelDraft(message.id)"
            @update="editDraft(message.id, $event)"
          />
          <p v-else-if="message.kind === 'record' && legacyRecord(message)?.deletedAt" class="legacy-deleted-note">这笔账单已删除，已从当前汇总移除，不会通过旧聊天重新入账。</p>
          <ConfirmCard
            v-else-if="message.kind === 'record'"
            :confirmed="legacySaved(message)"
            :record="legacyRecord(message)"
            cat-appearance
            @confirm="handleConfirmRecord(message.id, $event)"
            @update="handleUpdateRecord(message.id, $event)"
          />
        </div>

        <div v-if="conversationStore.isThinking" class="message-enter miao-thinking">
          <img :src="miaoThinking" alt="猫猫托腮思考" />
          <div v-if="aiRunning" class="ai-wait-copy"><p>本喵正在整理 · 等待{{ aiElapsed }}秒</p><small>{{ aiElapsed >= 15 ? '模型响应有些慢，尚未入账。可以停止等待，原草稿会保留。' : '整理好后会显示待确认草稿，先不用重复发送。' }}</small><button type="button" class="ai-stop" @click="stopAiWait">停止本次整理</button></div>
          <p v-else>本喵正在整理…</p>
        </div>
      </div>
    </main>

    <ChatInput :disabled="conversationStore.isThinking || Boolean(savingGroup) || retryingPersistence" cat-appearance @send="handleSend" @voice="handleVoice" />
  </div>
  <main v-else class="miao-chat notebook-evolution"><header class="miao-header"><div class="miao-brand miao-header-content"><NotebookBack /><div><h1 class="miao-title">聊天记账</h1><p class="miao-subtitle" role="status">登录身份已变化，请重新打开聊天页。</p></div></div></header></main>
</template>

<style scoped>
.miao-storage-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
.miao-backup-note { margin-top:8px; font-size:11px; }

.miao-chat { --miao-paper:var(--zz-home-bg); --miao-white:var(--zz-home-paper); --miao-ink:var(--zz-home-ink); --miao-soft:var(--zz-home-ink-soft); --miao-line:#dbb0a1; --miao-pink:#f7cfdf; --miao-yellow:#fae4bf; display:flex; flex-direction:column; height:100dvh; overflow:hidden; color:var(--miao-ink); font-family:var(--zz-home-font); }
.miao-header { flex-shrink:0; background:linear-gradient(115deg,#fce3ea,#fff3e5 65%,#e5eeda); border-bottom:1.5px solid #e2beb0; box-shadow:0 5px 15px #ab7b6810; }
.miao-header-content,.miao-summary,.miao-thread,.chat-query-tools { width:100%; max-width:520px; margin-inline:auto; }
.miao-header-content { padding:13px 16px 7px; }.miao-brand { display:flex; align-items:center; gap:10px; position:relative; }.miao-header-cat { width:66px; height:69px; object-fit:contain; flex-shrink:0; filter:drop-shadow(0 4px 2px #b88b7520); transform:rotate(-5deg); }.miao-chat-heading { font-weight:500; }.miao-title { display:block; position:relative; width:fit-content; font-size:23px; letter-spacing:.5px; white-space:nowrap; }.miao-title::before { content:''; position:absolute; bottom:0; left:-3px; right:-3px; height:10px; background:#e5d4ec88; z-index:-1; border-radius:8px; }.miao-subtitle { display:block; margin-top:5px; font-size:11px; color:#996675; }.chat-header-flower { width:31px; height:31px; margin-left:auto; align-self:flex-start; }
.miao-summary { display:flex; flex-wrap:wrap; align-items:center; gap:9px; padding:4px 16px 8px; font-size:11px; }.chat-month-note { display:flex; align-items:center; gap:5px; padding:6px 10px; border:1px solid #e2afb9; border-radius:13px; background:#f9dbe3; color:#914b63; }.chat-month-note .cat-nav-icon { width:25px; height:25px; }.chat-month-note span { font-size:15px; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }.miao-demo-label { color:#856553; font-size:10px; }.miao-manual-link { margin-left:auto; }.miao-chat :deep(.miao-manual-link) { min-height:44px; padding:5px 9px; font-size:11px; }
.chat-query-tools { display:flex; align-items:center; gap:7px; padding:2px 16px 12px; color:#8b665a; font-size:10px; }.chat-query-tools > span { display:none; }.chat-query-chip { flex:1; min-width:0; min-height:44px; padding:6px 7px; border:1.5px solid #dbaabb; border-radius:14px 14px 17px 12px; background:#f9d6e2; box-shadow:0 3px 0 #e8b7c8; color:#865167; font-size:11px; }.chat-query-chip.income { background:#e0ecd7; border-color:#bdcfaf; box-shadow:0 3px 0 #cddaC1; color:#536f4e; }.chat-query-chip.review { background:#eaddf3; border-color:#c7b0d9; box-shadow:0 3px 0 #d4c2e2; color:#785d8c; }.chat-query-chip:disabled { opacity:.5; }.chat-query-chip:active { translate:0 2px; }
.miao-messages { flex:1; min-height:0; overflow-y:auto; overscroll-behavior-y:contain; scrollbar-width:none; }.miao-messages::-webkit-scrollbar { display:none; }.miao-thread { display:flex; flex-direction:column; gap:22px; padding:22px 16px 25px; }.chat-thread-marker { display:flex; align-items:center; justify-content:center; gap:8px; font-size:10px; color:#9c7d74; }.chat-thread-marker .journal-sticker { width:19px; height:19px; }
.chat-welcome { position:relative; text-align:center; padding:20px 16px 24px; border:1.5px solid #e0b6a6; border-radius:28px 23px 30px 24px; background:radial-gradient(ellipse at 90% 0,#eee0f4,transparent 55%),linear-gradient(135deg,#fff5e8,#ffe6ed); box-shadow:0 5px 0 #edcbbb; }.chat-welcome::before { content:''; position:absolute; top:-9px; left:calc(50% - 32px); width:64px; height:19px; background:#dce8ce; border-radius:4px; transform:rotate(-4deg); }.chat-welcome-art { position:relative; width:140px; height:106px; margin:auto; }.chat-welcome-art img { height:103px; width:105px; object-fit:contain; }.chat-welcome-art .journal-sticker { position:absolute; width:30px; height:30px; right:0; top:2px; }.chat-welcome-art .journal-sticker:last-child { left:-3px; top:57px; }.chat-welcome-label { font-size:10px; letter-spacing:1px; color:#a57083; margin-top:6px; }.chat-welcome h2 { font-size:17px; margin:9px 0; }.chat-welcome > p:last-of-type { font-size:12px; line-height:1.9; color:#8d6b5d; }.chat-welcome-steps { display:flex; justify-content:center; flex-wrap:wrap; gap:8px; font-size:10px; margin-top:17px; color:#8d6b5d; }.chat-welcome-steps b { display:inline-grid; place-items:center; width:20px; height:20px; border-radius:7px; background:#ecd5e8; margin-right:3px; font-weight:500; }.chat-welcome-steps span:nth-child(2) b { background:#dce7cc; }.chat-welcome-steps span:nth-child(3) b { background:#f6d2d9; }
.miao-history-controls { text-align:center; }.miao-history-controls p,.miao-history-note { font-size:11px; color:var(--miao-soft); line-height:1.8; }.miao-history-note { margin-bottom:8px; }.miao-history-button { min-height:44px; padding:8px 12px; border:1.5px solid #c6afd5; border-radius:15px; background:#eee2f3; color:#745a81; font-size:12px; }.miao-storage-error,.legacy-deleted-note { border:1px solid #dab7a3; border-radius:16px; padding:12px; background:#fff6e4; color:#945c50; font-size:12px; line-height:1.8; }
.miao-chat :deep(.miao-bubble) { align-items:flex-end; min-width:0; }.miao-chat :deep(.chat-assistant-avatar) { width:42px; height:42px; padding:3px; border:1.5px solid #dbb9c7; background:#f5dcea; border-radius:16px; box-shadow:0 3px 0 #e9bdca; }.miao-chat :deep(.chat-bubble-body) { position:relative; max-width:calc(100% - 50px); padding:13px 15px 23px; border:1.5px solid #dcb7a5; border-radius:21px 23px 23px 9px; background:#fffaf0; color:var(--miao-ink); font-size:14px; line-height:1.9; box-shadow:0 4px 0 #ebcfb9; }.miao-chat :deep(.miao-bubble-user .chat-bubble-body) { max-width:88%; border-color:#d8a4b5; background:#f9dce8; border-radius:22px 22px 9px 22px; box-shadow:0 4px 0 #e9bacb; }.miao-chat :deep(.chat-bubble-tail) { display:none; }.miao-chat :deep(.bubble-paw) { position:absolute; bottom:8px; right:10px; width:18px; height:13px; opacity:.32; transform:rotate(-13deg); pointer-events:none; }.miao-chat :deep(.paw-pad),.miao-chat :deep(.paw-toe) { position:absolute; background:#a06b7e; }.miao-chat :deep(.paw-pad) { bottom:0; left:5px; width:9px; height:6px; border-radius:50%; }.miao-chat :deep(.paw-toe) { width:3px; height:4px; border-radius:50%; }.miao-chat :deep(.toe-one) { left:1px; top:5px; }.miao-chat :deep(.toe-two) { left:5px; top:1px; }.miao-chat :deep(.toe-three) { left:10px; top:1px; }.miao-chat :deep(.toe-four) { left:15px; top:5px; }
.miao-chat :deep(.miao-record) { position:relative; margin-top:9px; padding:25px 15px 16px; border:1.5px solid #d7aac0; border-radius:24px 21px 26px 20px; background:linear-gradient(135deg,#fffaf0,#fff5f9); color:var(--miao-ink); box-shadow:0 5px 0 #e7bbcc; }.miao-chat :deep(.miao-record::before) { content:''; position:absolute; width:68px; height:18px; top:-9px; left:calc(50% - 34px); background:#dce6cd; border-radius:3px; transform:rotate(-4deg); }.miao-chat :deep(.record-heading) { font-size:16px; }.miao-chat :deep(.record-pending) { font-size:11px; padding:4px 7px; background:#eeddf1; border-radius:8px; white-space:nowrap; }.miao-chat :deep(.draft-items li) { border-bottom:1px solid #ebd6ca; }.miao-chat :deep(.draft-item-copy .category-icon) { width:39px; height:39px; }.miao-chat :deep(.draft-totals) { background:#fbe2e9; border-radius:13px; padding:9px 11px; color:#8e5465; }.miao-chat :deep(.miao-record button) { min-height:40px; border:1.5px solid #d7b9a5; border-radius:13px; background:#fffcf4; color:var(--miao-ink); }.miao-chat :deep(.miao-record button.bg-primary-400) { background:#f4c5d7; border-color:#cd9bb0; box-shadow:0 3px 0 #dfacc0; }.miao-chat :deep(.draft-items p) { color:#8b6b5d; }.miao-chat :deep(.draft-item-top strong) { font-size:16px; }
.miao-thinking { display:flex; gap:8px; align-items:flex-end; font-size:13px; color:#8d6780; }.miao-thinking img { width:62px; height:68px; object-fit:contain; }.miao-thinking p { padding:12px; background:#eaddf1; border:1px solid #cbb6d8; border-radius:18px; }
.ai-wait-copy { min-width:0; max-width:calc(100% - 70px); }.ai-wait-copy small { display:block; margin-top:6px; font-size:11px; line-height:1.7; overflow-wrap:anywhere; }.ai-stop { min-height:40px; padding:7px 12px; margin-top:7px; border:1px solid #cbb6d8; border-radius:12px; background:#f4eaf7; color:#795467; }
.miao-chat :deep(.miao-input) { flex-shrink:0; padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px)); border-top:1.5px solid #e3c1af; background:linear-gradient(110deg,#fff0e4,#fce5ed); }.miao-chat :deep(.chat-compose) { max-width:488px; padding:5px 5px 5px 13px; border:1.5px solid #d0a4b1; border-radius:22px; background:#fffcf7; box-shadow:0 4px 0 #e8bac7; }.miao-chat :deep(.chat-compose:focus-within) { outline:2px solid #a26b8a; outline-offset:3px; }.miao-chat :deep(.miao-input input) { padding-block:9px; font-size:16px; color:var(--miao-ink); }.miao-chat :deep(.miao-input input:focus-visible) { outline:none; }.miao-chat :deep(.miao-input input::placeholder) { color:#9f867c; }.miao-chat :deep(.chat-send) { width:auto; min-width:61px; height:44px; padding-inline:12px; border:1.5px solid #c898ad; border-radius:16px; background:#f3c4d5; color:#7c4a60; box-shadow:0 3px 0 #dfacc0; font-size:13px; }.miao-chat :deep(.chat-send:disabled) { opacity:.55; }.miao-chat :deep(.chat-input-hint) { margin:9px auto 0; text-align:center; font-size:10px; color:#9e7c79; }
.miao-chat :deep(button:focus-visible) { outline:2px solid #9b4c61; outline-offset:3px; }
@media(max-width:359px) { .miao-header-content { padding-inline:12px; }.miao-brand { gap:7px; }.miao-header-cat { width:49px; height:57px; }.miao-title { font-size:21px; }.chat-header-flower { width:23px; height:23px; }.miao-summary { gap:6px; padding-inline:12px; }.miao-demo-label { font-size:9px; }.miao-manual-link { margin-left:0; }.miao-thread { padding-inline:12px; }.chat-query-tools { padding-inline:12px; } }
@media(max-height:600px) { .miao-header-cat { width:42px; height:44px; }.miao-header-content { padding-block:6px; }.miao-summary { padding-block:3px; }.chat-query-tools { padding-bottom:7px; }.chat-welcome-art { height:65px; }.chat-welcome-art img { height:65px; }.chat-welcome { padding-block:12px; } }
</style>
