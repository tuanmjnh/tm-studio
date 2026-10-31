import { GoogleDriveClient } from './drive'
import { GoogleSheetsClient } from './sheets'
import { GoogleDocsClient } from './docs'
import { GoogleGmailClient } from './gmail'

export class GoogleClient {
  public drive: GoogleDriveClient
  public sheets: GoogleSheetsClient
  public docs: GoogleDocsClient
  public gmail: GoogleGmailClient

  constructor(accessToken: string) {
    this.drive = new GoogleDriveClient(accessToken)
    this.sheets = new GoogleSheetsClient(accessToken)
    this.docs = new GoogleDocsClient(accessToken)
    this.gmail = new GoogleGmailClient(accessToken)
  }
}
