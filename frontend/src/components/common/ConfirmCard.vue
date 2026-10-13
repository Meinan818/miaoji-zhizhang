<script setup>
// 1. 导入
import { computed, ref, watch } from 'vue'
import { CATEGORY_OPTIONS, getCategoryMeta } from '@/utils/mockAI'
import { formatCurrency, formatRecordTime } from '@/utils/format'
import { validateRecord } from '@/utils/ledger'
import CategoryIcon from '@/components/common/CategoryIcon.vue'

// 2. Props
const props = defineProps({
  record: {
    type: Object,
    required: true,
  },
  confirmed: {
    type: Boolean,
    default: false,
  },
  catAppearance: { type: Boolean, default: false },
})

// 3. Emits
const emit = defineEmits(['confirm', 'update'])

// 4. 响应式数据
const editing = ref(false)
const errorMessage = ref('')
const form = ref(createForm(props.record))

// 5. 计算属性
const categoryOptions = computed(() => CATEGORY_OPTIONS[form.value.type] || CATEGORY_OPTIONS.expense)
const recordMeta = computed(() => getCategoryMeta(props.record.category, props.record.type))
const typeLabel = computed(() => props.record.type === 'income' ? '收入' : '支出')

// 6. 方法
function createForm(record) {
  return {
    type: record.type || 'expense',
    amount: String(record.amount ?? ''),
    category: record.category || '其他',
    date: record.date || '',
    time: record.time || '00:00',
    remark: record.remark || '',
  }
}

function startEdit() {
  form.value = createForm(props.record)
  errorMessage.value = ''
  editing.value = true
}

function cancelEdit() {
  form.value = createForm(props.record)
  errorMessage.value = ''
  editing.value = false
}

function handleTypeChange() {
  const validCategory = categoryOptions.value.find((item) => item.label === form.value.category)

  if (!validCategory) {
    form.value.category = categoryOptions.value[0]?.label || '其他'
  }
}

function saveChanges() {
  try {
    const normalized = validateRecord({ ...form.value, description: form.value.remark || form.value.category })
    emit('update', { ...props.record, ...normalized })
    errorMessage.value = ''
    editing.value = false
  } catch (error) { errorMessage.value = error.message }
}

// 7. 生命周期与监听
watch(
  () => props.record,
  (newRecord) => {
    if (!editing.value) {
      form.value = createForm(newRecord)
    }
  },
  { deep: true, immediate: true },
)
</script>

<template>
  <article class="message-enter mx-auto w-full max-w-xl rounded-xl border-[3px] border-hand bg-white p-4 shadow-md" :class="{ 'miao-record': catAppearance }">
    <div class="mb-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span v-if="!catAppearance" class="text-xl">📝</span>
        <span class="record-heading font-semibold text-gray-900">{{ catAppearance ? '这笔小账单' : '已识别' }}</span>
      </div>
      <span v-if="confirmed" class="rounded-full bg-income-light px-3 py-1 text-xs font-medium text-income-dark">
        已记账
      </span>
      <span v-else-if="catAppearance" class="record-pending">待确认</span>
    </div>

    <template v-if="!editing">
      <div class="mb-4 space-y-2">
        <div class="flex items-center justify-between gap-4">
          <span class="text-gray-600">类型</span>
          <span class="confirm-category-label font-medium text-gray-900">
            <CategoryIcon v-if="catAppearance" :category="record.category" :type="record.type" />
            {{ typeLabel }} · {{ record.category }} <template v-if="!catAppearance">{{ recordMeta?.icon }}</template>
          </span>
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-gray-600">金额</span>
          <span
            class="font-mono text-lg font-bold"
            :class="record.type === 'income' ? 'text-income-dark' : 'text-expense-dark'"
          >
            {{ formatCurrency(record.amount) }}
          </span>
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-gray-600">时间</span>
          <span class="text-right text-gray-900">{{ formatRecordTime(record.date, record.time) }}</span>
        </div>
        <div class="flex items-start justify-between gap-4">
          <span class="text-gray-600">备注</span>
          <span class="max-w-[70%] text-right text-gray-900">{{ record.remark || '无' }}</span>
        </div>
      </div>

      <div v-if="!confirmed" class="flex gap-2">
        <button
          class="flex-1 rounded-lg bg-gray-100 px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-200 active:scale-95"
          type="button"
          @click="startEdit"
        >
          修改
        </button>
        <button
          class="flex-1 rounded-lg bg-primary-400 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-primary-500 active:scale-95"
          type="button"
          @click="emit('confirm', props.record)"
        >
          确认记账
        </button>
      </div>
    </template>

    <form v-else class="space-y-3" @submit.prevent="saveChanges">
      <div>
        <label class="mb-1 block text-sm text-gray-600">类型</label>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="option in ['expense', 'income']"
            :key="option"
            class="rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors"
            :class="form.type === option
              ? 'border-primary-400 bg-primary-50 text-primary-700'
              : 'border-gray-200 bg-white text-gray-600'"
            type="button"
            @click="form.type = option; handleTypeChange()"
          >
            {{ option === 'expense' ? (catAppearance ? '支出' : '支出 💸') : (catAppearance ? '收入' : '收入 💰') }}
          </button>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-sm text-gray-600">金额</span>
          <input
            v-model="form.amount"
            class="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 outline-none transition-colors focus:border-primary-400"
            inputmode="decimal"
            min="0.01"
            step="0.01"
            type="number"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-gray-600">分类</span>
          <select
            v-model="form.category"
            class="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 outline-none transition-colors focus:border-primary-400"
          >
            <option v-for="option in categoryOptions" :key="option.label" :value="option.label">
              <template v-if="!catAppearance">{{ option.icon }} </template>{{ option.label }}
            </option>
          </select>
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-sm text-gray-600">日期</span>
          <input
            v-model="form.date"
            class="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 outline-none transition-colors focus:border-primary-400"
            type="date"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-gray-600">时间</span>
          <input
            v-model="form.time"
            class="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 outline-none transition-colors focus:border-primary-400"
            type="time"
          />
        </label>
      </div>

      <label class="block">
        <span class="mb-1 block text-sm text-gray-600">备注</span>
        <input
          v-model="form.remark"
          class="w-full rounded-lg border-2 border-gray-200 bg-white px-3 py-2 outline-none transition-colors focus:border-primary-400"
          maxlength="40"
          type="text"
        />
      </label>

      <p v-if="errorMessage" class="text-sm text-expense-dark">{{ errorMessage }}</p>

      <div class="flex gap-2">
        <button
          class="flex-1 rounded-lg bg-gray-100 px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-200"
          type="button"
          @click="cancelEdit"
        >
          取消
        </button>
        <button
          class="flex-1 rounded-lg bg-primary-400 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-primary-500"
          type="submit"
        >
          保存修改
        </button>
      </div>
    </form>
  </article>
</template>

<style scoped>
.confirm-category-label { display:inline-flex; align-items:center; gap:6px; }
.confirm-category-label .category-icon { width:32px; height:32px; }
</style>
