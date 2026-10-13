<script setup>
defineProps({ to: { type: [String, Object], default: '/' }, label: { type: String, default: '返回日历主页' } })
</script>
<template>
  <router-link :to="to" :aria-label="label" class="notebook-back">
    <svg viewBox="0 0 52 56" fill="none" aria-hidden="true">
      <path d="M8 19 7 7Q7 3 11 5L20 12H32L41 5Q45 3 45 7L44 19" fill="#f4c1ce" stroke="#b77d79" stroke-width="1.6" stroke-linejoin="round" />
      <path d="m11 9 1 8 6-3m22-5-1 8-6-3" fill="#fff0da" />
      <rect x="3" y="16" width="46" height="36" rx="14" fill="#e6adab" />
      <rect x="3" y="12" width="46" height="36" rx="14" fill="#fff0da" stroke="#c18b78" stroke-width="1.6" />
      <path d="M8 23Q10 17 18 17" stroke="#fffdf8" stroke-width="3" stroke-linecap="round" />
      <path d="m23 23-7 7 7 7m-6-7h18" stroke="#865b50" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="38" cy="39" r="2" fill="#d6a1ad" /><circle cx="34" cy="36" r="1" fill="#d6a1ad" /><circle cx="38" cy="35" r="1" fill="#d6a1ad" /><circle cx="41" cy="37" r="1" fill="#d6a1ad" />
    </svg>
  </router-link>
</template>
<style scoped>
.notebook-back { display:grid; place-items:center; width:48px; min-width:48px; height:52px; flex-shrink:0; border:0; background:transparent; border-radius:15px; }
.notebook-back svg { width:48px; height:52px; filter:drop-shadow(0 3px 3px #b1776020); }
.notebook-back:focus-visible { outline:2px solid #9b4c61; outline-offset:3px; }
.notebook-back:active { translate:0 3px; }
@media(prefers-reduced-motion:no-preference) { .notebook-back { transition:translate 140ms; } .notebook-back:hover { translate:0 -1px; } }
</style>
