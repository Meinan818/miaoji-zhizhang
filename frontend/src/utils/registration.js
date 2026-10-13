import { computed, onScopeDispose, ref, watch } from 'vue'

export const validRegistrationEmail = value => /^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9.-]+\.[A-Za-z0-9-]+$/.test(value) && value.length <= 254

export function useRegistrationChallenge(auth, username, registering, now, saving, error, clock = Date.now) {
  const code = ref('')
  const challenge = ref(null)
  const sendingCode = ref(false)
  const resendUntil = ref(0)
  const codeNote = ref('')
  const resendSeconds = computed(() => Math.max(0, Math.ceil((resendUntil.value - now.value) / 1000)))
  const challengeExpired = computed(() => !!challenge.value && now.value >= challenge.value.expiresAt)
  let generation = 0
  let active = true
  watch([username, registering], () => { generation++; challenge.value = null; code.value = ''; codeNote.value = ''; error.value = '' }, { flush: 'sync' })
  onScopeDispose(() => { active = false; generation++ })
  async function requestCode() {
    if (!active || !registering.value || sendingCode.value || saving.value || clock() < resendUntil.value) return false
    const email = username.value.trim().toLowerCase()
    if (!validRegistrationEmail(email)) { error.value = '请先填写有效邮箱地址。'; return false }
    const current = generation
    const startedAt = clock()
    sendingCode.value = true; error.value = ''; codeNote.value = ''; challenge.value = null; code.value = ''
    try {
      const receipt = await auth.requestRegistrationCode(email)
      if (!active || current !== generation || !registering.value || username.value.trim().toLowerCase() !== email) return false
      challenge.value = { ...receipt, email, expiresAt: startedAt + receipt.expiresIn * 1000 }
      resendUntil.value = clock() + receipt.resendAfter * 1000
      codeNote.value = `验证码邮件已提交发送，有效期${receipt.expiresIn}秒；没找到可检查垃圾邮件。`
      return true
    } catch (failure) { if (active && current === generation) error.value = failure.message; return false }
    finally { if (active) sendingCode.value = false }
  }
  return { code, challenge, challengeExpired, sendingCode, codeNote, resendSeconds, requestCode }
}
