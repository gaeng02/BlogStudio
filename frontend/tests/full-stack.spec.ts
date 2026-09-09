import { test, expect } from '@playwright/test'

test('FastAPI persists drafts, serves private images and updates a published post', async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: 'blogstudio_session', value: 'browser-test-session', domain: '127.0.0.1', path: '/studio' },
    ])
  await page.goto('http://127.0.0.1:4180/studio/')
  await page.getByRole('button', { name: '＋ 새 글 쓰기', exact: true }).click()
  await page.getByLabel('제목', { exact: true }).fill('브라우저에서 작성한 글')
  await page.getByLabel('글 주소', { exact: true }).fill('browser-post')
  await page.getByLabel('최초 발행일', { exact: true }).fill('2025-04-01')
  await page.getByLabel('검색 결과에 표시할 설명').fill('작성부터 수정 발행까지 확인합니다.')
  await page.getByRole('textbox', { name: 'Markdown 본문' }).fill('## 첫 본문\n브라우저 검증 중입니다.')
  await page.locator('input[type=file]').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaGAAAAEEAIFw9selAAAAAElFTkSuQmCC',
      'base64'
    ),
  })
  await expect(page.getByRole('status')).toContainText('이미지를 추가했습니다')
  await expect(page.locator('.prose img')).toBeVisible()
  await page.getByRole('button', { name: '초안 저장', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('초안을 비공개로 저장했습니다')
  await page.reload()
  await page.getByRole('button', { name: /브라우저에서 작성한 글.*비공개 초안/ }).click()
  await expect(page.getByRole('textbox', { name: 'Markdown 본문' })).toContainText('브라우저 검증 중입니다.')
  await page.getByRole('button', { name: '발행', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('GitHub에 반영했습니다')
  await expect(page.getByLabel('글 주소', { exact: true })).toBeDisabled()
  await page.getByLabel('제목', { exact: true }).fill('발행 후 수정한 글')
  await page.getByRole('button', { name: '수정 발행', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('GitHub에 반영했습니다')
  await expect(page.getByRole('link', { name: '공개 글 확인 ↗' })).toHaveAttribute(
    'href',
    'https://www.gaeng02.com/try-tech/browser-post'
  )
  await page.getByRole('button', { name: '글 목록 불러오기', exact: true }).click()
  await expect(page.getByRole('button', { name: /발행 후 수정한 글.*수정하기/ })).toBeVisible()
  await expect(page.locator('.prose h2')).toHaveText('첫 본문')
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true })
})
