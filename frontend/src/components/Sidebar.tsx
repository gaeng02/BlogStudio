import { useState, type FormEvent, type RefObject } from 'react'
import { draftState, relativeTime, type Draft } from '../api'
import { CloseIcon, MoonIcon, PlusIcon, SunIcon, TrashIcon } from './Icons'

export default function Sidebar({
  open,
  onClose,
  drafts,
  current,
  busy,
  onNew,
  onOpen,
  onDelete,
  linkRef,
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
  linkRef: RefObject<HTMLInputElement | null>
  onImport: (url: string) => void
  email: string
  theme: 'light' | 'dark'
  onTheme: () => void
  onLogout: () => void
}) {
  const [url, setUrl] = useState('')

  function submitUrl(event: FormEvent) {
    event.preventDefault()
    const value = url.trim()
    if (!value) return
    onImport(value)
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
        </div>
        <form className="url-form" onSubmit={submitUrl}>
          <input
            ref={linkRef}
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
