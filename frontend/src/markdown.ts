import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'

/**
 * Same policy as gaeng02.github.io/src/lib/markdown.ts: GFM plus inline HTML such as
 * <img>, <details> and <table>; scripts, iframes, event handlers and inline styles are
 * removed. Keeping the schemas identical makes the preview match the published page.
 */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), 'alt', 'title', 'width', 'height'],
  },
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify)

export async function renderPreview(
  markdown: string,
  resolveImage: (src: string) => string
): Promise<string> {
  const html = String(await processor.process(markdown))
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc
    .querySelectorAll('img')
    .forEach((img) => img.setAttribute('src', resolveImage(img.getAttribute('src') || '')))
  doc.querySelectorAll('a').forEach((link) => {
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  })
  return doc.body.innerHTML
}

export function countText(markdown: string): { chars: number; words: number } {
  const trimmed = markdown.trim()
  return { chars: markdown.replace(/\s/g, '').length, words: trimmed ? trimmed.split(/\s+/).length : 0 }
}
