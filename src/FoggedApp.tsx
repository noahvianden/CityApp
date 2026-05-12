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
const pendingSearchCitiesStorageKey = 'cityapp:atlas-pending-search-cities:v1'
const cityListPrunedStorageKey = 'cityapp:atlas-city-list-pruned:v1'

type PendingSearchCity = {
  id: string
  name: string
  description: string
  query: string
}

type NominatimSearchEntry = {
  address?: {
    city?: string
    country?: string
    municipality?: string
    town?: string
    village?: string
  }
  display_name?: string
  name?: string
  osm_id?: number
  osm_type?: string
}

function AtlasFogProgress() {
  const [snapshot, setSnapshot] = useState(() => getAtlasFogSnapshot())

  useEffect(() => subscribeAtlasFog(setSnapshot), [])

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
    // Favorites are optional; ignore storage failures.
  }
}

function hasCityListBeenPruned() {
  try {
    return window.sessionStorage.getItem(cityListPrunedStorageKey) === 'true'
  } catch {
    return false
  }
}

function setCityListPruned(value: boolean) {
  try {
    if (value) {
      window.sessionStorage.setItem(cityListPrunedStorageKey, 'true')
    } else {
      window.sessionStorage.removeItem(cityListPrunedStorageKey)
    }
  } catch {
    // Pruning is UI-only; ignore storage failures.
  }
}

function getPendingSearchCities() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(pendingSearchCitiesStorageKey) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is PendingSearchCity => (
        entry
        && typeof entry === 'object'
        && typeof entry.id === 'string'
        && typeof entry.name === 'string'
        && typeof entry.description === 'string'
        && typeof entry.query === 'string'
      ))
      : []
  } catch {
    return []
  }
}

function setPendingSearchCities(cities: PendingSearchCity[]) {
  try {
    window.sessionStorage.setItem(pendingSearchCitiesStorageKey, JSON.stringify(cities))
  } catch {
    // Search entries are session-only convenience UI; ignore storage failures.
  }
}

function cleanupCityListAfterClose() {
  const favoriteIds = new Set(getFavoriteCityIds())
  const starredPendingCities = getPendingSearchCities().filter((city) => favoriteIds.has(city.id))
  setPendingSearchCities(starredPendingCities)
  setCityListPruned(true)
}

function getCityOptionId(button: HTMLButtonElement) {
  const title = button.querySelector('strong')?.textContent?.trim()
  const detail = button.querySelector('small')?.textContent?.trim()
  return [title, detail].filter(Boolean).join(' · ') || button.textContent?.replace(/[★☆]/g, '').replace(/\s+/g, ' ').trim() || ''
}

function getExistingCityEntryIds() {
  const ids = new Set(getPendingSearchCities().map((city) => city.id))

  document.querySelectorAll<HTMLButtonElement>('.atlas-city-option').forEach((option) => {
    const id = option.dataset.favoriteCityId || getCityOptionId(option)
    if (id) ids.add(id)
  })

  return ids
}

function getNominatimCityId(place: NominatimSearchEntry, fallbackQuery: string) {
  if (place.osm_type && typeof place.osm_id === 'number') {
    return `${place.osm_type}:${place.osm_id}`
  }

  return `search:${fallbackQuery.replace(/\s+/g, ' ').trim().toLocaleLowerCase()}`
}

function getNominatimCityName(place: NominatimSearchEntry, fallbackQuery: string) {
  return place.name
    ?? place.address?.city
    ?? place.address?.town
    ?? place.address?.village
    ?? place.address?.municipality
    ?? fallbackQuery.replace(/\s+/g, ' ').trim()
}

async function resolveSearchCityEntry(query: string): Promise<PendingSearchCity | null> {
  const normalizedQuery = query.replace(/\s+/g, ' ').trim()
  if (!normalizedQuery) return null

  const params = new URLSearchParams({
    format: 'jsonv2',
    q: normalizedQuery,
    featureType: 'city',
    limit: '10',
    addressdetails: '1',
    extratags: '1',
    polygon_geojson: '1',
    'accept-language': 'en',
  })

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  })

  if (!response.ok) return null

  const payload = await response.json()
  if (!Array.isArray(payload)) return null

  const place = payload.find((entry): entry is NominatimSearchEntry => Boolean(entry && typeof entry === 'object'))
  if (!place) return null

  const country = place.address?.country ?? 'Unknown country'
  const name = getNominatimCityName(place, normalizedQuery)

  return {
    id: getNominatimCityId(place, normalizedQuery),
    name,
    description: `Search result · ${country}`,
    query: name,
  }
}

