import {
  toSlug,
  toCode,
  toNormalize,
  generateEan13,
  minifySvg,
  escapeRegExp,
  sanitizeSvg,
  getImage,
  cleanImageUrl,
  isRawSvg,
  isIconify,
  isSpecialImage,
  isImage,
  detectDisplayType,
  ensureForwardSlash,
  readCsv,
  readJson,
  downloadFile,
  formatTimeAgo as coreFormatTimeAgo
} from '@tuanmjnh/tm-core'

export {
  toSlug,
  toCode,
  toNormalize,
  generateEan13,
  minifySvg,
  escapeRegExp,
  sanitizeSvg,
  getImage,
  cleanImageUrl,
  isRawSvg,
  isIconify,
  isSpecialImage,
  isImage,
  detectDisplayType,
  ensureForwardSlash,
  readCsv,
  readJson,
  downloadFile
} from '@tuanmjnh/tm-core'

/** An image source is either the URL string itself or an object carrying one. */
export type ImageLike = string | { url?: string, secure_url?: string, [key: string]: unknown }

export const removeById = <T extends object>(
  items: T[],
  id: string | number,
  key: keyof T = '_id' as keyof T
): T[] => {
  const index = items.findIndex(item => (item[key] as unknown) === id)
  if (index !== -1) {
    items.splice(index, 1)
  }
  return items
}

export const formatDate = (dateString?: string | number | Date | null) => {
  if (!dateString) return ''
  return new Date(dateString).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}
/**
* Basic date format
* @param date - Date object or ISO string
* @param style - 'date' | 'time' | 'full'
*/
export const formatDateStyle = (date: string | Date | number | undefined | null, style: 'date' | 'time' | 'full' = 'date'): string => {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''

  const { locale } = useI18n()
  // Map locale if needed, or use directly
  const currentLocale = locale.value === 'vi' ? 'en-VN' : 'en-US'

  const intlOptions: Intl.DateTimeFormatOptions = {}

  if (style === 'date') {
    intlOptions.day = '2-digit'
    intlOptions.month = '2-digit'
    intlOptions.year = 'numeric'
  } else if (style === 'time') {
    intlOptions.hour = '2-digit'
    intlOptions.minute = '2-digit'
  } else if (style === 'full') {
    intlOptions.day = '2-digit'
    intlOptions.month = '2-digit'
    intlOptions.year = 'numeric'
    intlOptions.hour = '2-digit'
    intlOptions.minute = '2-digit'
  }

  return new Intl.DateTimeFormat(currentLocale, intlOptions).format(d)
}

/**
* (Bonus) Format relative time (e.g. 5 minutes ago)
* Note: For perfect accuracy, you need a library like dayjs,
* this is the lightest Native JS version.
*/
export const formatTimeAgo = (date: string | Date | number | undefined | null) => {
  const { locale } = useI18n()
  return coreFormatTimeAgo(date, locale.value)
}

export const formatNumber = (value: number | string | undefined | null, intlOptions?: Intl.NumberFormatOptions): string => {
  if (value === undefined || value === null || value === '') return '0'

  const num = Number(value)
  if (isNaN(num)) return '0'

  // Default Vietnamese (vi-VN), you can change to 'en-US' if you want commas
  return new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 2, // Maximum 2 odd numbers
    ...intlOptions
  }).format(num)
}

/**
* Currency format (eg: 100000 -> 100.000 VND)
*/
export const formatCurrency = (value: number | string | undefined | null, currency = 'VND'): string => {
  if (value === undefined || value === null || value === '') return '0 VND'

  const num = Number(value)
  if (isNaN(num)) return '0 ₫'

  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0 // VND usually does not use odd numbers
  }).format(num)
}

/**
 * Get random integer between min and max (inclusive)
 */
export const getRandomInteger = (min: number, max: number) => {
  min = Math.ceil(min)
  max = Math.floor(max)
  // The maximum is inclusive and the minimum is inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
* Shortened format for large numbers (eg: 1,200,000 -> 1.2M or 1.2 million)
*/
export const formatCompactNumber = (value: number | string | undefined | null) => {
  const num = Number(value || 0)

  return new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1
  }).format(num)
}



