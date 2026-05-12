type MapInstance = import('maplibre-gl').Map

type PatchableMap = typeof import('maplibre-gl').Map.prototype & {
  __cityAtlasMapSessionPatched?: boolean
}
type StoredCamera = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
  savedAt: number
}
type BoundsLike = [[number, number], [number, number]] | { getWest?: () => number, getEast?: () => number, getSouth?: () => number, getNorth?: () => number }
type LayerEventMap = {
  on: (event: string, listener: () => void) => void
  once: (event: string, listener: () => void) => void
  loaded: () => boolean
}

const atlasCameraStorageKey = 'cityapp:atlas-map-camera:v1'
let installPromise: Promise<void> | null = null
let overlayObserver: MutationObserver | null = null
let overlayFrame = 0

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getStoredCamera(): StoredCamera | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(atlasCameraStorageKey) ?? 'null')
    if (
      parsed
      && Array.isArray(parsed.center)
      && parsed.center.length >= 2
      && finite(parsed.center[0])
      && finite(parsed.center[1])
      && finite(parsed.zoom)
      && finite(parsed.bearing)
      && finite(parsed.pitch)
      && finite(parsed.savedAt)
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

function restoreStoredCamera(map: MapInstance, bounds?: BoundsLike | null) {
  const camera = getStoredCamera()
  if (!camera || !cameraIsInsideBounds(camera, bounds)) return

  window.setTimeout(() => {
    try {
      map.jumpTo({
        center: camera.center,
        zoom: camera.zoom,
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
  const eventMap = map as unknown as LayerEventMap
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

  const originalSetMaxBounds = prototype.setMaxBounds
  prototype.setMaxBounds = function patchedSetMaxBounds(this: MapInstance, ...args: Parameters<MapInstance['setMaxBounds']>) {
    const result = originalSetMaxBounds.apply(this, args)
    restoreStoredCamera(this, args[0] as BoundsLike | null | undefined)
    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
    setStoredCamera(this)
    return originalRemove.call(this)
  }

  const originalOn = prototype.on
  prototype.on = function patchedOn(this: MapInstance, ...args: Parameters<MapInstance['on']>) {
    const result = originalOn.apply(this, args)
    if (args[0] === 'load') window.setTimeout(() => attachCameraSave(this), 0)
    return result
  }
}

function isAtlasVisible() {
  return Boolean(document.querySelector('.atlas-map-frame .atlas-map')) && !document.querySelector('.atlas-city-selection-panel')
}

function updatePlaceCardVisibility() {
  overlayFrame = 0
  const shell = document.querySelector<HTMLElement>('.city-place-discovery-card-shell')
  if (!shell) return

  shell.hidden = !isAtlasVisible()
}

function schedulePlaceCardVisibility() {
  if (!overlayFrame) overlayFrame = window.requestAnimationFrame(updatePlaceCardVisibility)
}

function installPlaceCardVisibilityGuard() {
  if (overlayObserver || typeof document === 'undefined') return
  overlayObserver = new MutationObserver(schedulePlaceCardVisibility)
  overlayObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] })
  document.addEventListener('click', schedulePlaceCardVisibility, true)
  schedulePlaceCardVisibility()
}

export function installAtlasMapSessionBridge() {
  installPlaceCardVisibilityGuard()

  if (!installPromise) {
    installPromise = import('maplibre-gl').then((maplibregl) => {
      patchMapPrototype(maplibregl.Map.prototype as PatchableMap)
      console.info('[atlas-session] camera persistence installed')
    })
  }

  return installPromise
}
