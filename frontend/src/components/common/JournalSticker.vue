<script setup>
defineProps({ kind: { type: String, default: 'paw' }, tone: { type: String, default: 'pink' } })
</script>
<template>
  <span class="journal-sticker" :class="'journal-sticker-' + tone" aria-hidden="true">
    <svg v-if="kind === 'paw'" viewBox="0 0 48 48" fill="none"><ellipse cx="24" cy="31" rx="10" ry="8" fill="currentColor" /><ellipse cx="11" cy="21" rx="4.2" ry="5.5" transform="rotate(-25 11 21)" fill="currentColor" /><ellipse cx="21" cy="14" rx="4" ry="5.5" transform="rotate(-10 21 14)" fill="currentColor" /><ellipse cx="31" cy="15" rx="4" ry="5.5" transform="rotate(14 31 15)" fill="currentColor" /><ellipse cx="39" cy="24" rx="3.8" ry="5" transform="rotate(27 39 24)" fill="currentColor" /></svg>
    <svg v-else-if="kind === 'flower'" viewBox="0 0 48 48" fill="none"><path d="M24 9C31 0 37 9 33 16C44 12 48 23 38 28C46 35 36 43 30 36C28 47 17 46 17 36C8 42 1 32 10 26C-1 20 7 9 16 15C13 5 23 2 24 9Z" fill="currentColor" opacity=".72" /><circle cx="24" cy="24" r="5.5" fill="#fff8e8" stroke="#876b52" stroke-width="1.3" /></svg>
    <svg v-else viewBox="0 0 48 48" fill="none"><path d="M23 6L27 18L40 23L27 27L23 40L18 27L6 23L18 18Z" fill="currentColor" stroke="#957b5f" stroke-width="1.2" stroke-linejoin="round" /><path d="M37 4V12M33 8H41M6 36V42M3 39H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
  </span>
</template>
<style scoped>
.journal-sticker { display: inline-block; width: 42px; height: 42px; flex-shrink: 0; transform: rotate(-13deg); pointer-events: none; }
.journal-sticker svg { width: 100%; height: 100%; }
.journal-sticker-pink { color: #dba79e; }.journal-sticker-sage { color: #a4b99d; }.journal-sticker-honey { color: #dfc580; }.journal-sticker-lilac { color: #b6a1c3; }
</style>
