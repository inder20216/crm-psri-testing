import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/crm-psri-testing/',
  server: {
    proxy: {
      '/psri-webhook': {
        target: 'https://automation.openmindhelpline.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/psri-webhook/, '/webhook'),
      },
    },
  },
})
