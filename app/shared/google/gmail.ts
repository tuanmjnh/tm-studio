import { GoogleBaseClient } from './base'

export interface IGmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  payload?: any
  sizeEstimate?: number
  historyId?: string
  internalDate?: string
}

export interface IGmailProfile {
  emailAddress: string
  messagesTotal: number
  threadsTotal: number
  historyId: string
}

export interface IGmailThread {
  id: string
  snippet: string
  historyId: string
  messages?: IGmailMessage[]
}

export class GoogleGmailClient extends GoogleBaseClient {
  async getProfile(userId: string = 'me'): Promise<IGmailProfile> {
    return this.fetch<IGmailProfile>(
      `https://gmail.googleapis.com/gmail/v1/users/${userId}/profile`
    )
  }

  // --- Messages ---
  async listMessages(userId: string = 'me', options: { query?: string, maxResults?: number, pageToken?: string } = {}): Promise<{ messages: IGmailMessage[], nextPageToken?: string }> {
    const { query = '', maxResults = 20, pageToken = '' } = options
    const q = query ? `&q=${encodeURIComponent(query)}` : ''
    const pt = pageToken ? `&pageToken=${pageToken}` : ''
    const data = await this.fetch<{ messages: IGmailMessage[], nextPageToken?: string }>(
      `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages?maxResults=${maxResults}${q}${pt}`
    )
    return {
      messages: data.messages || [],
      nextPageToken: data.nextPageToken
    }
  }

  async getMessage(id: string, userId: string = 'me', format: 'full' | 'minimal' | 'raw' = 'full'): Promise<IGmailMessage> {
    return this.fetch<IGmailMessage>(
      `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${id}?format=${format}`
    )
  }

  // --- Threads ---
  async listThreads(userId: string = 'me', options: { query?: string, maxResults?: number, pageToken?: string } = {}): Promise<{ threads: IGmailThread[], nextPageToken?: string }> {
    const { query = '', maxResults = 20, pageToken = '' } = options
    const q = query ? `&q=${encodeURIComponent(query)}` : ''
    const pt = pageToken ? `&pageToken=${pageToken}` : ''
    const data = await this.fetch<{ threads: IGmailThread[], nextPageToken?: string }>(
      `https://gmail.googleapis.com/gmail/v1/users/${userId}/threads?maxResults=${maxResults}${q}${pt}`
    )
    return {
      threads: data.threads || [],
      nextPageToken: data.nextPageToken
    }
  }

  async getThread(id: string, userId: string = 'me'): Promise<IGmailThread> {
    return this.fetch<IGmailThread>(
      `https://gmail.googleapis.com/gmail/v1/users/${userId}/threads/${id}`
    )
  }

  // --- Sending ---
  /**
   * Send a simple HTML email
   */
  async sendEmail(options: { to: string, from?: string, subject: string, body: string, threadId?: string }, userId: string = 'me'): Promise<IGmailMessage> {
    const headers: string[] = [
      `To: ${options.to}`
    ]

    if (options.from) {
      headers.push(`From: ${options.from}`)
    }

    headers.push(
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${options.subject}`,
      '',
      options.body
    )

    const email = headers.join('\r\n')

    // URL-safe Base64 encoding
    const encodedEmail = btoa(unescape(encodeURIComponent(email)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    return this.sendMessage(encodedEmail, options.threadId, userId)
  }

  async sendMessage(rawBase64: string, threadId?: string, userId: string = 'me'): Promise<IGmailMessage> {
    const body: any = { raw: rawBase64 }
    if (threadId) body.threadId = threadId

    return this.fetch<IGmailMessage>(
      `https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/send`,
      {
        method: 'POST',
        body: JSON.stringify(body)
      }
    )
  }
}
