import { GoogleBaseClient } from './base'
import { type IGoogleFile, MIME_TYPES } from './types'

export class GoogleDriveClient extends GoogleBaseClient {
  async getFiles(query: string = '', fields: string = '*'): Promise<IGoogleFile[]> {
    const q = query ? `&q=${encodeURIComponent(query)}` : ''
    const data = await this.fetch<{ files: IGoogleFile[] }>(
      `https://www.googleapis.com/drive/v3/files?fields=files(${fields})${q}`
    )
    return data.files || []
  }

  async getFolders(parentId: string = 'root'): Promise<IGoogleFile[]> {
    const query = `'${parentId}' in parents and mimeType = '${MIME_TYPES.folder}' and trashed = false`
    return this.getFiles(query, 'id, name, mimeType, parents')
  }

  async searchFiles(term: string, mimeType?: string): Promise<IGoogleFile[]> {
    let query = `name contains '${term}' and trashed = false`
    if (mimeType) {
      query += ` and mimeType = '${mimeType}'`
    }
    return this.getFiles(query, 'id, name, mimeType, thumbnailLink')
  }

  async createFolder(name: string, parentId: string = 'root'): Promise<IGoogleFile> {
    const body = {
      name,
      mimeType: MIME_TYPES.folder,
      parents: [parentId]
    }
    return this.fetch<IGoogleFile>(
      'https://www.googleapis.com/drive/v3/files',
      {
        method: 'POST',
        body: JSON.stringify(body)
      }
    )
  }

  async uploadFile(file: File, parentId: string = 'root'): Promise<IGoogleFile> {
    const metadata = {
      name: file.name,
      mimeType: file.type,
      parents: [parentId]
    }

    const formData = new FormData()
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
    formData.append('file', file)

    // Using the upload endpoint through base fetch
    return this.fetch<IGoogleFile>(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,thumbnailLink',
      {
        method: 'POST',
        body: formData
      }
    )
  }
}
