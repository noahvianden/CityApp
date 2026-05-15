type MapInstance = import('maplibre-gl').Map

type PatchableMap = typeof import('maplibre-gl').Map.prototype & {
  __cityAtlasMapSessionPatched?: boolean
  __cityAtlasBaseMinZoom?: number
}
type StoredCamera = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
  savedAt: number
}
type BoundsLike =
  | [[number, number], [number, number]]
  | { getWest?: () => number; getEast?: () => number; getSouth?: () => number; getNorth?: () => number }
type CameraEventMap = {
  on: (event: string, listener: () => void) => unknown
  once: (event: string, listener: () => void) => unknown
  loaded: () => boolean
}

type MapWithSession = MapInstance & {
  __cityAtlasCameraAttached?: boolean
  __cityAtlasBaseMinZoom?: number
}

const atlasCameraStorageKey = 'cityapp:atlas-map-camera:v1'
const atlasActiveCityNameStorageKey = 'cityapp:atlas-active-city-name:v1'
let installPromise: Promise<void> | null = null
let overlayObserver: MutationObserver | null = null
let overlayFrame = 0
let citySelectionFrame = 0
let citySelectionListenersInstalled = false
let allowPlaceCardReopen = false

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeCityName(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function getStoredActiveCityName() {
  try {
    return window.sessionStorage.getItem(atlasActiveCityNameStorageKey)?.trim() ?? ''
  } catch {
    return ''
  }
}

function setStoredActiveCityName(name: string) {
  const normalizedName = name.replace(/\s+/g, ' ').trim()
  if (!normalizedName) return

  try {
    window.sessionStorage.setItem(atlasActiveCityNameStorageKey, normalizedName)
  } catch {
    // Active city memory is session convenience only.
  }
}

function rememberVisibleActiveCityName() {
  const name = document.querySelector<HTMLElement>('.atlas-city-title-button span')?.textContent?.trim()
  if (name) setStoredActiveCityName(name)
}

function getCityOptionTitle(option: HTMLButtonElement) {
  return option.querySelector('strong')?.textContent?.trim() ?? ''
}

function getActiveCityOption() {
  const activeCityName = normalizeCityName(getStoredActiveCityName())
  if (!activeCityName) return null

  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('.atlas-city-option')).find(
      (option) => normalizeCityName(getCityOptionTitle(option)) === activeCityName,
    ) ?? null
  )
}

function keepCurrentCityVisible() {
  citySelectionFrame = 0
  rememberVisibleActiveCityName()

  const cityList = document.querySelector<HTMLElement>('.atlas-city-list')
  const activeOption = getActiveCityOption()
  if (!cityList || !activeOption) return

  activeOption.hidden = false
  activeOption.classList.add('is-active-city')
  activeOption.dataset.atlasCurrentCity = 'true'

  if (cityList.firstElementChild !== activeOption) {
    cityList.prepend(activeOption)
  }
}

function scheduleKeepCurrentCityVisible() {
  if (!citySelectionFrame) citySelectionFrame = window.requestAnimationFrame(keepCurrentCityVisible)
}

function clickBackToCurrentAtlas(event: MouseEvent) {
  const backButton = (event.target as HTMLElement | null)?.closest<HTMLElement>('.atlas-city-back-button')
  if (!backButton) return

  const activeOption = getActiveCityOption()
  const fallbackOption = Array.from(document.querySelectorAll<HTMLButtonElement>('.atlas-city-option')).find((option) => !option.hidden)
  const optionToOpen = activeOption ?? fallbackOption
  if (!optionToOpen) return

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()

  window.setTimeout(() => {
    optionToOpen.click()
    scheduleKeepCurrentCityVisible()
  }, 0)
}

function getStoredCamera(): StoredCamera | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(atlasCameraStorageKey) ?? 'null')
    if (
      parsed &&
      Array.isArray(parsed.center) &&
      parsed.center.length >= 2 &&
      finite(parsed.center[0]) &&
      finite(parsed.center[1]) &&
      finite(parsed.zoom) &&
      finite(parsed.bearing) &&
      finite(parsed.pitch) &&
      finite(parsed.savedAt)
    ) {
      return parsed as StoredCamera
    }
  } catch {
    // Camera state is session convenience only.
  }

  return null
}

function setStoredCamera(map: MapInstance) {
  try {
    const center = map.getCenter()
    const camera: StoredCamera = {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      savedAt: Date.now(),
    }
    window.sessionStorage.setItem(atlasCameraStorageKey, JSON.stringify(camera))
  } catch {
    // Camera state is session convenience only.
  }
}

function getBoundsParts(bounds: BoundsLike | null | undefined) {
  if (!bounds) return null

  if (Array.isArray(bounds)) {
    const west = bounds[0]?.[0]
    const south = bounds[0]?.[1]
    const east = bounds[1]?.[0]
    const north = bounds[1]?.[1]
    return [west, south, east, north].every(finite) ? { west, south, east, north } : null
  }

  const west = bounds.getWest?.()
  const south = bounds.getSouth?.()
  const east = bounds.getEast?.()
  const north = bounds.getNorth?.()
  return [west, south, east, north].every(finite) ? { west: west!, south: south!, east: east!, north: north! } : null
}

function cameraIsInsideBounds(camera: StoredCamera, bounds: BoundsLike | null | undefined) {
  const parts = getBoundsParts(bounds)
  if (!parts) return true

  const [lng, lat] = camera.center
  return lng >= parts.west && lng <= parts.east && lat >= parts.south && lat <= parts.north
}

