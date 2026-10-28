import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig(({ mode }) => {
  // Vite перечитывает .env при каждом перезапуске dev-сервера; при смене
  // BACKEND_PORT достаточно триггернуть restart этим конфигом.
  const env = loadEnv(mode, '..', '')
  const backendHost = env.BACKEND_HOST || '127.0.0.1'
  const backendPort = env.BACKEND_PORT || '8000'

  return {
    envDir: '..',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    plugins: [
      react(),
      tailwindcss()
    ],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // Keep the research screen independently cacheable from the terminal shell.
              { name: 'backtest-ui', test: /src[\\/]components[\\/](BacktestPanel|EquityChart|MonteCarlo)[^\\/]*\.[jt]sx?$/, priority: 10 },
              { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
              { name: 'chart-vendor', test: /node_modules[\\/]klinecharts[\\/]/, priority: 20 },
              { name: 'dockview-vendor', test: /node_modules[\\/](dockview|dockview-core|dockview-react)[\\/]/, priority: 20 },
            ],
          },
        },
      },
    },
    server: {
      port: 7100,
      strictPort: true,
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
