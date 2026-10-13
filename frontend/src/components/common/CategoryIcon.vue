<script setup>
import { computed } from 'vue'
import { getCategoryArtwork } from '@/utils/categoryArtwork'

const props = defineProps({ category: { type: String, default: '其他' }, type: { type: String, default: 'expense' } })
const art = computed(() => getCategoryArtwork(props.category, props.type))
</script>

<template>
  <svg class="category-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true" :data-icon-kind="art.kind" :data-category="category">
    <path d="M12 17 11 7q0-3 3-1l10 7q8-3 16 0l10-7q3-2 3 1l-1 11c6 5 8 11 7 20-1 14-12 21-27 21S6 52 5 38c-1-9 1-16 7-21Z" :fill="art.paper" stroke="#ae8270" stroke-width="1.6" stroke-linejoin="round" />
    <path d="m15 10 1 8 6-3m27-5-1 8-6-3" fill="#efaabb" />
    <path d="M9 30q2-8 10-10" stroke="#fffdf6" stroke-width="3" stroke-linecap="round" />
    <g stroke="#805b4c" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <g v-if="art.kind === 'food'">
        <path d="M15 34h34l-4 13q-13 6-26 0Z" :fill="art.accent" /><path d="M17 35q15 4 30 0" stroke="#fff7e4" stroke-width="2.2" />
        <path d="M23 26q8-8 16 0-8 8-16 0Z" :fill="art.soft" /><path d="m39 26 5-4v8Z" :fill="art.soft" /><circle cx="28" cy="25" r="1" fill="#805b4c" stroke="none" /><path d="M22 18q-3 3 0 6m10-7q-3 3 0 6" />
      </g>
      <g v-else-if="art.kind === 'travel'">
        <path d="m18 29 4-9h20l4 9 4 3v13H14V32Z" :fill="art.accent" /><path d="m23 23-3 8h24l-3-8Z" :fill="art.soft" /><path d="M32 23v8" />
        <circle cx="22" cy="45" r="4" fill="#805b4c" /><circle cx="43" cy="45" r="4" fill="#805b4c" /><path d="M19 36h4m18 0h4" stroke="#fff9d8" stroke-width="3" /><path d="m29 38 3 2 3-2" />
      </g>
      <g v-else-if="art.kind === 'shopping'">
        <path d="M20 27h25l3 24H17Z" :fill="art.accent" /><path d="M25 29v-8q7-9 14 0v8" />
        <ellipse cx="32" cy="41" rx="5" ry="4" :fill="art.soft" stroke="none" /><ellipse cx="26" cy="36" rx="2" ry="2.7" :fill="art.soft" stroke="none" /><ellipse cx="32" cy="33" rx="2" ry="2.7" :fill="art.soft" stroke="none" /><ellipse cx="38" cy="36" rx="2" ry="2.7" :fill="art.soft" stroke="none" />
      </g>
      <g v-else-if="art.kind === 'game'">
        <path d="M22 27h20q6 1 8 9l2 9q-1 7-7 3l-7-6H26l-7 6q-6 4-7-3l2-9q2-8 8-9Z" :fill="art.accent" /><path d="M22 31v9m-4-5h8" stroke="#fffaf4" stroke-width="3" /><circle cx="40" cy="34" r="2" :fill="art.soft" stroke="none" /><circle cx="45" cy="39" r="2" :fill="art.soft" stroke="none" /><path d="m29 23 3-4 3 4" />
      </g>
      <g v-else-if="art.kind === 'home'">
        <path d="M19 32h26v20H19Z" :fill="art.soft" /><path d="m14 33 8-10v-8l8 5h4l8-5v8l8 10Z" :fill="art.accent" /><path d="M27 51V40q5-5 10 0v11" :fill="art.accent" /><circle cx="32" cy="29" r="3" :fill="art.soft" /><path d="M22 44h2m16 0h2" />
      </g>
      <g v-else-if="art.kind === 'medical'">
        <rect x="15" y="27" width="34" height="24" rx="6" :fill="art.soft" /><path d="M25 27v-7h14v7" /><path d="M15 35h34" :stroke="art.accent" stroke-width="3" />
        <path d="M29 35h6v5h5v6h-5v5h-6v-5h-5v-6h5Z" :fill="art.accent" stroke="none" />
      </g>
      <g v-else-if="art.kind === 'study'">
        <path d="M32 26q-10-8-18-4v25q9-4 18 4 9-8 18-4V22q-8-4-18 4Z" :fill="art.soft" /><path d="M32 26v25m-13-22 8 2m-8 5 8 2m-8 5 8 2" :stroke="art.accent" stroke-width="2" /><path d="M39 21v15l4-3 4 3V20" :fill="art.accent" />
      </g>
      <g v-else-if="art.kind === 'salary'">
        <path d="m13 28 34-7 5 23-34 7Z" :fill="art.accent" /><rect x="14" y="27" width="34" height="23" rx="4" :fill="art.soft" /><circle cx="31" cy="38.5" r="7" :fill="art.paper" /><path d="m28 34 3 4 3-4m-6 6h6m-3-2v6m-13-10h2m24 11h-2" />
      </g>
      <g v-else-if="art.kind === 'gift'">
        <rect x="19" y="20" width="26" height="33" rx="5" :fill="art.accent" /><path d="m19 24 13 11 13-11" /><circle cx="32" cy="37" r="7" fill="#ffe5ac" /><path d="m29 34 3 3 3-3m-6 5h6m-3-2v6" />
      </g>
      <g v-else-if="art.kind === 'work'">
        <rect x="13" y="28" width="38" height="24" rx="5" :fill="art.accent" /><path d="M24 28v-8h16v8m-26 9q18 9 36 0" /><rect x="28" y="36" width="8" height="7" rx="2" :fill="art.soft" /><path d="m27 20 5-5 5 5" :fill="art.soft" />
      </g>
      <g v-else-if="art.kind === 'saving'">
        <path d="M32 34V18m0 9q-12-1-12-10 11 0 12 10m0-4q12 0 12-10-11 0-12 10" :fill="art.accent" /><ellipse cx="32" cy="41" rx="16" ry="12" fill="#f4cf7f" /><ellipse cx="32" cy="40" rx="10" ry="8" fill="#ffe9b2" /><path d="m29 35 3 4 3-4m-6 6h6m-3-2v7" />
      </g>
      <g v-else-if="art.kind === 'refund'">
        <circle cx="34" cy="39" r="13" :fill="art.soft" /><path d="m31 34 3 4 3-4m-6 6h6m-3-2v7" /><path d="M46 26q-16-16-28 0v8m-6-6 6 6 6-6" :stroke="art.accent" stroke-width="4" />
      </g>
      <g v-else-if="art.kind === 'other-income'">
        <path d="m24 18 3 9h10l4-9-9 3Z" :fill="art.accent" /><path d="M27 27q-14 13-9 23 14 8 28 0 5-10-9-23Z" :fill="art.soft" /><path d="M25 28h14" :stroke="art.accent" stroke-width="4" /><circle cx="32" cy="42" r="6" :fill="art.paper" /><path d="M32 38v8m-4-4h8" />
      </g>
      <g v-else>
        <path d="M19 20h22l5 6v26H19Z" :fill="art.soft" /><path d="M41 20v7h5m-23 4h15m-15 5h9" :stroke="art.accent" /><path d="m32 45 8-10 4 3-8 10-6 2Z" :fill="art.accent" />
      </g>
    </g>
    <circle cx="10" cy="46" r="2" fill="#fff9ec" /><circle cx="53" cy="48" r="1.6" fill="#fff9ec" />
  </svg>
</template>

<style scoped>
.category-icon { display: block; width: 46px; height: 46px; flex-shrink: 0; filter: drop-shadow(0 2px 0 #d5b5a15c); pointer-events: none; }
</style>
