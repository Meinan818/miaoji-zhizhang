<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import RecordForm from './RecordForm.vue'
import { formatCurrency } from '@/utils/format'
const props = defineProps({ record: { type: Object, required: true }, saving: Boolean, progressLabel: String, error: String, allowDelete: Boolean, allowRepeat: Boolean, conflict: Object, draft: Boolean })
const emit = defineEmits(['save', 'close', 'delete', 'recover', 'repeat'])
const recordForm = ref(null)
function repeat() {
  if (!props.allowRepeat || props.draft || props.saving || props.conflict || confirmingDelete.value || !recordForm.value?.pristine) return false
  emit('repeat')
  return true
}
const dialog = ref(null)
const confirmingDelete = ref(false)
const deleteTrigger = ref(null)
const cancelDeleteButton = ref(null)
async function startDelete() { if (!props.saving) { confirmingDelete.value = true; await nextTick(); cancelDeleteButton.value?.focus() } }
async function cancelDelete() { confirmingDelete.value = false; await nextTick(); deleteTrigger.value?.focus() }
let previousOverflow
onMounted(() => { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.value.showModal() })
onBeforeUnmount(() => { dialog.value?.close(); document.body.style.overflow = previousOverflow })
function close() { if (props.saving) return; if (confirmingDelete.value) cancelDelete(); else emit('close') }
</script>
<template>
  <dialog ref="dialog" class="bill-editor" aria-labelledby="bill-editor-title" @cancel.prevent="close">
    <div class="editor-handle" aria-hidden="true"></div>
    <div class="editor-heading"><h2 id="bill-editor-title">{{ confirmingDelete ? '删除这笔账单？' : draft ? '编辑这笔草稿' : '编辑这笔账单' }}</h2><button type="button" :aria-label="confirmingDelete ? '取消删除返回编辑' : '关闭修改窗口'" :disabled="saving" @click="close">×</button></div>
    <p v-if="!confirmingDelete" class="editor-note">{{ draft ? '先更新这笔草稿，确认整组后才会入账。' : '保存后，明细、首页和聊天查询都会使用最新数据。' }}</p>
    <aside v-if="conflict" class="delete-summary" role="alert"><template v-if="conflict.current"><p>这笔账单有新修改，请先对照当前内容：</p><strong>{{ conflict.current.type === 'income' ? '+' : '-' }}{{ formatCurrency(conflict.current.amount) }}</strong><p>{{ conflict.current.category }} · {{ conflict.current.remark || '无备注' }}</p><span>{{ conflict.current.date }} {{ conflict.current.time }}</span><p>你刚才填写的内容已保留，核对后可以继续编辑。</p><button class="conflict-recover" type="button" :disabled="saving" @click="emit('recover'); confirmingDelete = false">保留输入，按最新账单继续编辑</button></template><p v-else>这笔账单已不在当前账本中，不能再保存或删除。你填写的内容仍保留在窗口中，可先查看后关闭。</p></aside>
    <RecordForm ref="recordForm" v-show="!confirmingDelete" :record="record" :saving="saving" :progress-label="progressLabel" :blocked="Boolean(conflict)" :error="error" :submit-label="draft ? '更新草稿' : '保存修改'" @save="emit('save', $event)" @cancel="close" />
    <section v-if="allowRepeat && !draft && !confirmingDelete" class="repeat-entry">
      <button type="button" :disabled="saving || Boolean(conflict) || !recordForm?.pristine" @click="repeat">再记一笔</button>
      <p>{{ recordForm?.pristine ? '用这笔内容填写新账单，日期改为今天，核对后再保存。' : '有未保存修改，请先保存或取消修改，再记新账单。' }}</p>
    </section>
    <button v-if="allowDelete && !confirmingDelete" ref="deleteTrigger" class="delete-entry" type="button" :disabled="saving || Boolean(conflict)" @click="startDelete">删除这笔账单</button>
    <section v-if="confirmingDelete" class="delete-confirmation">
      <p class="delete-summary">{{ record.category }} · {{ record.remark || '无备注' }}<strong>{{ record.type === 'income' ? '+' : '-' }}{{ formatCurrency(record.amount) }}</strong><span>{{ record.date }} {{ record.time }}</span></p>
      <p class="delete-note">删除后，这笔已保存的账单不再计入首页、明细和聊天查询。尚未保存的编辑不会写入；此版本暂不提供恢复入口。</p>
      <p v-if="error" class="delete-error" role="alert">{{ error }}</p>
      <div class="delete-actions"><button ref="cancelDeleteButton" type="button" :disabled="saving" @click="cancelDelete">返回编辑</button><button class="delete-confirm-button" type="button" :disabled="saving || Boolean(conflict)" @click="emit('delete')">{{ saving ? '正在删除…' : '确认删除' }}</button></div>
    </section>
  </dialog>
