export interface TextStats {
  chars: number
  charsNoSpaces: number
  words: number
  lines: number
  paragraphs: number
  readingTimeMinutes: number
}

export function useTextTransform() {
  const toUpperCase = (text: string) => text.toUpperCase()
  const toLowerCase = (text: string) => text.toLowerCase()

  const toCapitalize = (text: string) => {
    return text.replace(/\b\w+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  }

  const toSentenceCase = (text: string) => {
    return text.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, letter => letter.toUpperCase())
  }

  const toCamelCase = (text: string) => {
    const words = text
      .trim()
      .replace(/[^\w\s-]/g, '')
      .split(/[\s-_]+/)
      .filter(Boolean)
    const first = words[0]
    if (!first) return ''
    return first.toLowerCase() + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
  }

  const toPascalCase = (text: string) => {
    const words = text
      .trim()
      .replace(/[^\w\s-]/g, '')
      .split(/[\s-_]+/)
      .filter(Boolean)
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
  }

  const toKebabCase = (text: string) => {
    return text
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .replace(/[^\w-]+/g, '')
      .toLowerCase()
  }

  const toSnakeCase = (text: string) => {
    return text
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .replace(/[^\w_]+/g, '')
      .toLowerCase()
  }

  const toConstantCase = (text: string) => {
    return toSnakeCase(text).toUpperCase()
  }

  const toAlternatingCase = (text: string) => {
    let flag = false
    return text
      .split('')
      .map((char) => {
        if (/[a-zA-Z]/.test(char)) {
          flag = !flag
          return flag ? char.toUpperCase() : char.toLowerCase()
        }
        return char
      })
      .join('')
  }

  const toInverseCase = (text: string) => {
    return text
      .split('')
      .map((char) => {
        if (char === char.toUpperCase()) return char.toLowerCase()
        return char.toUpperCase()
      })
      .join('')
  }

  const removeVietnameseAccents = (text: string) => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
  }

  const toSlug = (text: string) => {
    return removeVietnameseAccents(text)
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  const cleanSpaces = (text: string) => {
    return text
      .split('\n')
      .map(line => line.trim().replace(/\s+/g, ' '))
      .join('\n')
  }

  const removeEmptyLines = (text: string) => {
    return text
      .split('\n')
      .filter(line => line.trim().length > 0)
      .join('\n')
  }

  const removeDuplicateLines = (text: string) => {
    const lines = text.split('\n')
    const seen = new Set<string>()
    const result: string[] = []
    for (const line of lines) {
      if (!seen.has(line)) {
        seen.add(line)
        result.push(line)
      }
    }
    return result.join('\n')
  }

  const sortLinesAsc = (text: string) => {
    return text
      .split('\n')
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .join('\n')
  }

  const sortLinesDesc = (text: string) => {
    return text
      .split('\n')
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
      .join('\n')
  }

  const reverseLines = (text: string) => {
    return text.split('\n').reverse().join('\n')
  }

  const reverseCharacters = (text: string) => {
    return Array.from(text).reverse().join('')
  }

  const numberLines = (text: string) => {
    const lines = text.split('\n')
    const pad = String(lines.length).length
    return lines.map((line, idx) => `${String(idx + 1).padStart(pad, ' ')}. ${line}`).join('\n')
  }

  const encodeBase64 = (text: string) => {
    try {
      const bytes = new TextEncoder().encode(text)
      const binString = Array.from(bytes, b => String.fromCharCode(b)).join('')
      return btoa(binString)
    } catch {
      return text
    }
  }

  const decodeBase64 = (text: string) => {
    try {
      const binString = atob(text.trim())
      const bytes = Uint8Array.from(binString, m => m.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    } catch {
      return text
    }
  }

  const encodeUrl = (text: string) => encodeURIComponent(text)

  const decodeUrl = (text: string) => {
    try {
      return decodeURIComponent(text)
    } catch {
      return text
    }
  }

  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  const unescapeHtml = (text: string) => {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, '\'')
  }

  const countStats = (text: string): TextStats => {
    const chars = text.length
    const charsNoSpaces = text.replace(/\s/g, '').length
    const words = text.trim() ? (text.trim().match(/[\p{L}\p{N}]+/gu) || []).length : 0
    const lines = text ? text.split('\n').length : 0
    const paragraphs = text.trim() ? text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length : 0
    const readingTimeMinutes = Math.ceil(words / 200)

    return {
      chars,
      charsNoSpaces,
      words,
      lines,
      paragraphs,
      readingTimeMinutes
    }
  }

  return {
    toUpperCase,
    toLowerCase,
    toCapitalize,
    toSentenceCase,
    toCamelCase,
    toPascalCase,
    toKebabCase,
    toSnakeCase,
    toConstantCase,
    toAlternatingCase,
    toInverseCase,
    removeVietnameseAccents,
    toSlug,
    cleanSpaces,
    removeEmptyLines,
    removeDuplicateLines,
    sortLinesAsc,
    sortLinesDesc,
    reverseLines,
    reverseCharacters,
    numberLines,
    encodeBase64,
    decodeBase64,
    encodeUrl,
    decodeUrl,
    escapeHtml,
    unescapeHtml,
    countStats
  }
}
