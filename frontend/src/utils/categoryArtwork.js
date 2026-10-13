// 展示映射独立于账本里的历史 emoji；不会迁移、改写已有记录。
const ARTWORK = {
  expense: {
    餐饮: { kind: 'food', paper: '#ffe8be', accent: '#e5aa68', soft: '#fff6e5' },
    交通: { kind: 'travel', paper: '#dceee4', accent: '#85b6a2', soft: '#f4fbf5' },
    购物: { kind: 'shopping', paper: '#fbdce7', accent: '#de9db7', soft: '#fff4f7' },
    娱乐: { kind: 'game', paper: '#e8def7', accent: '#ae95d0', soft: '#faf5ff' },
    住房: { kind: 'home', paper: '#ffdfcb', accent: '#dd997b', soft: '#fff3e6' },
    医疗: { kind: 'medical', paper: '#dceef0', accent: '#8ebbc0', soft: '#f2fbfc' },
    学习: { kind: 'study', paper: '#e5eccf', accent: '#a0b87e', soft: '#f8fbea' },
    其他: { kind: 'other-expense', paper: '#ece4dc', accent: '#b9a393', soft: '#fffaf4' },
  },
  income: {
    工资: { kind: 'salary', paper: '#dbeed8', accent: '#91b783', soft: '#f2fae9' },
    红包: { kind: 'gift', paper: '#ffdbe0', accent: '#dc8b9e', soft: '#fff0e9' },
    兼职: { kind: 'work', paper: '#f9e3c9', accent: '#d3a074', soft: '#fff6e6' },
    理财: { kind: 'saving', paper: '#e0ecda', accent: '#96b887', soft: '#f7fbe9' },
    退款: { kind: 'refund', paper: '#dde8f5', accent: '#94afd1', soft: '#f5f9ff' },
    其他: { kind: 'other-income', paper: '#f6e8bf', accent: '#d0b46f', soft: '#fff9df' },
  },
}

export function getCategoryArtwork(category, type = 'expense') {
  const group = Object.hasOwn(ARTWORK, type) ? ARTWORK[type] : ARTWORK.expense
  return Object.hasOwn(group, category) ? group[category] : group.其他
}
