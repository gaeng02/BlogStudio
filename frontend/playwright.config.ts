import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium' },
  webServer: [
    {
      command: 'npx vite preview --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173/studio/',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: '../.venv/bin/python ../tests/live_server.py',
      url: 'http://127.0.0.1:4180/studio/health',
      reuseExistingServer: false,
    },
  ],
})
