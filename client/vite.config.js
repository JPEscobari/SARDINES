import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '~@ibm/plex': fileURLToPath(new URL('./node_modules/@ibm/plex', import.meta.url)) } },
  server: { proxy: { '/api': process.env.API_PROXY_TARGET || 'http://localhost:5000' } },
  css: {
    preprocessorOptions: {
      scss: {
        includePaths: [new URL('node_modules', import.meta.url).pathname],
      },
    },
  },
})
