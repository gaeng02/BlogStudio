import { useMemo, useState, type FormEvent } from 'react'
import {
  CATEGORIES,
  categoryLabel,
  draftState,
  relativeTime,
  type Category,
  type Draft,
  type PublishedEntry,
} from '../api'
import { CloseIcon, MoonIcon, PlusIcon, RefreshIcon, SunIcon, TrashIcon } from './Icons'

export default function Sidebar({
  open,
  onClose,
  drafts,
  current,
  busy,
  onNew,
  onOpen,
  onDelete,
  published,
  category,
  titles,
  onLoadPublished,
  onSelectCategory,
  onImport,
  email,
  theme,
  onTheme,
  onLogout,
}: {
  open: boolean
  onClose: () => void
  drafts: Draft[]
  current: Draft | null
  busy: boolean
  onNew: () => void
  onOpen: (draft: Draft) => void
  onDelete: (draft: Draft) => void
  published: PublishedEntry[] | null
  category: Category | null
  titles: Partial<Record<Category, PublishedEntry[]>>
  onLoadPublished: () => void
  onSelectCategory: (category: Category) => void
  onImport: (input: { path?: string; url?: string }) => void
  email: string
  theme: 'light' | 'dark'
  onTheme: () => void
  onLogout: () => void
}) {
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')

  const counts = useMemo(() => {
    const map: Partial<Record<Category, number>> = {}
    published?.forEach((item) => {
      map[item.category] = (map[item.category] ?? 0) + 1
    })
    return map
  }, [published])

  const entries = useMemo(() => {
    if (!category) return []
    const base = titles[category] ?? published?.filter((item) => item.category === category) ?? []
    const needle = query.trim().toLowerCase()
    return needle
      ? base.filter(
          (item) =>
            (item.title ?? item.slug).toLowerCase().includes(needle) ||
            item.slug.toLowerCase().includes(needle)
        )
      : base
  }, [category, titles, published, query])

  const editedPaths = useMemo(() => new Set(drafts.map((item) => item.source_path).filter(Boolean)), [drafts])

  function submitUrl(event: FormEvent) {
    event.preventDefault()
    const value = url.trim()
    if (!value) return
    onImport({ url: value })
    setUrl('')
  }

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="글 목록">
      <div className="sidebar-top">
        <button type="button" className="btn btn-solid btn-block" disabled={busy} onClick={onNew}>
          <PlusIcon />새 글 쓰기
        </button>
        <button type="button" className="icon-btn sidebar-close" aria-label="메뉴 닫기" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <section className="side-section">
        <div className="side-head">
          <span className="label">내 초안</span>
          <span className="count">{drafts.length}</span>
        </div>
        {drafts.length === 0 ? (
          <p className="side-empty">아직 저장한 초안이 없습니다.</p>
        ) : (
          <ul className="side-list">
            {drafts.map((item) => {
              const state = draftState(item)
              const title = item.post.title || '제목 없는 글'
              return (
                <li key={item.id} className={`side-item${current?.id === item.id ? ' is-active' : ''}`}>
                  <button
                    type="button"
                    className="side-item-main"
                    disabled={busy}
                    onClick={() => onOpen(item)}
                  >
                    <span className="side-title">{title}</span>
                    <span className="side-meta">
                      <span className={`state-dot ${state.key}`} aria-hidden="true" />
                      {state.label} · {relativeTime(item.updated_at)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="side-item-del"
                    aria-label={`${title} 초안 삭제`}
                    title="초안 삭제"
                    disabled={busy}
                    onClick={() => onDelete(item)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="side-section">
        <div className="side-head">
          <span className="label">발행된 글</span>
          {published && (
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label="글 목록 새로고침"
              title="새로고침"
              disabled={busy}
              onClick={onLoadPublished}
            >
              <RefreshIcon size={14} />
            </button>
          )}
        </div>
        <form className="url-form" onSubmit={submitUrl}>
          <input
            aria-label="글 주소로 불러오기"
            placeholder="글 주소 붙여넣기"
            title="/memoir/2025-03-SWMaestro 처럼 경로만 넣거나 전체 URL을 붙여넣으세요"
            value={url}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="submit" className="btn btn-sm" disabled={busy || !url.trim()}>
            열기
          </button>
        </form>
        {!published ? (
          <button type="button" className="btn btn-block" disabled={busy} onClick={onLoadPublished}>
            글 목록 불러오기
          </button>
        ) : (
          <>
            <div className="cat-tabs" role="tablist" aria-label="카테고리">
              {CATEGORIES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={category === item.key}
                  className={`cat-tab${category === item.key ? ' is-active' : ''}`}
                  disabled={busy}
                  onClick={() => onSelectCategory(item.key)}
                >
                  <span className={`cat-dot ${item.accent}`} aria-hidden="true" />
                  {item.label}
                  <span className="count">{counts[item.key] ?? 0}</span>
                </button>
              ))}
            </div>
            {category && (
              <>
                {published.filter((item) => item.category === category).length > 0 && (
                  <input
                    className="side-search"
                    aria-label="발행한 글 검색"
                    placeholder={`${categoryLabel(category)} 글 제목 검색`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                )}
                {entries.length === 0 ? (
                  <p className="side-empty">
                    {query
                      ? '검색 결과가 없습니다.'
                      : `${categoryLabel(category)} 카테고리에 발행된 글이 없습니다.`}
                  </p>
                ) : (
                  <ul className="side-list">
                    {entries.map((item) => {
                      const loading = item.title === null && !item.error
                      const editing = editedPaths.has(item.path)
                      return (
                        <li key={item.path} className="side-item">
                          <button
                            type="button"
                            className="side-item-main"
                            disabled={busy || !!item.error}
                            onClick={() => onImport({ path: item.path })}
                          >
                            <span className={`side-title${loading ? ' is-loading' : ''}`}>
                              {item.title ?? item.slug}
                            </span>
                            <span className="side-meta">
                              {item.error
                                ? item.error
                                : `${item.date ?? '날짜 없음'} · ${item.draft ? '미발행 파일' : editing ? '수정 중' : '수정하기'}`}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </section>

      <footer className="sidebar-foot">
        <span className="user-email" title={email}>
          {email}
        </span>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          onClick={onTheme}
          aria-label={theme === 'dark' ? '라이트 모드로 전환 (메뉴)' : '다크 모드로 전환 (메뉴)'}
        >
          {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onLogout}>
          로그아웃
        </button>
      </footer>
    </aside>
  )
}
