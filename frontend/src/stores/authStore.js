import { defineStore, skipHydrate } from 'pinia'
import { markRaw, onScopeDispose } from 'vue'
import { createApiClient } from '../api/client.js'
import { createSession } from '../api/session.js'
import { SERVER_MODE } from '../api/mode.js'
import { getLoginReturnPath } from '../utils/loginRedirect.js'

export const useAuthStore = defineStore('auth', () => {
  let session
  let active = true
  const api = markRaw(createApiClient({ fetcher: (...args) => {
    if (!active) throw new Error('认证实例已释放')
    return globalThis.fetch(...args)
  }, getOwner: () => session?.user.value?.id ?? null, onUnauthorized: () => { if (active && session.user.value) session.expire() } }))
  session = createSession(api, { onIdentityChange: (next, previous) => {
    // 完整重新载入同时撤销旧页面异步操作和账号缓存，保留所有存储原文。
    if (active && SERVER_MODE && previous !== null && next === null) {
      const location = window.location
      const redirect = getLoginReturnPath(`${location.pathname ?? '/'}${location.search ?? ''}${location.hash ?? ''}`)
      location.replace(redirect === '/' ? '/login' : `/login?redirect=${encodeURIComponent(redirect)}`)
    }
  } })
  const { dispose: disposeSession, ...state } = session
  onScopeDispose(() => { active = false; disposeSession(); api.resetCsrf() })
  // A fresh client must verify the current Cookie rather than revive a disposed identity.
  return { ...state, user: skipHydrate(session.user), status: skipHydrate(session.status), error: skipHydrate(session.error), api }
})
