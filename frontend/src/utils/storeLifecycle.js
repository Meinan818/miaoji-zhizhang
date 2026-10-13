import { effectScope, onScopeDispose } from 'vue'
import { defineStore, getActivePinia } from 'pinia'

// Pinia's HMR setup has its own scope. Keep one replaceable resource scope per
// Pinia, and let the original store dispose whichever version is current.
export function defineScopedStore(id, setup, lifetimes = new WeakMap()) {
  return defineStore(id, () => {
    const pinia = getActivePinia()
    let lifetime = lifetimes.get(pinia)
    if (!lifetime) {
      lifetime = { scope: null }
      lifetimes.set(pinia, lifetime)
      onScopeDispose(() => {
        lifetime.scope?.stop()
        lifetimes.delete(pinia)
      })
    }
    lifetime.scope?.stop()
    lifetime.scope = effectScope(true)
    return lifetime.scope.run(setup)
  })
}
