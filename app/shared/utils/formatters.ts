export function maskSecretKey(key?: string): string {
  if (!key) return '••••••••'
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

export function truncate(text?: string, length = 30): string {
  if (!text) return ''
  if (text.length <= length) return text
  return `${text.slice(0, length)}...`
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function generateSecureId(prefix = 'app', length = 8): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let result = ''
  const bytes = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
    for (let i = 0; i < length; i++) {
      result += chars[(bytes[i] ?? 0) % chars.length]
    }
  } else {
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)]
    }
  }
  return prefix ? `${prefix}_${result}` : result
}

export function generateAppId(name?: string): string {
  if (name && name.trim()) {
    const slug = slugify(name).slice(0, 24)
    const suffix = generateSecureId('', 6)
    return `${slug}_${suffix}`
  }
  return generateSecureId('app', 8)
}

const APP_ID_PATTERN = /^(?:app_[a-z0-9]{8}|[a-z0-9][a-z0-9-]{0,23}_[a-z0-9]{6})$/

export function isValidAppId(id?: string): boolean {
  if (!id) return false
  return APP_ID_PATTERN.test(id)
}
