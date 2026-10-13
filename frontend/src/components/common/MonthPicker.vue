<script setup>
const props = defineProps({ month: { type: String, required: true }, disabled: Boolean, label: { type: String, default: '选择月份' } })
const emit = defineEmits(['select'])
function select(event) {
  const input = event.target, month = input.value, valid = input.validity.valid
  // 父页确认导航前仍保留原月份；失败/无效输入不会留下假选择。
  input.value = props.month
  if (!props.disabled && valid && month) emit('select', month)
}
</script>

<template>
  <label class="month-picker"><span>跳到</span><input type="month" :value="month" :aria-label="label" :disabled="disabled" min="1000-01" max="9999-12" required @change="select" /></label>
</template>

<style scoped>
.month-picker { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
.month-picker input { box-sizing: border-box; width: 130px; min-width: 0; min-height: 44px; padding: 7px; border: 1px solid var(--zz-home-line); border-radius: 12px; background: var(--zz-home-title-brush); color: var(--zz-home-ink); font: inherit; }
.month-picker input:focus-visible { outline: 2px solid var(--zz-home-ink); outline-offset: 3px; }
.month-picker input:disabled { opacity: .4; cursor: not-allowed; }
</style>
