// The caller explicitly initiates a local download; no storage or network writes.
export function downloadJson(value, filename, environment = globalThis) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' })
  downloadBlob(blob, filename, environment)
}

export function downloadCsv(text, filename, environment = globalThis) {
  downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename, environment)
}

function downloadBlob(blob, filename, environment) {
  const url = environment.URL.createObjectURL(blob)
  let anchor
  try {
    anchor = environment.document.createElement('a')
    anchor.href = url
    anchor.download = filename
    environment.document.body.appendChild(anchor)
    anchor.click()
  } catch (error) {
    environment.URL.revokeObjectURL(url)
    throw error
  } finally { anchor?.remove() }
  // Let the browser consume the clicked URL before releasing it.
  environment.setTimeout(() => environment.URL.revokeObjectURL(url), 1000)
}
