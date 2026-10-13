import { ref } from 'vue'
import { ApiError } from './client.js'

export function createSession(client, { onIdentityChange = () => {} } = {}) {
  const user = ref(null)
  const status = ref('unknown')
  const error = ref('')
  let generation = 0
  let restoration = null
  let active = true
  function dispose() { active = false; generation++; restoration = null }
  function waitForRestoration() { return restoration?.promise ?? Promise.resolve(false) }
  function identity(value) {
    if (value !== null && (!/^\d+$/.test(value.id) || typeof value.username !== 'string')) {
      throw new ApiError('账号身份格式不正确，请重新登录。', { code: 'INVALID_RESPONSE' })
    }
    const previous = user.value?.id ?? null
    user.value = value === null ? null : { id: value.id, username: value.username }
    if (previous !== (value?.id ?? null)) onIdentityChange(value?.id ?? null, previous)
  }
  function expire() { if (!active) return; generation++; restoration = null; identity(null); status.value = 'guest'; error.value = '登录已失效，请重新登录。' }
  async function restore() {
    if (!active) return false
    if (restoration) return restoration.promise
    const current = generation
    status.value = 'loading'; error.value = ''
    const attempt = { promise: null }
    restoration = attempt
    attempt.promise = (async () => {
      try {
        const value = await client.request('GET', '/api/auth/me')
        if (current !== generation) return false
        identity(value); status.value = 'authenticated'; return true
      } catch (failure) {
        if (current !== generation) return false
        if (failure.status === 401) { identity(null); status.value = 'guest'; return false }
        identity(null); status.value = 'unavailable'; error.value = failure.message
        throw failure
      } finally { if (restoration === attempt) restoration = null }
    })()
    return attempt.promise
  }
  async function login(username, password) {
    if (!active) return false
    const current = ++generation
    restoration = null
    identity(null); status.value = 'loading'; error.value = ''
    try {
      const value = await client.login(username, password, { isCurrent: () => active && current === generation })
      if (current !== generation) return false
      identity(value); status.value = 'authenticated'; return true
    } catch (failure) {
      if (current !== generation) return false
      status.value = failure.status === 401 ? 'guest' : 'unavailable'; error.value = failure.message
      throw failure
    }
  }
  async function requestRegistrationCode(email) {
    if (!active) throw new ApiError('当前认证页面已释放，请重新打开登录页。', { code: 'STALE_SESSION' })
    const value = await client.request('POST', '/api/auth/email/code', { body: { email } })
    if (!active) throw new ApiError('当前认证页面已释放，请重新打开登录页。', { code: 'STALE_SESSION' })
    if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.challengeId)
      || !Number.isInteger(value.expiresIn) || value.expiresIn < 1 || !Number.isInteger(value.resendAfter) || value.resendAfter < 1) {
      throw new ApiError('验证码申请回执不完整，请保留邮箱后再试。', { code: 'INVALID_RESPONSE' })
    }
    return value
  }
  async function register(email, password, challengeId, code) {
    if (!active) return false
    const current = ++generation
    restoration = null
    try {
      await client.request('POST', '/api/auth/email/register', { body: { email, password, challengeId, code } })
    } catch (failure) {
      if (current !== generation) return false
      throw failure
    }
    if (current !== generation) return false
    const automaticLogin = login(email, password)
    const loginGeneration = generation
    try { return await automaticLogin }
    catch (failure) {
      if (!active || loginGeneration !== generation) return false
      error.value = `注册已成功，但自动登录未完成。请切换到登录，用此邮箱和密码重试。${failure.message}`
      throw new ApiError(error.value, { status: failure.status, code: failure.code })
    }
  }
  async function logout() {
    if (!active) return false
    const current = ++generation
    restoration = null
    try { await client.logout({ isCurrent: () => active && current === generation }) }
    catch (failure) {
      if (current !== generation) return false
      if (failure.status !== 401) { error.value = failure.message; throw failure }
    }
    if (current !== generation) return false
    identity(null); status.value = 'guest'; error.value = ''
  }
  return { user, status, error, restore, waitForRestoration, login, register, requestRegistrationCode, logout, expire, dispose }
}
