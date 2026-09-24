import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/crm-psri-testing/',
  server: {
    proxy: {
      // Workflow automation PHP API — run it locally with:
      //   php -S localhost:8000 PSRI/Workflows/php/api.php
      '/psri-api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/psri-api/, ''),
      },
      '/psri-webhook': {
        target: 'https://automation.openmindhelpline.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/psri-webhook/, '/webhook'),
      },
    },
  },
})
