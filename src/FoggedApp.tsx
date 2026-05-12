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

const favoriteCitiesStorageKey = 'cityapp:atlas-favorite-cities:v1'

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

function getFavoriteCityIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(favoriteCitiesStorageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function setFavoriteCityIds(ids: string[]) {
  try {
    window.localStorage.setItem(favoriteCitiesStorageKey, JSON.stringify(Array.from(new Set(ids))))
  } catch {
    // Favorites are a convenience feature; ignore storage failures.
  }
}

function getCityOptionId(button: HTMLButtonElement) {
  return button.textContent?.replace(/[★☆]/g, '').replace(/\s+/g, ' ').trim() ?? ''
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

function useAtlasMapLoadingAnimation() {
  useEffect(() => {
    function ensureLoadingOverlay() {
      document.querySelectorAll<HTMLElement>('.atlas-map-frame').forEach((frame) => {
        if (frame.querySelector('.atlas-map-loading')) return

        frame.classList.add('is-loading')
        const loading = document.createElement('div')
        loading.className = 'atlas-map-loading'
        loading.setAttribute('aria-live', 'polite')
        loading.innerHTML = '<span></span><strong>Loading map</strong>'
        frame.appendChild(loading)

        const hideLoading = () => frame.classList.remove('is-loading')
        frame.querySelector('.maplibregl-canvas')?.addEventListener('load', hideLoading, { once: true })
        window.setTimeout(hideLoading, 950)
      })
    }

    ensureLoadingOverlay()

    const observer = new MutationObserver(ensureLoadingOverlay)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [])
}

function useAtlasButtonTweaks() {
  useEffect(() => {
    function updateButtons() {
      document.querySelectorAll<HTMLButtonElement>('.atlas-map-action-button').forEach((button) => {
        const text = button.textContent?.trim().toLowerCase()

        if (text === 'reset') {
          button.remove()
        }

        if (text === 'snap') {
          const group = button.closest<HTMLElement>('.atlas-map-action-top, .atlas-map-action-bottom, .atlas-map-action-left')
          group?.classList.remove('atlas-map-action-top')
          group?.classList.add('atlas-map-action-bottom')
          group?.setAttribute('aria-label', 'Map snap control')
          group?.removeAttribute('style')
        }
      })
    }

    updateButtons()

    const observer = new MutationObserver(updateButtons)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [])
}

function useCityFavorites() {
  useEffect(() => {
    function updateFavorites() {
      const favoriteIds = getFavoriteCityIds()
      const favoriteSet = new Set(favoriteIds)
      const options = Array.from(document.querySelectorAll<HTMLButtonElement>('.atlas-city-option'))

      options.forEach((option) => {
        const cityId = option.dataset.favoriteCityId || getCityOptionId(option)
        option.dataset.favoriteCityId = cityId
        const isFavorite = favoriteSet.has(cityId)
        option.classList.toggle('is-favorite', isFavorite)
        option.hidden = !isFavorite

        if (!option.querySelector('.atlas-city-favorite-button')) {
          const favoriteButton = document.createElement('span')
          favoriteButton.className = 'atlas-city-favorite-button'
          favoriteButton.setAttribute('role', 'button')
          favoriteButton.setAttribute('tabindex', '0')
          favoriteButton.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            const currentIds = getFavoriteCityIds()
            const id = option.dataset.favoriteCityId || getCityOptionId(option)
            const nextIds = currentIds.includes(id) ? currentIds.filter((entry) => entry !== id) : [...currentIds, id]
            setFavoriteCityIds(nextIds)
            updateFavorites()
          })
          favoriteButton.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              favoriteButton.click()
            }
          })
          option.appendChild(favoriteButton)
        }

        const favoriteButton = option.querySelector<HTMLElement>('.atlas-city-favorite-button')
        if (favoriteButton) {
          favoriteButton.textContent = isFavorite ? '★' : '☆'
          favoriteButton.setAttribute('aria-label', isFavorite ? 'Remove favorite city' : 'Favorite city')
        }
      })

      const cityList = document.querySelector<HTMLElement>('.atlas-city-list')
      cityList?.classList.toggle('has-favorites', options.some((option) => !option.hidden))
    }

    updateFavorites()

    const observer = new MutationObserver(updateFavorites)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [])
}

function useCitySelectionBackButton() {
  useEffect(() => {
    function goBackToAtlas() {
      const currentCityOption = document.querySelector<HTMLButtonElement>('.atlas-city-option.is-favorite')

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
        heading?.querySelector('p')?.remove()
        return
      }

      heading.querySelector('p')?.remove()
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
  useAtlasMapLoadingAnimation()
  useAtlasButtonTweaks()
  useCityFavorites()
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
