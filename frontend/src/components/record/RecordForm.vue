<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { CATEGORY_OPTIONS } from '@/utils/categories'
import { validateRecord } from '@/utils/ledger'
import CategoryIcon from '@/components/common/CategoryIcon.vue'
import { SERVER_MODE } from '@/api/mode'
const props = defineProps({ record: { type: Object, default: () => ({}) }, saving: Boolean, blocked: Boolean, error: { type: String, default: '' }, submitLabel: { type: String, default: '保存账单' }, progressLabel: String })
const emit = defineEmits(['save', 'cancel'])
const unknownTime = SERVER_MODE && Boolean(props.record.id) && !props.record.time
const form = ref({ type: props.record.type || 'expense', amount: props.record.amount != null ? String(props.record.amount) : '',
  category: props.record.category || '餐饮', date: props.record.date || dayjs().format('YYYY-MM-DD'),
  time: props.record.time || (unknownTime ? '' : dayjs().format('HH:mm')), remark: props.record.remark || '' })
const localError = ref('')
const errorElement = ref(null)
let active = true
onBeforeUnmount(() => { active = false })
async function revealNote(event) {
  const field = event.currentTarget
  await nextTick()
  if (!active || props.saving || props.blocked || field?.ownerDocument?.activeElement !== field || !field?.isConnected) return
  const actions = field.closest('form')?.querySelector('.form-actions')
  if (!actions) return
  const inputBox = field.getBoundingClientRect(), actionBox = actions.getBoundingClientRect()
  if (inputBox.bottom > actionBox.top && inputBox.top < actionBox.bottom) field.scrollIntoView({ block: 'center', behavior: 'instant' })
}
watch(() => localError.value || props.error, async (message, previous, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  if (!message) return
  await nextTick()
  if (current && message === (localError.value || props.error) && errorElement.value?.getClientRects?.().length) {
    errorElement.value.scrollIntoView({ block: 'nearest' })
  }
}, { flush: 'post' })
const initialForm = ref(JSON.stringify(form.value))
const pristine = computed(() => JSON.stringify(form.value) === initialForm.value)
function restorePristine(record) {
  if (!pristine.value) return false
  form.value = { type: record.type || 'expense', amount: record.amount != null ? String(record.amount) : '',
    category: record.category || '餐饮', date: record.date || dayjs().format('YYYY-MM-DD'),
    time: record.time || '', remark: record.remark || '' }
  initialForm.value = JSON.stringify(form.value); localError.value = ''
  return true
}
defineExpose({ restorePristine, pristine })
const categories = computed(() => CATEGORY_OPTIONS[form.value.type])
function changeType(type) { form.value.type = type; if (!categories.value.some(c => c.label === form.value.category)) form.value.category = categories.value[0].label }
function save() {
  if (props.saving || props.blocked) return
  try { const omitTime = unknownTime && !form.value.time; const record = validateRecord({ ...form.value, time: omitTime ? '00:00' : form.value.time, description: form.value.remark || form.value.category }); if (omitTime) delete record.time; localError.value = ''; emit('save', record) }
  catch (e) { localError.value = e.message }
}
</script>
<template>
  <form class="record-form" @submit.prevent="save">
    <fieldset :disabled="saving || blocked">
      <legend>收支类型</legend>
      <div class="type-options"><button v-for="type in ['expense', 'income']" :key="type" type="button" :aria-pressed="form.type === type" :class="{ selected: form.type === type }" @click="changeType(type)">{{ type === 'income' ? '收入' : '支出' }}</button></div>
      <div class="field-grid">
        <label>金额<input v-model="form.amount" aria-label="金额" inputmode="decimal" type="text" placeholder="如25.50" autocomplete="off" required /></label>
        <label>日期<input v-model="form.date" aria-label="日期" type="date" required /></label>
        <label>时间<input v-model="form.time" aria-label="时间" type="time" :required="!unknownTime" /><span v-if="unknownTime">原时间未知，可留空</span></label>
      </div>
      <div class="category-picker" role="group" aria-label="选择账单分类">
        <p class="category-picker-heading">给这笔选一张贴纸 <span>已选 · {{ form.category }}</span></p>
        <div class="category-picker-grid">
          <button v-for="category in categories" :key="category.label" type="button" class="category-choice" :class="{ selected: form.category === category.label }" :aria-label="'分类：' + category.label" :aria-pressed="form.category === category.label" @click="form.category = category.label">
            <CategoryIcon :category="category.label" :type="form.type" /><span>{{ category.label }}</span><span v-if="form.category === category.label" class="category-choice-check" aria-hidden="true">✓</span>
          </button>
        </div>
      </div>
      <label>备注<textarea v-model="form.remark" aria-label="备注" rows="3" maxlength="200" placeholder="这笔用在了哪里？" @focus="revealNote" /></label>
    </fieldset>
    <p v-if="localError || error" ref="errorElement" class="form-error" role="alert">{{ localError || error }}</p>
    <div class="form-actions"><button type="button" :disabled="saving" @click="emit('cancel')">取消</button><button class="primary" type="submit" :disabled="saving || blocked">{{ saving ? (progressLabel || '正在保存…') : submitLabel }}</button></div>
  </form>
