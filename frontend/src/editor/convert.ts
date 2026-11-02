import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import {
  MarkdownSerializer,
  defaultMarkdownSerializer,
  type MarkdownSerializerState,
} from 'prosemirror-markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { sanitizeSchema } from '../markdown'

/**
 * Posts are stored as Markdown (the blog builds from it), but they are edited as rich
 * text. Markdown becomes HTML for TipTap on the way in and is serialized back on the
 * way out. Hand-written HTML blocks (<details>, styled <table>, …) have no rich-text
 * equivalent, so they travel as opaque "raw HTML" blocks and are written back verbatim.
 */

type Segment = { kind: 'markdown'; text: string } | { kind: 'html'; raw: string }

// CommonMark block-level tags: these start an HTML block even right after a paragraph.
const BLOCK_TAGS = new Set(
  'address article aside blockquote center details dialog dir div dl dt dd fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr iframe legend li main menu nav ol p section summary table tbody td tfoot th thead tr ul'.split(
    ' '
  )
)
const VOID_TAGS = new Set('area base br col embed hr img input link meta source track wbr'.split(' '))

function openingTag(line: string): string | null {
  const match = /^<([a-zA-Z][a-zA-Z0-9-]*)[\s/>]/.exec(line) || /^<([a-zA-Z][a-zA-Z0-9-]*)$/.exec(line)
  return match ? match[1].toLowerCase() : null
}

function depthChange(line: string, tag: string): number {
  let depth = 0
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi')
  for (const match of line.matchAll(pattern)) {
    if (match[1]) depth -= 1
    else if (!match[2]) depth += 1
  }
  return depth
}

/** Split Markdown into Markdown runs and top-level raw HTML blocks (outside code fences). */
export function splitMarkdown(markdown: string): Segment[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const segments: Segment[] = []
  let buffer: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (buffer.join('').trim()) segments.push({ kind: 'markdown', text: buffer.join('\n') })
    buffer = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      buffer.push(line)
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      buffer.push(line)
      continue
    }
    const tag = openingTag(line)
    const afterBlank = i === 0 || !lines[i - 1].trim()
    if (!tag || (!BLOCK_TAGS.has(tag) && !afterBlank)) {
      buffer.push(line)
      continue
    }
    // Containers run to their matching close tag (blank lines inside are kept);
    // anything else runs to the next blank line, as CommonMark HTML blocks do.
    const block = [line]
    let depth = VOID_TAGS.has(tag) ? 0 : depthChange(line, tag)
    let j = i + 1
    if (depth > 0) {
      while (j < lines.length && depth > 0) {
        depth += depthChange(lines[j], tag)
        block.push(lines[j++])
      }
    } else {
      while (j < lines.length && lines[j].trim()) block.push(lines[j++])
    }
    flush()
    segments.push({ kind: 'html', raw: block.join('\n') })
    i = j - 1
  }
  flush()
  return segments
}

const toHtml = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify)

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** HTML that TipTap parses into the editor document. */
export function markdownToEditorHtml(markdown: string): string {
  return splitMarkdown(markdown)
    .map((segment) =>
      segment.kind === 'html'
        ? `<div data-raw-html="${escapeAttribute(segment.raw)}"></div>`
        : String(toHtml.processSync(segment.text))
    )
    .join('')
}

const marks = defaultMarkdownSerializer.marks

function cellText(serializer: MarkdownSerializer, cell: PMNode): string {
  return serializer.serialize(cell).trim().replace(/\n+/g, '<br>').replace(/\|/g, '\\|')
}

const serializer: MarkdownSerializer = new MarkdownSerializer(
  {
    doc: (state, node) => state.renderContent(node),
    paragraph: (state, node) => {
      state.renderInline(node)
      state.closeBlock(node)
    },
    heading: (state, node) => {
      state.write('#'.repeat(node.attrs.level) + ' ')
      state.renderInline(node, false)
      state.closeBlock(node)
    },
    blockquote: (state, node) => {
      state.wrapBlock('> ', null, node, () => state.renderContent(node))
    },
    codeBlock: (state, node) => {
      const backticks = node.textContent.match(/`{3,}/gm)
      const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```'
      state.write(fence + (node.attrs.language || '') + '\n')
      state.text(node.textContent, false)
      state.write('\n')
      state.write(fence)
      state.closeBlock(node)
    },
    horizontalRule: (state, node) => {
      state.write('---')
      state.closeBlock(node)
    },
    bulletList: (state, node) => state.renderList(node, '  ', () => '- '),
    orderedList: (state, node) => {
      const start = node.attrs.start ?? 1
      const width = String(start + node.childCount - 1).length
      const space = ' '.repeat(width + 2)
      state.renderList(node, space, (i) => {
        const label = String(start + i)
        return ' '.repeat(width - label.length) + label + '. '
      })
    },
    listItem: (state, node) => state.renderContent(node),
    image: (state, node) => {
      const title = node.attrs.title ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"` : ''
      state.write(
        `![${state.esc(node.attrs.alt || '')}](${String(node.attrs.src).replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))}${title})`
      )
      state.closeBlock(node)
    },
    hardBreak: (state, node, parent, index) => {
      for (let i = index + 1; i < parent.childCount; i++)
        if (parent.child(i).type !== node.type) {
          state.write('\\\n')
          return
        }
    },
    text: (state, node) =>
      state.text(node.text || '', !(state as MarkdownSerializerState & { inAutolink?: boolean }).inAutolink),
    rawHtml: (state, node) => {
      state.write(node.attrs.raw)
      state.closeBlock(node)
    },
    table: (state, node) => {
      node.forEach((row, _, rowIndex) => {
        const cells: string[] = []
        row.forEach((cell) => cells.push(cellText(serializer, cell)))
        state.write(`| ${cells.join(' | ')} |\n`)
        if (rowIndex === 0) state.write(`|${cells.map(() => ' --- ').join('|')}|\n`)
      })
      state.closeBlock(node)
    },
    tableRow: () => {},
    tableHeader: (state, node) => state.renderContent(node),
    tableCell: (state, node) => state.renderContent(node),
  },
  {
    italic: marks.em,
    bold: marks.strong,
    code: marks.code,
    link: marks.link,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  }
)

export function editorToMarkdown(doc: PMNode): string {
  return serializer.serialize(doc, { tightLists: true }).trim() + '\n'
}
