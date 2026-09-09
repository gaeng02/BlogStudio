import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkHtml from 'remark-html'
import './style.css'

type Post = {
  category: string
  title: string
  slug: string
  date: string
  description: string
  tags: string[]
  cover: string
  body: string
}
type Draft = {
  id: string
  revision: number
  post: Post
  source_path: string | null
  updated_at: string
  published_revision: number | null
  commit_sha: string | null
  publish_pending: boolean
}
type Published = {
  path: string
  title: string
  category?: string
  date?: string
  draft?: boolean
  error?: string
}
type Session = { email: string; csrf: string; blog_url: string }
type Asset = { path: string; preview: string }
const categories = [
  ['try-tech', '기술'],
  ['memoir', '회고'],
  ['paper', '논문'],
  ['book', '책'],
]
const apiBase = '/studio/api'
const markdown = remark().use(remarkGfm).use(remarkHtml)

function newPost(): Post {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return { category: 'try-tech', title: '', slug: '', date, description: '', tags: [], cover: '', body: '' }
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [published, setPublished] = useState<Published[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [post, setPost] = useState<Post>(newPost)
  const [assets, setAssets] = useState<Asset[]>([])
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const editor = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const dirty = draft !== null && JSON.stringify(post) !== JSON.stringify(draft.post)

  async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (session) headers['X-CSRF-Token'] = session.csrf
    if (data && !(data instanceof FormData)) headers['Content-Type'] = 'application/json'
    const response = await fetch(apiBase + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data),
    })
    const result = await response
      .json()
      .catch(() => ({ detail: '서버 응답을 확인하지 못했습니다. 작성 내용은 화면에 유지됩니다.' }))
    if (!response.ok) {
      if (response.status === 401)
        throw new Error('로그인이 만료되었습니다. 작성 내용을 복사해 보관한 뒤 다시 로그인해 주세요.')
      throw new Error(
        typeof result.detail === 'string' ? result.detail : '입력한 글 정보와 파일 형식을 확인해 주세요.'
      )
    }
    return result
  }

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Recover publication state without discarding the text in the editor.
      if (draft) {
        try {
          const latest = await api<Draft>(`/drafts/${draft.id}`)
          if (latest.publish_pending) setDraft(latest)
        } catch {
          /* Preserve local text on connection failure. */
        }
      }
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    fetch(apiBase + '/session')
      .then(async (response) => {
        if (response.ok) setSession(await response.json())
        else if (response.status !== 401) setError('서버에 연결할 수 없습니다.')
      })
      .catch(() => setError('서버에 연결할 수 없습니다.'))
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    if (session)
      api<Draft[]>('/drafts')
        .then(setDrafts)
        .catch((e) => setError(e.message))
  }, [session])

  useEffect(() => {
    if (!session) return
    const refresh = () => {
      fetch(apiBase + '/session')
        .then(async (response) => {
          if (response.ok) setSession(await response.json())
        })
        .catch(() => {})
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [session])

  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [dirty])

  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      const result = await markdown.process(post.body)
      const doc = new DOMParser().parseFromString(result.toString(), 'text/html')
      doc.querySelectorAll('img').forEach((img) => {
        const path = img.getAttribute('src') || ''
        const asset = assets.find((item) => item.path === path)
        if (asset) img.setAttribute('src', asset.preview)
        else if (path.startsWith('/assets/')) img.setAttribute('src', (session?.blog_url || '') + path)
      })
      doc.querySelectorAll('a').forEach((link) => {
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
      })
      if (active) setPreview(doc.body.innerHTML)
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [post.body, assets, session?.blog_url])

  function remember(value: Draft) {
    setDraft(value)
    setPost(value.post)
    setDrafts((all) => [value, ...all.filter((item) => item.id !== value.id)])
  }

  async function open(value: Draft) {
    if (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 다른 글로 이동할까요?')) return
    const [latest, images] = await Promise.all([
      api<Draft>(`/drafts/${value.id}`),
      api<Asset[]>(`/drafts/${value.id}/assets`),
    ])
    remember(latest)
    setAssets(images)
  }

  async function save(): Promise<Draft> {
    if (!draft) throw new Error('먼저 새 글을 만들어 주세요.')
    const value = await api<Draft>(`/drafts/${draft.id}`, 'PUT', { revision: draft.revision, post })
    remember(value)
    return value
  }

  async function publish() {
    const pendingWithEdits = draft?.publish_pending && dirty
    const local = post
    const saved = draft?.publish_pending ? draft : await save()
    const result = await api<Draft>(`/drafts/${saved.id}/publish`, 'POST', { revision: saved.revision })
    remember(result)
    if (pendingWithEdits) setPost(local)
    setStatus('GitHub에 반영했습니다. 공개 블로그는 GitHub Actions 배포가 완료되면 갱신됩니다.')
  }

  async function upload(files: File[]) {
    if (!draft) return
    for (const file of files) {
      const form = new FormData()
      form.append('file', file)
      const asset = await api<Asset>(`/drafts/${draft.id}/assets`, 'POST', form)
      setAssets((all) => [...all, asset])
      const snippet = `\n![이미지 설명](${asset.path})\n`
      const selection = editor.current?.selectionStart
      setPost((current) => {
        const position = selection ?? current.body.length
        return { ...current, body: current.body.slice(0, position) + snippet + current.body.slice(position) }
      })
    }
    setStatus('이미지를 추가했습니다. 초안을 저장해 주세요.')
  }

  function change<K extends keyof Post>(key: K, value: Post[K]) {
    setPost((current) => ({ ...current, [key]: value }))
  }

  if (!loaded)
    return (
      <main className="login">
        <p>불러오는 중…</p>
      </main>
    )
  if (!session)
    return (
      <main className="login">
        <div className="login-card">
          <p className="eyebrow">TRACE OF THOUGHT</p>
          <h1>BlogStudio</h1>
          <p>생각을 글로 남기는 개인 작업 공간.</p>
          <a className="button primary" href="/studio/auth/login">
            Google 계정으로 로그인
          </a>
          <p className="muted">등록된 관리자 계정만 사용할 수 있습니다.</p>
          {(error || new URLSearchParams(location.search).get('error')) && (
            <p role="alert" className="error">
              {error || '로그인하지 못했습니다. 허용된 Google 계정인지 확인하고 다시 시도해 주세요.'}
            </p>
          )}
        </div>
      </main>
    )

  const publicUrl = `${session.blog_url}/${post.category}/${encodeURIComponent(post.slug)}`
  return (
    <div className="app">
      <header>
        <div>
          <p className="eyebrow">TRACE OF THOUGHT</p>
          <h1>BlogStudio</h1>
        </div>
        <div className="actions">
          <span className="muted">{session.email}</span>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (dirty && !confirm('저장하지 않은 수정 내용이 있습니다. 로그아웃할까요?')) return
                await api('/logout', 'POST')
                setSession(null)
                setDraft(null)
                setPost(newPost())
              })
            }
          >
            로그아웃
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside>
          <button
            className="primary full"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (dirty && !confirm('저장하지 않은 수정 내용이 있습니다. 새 글로 이동할까요?')) return
                const value = await api<Draft>('/drafts', 'POST', newPost())
                remember(value)
                setAssets([])
              })
            }
          >
            ＋ 새 글 쓰기
          </button>
          <h2>내 초안</h2>
          {drafts.length === 0 && <p className="muted">아직 저장한 초안이 없습니다.</p>}
          {drafts.map((item) => (
            <button
              key={item.id}
              className={`draft ${draft?.id === item.id ? 'active' : ''}`}
              disabled={busy}
              onClick={() => run(() => open(item))}
            >
              <strong>{item.post.title || '제목 없는 글'}</strong>
              <span>
                {item.published_revision === item.revision
                  ? '발행 반영됨'
                  : item.source_path
                    ? '기존 글 수정'
                    : '비공개 초안'}
              </span>
            </button>
          ))}
          <h2>GitHub에 저장된 글</h2>
          <button
            className="full"
            disabled={busy}
            onClick={() => run(async () => setPublished(await api<Published[]>('/posts')))}
          >
            글 목록 불러오기
          </button>
          {published && (
            <>
              <input
                aria-label="발행한 글 검색"
                placeholder="제목 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {published
                .filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
                .map((item) => (
                  <button
                    key={item.path}
                    className="draft"
                    disabled={busy || !!item.error}
                    onClick={() =>
                      run(async () => {
                        if (dirty && !confirm('저장하지 않은 수정 내용이 있습니다. 다른 글로 이동할까요?'))
                          return
                        const value = await api<Draft>('/posts/import', 'POST', { path: item.path })
                        setAssets(await api<Asset[]>(`/drafts/${value.id}/assets`))
                        remember(value)
                      })
                    }
                  >
                    <strong>{item.title}</strong>
                    <span>{item.error || `${item.date} · ${item.draft ? '미발행 파일' : '수정하기'}`}</span>
                  </button>
                ))}
            </>
          )}
        </aside>
        <main className="editor-main">
          {error && (
            <div className="notice error" role="alert">
              {error}{' '}
              <a href="/studio/auth/login" target="_blank" rel="noopener noreferrer">
                로그인 창 열기
              </a>
            </div>
          )}
          {status && (
            <div className="notice" role="status">
              {status}
            </div>
          )}
          {!draft ? (
            <section className="empty">
              <h2>어떤 생각을 남길까요?</h2>
              <p>새 글을 쓰거나 GitHub에 저장된 글을 불러와 수정하세요.</p>
            </section>
          ) : (
            <>
              <div className="toolbar">
                <div>
                  <strong>{draft.source_path ? '발행한 글 수정' : '새 글'}</strong>
                  <span className="muted">{dirty ? ' · 저장하지 않은 수정 내용' : ' · 초안 저장됨'}</span>
                </div>
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await save()
                        setStatus('초안을 비공개로 저장했습니다.')
                      })
                    }
                  >
                    초안 저장
                  </button>
                  <button className="primary" disabled={busy} onClick={() => run(publish)}>
                    {busy ? '처리 중…' : draft.source_path ? '수정 발행' : '발행'}
                  </button>
                </div>
              </div>
              <fieldset disabled={busy} className="metadata">
                <label className="title-field">
                  제목
                  <input
                    value={post.title}
                    onChange={(event) => change('title', event.target.value)}
                    placeholder="글의 제목"
                    maxLength={200}
                  />
                </label>
                <label>
                  카테고리
                  <select
                    value={post.category}
                    disabled={!!draft.source_path}
                    onChange={(event) => change('category', event.target.value)}
                  >
                    {categories.map(([key, name]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  글 주소
                  <input
                    value={post.slug}
                    disabled={!!draft.source_path}
                    onChange={(event) => change('slug', event.target.value)}
                    placeholder="my-first-post"
                  />
                </label>
                <label>
                  최초 발행일
                  <input
                    type="date"
                    value={post.date}
                    disabled={!!draft.source_path}
                    onChange={(event) => change('date', event.target.value)}
                  />
                </label>
                <label className="wide">
                  검색 결과에 표시할 설명
                  <textarea
                    value={post.description}
                    onChange={(event) => change('description', event.target.value)}
                    placeholder="이 글이 다루는 내용을 간결하게 적어 주세요."
                    maxLength={500}
                  />
                </label>
                <label>
                  태그
                  <input
                    value={post.tags.join(',')}
                    onChange={(event) => change('tags', event.target.value.split(','))}
                    placeholder="태그1,태그2"
                  />
                </label>
                <label className="cover-field">
                  표지 이미지 주소
                  <input
                    value={post.cover}
                    onChange={(event) => change('cover', event.target.value)}
                    placeholder="https://… 또는 /assets/images/…"
                  />
                </label>
              </fieldset>
              <div className="document-tools">
                <span className="muted">Markdown · 이미지를 드래그하거나 붙여넣을 수 있습니다.</span>
                <button disabled={busy} onClick={() => picker.current?.click()}>
                  이미지 추가
                </button>
                <input
                  ref={picker}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files || [])
                    void run(() => upload(files))
                    event.target.value = ''
                  }}
                />
              </div>
              {draft.publish_pending && (
                <p className="notice">
                  앞선 발행 결과를 확인해야 합니다. 발행 버튼을 다시 누르면 중복 발행 없이 결과를 확인합니다.
                </p>
              )}
              <div className="document-grid">
                <section>
                  <h2>작성</h2>
                  <textarea
                    aria-label="Markdown 본문"
                    className="body-editor"
                    ref={editor}
                    value={post.body}
                    disabled={busy}
                    onChange={(event) => change('body', event.target.value)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      if (event.dataTransfer.files.length) {
                        event.preventDefault()
                        void run(() => upload(Array.from(event.dataTransfer.files)))
                      }
                    }}
                    onPaste={(event) => {
                      const files = Array.from(event.clipboardData.files)
                      if (files.length) {
                        event.preventDefault()
                        void run(() => upload(files))
                      }
                    }}
                    placeholder="## 시작하며"
                    spellCheck={false}
                  />
                </section>
                <section>
                  <h2>미리보기</h2>
                  <article className="prose">
                    <h1>{post.title || '제목을 입력하세요'}</h1>
                    <p className="muted">{post.description}</p>
                    <div dangerouslySetInnerHTML={{ __html: preview }} />
                  </article>
                </section>
              </div>
              {assets.length > 0 && (
                <div className="attachments">
                  {assets.map((asset) => (
                    <button
                      key={asset.path}
                      disabled={busy}
                      onClick={() => change('cover', asset.path)}
                      title="표지로 사용"
                    >
                      <img src={asset.preview} alt="업로드한 이미지" />
                      <span>표지로 사용</span>
                    </button>
                  ))}
                </div>
              )}
              {draft.source_path && (
                <p className="muted">
                  기존 글의 주소와 최초 발행일은 유지됩니다.{' '}
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    공개 글 확인 ↗
                  </a>{' '}
                  ·{' '}
                  <a
                    href="https://github.com/gaeng02/gaeng02.github.io/actions"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    배포 상태 확인 ↗
                  </a>
                </p>
              )}
              {draft.source_path && (
                <button
                  disabled={busy || draft.publish_pending}
                  onClick={() =>
                    run(async () => {
                      if (
                        !confirm(
                          '현재 수정 내용은 복구용 사본으로 보관하고, GitHub의 최신 원본을 불러올까요?'
                        )
                      )
                        return
                      const saved = await save()
                      const result = await api<{ draft: Draft; backup: Draft }>(
                        `/drafts/${saved.id}/reload`,
                        'POST',
                        { revision: saved.revision }
                      )
                      remember(result.draft)
                      setDrafts((all) => [result.backup, ...all])
                      setAssets(await api<Asset[]>(`/drafts/${saved.id}/assets`))
                      setStatus('최신 원본을 불러왔습니다. 이전 수정 내용은 복구용 사본으로 보관했습니다.')
                    })
                  }
                >
                  GitHub 최신 원본 다시 불러오기
                </button>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
