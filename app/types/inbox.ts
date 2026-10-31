export interface InboxItem {
  id: string
  threadId: string
  snippet: string
  labels: string[]
  subject: string
  from: string
  date: string | null
  unread: boolean
  starred: boolean
}

export interface InboxAttachment {
  id: string | null
  filename: string
  mimeType: string
  size: number
}

export interface InboxDetail extends InboxItem {
  to: string
  bodyHtml: string
  bodyText: string
  attachments: InboxAttachment[]
}

export interface InboxThread {
  id: string
  snippet: string
  messages: InboxDetail[]
}

export interface InboxProfile {
  connected: boolean
  email: string | null
  messagesTotal: number
  threadsTotal: number
}
