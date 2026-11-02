import { useCallback, useEffect, useRef, type ChangeEvent } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor as TiptapEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Selection } from '@tiptap/pm/state'
import { CATEGORIES, categoryAccent, categoryBadge, type Asset, type Draft, type Post } from '../api'
import { countText } from '../markdown'
import { editorToMarkdown, markdownToEditorHtml } from '../editor/convert'
import { PostImage, RawHtml, ResolverProvider, SlashCommand } from '../editor/extensions'
import TagInput from './TagInput'
import { ExternalIcon, ImageIcon, LinkIcon, RefreshIcon } from './Icons'

export type UploadedImage = Asset & { alt: string }

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const area = ref.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }, [props.value])
  return <textarea ref={ref} rows={1} {...props} />
}

function FormatMenu({ editor }: { editor: TiptapEditor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      quote: e.isActive('blockquote'),
    }),
  })
  const chain = () => editor.chain().focus()
  const buttons: { key: keyof typeof state; label: string; title: string; run: () => void }[] = [
    { key: 'h2', label: 'H2', title: '제목', run: () => chain().toggleHeading({ level: 2 }).run() },
    { key: 'h3', label: 'H3', title: '소제목', run: () => chain().toggleHeading({ level: 3 }).run() },
    { key: 'bold', label: 'B', title: '굵게 (⌘B)', run: () => chain().toggleBold().run() },
    { key: 'italic', label: 'I', title: '기울임 (⌘I)', run: () => chain().toggleItalic().run() },
    { key: 'strike', label: 'S', title: '취소선', run: () => chain().toggleStrike().run() },
    { key: 'code', label: '<>', title: '코드', run: () => chain().toggleCode().run() },
    { key: 'quote', label: '“', title: '인용', run: () => chain().toggleBlockquote().run() },
    {
      key: 'link',
      label: '',
      title: '링크',
      run: () => {
        if (editor.isActive('link')) return chain().unsetLink().run()
        const href = window.prompt('링크 주소', 'https://')
        if (href && href !== 'https://') chain().extendMarkRange('link').setLink({ href }).run()
      },
    },
  ]
  return (
    <BubbleMenu editor={editor} className="bubble" options={{ placement: 'top' }}>
      {buttons.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`bubble-btn bubble-${item.key}${state[item.key] ? ' is-active' : ''}`}
          title={item.title}
          aria-label={item.title}
          aria-pressed={state[item.key]}
          onMouseDown={(event) => event.preventDefault()}
          onClick={item.run}
        >
          {item.key === 'link' ? <LinkIcon size={14} /> : item.label}
        </button>
      ))}
    </BubbleMenu>
  )
}