function getCameraZoom(map: MapInstance, camera: StoredCamera) {
  const baseMinZoom = (map as MapWithSession).__cityAtlasBaseMinZoom
  return finite(baseMinZoom) ? Math.max(camera.zoom, baseMinZoom) : camera.zoom
}

function restoreStoredCamera(map: MapInstance, bounds?: BoundsLike | null) {
  const camera = getStoredCamera()
  if (!camera || !cameraIsInsideBounds(camera, bounds)) return

  window.setTimeout(() => {
    try {
      map.jumpTo({
        center: camera.center,
        zoom: getCameraZoom(map, camera),
        bearing: camera.bearing,
        pitch: camera.pitch,
      })
      map.resize()
    } catch {
      // Ignore failed camera restore if MapLibre is not ready.
    }
  }, 0)
}

function attachCameraSave(map: MapInstance) {
  const sessionMap = map as MapWithSession
  if (sessionMap.__cityAtlasCameraAttached) return
  sessionMap.__cityAtlasCameraAttached = true

  const eventMap = map as unknown as CameraEventMap
  eventMap.on('moveend', () => setStoredCamera(map))
  eventMap.on('zoomend', () => setStoredCamera(map))
  eventMap.on('rotateend', () => setStoredCamera(map))
  eventMap.on('pitchend', () => setStoredCamera(map))
  if (eventMap.loaded()) {
    restoreStoredCamera(map, map.getMaxBounds?.())
  } else {
    eventMap.once('load', () => restoreStoredCamera(map, map.getMaxBounds?.()))
  }
}

function patchMapPrototype(prototype: PatchableMap) {
  if (prototype.__cityAtlasMapSessionPatched) return
  prototype.__cityAtlasMapSessionPatched = true

  const originalSetMinZoom = prototype.setMinZoom
  prototype.setMinZoom = function patchedSetMinZoom(this: MapInstance, zoom: number) {
    const sessionMap = this as MapWithSession
    if (!finite(sessionMap.__cityAtlasBaseMinZoom) && finite(zoom) && zoom > 0) {
      sessionMap.__cityAtlasBaseMinZoom = zoom
    }

    const nextZoom = finite(sessionMap.__cityAtlasBaseMinZoom) ? Math.max(zoom, sessionMap.__cityAtlasBaseMinZoom) : zoom
    return originalSetMinZoom.call(this, nextZoom)
  }

  const originalSetMaxBounds = prototype.setMaxBounds
  prototype.setMaxBounds = function patchedSetMaxBounds(this: MapInstance, ...args: Parameters<MapInstance['setMaxBounds']>) {
    const result = originalSetMaxBounds.apply(this, args)
    attachCameraSave(this)
    restoreStoredCamera(this, args[0] as BoundsLike | null | undefined)
    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
    setStoredCamera(this)
    return originalRemove.call(this)
  }
}

function isAtlasVisible() {
  return Boolean(document.querySelector('.atlas-map-frame .atlas-map')) && !document.querySelector('.atlas-city-selection-panel')
}

function getPlaceCardShell() {
  return document.querySelector<HTMLElement>('.city-place-discovery-card-shell')
}

function markPlaceCardDismissed() {
  const shell = getPlaceCardShell()
  if (!shell) return

  shell.dataset.placeCardDismissed = 'true'
  shell.hidden = true
}

function notePossiblePlaceSelection(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return

  if (target.closest('.city-place-card-close')) {
    markPlaceCardDismissed()
    schedulePlaceCardVisibility()
    return
  }

  if (target.closest('.atlas-map')) {
    allowPlaceCardReopen = true
    window.setTimeout(() => {
      allowPlaceCardReopen = false
    }, 300)
  }
}

function updatePlaceCardVisibility() {
  overlayFrame = 0
  const shell = getPlaceCardShell()
  if (!shell) return

  const dismissed = shell.dataset.placeCardDismissed === 'true'

  if (dismissed && allowPlaceCardReopen && !shell.hidden && isAtlasVisible()) {
    shell.dataset.placeCardDismissed = 'false'
    allowPlaceCardReopen = false
  } else if (dismissed) {
    shell.hidden = true
    return
  }

  shell.hidden = !isAtlasVisible()
}

function schedulePlaceCardVisibility() {
  if (!overlayFrame) overlayFrame = window.requestAnimationFrame(updatePlaceCardVisibility)
}

function installDomGuards() {
  if (overlayObserver || typeof document === 'undefined') return
  overlayObserver = new MutationObserver(() => {
    schedulePlaceCardVisibility()
    scheduleKeepCurrentCityVisible()
  })
  overlayObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] })

  if (!citySelectionListenersInstalled) {
    citySelectionListenersInstalled = true
    document.addEventListener('click', clickBackToCurrentAtlas, true)
    document.addEventListener(
      'click',
      (event) => {
        notePossiblePlaceSelection(event)
        rememberVisibleActiveCityName()
        schedulePlaceCardVisibility()
        scheduleKeepCurrentCityVisible()
      },
      true,
    )
  }

  schedulePlaceCardVisibility()
  scheduleKeepCurrentCityVisible()
}

export function installAtlasMapSessionBridge() {
  installDomGuards()

  if (!installPromise) {
    installPromise = import('maplibre-gl').then((maplibregl) => {
      patchMapPrototype(maplibregl.Map.prototype as PatchableMap)
      console.info('[atlas-session] camera persistence installed')
    })
  }

  return installPromise
}
