import { useEffect, useState, type CSSProperties } from 'react'
import {
  getAtlasFogSnapshot,
  getAtlasFogVisible,
  installAtlasGeoFogBridge,
  setAtlasFogVisible,
  subscribeAtlasFog,
} from './atlasGeoFogBridge'
import { installCityStyleFetchPatch } from './atlasStyle'
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
  const title = button.querySelector('strong')?.textContent?.trim()
  const detail = button.querySelector('small')?.textContent?.trim()

  return [title, detail].filter(Boolean).join(' · ') || button.textContent?.replace(/[★☆]/g, '').replace(/\s+/g, ' ').trim() || ''
}

function setTextIfChanged(element: HTMLElement, text: string) {
  if (element.textContent !== text) {
    element.textContent = text
  }
}

function setAttributeIfChanged(element: HTMLElement, name: string, value: string) {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value)
  }
}

function useAtlasPageControlsVisibility() {
  useEffect(() => {
    let frame = 0

    function updateVisibility() {
      frame = 0
      const shouldShow = Boolean(document.querySelector('.atlas-map')) && !document.querySelector('.atlas-city-selection-panel')
      document.body.classList.toggle('atlas-fog-controls-visible', shouldShow)
    }

    function scheduleUpdateVisibility() {
      if (!frame) {
        frame = window.requestAnimationFrame(updateVisibility)
      }
    }

    scheduleUpdateVisibility()

    const observer = new MutationObserver(scheduleUpdateVisibility)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      document.body.classList.remove('atlas-fog-controls-visible')
    }
  }, [])
}

function useAtlasMapLoadingAnimation() {
  useEffect(() => {
    let frame = 0

    function ensureLoadingOverlay() {
      frame = 0
      document.querySelectorAll<HTMLElement>('.atlas-map-frame').forEach((frameElement) => {
        if (frameElement.querySelector('.atlas-map-loading')) return

        frameElement.classList.add('is-loading')
        const loading = document.createElement('div')
        loading.className = 'atlas-map-loading'
        loading.setAttribute('aria-live', 'polite')
        loading.innerHTML = '<span></span><strong>Loading map</strong>'
        frameElement.appendChild(loading)

        const hideLoading = () => frameElement.classList.remove('is-loading')
        frameElement.querySelector('.maplibregl-canvas')?.addEventListener('load', hideLoading, { once: true })
        window.setTimeout(hideLoading, 950)
      })
    }

    function scheduleLoadingOverlay() {
      if (!frame) {
        frame = window.requestAnimationFrame(ensureLoadingOverlay)
      }
    }

    scheduleLoadingOverlay()

    const observer = new MutationObserver(scheduleLoadingOverlay)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])
}

function useAtlasButtonTweaks() {
  useEffect(() => {
    let frame = 0

    function updateButtons() {
      frame = 0
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

    function scheduleButtonUpdate() {
      if (!frame) {
        frame = window.requestAnimationFrame(updateButtons)
      }
    }

    scheduleButtonUpdate()

    const observer = new MutationObserver(scheduleButtonUpdate)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])
}

function useCityFavorites() {
  useEffect(() => {
    let frame = 0
    let isUpdating = false

    function updateFavorites() {
      frame = 0

      if (isUpdating) {
        return
      }

      const cityList = document.querySelector<HTMLElement>('.atlas-city-list')
      if (!cityList) {
        return
      }

      isUpdating = true

      try {
        const favoriteIds = getFavoriteCityIds()
        const favoriteSet = new Set(favoriteIds)
        const options = Array.from(cityList.querySelectorAll<HTMLButtonElement>('.atlas-city-option'))

        options.forEach((option) => {
          const cityId = option.dataset.favoriteCityId || getCityOptionId(option)
          const isFavorite = favoriteSet.has(cityId)
          const shouldHide = favoriteIds.length > 0 && !isFavorite

          if (option.dataset.favoriteCityId !== cityId) {
            option.dataset.favoriteCityId = cityId
          }

          option.classList.toggle('is-favorite', isFavorite)
          option.hidden = shouldHide

          let favoriteButton = option.querySelector<HTMLElement>('.atlas-city-favorite-button')
          if (!favoriteButton) {
            favoriteButton = document.createElement('span')
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
              scheduleFavoritesUpdate()
            })
            favoriteButton.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                favoriteButton?.click()
              }
            })
            option.appendChild(favoriteButton)
          }

          setTextIfChanged(favoriteButton, isFavorite ? '★' : '☆')
          setAttributeIfChanged(favoriteButton, 'aria-label', isFavorite ? 'Remove favorite city' : 'Favorite city')
        })

        cityList.classList.toggle('has-favorites', favoriteIds.length > 0)
      } finally {
        isUpdating = false
      }
    }

    function scheduleFavoritesUpdate() {
      if (!frame) {
        frame = window.requestAnimationFrame(updateFavorites)
      }
    }

    scheduleFavoritesUpdate()

    const observer = new MutationObserver(() => {
      if (!isUpdating) {
        scheduleFavoritesUpdate()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])
}

function useCitySelectionBackButton() {
  useEffect(() => {
    let frame = 0
    let isUpdating = false

    function goBackToAtlas() {
      const currentCityOption = document.querySelector<HTMLButtonElement>('.atlas-city-option.is-favorite, .atlas-city-option')

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
      frame = 0

      if (isUpdating) {
        return
      }

      const heading = document.querySelector<HTMLElement>('.atlas-city-selection-heading')
      if (!heading) {
        return
      }

      isUpdating = true

      try {
        heading.querySelector('p')?.remove()

        if (heading.querySelector('.atlas-city-back-button')) {
          return
        }

        const button = document.createElement('button')
        button.className = 'atlas-city-back-button'
        button.type = 'button'
        button.setAttribute('aria-label', 'Back to atlas')
        button.textContent = '‹'
        button.addEventListener('click', goBackToAtlas)
        heading.prepend(button)
      } finally {
        isUpdating = false
      }
    }

    function scheduleBackButtonUpdate() {
      if (!frame) {
        frame = window.requestAnimationFrame(ensureBackButton)
      }
    }

    scheduleBackButtonUpdate()

    const observer = new MutationObserver(() => {
      if (!isUpdating) {
        scheduleBackButtonUpdate()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
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

    installCityStyleFetchPatch()
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
