import type { PasskeyInfo, RegisterStartResponse } from '#shared/types/webauthn'

type CredentialResponseJSON = {
  clientDataJSON: string
  attestationObject: string
  transports?: string[]
}

type SerializedCredential = {
  id: string
  rawId: string
  type: 'public-key'
  response: CredentialResponseJSON
}

export const usePasskey = () => {
  const { hubFetch, appId } = useHub()
  const { t } = useI18n()
  const auth = useAuth()

  const list = async (): Promise<PasskeyInfo[]> => {
    const res = await hubFetch<{ success: boolean, data: PasskeyInfo[] }>(
      `/api/v1/auth/passkey/list?appId=${encodeURIComponent(appId)}`
    )
    return res.data || []
  }

  const register = async (): Promise<PasskeyInfo> => {
    const user = auth.user.value
    if (!user) throw new Error('Not authenticated')

    const startRes = await hubFetch<{ success: boolean, data: RegisterStartResponse }>(
      '/api/v1/auth/passkey/register/start',
      {
        method: 'POST',
        body: { appId, username: user.email, displayName: user.name || user.email }
      }
    )
    const options = startRes.data

    const publicKey: PublicKeyCredentialCreationOptions = {
      challenge: b64urlToBuf(options.challenge),
      rp: options.rp,
      user: {
        id: b64urlToBuf(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation,
      authenticatorSelection: options.authenticatorSelection
    }

    const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null
    if (!credential) throw new Error(t('profile.passkeyCreateFailed'))

    const attResponse = credential.response as AuthenticatorAttestationResponse
    const serialized: SerializedCredential = {
      id: credential.id,
      rawId: bufToB64url(credential.rawId),
      type: 'public-key',
      response: {
        clientDataJSON: bufToB64url(attResponse.clientDataJSON),
        attestationObject: bufToB64url(attResponse.attestationObject),
        transports: typeof attResponse.getTransports === 'function' ? attResponse.getTransports() : undefined
      }
    }

    const finishRes = await hubFetch<{ success: boolean, data: PasskeyInfo }>(
      '/api/v1/auth/passkey/register/finish',
      { method: 'POST', body: { appId, credential: serialized } }
    )
    return finishRes.data
  }

  const remove = async (credentialId: string): Promise<void> => {
    await hubFetch(
      `/api/v1/auth/passkey/delete?appId=${encodeURIComponent(appId)}&credentialId=${encodeURIComponent(credentialId)}`,
      { method: 'DELETE' }
    )
  }

  return { list, register, remove }
}
