import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateId(): string {
  return uuidv4()
}

export function generateToken(): string {
  return uuidv4() + '-' + uuidv4()
}

export function sanitizeUser<T extends { password?: string }>(user: T): Omit<T, 'password'> {
  const { password, ...rest } = user
  return rest
}