/**
 * Generate a slug from a localized title, with optional parent prefix.
 * @param title - Localized title object
 * @param code - Current locale code
 * @param parentId - Parent ID (pid)
 * @param categories - List of all categories to find the parent
 * @returns The generated slug string
 */
export const generateSlug = (
  title: Record<string, string>,
  code: string,
  parentId?: string | null,
  categories?: Record<string, unknown>[]
): string => {
  if (!title || !title[code]) return ''

  let slugValue = toSlug(title[code])

  if (parentId && categories) {
    const parent = categories.find(c => c._id === parentId) as { slug?: Record<string, string> } | undefined
    if (parent && parent.slug?.[code]) {
      slugValue = `${parent.slug[code]}-${slugValue}`
    }
  }

  return slugValue
}



/**
 * Unified Quick Sync function to synchronize both Images and SEO data.
 *
 * @param formData - The target object containing all fields (title, description, seo, banner, gallery, etc.)
 * @param options - Unified quick sync options { images: { banner, gallery }, seo: { title, description, image }, force }
 * @param sourceImage - Optional: The specific image object to sync (usually the primary thumbnail/avatar)
 */
export const syncQuickData = (
  formData: Record<string, unknown>,
  options: Record<string, unknown>,
  sourceImage?: ImageLike
) => {
  if (!formData || !options) return

  const images = (options.images ?? {}) as Record<string, boolean>
  const seo = (options.seo ?? {}) as Record<string, boolean>
  const force = Boolean(options.force ?? false)
  const imageUrl = sourceImage
    ? getImage(sourceImage)
    : getImage((formData.thumbnail || formData.avatar || formData.image) as ImageLike | undefined)

  // 1. Sync Images (Banner, Gallery)
  if (sourceImage) {
    if (images.banner) {
      if (force || !formData.banner) formData.banner = sourceImage
    }

    if (images.gallery) {
      const gallery = Array.isArray(formData.gallery)
        ? formData.gallery as ImageLike[]
        : formData.gallery ? [formData.gallery as ImageLike] : []
      formData.gallery = gallery
      const isExist = gallery.some(img => getImage(img) === imageUrl)
      if (!isExist) formData.gallery = [...gallery, sourceImage]
    }
  }

  // 2. Sync SEO
  if (formData.seo === undefined || formData.seo === null) formData.seo = {}
  const seoFields = formData.seo as Record<string, unknown>

  // Helper to check if a localized object is effectively empty
  const isLocalyEmpty = (val: unknown) => {
    if (!val) return true
    if (typeof val !== 'object') return !val
    return Object.values(val).every(v => !v)
  }

  // SEO Title
  if (seo.title && formData.title) {
    if (force || isLocalyEmpty(seoFields.title)) {
      const sourceStr = JSON.stringify(formData.title || {})
      const targetStr = JSON.stringify(seoFields.title || {})
      if (force || sourceStr !== targetStr) {
        seoFields.title = JSON.parse(sourceStr)
      }
    }
  }

  // SEO Description
  if (seo.description) {
    // Priority: shortDesc (Product) -> excerpt (Post/Page) -> content/description (Main body)
    const descSource = formData.shortDesc || formData.excerpt || formData.description || formData.content
    if (descSource && (force || isLocalyEmpty(seoFields.description))) {
      const sourceStr = JSON.stringify(descSource || {})
      const targetStr = JSON.stringify(seoFields.description || {})
      if (force || sourceStr !== targetStr) {
        seoFields.description = JSON.parse(sourceStr)
      }
    }
  }

  // SEO Image (Always sync from either specific sourceImage or fallback to main thumbnail)
  if (seo.image && imageUrl && imageUrl !== '/placeholder.png') {
    if (force || seoFields.image !== imageUrl) {
      seoFields.image = imageUrl
    }
  }
}

/**
 * Synchronize primary thumbnail/avatar to other fields (banner, gallery, seo)
 * based on user quick-sync options.
 *
 * @param formData - The target object containing image fields
 * @param sourceImage - The selected source image (object or string)
 * @param options - Quick sync options { banner, gallery, seo, force }
 * @deprecated Use syncQuickData instead
 */
