const pages = new Set(['/', '/chat', '/add', '/bills', '/stats', '/profile'])
const base = 'https://miaoji.invalid'

// Preserve the intended page and filters; never turn a login query into an external redirect.
export function getLoginReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/'
  try {
    const url = new URL(value, base)
    if (url.origin !== base || !pages.has(url.pathname)) return '/'
    return url.pathname + url.search + url.hash
  } catch { return '/' }
}
