import { jwtVerify } from 'jose'
import type { TokenPayload } from '#shared/types/auth'
import { config } from '../config/index'

function getSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(config.auth.accessTokenSecret))
    return payload as unknown as TokenPayload
  } catch {
    return null
  }
}