export default function Editor({
  draft,
  post,
  assets,
  busy,
  dirty,
  blogUrl,
  onChange,
  onUpload,
  onReload,
}: {
  draft: Draft
  post: Post
  assets: Asset[]
  busy: boolean
  dirty: boolean
  blogUrl: string
  onChange: <K extends keyof Post>(key: K, value: Post[K]) => void
  onUpload: (files: File[]) => Promise<UploadedImage[]>
  onReload: () => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  // The Markdown the editor last produced. An unedited post keeps its original text.
  const emitted = useRef(post.body)
  const upload = useRef(onUpload)
  upload.current = onUpload
  const locked = !!draft.source_path
  const publicUrl = `${blogUrl}/${post.category}/${encodeURIComponent(post.slug)}`
  const { chars } = countText(post.body)

  const resolve = useCallback(
    (src: string) => {
      const asset = assets.find((item) => item.path === src)
      if (asset) return asset.preview
      return src.startsWith('/assets/') ? blogUrl + src : src
    },
    [assets, blogUrl]
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true } }),
      PostImage,
      RawHtml,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? '제목' : "내용을 입력하거나 '/'로 블록 추가",
      }),
      SlashCommand.configure({ onImage: () => picker.current?.click() }),
    ],
    content: markdownToEditorHtml(post.body),
    editorProps: {
      attributes: {
        class: 'prose body-prose',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': '본문',
        spellcheck: 'false',
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith('image/')
        )
        if (!files.length) return false
        void insertImages(files)
        return true
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
          file.type.startsWith('image/')
        )
        if (!files.length) return false
        event.preventDefault()
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertImages(files, position)
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = editorToMarkdown(current.state.doc)
      emitted.current = markdown
      onChange('body', markdown)
    },
  })

  async function insertImages(files: File[], position?: number) {
    const uploaded = await upload.current(files)
    if (!editor || !uploaded.length) return
    const images = uploaded.map((item) => ({ type: 'image', attrs: { src: item.path, alt: item.alt } }))
    const chain = editor.chain().focus()
    ;(position === undefined ? chain.insertContent(images) : chain.insertContentAt(position, images)).run()
  }

  // Replace the document when the body changes from outside (another draft, reload).
  useEffect(() => {
    if (!editor || post.body === emitted.current) return
    emitted.current = post.body
    editor.commands.setContent(markdownToEditorHtml(post.body), { emitUpdate: false })
  }, [editor, post.body])

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    if (files.length) void insertImages(files)
    event.target.value = ''
  }

  const coverPreview = post.cover ? resolve(post.cover) : ''

  return (
    <ResolverProvider resolve={resolve}>
      <div className="doc">
        <dl className="props" aria-label="글 정보">
          <div className="prop">
            <dt>카테고리</dt>
            <dd>
              <select
                aria-label="카테고리"
                value={post.category}
                disabled={locked || busy}
                onChange={(event) => onChange('category', event.target.value)}
              >
                {CATEGORIES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div className="prop">
            <dt>주소</dt>
            <dd className="slug-field">
              <span className="slug-prefix">/{post.category}/</span>
              <input
                aria-label="글 주소"
                value={post.slug}
                disabled={locked || busy}
                onChange={(event) => onChange('slug', event.target.value)}
                placeholder="my-first-post"
                maxLength={120}
              />
            </dd>
          </div>
          <div className="prop">
            <dt>발행일</dt>
            <dd>
              <input
                aria-label="최초 발행일"
                type="date"
                value={post.date}
                disabled={locked || busy}
                onChange={(event) => onChange('date', event.target.value)}
              />
            </dd>
          </div>
          <div className="prop">
            <dt>표지</dt>
            <dd className="cover-field">
              {post.cover && <img className="cover-thumb" src={coverPreview} alt="" />}
              <input
                aria-label="표지 이미지 주소"
                value={post.cover}
                disabled={busy}
                onChange={(event) => onChange('cover', event.target.value)}
                placeholder="없음 — 첨부 이미지에서 '표지로 사용'"
                maxLength={2000}
              />
            </dd>
          </div>
          <div className="prop prop-wide">
            <dt>설명</dt>
            <dd>
              <AutoTextarea
                className="prop-desc"
                aria-label="검색 결과에 표시할 설명"
                value={post.description}
                disabled={busy}
                onChange={(event) => onChange('description', event.target.value)}
                placeholder="검색 결과와 공유 카드에 보일 한두 문장"
                maxLength={500}
              />
            </dd>
          </div>
        </dl>

        {draft.publish_pending && (
          <p className="alert alert-warn">
            앞선 발행 결과를 확인해야 합니다. 발행 버튼을 다시 누르면 중복 발행 없이 결과를 확인합니다.
          </p>
        )}

        <article className="sheet">
          <header className="sheet-head">
            {/* Same order as the published article: category and tags, title, then the date. */}
            <div className="sheet-kicker">
              <span className={`pill ${categoryAccent(post.category)}`}>{categoryBadge(post.category)}</span>
              <TagInput value={post.tags} disabled={busy} onChange={(tags) => onChange('tags', tags)} />
            </div>
            <AutoTextarea
              className="sheet-title"
              aria-label="제목"
              value={post.title}
              disabled={busy}
              onChange={(event) => onChange('title', event.target.value.replace(/\n/g, ' '))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && editor && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  // Move synchronously: the focus command waits a frame, so fast typing landed in the title.
                  editor.view.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)))
                  editor.view.focus()
                }
              }}
              placeholder="제목 없음"
              maxLength={200}
            />
            <p className="sheet-date">
              <time dateTime={post.date}>{post.date.replaceAll('-', '.')}</time>
              <span className={`sheet-state${dirty ? ' is-dirty' : ''}`}>
                {dirty ? '저장하지 않은 수정' : locked ? '발행된 글' : '초안'}
              </span>
            </p>
          </header>

          {editor && <FormatMenu editor={editor} />}
          <EditorContent editor={editor} className="sheet-body" />

          <footer className="sheet-foot">
            <span>{chars.toLocaleString()}자</span>
            <span>&apos;/&apos; 블록 추가 · 글자를 선택하면 서식 · ⌘S 저장</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              <ImageIcon size={15} />
              이미지
            </button>
            <input
              ref={picker}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              onChange={onPick}
            />
          </footer>
        </article>

        {assets.length > 0 && (
          <section className="attachments" aria-label="첨부 이미지">
            <div className="side-head">
              <span className="label">첨부 이미지</span>
              <span className="count">{assets.length}</span>
            </div>
            <ul className="attachment-list">
              {assets.map((asset) => (
                <li key={asset.path} className={`attachment${post.cover === asset.path ? ' is-cover' : ''}`}>
                  <img src={asset.preview} alt="" />
                  <div className="attachment-body">
                    <code>{asset.path.replace('/assets/images/', '')}</code>
                    <div className="attachment-actions">
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busy}
                        onClick={() =>
                          editor
                            ?.chain()
                            .focus()
                            .insertContent({ type: 'image', attrs: { src: asset.path, alt: '' } })
                            .run()
                        }
                      >
                        본문에 삽입
                      </button>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={busy}
                        onClick={() => onChange('cover', post.cover === asset.path ? '' : asset.path)}
                      >
                        {post.cover === asset.path ? '표지 해제' : '표지로 사용'}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {locked && (
          <footer className="doc-foot">
            <a className="btn btn-ghost btn-sm" href={publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalIcon size={14} />
              공개 글 확인 ↗
            </a>
            <a
              className="btn btn-ghost btn-sm"
              href="https://github.com/gaeng02/gaeng02.github.io/actions"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalIcon size={14} />
              배포 상태 확인 ↗
            </a>
            <span className="grow" />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy || draft.publish_pending}
              onClick={onReload}
            >
              <RefreshIcon size={14} />
              GitHub 최신 원본 다시 불러오기
            </button>
          </footer>
        )}
      </div>
    </ResolverProvider>
  )
}
