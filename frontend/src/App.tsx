import { useCallback, useEffect, useRef, useState } from 'react'
import { request, newPost, type Asset, type Draft, type Post, type Session } from './api'
import LoginScreen from './components/LoginScreen'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import Editor, { type UploadedImage } from './components/Editor'
import EmptyState from './components/EmptyState'

export type Theme = 'light' | 'dark'

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode or blocked storage */
  }
}

function currentTheme(): Theme {
  const explicit = document.documentElement.getAttribute('data-theme')
  if (explicit === 'dark' || explicit === 'light') return explicit
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const UNSAVED = '저장하지 않은 수정 내용이 있습니다. 다른 글로 이동할까요?'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [post, setPost] = useState<Post>(newPost)
  const [assets, setAssets] = useState<Asset[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [theme, setThemeState] = useState<Theme>(currentTheme)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const linkInput = useRef<HTMLInputElement>(null)
  const dirty = draft !== null && JSON.stringify(post) !== JSON.stringify(draft.post)

  const api = useCallback(
    <T,>(path: string, method = 'GET', body?: unknown) =>
      request<T>(path, { method, body, csrf: session?.csrf }),
    [session]
  )

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
    fetch('/studio/api/session')
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
  }, [session, api])

  useEffect(() => {
    if (!session) return
    const refresh = () => {
      fetch('/studio/api/session')
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
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setThemeState(currentTheme())
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  function toggleTheme() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    writeStorage('studio.theme', next)
    setThemeState(next)
  }

  function remember(value: Draft) {
    setDraft(value)
    setPost(value.post)
    setDrafts((all) => [value, ...all.filter((item) => item.id !== value.id)])
  }

  function leaveEditor() {
    setDraft(null)
    setPost(newPost())
    setAssets([])
  }

  async function open(value: Draft) {
    if (dirty && !window.confirm(UNSAVED)) return
    const [latest, images] = await Promise.all([
      api<Draft>(`/drafts/${value.id}`),
      api<Asset[]>(`/drafts/${value.id}/assets`),
    ])
    remember(latest)
    setAssets(images)
    setSidebarOpen(false)
  }

  async function createDraft() {
    if (dirty && !window.confirm(UNSAVED)) return
    const value = await api<Draft>('/drafts', 'POST', newPost())
    remember(value)
    setAssets([])
    setSidebarOpen(false)
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

  async function upload(files: File[]): Promise<UploadedImage[]> {
    if (!draft) return []
    const uploaded: UploadedImage[] = []
    const accepted = files.filter((file) => file.type.startsWith('image/'))
    if (!accepted.length) throw new Error('PNG, JPEG, GIF, WebP 이미지만 추가할 수 있습니다.')
    for (const file of accepted) {
      const form = new FormData()
      form.append('file', file)
      const asset = await api<Asset>(`/drafts/${draft.id}/assets`, 'POST', form)
      setAssets((all) => (all.some((item) => item.path === asset.path) ? all : [...all, asset]))
      const label =
        file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]+/g, ' ')
          .trim() || '이미지 설명'
      uploaded.push({ ...asset, alt: label })
    }
    setStatus('이미지를 추가했습니다. 초안을 저장해 주세요.')
    return uploaded
  }

  async function uploadImages(files: File[]) {
    let uploaded: UploadedImage[] = []
    await run(async () => {
      uploaded = await upload(files)
    })
    return uploaded
  }

  async function removeDraft(item: Draft) {
    const name = item.post.title || '제목 없는 글'
    const message = item.source_path
      ? `'${name}' 수정 초안을 삭제할까요?\nGitHub에 발행된 글은 그대로 남습니다.`
      : `'${name}' 초안을 삭제할까요?\n저장된 본문과 이미지가 함께 지워집니다.`
    if (!window.confirm(message)) return
    await api(`/drafts/${item.id}`, 'DELETE')
    setDrafts((all) => all.filter((entry) => entry.id !== item.id))
    if (draft?.id === item.id) leaveEditor()
    setStatus('초안을 삭제했습니다.')
  }

  async function importPost(url: string) {
    if (dirty && !window.confirm(UNSAVED)) return
    const value = await api<Draft>('/posts/import', 'POST', { url })
    const images = await api<Asset[]>(`/drafts/${value.id}/assets`)
    remember(value)
    setAssets(images)
    setSidebarOpen(false)
    setStatus(`'${value.post.title}' 글을 불러왔습니다. 제목·본문·설명·태그·표지를 고칠 수 있습니다.`)
  }

  async function reloadOriginal() {
    if (!draft) return
    if (!window.confirm('현재 수정 내용은 복구용 사본으로 보관하고, GitHub의 최신 원본을 불러올까요?')) return
    const saved = await save()
    const result = await api<{ draft: Draft; backup: Draft }>(`/drafts/${saved.id}/reload`, 'POST', {
      revision: saved.revision,
    })
    remember(result.draft)
    setDrafts((all) => [result.backup, ...all])
    setAssets(await api<Asset[]>(`/drafts/${saved.id}/assets`))
    setStatus('최신 원본을 불러왔습니다. 이전 수정 내용은 복구용 사본으로 보관했습니다.')
  }

  async function logout() {
    if (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 로그아웃할까요?')) return
    await api('/logout', 'POST')
    setSession(null)
    leaveEditor()
    setDrafts([])
  }

  const saveDraft = () =>
    run(async () => {
      await save()
      setStatus('초안을 비공개로 저장했습니다.')
    })

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (draft && !busy) void saveDraft()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  function change<K extends keyof Post>(key: K, value: Post[K]) {
    setPost((current) => ({ ...current, [key]: value }))
  }

  if (!loaded)
    return (
      <main className="login login-loading">
        <p className="muted">불러오는 중…</p>
      </main>
    )
  if (!session) return <LoginScreen error={error} blogUrl="https://www.gaeng02.com" />

  return (
    <div className={`app${sidebarOpen ? ' sidebar-open' : ''}`}>
      <TopBar
        session={session}
        draft={draft}
        dirty={dirty}
        busy={busy}
        theme={theme}
        onTheme={toggleTheme}
        onMenu={() => setSidebarOpen((open) => !open)}
        onSave={saveDraft}
        onPublish={() => run(publish)}
        onLogout={() => run(logout)}
      />
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        drafts={drafts}
        current={draft}
        busy={busy}
        onNew={() => run(createDraft)}
        onOpen={(item) => run(() => open(item))}
        onDelete={(item) => run(() => removeDraft(item))}
        linkRef={linkInput}
        onImport={(url) => run(() => importPost(url))}
        email={session.email}
        theme={theme}
        onTheme={toggleTheme}
        onLogout={() => run(logout)}
      />
      <main className="main">
        {error && (
          <div className="alert alert-error main-alert" role="alert">
            <span>{error}</span>
            <a href="/studio/auth/login" target="_blank" rel="noopener noreferrer">
              로그인 창 열기
            </a>
          </div>
        )}
        {status && (
          <div className="toast" role="status">
            {status}
          </div>
        )}
        {!draft ? (
          <EmptyState
            drafts={drafts}
            busy={busy}
            onNew={() => run(createDraft)}
            onOpen={(item) => run(() => open(item))}
            onBrowse={() => {
              setSidebarOpen(true)
              linkInput.current?.focus({ preventScroll: true })
            }}
          />
        ) : (
          <Editor
            draft={draft}
            post={post}
            assets={assets}
            busy={busy}
            dirty={dirty}
            blogUrl={session.blog_url}
            onChange={change}
            onUpload={uploadImages}
            onReload={() => run(reloadOriginal)}
          />
        )}
      </main>
      <button className="scrim" aria-label="메뉴 닫기" tabIndex={-1} onClick={() => setSidebarOpen(false)} />
    </div>
  )
}