export const syncQuickImages = (formData: Record<string, unknown>, sourceImage: ImageLike, options: Record<string, boolean>) => {
  // Map old options to new syncQuickData structure
  const mappedOptions = {
    images: { banner: options.banner, gallery: options.gallery },
    seo: { image: options.seo },
    force: options.force
  }
  syncQuickData(formData, mappedOptions, sourceImage)
}

/**
 * Synchronize SEO data (title, description, image) from main form fields
 * based on user quick-sync options.
 *
 * @param formData - The target object containing main fields and 'seo' object
 * @param options - Quick sync options { title, description, image, force }
 * @deprecated Use syncQuickData instead
 */
export const syncQuickSeo = (formData: Record<string, unknown>, options: Record<string, boolean>) => {
  // Map old options to new syncQuickData structure
  const mappedOptions = {
    seo: { title: options.title, description: options.description, image: options.image },
    force: options.force
  }
  syncQuickData(formData, mappedOptions)
}

/**
 * Remove width/height attributes from the root <svg> tag
 * to prevent browser errors and allow CSS control.
 */


// Helper: 'vi' → '🇻🇳', 'en' → '🇺🇸'
export const getFlagEmoji = (code: string) => {
  // Take the first two characters of the locale code as the country code.
  const country = code.split('-').pop()?.toUpperCase() ?? code.slice(0, 2).toUpperCase()
  return [...country].map(c => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))).join('')
}

export const getFaviconHref = (val?: string) => {
  if (!val) return '/favicon.ico'

  const trimmed = val.trim()
  if (trimmed.startsWith('<svg')) {
    try {
      // Safer base64 encoding (isomorphic)
      const base64 = (typeof Buffer !== 'undefined')
        ? Buffer.from(trimmed).toString('base64')
        : btoa(unescape(encodeURIComponent(trimmed)))
      return `data:image/svg+xml;base64,${base64}`
    } catch (e) {
      console.error('Favicon SVG encoding error:', e)
      return '/favicon.ico'
    }
  }
  return val
}

/**
 * Format image source for SEO / Meta tags.
 * Handles: URLs, Localized objects, and Raw SVG strings.
 * If siteUrl is provided, it ensures relative paths become absolute.
 */
export const formatImageUrl = (img: ImageLike | undefined, siteUrl?: string) => {
  if (!img) return undefined
  let url = ''

  // Support IFileAttach object or localized string
  if (typeof img === 'object') {
    url = img.url || ''
  } else if (typeof img === 'string') {
    url = img.trim()
  }

  if (!url) return undefined

  // Handle Raw SVG by converting to Data URI
  if (url.startsWith('<svg')) {
    try {
      const base64 = (typeof Buffer !== 'undefined')
        ? Buffer.from(url).toString('base64')
        : btoa(unescape(encodeURIComponent(url)))
      return `data:image/svg+xml;base64,${base64}`
    } catch (e) {
      console.error('SVG encoding error:', e)
      return undefined
    }
  }

  // Ensure absolute URL for SEO
  if (siteUrl && url.startsWith('/') && !url.startsWith('//')) {
    return `${siteUrl.replace(/\/$/, '')}${url}`
  }

  return url
}

/**
 * Clean image URL from restrictive query parameters (w, h, fit, crop)
 * especially for Unsplash, Cloudinary, etc. to allow IPX to resize from high-res source.
 */


/**
 * Get image URL from string or object
 */


/**
 * Format image based on storage mode (URL string or Full Object)
 */
export const formatImage = (img: ImageLike | null | undefined, mode: 'string' | 'object' = 'string') => {
  if (!img) return null
  if (mode === 'string') {
    return typeof img === 'string' ? img : (img.url || img.secure_url || img)
  }
  return img
}

/**
 * Generate canonical URL
 */
export const getCanonicalUrl = (siteUrl: string, currentPath: string) => {
  const p = currentPath === '/' ? '' : currentPath
  const baseUrl = (siteUrl || '').replace(/\/$/, '')
  return `${baseUrl}${p}`
}

/**
 * Generate alternate language links (hreflang)
 */
