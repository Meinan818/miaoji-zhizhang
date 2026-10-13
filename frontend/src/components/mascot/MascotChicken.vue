<script setup>
// 1. 导入
import { computed } from 'vue'

// 2. Props
const props = defineProps({
  mood: {
    type: String,
    default: 'happy',
  },
})

// 3. 计算属性
const moodMeta = computed(() => {
  const moodMap = {
    happy: { emoji: '😊', label: '在听你说' },
    thinking: { emoji: '🤔', label: '正在思考' },
    success: { emoji: '🎉', label: '记账成功' },
    confused: { emoji: '🤔', label: '没太听懂' },
    sleepy: { emoji: '😴', label: '休息一下' },
  }

  return moodMap[props.mood] || moodMap.happy
})
</script>

<template>
  <div class="mascot-bob pointer-events-none fixed bottom-24 left-4 z-20 select-none text-center" aria-label="小黄鸡小账">
    <div class="relative flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-hand bg-primary-100 shadow-md">
      <span class="text-4xl">🐣</span>
      <span class="absolute -right-1 -top-1 rounded-full bg-white px-1.5 text-lg shadow-sm">
        {{ moodMeta.emoji }}
      </span>
    </div>
    <p class="mt-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-gray-600 shadow-sm">
      {{ moodMeta.label }}
    </p>
  </div>
</template>
