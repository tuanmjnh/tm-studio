export { }

declare global {
  namespace Cloudinary {
    /**
     * Interface for the object containing information about the last update time of the resource.
     */
    interface ILastUpdated {
      /** The time the public_id was last updated (UTC) */
      public_id_updated_at: string
      /** The general time the resource was last updated (UTC) */
      updated_at: string
    }

    /**
     * Response from signature endpoint
     */
    interface IResponseSignature {
      message?: string
      status?: boolean
      timestamp: number
      signature: string
      cloudName: string
      apiKey: string
      preset: string
      folder?: string
    }

    /**
     * Folder structure in Cloudinary
     */
    interface IFolder {
      /** The name of the folder (last part of the path) */
      name: string
      /** The full path of the folder, relative to the root or parent folder */
      path: string
      /** An optional external ID for tracking purposes (may be null/undefined if not set) */
      external_id: string | null
      /** Child folders */
      children?: IFolder[]
      /** Whether this folder has children */
      hasChildren?: boolean
      /** Whether children have been loaded */
      childrenLoaded?: boolean
    }

    /**
     * Response from folder listing endpoint
     */
    interface IResponseFolder {
      /** An array of folder objects found on the current page */
      folders: IFolder[]
      /** Cursor for fetching the next page of results (pagination) */
      next_cursor: string | null
      /** The total number of API calls allowed in the current rate limit window */
      rate_limit_allowed: number
      /** The number of API calls remaining in the current rate limit window */
      rate_limit_remaining: number
      /** The time (UTC) when the rate limit will reset to the full allowed amount */
      rate_limit_reset_at: string
      /** The total number of folders returned in the current scope */
      total_count: number
    }

    /**
     * Simplified folder response
     */
    interface IResponseFolders {
      parent: string | null
      folders: IFolder[]
    }

    /**
     * Resource object returned from the Cloudinary Admin API
     * Represents an uploaded file (image, video, raw)
     */
    interface IResource {
      /** The folder where the file is stored in Cloudinary */
      asset_folder?: string
      /** The unique asset ID in Cloudinary */
      asset_id?: string
      /** File size in bytes */
      bytes: number
      /** The creation (upload) time of the file (ISO 8601 format) */
      created_at: string
      /** Display name (usually the original filename) */
      display_name?: string
      /** File format (e.g., "png", "jpg", "mp4") */
      format: string
      /** Height of the resource (if image/video) */
      height?: number
      /** Detailed information about the last update time */
      last_updated?: ILastUpdated
      /** The public ID, used to access and transform the file */
      public_id: string
      /** The type of resource (e.g., "image", "video", "raw") */
      resource_type: 'image' | 'video' | 'raw' | string
      /** The secure URL (HTTPS) for accessing the resource */
      secure_url: string
      /** The type of upload (usually "upload") */
      type: string
      /** The non-secure URL (HTTP) for accessing the resource */
      url: string
      /** The version of the file (often a timestamp) */
      version?: number
      /** Width of the resource (if image/video) */
      width?: number
      /** Optional folder path */
      folder?: string
      /** Optional thumbnail URL */
      thumbnail_url?: string
    }

    /**
     * Response from asset/resource listing endpoint
     */
    interface IResponseAsset {
      /** Cursor for fetching the next page of results (pagination) */
      next_cursor?: string
      /** The total number of API calls allowed in the current rate limit window */
      rate_limit_allowed: number
      /** The number of API calls remaining in the current rate limit window */
      rate_limit_remaining: number
      /** The time (UTC) when the rate limit will reset to the full allowed amount */
      rate_limit_reset_at: string
      /** An array of Cloudinary resource objects found on the current page */
      resources: IResource[]
    }

    /**
     * Upload response from Cloudinary
     */
    interface UploadedResponse {
      public_id: string
      url: string
      thumbnail_url?: string
      secure_url: string
      resource_type: string
      format: string
      width: number
      height: number
      bytes: number
      created_at?: string
      version?: number
      original_filename?: string
    }

    /**
     * Simplified file attachment interface for storing in database
     */
    interface IFileAttach {
      public_id?: string | null
      display_name?: string | null
      url?: string | null
      thumbnail_url?: string | null
      secure_url?: string | null
      format?: string | null
      bytes?: number | null
      width?: number | null
      height?: number | null
      created_at?: number | string
    }
  }
}
