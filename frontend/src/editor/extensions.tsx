import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useState,
  type ReactNode,
} from 'react'
import {
  Extension,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  ReactRenderer,
  mergeAttributes,
  type Editor,
  type NodeViewProps,
  type Range,
} from '@tiptap/react'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import Image from '@tiptap/extension-image'
import { renderPreview } from '../markdown'

/** Maps a stored path such as /assets/images/x.png to a URL the browser can show. */
export const ImageResolver = createContext<(src: string) => string>((src) => src)

function RawHtmlView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const resolve = useContext(ImageResolver)
  const [html, setHtml] = useState('')
  const [editing, setEditing] = useState(false)
  const [source, setSource] = useState(node.attrs.raw as string)

  useEffect(() => {
    let active = true
    renderPreview(node.attrs.raw, resolve).then((value) => active && setHtml(value))
    return () => {
      active = false
    }
  }, [node.attrs.raw, resolve])

  return (
    <NodeViewWrapper className={`raw-html${selected ? ' is-selected' : ''}`} data-drag-handle>
      <div className="raw-html-bar" contentEditable={false}>
        <span className="raw-html-label">HTML 블록</span>
        {editor.isEditable && (
          <>
            <button
              type="button"
              onClick={() => {
                if (editing) updateAttributes({ raw: source })
                else setSource(node.attrs.raw)
                setEditing(!editing)
              }}
            >
              {editing ? '완료' : '원문 편집'}
            </button>
            <button type="button" onClick={deleteNode}>
              삭제
            </button>
          </>
        )}
      </div>
      {editing ? (
        <textarea
          className="raw-html-source"
          aria-label="HTML 원문"
          value={source}
          spellCheck={false}
          rows={Math.min(24, source.split('\n').length + 1)}
          onChange={(event) => setSource(event.target.value)}
        />
      ) : (
        <div contentEditable={false} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </NodeViewWrapper>
  )
}

/** A hand-written HTML block kept exactly as written; it renders like the blog does. */
export const RawHtml = Node.create({
  name: 'rawHtml',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { raw: { default: '' } }
  },
  parseHTML() {
    return [
      { tag: 'div[data-raw-html]', getAttrs: (element) => ({ raw: element.getAttribute('data-raw-html') }) },
    ]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-raw-html': node.attrs.raw })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(RawHtmlView)
  },
})

function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const resolve = useContext(ImageResolver)
  return (
    <NodeViewWrapper className={`figure${selected ? ' is-selected' : ''}`} data-drag-handle>
      <img src={resolve(node.attrs.src)} alt={node.attrs.alt || ''} draggable={false} />
      {selected && editor.isEditable && (
        <input
          className="figure-alt"
          aria-label="이미지 설명"
          placeholder="이미지 설명 (검색엔진과 화면 낭독기에 쓰입니다)"
          value={node.attrs.alt || ''}
          onChange={(event) => updateAttributes({ alt: event.target.value })}
        />
      )}
    </NodeViewWrapper>
  )
}

export const PostImage = Image.extend({
  draggable: true,
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})

type Command = {
  title: string
  hint: string
  keywords: string
  run: (editor: Editor, range: Range) => void
}

const DETAILS = '<details>\n<summary>접힌 제목</summary>\n\n펼치면 보이는 내용\n\n</details>'

