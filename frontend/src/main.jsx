import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DesignShowcase from './DesignShowcase.jsx'

const isShowcase = 
  window.location.search.includes('showcase') || 
  window.location.pathname.includes('/showcase') ||
  window.location.hash.includes('showcase');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isShowcase ? <DesignShowcase /> : <App />}
  </StrictMode>,
)
