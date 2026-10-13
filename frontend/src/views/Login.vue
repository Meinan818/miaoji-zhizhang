<script setup>
import { ref, onScopeDispose } from 'vue'
import { useRoute } from 'vue-router'
import { getLoginReturnPath } from '@/utils/loginRedirect'
import { SERVER_MODE } from '@/api/mode'
import { useAuthStore } from '@/stores/authStore'
import CatNavIcon from '@/components/common/CatNavIcon.vue'
import miaoAvatar from '@/assets/design/mascot/miao-avatar.png'
import { useRegistrationChallenge, validRegistrationEmail as validEmail } from '@/utils/registration'
const auth = useAuthStore()
const route = useRoute()
const registering = ref(false)
const username = ref('')
const password = ref('')
const confirmation = ref('')
const saving = ref(false)
const error = ref('')
const now = ref(Date.now())
const { code, challenge, challengeExpired, sendingCode, codeNote, resendSeconds, requestCode } = useRegistrationChallenge(auth, username, registering, now, saving, error)
const clock = setInterval(() => { now.value = Date.now() }, 1000)
let active = true
onScopeDispose(() => { active = false; clearInterval(clock) })
async function submit() {
  if (!active || saving.value || !SERVER_MODE) return
  error.value = ''
  if (registering.value && sendingCode.value) { error.value = '请等待验证码申请完成后再注册。'; return }
  const identifier = username.value.trim().toLowerCase()
  if (registering.value ? !validEmail(identifier) : !(validEmail(identifier) || /^[A-Za-z0-9_]{3,32}$/.test(identifier))) {
    error.value = registering.value ? '请输入有效邮箱地址。' : '请输入邮箱或已有的旧账号。'; return
  }
  if (!/^[\x21-\x7E]{12,64}$/.test(password.value)) { error.value = '密码请使用12–64位英文字符、数字或符号，不包含空格。'; return }
  if (registering.value && password.value !== confirmation.value) { error.value = '两次密码不一致。'; return }
  if (registering.value && (!challenge.value || challenge.value.email !== identifier || !/^\d{6}$/.test(code.value))) {
    error.value = '请先申请邮件验证码并输入6位验证码。'; return
  }
  if (registering.value && Date.now() >= challenge.value.expiresAt) { error.value = '验证码已过期，请重新申请后再注册。'; return }
  saving.value = true
  try {
    const success = await (registering.value ? auth.register(identifier, password.value, challenge.value.challengeId, code.value) : auth.login(identifier, password.value))
    if (!active) return
    if (success) { password.value = ''; confirmation.value = ''; window.location.replace(getLoginReturnPath(route.query.redirect)) }
  } catch (failure) { if (active) error.value = failure.message }
  finally { if (active) saving.value = false }
}
</script>
<template>
  <main class="login-page notebook-evolution">
    <section class="login-card">
      <img :src="miaoAvatar" alt="猫猫陪你记账" class="login-cat" />
      <p class="login-eyebrow">属于你的小账本</p><h1>喵叽智账</h1>
      <template v-if="SERVER_MODE">
        <p>{{ registering ? '准备一本新的小账本' : '欢迎回来，翻开今天的小日子' }}</p>
        <form @submit.prevent="submit">
          <fieldset :disabled="saving">
            <label>{{ registering ? '邮箱' : '邮箱 / 旧账号' }}<input v-model="username" :aria-label="registering ? '邮箱' : '邮箱 / 旧账号'" autocomplete="username" :inputmode="registering ? 'email' : 'text'" autocapitalize="none" spellcheck="false" maxlength="254" required /></label>
            <template v-if="registering">
              <button class="login-code" type="button" :disabled="sendingCode || resendSeconds > 0" @click="requestCode">{{ sendingCode ? '正在申请验证码…' : resendSeconds ? `${resendSeconds}秒后可重发` : '发送邮箱验证码' }}</button>
              <label>验证码<input v-model="code" aria-label="验证码" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required /></label>
              <p v-if="challengeExpired" class="login-hint" role="status">验证码已过期，请重新申请。</p>
              <p v-else-if="codeNote" class="login-hint" role="status">{{ codeNote }}</p>
            </template>
            <label>密码<input v-model="password" aria-label="密码" type="password" :autocomplete="registering ? 'new-password' : 'current-password'" maxlength="64" required /></label>
            <label v-if="registering">确认密码<input v-model="confirmation" aria-label="确认密码" type="password" autocomplete="new-password" maxlength="64" required /></label>
            <p class="login-hint">{{ registering ? '注册需验证邮箱；之后用邮箱和密码登录。' : '使用邮箱登录；原有旧账号仍可使用。' }}密码12–64位英文字符、数字或符号。</p>
            <p v-if="error || auth.error" class="login-error" role="alert">{{ error || auth.error }}</p>
            <button class="login-submit" type="submit">{{ saving ? '正在打开账本…' : registering ? '注册并打开账本' : '登录我的账本' }}</button>
            <button class="login-switch" type="button" @click="registering = !registering; error = ''; auth.error = ''; password = ''; confirmation = ''">{{ registering ? '已经有账号，去登录' : '第一次来，注册账号' }}</button>
          </fieldset>
        </form>
        <p class="login-data-note"><CatNavIcon kind="profile" />原浏览器演示账本和照片保留，不会自动导入这个账号。聊天由AI整理草稿，确认后才会记入账本。</p>
      </template>
      <template v-else><p>当前打开的是本地演示版。</p><router-link to="/" class="login-submit">打开本地小账本</router-link></template>
    </section>
  </main>
</template>
<style scoped>
.login-page { display:grid; place-items:center; min-height:100dvh; padding:28px 16px; background:#fff5ed; color:#775968; font-family:var(--zz-home-font); }
.login-card { width:100%; max-width:420px; padding:28px 24px; background:#fffaf5; border:2px solid #e6c4cc; border-radius:32px 27px 34px 26px; box-shadow:0 7px 0 #f0d5dd,0 16px 40px #dbc6bd33; text-align:center; }
.login-cat { width:84px; height:84px; object-fit:contain; margin:auto; }.login-eyebrow { font-size:12px; color:#b48599; margin-top:12px; }h1 { font-size:27px; font-weight:700; margin:4px 0 10px; }
fieldset { border:0; padding:0; min-width:0; }label { display:grid; gap:7px; text-align:left; margin-top:18px; font-size:14px; }input { width:100%; min-height:46px; border:1.5px solid #dec3cf; background:#fffdf9; border-radius:14px; padding:10px 12px; color:#775968; }
input:focus-visible,button:focus-visible,a:focus-visible { outline:2px solid #ba859c; outline-offset:3px; }.login-hint,.login-data-note { font-size:12px; line-height:1.8; margin-top:16px; color:#9e8490; }.login-data-note .cat-nav-icon { width:24px; height:24px; vertical-align:middle; }
.login-submit { display:block; width:100%; min-height:48px; padding:12px; margin-top:18px; border:1.5px solid #d4a4b5; border-radius:16px; background:#f6ccd9; box-shadow:0 4px 0 #e5b0c3; font-weight:700; }.login-switch { min-height:44px; margin-top:14px; padding:8px; font-size:13px; }.login-error { margin-top:16px; color:#a34f66; font-size:13px; overflow-wrap:anywhere; }fieldset:disabled { opacity:.65; }
.login-code { min-height:44px; width:100%; margin-top:12px; padding:8px 12px; border:1.5px solid #dec3cf; border-radius:14px; background:#f4e4f1; font-size:13px; }.login-code:disabled { opacity:.65; }
</style>
