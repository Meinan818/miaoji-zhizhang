<script setup>
// 1. 导入
import { computed, onBeforeUnmount, ref } from 'vue'
import { ArrowUp } from 'lucide-vue-next'

// 2. Props
const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  catAppearance: { type: Boolean, default: false },
})

// 3. Emits
const emit = defineEmits(['send', 'voice'])

// 4. 响应式数据
const text = ref('')
const showVoiceHint = ref(false)
let voiceHintTimer = null

// 5. 计算属性
const canSend = computed(() => text.value.trim().length > 0 && !props.disabled)

// 6. 方法
function handleSend() {
  if (!canSend.value) {
    return
  }

  emit('send', text.value.trim())
  text.value = ''
}

function handleEnter(event) {
  if (event.isComposing) {
    return
  }

  event.preventDefault()
  handleSend()
}

function handleVoice() {
  emit('voice')
  showVoiceHint.value = true

  if (voiceHintTimer) {
    window.clearTimeout(voiceHintTimer)
  }

  voiceHintTimer = window.setTimeout(() => {
    showVoiceHint.value = false
  }, 1800)
}

// 7. 生命周期
onBeforeUnmount(() => {
  if (voiceHintTimer) {
    window.clearTimeout(voiceHintTimer)
  }
})
</script>

<template>
  <footer class="relative border-t-[3px] border-hand bg-cream px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3" :class="{ 'miao-input': catAppearance }">
    <div class="chat-compose mx-auto flex max-w-2xl items-center gap-2 rounded-full border-2 border-gray-300 bg-white p-1.5 pl-4 shadow-sm">
      <span v-if="!catAppearance" class="text-lg" aria-hidden="true">💬</span>
      <input
        v-model="text"
        class="min-w-0 flex-1 bg-transparent py-2 text-base text-gray-900 outline-none placeholder:text-gray-400"
        :maxlength="catAppearance ? 400 : 120"
        :placeholder="catAppearance ? '午饭25，咖啡18…' : '说说今天花了什么钱...'"
        :aria-label="catAppearance ? '给猫猫发消息' : '发送记账消息'"
        type="text"
        @keydown.enter="handleEnter"
      />

      <button
        v-if="!catAppearance"
        class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xl transition-colors hover:bg-primary-50 active:scale-95"
        title="语音记账开发中"
        type="button"
        @click="handleVoice"
      >
        🎤
      </button>

      <button
        class="chat-send flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-400 text-white shadow-sm transition-all hover:bg-primary-500 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300"
        :disabled="!canSend"
        title="发送"
        aria-label="发送"
        type="button"
        @click="handleSend"
      >
        <span v-if="catAppearance">发送</span>
        <ArrowUp v-else :size="20" :stroke-width="2.5" />
      </button>
    </div>
    <p v-if="catAppearance" class="chat-input-hint">把今天的小开销说给本喵听，确认后才记下哦。</p>

    <p
      v-if="showVoiceHint"
      class="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-hand px-3 py-1.5 text-xs text-white shadow-md"
    >
      语音记账正在开发中 🎤
    </p>
  </footer>
</template>
