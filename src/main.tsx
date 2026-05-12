import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './atlasInteractionLayout.css'
import { installLiveWalkDomBridge } from './liveWalkDomBridge'
import { installLiveWorldPlacesBridge } from './liveWorldPlacesBridge'
import { installPlaceDiscoveryOverlayBridge } from './placeDiscoveryOverlayBridge'
import FoggedApp from './FoggedApp.tsx'

console.info('[cityprint-build] live-world-places-v1')
installLiveWalkDomBridge()
void installPlaceDiscoveryOverlayBridge().then(() => installLiveWorldPlacesBridge())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FoggedApp />
  </StrictMode>,
)
