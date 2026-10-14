import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: resolve(projectRoot, 'src/renderer'),
  envDir: projectRoot,
  plugins: [react()],
  base: '/',
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true
  }
})
