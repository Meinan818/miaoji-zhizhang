<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'
import { isValidMonth } from '@/utils/statistics'
import { validDate } from '@/utils/ledger'

const props = defineProps({ month: { type: String, required: true }, date: { type: String, default: '' }, disabled: Boolean, label: { type: String, default: '选择日期' } })
const emit = defineEmits(['select'])
const minimum = computed(() => isValidMonth(props.month) ? props.month + '-01' : '')
const maximum = computed(() => minimum.value ? dayjs(minimum.value).endOf('month').format('YYYY-MM-DD') : '')
function select(event) {
  const input = event.target, date = input.value, valid = input.validity.valid
  input.value = props.date
  if (!props.disabled && valid && validDate(date) && date.startsWith(props.month + '-') && date !== props.date) emit('select', date)
}
</script>

<template>
  <label class="date-picker"><span>只看一天</span><input type="date" :value="date" :aria-label="label" :disabled="disabled" :min="minimum" :max="maximum" required @change="select" /></label>
</template>

<style scoped>
.date-picker { display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-size:12px; color:#815b46; }
.date-picker input { box-sizing:border-box; width:156px; min-width:0; min-height:44px; padding:7px; border:1px solid var(--zz-home-line); border-radius:12px; background:var(--zz-home-title-brush); color:var(--zz-home-ink); font:inherit; }
.date-picker input:focus-visible { outline:2px solid var(--zz-home-ink); outline-offset:3px; }
.date-picker input:disabled { opacity:.4; cursor:default; }
</style>