export const getAlternateLinks = (
  siteUrl: string,
  currentPath: string,
  locales: { code: string, iso?: string }[]
) => {
  const baseUrl = (siteUrl || '').replace(/\/$/, '')
  const links = locales.map((l) => {
    // Basic logic for alternate links, Adjust based on i18n strategy (prefix_except_default)
    const localePath = currentPath.startsWith(`/${l.code}/`) || currentPath === `/${l.code}`
      ? currentPath
      : (l.code === 'vi' ? currentPath : `/${l.code}${currentPath}`)

    return {
      rel: 'alternate',
      hreflang: l.iso || l.code,
      href: `${baseUrl}${localePath}`
    }
  })

  // Add x-default link (usually the same as default/neutral locale)
  links.push({
    rel: 'alternate',
    hreflang: 'x-default',
    href: `${baseUrl}${currentPath}`
  })

  return links
}









/**
 * Detect asset type for display
 * @param val The source string (URL, Icon mapping, or Raw SVG)
 * @returns 'svg' | 'image' | 'icon'
 */








/**
 * Calculate fullPath for a specific language based on urlMode strategy
 */
export const calculateLocalizedPath = (pathOptions: {
  slug: string
  type?: string
  urlMode?: 'flat' | 'prefix' | 'category'
  parentPath?: string
}) => {
  const { slug, type, urlMode = 'category', parentPath } = pathOptions
  if (!slug) return ''

  if (urlMode === 'flat') return slug
  if (urlMode === 'prefix' && type) return `${type}/${slug}`
  if (urlMode === 'category' && parentPath) return `${parentPath}/${slug}`

  return slug
}

/**
 * Escapes a string for use in a regular expression.
 */


/**
 * Escapes a string for use in a regular expression.
 */
export const escapeNormalize = (string: string) => {
  return escapeRegExp(toNormalize(string))
}



export const generateCode = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

/**
 * Export data to CSV file
 * @param filename - Name of the file (without extension)
 * @param headers - Array of header strings
 * @param rows - Array of arrays containing data
 */
export const exportToCsv = (filename: string, headers: string[], rows: (string | number | null | undefined)[][]) => {
  const escapeCsv = (val: unknown) => {
    const str = String(val ?? '')
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str
  }

  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map(row => row.map(escapeCsv).join(','))
  ].join('\n')

  // Add UTF-8 BOM for Unicode support (Excel etc)
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.csv`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Export data to JSON file
 * @param filename - Name of the file (without extension)
 * @param data - The data object or array to export
 */
export const exportToJson = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.json`)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Parse CSV string to array of objects
 * @param csvText - The CSV string content
 * @returns Array of objects with keys from header row
 */




/**
 * Parse JSON text and ensure it's an array for import processing
 * @param jsonText - The raw JSON string
 */


/**
 * Format phone number (eg: 0987654321 -> 0987 654 321)
 */
export const formatPhoneNumber = (phone?: string | number | null) => {
  if (!phone) return '-'
  const s = String(phone).replace(/\D/g, '')
  if (s.length === 10) {
    return s.replace(/(\d{3,4})(\d{3})(\d{3,4})/, '$1 $2 $3')
  }
  return s
}

/**
 * Extract YouTube video ID from URL
 */
export const getYoutubeId = (url: string) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
  const match = url.match(regExp)
  return (match && match[2]?.length === 11) ? match[2] : null
}

/**
 * Get YouTube embed URL
 */
export const getYoutubeEmbedUrl = (url: string) => {
  const id = getYoutubeId(url)
  return id ? `https://www.youtube.com/embed/${id}` : ''
}

/**
 * Extract Vimeo video ID from URL
 */
export const getVimeoId = (url: string) => {
  const match = url.match(/(?:www\.|player\.)?vimeo.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)(?:[a-zA-Z0-9_-]+)?/)
  return match ? match[1] : null
}

/**
 * Get Vimeo embed URL
 */
export const getVimeoEmbedUrl = (url: string) => {
  const id = getVimeoId(url)
  return id ? `https://player.vimeo.com/video/${id}` : ''
}

/**
 * Extract Facebook video ID from URL
 */
