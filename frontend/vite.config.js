import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '')
  const backendHost = env.BACKEND_HOST || '127.0.0.1'
  const backendPort = env.BACKEND_PORT || '8000'

  return {
    envDir: '..',
    plugins: [
      react(),
      tailwindcss()
    ],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true
        }
      }
    }
  }
})
