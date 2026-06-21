import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ai': 'http://localhost:3000',
      '/oss': 'http://localhost:3000',
      '/video': 'http://localhost:3000',
    },
  },
})
