// 根据确认回执的稳定账单ID恢复关联，不靠金额/备注猜对应关系。
function recordKey(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : id
}

export function linkGroupRecords(group, records) {
  if (!Array.isArray(group.recordIds)) return []
  const byId = new Map(records.map(record => [recordKey(record.id), record]))
  return group.recordIds.flatMap((id, index) => {
    const record = byId.get(recordKey(id))
    return record && group.items[index] ? [{ ...record, draftGroupId: group.id, draftItemId: group.items[index].id }] : []
  })
}
