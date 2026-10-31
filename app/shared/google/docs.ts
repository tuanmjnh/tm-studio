import { GoogleBaseClient } from './base'
import { type IGoogleFile, MIME_TYPES } from './types'

export class GoogleDocsClient extends GoogleBaseClient {
  // Placeholder for Docs specific API interactions
  // e.g., https://docs.googleapis.com/v1/documents/{documentId}

  async getList(parentId: string = 'root'): Promise<IGoogleFile[]> {
    const query = `'${parentId}' in parents and mimeType = '${MIME_TYPES.document}' and trashed = false`
    const q = `q=${encodeURIComponent(query)}`
    const data = await this.fetch<{ files: IGoogleFile[] }>(
      `https://www.googleapis.com/drive/v3/files?fields=files(id, name, mimeType, thumbnailLink, modifiedTime)&${q}`
    )
    return data.files || []
  }

  async getDocument(documentId: string): Promise<any> {
    return this.fetch<any>(
      `https://docs.googleapis.com/v1/documents/${documentId}`
    )
  }
}
