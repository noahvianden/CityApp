import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installLiveWalkDomBridge } from './liveWalkDomBridge'
import { installLiveWorldPlacesBridge } from './liveWorldPlacesBridge'
import FoggedApp from './FoggedApp.tsx'

installLiveWalkDomBridge()
void installLiveWorldPlacesBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FoggedApp />
  </StrictMode>,
)
