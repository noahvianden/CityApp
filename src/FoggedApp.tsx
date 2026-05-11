import { useEffect, useState, type CSSProperties } from 'react'
import {
  getAtlasFogSnapshot,
  getAtlasFogVisible,
  installAtlasGeoFogBridge,
  setAtlasFogVisible,
  subscribeAtlasFog,
} from './atlasGeoFogBridge'
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
      <span><small>revealed</small><b>{snapshot.progress}%</b></span>
      <strong>{snapshot.revealedPoints ? 'Keep exploring to reveal more of the city.' : 'Move to start revealing the city.'}</strong>
    </div>
  )
}

function AtlasFogToggle() {
  const [isVisible, setIsVisible] = useState(() => getAtlasFogVisible())

  function toggleFog() {
    setIsVisible((current) => {
      const next = !current
      setAtlasFogVisible(next)

      return next
    })
  }

  return (
    <button className="atlas-fog-toggle" type="button" onClick={toggleFog} aria-pressed={isVisible}>
      {isVisible ? 'Hide fog' : 'Show fog'}
    </button>
  )
}

function useCitySelectionBackButton() {
  useEffect(() => {
    function goBackToAtlas() {
      const firstCityOption = document.querySelector<HTMLButtonElement>('.atlas-city-option')

      if (firstCityOption) {
        firstCityOption.click()
        return
      }

      window.location.reload()
    }

    function ensureBackButton() {
      const heading = document.querySelector<HTMLElement>('.atlas-city-selection-heading')

      if (!heading || heading.querySelector('.atlas-city-back-button')) {
        return
      }

      const button = document.createElement('button')
      button.className = 'atlas-city-back-button'
      button.type = 'button'
      button.setAttribute('aria-label', 'Back to atlas')
      button.textContent = '‹'
      button.addEventListener('click', goBackToAtlas)
      heading.prepend(button)
    }

    ensureBackButton()

    const observer = new MutationObserver(ensureBackButton)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      document.querySelectorAll<HTMLButtonElement>('.atlas-city-back-button').forEach((button) => {
        button.removeEventListener('click', goBackToAtlas)
      })
    }
  }, [])
}

export default function FoggedApp() {
  const [isFogBridgeReady, setIsFogBridgeReady] = useState(false)
  useCitySelectionBackButton()

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
      <AtlasFogToggle />
    </>
  )
}
