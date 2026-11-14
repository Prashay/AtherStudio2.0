import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: { build: { outDir: 'out/main' } },
  preload: { build: { outDir: 'out/preload' } },
  renderer: {
    root: resolve('src/renderer'),
    esbuild: { jsx: 'automatic' },
    build: { outDir: resolve('out/renderer') },
    server: { host: '127.0.0.1' }
  }
})
