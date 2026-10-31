export type AuthProvider = 'hub' | 'mongodb' | 'supabase'
export type LoginPlatform = 'web' | 'desktop' | 'mobile'

export interface PushSubscriptionData {
  fcmToken?: string
  endpoint?: string
  keys?: {
    p256dh: string
    auth: string
  }
  deviceType?: string
  createdAt?: string
}

export interface User {
  id: string
  email: string
  username?: string
  name: string
  avatar?: string
  role: string
  password?: string
  platform: LoginPlatform
  lastLogin?: string
  lastIp?: string
  userAgent?: string
  pushSubscriptions?: PushSubscriptionData[]
  createdAt: string
  updatedAt: string
}

export interface AuthUser extends User {
  permissions: string[]
  allowedRoutes?: string[]
}

export interface RefreshToken {
  id: string
  userId: string
  token: string
  expiresAt: string
  revokedAt?: string
  revokedBy?: string
  createdAt: string
  platform?: string
  userAgent?: string
  lastIp?: string
}

export interface UserSession {
  id: string
  platform: string
  userAgent: string
  lastIp: string
  createdAt: string
  expiresAt: string
  isCurrent: boolean
}

export interface LoginRequest {
  email?: string
  username?: string
  password: string
  platform?: LoginPlatform
}

export interface RegisterRequest {
  email: string
  password: string
  name: string
}

export interface ForgotPasswordRequest {
  email: string
  appId?: string
  redirectUrl?: string
}

export interface ResetPasswordRequest {
  email: string
  token: string
  password: string
  appId?: string
}

export interface AuthResponse {
  user: AuthUser
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** Login tra ve khi user da bat 2FA - can xac minh TOTP tiep. */
export interface TotpChallenge {
  totpRequired: true
  pendingTotpToken: string
  user: {
    id: string
    email: string
    name: string
  }
}

export function isTotpChallenge(result: AuthResponse | TotpChallenge): result is TotpChallenge {
  return (result as TotpChallenge).totpRequired === true
}

export interface TokenPayload {
  userId: string
  email: string
  role: string
  permissions: string[]
  allowedRoutes?: string[]
  appId?: string
}

export interface AuthConfig {
  provider: AuthProvider
  accessTokenSecret: string
  refreshTokenSecret: string
  accessTokenExpiry: number
  refreshTokenExpiry: number
}
