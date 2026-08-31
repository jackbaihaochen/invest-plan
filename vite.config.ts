import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages はリポジトリ名のサブパスで配信されるので base を合わせる。
// S3 のルート配信に切り替えるときは BASE_PATH=/ を渡す。
export default defineConfig({
  base: process.env.BASE_PATH ?? '/invest-plan/',
  plugins: [react()],
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
})
