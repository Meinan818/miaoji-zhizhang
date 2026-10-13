import dayjs from 'dayjs'
import { toRecordInput } from './ledger.js'
import { createId, validDate, validateRecord } from '../utils/ledger.js'
import { centsText, parseCents } from '../utils/money.js'
import { applyDraftInput, groupReply } from '../utils/draftEngine.js'

// 确认/取消及明确改价采用确定操作，新整理和追加调用真实解析接口。
export function draftControl(text) {
  if (/^(?:取消(?:这组|这些|草稿)?|不记了|这组不记了|算了)[。！!]?$/u.test(text.trim())) return 'cancel'
  if (/^(?:确认(?:记下|记账|保存)?(?:\d+笔)?|就这些[，,]?记下吧|记下吧|保存这组|全部记下)[。！!]?$/u.test(text.trim())) return 'confirm'
  return null
}

export function createAiDraftApi(client, { isCurrent = () => true, makeId = createId } = {}) {
  const beforeSend = () => { if (!isCurrent()) throw new Error('登录身份已变化，本次草稿整理已停止。') }
  async function parse(text, { date, group = null, signal } = {}) {
    const guard = () => {
      beforeSend()
      if (signal?.aborted) throw new Error('本次AI整理已停止，未入账。')
    }
    guard()
    if (group && ['saved', 'cancelled'].includes(group.status)) throw new Error('这组已结束，请创建新草稿。')
    let message = String(text || '').trim()
    const requestDate = group?.pending?.kind === 'ai'
      ? group.pending.referenceDate ?? group.createdDate ?? date : date
    if (group?.pending?.kind === 'ai') message = `${group.pending.text}\n本喵追问：${group.pending.question}\n用户补充：${message}`
    if (!message || message.length > 1000 || !validDate(requestDate) || requestDate.startsWith('9999-')) {
      throw new Error('这次整理的文字（含待补充内容）最多1000字，请精简后重试，或取消这组重新描述。')
    }
    const isAddition = /^(?:再加(?:一笔)?|另外加(?:一笔)?|追加)/.test(message)
    if (isAddition && group?.items?.length >= 5) throw new Error('当前组最多5笔，请先确认或取消。本次没有追加。')
    // 单笔确定操作不处理多段指令；否则后一句的金额可能误套给前一句的目标。
    const correctionText = message.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, token => token.replaceAll(',', ''))
      .replace(/[。！!?？]+$/u, '')
    const multipleClauses = /[，,、;；。\n]|然后|另外|同时|以及|还有|并且|和|与/.test(correctionText)
      || (message.match(/改成|改为|改到|改一下/g) || []).length > 1
    const selectingTarget = group?.pending?.kind === 'target'
      && /^(?:是|就是|选|选择)?第[1-5一二三四五]笔$/u.test(correctionText)
    const correctionValue = correctionText.match(/^.+?(?:改成|改为|改到|改一下|是)\s*(.+)$/u)?.[1]
    const simpleCorrection = !multipleClauses && correctionValue != null
      && (/^(?:今天|昨天|前天|\d{4}-\d{2}-\d{2})(?:的)?$/u.test(correctionValue)
        || /^[+-]?\d+(?:\.\d+)?\s*(?:元|块钱?|人民币)?$/u.test(correctionValue))
      && /改成|改为|改到|改一下|那笔|第[1-5一二三四五]笔.*(?:是|金额|日期)/.test(message)
    if (group && !isAddition && (selectingTarget || (simpleCorrection
      && (group.status === 'ready' || group.pending?.kind === 'target')))) {
      // 不让单笔改价的模型结果替换整个组；既有规则只修改明确目标，歧义先问编号。
      const result = applyDraftInput({ ...group, origin: 'ai' }, message, { date: requestDate, makeId })
      guard()
      return result
    }
    if (group?.pending?.kind === 'target' && !isAddition) {
      const pending = group.pending
      const choices = group.items.flatMap((item, index) => pending.itemIds.includes(item.id) ? [`第${index + 1}笔`] : []).join('或')
      const patch = [pending.patch.amountCents != null ? `金额${centsText(pending.patch.amountCents)}元` : '',
        pending.patch.date ? `日期${pending.patch.date}` : ''].filter(Boolean).join('，')
      message = `尚未应用的修改：${choices}，改为${patch}。本喵追问：要修改第几笔？\n用户补充：${message}`
      if (message.length > 1000) throw new Error('这次整理的文字（含待补充内容）最多1000字，请精简后重试。')
    }
    const context = (group?.items || []).map(toRecordInput)
    const sendParse = () => client.request('POST', '/api/ai/parse', {
      body: { message, date: requestDate, context }, requestTimeoutMs: 65000, beforeSend: guard, signal,
    })
    let response
    for (let attempt = 0; attempt < 2; attempt++) {
      try { response = await sendParse(); break }
      catch (error) {
        if (signal?.aborted) throw new Error('本次AI整理已停止，未入账。')
        if (error.code === 'NETWORK_ERROR') throw new Error('AI请求已中断、超时或连接失败，未入账，可以重试整理。')
        // 免费模型偶发返回不合规：自动再整理一次；仍不合规与所有其他错误按原样处理。
        if (error.code !== 'AI_INVALID_RESPONSE' || attempt === 1) throw error
        guard()
      }
    }
    guard()
    if (response?.model !== 'glm-4-flash-250414' || !['ready', 'needs_input'].includes(response.status)
      || !Array.isArray(response.records) || response.records.length > 5 || typeof response.question !== 'string'
      || response.question.length > 300) throw new Error('AI草稿格式不正确，原草稿没有改变。')
    const next = { id: group?.id || makeId('draft'), createdDate: group?.createdDate || date,
      origin: 'ai', items: [], status: response.status, pending: null }
    if (response.status === 'needs_input') {
      if (response.records.length || !response.question.trim()) throw new Error('AI追问格式不正确，原草稿没有改变。')
      // 追问时保护已有完整候选；原始文字单独限长保存，以便刷新后继续补充。
      next.items = group?.items ? JSON.parse(JSON.stringify(group.items)) : []
      next.pending = { kind: 'ai', text: message, question: response.question, referenceDate: requestDate }
      return { group: next, reply: response.question }
    }
    if (!response.records.length || response.records.length < (group?.items?.length || 0) || response.question !== '') throw new Error('AI候选账单不完整，原草稿没有改变。')
    if (isAddition && response.records.length <= (group?.items?.length || 0)) throw new Error('AI没有返回追加的候选账单，原草稿没有改变。')
    next.items = response.records.map((record, index) => {
      if (typeof record?.amount !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(record.amount) || typeof record.note !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) throw new Error('AI账单字段不正确，原草稿没有改变。')
      // 用户没说时间时按记录时刻补当前时间；纠正重解析沿用原候选已定时间；明确说出的时间始终优先。
      const time = record.time || group?.items?.[index]?.time || dayjs().format('HH:mm')
      const value = validateRecord({ ...record, time, remark: record.note })
      return { ...value,
        id: group?.items?.[index]?.id || makeId('item'), amountCents: parseCents(record.amount),
        errors: { amount: '', date: '', time: '' } }
    })
    return { group: next, reply: groupReply(next) }
  }
  return { parse }
}
