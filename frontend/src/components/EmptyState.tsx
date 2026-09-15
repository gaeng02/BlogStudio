import { draftState, relativeTime, type Draft } from '../api'
import { PlusIcon, SearchIcon } from './Icons'

export default function EmptyState({
  drafts,
  busy,
  onNew,
  onOpen,
  onBrowse,
}: {
  drafts: Draft[]
  busy: boolean
  onNew: () => void
  onOpen: (draft: Draft) => void
  onBrowse: () => void
}) {
  const recent = drafts.slice(0, 3)
  return (
    <section className="empty">
      <p className="eyebrow">Trace of Thought</p>
      <h1 className="empty-title">어떤 생각을 남길까요?</h1>
      <p className="empty-lede">
        새 글을 쓰거나, 발행된 글을 불러와 고치세요. 초안은 저장하기 전까지 서버에 남지 않습니다.
      </p>
      <div className="empty-actions">
        <button type="button" className="empty-card" disabled={busy} onClick={onNew}>
          <span className="empty-card-icon">
            <PlusIcon size={20} />
          </span>
          <span className="empty-card-title">새 글 쓰기</span>
          <span className="empty-card-desc">제목·본문·태그를 적고 비공개 초안으로 저장합니다.</span>
        </button>
        <button type="button" className="empty-card" disabled={busy} onClick={onBrowse}>
          <span className="empty-card-icon">
            <SearchIcon size={20} />
          </span>
          <span className="empty-card-title">발행된 글 고치기</span>
          <span className="empty-card-desc">카테고리에서 고르거나 글 주소를 붙여넣어 불러옵니다.</span>
        </button>
      </div>
      {recent.length > 0 && (
        <div className="empty-recent">
          <div className="side-head">
            <span className="label">최근 초안</span>
          </div>
          <ul className="side-list">
            {recent.map((item) => {
              const state = draftState(item)
              return (
                <li key={item.id} className="side-item">
                  <button
                    type="button"
                    className="side-item-main"
                    disabled={busy}
                    onClick={() => onOpen(item)}
                  >
                    <span className="side-title">{item.post.title || '제목 없는 글'}</span>
                    <span className="side-meta">
                      <span className={`state-dot ${state.key}`} aria-hidden="true" />
                      {state.label} · {relativeTime(item.updated_at)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
