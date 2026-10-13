export const LOCAL_PROFILE_KEY = 'miaoji_local_profile_v1'
export const PROFILE_AVATARS = ['cat', 'paw', 'flower']
export const DEFAULT_PROFILE = Object.freeze({ nickname: '记账的小伙伴', signature: '把日子过好，也把小账记好。', avatar: 'cat' })
const MAX_PHOTO_LENGTH = 160000

export function validatePhotoFile(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择JPG、PNG或WebP照片')
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('照片大小须在10MB以内，且不能是空文件')
}

export async function createProfilePhoto(file) {
  validatePhotoFile(file)
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('照片无法读取，请换一张图片')); image.src = url })
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('照片没有有效尺寸')
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('这个浏览器暂时不能处理头像')
    context.fillStyle = '#fff9ef'; context.fillRect(0, 0, 256, 256)
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256)
    const photo = canvas.toDataURL('image/jpeg', .86)
    if (!validPhoto(photo)) throw new Error('照片处理失败，请换一张图片')
    return photo
  } finally { URL.revokeObjectURL(url) }
}

function validPhoto(photo) {
  return typeof photo === 'string' && photo.length <= MAX_PHOTO_LENGTH && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(photo)
}

export function validateLocalProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本地资料格式不正确')
  if (typeof value.nickname !== 'string' || typeof value.signature !== 'string') throw new Error('昵称和签名需要填写文字')
  const nickname = value.nickname.trim()
  const signature = value.signature.trim()
  if (!nickname || [...nickname].length > 20) throw new Error('昵称请填写1–20个字')
  if ([...signature].length > 60) throw new Error('签名最多60个字')
  if (value.avatar === 'photo') {
    if (!validPhoto(value.photo)) throw new Error('请先选择一张有效照片作为头像')
    return { nickname, signature, avatar: 'photo', photo: value.photo }
  }
  if (!PROFILE_AVATARS.includes(value.avatar)) throw new Error('请选择头像贴纸或自定义照片')
  return { nickname, signature, avatar: value.avatar }
}

export function readLocalProfile(storage) {
  try {
    const snapshot = storage.getItem(LOCAL_PROFILE_KEY)
    if (snapshot === null) return { profile: { ...DEFAULT_PROFILE }, snapshot, error: '' }
    const stored = JSON.parse(snapshot)
    if (stored?.version !== 1) throw new Error('本地资料版本暂不支持')
    return { profile: validateLocalProfile(stored.profile), snapshot, error: '' }
  } catch (error) {
    return { profile: { ...DEFAULT_PROFILE }, snapshot: null, error: '本地资料暂时无法读取，原内容已保留。' + error.message }
  }
}

export function saveLocalProfile(storage, value, expectedSnapshot) {
  const profile = validateLocalProfile(value)
  if (storage.getItem(LOCAL_PROFILE_KEY) !== expectedSnapshot) throw new Error('另一页已更新资料，请关闭编辑并重新读取后再修改。')
  const snapshot = JSON.stringify({ version: 1, profile })
  storage.setItem(LOCAL_PROFILE_KEY, snapshot)
  return { profile, snapshot }
}
