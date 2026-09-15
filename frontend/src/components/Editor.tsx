import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from 'react'
import { CATEGORIES, categoryAccent, categoryLabel, type Asset, type Draft, type Post } from '../api'
import { countText } from '../markdown'
import type { ViewMode } from '../App'
import TagInput from './TagInput'
import { ExternalIcon, ImageIcon, LinkIcon, RefreshIcon } from './Icons'

type Format = 'bold' | 'italic' | 'heading' | 'quote' | 'code' | 'link' | 'list'

const FORMATS: { key: Format; label: string; title: string }[] = [
  { key: 'heading', label: 'H2', title: '소제목' },
  { key: 'bold', label: 'B', title: '굵게' },
  { key: 'italic', label: 'I', title: '기울임' },
  { key: 'quote', label: '“', title: '인용' },
  { key: 'code', label: '<>', title: '코드' },
  { key: 'link', label: 'link', title: '링크' },
  { key: 'list', label: '•', title: '목록' },
]

export default function Editor({
  draft,
  post,
  assets,
  busy,
  dirty,
  view,
  preview,
  blogUrl,
  editorRef,
  onChange,
  onUpload,
  onInsert,
  onReload,
}: {
  draft: Draft
  post: Post
  assets: Asset[]
  busy: boolean
  dirty: boolean
  view: ViewMode
  preview: string
  blogUrl: string
  editorRef: RefObject<HTMLTextAreaElement | null>
  onChange: <K extends keyof Post>(key: K, value: Post[K]) => void
  onUpload: (files: File[]) => void
  onInsert: (snippet: string) => void
  onReload: () => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const locked = !!draft.source_path
  const publicUrl = `${blogUrl}/${post.category}/${encodeURIComponent(post.slug)}`
  const { chars, words } = countText(post.body)
  const coverAsset = assets.find((item) => item.path === post.cover)
  const coverPreview = coverAsset
    ? coverAsset.preview
    : post.cover.startsWith('/assets/')
      ? blogUrl + post.cover
      : post.cover

  function applyFormat(kind: Format) {
    const area = editorRef.current
    if (!area) return
    const { selectionStart: start, selectionEnd: end, value } = area
    const selected = value.slice(start, end)
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    let next = value
    let cursor = end
    const wrap = (before: string, after: string, placeholder: string) => {
      const text = selected || placeholder
      next = value.slice(0, start) + before + text + after + value.slice(end)
      cursor = start + before.length + text.length + (selected ? after.length : 0)
    }
    const prefixLines = (prefix: string) => {
      const blockEnd = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end)
      const block = value.slice(lineStart, blockEnd)
      const changed = block
        .split('\n')
        .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line))
        .join('\n')
      next = value.slice(0, lineStart) + changed + value.slice(blockEnd)
      cursor = lineStart + changed.length
    }
    if (kind === 'bold') wrap('**', '**', '굵은 글씨')
    else if (kind === 'italic') wrap('*', '*', '기울인 글씨')
    else if (kind === 'code')
      selected.includes('\n') ? wrap('```\n', '\n```', '코드') : wrap('`', '`', '코드')
    else if (kind === 'link') wrap('[', '](https://)', '링크 텍스트')
    else if (kind === 'heading') prefixLines('## ')
    else if (kind === 'quote') prefixLines('> ')
    else if (kind === 'list') prefixLines('- ')
    onChange('body', next)
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(cursor, cursor)
    })
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    setDragging(false)
    if (event.dataTransfer.files.length) {
      event.preventDefault()
      onUpload(Array.from(event.dataTransfer.files))
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files)
    if (files.length) {
      event.preventDefault()
      onUpload(files)
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    if (files.length) onUpload(files)
    event.target.value = ''
  }

  return (
    <div className="doc">
      <header className="doc-head">
        <div className="doc-kind">
          <span className={`pill ${categoryAccent(post.category)}`}>{categoryLabel(post.category)}</span>
          <span className="doc-kind-text">{locked ? '발행된 글 수정' : '새 글'}</span>
          <span className={`doc-kind-state${dirty ? ' is-dirty' : ''}`}>
            {dirty ? '저장하지 않은 수정 내용' : '초안 저장됨'}
          </span>
        </div>
        <fieldset disabled={busy} className="doc-fields">
          <input
            className="doc-title"
            aria-label="제목"
            value={post.title}
            onChange={(event) => onChange('title', event.target.value)}
            placeholder="제목을 입력하세요"
            maxLength={200}
          />
          <textarea
            className="doc-desc"
            aria-label="검색 결과에 표시할 설명"
            value={post.description}
            onChange={(event) => onChange('description', event.target.value)}
            placeholder="검색 결과와 목록에 보일 한두 문장 설명"
            rows={2}
            maxLength={500}
          />
          <div className="doc-meta">
            <label className="field">
              <span className="field-label">카테고리</span>
              <select
                aria-label="카테고리"
                value={post.category}
                disabled={locked}
                onChange={(event) => onChange('category', event.target.value)}
              >
                {CATEGORIES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label} · {item.key}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-slug">
              <span className="field-label">글 주소</span>
              <span className="slug-field">
                <span className="slug-prefix">/{post.category}/</span>
                <input
                  aria-label="글 주소"
                  value={post.slug}
                  disabled={locked}
                  onChange={(event) => onChange('slug', event.target.value)}
                  placeholder="my-first-post"
                  maxLength={120}
                />
              </span>
            </label>
            <label className="field">
              <span className="field-label">최초 발행일</span>
              <input
                aria-label="최초 발행일"
                type="date"
                value={post.date}
                disabled={locked}
                onChange={(event) => onChange('date', event.target.value)}
              />
            </label>
            <div className="field field-tags">
              <span className="field-label">태그</span>
              <TagInput value={post.tags} disabled={busy} onChange={(tags) => onChange('tags', tags)} />
            </div>
            <label className="field field-cover">
              <span className="field-label">표지 이미지</span>
              <span className="cover-field">
                {post.cover && <img className="cover-thumb" src={coverPreview} alt="" />}
                <input
                  aria-label="표지 이미지 주소"
                  value={post.cover}
                  onChange={(event) => onChange('cover', event.target.value)}
                  placeholder="https://… 또는 아래 첨부 이미지에서 '표지로 사용'"
                  maxLength={2000}
                />
              </span>
            </label>
          </div>
        </fieldset>
        {locked && (
          <p className="doc-hint">
            기존 글의 주소·카테고리·최초 발행일은 유지됩니다.{' '}
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              공개 글 확인 ↗
            </a>
          </p>
        )}
        {draft.publish_pending && (
          <p className="alert alert-warn">
            앞선 발행 결과를 확인해야 합니다. 발행 버튼을 다시 누르면 중복 발행 없이 결과를 확인합니다.
          </p>
        )}
      </header>

      <div className="doc-tools">
        <div className="fmt" role="group" aria-label="서식">
          {FORMATS.map((item) => (
            <button
              key={item.key}
              type="button"
              className="fmt-btn"
              title={item.title}
              aria-label={item.title}
              disabled={busy}
              onClick={() => applyFormat(item.key)}
            >
              {item.key === 'link' ? <LinkIcon size={14} /> : item.label}
            </button>
          ))}
        </div>
        <span className="doc-tools-hint">Markdown · 이미지는 드래그하거나 붙여넣으면 자동 업로드</span>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => picker.current?.click()}>
          <ImageIcon size={15} />
          이미지 추가
        </button>
        <input
          ref={picker}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={onPick}
        />
      </div>

      <div
        className={`doc-body view-${view}${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={onDrop}
      >
        <section className="pane pane-write" aria-label="편집">
          <textarea
            aria-label="Markdown 본문"
            className="body-editor"
            ref={editorRef}
            value={post.body}
            disabled={busy}
            onChange={(event) => onChange('body', event.target.value)}
            onPaste={onPaste}
            placeholder={'## 시작하며\n\n여기에 본문을 적습니다.'}
            spellCheck={false}
          />
          <footer className="pane-foot">
            <span>
              {chars.toLocaleString()}자 · {words.toLocaleString()}단어
            </span>
            <span>⌘S 저장</span>
          </footer>
        </section>
        <section className="pane pane-preview" aria-label="미리보기">
          <article className="prose">
            <p className="prose-kicker">
              {categoryLabel(post.category)} · {post.date}
            </p>
            <h1 className="prose-title">{post.title || '제목을 입력하세요'}</h1>
            {post.description && <p className="prose-lede">{post.description}</p>}
            <div dangerouslySetInnerHTML={{ __html: preview }} />
          </article>
        </section>
        <div className="drop-overlay" aria-hidden="true">
          <ImageIcon size={28} />
          <span>이미지를 놓으면 본문에 추가됩니다</span>
        </div>
      </div>

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
                      onClick={() => onInsert(`\n![이미지 설명](${asset.path})\n`)}
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
  )
}
