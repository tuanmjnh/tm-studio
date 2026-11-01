<script lang="ts">
import { defineComponent, h, type VNode } from 'vue'
import { parseMarkdown, type MarkdownBlock, type MarkdownInline } from '~/utils/docs/markdown'

const HEADING_CLASS: Record<number, string> = {
  1: 'text-xl font-semibold text-highlighted',
  2: 'text-lg font-semibold text-highlighted mt-2',
  3: 'text-base font-semibold text-highlighted',
  4: 'text-sm font-semibold text-highlighted',
  5: 'text-sm font-semibold text-highlighted',
  6: 'text-sm font-semibold text-highlighted'
}

function inlineNodes(tokens: MarkdownInline[]): (VNode | string)[] {
  return tokens.map((token) => {
    switch (token.type) {
      case 'text':
        return token.text
      case 'code':
        return h('code', { class: 'rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] text-highlighted' }, token.text)
      case 'strong':
        return h('strong', { class: 'font-semibold text-highlighted' }, inlineNodes(token.children))
      case 'em':
        return h('em', { class: 'italic' }, inlineNodes(token.children))
      case 'strike':
        return h('s', { class: 'text-dimmed' }, inlineNodes(token.children))
      case 'link':
        return h('a', {
          href: token.href,
          target: token.href.startsWith('#') ? undefined : '_blank',
          rel: 'noopener noreferrer',
          class: 'text-primary underline underline-offset-2 hover:opacity-80'
        }, inlineNodes(token.children))
    }
  })
}

function blockNode(block: MarkdownBlock): VNode {
  switch (block.type) {
    case 'heading':
      return h(`h${Math.min(Math.max(block.level, 1), 6)}`, { class: HEADING_CLASS[block.level] ?? HEADING_CLASS[6] }, inlineNodes(block.inline))
    case 'paragraph':
      return h('p', { class: 'text-sm leading-relaxed text-toned' }, inlineNodes(block.inline))
    case 'code':
      return h('pre', { class: 'overflow-x-auto rounded-lg border border-default bg-elevated p-4 text-xs font-mono text-default' }, [
        h('code', null, block.text)
      ])
    case 'quote':
      return h('blockquote', { class: 'border-l-2 border-primary/40 pl-3 text-sm italic text-muted' }, inlineNodes(block.inline))
    case 'hr':
      return h('hr', { class: 'border-default' })
    case 'list':
      return h(block.ordered ? 'ol' : 'ul', { class: block.ordered ? 'list-decimal pl-5 space-y-1' : 'list-disc pl-5 space-y-1' },
        block.items.map(item => h('li', { class: 'text-sm leading-relaxed text-toned' }, inlineNodes(item)))
      )
    case 'table':
      return h('div', { class: 'overflow-x-auto' }, [
        h('table', { class: 'w-full border-collapse text-left text-xs' }, [
          h('thead', null, [
            h('tr', { class: 'border-b border-default text-muted' },
              block.head.map(cell => h('th', { class: 'px-3 py-2 font-medium' }, inlineNodes(cell)))
            )
          ]),
          h('tbody', { class: 'divide-y divide-default' },
            block.rows.map(row => h('tr', null,
              row.map(cell => h('td', { class: 'px-3 py-2 align-top text-toned' }, inlineNodes(cell)))
            ))
          )
        ])
      ])
  }
}

export default defineComponent({
  name: 'DocsMarkdown',
  props: {
    source: { type: String, required: true }
  },
  setup(props) {
    return () => h('div', { class: 'flex flex-col gap-4' }, parseMarkdown(props.source).map(blockNode))
  }
})
</script>
