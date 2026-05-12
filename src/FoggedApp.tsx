import { useEffect, useState, type CSSProperties } from 'react'
import {
  getAtlasFogSnapshot,
  getAtlasFogVisible,
  installAtlasGeoFogBridge,
  setAtlasFogVisible,
  subscribeAtlasFog,
} from './atlasGeoFogBridge'
import { installAtlasUiTweaks } from './atlasUiTweaks'
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
      <span><b>{snapshot.progress}%</b><small>revealed</small></span>
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

function useAtlasPageControlsVisibility() {
  useEffect(() => {
    function updateVisibility() {
      const shouldShow = Boolean(document.querySelector('.atlas-map')) && !document.querySelector('.atlas-city-selection-panel')
      document.body.classList.toggle('atlas-fog-controls-visible', shouldShow)
    }

    updateVisibility()

    const observer = new MutationObserver(updateVisibility)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      document.body.classList.remove('atlas-fog-controls-visible')
    }
  }, [])
}

function useCitySelectionBackButton() {
  useEffect(() => {
    function goBackToAtlas() {
      const currentCityOption = document.querySelector<HTMLButtonElement>('.atlas-city-option')

      if (currentCityOption) {
        currentCityOption.click()
        return
      }

      const atlasTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.atlas-tab'))
        .find((button) => button.textContent?.toLowerCase().includes('atlas'))

      if (atlasTab) {
        atlasTab.click()
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
  useAtlasPageControlsVisibility()
  useCitySelectionBackButton()

  useEffect(() => {
    let cancelled = false

    Promise.all([installAtlasUiTweaks(), installAtlasGeoFogBridge()])
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
