import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installAtlasMapSessionBridge } from './atlasMapSessionBridge'
import { installLiveWalkDomBridge } from './liveWalkDomBridge'
import { installLiveWorldPlacesBridge } from './liveWorldPlacesBridge'
import { installPlaceDiscoveryOverlayBridge } from './placeDiscoveryOverlayBridge'
import { installRealTabContentBridge } from './realTabContentBridge'
import FoggedApp from './FoggedApp.tsx'

console.info('[cityprint-build] live-world-places-v1')
installLiveWalkDomBridge()
installRealTabContentBridge()
void installAtlasMapSessionBridge()
void installPlaceDiscoveryOverlayBridge().then(() => installLiveWorldPlacesBridge())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FoggedApp />
  </StrictMode>,
)