export const getFacebookId = (url: string) => {
  const match = url.match(/(?:facebook\.com\/(?:video\.php\?v=|watch\/\?v=|watch\/)|fb\.watch\/)([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

/**
 * Get Facebook embed URL
 */
export const getFacebookEmbedUrl = (url: string) => {
  const id = getFacebookId(url)
  return id ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0` : ''
}

/**
 * Get SoundCloud embed URL
 */
export const getSoundCloudEmbedUrl = (url: string) => {
  if (!url.includes('soundcloud.com')) return ''
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true`
}

/**
 * Extract TikTok video ID from URL
 */
export const getTiktokId = (url: string) => {
  const match = url.match(/tiktok\.com\/.*\/video\/(\d+)/)
  return match ? match[1] : null
}

/**
 * Get TikTok embed URL
 */
export const getTiktokEmbedUrl = (url: string) => {
  const id = getTiktokId(url)
  return id ? `https://www.tiktok.com/embed/v2/${id}` : ''
}

/**
 * Extract DailyMotion video ID from URL
 */
export const getDailyMotionId = (url: string) => {
  const match = url.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

/**
 * Get DailyMotion embed URL
 */
export const getDailyMotionEmbedUrl = (url: string) => {
  const id = getDailyMotionId(url)
  return id ? `https://www.dailymotion.com/embed/video/${id}` : ''
}
/**
 * Download a file from a URL or raw string content (e.g. SVG)
 */

/**
 * Convert image objects { url, public_id, ... } to plain image URL strings for specific keys.
 * Useful for normalizing data before sending to server or saving to database when in string mode.
 *
 * @param data - The object to process
 * @param mode - The storage mode ('string' | 'object')
 * @param customKeys - Optional list of keys to target (default: common image field names)
 */
export const ObjectToImageString = (
  data: unknown,
  mode: 'string' | 'object' = 'string',
  customKeys?: string[]
): unknown => {
  if (!data || typeof data !== 'object' || mode === 'object') return data

  const targetKeys = customKeys || ['avatar', 'image', 'thumb', 'thumbnail', 'logo', 'favicon', 'icon', 'banner', 'url', 'qrCode']

  if (Array.isArray(data)) {
    return data.map(item => ObjectToImageString(item, mode, targetKeys))
  }

  const result = { ...data } as Record<string, unknown>

  for (const key in result) {
    const value = result[key]
    if (value && typeof value === 'object') {
      // If the key is in our target list and the value looks like an image object (has url), flatten it
      // We check for 'url' existence as the primary indicator
      if (targetKeys.includes(key.toLowerCase()) && typeof (value as { url?: unknown }).url === 'string') {
        result[key] = (value as { url: string }).url
      } else {
        // Otherwise, recurse deeper
        result[key] = ObjectToImageString(value, mode, targetKeys)
      }
    }
  }

  return result
}

/**
 * Get display price and base price for a product (simple or variable)
 * Optimized version: single pass loop, no spread operator, better fallbacks.
 */
export const getItemDisplayPrice = (item: {
  type?: string
  salePrice?: number
  basePrice?: number
  variants?: { salePrice?: number, basePrice?: number }[]
} | null | undefined) => {
  if (!item) return { price: 0, basePrice: 0 }

  // Simple product or no variants
  if (item.type !== 'variable' || !item.variants?.length) {
    return {
      price: item.salePrice || item.basePrice || 0,
      basePrice: item.basePrice || 0
    }
  }

  // Variable product: find min in one pass
  let minPrice = item.salePrice || item.basePrice || Infinity
  let minBasePrice = item.basePrice || Infinity

  for (let i = 0; i < item.variants.length; i++) {
    const v = item.variants[i]
    if (!v) continue

    const currentPrice = v.salePrice || v.basePrice || 0
    const basePrice = v.basePrice || 0

    // Update minPrice if variant price is valid and smaller
    if (currentPrice > 0 && currentPrice < minPrice) {
      minPrice = currentPrice
    }

    // Update minBasePrice if variant basePrice is valid and smaller
    if (basePrice > 0 && basePrice < minBasePrice) {
      minBasePrice = basePrice
    }
  }

  return {
    price: minPrice === Infinity ? 0 : minPrice,
    basePrice: minBasePrice === Infinity ? 0 : minBasePrice
  }
}
