import type { Draft, Session } from '../api'
import type { Theme, ViewMode } from '../App'
import { MenuIcon, MoonIcon, SunIcon } from './Icons'
import logo from '../assets/logo.png'

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'write', label: '편집' },
  { key: 'split', label: '나란히' },
  { key: 'preview', label: '미리보기' },
]

export default function TopBar({
  session,
  draft,
  dirty,
  busy,
  view,
  theme,
  onView,
  onTheme,
  onMenu,
  onSave,
  onPublish,
  onLogout,
}: {
  session: Session
  draft: Draft | null
  dirty: boolean
  busy: boolean
  view: ViewMode
  theme: Theme
  onView: (view: ViewMode) => void
  onTheme: () => void
  onMenu: () => void
  onSave: () => void
  onPublish: () => void
  onLogout: () => void
}) {
  const state = !draft
    ? ''
    : dirty
      ? '저장하지 않은 변경'
      : draft.publish_pending
        ? '발행 확인 필요'
        : '저장됨'
  return (
    <header className="topbar">
      <button type="button" className="icon-btn topbar-menu" aria-label="메뉴 열기" onClick={onMenu}>
        <MenuIcon />
      </button>
      <a className="brand" href="/studio/" aria-label="BlogStudio 홈">
        <img className="brand-mark" src={logo} alt="" />
        <span className="brand-name">Trace of Thought</span>
        <span className="brand-studio">Studio</span>
      </a>
      {draft && (
        <div className="topbar-doc" aria-live="polite">
          <span className="topbar-doc-title">{draft.post.title || '제목 없는 글'}</span>
          <span className={`topbar-doc-state${dirty ? ' is-dirty' : ''}`}>{state}</span>
        </div>
      )}
      <div className="topbar-actions">
        {draft && (
          <div className="seg" role="group" aria-label="보기 방식">
            {VIEWS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`seg-btn${view === item.key ? ' is-active' : ''}`}
                aria-pressed={view === item.key}
                onClick={() => onView(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {draft && (
          <>
            <button type="button" className="btn" disabled={busy} onClick={onSave} title="⌘S / Ctrl+S">
              초안 저장
            </button>
            <button type="button" className="btn btn-solid" disabled={busy} onClick={onPublish}>
              {busy ? '처리 중…' : draft.source_path ? '수정 발행' : '발행'}
            </button>
          </>
        )}
        <button
          type="button"
          className="icon-btn theme-btn"
          onClick={onTheme}
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          title="테마 전환"
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <div className="user">
          <span className="user-email" title={session.email}>
            {session.email}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </div>
    </header>
  )
}
