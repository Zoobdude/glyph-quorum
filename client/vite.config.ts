import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API and collaboration WebSocket are proxied through the dev server so the
// browser only ever talks to one origin — the same as in production. That keeps
// the session cookie and the server's same-origin checks working unchanged.
// (changeOrigin stays off so the Host header matches the page's Origin.)
const backend = process.env.VITE_BACKEND ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  server: {
    port: 5173,
    allowedHosts: ['.app.github.dev', '.localhost'],
    proxy: {
      '/api': { target: backend },
      '/ws': { target: backend, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
})
