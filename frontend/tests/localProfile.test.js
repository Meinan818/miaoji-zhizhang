import test from 'node:test'
import assert from 'node:assert/strict'
import { LOCAL_PROFILE_KEY, DEFAULT_PROFILE, readLocalProfile, saveLocalProfile, validateLocalProfile, validatePhotoFile } from '../src/utils/localProfile.js'

function storage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
test('资料缺失只读默认值，不写入任何存储', () => {
  const store = storage()
  assert.deepEqual(readLocalProfile(store).profile, DEFAULT_PROFILE)
  assert.equal(store.values.size, 0)
})
test('保存与读取资料独立于原账本和对话', () => {
  const store = storage({ zhizhang_mock_records: '原账本', zhizhang_conversation: '原对话' })
  const result = saveLocalProfile(store, { nickname: '  小橘  ', signature: '日子慢慢过', avatar: 'flower' }, null)
  assert.deepEqual(readLocalProfile(store).profile, { nickname: '小橘', signature: '日子慢慢过', avatar: 'flower' })
  assert.equal(readLocalProfile(store).snapshot, result.snapshot)
  assert.equal(store.getItem('zhizhang_mock_records'), '原账本')
  assert.equal(store.getItem('zhizhang_conversation'), '原对话')
})
test('旧快照不能覆盖另一页资料', () => {
  const store = storage()
  const original = readLocalProfile(store)
  saveLocalProfile(store, { ...DEFAULT_PROFILE, nickname: '另一页' }, original.snapshot)
  const before = store.getItem(LOCAL_PROFILE_KEY)
  assert.throws(() => saveLocalProfile(store, DEFAULT_PROFILE, original.snapshot), /另一页/)
  assert.equal(store.getItem(LOCAL_PROFILE_KEY), before)
})
test('坏数据与不支持版本保留原文', () => {
  for (const raw of ['{broken', '{"version":2}', '{"version":1,"profile":null}']) {
    const store = storage({ [LOCAL_PROFILE_KEY]: raw })
    assert.match(readLocalProfile(store).error, /原内容已保留/)
    assert.equal(store.getItem(LOCAL_PROFILE_KEY), raw)
  }
})
test('昵称不能为空或超过20个字', () => {
  for (const nickname of ['  ', '字'.repeat(21)]) assert.throws(() => validateLocalProfile({ ...DEFAULT_PROFILE, nickname }), /昵称/)
  assert.equal(validateLocalProfile({ ...DEFAULT_PROFILE, nickname: '🐱'.repeat(20) }).nickname, '🐱'.repeat(20))
})
test('签名可以为空，上限60个字', () => {
  assert.equal(validateLocalProfile({ ...DEFAULT_PROFILE, signature: ' ' }).signature, '')
  assert.throws(() => validateLocalProfile({ ...DEFAULT_PROFILE, signature: '字'.repeat(61) }), /签名/)
})
test('拒绝未知头像和不正确字段类型', () => {
  assert.throws(() => validateLocalProfile({ ...DEFAULT_PROFILE, avatar: 'https://other/avatar' }), /头像/)
  assert.throws(() => validateLocalProfile({ ...DEFAULT_PROFILE, nickname: 3 }), /文字/)
  assert.throws(() => validateLocalProfile([]), /格式/)
})
test('存储读取失败提供错误，保存失败不报告成功', () => {
  assert.match(readLocalProfile({ getItem() { throw new Error('禁止读取') } }).error, /禁止读取/)
  const store = storage()
  store.setItem = () => { throw new Error('空间不足') }
  assert.throws(() => saveLocalProfile(store, DEFAULT_PROFILE, null), /空间不足/)
  assert.equal(store.getItem(LOCAL_PROFILE_KEY), null)
})
test('照片输入限制格式、空文件与10MB上限', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.doesNotThrow(() => validatePhotoFile({ type, size: 10 * 1024 * 1024 }))
  for (const file of [{ type: 'image/svg+xml', size: 100 }, { type: 'image/jpeg', size: 0 }, { type: 'image/png', size: 10 * 1024 * 1024 + 1 }]) assert.throws(() => validatePhotoFile(file))
})
test('自定义照片可保存并与预置头像兼容', () => {
  const store = storage()
  const photo = 'data:image/jpeg;base64,/9j/AAAA'
  const saved = saveLocalProfile(store, { ...DEFAULT_PROFILE, avatar: 'photo', photo }, null)
  assert.equal(readLocalProfile(store).profile.photo, photo)
  saveLocalProfile(store, DEFAULT_PROFILE, saved.snapshot)
  assert.deepEqual(readLocalProfile(store).profile, DEFAULT_PROFILE)
})
test('资料拒绝外部照片地址、SVG内容与过大头像内容', () => {
  for (const photo of ['https://other/photo.jpg', 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,/9j/' + 'A'.repeat(160000)]) assert.throws(() => validateLocalProfile({ ...DEFAULT_PROFILE, avatar: 'photo', photo }), /照片/)
})
