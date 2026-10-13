import { createRouter, createWebHistory } from 'vue-router'
import { watch } from 'vue'
import { getScrollPosition } from '@/utils/navigation'
import { SERVER_MODE } from '@/api/mode'
import { useAuthStore } from '@/stores/authStore'
import { useRecordStore } from '@/stores/recordStore'
import { getLoginReturnPath } from '@/utils/loginRedirect'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('@/views/Chat.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/add',
    name: 'Add',
    component: () => import('@/views/Add.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/bills',
    name: 'Bills',
    component: () => import('@/views/Bills.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/stats',
    name: 'Stats',
    component: () => import('@/views/Stats.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('@/views/Profile.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: getScrollPosition,
})

let navigationGeneration = 0
function loginTarget(to) {
  const redirect = getLoginReturnPath(to.fullPath)
  return redirect === '/' ? { name: 'Login' } : { name: 'Login', query: { redirect } }
}
if (SERVER_MODE) router.beforeEach(async to => {
  const current = ++navigationGeneration
  const auth = useAuthStore()
  try {
    if (['unknown', 'unavailable'].includes(auth.status)) await auth.restore()
    else await auth.waitForRestoration()
  } catch {
    if (current !== navigationGeneration) return false
    if (to.name !== 'Login') return loginTarget(to)
  }
  if (current !== navigationGeneration) return false
  if (to.meta.requiresAuth && !auth.user) return loginTarget(to)
  if (to.name === 'Login' && auth.user) return getLoginReturnPath(to.query.redirect)
  const owner = auth.user?.id
  if (to.meta.requiresAuth) {
    let ownerChanged = false
    const stop = watch(() => auth.user?.id, () => { ownerChanged = true }, { flush: 'sync' })
    try {
      await useRecordStore().refresh()
      if (current !== navigationGeneration) return false
      // A restored id cannot revive a navigation started by an earlier identity.
      if (ownerChanged || auth.user?.id !== owner) return auth.user ? false : loginTarget(to)
    } finally { stop() }
  }
})

export default router
