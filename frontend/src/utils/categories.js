export const CATEGORY_OPTIONS = {
  expense: [
    { label: '餐饮', icon: '🍔', keywords: ['吃', '饭', '面', '午饭', '蛋糕', '面包', '牛奶', '外卖', '早餐', '午餐', '晚餐', '奶茶', '咖啡', '火锅', '烧烤'] },
    { label: '交通', icon: '🚗', keywords: ['打车', '地铁', '公交', '加油', '停车', '高铁', '机票', '车费'] },
    { label: '购物', icon: '🛍️', keywords: ['购物', '购买', '买东西', '衣服', '鞋', '淘宝', '京东', '超市', '日用品'] },
    { label: '娱乐', icon: '🎮', keywords: ['电影', '游戏', '唱歌', 'ktv', '娱乐', '会员'] },
    { label: '住房', icon: '🏠', keywords: ['房租', '水费', '电费', '燃气', '物业'] },
    { label: '医疗', icon: '💊', keywords: ['医院', '看病', '买药', '药', '体检'] },
    { label: '学习', icon: '📚', keywords: ['书', '课程', '培训', '学习', '考试'] },
    { label: '其他', icon: '📝', keywords: [] },
  ],
  income: [
    { label: '工资', icon: '💵', keywords: ['工资', '薪水', '发薪', '奖金'] },
    { label: '红包', icon: '🧧', keywords: ['红包', '压岁钱'] },
    { label: '兼职', icon: '💼', keywords: ['兼职', '外快', '稿费'] },
    { label: '理财', icon: '📈', keywords: ['理财', '利息', '收益'] },
    { label: '退款', icon: '↩️', keywords: ['退款', '报销'] },
    { label: '其他', icon: '💰', keywords: [] },
  ],
}

export function getCategoryOptions(type) {
  return CATEGORY_OPTIONS[type] || CATEGORY_OPTIONS.expense
}

function getCategoryMatchScore(text, category) {
  const normalizedText = text.toLowerCase()
  const label = category.label.toLowerCase()
  const scores = category.keywords
    .filter((keyword) => normalizedText.includes(keyword.toLowerCase()))
    .map((keyword) => keyword.length)

  if (normalizedText.includes(label)) {
    scores.push(label.length + 2)
  }

  return scores.length ? Math.max(...scores) : 0
}

export function findCategoryMatch(text, type) {
  return getCategoryOptions(type)
    .map((category, index) => ({
      category,
      index,
      score: getCategoryMatchScore(text, category),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.category
}

export function getCategoryMeta(category, type = 'expense') {
  return getCategoryOptions(type).find((item) => item.label === category)
    || getCategoryOptions(type).at(-1)
}
