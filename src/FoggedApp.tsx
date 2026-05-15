import { useEffect, useState } from 'react'
import { installAtlasGeoFogBridge } from './atlasGeoFogBridge'
import { installCityStyleFetchPatch } from './atlasStyle'
import { installAtlasUiTweaks } from './atlasUiTweaks'
import App from './App'
import { AtlasFogProgress, AtlasFogToggle } from './components/AtlasFogControls'
import { useAtlasEnhancements } from './hooks/useAtlasEnhancements'
import './atlasFogOverlay.css'
import './atlasInteractionLayout.css'

export default function FoggedApp() {
  const [isFogBridgeReady, setIsFogBridgeReady] = useState(false)
  useAtlasEnhancements()

  useEffect(() => {
    let cancelled = false

    installCityStyleFetchPatch()
    Promise.all([installAtlasUiTweaks(), installAtlasGeoFogBridge()])
      .catch((error: unknown) => console.error('[atlas-fog] bridge install failed', error))
      .finally(() => {
        if (!cancelled) setIsFogBridgeReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      {isFogBridgeReady ? <App /> : null}
      <AtlasFogProgress />
      <AtlasFogToggle />
    </>
  )
}
