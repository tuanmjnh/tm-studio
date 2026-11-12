export class GoogleBaseClient {
  protected accessToken: string

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  protected async fetch<T>(url: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${this.accessToken}`)
    try {
      const response = await $fetch(url, { ...options, headers } as unknown as Parameters<typeof $fetch>[1])
      return response as T
    } catch (error) {
      const e = error as Error & { status?: number, body?: unknown }
      console.error('Google API Error:', e.message)
      throw e
    }
  }
}
