export interface IGoogleFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  thumbnailLink?: string
  webViewLink?: string
  iconLink?: string
  modifiedTime?: string
  size?: string
  capabilities?: {
    canEdit: boolean
    canShare: boolean
  }
  // UI helpers
  src?: string
  children?: IGoogleFile[]
}

export interface IGoogleSheet {
  spreadsheetId: string
  properties: {
    title: string
    locale: string
    [key: string]: any
  }
  sheets: {
    properties: {
      sheetId: number
      title: string
      index: number
      [key: string]: any
    }
  }[]
}

export interface IGoogleSheetValues {
  range: string
  majorDimension: string
  values: any[][]
}

export const MIME_TYPES = {
  folder: 'application/vnd.google-apps.folder',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  document: 'application/vnd.google-apps.document',
  unknown: 'application/vnd.google-apps.unknown'
}
