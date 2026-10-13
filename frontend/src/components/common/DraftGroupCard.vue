<script setup>
import { computed, ref } from 'vue'
import { centsText, legacyCents } from '@/utils/money'
import RecordEditor from '@/components/record/RecordEditor.vue'
import CategoryIcon from '@/components/common/CategoryIcon.vue'
const props = defineProps({ group: { type: Object, required: true }, savedRecords: { type: Array, default: () => [] }, busy: Boolean, saving: Boolean, error: String })
const emit = defineEmits(['confirm', 'cancel', 'update'])
const editing = ref(null)
const saved = computed(() => props.group.items.length > 0 && props.savedRecords.length === props.group.items.length && props.group.items.every(i => props.savedRecords.some(r => r.draftItemId === i.id)))
const status = computed(() => saved.value ? 'saved' : props.group.status)
const items = computed(() => props.group.items.map(i => {
  const r = props.savedRecords.find(r => r.draftItemId === i.id)
  return r ? { ...i, ...r, id: i.id, deleted: Boolean(r.deletedAt), amountCents: r.deletedAt ? null : legacyCents(r.amount), description: r.remark || r.description || r.category } : i
}))
const deletedCount = computed(() => items.value.filter(i => i.deleted).length)
const statusLabel = computed(() => status.value === 'saved' && deletedCount.value
  ? (deletedCount.value === items.value.length ? '全部已删除' : '已记录 · 删除' + deletedCount.value + '笔')
  : ({ needs_input: '待补充', ready: '待确认', saved: '已记账', cancelled: '已取消' })[status.value] || '保存中')
const totals = computed(() => ({ expense: items.value.filter(i => !i.deleted && i.type === 'expense').reduce((n, i) => n + (i.amountCents || 0), 0), income: items.value.filter(i => !i.deleted && i.type === 'income').reduce((n, i) => n + (i.amountCents || 0), 0) }))
const editRecord = computed(() => { const i = props.group.items.find(i => i.id === editing.value); return i ? { ...i, amount: i.amountCents == null ? '' : centsText(i.amountCents) } : null })
function update(record) {
  if (props.busy || props.saving || !editRecord.value || ['saved', 'cancelled'].includes(status.value)) return
  emit('update', { itemId: editing.value, record }); editing.value = null
}
</script>
<template>
  <article class="miao-record draft-group-card" :data-group-id="group.id" :data-state="status">
    <div class="draft-heading"><h2 class="record-heading">{{ items.length ? '这组小账单 · ' + items.length + '笔' : '本喵还需要一点信息' }}</h2><span class="record-pending">{{ statusLabel }}</span></div>
    <p v-if="group.pending?.kind === 'ai'" class="draft-totals">{{ group.pending.question }}</p>
    <ol class="draft-items">
      <li v-for="(item, index) in items" :key="item.id" :data-item-id="item.id" :class="{ 'deleted-item': item.deleted }">
        <div class="draft-item-top"><span class="draft-item-copy"><CategoryIcon v-if="['income','expense'].includes(item.type)" :category="item.category" :type="item.type" /><span>{{ index + 1 }}. {{ item.description }}</span></span><strong :class="item.type">{{ item.deleted ? '已删除' : item.amountCents == null ? '待补金额' : '¥' + centsText(item.amountCents) }}</strong></div>
        <p v-if="!item.deleted">{{ item.type === 'income' ? '收入' : item.type === 'expense' ? '支出' : '待定收支' }} · {{ item.category }} · {{ item.date || '待补日期' }} {{ item.time || (group.origin === 'ai' ? '未指定时间' : '待补时间') }}</p>
        <p v-else>已从当前账本移除，不计入合计。</p>
        <button v-if="!['saved', 'cancelled'].includes(status)" type="button" :disabled="busy || saving" :aria-label="'编辑第' + (index + 1) + '笔草稿'" @click="editing = item.id">编辑这笔</button>
      </li>
    </ol>
    <div class="draft-totals"><p v-if="deletedCount">当前有效账单 {{ items.length - deletedCount }}笔；已删除 {{ deletedCount }}笔，不计入下方合计。</p><p v-if="totals.expense">支出{{ status === 'needs_input' ? '已知金额' : '合计' }} ¥{{ centsText(totals.expense) }}</p><p v-if="totals.income">收入{{ status === 'needs_input' ? '已知金额' : '合计' }} ¥{{ centsText(totals.income) }}</p><p v-if="status === 'needs_input'">仍有待补充或待选择的信息，补齐后才能保存。</p></div>
    <p v-if="error" role="alert" class="draft-error">{{ error }}</p>
    <div v-if="!['saved', 'cancelled'].includes(status)" class="draft-actions"><button type="button" :disabled="busy || saving" @click="emit('cancel')">取消这组</button><button type="button" class="draft-confirm bg-primary-400" :disabled="busy || saving || status !== 'ready'" @click="emit('confirm')">{{ saving ? '正在保存…' : busy ? '处理中…' : '确认记下' + items.length + '笔' }}</button></div>
    <p v-else-if="status === 'saved'" class="saved-note">此卡片读取最新账单（含删除状态）；<router-link :to="{ path: '/bills', query: { month: (items.find(i => !i.deleted) || items[0])?.date?.slice(0, 7) } }">到明细修改</router-link>。历史聊天回复只是当时的记录。</p>
    <RecordEditor v-if="editRecord && !['saved', 'cancelled'].includes(status)" :key="editing" :record="editRecord" :saving="busy || saving" draft @save="update" @close="editing = null" />
  </article>
</template>
<style scoped>
.draft-heading, .draft-item-top { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.draft-heading h2 { font-weight: 400; }
.draft-items { margin-top: 12px; }
.draft-items li { padding: 12px 0; border-bottom: 1px dashed #d9c5a9; }
.draft-item-top > span { min-width: 0; overflow-wrap: anywhere; }
.draft-item-copy { display:flex; align-items:center; gap:7px; }
.draft-item-copy > span { min-width:0; white-space:pre-wrap; }
.draft-item-copy .category-icon { width:34px; height:34px; }
.deleted-item .category-icon { opacity:.45; }
strong { font-weight: 400; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.draft-items p { font-size: 12px; color: #aa8a70; margin-top: 5px; }
.draft-items button { margin-top: 6px; padding: 6px 10px; font-size: 12px; min-height: 36px; }
.deleted-item { color: #9c8877; }.deleted-item strong { color: #9c8877; }
.expense { color: #ba7662; }.income { color: #7f9367; }
.draft-totals { font-size: 13px; line-height: 1.9; margin-top: 10px; }
.draft-actions { display: flex; gap: 10px; margin-top: 14px; }.draft-actions button { flex: 1; padding: 10px 6px; }
button:disabled { opacity: .5; cursor: not-allowed; }
.draft-error { margin-top: 10px; color: #aa594d; }
.saved-note { font-size: 12px; line-height: 1.8; margin-top: 12px; }.saved-note a { text-decoration: underline; }
</style>
