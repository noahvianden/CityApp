import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import FoggedApp from './FoggedApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FoggedApp />
  </StrictMode>,
)
