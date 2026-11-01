/**
 * Documentation center: the markdown reader must keep hub-authored articles
 * renderable without ever producing an unsafe link, and it must survive the
 * structures our own guide uses (headings, tables, fenced code, lists).
 */
import { isSafeHref, parseInline, parseMarkdown } from '../../app/utils/docs/markdown'
import type { MarkdownBlock, MarkdownInline } from '../../app/utils/docs/markdown'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function firstBlock(source: string): MarkdownBlock {
  const block = parseMarkdown(source)[0]
  assert(block, 'expected at least one block')
  return block
}

function flatText(tokens: MarkdownInline[]): string {
  return tokens.map((token) => {
    if (token.type === 'text' || token.type === 'code') return token.text
    if (token.type === 'link') return flatText(token.children)
    return flatText(token.children)
  }).join('')
}

check('headings keep their level and inline text', () => {
  const blocks = parseMarkdown('# One\n\n### Three **bold**')
  assert(blocks.length === 2, `expected 2 blocks, got ${blocks.length}`)
  const [first, second] = blocks
  assert(first?.type === 'heading' && first.level === 1, 'first block must be h1')
  assert(second?.type === 'heading' && second.level === 3, 'second block must be h3')
  assert(second.inline.some(token => token.type === 'strong'), 'bold token must survive')
})

check('wrapped lines join into one paragraph', () => {
  const block = firstBlock('first line\nsecond line\n\nnext')
  assert(block.type === 'paragraph', 'expected a paragraph')
  assert(flatText(block.inline) === 'first line second line', `got "${flatText(block.inline)}"`)
})

check('lists keep order and items', () => {
  const [unordered, ordered] = parseMarkdown('- a\n- b\n\n1. one\n2. two')
  assert(unordered?.type === 'list' && !unordered.ordered, 'first list must be unordered')
  assert(unordered.items.length === 2, 'two bullet items')
  assert(ordered?.type === 'list' && ordered.ordered, 'second list must be ordered')
  assert(ordered.items.length === 2, 'two numbered items')
})

check('fenced code is captured verbatim and never parsed', () => {
  const block = firstBlock('```ts\nconst x = "<script>"\n```')
  assert(block.type === 'code', 'expected a code block')
  assert(block.lang === 'ts', 'language must be kept')
  assert(block.text === 'const x = "<script>"', `got "${block.text}"`)
})

check('tables split head and rows', () => {
  const block = firstBlock('| Key | Value |\n| --- | :---: |\n| a | 1 |\n| b | 2 |')
  assert(block.type === 'table', 'expected a table')
  assert(block.head.length === 2 && block.rows.length === 2, 'two columns, two rows')
  assert(flatText(block.head[0] ?? []) === 'Key', 'head cell text')
  assert(flatText(block.rows[1]?.[1] ?? []) === '2', 'last cell text')
})

check('quotes, rules and horizontal separators', () => {
  const [quote, rule] = parseMarkdown('> note\n> second line\n\n---')
  assert(quote?.type === 'quote', 'first block must be a quote')
  assert(flatText(quote.inline) === 'note second line', 'quote lines join')
  assert(rule?.type === 'hr', 'second block must be a rule')
})

check('inline styles: bold, italic, code, strike', () => {
  const tokens = parseInline('a **b** *c* `d` ~~e~~')
  const kinds = tokens.map(token => token.type)
  assert(kinds.includes('strong') && kinds.includes('em') && kinds.includes('code') && kinds.includes('strike'),
    `got ${kinds.join(',')}`)
})

check('http and hash links are kept', () => {
  const [link] = parseInline('[docs](https://example.com/a)')
  assert(link?.type === 'link' && link.href === 'https://example.com/a', 'https link kept')
  const [hash] = parseInline('[top](#section)')
  assert(hash?.type === 'link' && hash.href === '#section', 'hash link kept')
})

check('javascript: and data: links degrade to text', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=']) {
    const tokens = parseInline(`[click](${href})`)
    assert(!tokens.some(token => token.type === 'link'), `${href} must not produce a link`)
    assert(flatText(tokens).includes('click'), 'label survives as text')
  }
})

check('isSafeHref only allows web, mail, hash and same-origin paths', () => {
  assert(isSafeHref('http://localhost:4000/x'), 'http allowed')
  assert(isSafeHref('mailto:a@b.c'), 'mailto allowed')
  assert(isSafeHref('/system/docs'), 'absolute path allowed')
  assert(isSafeHref('#top'), 'hash allowed')
  assert(!isSafeHref('javascript:void(0)'), 'javascript blocked')
  assert(!isSafeHref(''), 'empty blocked')
})

check('raw html inside text stays literal text', () => {
  const [token, ...rest] = parseInline('<img src=x onerror=alert(1)>')
  assert(rest.length === 0 && token?.type === 'text', 'no element tokens produced')
  assert(token.text === '<img src=x onerror=alert(1)>', 'markup kept as text')
})

check('the shipped guide structure parses end to end', () => {
  const sample = [
    '# Title',
    '',
    'Intro paragraph.',
    '',
    '## Section',
    '',
    '1. step one',
    '2. step two',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |'
  ].join('\n')
  const blocks = parseMarkdown(sample)
  const kinds = blocks.map(block => block.type)
  assert(kinds.join(',') === 'heading,paragraph,heading,list,table', `got ${kinds.join(',')}`)
})

console.log(`\n=== All ${passed} docs-markdown checks passed ===`)
