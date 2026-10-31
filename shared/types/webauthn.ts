export interface PasskeyInfo {
  id: string
  credentialId: string
  deviceName?: string
  transports?: string[]
  createdAt: string
  lastUsedAt?: string
}

export interface RegisterStartResponse {
  challenge: string
  user: {
    id: string
    name: string
    displayName: string
  }
  rp: {
    id: string
    name: string
  }
  pubKeyCredParams: Array<{ type: 'public-key', alg: number }>
  timeout: number
  attestation: 'none' | 'indirect' | 'direct'
  authenticatorSelection: {
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey?: 'required' | 'preferred' | 'discouraged'
    requireResidentKey?: boolean
    userVerification: 'required' | 'preferred' | 'discouraged'
  }
}

export interface LoginStartResponse {
  challenge: string
  allowCredentials: Array<{
    id: string
    type: 'public-key'
    transports?: string[]
  }>
  timeout: number
  userVerification: 'required' | 'preferred' | 'discouraged'
  rpId?: string
}
