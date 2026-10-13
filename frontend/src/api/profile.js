export function fromProfileView(value, owner) {
  if (!value || typeof value.nickname !== 'string' || typeof value.signature !== 'string'
    || !value.nickname.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
    || [...value.nickname].length > 20 || [...value.signature].length > 60
    || !['cat', 'paw', 'flower', 'photo'].includes(value.avatar) || !Number.isSafeInteger(value.version) || value.version < 0
    || (value.avatar === 'photo' && value.avatarUrl !== '/api/profile/avatar')) throw new Error('账号资料格式不正确')
  return { nickname: value.nickname, signature: value.signature, avatar: value.avatar, version: value.version,
    ...(value.avatar === 'photo' ? { photo: `${value.avatarUrl}?v=${value.version}${owner ? '&expectedAccount=' + encodeURIComponent(owner) : ''}` } : {}) }
}
export function createProfileApi(client, { owner, isCurrent = () => true } = {}) {
  function guard() { if (!isCurrent()) throw new Error('登录身份已变化，本次资料操作已停止。') }
  async function request(method, path, options = {}) {
    guard()
    const result = await client.request(method, path, { ...options, beforeSend: guard })
    guard()
    return result
  }
  async function read() { return fromProfileView(await request('GET', '/api/profile'), owner) }
  async function save(current, form) {
    guard()
    // Java ProfileService strips Unicode White_Space, including U+0085.
    const clean = text => text.trim().replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
    const nickname = clean(form.nickname), signature = clean(form.signature)
    if (!nickname || [...nickname].length > 20 || [...signature].length > 60 || !['cat', 'paw', 'flower', 'photo'].includes(form.avatar)) {
      throw new Error('昵称须为1–20个字，签名最多60个字，请选择有效头像。')
    }
    let version = current.version, uploadedProfile = null
    if (form.avatar === 'photo' && form.photo?.startsWith('data:image/jpeg;base64,')) {
      const encoded = form.photo.slice('data:image/jpeg;base64,'.length)
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 3 * 1024 * 1024) throw new Error('照片数据不合法')
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
      const body = new FormData(); body.append('image', new Blob([bytes], { type: 'image/jpeg' }), 'avatar.jpg')
      const photo = fromProfileView(await request('POST', `/api/profile/avatar?version=${version}`, { body, multipart: true }), owner)
      if (photo.version !== version + 1 || photo.avatar !== 'photo'
        || photo.nickname !== current.nickname || photo.signature !== current.signature) {
        throw new Error('照片保存回执与原操作不一致，请保留输入并重新读取资料核对，暂勿重复上传。')
      }
      version = photo.version; uploadedProfile = photo
    }
    try {
      const saved = fromProfileView(await request('PUT', '/api/profile', { body: { version, nickname, signature, avatar: form.avatar } }), owner)
      if (saved.version !== version + 1 || saved.nickname !== nickname || saved.signature !== signature || saved.avatar !== form.avatar) {
        throw new Error('资料保存回执与本次操作不一致，请保留输入并重新读取资料核对，暂勿重复保存。')
      }
      return saved
    }
    catch (failure) {
      if (uploadedProfile) throw Object.assign(new Error('照片已保存，但昵称或签名的保存尚未确认。' + failure.message + ' 请重新核对后再试。'),
        { code: failure.code, status: failure.status, partialProfile: uploadedProfile, cause: failure })
      throw failure
    }
  }
  return { read, save }
}
