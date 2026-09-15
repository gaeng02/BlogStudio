import { test, expect, type Page } from '@playwright/test'

const SESSION = { email: 'sondin144@gmail.com', csrf: 'csrf', blog_url: 'https://www.gaeng02.com' }

function publishedDraft() {
  return {
    id: 'draft-1',
    revision: 1,
    source_path: 'content/memoir/2025-03-SWMaestro.md',
    updated_at: '2026-09-09T00:00:00Z',
    published_revision: null as number | null,
    commit_sha: null as string | null,
    publish_pending: false,
    post: {
      title: '기존 글',
      category: 'memoir',
      date: '2025-03-31',
      slug: '2025-03-SWMaestro',
      body: '원본 내용',
      description: '글 설명',
      tags: ['회고'],
      cover: '',
    },
  }
}

const LIGHT_LIST = [
  {
    path: 'content/memoir/2025-03-SWMaestro.md',
    category: 'memoir',
    slug: '2025-03-SWMaestro',
    date: null,
    title: null,
    draft: null,
  },
  {
    path: 'content/try-tech/2026-01-15-sample.md',
    category: 'try-tech',
    slug: 'sample',
    date: '2026-01-15',
    title: null,
    draft: null,
  },
]

test('login screen uses Google and excludes search engines', async ({ page }) => {
  await page.route('**/studio/api/session', (route) =>
    route.fulfill({ status: 401, json: { detail: '로그인 필요' } })
  )
  await page.goto('/studio/')
  await expect(page.getByRole('link', { name: 'Google 계정으로 로그인' })).toHaveAttribute(
    'href',
    '/studio/auth/login'
  )
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  await page.screenshot({ path: 'test-results/login-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true })
})

test('browse published articles by category, sanitize the preview and recover an uncertain publish', async ({
  page,
}) => {
  let draft = publishedDraft()
  let saved = 0
  let publishRequests = 0
  const categoryRequests: string[] = []
  await page.route('**/studio/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/studio/api', '')
    const method = route.request().method()
    if (path === '/session') return route.fulfill({ json: SESSION })
    if (path === '/drafts' && method === 'GET') return route.fulfill({ json: [] })
    if (path === '/posts') {
      const category = url.searchParams.get('category')
      if (!category) return route.fulfill({ json: LIGHT_LIST })
      categoryRequests.push(category)
      if (category === 'memoir')
        return route.fulfill({
          json: [{ ...LIGHT_LIST[0], title: draft.post.title, date: '2025-03-31', draft: false }],
        })
      return route.fulfill({ json: [{ ...LIGHT_LIST[1], title: 'sample', draft: true }] })
    }
    if (path === '/posts/import') {
      expect(route.request().postDataJSON()).toEqual({ path: draft.source_path })
      return route.fulfill({ json: draft })
    }
    if (path.endsWith('/assets')) return route.fulfill({ json: [] })
    if (path === '/drafts/draft-1' && method === 'PUT') {
      expect(route.request().headers()['x-csrf-token']).toBe('csrf')
      draft = { ...draft, revision: draft.revision + 1, post: route.request().postDataJSON().post }
      saved++
      return route.fulfill({ json: draft })
    }
    if (path === '/drafts/draft-1/publish') {
      publishRequests++
      if (publishRequests === 1) {
        draft.publish_pending = true
        return route.fulfill({ status: 502, json: { detail: 'GitHub 응답 확인 실패' } })
      }
      draft = { ...draft, publish_pending: false, published_revision: draft.revision, commit_sha: 'commit' }
      return route.fulfill({ json: draft })
    }
    if (path === '/drafts/draft-1') return route.fulfill({ json: draft })
    return route.fulfill({ status: 404, json: { detail: path } })
  })
  await page.goto('/studio/')
  await expect(page.getByRole('heading', { name: '어떤 생각을 남길까요?' })).toBeVisible()
  await page.getByRole('button', { name: '글 목록 불러오기' }).click()
  // The tree listing is grouped by category; titles are fetched for one category at a time.
  await expect(page.getByRole('tab', { name: /기술.*1/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: /sample.*미발행 파일/ })).toBeVisible()
  await page.getByRole('tab', { name: /회고/ }).click()
  await expect(page.getByRole('button', { name: /기존 글.*2025-03-31.*수정하기/ })).toBeVisible()
  expect(categoryRequests).toEqual(['try-tech', 'memoir'])
  await page.getByRole('button', { name: /기존 글.*수정하기/ }).click()
  await expect(page.getByLabel('글 주소', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('최초 발행일', { exact: true })).toBeDisabled()
  await page.getByLabel('제목', { exact: true }).fill('수정한 글')
  await page
    .getByRole('textbox', { name: 'Markdown 본문' })
    .fill(
      '## 수정 내용\n\n<script>window.previewUnsafe=true</script>\n\n<details><summary>접힌 항목</summary>안쪽</details>\n\n본문입니다.'
    )
  await expect(page.locator('.prose h2')).toHaveText('수정 내용')
  await expect(page.locator('.prose details summary')).toHaveText('접힌 항목')
  expect(await page.evaluate(() => (window as any).previewUnsafe)).toBeUndefined()
  await page.getByRole('button', { name: '수정 발행', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('GitHub 응답 확인 실패')
  await expect(page.getByRole('button', { name: '수정 발행', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '수정 발행', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('GitHub에 반영했습니다')
  expect(saved).toBe(1)
  expect(publishRequests).toBe(2)
  expect(draft.post.slug).toBe('2025-03-SWMaestro')
  expect(draft.post.date).toBe('2025-03-31')
  await page.screenshot({ path: 'test-results/editor-published.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(350) // let the drawer's slide-out transition finish
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '메뉴 열기' }).click()
  await expect(page.getByRole('complementary', { name: '글 목록' })).toBeVisible()
  await page.waitForTimeout(350)
  await page.screenshot({ path: 'test-results/editor-mobile-menu.png' })
  await page.getByRole('button', { name: '메뉴 닫기' }).first().click()
  await page.waitForTimeout(350)
  await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeVisible()
})

test('open an article by its public URL and delete the draft', async ({ page }) => {
  const draft = publishedDraft()
  let deleted = 0
  await page.route('**/studio/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/studio/api', '')
    const method = route.request().method()
    if (path === '/session') return route.fulfill({ json: SESSION })
    if (path === '/drafts' && method === 'GET') return route.fulfill({ json: [] })
    if (path === '/posts/import') {
      expect(route.request().postDataJSON()).toEqual({
        url: 'https://www.gaeng02.com/memoir/2025-03-SWMaestro',
      })
      return route.fulfill({ json: draft })
    }
    if (path.endsWith('/assets')) return route.fulfill({ json: [] })
    if (path === '/drafts/draft-1' && method === 'DELETE') {
      expect(route.request().headers()['x-csrf-token']).toBe('csrf')
      deleted++
      return route.fulfill({ json: { ok: true, source_path: draft.source_path } })
    }
    if (path === '/drafts/draft-1') return route.fulfill({ json: draft })
    return route.fulfill({ status: 404, json: { detail: path } })
  })
  await page.goto('/studio/')
  await page.getByLabel('글 주소로 불러오기').fill('https://www.gaeng02.com/memoir/2025-03-SWMaestro')
  await page.getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('기존 글')
  await expect(page.getByRole('status')).toContainText('불러왔습니다')
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    void dialog.accept()
  })
  await page.getByRole('button', { name: '기존 글 초안 삭제' }).click()
  await expect(page.getByRole('status')).toContainText('초안을 삭제했습니다')
  await expect(page.getByRole('heading', { name: '어떤 생각을 남길까요?' })).toBeVisible()
  await expect(page.getByRole('button', { name: '기존 글 초안 삭제' })).toHaveCount(0)
  expect(deleted).toBe(1)
  expect(messages[0]).toContain('GitHub에 발행된 글은 그대로 남습니다')
})

export async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
}