</template>
<style scoped>
.record-form { color: var(--zz-home-ink, #3c261a); font-size: 15px; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
legend { margin-bottom: 8px; }
.type-options { display: flex; gap: 10px; margin-bottom: 16px; }
button, input, select, textarea { min-height: 44px; border: 1px solid #d9c5a9; border-radius: 12px 10px 13px 11px; background: #fffdf8; color: inherit; font: inherit; padding: 9px 12px; }
input, select, textarea { scroll-margin-block: 16px 96px; }
textarea { min-height: 96px; line-height: 1.7; resize: vertical; overflow-wrap: anywhere; }
button { cursor: pointer; }
button:disabled { opacity: .55; cursor: not-allowed; }
button.selected, button.primary { background: #f6ddd8; }
.type-options button, .form-actions button { flex: 1; }
.field-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; margin: 12px 0; }
.field-grid > label:first-child { grid-column:1 / -1; }
.field-grid > label:first-child input { font-size:24px; font-variant-numeric:tabular-nums; background:#fff6e7; min-height:58px; }
.category-picker { margin:18px 0; }
.category-picker-heading { display:flex; align-items:baseline; justify-content:space-between; gap:8px; font-size:13px; margin-bottom:10px; }
.category-picker-heading span { color:#937663; font-size:11px; }
.category-picker-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px 8px; }
.category-choice { display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative; min-height:86px; padding:6px 2px; gap:4px; border:1.5px solid #e8d0be; border-radius:17px; background:#fffbf2; box-shadow:0 3px 0 #f0decd; font-size:12px; }
.category-choice .category-icon { width:44px; height:44px; }
.category-choice.selected { border-color:#c58f9e; background:#fde8ec; box-shadow:0 3px 0 #ecc0cb; }
.category-choice-check { position:absolute; top:3px; right:4px; display:grid; place-items:center; width:16px; height:16px; border-radius:50%; color:#fff; background:#ba7e91; font-size:10px; }
label { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
input, select { width: 100%; min-width: 0; box-sizing: border-box; }
.form-actions { display: flex; gap: 10px; margin-top: 18px; padding-block:8px; position:sticky; bottom:0; background:linear-gradient(#fffdf800,#fffdf8 20%); z-index:2; }
.form-actions button { border-width:1.5px; box-shadow:0 3px 0 #ead2bc; }
.form-actions button.primary { background:#f7ccd7; border-color:#d9a5b6; box-shadow:0 3px 0 #e6acbe; }
.form-error { color: #aa594d; margin-top: 12px; overflow-wrap: anywhere; scroll-margin-block-end: 96px; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid #8c6c50; outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) { button { transition: background-color 140ms ease, border-color 140ms ease; } }
button:not(:disabled):active { border-color: #ba9782; }
@media(max-width:359px) { .field-grid { grid-template-columns: 1fr; } }
</style>
