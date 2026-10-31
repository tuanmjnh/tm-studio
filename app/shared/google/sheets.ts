import { GoogleBaseClient } from './base'
import { type IGoogleFile, type IGoogleSheet, type IGoogleSheetValues, MIME_TYPES } from './types'

export class GoogleSheetsClient extends GoogleBaseClient {
  async getList(parentId: string = 'root'): Promise<IGoogleFile[]> {
    // We can use the drive API to list sheets, but wrapped here for convenience
    // This requires that the token has drive.readonly or drive scope.
    const query = `'${parentId}' in parents and mimeType = '${MIME_TYPES.spreadsheet}' and trashed = false`
    // We'll reimplement getFiles logic here or we can rely on composing these classes.
    // For simplicity, I'll essentially duplicate the simple fetch or simple Drive call logic
    // BUT since we are splitting them, this class strictly speaking shouldn't depend on DriveClient unless we pass it in.
    // Let's implement independent fetch for list to avoid circular dependencies or complex composition for now.

    // However, listing files IS a Drive API feature, so it might be better to just leave listing to DriveClient.
    // The user asked for "google folder, with sheets, docs, drive".
    // Usually "SheetsClient" is for manipulating sheets content.
    // Listing spreadsheets is technically a Drive operation.
    // I will include a helper here just in case, duplicating the logic slightly or referencing Drive API is fine.

    const q = `q=${encodeURIComponent(query)}`
    const data = await this.fetch<{ files: IGoogleFile[] }>(
      `https://www.googleapis.com/drive/v3/files?fields=files(id, name, mimeType, thumbnailLink, modifiedTime)&${q}`
    )
    return data.files || []
  }

  async getSpreadsheet(spreadsheetId: string): Promise<IGoogleSheet> {
    return this.fetch<IGoogleSheet>(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`
    )
  }

  async getValues(spreadsheetId: string, range: string): Promise<IGoogleSheetValues> {
    return this.fetch<IGoogleSheetValues>(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`
    )
  }
}
