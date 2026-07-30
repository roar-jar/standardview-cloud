import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cloudflare Pages: 루트 도메인에 배포되므로 base '/' 유지, 산출물은 dist/
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
