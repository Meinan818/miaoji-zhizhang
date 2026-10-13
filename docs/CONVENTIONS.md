# 喵叽智账 — 代码规范（docs/CONVENTIONS.md）

> 本文件只讲**怎么写代码**；视觉规范见 [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)，运行方式见 [DEVELOPMENT.md](DEVELOPMENT.md)。
> 前端 Vue 与后端 Java/MySQL 以账号模式联通：Java 按 Controller/Service/Repository 分层，参数化 SQL，写入以会话身份为归属并带版本条件与整组事务。金额在 API 上是十进制字符串，Java 侧 BigDecimal/DECIMAL，前端用整数分；未知业务时间不补写。

## 一、命名约定

| 对象 | 规则 | 示例 |
|---|---|---|
| 组件名 | PascalCase，文件名与组件名一致 | `RecordCard.vue`、`CategoryPicker.vue` |
| 变量 / 函数 | camelCase | `getTotalAmount`、`userInfo` |
| 常量 | UPPER_SNAKE_CASE | `MAX_AMOUNT` |
| CSS 类名 | kebab-case（Tailwind 自动处理） | `record-card` |
| 数据库表 | 小写复数 | `records`、`categories` |
| 数据库字段 | 蛇形 | `user_id`、`created_at` |
| 外键 | `表名_id` | `user_id`、`category_id` |

## 二、目录结构约定（`frontend/src/`）

当前存在的代码入口（不要求创建空目录或占位文件）：

```
src/
├── views/              # Home / Chat / Bills / Add / Stats / Profile；Login真实账号开发版
├── components/         # calendar / common / layout / record / chart / mascot
├── stores/             # authStore.js / recordStore.js / conversationStore.js
├── api/                # client / session / ledger / remoteLedger / profile / mode
├── router/index.js
├── utils/              # money / ledger / draftEngine / statistics / journal / navigation等；规则模拟不是真实AI
├── assets/design/      # 已接入的分类素材
├── styles/             # 首页局部视觉基准等
├── App.vue
└── main.js
```

演示与正式账号数据源按显式mode分开，正式失败不回退演示；防重键先按账号持久化再发送，网络不自动换键重试。下面userStore等代码示例仅示意写法，实际认证入口为authStore。

## 三、Vue 组件规范

统一用 Composition API + `<script setup>`，**代码顺序固定**（便于审查和接手）：

```vue
<script setup>
// 1. 导入
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

// 2. Props
const props = defineProps({
  recordId: { type: String, required: true }
})

// 3. Emits
const emit = defineEmits(['update', 'delete'])

// 4. 组合式函数
const router = useRouter()
const userStore = useUserStore()

// 5. 响应式数据
const loading = ref(false)
const record = ref(null)

// 6. 计算属性
const formattedAmount = computed(() =>
  record.value ? `¥${record.value.amount.toFixed(2)}` : '¥0.00'
)

// 7. 方法
async function fetchRecord() {
  loading.value = true
  try {
    // ...
  } catch (error) {
    console.error(error)
  } finally {
    loading.value = false
  }
}

// 8. 生命周期
onMounted(() => {
  fetchRecord()
})
</script>

<template>
  <div class="container">
    <h1 class="text-2xl font-bold">{{ record?.title }}</h1>
    <p class="text-gray-600">{{ formattedAmount }}</p>
  </div>
</template>

<style scoped>
/* 仅在必要时使用 scoped 样式，优先用 Tailwind */
</style>
```

## 四、Tailwind CSS 用法

**优先级**：Tailwind utility classes（90%）→ `@apply` 组合（5%，仅用于重复样式）→ 自定义 CSS（5%，仅特殊动画/渐变）。

```vue
<!-- 推荐：直接写 utility classes -->
<button class="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600">
  提交
</button>

<!-- 可选：重复样式用 @apply 收口 -->
<style scoped>
.btn-primary {
  @apply px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors;
}
</style>
```

- 色板（`primary` 紫 / `accent` 粉 / `expense` / `income`）在 `tailwind.config.js` 里扩展，**不要硬编码色值**。
- `tailwind.config.js` 的 `content` 必须覆盖所有 `.vue` 文件，否则样式不生效。
- 完整视觉规范见 `docs/DESIGN_SYSTEM.md`（实现页面之前必读）。

## 五、提交信息格式

```
<type>(<scope>): <subject>
```

`type`：`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`。

```
feat(record): 实现账单列表页面

- 按日期分组显示账单
- 支持下拉刷新
- 添加删除功能
- 集成月度统计卡片
```

**一个功能一个 commit**；协同协议文件单独用 `chore(coop):`。

## 六、安全底线

- 前端只放公开服务地址；数据库密码、AI密钥与其他秘密仅保存在Java后端运行环境，不进前端VITE_变量、源码、日志或提交。
- `.env` 不进 Git；只提交只含变量名的 `.env.example`。
- 提交前用 `git status --short` 确认待提交列表里没有任何 `.env` 文件。
