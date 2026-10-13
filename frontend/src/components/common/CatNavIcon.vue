<script setup>
import { computed } from 'vue'
const props = defineProps({ kind: { type: String, default: 'profile' } })
const colors = computed(() => ({ receipt: '#f8cad3', calendar: '#f8dcae', chart: '#cde5d4', profile: '#e1d0ee', chat: '#f3bfc9' }[props.kind] || '#f8dcae'))
</script>
<template>
  <svg class="cat-nav-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M9 20 8 7c0-2 2-2 4-1l10 7h5L37 6c2-1 4 0 3 2l-1 13" :fill="colors" stroke="#926553" stroke-width="1.8" stroke-linejoin="round" />
    <path d="m12 11 1 7 5-3m18-4-1 7-5-3" fill="#f3aab8" />
    <rect x="6" y="16" width="36" height="27" rx="12" :fill="colors" stroke="#926553" stroke-width="1.8" />
    <path d="M9 26c2-5 7-7 11-7" stroke="#fffaf1" stroke-width="3" stroke-linecap="round" />
    <g v-if="kind === 'receipt'" stroke="#7d5547" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 22h12v15l-3-2-3 2-3-2-3 2V22Z" fill="#fff8ec" /><path d="M21 26h6m-6 4h4" /></g>
    <g v-else-if="kind === 'calendar'" stroke="#7d5547" stroke-width="1.6" stroke-linecap="round"><rect x="16" y="23" width="16" height="14" rx="3" fill="#fff8ec" /><path d="M16 28h16m-12-7v4m8-4v4" /><circle cx="22" cy="32" r="1" fill="#b77964" /><circle cx="27" cy="32" r="1" fill="#b77964" /></g>
    <g v-else-if="kind === 'chart'"><path d="M16 37h16" stroke="#7d5547" stroke-width="1.6" stroke-linecap="round" /><rect x="17" y="29" width="4" height="6" rx="2" fill="#81ad96" /><rect x="23" y="23" width="4" height="12" rx="2" fill="#e6a5b4" /><rect x="29" y="26" width="4" height="9" rx="2" fill="#b89bc8" /></g>
    <g v-else-if="kind === 'chat'"><path d="M16 25c0-4 4-6 8-6s8 2 8 6-4 7-8 7l-5 4 1-5c-3-1-4-3-4-6Z" fill="#fff8ec" stroke="#7d5547" stroke-width="1.6" /><path d="m24 28-4-4c-1-3 2-4 4-2 2-2 5-1 4 2l-4 4Z" fill="#e99aaf" /></g>
    <g v-else><ellipse cx="18.5" cy="27" rx="2.4" ry="3.4" fill="#6c4b3c" /><ellipse cx="29.5" cy="27" rx="2.4" ry="3.4" fill="#6c4b3c" /><circle cx="18" cy="26" r=".8" fill="white" /><circle cx="29" cy="26" r=".8" fill="white" /><ellipse cx="14" cy="32" rx="3" ry="1.7" fill="#e9a5b3" /><ellipse cx="34" cy="32" rx="3" ry="1.7" fill="#e9a5b3" /><path d="m22 31 2 1 2-1m-6 3q2 3 4 0 2 3 4 0" stroke="#6c4b3c" stroke-width="1.4" stroke-linecap="round" /></g>
  </svg>
</template>
<style scoped>.cat-nav-icon { width:42px; height:42px; display:block; flex-shrink:0; filter:drop-shadow(0 2px 0 #d5b5a166); pointer-events:none; }</style>
