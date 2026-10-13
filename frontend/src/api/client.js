export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

// 浏览器只请求同源/api，凭据由HttpOnly会话Cookie持有。
export function createApiClient({ fetcher = globalThis.fetch, timeoutMs = 15000, onUnauthorized = () => {}, getOwner = () => null } = {}) {
  let csrf = null
  let csrfOwner = null
  let csrfLoading = null
  let csrfGeneration = 0
  function resetCsrf() { csrfGeneration++; csrf = null; csrfOwner = null; csrfLoading = null }
  async function send(method, path, { body, headers = {}, signal, requestTimeoutMs = timeoutMs } = {}) {
    if (!path.startsWith('/api/') || path.includes('://')) throw new Error('接口须使用同源/api路径')
    const ownerAtSend = getOwner()
    const csrfGenerationAtSend = csrfGeneration
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), requestTimeoutMs)
    const abort = () => timeout.abort()
    if (signal?.aborted) timeout.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetcher(path, { method, headers, body, credentials: 'same-origin', redirect: 'error', signal: timeout.signal })
      let data = null
      let hasBody = false
      if (response.status !== 204) {
        const text = await response.text()
        hasBody = text.trim().length > 0
        if (hasBody) { try { data = JSON.parse(text) } catch { /* HTML代理错误不能直接显示原文。 */ } }
      }
      if (!response.ok) {
        if ((response.status === 401 || data?.code === 'ACCOUNT_CHANGED') && getOwner() === ownerAtSend && csrfGeneration === csrfGenerationAtSend) { resetCsrf(); onUnauthorized() }
        const message = response.status === 401 ? (path === '/api/auth/login' ? '账号或密码不正确。' : '登录已失效，请重新登录。')
          : response.status === 403 ? '安全校验未通过，请重新登录后再试。'
            : typeof data?.message === 'string' ? data.message : '服务暂不可用，请稍后重试。'
        throw new ApiError(message, { status: response.status, code: typeof data?.code === 'string' ? data.code : 'HTTP_ERROR' })
      }
      if (hasBody && data === null) throw new ApiError('服务返回格式不正确，请稍后重试。', { code: 'INVALID_RESPONSE' })
      return data
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(timeout.signal.aborted ? '请求已中断或超时，保存结果可能尚未确认，请使用原操作重试。' : '暂时连接不到服务，请稍后重试。')
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  async function getCsrf() {
    const owner = getOwner()
    if (csrf && csrfOwner !== owner) resetCsrf()
    if (csrf) return csrf
    if (csrfLoading && csrfLoading.owner !== owner) resetCsrf()
    if (!csrfLoading) {
      const current = csrfGeneration
      const attempt = { owner, promise: null }
      csrfLoading = attempt
      attempt.promise = send('GET', '/api/auth/csrf').then(data => {
        if (current !== csrfGeneration || getOwner() !== owner) throw new ApiError('安全校验或登录身份已变化，请使用当前账号重试。', { code: 'STALE_CSRF' })
        if (data?.headerName !== 'X-CSRF-TOKEN' || typeof data.token !== 'string' || !data.token) {
          throw new ApiError('安全校验信息无法读取。', { code: 'INVALID_RESPONSE' })
        }
        csrf = data; csrfOwner = owner
        return data
      }).finally(() => { if (csrfLoading === attempt) csrfLoading = null })
    }
    return csrfLoading.promise
  }
  async function request(method, path, { body, form = false, multipart = false, headers = {}, signal, requestTimeoutMs, beforeSend = () => {} } = {}) {
    const outgoing = { ...headers }
    const expectedOwner = getOwner()
    let csrfToken = null
    if (expectedOwner != null) outgoing['X-Expected-Account'] = String(expectedOwner)
    if (!['GET', 'HEAD'].includes(method)) {
      const token = await getCsrf()
      csrfToken = token
      outgoing[token.headerName] = token.token
    }
    let content = body
    if (body !== undefined && !multipart) {
      outgoing['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json'
      content = form ? new URLSearchParams(body).toString() : JSON.stringify(body)
    }
    // 不自动重试写入；调用方保留同次确认的请求键与草稿。
    beforeSend()
    if (getOwner() !== expectedOwner) throw new Error('登录身份已变化，本次操作没有发送。')
    if (csrfToken && csrfToken !== csrf) throw new ApiError('安全校验已变化，本次操作没有发送，请保留内容后重试。', { code: 'STALE_CSRF' })
    return send(method, path, { body: content, headers: outgoing, signal, requestTimeoutMs })
  }
  async function login(username, password, { isCurrent = () => true } = {}) {
    const beforeSend = () => {
      if (!isCurrent()) throw new ApiError('本次登录已失效，请使用当前页面重新登录。', { code: 'STALE_AUTH' })
    }
    beforeSend()
    await request('POST', '/api/auth/login', { body: { username, password }, form: true, beforeSend })
    beforeSend()
    resetCsrf()
    await getCsrf()
    return request('GET', '/api/auth/me', { beforeSend })
  }
  async function logout({ isCurrent = () => true } = {}) {
    const beforeSend = () => {
      if (!isCurrent()) throw new ApiError('本次退出已失效，请使用当前页面重试。', { code: 'STALE_AUTH' })
    }
    beforeSend()
    await request('POST', '/api/auth/logout', { beforeSend })
    beforeSend()
    resetCsrf()
  }
  return { request, login, logout, getCsrf, resetCsrf }
}
