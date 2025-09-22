import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Replace sku_app with your repo name!
export default defineConfig({
  plugins: [react()],
  base: '/sku_app/',
})