function commands(onImage: () => void): Command[] {
  const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range)
  return [
    {
      title: '본문',
      hint: '일반 문단',
      keywords: 'text paragraph 본문 텍스트',
      run: (e, r) => chain(e, r).setParagraph().run(),
    },
    {
      title: '제목',
      hint: '## 목차에 나오는 큰 제목',
      keywords: 'h2 heading 제목',
      run: (e, r) => chain(e, r).setHeading({ level: 2 }).run(),
    },
    {
      title: '소제목',
      hint: '### 목차의 하위 항목',
      keywords: 'h3 heading 소제목',
      run: (e, r) => chain(e, r).setHeading({ level: 3 }).run(),
    },
    {
      title: '작은 제목',
      hint: '####',
      keywords: 'h4 heading 작은',
      run: (e, r) => chain(e, r).setHeading({ level: 4 }).run(),
    },
    {
      title: '글머리 목록',
      hint: '- 항목',
      keywords: 'bullet list ul 목록',
      run: (e, r) => chain(e, r).toggleBulletList().run(),
    },
    {
      title: '번호 목록',
      hint: '1. 항목',
      keywords: 'number ordered list ol 번호',
      run: (e, r) => chain(e, r).toggleOrderedList().run(),
    },
    {
      title: '인용',
      hint: '> 인용문',
      keywords: 'quote blockquote 인용',
      run: (e, r) => chain(e, r).toggleBlockquote().run(),
    },
    {
      title: '코드',
      hint: '``` 코드 블록',
      keywords: 'code block 코드',
      run: (e, r) => chain(e, r).toggleCodeBlock().run(),
    },
    {
      title: '구분선',
      hint: '---',
      keywords: 'divider hr rule 구분선',
      run: (e, r) => chain(e, r).setHorizontalRule().run(),
    },
    {
      title: '표',
      hint: '3×3 표',
      keywords: 'table 표',
      run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      title: '이미지',
      hint: '파일 올리기',
      keywords: 'image picture photo 이미지 사진',
      run: (e, r) => {
        chain(e, r).run()
        onImage()
      },
    },
    {
      title: '접기',
      hint: '<details> 펼쳐 보는 블록',
      keywords: 'toggle details 접기 토글',
      run: (e, r) =>
        chain(e, r)
          .insertContent({ type: 'rawHtml', attrs: { raw: DETAILS } })
          .run(),
    },
  ]
}

type MenuHandle = { onKeyDown: (props: SuggestionKeyDownProps) => boolean }

const SlashMenu = forwardRef<MenuHandle, SuggestionProps<Command>>(function SlashMenu(
  { items, command },
  ref
) {
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [items])
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowDown') setActive((active + 1) % items.length)
      else if (event.key === 'ArrowUp') setActive((active + items.length - 1) % items.length)
      else if (event.key === 'Enter') command(items[active])
      else return false
      return true
    },
  }))
  if (!items.length) return <div className="slash-menu slash-empty">일치하는 블록이 없습니다</div>
  return (
    <div className="slash-menu" role="listbox" aria-label="블록 추가">
      {items.map((item, index) => (
        <button
          key={item.title}
          type="button"
          role="option"
          aria-selected={index === active}
          className={`slash-item${index === active ? ' is-active' : ''}`}
          onMouseEnter={() => setActive(index)}
          onMouseDown={(event) => {
            event.preventDefault()
            command(item)
          }}
        >
          <span className="slash-title">{item.title}</span>
          <span className="slash-hint">{item.hint}</span>
        </button>
      ))}
    </div>
  )
})

function place(element: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return
  const below = rect.bottom + 6
  const fitsBelow = below + element.offsetHeight < window.innerHeight
  element.style.left = `${Math.min(rect.left, window.innerWidth - element.offsetWidth - 12) + window.scrollX}px`
  element.style.top = `${(fitsBelow ? below : rect.top - element.offsetHeight - 6) + window.scrollY}px`
}

/** Notion-style "/" menu for inserting blocks. */
export const SlashCommand = Extension.create<{ onImage: () => void }>({
  name: 'slashCommand',
  addOptions() {
    return { onImage: () => {} }
  },
  addProseMirrorPlugins() {
    const list = commands(() => this.options.onImage())
    return [
      Suggestion<Command>({
        editor: this.editor,
        char: '/',
        items: ({ query }) => {
          const needle = query.trim().toLowerCase()
          return list.filter(
            (item) => !needle || `${item.title} ${item.keywords}`.toLowerCase().includes(needle)
          )
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<MenuHandle, SuggestionProps<Command>> | null = null
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor })
              const element = renderer.element as HTMLElement
              element.classList.add('slash-layer')
              document.body.appendChild(element)
              requestAnimationFrame(() => place(element, props.clientRect?.()))
            },
            onUpdate: (props) => {
              renderer?.updateProps(props)
              if (renderer) place(renderer.element as HTMLElement, props.clientRect?.())
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                renderer?.destroy()
                renderer?.element.remove()
                renderer = null
                return true
              }
              return renderer?.ref?.onKeyDown(props) ?? false
            },
            onExit: () => {
              renderer?.element.remove()
              renderer?.destroy()
              renderer = null
            },
          }
        },
      }),
    ]
  },
})

export function ResolverProvider({
  resolve,
  children,
}: {
  resolve: (src: string) => string
  children: ReactNode
}) {
  return <ImageResolver.Provider value={resolve}>{children}</ImageResolver.Provider>
}
