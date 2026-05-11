import { useEffect, useState, type CSSProperties } from 'react'
import { getAtlasFogSnapshot, installAtlasGeoFogBridge, subscribeAtlasFog } from './atlasGeoFogBridge'
import App from './App'
import './atlasFogOverlay.css'

function AtlasFogProgress() {
  const [snapshot, setSnapshot] = useState(() => getAtlasFogSnapshot())

  useEffect(() => {
    const unsubscribe = subscribeAtlasFog(setSnapshot)

    return () => {
      unsubscribe()
    }
  }, [])

  return (
    <div
      className="atlas-fog-progress"
      style={{ '--atlas-fog-progress': `${snapshot.progress}%` } as CSSProperties}
      aria-live="polite"
    >
      <span>{snapshot.progress}% revealed</span>
      <strong>{snapshot.revealedPoints ? 'Keep exploring to reveal more of the city.' : 'Move to start revealing the city.'}</strong>
    </div>
  )
}

export default function FoggedApp() {
  const [isFogBridgeReady, setIsFogBridgeReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    installAtlasGeoFogBridge()
      .catch((error: unknown) => console.error('[atlas-fog] bridge install failed', error))
      .finally(() => {
        if (!cancelled) {
          setIsFogBridgeReady(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      {isFogBridgeReady ? <App /> : null}
      <AtlasFogProgress />
    </>
  )
}
