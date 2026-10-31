export const useCloudinary = () => {
  const { hubFetch, appId, media } = useHub()

  /**
   * Get signature for Cloudinary upload
   */
  const getSignature = async (folder?: string): Promise<Cloudinary.IResponseSignature> => {
    const res = await media.getSignature(folder ? { folder } : undefined)
    return (res.data || res) as Cloudinary.IResponseSignature
  }

  /**
   * Upload file directly to Cloudinary
   */
  const uploadToCloudinary = async (
    file: File,
    folder?: string,
    onProgress?: (progress: number) => void
  ): Promise<Cloudinary.UploadedResponse> => {
    const folderName = folder?.toLowerCase() === 'root' ? undefined : folder
    const signatureData = await getSignature(folderName)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('api_key', signatureData.apiKey)
    formData.append('timestamp', String(signatureData.timestamp))
    formData.append('signature', signatureData.signature)
    if (signatureData.preset) formData.append('upload_preset', signatureData.preset)
    if (folderName) formData.append('folder', folderName)

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100)
            onProgress(progress)
          }
        })
      }

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`))
        }
      })

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'))
      })

      xhr.open('POST', `https://api.cloudinary.com/v1_1/${signatureData.cloudName}/auto/upload`)
      xhr.send(formData)
    })
  }

  /**
   * Get optimized image URL from Cloudinary
   */
  const getOptimizedUrl = (
    publicId: string,
    options: {
      width?: number
      height?: number
      crop?: 'fill' | 'fit' | 'scale' | 'crop' | 'thumb'
      quality?: number | 'auto'
      format?: 'auto' | 'jpg' | 'png' | 'webp'
    } = {}
  ): string => {
    const { cloudinary } = useRuntimeConfig().public as unknown as { cloudinary?: { cloudName?: string } }
    const cloudName = cloudinary?.cloudName || ''

    const transformations: string[] = []

    if (options.width) transformations.push(`w_${options.width}`)
    if (options.height) transformations.push(`h_${options.height}`)
    if (options.crop) transformations.push(`c_${options.crop}`)
    if (options.quality) transformations.push(`q_${options.quality}`)
    if (options.format) transformations.push(`f_${options.format}`)

    const transform = transformations.length > 0 ? `${transformations.join(',')}/` : ''

    return `https://res.cloudinary.com/${cloudName}/image/upload/${transform}${publicId}`
  }

  /**
   * Get video thumbnail URL
   */
  const getVideoThumbnail = (publicId: string, options: { width?: number, height?: number } = {}): string => {
    const { cloudinary } = useRuntimeConfig().public as unknown as { cloudinary?: { cloudName?: string } }
    const cloudName = cloudinary?.cloudName || ''

    const transformations: string[] = ['so_0']

    if (options.width) transformations.push(`w_${options.width}`)
    if (options.height) transformations.push(`h_${options.height}`)

    const transform = transformations.join(',')

    return `https://res.cloudinary.com/${cloudName}/video/upload/${transform}/${publicId}.jpg`
  }

  /**
   * List folders from Cloudinary via TM-Hub
   */
  const listFolders = async (folder: string = 'root'): Promise<Cloudinary.IResponseFolders> => {
    const res = await media.getFolders(folder)
    const data = res.data as Cloudinary.IResponseFolders | Cloudinary.IFolder[] | undefined
    if (data && 'folders' in data) return data
    if (Array.isArray(data)) return { parent: folder, folders: data }
    return (res as unknown as Cloudinary.IResponseFolders) || { parent: folder, folders: [] }
  }

  /**
   * List files from Cloudinary via TM-Hub
   */
  const listFiles = async (folder: string = 'root', options: { max_results?: number, next_cursor?: string } = {}): Promise<Cloudinary.IResponseAsset> => {
    const res = await media.getResources({ folder, ...options })
    const data = (res.data ?? res) as unknown as Cloudinary.IResponseAsset | undefined
    if (data && 'resources' in data) return data
    return { resources: [], rate_limit_allowed: 0, rate_limit_remaining: 0, rate_limit_reset_at: '' }
  }

  /**
   * Create a new folder via TM-Hub
   */
  const createFolder = async (path: string) => {
    return await media.createFolder(path)
  }

  /**
   * Delete a folder via TM-Hub
   */
  const deleteFolder = async (path: string) => {
    return await media.deleteFolder(path)
  }

  /**
   * Delete a file via TM-Hub
   */
  const deleteFile = async (publicId: string) => {
    return await media.deleteResources([publicId])
  }

  /**
   * Rename a file via TM-Hub
   */
  const renameFile = async (from: string, to: string): Promise<{ success: boolean, message: string }> => {
    const res = await media.renameResource(from, to)
    return { success: !!res.success, message: res.message || 'Resource renamed' }
  }

  /**
   * Get Media & Cloudinary Config Status from TM-Hub
   */
  const fetchConfig = async () => {
    try {
      const res = await hubFetch<{ success: boolean, data: { values: Record<string, string> } }>(
        `/api/v1/apps/${appId}/configs/public`
      )
      const values = res.data?.values || {}
      const cloudName = values['CLOUDINARY_CLOUD_NAME'] || ''
      const uploadPreset = values['CLOUDINARY_UPLOAD_PRESET'] || ''
      return {
        success: true,
        data: {
          cloudinary: {
            connected: !!cloudName,
            cloudName,
            uploadPreset,
            folder: 'tm-tools'
          }
        }
      }
    } catch {
      return {
        success: false,
        data: {
          cloudinary: {
            connected: false,
            cloudName: '',
            uploadPreset: '',
            folder: ''
          }
        }
      }
    }
  }

  return {
    fetchConfig,
    getSignature,
    uploadToCloudinary,
    getOptimizedUrl,
    getVideoThumbnail,
    listFolders,
    listFiles,
    createFolder,
    deleteFolder,
    deleteFile,
    renameFile
  }
}
