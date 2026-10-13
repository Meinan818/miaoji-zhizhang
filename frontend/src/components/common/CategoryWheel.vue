<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCategoryWheel } from '@/utils/journal'
const props = defineProps({ categories: { type: Array, required: true }, type: { type: String, required: true }, label: String })
const sectors = computed(() => getCategoryWheel(props.categories).segments)
const slots = ref(props.categories.length)
const ring = ref(null)
const circumference = 2 * Math.PI * 80
let animation
watch(sectors, values => { slots.value = Math.max(slots.value, values.length) })
const segment = index => sectors.value[index] || { color: '#f0dfd0', start: 0, end: 0 }
function dash(index) { const percent = (segment(index).end - segment(index).start) / 100; return percent * circumference + ' ' + (1 - percent) * circumference }
async function animateWheel() {
  await nextTick()
  animation?.cancel()
  if (!ring.value || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  animation = ring.value.animate([
    { transform: 'rotate(-28deg) scale(.92)', opacity: .76 },
    { transform: 'rotate(5deg) scale(1.02)', opacity: 1, offset: .72 },
    { transform: 'rotate(0) scale(1)', opacity: 1 },
  ], { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)' })
}
watch(() => props.type, animateWheel)
onMounted(animateWheel)
onBeforeUnmount(() => animation?.cancel())
</script>
<template>
  <div class="stats-wheel category-wheel" role="img" :aria-label="label">
    <svg ref="ring" class="category-wheel-svg" viewBox="0 0 200 200" aria-hidden="true"><g transform="rotate(-90 100 100)"><circle cx="100" cy="100" r="80" fill="none" stroke="#f2e4d1" stroke-width="32" /><circle v-for="index in slots" :key="index" cx="100" cy="100" r="80" fill="none" :stroke="segment(index - 1).color" stroke-width="32" :stroke-dasharray="dash(index - 1)" :stroke-dashoffset="-segment(index - 1).start / 100 * circumference" /></g></svg>
    <slot />
  </div>
</template>
<style scoped>
.category-wheel { position:relative; }.category-wheel-svg { position:absolute; inset:0; width:100%; height:100%; transform-origin:50% 50%; overflow:visible; }
@media(prefers-reduced-motion:no-preference) { .category-wheel-svg circle { transition:stroke-dasharray 620ms cubic-bezier(.2,.8,.2,1),stroke-dashoffset 620ms cubic-bezier(.2,.8,.2,1),stroke 350ms ease; } }
</style>