function addPendingSearchCity(city: PendingSearchCity) {
  const existingIds = getExistingCityEntryIds()
  if (existingIds.has(city.id)) return 'exists' as const

  const withoutDuplicate = getPendingSearchCities().filter((entry) => entry.id !== city.id)
  const nextCities = [city, ...withoutDuplicate].slice(0, 8)
  setPendingSearchCities(nextCities)

  return 'added' as const
}

function setTextIfChanged(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text
}

function setAttributeIfChanged(element: HTMLElement, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value)
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  if (input.value !== value) input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function setSearchEntryMessage(form: HTMLFormElement, text: string) {
  const panel = form.closest<HTMLElement>('.atlas-city-selection-panel')
  if (!panel) return

  let message = panel.querySelector<HTMLElement>('.atlas-pending-search-message')
  if (!message) {
    message = document.createElement('p')
    message.className = 'atlas-city-search-message atlas-pending-search-message'
    form.insertAdjacentElement('afterend', message)
  }

  setTextIfChanged(message, text)
}

function openSearchedCityFromEntry(query: string) {
  const form = document.querySelector<HTMLFormElement>('.atlas-city-search')
  if (!form) return

  const searchForm = form

  function submitWhenInputExists() {
    const input = searchForm.querySelector<HTMLInputElement>('input')

    if (!input) {
      searchForm.click()
      window.requestAnimationFrame(submitWhenInputExists)
      return
    }

    setControlledInputValue(input, query)
    searchForm.dataset.atlasAllowSwitch = 'true'

    window.requestAnimationFrame(() => {
      if (typeof searchForm.requestSubmit === 'function') {
        searchForm.requestSubmit()
      } else {
        searchForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      }

      window.setTimeout(() => {
        delete searchForm.dataset.atlasAllowSwitch
      }, 0)
    })
  }

  searchForm.click()
  submitWhenInputExists()
}

function createPendingSearchOption(city: PendingSearchCity) {
  const option = document.createElement('button')
  option.className = 'atlas-city-option atlas-pending-search-city'
  option.type = 'button'
  option.dataset.favoriteCityId = city.id
  option.dataset.pendingSearchCity = 'true'
  option.addEventListener('click', () => openSearchedCityFromEntry(city.query))

  const dot = document.createElement('span')
  dot.className = 'atlas-city-dot'
  dot.setAttribute('aria-hidden', 'true')

  const copy = document.createElement('span')
  copy.className = 'atlas-city-option-copy'
  const title = document.createElement('strong')
  title.textContent = city.name
  const description = document.createElement('small')
  description.textContent = city.description
  copy.append(title, description)

  const badge = document.createElement('em')
  badge.textContent = 'searched'

  option.append(dot, copy, badge)

  return option
}

