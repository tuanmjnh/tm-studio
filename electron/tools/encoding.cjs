function decodeBuffer(buf) {
  if (!buf || buf.length === 0) return ''
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    if (typeof TextDecoder !== 'undefined') {
      for (const enc of ['windows-1258', 'windows-1252']) {
        try {
          return new TextDecoder(enc).decode(buf)
        } catch {
          // try next encoding
        }
      }
    }
    return buf.toString('latin1')
  }
}

module.exports = { decodeBuffer }
