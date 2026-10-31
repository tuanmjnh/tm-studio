import { SignJWT, jwtVerify } from 'jose'
import type { TokenPayload } from '#shared/types/auth'
import { config } from '../config/index'

function getSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signAccessToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.auth.accessTokenExpiry}s`)
    .sign(getSecret(config.auth.accessTokenSecret))
}

export async function signRefreshToken(payload: Pick<TokenPayload, 'userId'>): Promise<string> {
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.auth.refreshTokenExpiry}s`)
    .sign(getSecret(config.auth.refreshTokenSecret))
}

export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(config.auth.accessTokenSecret))
    return payload as unknown as TokenPayload
  } catch {
    return null
  }
}

export async function verifyRefreshToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(config.auth.refreshTokenSecret))
    return { userId: payload.userId as string }
  } catch {
    return null
  }
}
