import { test, expect } from '@playwright/test'

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaGAAAAEEAIFw9selAAAAAElFTkSuQmCC',
  'base64'
)

test('FastAPI persists drafts, serves private images, updates a published post and deletes drafts', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([
      { name: 'blogstudio_session', value: 'browser-test-session', domain: '127.0.0.1', path: '/studio' },
    ])
  await page.goto('http://127.0.0.1:4180/studio/')
  const sidebar = page.getByRole('complementary', { name: '글 목록' })
  await sidebar.getByRole('button', { name: '새 글 쓰기' }).click()
  await page.getByLabel('제목', { exact: true }).fill('브라우저에서 작성한 글')
  await page.getByLabel('글 주소', { exact: true }).fill('browser-post')
  await page.getByLabel('최초 발행일', { exact: true }).fill('2025-04-01')
  await page.getByLabel('검색 결과에 표시할 설명').fill('작성부터 수정 발행까지 확인합니다.')
  await page.getByLabel('태그', { exact: true }).fill('브라우저, 검증')
  await page.getByLabel('태그', { exact: true }).press('Enter')
  await expect(page.locator('.tag-chip')).toHaveCount(2)
  const body = page.getByRole('textbox', { name: '본문' })
  await body.click()
  await page.keyboard.type('## 첫 본문')
  await page.keyboard.press('Enter')
  await page.keyboard.type('브라우저 검증 중입니다.')
  await page.keyboard.press('Enter')
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'pixel image.png', mimeType: 'image/png', buffer: PIXEL })
  await expect(page.getByRole('status')).toContainText('이미지를 추가했습니다')
  await expect(body.locator('img')).toBeVisible()
  await page.getByRole('button', { name: '표지로 사용' }).click()
  await expect(page.getByLabel('표지 이미지 주소')).toHaveValue(/\/assets\/images\/[0-9a-f]{16}\.png/)
  await page.getByRole('button', { name: '초안 저장', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('초안을 비공개로 저장했습니다')
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true })
  await page.reload()
  await page
    .getByRole('button', { name: /브라우저에서 작성한 글.*비공개 초안/ })
    .first()
    .click()
  await expect(body).toContainText('브라우저 검증 중입니다.')
  // Saved as Markdown, with a content-addressed image name derived from the bytes.
  const saved = await page.evaluate(async () => {
    const drafts = await (await fetch('/studio/api/drafts')).json()
    return drafts[0].post.body as string
  })
  expect(saved).toMatch(
    /^## 첫 본문\n\n브라우저 검증 중입니다\.\n\n!\[pixel image\]\(\/assets\/images\/[0-9a-f]{16}\.png\)\n$/
  )
  await expect(page.locator('.tag-chip')).toHaveCount(2)
  await page.getByRole('button', { name: '발행', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('GitHub에 반영했습니다')
  await expect(page.getByLabel('글 주소', { exact: true })).toBeDisabled()
  await page.getByLabel('제목', { exact: true }).fill('발행 후 수정한 글')
  await page.getByRole('button', { name: '수정 발행', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('GitHub에 반영했습니다')
  await expect(page.getByRole('link', { name: '공개 글 확인 ↗' }).first()).toHaveAttribute(
    'href',
    'https://www.gaeng02.com/try-tech/browser-post'
  )
  // Pasting the link of a post that is being edited resumes that draft.
  await page.getByLabel('글 주소로 불러오기').fill('https://www.gaeng02.com/try-tech/browser-post')
  await page.getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.getByRole('status')).toContainText("'발행 후 수정한 글' 글을 불러왔습니다")
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('발행 후 수정한 글')
  await expect(body.locator('h2')).toHaveText('첫 본문')
  await page.getByRole('button', { name: '다크 모드로 전환' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'test-results/editor-dark.png' })
  await page.getByRole('button', { name: '라이트 모드로 전환' }).click()
  page.on('dialog', (dialog) => void dialog.accept())
  await sidebar.getByRole('button', { name: '발행 후 수정한 글 초안 삭제' }).click()
  await expect(page.getByRole('status')).toContainText('초안을 삭제했습니다')
  await expect(page.getByRole('heading', { name: '어떤 생각을 남길까요?' })).toBeVisible()
  await expect(sidebar.getByText('아직 저장한 초안이 없습니다.')).toBeVisible()
  // The article itself is untouched: it can be opened again from GitHub.
  await page.getByLabel('글 주소로 불러오기').fill('/try-tech/browser-post')
  await page.getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('발행 후 수정한 글')
  await expect(body.locator('img')).toBeVisible()
})
