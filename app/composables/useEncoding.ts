export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'

export interface JwtDecoded {
  header: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  signature: string
  valid: boolean
  error?: string
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function bytesToBinary(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(2).padStart(8, '0')).join(' ')
}

/** Unicode-safe Base64 encode */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Unicode-safe Base64 decode */
export function decodeBase64(text: string): string {
  const binary = atob(text.trim())
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeUrl(text: string): string {
  return encodeURIComponent(text)
}

export function decodeUrl(text: string): string {
  return decodeURIComponent(text)
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;'
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]!)
}

export function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
}

export function encodeHex(text: string): string {
  return bytesToHex(new TextEncoder().encode(text))
}

export function decodeHex(text: string): string {
  const clean = text.trim().replace(/\s+/g, '').replace(/^0x/i, '')
  if (clean.length % 2 !== 0) throw new Error('Hex string must have even length')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('Invalid hex character')
    bytes[i] = byte
  }
  return new TextDecoder().decode(bytes)
}

export function encodeBinary(text: string): string {
  return bytesToBinary(new TextEncoder().encode(text))
}

export function decodeBinary(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  const bytes = new Uint8Array(parts.length)
  for (let i = 0; i < parts.length; i++) {
    const bin = parts[i]!
    if (!/^[01]{1,8}$/.test(bin)) throw new Error(`Invalid binary byte: ${bin}`)
    bytes[i] = Number.parseInt(bin, 2)
  }
  return new TextDecoder().decode(bytes)
}

export function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const code = ch.charCodeAt(0)
    const base = code <= 90 ? 65 : 97
    return String.fromCharCode(((code - base + 13) % 26) + base)
  })
}

export function reverseText(text: string): string {
  return [...text].reverse().join('')
}

async function subtleHash(algorithm: HashAlgorithm, text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest(algorithm, data)
  return bytesToHex(new Uint8Array(digest))
}

export async function sha1(text: string): Promise<string> {
  return subtleHash('SHA-1', text)
}

export async function sha256(text: string): Promise<string> {
  return subtleHash('SHA-256', text)
}

export async function sha384(text: string): Promise<string> {
  return subtleHash('SHA-384', text)
}

export async function sha512(text: string): Promise<string> {
  return subtleHash('SHA-512', text)
}

/** Compact pure-TS MD5 (Web Crypto does not support MD5) */
export function md5(text: string): string {
  const msg = new TextEncoder().encode(text)
  return md5Bytes(msg)
}

function md5Bytes(input: Uint8Array): string {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ]
  const K = new Uint32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)

  const bitLen = input.length * 8
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) << 6)
  padded.set(input)
  padded[input.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bitLen >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const M = new Uint32Array(16)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(offset + i * 4, true)
    let A = a0
    let B = b0
    let C = c0
    let D = d0

    for (let i = 0; i < 64; i++) {
      let F: number
      let g: number
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      F = (F + A + K[i]! + M[g]!) >>> 0
      A = D
      D = C
      C = B
      B = (B + ((F << S[i]!) | (F >>> (32 - S[i]!)))) >>> 0
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }

  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, a0, true)
  outView.setUint32(4, b0, true)
  outView.setUint32(8, c0, true)
  outView.setUint32(12, d0, true)
  return bytesToHex(out)
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return decodeBase64(padded + pad)
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return bytesToBase64Url(new Uint8Array(sig))
}

export interface JwtEncodeOptions {
  secret?: string
  header?: Record<string, unknown>
  algorithm?: 'HS256' | 'none'
}

/** Encode JWT — HS256 (HMAC-SHA256) or unsigned (alg: none) */
export async function encodeJwt(
  payload: Record<string, unknown>,
  options: JwtEncodeOptions = {}
): Promise<string> {
  const algorithm = options.algorithm ?? (options.secret ? 'HS256' : 'none')
  const header = { alg: algorithm, typ: 'JWT', ...options.header }
  const h = base64UrlEncode(JSON.stringify(header))
  const p = base64UrlEncode(JSON.stringify(payload))
  const data = `${h}.${p}`
  if (algorithm === 'none') return `${data}.`
  if (!options.secret) throw new Error('Secret is required for HS256')
  const sig = await hmacSha256(options.secret, data)
  return `${data}.${sig}`
}

/** Decode JWT header/payload without signature verification */
export function decodeJwt(token: string): JwtDecoded {
  const parts = token.trim().split('.')
  if (parts.length !== 3) {
    return { header: null, payload: null, signature: parts[0] ?? '', valid: false, error: 'invalid_format' }
  }
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]!)) as Record<string, unknown>
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>
    return { header, payload, signature: parts[2]!, valid: true }
  } catch {
    return { header: null, payload: null, signature: parts[2] ?? '', valid: false, error: 'decode_failed' }
  }
}

/**
 * Generate a cryptographically secure random key in hex format.
 * @param length Character length of the key (default 64, e.g. 32 for 16 bytes, 64 for 32 bytes).
 */
export function generateHexKey(length: number = 64): string {
  const byteCount = Math.ceil(length / 2)
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes).slice(0, length)
}

export function useEncoding() {
  const runHash = async (algo: HashAlgorithm | 'MD5', text: string): Promise<string> => {
    if (algo === 'MD5') return md5(text)
    return subtleHash(algo, text)
  }

  return {
    encodeBase64,
    decodeBase64,
    encodeUrl,
    decodeUrl,
    escapeHtml,
    unescapeHtml,
    encodeHex,
    decodeHex,
    encodeBinary,
    decodeBinary,
    rot13,
    reverseText,
    md5,
    sha1,
    sha256,
    sha384,
    sha512,
    runHash,
    decodeJwt,
    encodeJwt,
    generateHexKey,
    generateRandomKey: generateHexKey
  }
}