</template>
<style scoped>
.bill-editor { width: min(480px,calc(100% - 28px)); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 20px; border: 1px solid #d9c5a9; border-radius: 18px 22px 19px 16px; background: var(--zz-home-bg, #fdfaf3); color: var(--zz-home-ink, #3c261a); font-family: inherit; }
.bill-editor { box-shadow: 0 16px 48px rgb(80 60 40 / .15); }
.bill-editor::backdrop { background: rgb(80 60 40 / .28); }
@media (prefers-reduced-motion: no-preference) {
  .bill-editor[open] { animation: editor-unfold 200ms cubic-bezier(.22, 1, .36, 1); }
  .bill-editor[open]::backdrop { animation: editor-backdrop 180ms ease-out; }
  .delete-confirmation { animation: editor-content 150ms ease-out; }
}
@keyframes editor-unfold {
  from { opacity: .92; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes editor-backdrop { from { background: rgb(80 60 40 / 0); } to { background: rgb(80 60 40 / .28); } }
@keyframes editor-content { from { opacity: .8; } to { opacity: 1; } }
.editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 19px; font-weight: 400; }
.editor-heading button { min-width: 44px; min-height: 44px; border: 1px solid #d9c5a9; border-radius: 12px; background: #fffdf8; font-size: 24px; color: inherit; }
.editor-note { font-size: 12px; margin: 10px 0 18px; line-height: 1.7; }
.delete-entry { display: block; width: 100%; min-height: 44px; margin-top: 16px; padding: 8px; border-top: 1px dashed #dfcdbb; color: #a36a60; font-size: 13px; }
.repeat-entry { margin-top: 16px; padding-top: 16px; border-top: 1px dashed #dfcdbb; }
.repeat-entry button { width: 100%; min-height: 44px; padding: 8px; border: 1px solid #d9c5a9; border-radius: 12px; background: #fff5e7; font-size: 14px; }
.repeat-entry p { margin-top: 8px; font-size: 12px; line-height: 1.7; }
.repeat-entry button:focus-visible { outline: 2px solid #785746; outline-offset: 3px; }
.delete-confirmation { margin-top: 18px; }
.delete-summary { padding: 14px; border: 1px solid #e5ccba; border-radius: 14px 11px 15px 12px; background: #fff5e7; overflow-wrap: anywhere; font-size: 14px; line-height: 1.8; }
.delete-summary strong { display: block; color: #aa665b; font-size: 22px; font-weight: 400; font-variant-numeric: tabular-nums; }
.delete-summary span { display: block; color: #9d806c; font-size: 12px; }
.conflict-recover { min-height: 44px; margin-top: 10px; padding: 8px 12px; border: 1px solid #dcc2a9; border-radius: 12px; background: #fffdf8; font-size: 13px; }.conflict-recover:focus-visible { outline: 2px solid #785746; outline-offset: 3px; }
.delete-note { margin: 16px 0; line-height: 1.9; font-size: 13px; }
.delete-error { margin-bottom: 14px; color: #aa594d; font-size: 13px; line-height: 1.8; }
.delete-actions { display: flex; gap: 10px; }
.delete-actions button { flex: 1; min-height: 44px; padding: 10px 8px; border: 1px solid #dcc2a9; border-radius: 12px; background: #fffdf8; font-size: 14px; }
.delete-actions .delete-confirm-button { background: #f4dbd4; color: #874f47; border-color: #dfb4aa; }
button:disabled { opacity: .5; cursor: not-allowed; }
.editor-heading button:focus-visible, .delete-entry:focus-visible, .delete-actions button:focus-visible { outline: 2px solid #785746; outline-offset: 3px; }
.editor-handle { display: none; }
@media (max-width: 639px) {
  .bill-editor { position: fixed; inset: auto 0 0; margin: 0 auto; width: 100%; max-width: 480px; max-height: calc(100dvh - 16px); padding: 12px 18px calc(20px + env(safe-area-inset-bottom, 0px)); border-radius: 24px 24px 0 0; box-shadow: 0 -6px 24px rgb(80 60 40 / .1); }
  .editor-handle { display: block; width: 36px; height: 4px; margin: 0 auto 14px; border-radius: 8px; background: #dbc5b8; }
}
</style>
