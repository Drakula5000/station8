import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/station8/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
