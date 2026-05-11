import { useEffect, useState } from 'react'
import './atlasGeoFogBridge'
import { getAtlasFogSnapshot, subscribeAtlasFog } from './atlasGeoFogBridge'
import App from './App'
import './atlasFogOverlay.css'

function AtlasFogProgress() {
  const [snapshot, setSnapshot] = useState(() => getAtlasFogSnapshot())

  useEffect(() => subscribeAtlasFog(setSnapshot), [])

  return (
    <div
      className="atlas-fog-progress"
      style={{ '--atlas-fog-progress': `${snapshot.progress}%` } as React.CSSProperties}
      aria-live="polite"
    >
      <span>{snapshot.progress}% revealed</span>
      <strong>{snapshot.revealedPoints ? 'Keep exploring to reveal more of the city.' : 'Move to start revealing the city.'}</strong>
    </div>
  )
}

export default function FoggedApp() {
  return (
    <>
      <App />
      <AtlasFogProgress />
    </>
  )
}
