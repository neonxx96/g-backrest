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
