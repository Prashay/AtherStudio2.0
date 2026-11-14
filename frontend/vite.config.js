import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const frontendPort = Number(process.env.AETHER_FRONTEND_PORT || 4576)
const backendPort = Number(process.env.AETHER_BACKEND_PORT || 3090)
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: frontendPort,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: frontendPort,
    strictPort: true,
    allowedHosts: true
  }
})

