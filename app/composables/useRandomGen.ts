export interface PasswordOptions {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
  excludeAmbiguous: boolean
}

export interface UsernameOptions {
  style: 'word' | 'name' | 'handle' | 'email-like'
  length?: number
  suffix?: boolean
  domain?: string
}

const AMBIGUOUS = new Set('Il1O0o'.split(''))

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/'

const ADJECTIVES = [
  'swift', 'bright', 'silent', 'brave', 'clever', 'lucky', 'rapid', 'noble',
  'calm', 'epic', 'frost', 'golden', 'iron', 'jade', 'crimson', 'azure',
  'prime', 'ultra', 'hyper', 'neo', 'quantum', 'cosmic', 'solar', 'lunar'
]
const NOUNS = [
  'fox', 'wolf', 'hawk', 'lynx', 'bear', 'eagle', 'shark', 'tiger',
  'pixel', 'nova', 'orbit', 'pulse', 'spark', 'wave', 'cloud', 'storm',
  'coder', 'maker', 'ranger', 'pilot', 'smith', 'smithy', 'blade', 'arrow'
]
const NAMES = [
  'alex', 'jamie', 'riley', 'morgan', 'casey', 'quinn', 'avery', 'taylor',
  'jordan', 'cameron', 'drew', 'reese', 'skyler', 'rowan', 'emery', 'finley'
]
const DOMAINS = ['example.com', 'mail.test', 'demo.local', 'hub.dev']

function randomInt(max: number): number {
  if (max <= 0) return 0
  const limit = Math.floor(0xffffffff / max) * max
  const buf = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0]!
  } while (value >= limit)
  return value % max
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)]!
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

function filterPool(pool: string, excludeAmbiguous: boolean): string {
  if (!excludeAmbiguous) return pool
  return [...pool].filter(ch => !AMBIGUOUS.has(ch)).join('')
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 16,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false
}

export function generatePassword(options: Partial<PasswordOptions> = {}): string {
  const opts = { ...DEFAULT_PASSWORD_OPTIONS, ...options }
  const length = Math.min(Math.max(opts.length || 16, 4), 128)

  const pools: string[] = []
  if (opts.upper) pools.push(filterPool(UPPER, opts.excludeAmbiguous))
  if (opts.lower) pools.push(filterPool(LOWER, opts.excludeAmbiguous))
  if (opts.digits) pools.push(filterPool(DIGITS, opts.excludeAmbiguous))
  if (opts.symbols) pools.push(filterPool(SYMBOLS, opts.excludeAmbiguous))

  const active = pools.filter(p => p.length > 0)
  if (active.length === 0) active.push(filterPool(LOWER, opts.excludeAmbiguous))

  const all = active.join('')
  const chars: string[] = []
  for (const pool of active) chars.push(pick([...pool]))
  while (chars.length < length) chars.push(pick([...all]))
  return shuffle(chars).slice(0, length).join('')
}

export function generatePin(length = 6): string {
  const len = Math.min(Math.max(length, 4), 12)
  let out = ''
  for (let i = 0; i < len; i++) out += String(randomInt(10))
  return out
}

export function generateUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** URL-safe random token (default 32 bytes → 43 chars) */
export function generateToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateApiKey(prefix = 'tm'): string {
  return `${prefix}_${generateToken(24)}`
}

export function generateUsername(options: UsernameOptions = { style: 'handle' }): string {
  const { style, suffix = true, domain } = options
  const num = String(randomInt(9000) + 1000)

  if (style === 'email-like') {
    const user = generateUsername({ style: 'handle', suffix: false })
    return `${user}@${domain || pick(DOMAINS)}`
  }

  if (style === 'name') {
    const base = `${pick(NAMES)}${suffix ? num : ''}`
    return base
  }

  if (style === 'word') {
    const base = `${pick(ADJECTIVES)}${pick(NOUNS)}`
    return suffix ? `${base}${num}` : base
  }

  const base = `${pick(ADJECTIVES)}.${pick(NOUNS)}`
  return suffix ? `${base}${num}` : base
}

export function generateEmail(): string {
  return generateUsername({ style: 'email-like' })
}

export function generateName(): string {
  return `${pick(NAMES)} ${pick(ADJECTIVES).charAt(0).toUpperCase()}${pick(ADJECTIVES).slice(1)}`
}

export function generatePasswordBatch(count: number, options: Partial<PasswordOptions> = {}): string[] {
  const n = Math.min(Math.max(count, 1), 50)
  return Array.from({ length: n }, () => generatePassword(options))
}

export function generateUsernameBatch(count: number, options: UsernameOptions = { style: 'handle' }): string[] {
  const n = Math.min(Math.max(count, 1), 50)
  const seen = new Set<string>()
  const out: string[] = []
  let guard = 0
  while (out.length < n && guard < n * 20) {
    guard++
    const name = generateUsername(options)
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/** Generate cryptographically secure random hex key (e.g., 32 or 64 hex characters) */
export function generateRandomKey(length = 64): string {
  const byteCount = Math.ceil(length / 2)
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return hex.slice(0, length)
}

export function generateRandomKeyBatch(count: number, length = 64): string[] {
  const n = Math.min(Math.max(count, 1), 50)
  return Array.from({ length: n }, () => generateRandomKey(length))
}

export function useRandomGen() {
  return {
    generatePassword,
    generatePasswordBatch,
    generatePin,
    generateUuid,
    generateToken,
    generateApiKey,
    generateRandomKey,
    generateRandomKeyBatch,
    generateUsername,
    generateUsernameBatch,
    generateEmail,
    generateName,
    DEFAULT_PASSWORD_OPTIONS
  }
}
