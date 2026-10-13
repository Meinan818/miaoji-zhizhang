<script setup>
// 1. 导入
import CatNavIcon from '@/components/common/CatNavIcon.vue'
import { computed } from 'vue'
import { isValidMonth } from '@/utils/statistics'

// 2. Props
const props = defineProps({
  active: {
    type: String,
    default: 'home',
  },
  month: { type: String, default: '' },
})

const navItems = computed(() => [
  { key: 'detail', label: '明细', icon: 'receipt', to: '/bills' },
  { key: 'bill', label: '账单', icon: 'calendar', to: '/' },
  { key: 'saving', label: '统计', icon: 'chart', to: '/stats' },
  { key: 'profile', label: '我的', icon: 'profile', to: '/profile' },
].map(item => ({ ...item, to: isValidMonth(props.month) && ['detail', 'saving'].includes(item.key)
  ? { path: item.to, query: { month: props.month } } : item.to })))
</script>

<template>
  <nav
    class="home-bottom-nav fixed bottom-0 left-0 right-0 z-30"
    aria-label="底部导航"
  >
    <div class="home-nav-content">
      <template v-for="(item, index) in navItems" :key="item.key">
        <router-link
          :to="item.to"
          class="home-nav-item active:scale-95"
          :class="{ 'home-nav-active': active === item.key }"
          :aria-current="active === item.key ? 'page' : undefined"
        >
          <CatNavIcon :kind="item.icon" />
          <span>{{ item.label }}</span>
        </router-link>
        <router-link
          v-if="index === 1"
          to="/chat"
          class="home-compose active:scale-95"
          aria-label="打开 AI 记账"
        >
          <span class="home-plus" aria-hidden="true"><CatNavIcon kind="chat" /></span>
          <span>聊着记</span>
        </router-link>
      </template>
    </div>
  </nav>

</template>

<style scoped>
.home-bottom-nav { height: calc(var(--zz-home-bottom-nav-height) + env(safe-area-inset-bottom, 0px)); border-top: 1px dashed var(--zz-home-line); background: var(--zz-home-bg); color: var(--zz-home-ink); font-family: var(--zz-home-font); font-weight: 400; pointer-events: none; }
.home-nav-content { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); align-items: center; max-width: var(--zz-home-content-width); height: 100%; margin-inline: auto; padding: 8px 16px calc(10px + env(safe-area-inset-bottom, 0px)); }
.home-nav-content > a { pointer-events: auto; }
.home-nav-item, .home-compose { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-width: 0; min-height: 44px; padding: 6px 3px; color: var(--zz-home-ink-soft); font-size: 12px; border-radius: 13px 10px 14px 11px; }
.home-nav-active { background: var(--zz-home-title-brush); color: var(--zz-home-ink); }
.home-compose { padding-block: 0; gap: 3px; color: var(--zz-home-ink); }
.home-plus { display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid var(--zz-home-line); border-radius: 16px 13px 17px 14px; background: var(--zz-home-pink-soft); box-shadow: 0 2px 0 var(--zz-home-line); }
.home-nav-content > a:focus-visible { outline: 2px solid var(--zz-home-ink); outline-offset: 4px; border-radius: 8px; }
@media (max-width: 359px) {
  .home-nav-content { padding-inline: 12px; }
}
</style>
