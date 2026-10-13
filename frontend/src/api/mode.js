// 默认保持既有本地演示；正式构建/开发通过 --mode server 显式启用。
export const SERVER_MODE = import.meta.env?.MODE === 'server'
