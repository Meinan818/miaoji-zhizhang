<script setup>
import { NotebookPen, PawPrint } from 'lucide-vue-next'
defineProps({ to: { type: [String, Object], default: '/add' } })
</script>
<template>
  <router-link :to="to" class="manual-entry">
    <span class="manual-entry-icon" aria-hidden="true"><NotebookPen :size="18" :stroke-width="1.6" /></span>
    <span>手动记一笔</span>
    <PawPrint class="manual-entry-paw" :size="13" :stroke-width="1.5" aria-hidden="true" />
  </router-link>
</template>
<style scoped>
.manual-entry { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 7px 13px 7px 9px; border: 1px solid #e3bdb5; border-radius: 17px 12px 18px 11px; background: #fff7e8; color: #785746; box-shadow: 2px 3px 0 #f3ddd7; font-family: inherit; font-size: 13px; line-height: 1.4; text-decoration: none; white-space: nowrap; }
.manual-entry-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 10px 8px 11px 7px; background: #f9e6df; }
.manual-entry-paw { color: #b9817a; transform: rotate(13deg); }
.manual-entry:hover { background: #fff0de; }
.manual-entry:active { box-shadow: 1px 1px 0 #f3ddd7; }
@media (prefers-reduced-motion: no-preference) { .manual-entry { transition: background-color 150ms ease, box-shadow 150ms ease; } }
.manual-entry:focus-visible { outline: 2px solid #785746; outline-offset: 4px; }
</style>
