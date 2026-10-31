export class GoogleBaseClient {
  protected accessToken: string

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  protected async fetch<T>(url: string, options: any = {}): Promise<T> {
    try {
      // @ts-ignore
      return await $fetch<T>(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${this.accessToken}`
        }
      })
    } catch (error: any) {
      console.error('Google API Error:', error)
      throw error
    }
  }
}
