import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installLiveWalkDomBridge } from './liveWalkDomBridge'
import FoggedApp from './FoggedApp.tsx'

installLiveWalkDomBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FoggedApp />
  </StrictMode>,
)
