import { test, expect, type Page } from '@playwright/test'

// Hand-written HTML in a post is kept verbatim; scripts in it never run in the editor.
const RAW_BLOCK =
  '<details><summary>접힌 항목</summary>안쪽</details>\n<script>window.previewUnsafe=true</script>'
const ORIGINAL_BODY = `원본 문단입니다.  \n줄을 바꾼 문장\n\n${RAW_BLOCK}\n\n- 첫 항목\n- 둘째 항목\n`

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
      body: ORIGINAL_BODY,
      description: '글 설명',
      tags: ['회고'],
      cover: '',
    },
  }
}

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

test('open a published article from its link, edit it in place and recover an uncertain publish', async ({
  page,
}) => {
  let draft = publishedDraft()
  let saved = 0
  let publishRequests = 0
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
  // Published articles are opened from their link only; GitHub is never browsed.
  await page.getByRole('button', { name: '발행된 글 고치기' }).click()
  await expect(page.getByLabel('글 주소로 불러오기')).toBeFocused()
  await page.keyboard.type('https://www.gaeng02.com/memoir/2025-03-SWMaestro')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('기존 글')
  await expect(page.getByLabel('글 주소', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('최초 발행일', { exact: true })).toBeDisabled()
  // The body is edited as it will look on the blog; the HTML block renders, sanitized.
  const body = page.getByRole('textbox', { name: '본문' })
  await expect(body.locator('.raw-html summary')).toHaveText('접힌 항목')
  await expect(body.locator('ul li')).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).previewUnsafe)).toBeUndefined()
  // Opening an article without editing it leaves its Markdown untouched.
  await expect(page.locator('.sheet-state')).toHaveText('발행된 글')
  await page.getByLabel('제목', { exact: true }).fill('수정한 글')
  // Enter in the title moves to the start of the body, like a Notion page.
  await page.getByLabel('제목', { exact: true }).press('Enter')
  await expect(body).toBeFocused()
  const second = body.getByText('둘째 항목')
  const box = (await second.boundingBox())!
  await second.click({ position: { x: box.width - 1, y: box.height / 2 } })
  await page.waitForTimeout(100) // ProseMirror applies a clicked caret position a moment after mouseup
  await page.keyboard.press('Enter')
  await page.keyboard.type('셋째 **굵게**')
  await expect(body.locator('ul li strong')).toHaveText('굵게')
  // Markdown shortcuts work as in Notion: an empty item leaves the list, "## " makes a heading.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## 맺음말')
  await expect(body.locator('h2')).toHaveText('맺음말')
  await page.getByRole('button', { name: '수정 발행', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('GitHub 응답 확인 실패')
  await expect(page.getByRole('button', { name: '수정 발행', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '수정 발행', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('GitHub에 반영했습니다')
  expect(saved).toBe(1)
  expect(publishRequests).toBe(2)
  expect(draft.post.body).toBe(
    `원본 문단입니다.\\\n줄을 바꾼 문장\n\n${RAW_BLOCK}\n\n- 첫 항목\n- 둘째 항목\n- 셋째 **굵게**\n\n## 맺음말\n`
  )
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
