// Minimal markdown reader for hub-managed documentation. It produces a small
// block/inline tree that the Vue renderer turns into elements, so article text
// never reaches innerHTML: raw HTML stays literal text and links are filtered
// to http(s), mailto, hash and same-origin paths (one leading slash, no host).

export type MarkdownInline
  = | { type: 'text', text: string }
    | { type: 'code', text: string }
    | { type: 'strong', children: MarkdownInline[] }
    | { type: 'em', children: MarkdownInline[] }
    | { type: 'strike', children: MarkdownInline[] }
    | { type: 'link', href: string, children: MarkdownInline[] }

export type MarkdownBlock
  = | { type: 'heading', level: number, inline: MarkdownInline[] }
    | { type: 'paragraph', inline: MarkdownInline[] }
    | { type: 'list', ordered: boolean, items: MarkdownInline[][] }
    | { type: 'code', lang: string, text: string }
    | { type: 'quote', inline: MarkdownInline[] }
    | { type: 'hr' }
    | { type: 'table', head: MarkdownInline[][], rows: MarkdownInline[][][] }

const FENCE = /^```(\w*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const RULE = /^(-{3,}|\*{3,}|_{3,})$/
const LIST_ITEM = /^([-*+]|\d+\.)\s+(.*)$/
const TABLE_RULE = /^\|?[\s:-]*-[\s:|-]*\|?$/

export function isSafeHref(href: string): boolean {
  const value = href.trim()
  if (!value) return false
  if (value.startsWith('#') || value.startsWith('/')) {
    // `//host/x` and `/\host` are paths to a reader but absolute URLs to the
    // browser, which resolves both to another host. A real same-origin path has
    // exactly one leading slash and no backslash after it.
    return !value.startsWith('//') && !value.startsWith('/\\')
  }
  return /^(https?:\/\/|mailto:)/i.test(value)
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())
}

export function parseInline(source: string): MarkdownInline[] {
  const out: MarkdownInline[] = []
  let buffer = ''
  let i = 0

  const flush = () => {
    if (buffer) {
      out.push({ type: 'text', text: buffer })
      buffer = ''
    }
  }

  while (i < source.length) {
    const char = source[i] ?? ''

    if (char === '`') {
      const end = source.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ type: 'code', text: source.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (char === '[') {
      const labelEnd = source.indexOf(']', i + 1)
      if (labelEnd > i && source[labelEnd + 1] === '(') {
        const hrefEnd = source.indexOf(')', labelEnd + 2)
        if (hrefEnd > labelEnd) {
          const label = source.slice(i + 1, labelEnd)
          const href = source.slice(labelEnd + 2, hrefEnd).trim()
          flush()
          const children = parseInline(label)
          if (isSafeHref(href)) out.push({ type: 'link', href, children })
          else out.push(...children)
          i = hrefEnd + 1
          continue
        }
      }
    }

    if (char === '*' && source[i + 1] === '*') {
      const end = source.indexOf('**', i + 2)
      if (end > i) {
        flush()
        out.push({ type: 'strong', children: parseInline(source.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    if (char === '~' && source[i + 1] === '~') {
      const end = source.indexOf('~~', i + 2)
      if (end > i) {
        flush()
        out.push({ type: 'strike', children: parseInline(source.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    if (char === '*') {
      const end = source.indexOf('*', i + 1)
      if (end > i) {
        flush()
        out.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }

    buffer += char
    i++
  }

  flush()
  return out
}

function startsBlock(line: string, next: string | undefined): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (FENCE.test(trimmed) || HEADING.test(trimmed) || RULE.test(trimmed)) return true
  if (trimmed.startsWith('>') || LIST_ITEM.test(trimmed)) return true
  return trimmed.includes('|') && next !== undefined && TABLE_RULE.test(next.trim()) && next.includes('-')
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    const fence = FENCE.exec(trimmed)
    if (fence) {
      const lang = fence[1] ?? ''
      const body: string[] = []
      i++
      while (i < lines.length && (lines[i] ?? '').trim() !== '```') {
        body.push(lines[i] ?? '')
        i++
      }
      if (i < lines.length) i++
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(trimmed)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: (heading[1] ?? '#').length,
        inline: parseInline(heading[2] ?? '')
      })
      i++
      continue
    }

    if (RULE.test(trimmed)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    if (trimmed.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quote.push((lines[i] ?? '').trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', inline: parseInline(quote.join(' ')) })
      continue
    }

    const next = lines[i + 1]
    if (trimmed.includes('|') && next !== undefined && TABLE_RULE.test(next.trim()) && next.includes('-')) {
      const head = splitRow(trimmed).map(cell => parseInline(cell))
      const rows: MarkdownInline[][][] = []
      i += 2
      while (i < lines.length) {
        const rowLine = (lines[i] ?? '').trim()
        if (!rowLine || !rowLine.includes('|')) break
        rows.push(splitRow(rowLine).map(cell => parseInline(cell)))
        i++
      }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    const listStart = LIST_ITEM.exec(trimmed)
    if (listStart) {
      const ordered = /\d+\./.test(listStart[1] ?? '')
      const items: MarkdownInline[][] = []
      while (i < lines.length) {
        const item = LIST_ITEM.exec((lines[i] ?? '').trim())
        if (!item) break
        items.push(parseInline(item[2] ?? ''))
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length && !startsBlock(lines[i] ?? '', lines[i + 1])) {
      paragraph.push((lines[i] ?? '').trim())
      i++
    }
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ')) })
    } else {
      // Unreachable unless a block starter slipped through; advance to stay safe.
      i++
    }
  }

  return blocks
}
