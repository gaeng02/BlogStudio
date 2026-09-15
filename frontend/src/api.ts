export type Category = 'try-tech' | 'memoir' | 'paper' | 'book'
export type Accent = 'try' | 'memoir' | 'paper' | 'book'

export const CATEGORIES: { key: Category; label: string; accent: Accent }[] = [
  { key: 'try-tech', label: '기술', accent: 'try' },
  { key: 'memoir', label: '회고', accent: 'memoir' },
  { key: 'paper', label: '논문', accent: 'paper' },
  { key: 'book', label: '책', accent: 'book' },
]

export function categoryLabel(key: string): string {
  return CATEGORIES.find((item) => item.key === key)?.label ?? key
}

export function categoryAccent(key: string): Accent {
  return CATEGORIES.find((item) => item.key === key)?.accent ?? 'try'
}

export type Post = {
  category: string
  title: string
  slug: string
  date: string
  description: string
  tags: string[]
  cover: string
  body: string
}

export type Draft = {
  id: string
  revision: number
  post: Post
  source_path: string | null
  updated_at: string
  published_revision: number | null
  commit_sha: string | null
  publish_pending: boolean
}

export type PublishedEntry = {
  path: string
  category: Category
  slug: string
  date: string | null
  title: string | null
  draft: boolean | null
  error?: string
}

export type Session = { email: string; csrf: string; blog_url: string }
export type Asset = { path: string; preview: string }

export const apiBase = '/studio/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; csrf?: string } = {}
): Promise<T> {
  const { method = 'GET', body, csrf } = options
  const headers: Record<string, string> = {}
  if (csrf) headers['X-CSRF-Token'] = csrf
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  const response = await fetch(apiBase + path, {
    method,
    headers,
    credentials: 'same-origin',
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response
    .json()
    .catch(() => ({ detail: '서버 응답을 확인하지 못했습니다. 작성 내용은 화면에 유지됩니다.' }))
  if (!response.ok) {
    if (response.status === 401)
      throw new ApiError(401, '로그인이 만료되었습니다. 작성 내용을 복사해 보관한 뒤 다시 로그인해 주세요.')
    throw new ApiError(
      response.status,
      typeof result.detail === 'string' ? result.detail : '입력한 글 정보와 파일 형식을 확인해 주세요.'
    )
  }
  return result as T
}

export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function newPost(): Post {
  return {
    category: 'try-tech',
    title: '',
    slug: '',
    date: today(),
    description: '',
    tags: [],
    cover: '',
    body: '',
  }
}

export type DraftState = 'pending' | 'published' | 'editing' | 'private'

export function draftState(draft: Draft): { key: DraftState; label: string } {
  if (draft.publish_pending) return { key: 'pending', label: '발행 확인 필요' }
  if (draft.published_revision === draft.revision) return { key: 'published', label: '발행 반영됨' }
  if (draft.source_path) return { key: 'editing', label: '기존 글 수정' }
  return { key: 'private', label: '비공개 초안' }
}

export function relativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ''
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return '방금 전'
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}일 전`
  const date = new Date(time)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}
