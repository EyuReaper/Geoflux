import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'maplibre'
          if (id.includes('node_modules/react-leaflet') || id.includes('node_modules/leaflet')) return 'leaflet'
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) return 'react-core'
          if (
            id.includes('node_modules/zustand/') ||
            id.includes('node_modules/socket.io-client/')
          ) return 'state-realtime'
          if (
            id.includes('node_modules/lucide-react/') ||
            id.includes('node_modules/clsx/') ||
            id.includes('node_modules/tailwind-merge/')
          ) return 'ui-utils'
        },
      },
    },
  },
})