function renderPendingSearchCities(cityList: HTMLElement) {
  const pendingCities = getPendingSearchCities()
  const pendingIds = new Set(pendingCities.map((city) => city.id))

  cityList.querySelectorAll<HTMLButtonElement>('.atlas-pending-search-city').forEach((option) => {
    if (!pendingIds.has(option.dataset.favoriteCityId ?? '')) {
      option.remove()
    }
  })

  for (const city of [...pendingCities].reverse()) {
    let option = cityList.querySelector<HTMLButtonElement>(`.atlas-pending-search-city[data-favorite-city-id="${CSS.escape(city.id)}"]`)

    if (!option) {
      option = createPendingSearchOption(city)
      cityList.prepend(option)
    }

    option.dataset.favoriteCityId = city.id
    option.dataset.pendingSearchCity = 'true'
    option.querySelector('strong')!.textContent = city.name
    option.querySelector('small')!.textContent = city.description
  }

  const emptyHistory = cityList.querySelector<HTMLElement>('.atlas-city-empty-history')
  if (emptyHistory) emptyHistory.hidden = pendingCities.length > 0
  cityList.classList.toggle('has-search-results', pendingCities.length > 0)
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
      if (!frame) frame = window.requestAnimationFrame(updateVisibility)
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
        window.setTimeout(() => frameElement.classList.remove('is-loading'), 950)
      })
    }

    function scheduleLoadingOverlay() {
      if (!frame) frame = window.requestAnimationFrame(ensureLoadingOverlay)
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

        if (text === 'reset') button.remove()

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
      if (!frame) frame = window.requestAnimationFrame(updateButtons)
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

function enhanceCitySelection() {
  const panel = document.querySelector<HTMLElement>('.atlas-city-selection-panel')
  const heading = panel?.querySelector<HTMLElement>('.atlas-city-selection-heading')
  const cityList = panel?.querySelector<HTMLElement>('.atlas-city-list')
  if (!panel || !heading || !cityList) return

  heading.querySelector('p')?.remove()
  renderPendingSearchCities(cityList)

  if (!heading.querySelector('.atlas-city-back-button')) {
    const button = document.createElement('button')
    button.className = 'atlas-city-back-button'
    button.type = 'button'
    button.setAttribute('aria-label', 'Back to atlas')
    button.textContent = '‹'
    button.addEventListener('click', () => {
      const firstVisibleCity = Array.from(cityList.querySelectorAll<HTMLButtonElement>('.atlas-city-option')).find((option) => !option.hidden)
      firstVisibleCity?.click()
    })
    heading.prepend(button)
  }

  const favoriteIds = getFavoriteCityIds()
  const favoriteSet = new Set(favoriteIds)
  const shouldHideUnstarredStableEntries = hasCityListBeenPruned()

  cityList.querySelectorAll<HTMLButtonElement>('.atlas-city-option').forEach((option) => {
    const cityId = option.dataset.favoriteCityId || getCityOptionId(option)
    const isFavorite = favoriteSet.has(cityId)
    const isPendingSearchCity = option.dataset.pendingSearchCity === 'true'

    if (option.dataset.favoriteCityId !== cityId) option.dataset.favoriteCityId = cityId
    option.classList.toggle('is-favorite', isFavorite)
    option.hidden = shouldHideUnstarredStableEntries && !isFavorite && !isPendingSearchCity

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
        enhanceCitySelection()
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
}

function useCitySearchAsEntry() {
  useEffect(() => {
    async function handleSearchSubmit(event: Event) {
      const form = event.target instanceof HTMLFormElement ? event.target : null
      if (!form?.classList.contains('atlas-city-search') || form.dataset.atlasAllowSwitch === 'true') return

      const input = form.querySelector<HTMLInputElement>('input')
      if (!input) return

      const query = input.value.trim()
      if (!query) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setSearchEntryMessage(form, 'Searching...')

      try {
        const city = await resolveSearchCityEntry(query)

        if (!city) {
          setSearchEntryMessage(form, 'No city boundary found. Try a larger city name.')
          return
        }

        const status = addPendingSearchCity(city)
        setControlledInputValue(input, '')
        setSearchEntryMessage(
          form,
          status === 'exists'
            ? `${city.name} is already listed below.`
            : `${city.name} was added below. Star it to keep it listed.`,
        )
        enhanceCitySelection()
      } catch {
        setSearchEntryMessage(form, 'Search failed. Please try again.')
      }
    }

    document.addEventListener('submit', handleSearchSubmit, true)

    return () => {
      document.removeEventListener('submit', handleSearchSubmit, true)
    }
  }, [])
}

function useCitySelectionEnhancements() {
  useEffect(() => {
    console.info('[atlas-ui] city selection enhancer v5')
    let wasCitySelectionOpen = Boolean(document.querySelector('.atlas-city-selection-panel'))

    function tickCitySelectionEnhancements() {
      const isCitySelectionOpen = Boolean(document.querySelector('.atlas-city-selection-panel'))

      if (wasCitySelectionOpen && !isCitySelectionOpen) {
        cleanupCityListAfterClose()
      }

      wasCitySelectionOpen = isCitySelectionOpen
      enhanceCitySelection()
    }

    tickCitySelectionEnhancements()
    const intervalId = window.setInterval(tickCitySelectionEnhancements, 300)
    return () => window.clearInterval(intervalId)
  }, [])
}

export default function FoggedApp() {
  const [isFogBridgeReady, setIsFogBridgeReady] = useState(false)
  useAtlasPageControlsVisibility()
  useAtlasMapLoadingAnimation()
  useAtlasButtonTweaks()
  useCitySearchAsEntry()
  useCitySelectionEnhancements()

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
