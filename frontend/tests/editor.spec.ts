import { test, expect } from '@playwright/test'

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
})

test('edit a published article, sanitize preview and recover an uncertain publish', async ({ page }) => {
  let draft = {
    id: 'draft-1',
    revision: 1,
    source_path: 'content/memoir/2025-03-SWMaestro.md',
    updated_at: '2026-09-09',
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
  let saved = 0
  let publishRequests = 0
  await page.route('**/studio/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/studio/api', '')
    const method = route.request().method()
    if (path === '/session')
      return route.fulfill({
        json: { email: 'sondin144@gmail.com', csrf: 'csrf', blog_url: 'https://www.gaeng02.com' },
      })
    if (path === '/drafts') return route.fulfill({ json: [] })
    if (path === '/posts')
      return route.fulfill({
        json: [{ path: draft.source_path, title: draft.post.title, category: 'memoir', date: '2025-03-31' }],
      })
    if (path === '/posts/import') return route.fulfill({ json: draft })
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
  await page.getByRole('button', { name: '글 목록 불러오기' }).click()
  await page.getByRole('button', { name: /기존 글.*수정하기/ }).click()
  await expect(page.getByLabel('글 주소', { exact: true })).toBeDisabled()
  await page.getByLabel('제목', { exact: true }).fill('수정한 글')
  await page
    .getByRole('textbox', { name: 'Markdown 본문' })
    .fill('## 수정 내용\n\n<script>window.previewUnsafe=true</script>\n\n본문입니다.')
  await expect(page.locator('.prose h2')).toHaveText('수정 내용')
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
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true })
})
