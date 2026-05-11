type MapInstance = import('maplibre-gl').Map
type AddSourceArgs = Parameters<MapInstance['addSource']>
type SetMaxBoundsArgs = Parameters<MapInstance['setMaxBounds']>

type Coordinate = [number, number]
type LinearRing = Coordinate[]
type PolygonGeometry = { type: 'Polygon', coordinates: LinearRing[] }
type MultiPolygonGeometry = { type: 'MultiPolygon', coordinates: LinearRing[][] }
type BoundaryGeometry = PolygonGeometry | MultiPolygonGeometry
type GeoBounds = { west: number, south: number, east: number, north: number }

type RevealPoint = {
  lng: number
  lat: number
  radiusM: number
  revealedAt: number
}

type AtlasFogSnapshot = {
  cityKey: string | null
  progress: number
  revealedPoints: number
}

type UpdatableGeoJsonSource = {
  setData: (data: unknown) => void
}

type AtlasPointSource = UpdatableGeoJsonSource & {
  __atlasFogWrapped?: boolean
}

type EventedMap = MapInstance & {
  on: (event: string, listener: () => void) => MapInstance
  off: (event: string, listener: () => void) => MapInstance
}

type FogMapState = {
  map: MapInstance
  boundary: BoundaryGeometry | null
  bounds: GeoBounds | null
  cityKey: string | null
  revealPoints: RevealPoint[]
  lastRevealCenter: { lng: number, lat: number } | null
  progress: number
  canvas: HTMLCanvasElement | null
  redrawFrame: number | null
  listenersAttached: boolean
  redrawListener: (() => void) | null
}

type PatchableMapPrototype = {
  __atlasFogPatched?: boolean
  addSource: MapInstance['addSource']
  remove: MapInstance['remove']
  setMaxBounds: MapInstance['setMaxBounds']
}

const atlasBoundarySourceId = 'atlas-boundary-source'
const atlasPointSourceId = 'atlas-point-source'
const oldFogLayerId = 'atlas-fog-fill'
const oldRevealLayerId = 'atlas-reveal-glow'
const oldFogSourceId = 'atlas-fog-source'
const oldRevealSourceId = 'atlas-reveal-source'
const storagePrefix = 'cityapp:atlas-organic-fog:v1:'
const revealRadiusMeters = 82
const revealSpacingMeters = 10
const maxRevealPoints = 3200
const progressColumns = 36
const progressRows = 36

const mapStates = new WeakMap<MapInstance, FogMapState>()
const listeners = new Set<(snapshot: AtlasFogSnapshot) => void>()
let lastSnapshot: AtlasFogSnapshot = { cityKey: null, progress: 0, revealedPoints: 0 }
let installPromise: Promise<void> | null = null

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1])
}

function normalizeRing(value: unknown): LinearRing | null {
  if (!Array.isArray(value)) {
    return null
  }

  const coordinates = value
    .filter(isCoordinate)
    .map((coordinate) => [coordinate[0], coordinate[1]] as Coordinate)

  if (coordinates.length < 4) {
    return null
  }

  const [firstLng, firstLat] = coordinates[0]
  const [lastLng, lastLat] = coordinates[coordinates.length - 1]

  if (firstLng !== lastLng || firstLat !== lastLat) {
    coordinates.push([firstLng, firstLat])
  }

  return coordinates
}

function normalizePolygon(value: unknown): LinearRing[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const rings = value
    .map(normalizeRing)
    .filter((ring): ring is LinearRing => ring !== null)

  return rings.length ? rings : null
}

function normalizeBoundary(value: unknown): BoundaryGeometry | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const geometry = value as { type?: unknown, coordinates?: unknown }

  if (geometry.type === 'Polygon') {
    const polygon = normalizePolygon(geometry.coordinates)
    return polygon ? { type: 'Polygon', coordinates: polygon } : null
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const polygons = geometry.coordinates
      .map(normalizePolygon)
      .filter((polygon): polygon is LinearRing[] => polygon !== null)

    return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null
  }

  return null
}

function extractBoundaryFromSource(source: unknown) {
  const data = (source as { data?: unknown })?.data ?? source
  const geometry = (data as { geometry?: unknown })?.geometry ?? data

  return normalizeBoundary(geometry)
}

function boundsFromBoundary(boundary: BoundaryGeometry | null) {
  if (!boundary) {
    return null
  }

  const polygons = boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        west = Math.min(west, lng)
        south = Math.min(south, lat)
        east = Math.max(east, lng)
        north = Math.max(north, lat)
      }
    }
  }

  return [west, south, east, north].every(Number.isFinite) && west < east && south < north
    ? { west, south, east, north }
    : null
}

function normalizeBounds(value: unknown): GeoBounds | null {
  if (Array.isArray(value) && value.length >= 2 && isCoordinate(value[0]) && isCoordinate(value[1])) {
    const [west, south] = value[0]
    const [east, north] = value[1]

    return west < east && south < north ? { west, south, east, north } : null
  }

  const bounds = value as { getWest?: () => number, getSouth?: () => number, getEast?: () => number, getNorth?: () => number }

  if (!bounds?.getWest || !bounds.getSouth || !bounds.getEast || !bounds.getNorth) {
    return null
  }

  const west = bounds.getWest()
  const south = bounds.getSouth()
  const east = bounds.getEast()
  const north = bounds.getNorth()

  return [west, south, east, north].every(Number.isFinite) && west < east && south < north
    ? { west, south, east, north }
    : null
}

function cityKeyFromBounds(bounds: GeoBounds) {
  return [bounds.west, bounds.south, bounds.east, bounds.north]
    .map((value) => value.toFixed(5))
    .join(':')
}

function getPolygons(boundary: BoundaryGeometry | null) {
  if (!boundary) {
    return []
  }

  return boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates
}

function getOrCreateMapState(map: MapInstance) {
  const existing = mapStates.get(map)

  if (existing) {
    return existing
  }

  const state: FogMapState = {
    map,
    boundary: null,
    bounds: null,
    cityKey: null,
    revealPoints: [],
    lastRevealCenter: null,
    progress: 0,
    canvas: null,
    redrawFrame: null,
    listenersAttached: false,
    redrawListener: null,
  }
  mapStates.set(map, state)

  return state
}

function loadRevealPoints(cityKey: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${storagePrefix}${cityKey}`) ?? '[]')

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((point): point is RevealPoint => (
      isFiniteNumber(point?.lng) &&
      isFiniteNumber(point?.lat) &&
      isFiniteNumber(point?.radiusM) &&
      isFiniteNumber(point?.revealedAt)
    ))
  } catch {
    return []
  }
}

function saveRevealPoints(state: FogMapState) {
  if (!state.cityKey) {
    return
  }

  try {
    window.localStorage.setItem(`${storagePrefix}${state.cityKey}`, JSON.stringify(state.revealPoints.slice(-maxRevealPoints)))
  } catch {
    // Discovery remains usable without storage.
  }
}

function refreshCityKey(state: FogMapState) {
  const bounds = state.bounds ?? boundsFromBoundary(state.boundary)

  if (!bounds) {
    return
  }

  state.bounds = bounds
  const nextCityKey = cityKeyFromBounds(bounds)

  if (state.cityKey === nextCityKey) {
    return
  }

  state.cityKey = nextCityKey
  state.revealPoints = loadRevealPoints(nextCityKey)
  state.lastRevealCenter = null
}

function metersBetween(a: { lng: number, lat: number }, b: { lng: number, lat: number }) {
  const earthRadiusMeters = 6_371_000
  const deltaLat = (b.lat - a.lat) * Math.PI / 180
  const deltaLng = (b.lng - a.lng) * Math.PI / 180
  const latA = a.lat * Math.PI / 180
  const latB = b.lat * Math.PI / 180
  const sinLat = Math.sin(deltaLat / 2)
  const sinLng = Math.sin(deltaLng / 2)
  const haversine = sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLng * sinLng

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(1 - haversine, 0)))
}

function interpolate(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function deterministicNoise(seed: number) {
  return Math.sin(seed * 12.9898) * 43758.5453 % 1
}

function pointInRing(point: { lng: number, lat: number }, ring: LinearRing) {
  let inside = false

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentLng, currentLat] = ring[index]
    const [previousLng, previousLat] = ring[previous]
    const crossesLatitude = currentLat > point.lat !== previousLat > point.lat
    const crossingLng = ((previousLng - currentLng) * (point.lat - currentLat)) / (previousLat - currentLat + 0.0000000001) + currentLng

    if (crossesLatitude && point.lng < crossingLng) {
      inside = !inside
    }
  }

  return inside
}

function pointInPolygon(point: { lng: number, lat: number }, polygon: LinearRing[]) {
  const [outerRing, ...holes] = polygon

  return Boolean(outerRing) && pointInRing(point, outerRing) && !holes.some((hole) => pointInRing(point, hole))
}

function isPointInsideBoundary(point: { lng: number, lat: number }, boundary: BoundaryGeometry | null) {
  if (!boundary) {
    return true
  }

  return getPolygons(boundary).some((polygon) => pointInPolygon(point, polygon))
}

function pointIsRevealed(state: FogMapState, point: { lng: number, lat: number }) {
  return state.revealPoints.some((revealPoint) => metersBetween(revealPoint, point) <= revealPoint.radiusM)
}

function estimateProgress(state: FogMapState) {
  if (!state.bounds || !state.boundary) {
    return 0
  }

  let sampleCount = 0
  let revealedCount = 0

  for (let row = 0; row < progressRows; row += 1) {
    for (let column = 0; column < progressColumns; column += 1) {
      const sample = {
        lng: state.bounds.west + ((column + 0.5) / progressColumns) * (state.bounds.east - state.bounds.west),
        lat: state.bounds.south + ((row + 0.5) / progressRows) * (state.bounds.north - state.bounds.south),
      }

      if (!isPointInsideBoundary(sample, state.boundary)) {
        continue
      }

      sampleCount += 1

      if (pointIsRevealed(state, sample)) {
        revealedCount += 1
      }
    }
  }

  return sampleCount ? Math.min(100, Math.round((revealedCount / sampleCount) * 100)) : 0
}

function publish(state: FogMapState) {
  state.progress = estimateProgress(state)
  lastSnapshot = {
    cityKey: state.cityKey,
    progress: state.progress,
    revealedPoints: state.revealPoints.length,
  }
  listeners.forEach((listener) => listener(lastSnapshot))
}

function logAtlasFog(event: string, payload: Record<string, unknown> = {}) {
  console.info(`[atlas-fog] ${event} ${JSON.stringify(payload)}`)
}

function ensureFogCanvas(state: FogMapState) {
  if (state.canvas) {
    return state.canvas
  }

  const container = state.map.getContainer()
  const computedStyle = window.getComputedStyle(container)

  if (computedStyle.position === 'static') {
    container.style.position = 'relative'
  }

  const canvas = document.createElement('canvas')
  canvas.className = 'atlas-organic-fog-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '5'
  canvas.style.mixBlendMode = 'multiply'
  container.appendChild(canvas)
  state.canvas = canvas

  return canvas
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(rect.width * ratio))
  const height = Math.max(1, Math.round(rect.height * ratio))

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  return { width: rect.width, height: rect.height, ratio }
}

function drawBoundaryPath(context: CanvasRenderingContext2D, state: FogMapState) {
  const polygons = getPolygons(state.boundary)

  context.beginPath()

  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (!ring.length) {
        continue
      }

      const first = state.map.project(ring[0])
      context.moveTo(first.x, first.y)

      for (let index = 1; index < ring.length; index += 1) {
        const point = state.map.project(ring[index])
        context.lineTo(point.x, point.y)
      }

      context.closePath()
    }
  }
}

function metersPerPixelAtLatitude(map: MapInstance, latitude: number) {
  return 156543.03392 * Math.cos(latitude * Math.PI / 180) / Math.pow(2, map.getZoom())
}

function drawRevealStamp(context: CanvasRenderingContext2D, state: FogMapState, point: RevealPoint, index: number) {
  const projected = state.map.project([point.lng, point.lat])
  const metersPerPixel = Math.max(metersPerPixelAtLatitude(state.map, point.lat), 0.0001)
  const radiusPx = Math.max(5, point.radiusM / metersPerPixel)
  const gradient = context.createRadialGradient(projected.x, projected.y, 0, projected.x, projected.y, radiusPx)

  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(0.68, 'rgba(0,0,0,0.92)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')

  context.fillStyle = gradient
  context.beginPath()
  context.arc(projected.x, projected.y, radiusPx, 0, Math.PI * 2)
  context.fill()

  // A few deterministic side lobes break up perfect circular edges without storing more data.
  for (let lobe = 0; lobe < 3; lobe += 1) {
    const noise = deterministicNoise(index * 17 + lobe * 29)
    const angle = (noise + lobe / 3) * Math.PI * 2
    const lobeRadius = radiusPx * (0.34 + Math.abs(deterministicNoise(index * 41 + lobe)) * 0.16)
    const offset = radiusPx * (0.38 + Math.abs(deterministicNoise(index * 61 + lobe)) * 0.22)
    const x = projected.x + Math.cos(angle) * offset
    const y = projected.y + Math.sin(angle) * offset
    const lobeGradient = context.createRadialGradient(x, y, 0, x, y, lobeRadius)

    lobeGradient.addColorStop(0, 'rgba(0,0,0,0.55)')
    lobeGradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = lobeGradient
    context.beginPath()
    context.arc(x, y, lobeRadius, 0, Math.PI * 2)
    context.fill()
  }
}

function drawFog(state: FogMapState) {
  if (!state.boundary) {
    return
  }

  const canvas = ensureFogCanvas(state)
  const { width, height, ratio } = resizeCanvas(canvas)
  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.scale(ratio, ratio)
  context.save()
  drawBoundaryPath(context, state)
  context.clip('evenodd')
  context.fillStyle = 'rgba(18, 24, 23, 0.72)'
  context.fillRect(0, 0, width, height)
  context.globalCompositeOperation = 'destination-out'

  state.revealPoints.forEach((point, index) => drawRevealStamp(context, state, point, index))
  context.restore()
}

function requestFogDraw(state: FogMapState) {
  if (state.redrawFrame !== null) {
    return
  }

  state.redrawFrame = window.requestAnimationFrame(() => {
    state.redrawFrame = null
    drawFog(state)
  })
}

function attachMapDrawListeners(state: FogMapState) {
  if (state.listenersAttached) {
    return
  }

  const redraw = () => requestFogDraw(state)
  const eventedMap = state.map as EventedMap

  eventedMap.on('move', redraw)
  eventedMap.on('zoom', redraw)
  eventedMap.on('resize', redraw)
  eventedMap.on('rotate', redraw)
  eventedMap.on('pitch', redraw)
  eventedMap.on('idle', redraw)
  state.listenersAttached = true
  state.redrawListener = redraw
}

function detachMapDrawListeners(state: FogMapState) {
  if (!state.listenersAttached || !state.redrawListener) {
    return
  }

  const eventedMap = state.map as EventedMap

  eventedMap.off('move', state.redrawListener)
  eventedMap.off('zoom', state.redrawListener)
  eventedMap.off('resize', state.redrawListener)
  eventedMap.off('rotate', state.redrawListener)
  eventedMap.off('pitch', state.redrawListener)
  eventedMap.off('idle', state.redrawListener)
  state.listenersAttached = false
  state.redrawListener = null
}

function removeOldMapLibreFog(map: MapInstance) {
  if (!map.isStyleLoaded()) {
    return
  }

  for (const layerId of [oldRevealLayerId, oldFogLayerId]) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId)
    }
  }

  for (const sourceId of [oldRevealSourceId, oldFogSourceId]) {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId)
    }
  }
}

function updateFogState(state: FogMapState) {
  refreshCityKey(state)
  attachMapDrawListeners(state)
  removeOldMapLibreFog(state.map)
  publish(state)
  requestFogDraw(state)
}

function extractPoint(data: unknown) {
  const geometry = (data as { geometry?: unknown })?.geometry as { type?: unknown, coordinates?: unknown } | undefined

  if (geometry?.type !== 'Point' || !isCoordinate(geometry.coordinates)) {
    return null
  }

  return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] }
}

function createOrganicRevealPoints(from: { lng: number, lat: number } | null, to: { lng: number, lat: number }) {
  const distance = from ? metersBetween(from, to) : 0
  const steps = Math.max(1, Math.ceil(distance / revealSpacingMeters))
  const points: RevealPoint[] = []

  for (let index = 0; index <= steps; index += 1) {
    const t = steps === 0 ? 1 : index / steps
    const lng = from ? interpolate(from.lng, to.lng, t) : to.lng
    const lat = from ? interpolate(from.lat, to.lat, t) : to.lat
    const radiusNoise = Math.abs(deterministicNoise(Date.now() + index * 19))

    points.push({
      lng,
      lat,
      radiusM: revealRadiusMeters * (0.86 + radiusNoise * 0.24),
      revealedAt: Date.now(),
    })
  }

  return points
}

function revealMapPoint(map: MapInstance, point: { lng: number, lat: number }) {
  const state = getOrCreateMapState(map)
  refreshCityKey(state)

  if (!isPointInsideBoundary(point, state.boundary)) {
    return
  }

  const lastPoint = state.lastRevealCenter
  const alreadyNear = lastPoint ? metersBetween(lastPoint, point) < revealSpacingMeters : false

  if (!alreadyNear) {
    const newPoints = createOrganicRevealPoints(lastPoint, point)
      .filter((candidate) => isPointInsideBoundary(candidate, state.boundary))

    state.revealPoints = [...state.revealPoints, ...newPoints].slice(-maxRevealPoints)
    state.lastRevealCenter = point
    saveRevealPoints(state)
  }

  updateFogState(state)
  logAtlasFog('reveal', {
    progress: state.progress,
    revealedPoints: state.revealPoints.length,
    cityKey: state.cityKey,
  })
}

function wrapAtlasPointSource(map: MapInstance) {
  const source = map.getSource(atlasPointSourceId) as AtlasPointSource | undefined

  if (!source || source.__atlasFogWrapped) {
    return
  }

  const originalSetData = source.setData.bind(source)
  source.__atlasFogWrapped = true
  source.setData = (data: unknown) => {
    originalSetData(data)
    const point = extractPoint(data)

    if (point) {
      revealMapPoint(map, point)
    }
  }
}

function handleSourceAdded(map: MapInstance, sourceId: string, source: AddSourceArgs[1]) {
  const state = getOrCreateMapState(map)

  if (sourceId === atlasBoundarySourceId) {
    state.boundary = extractBoundaryFromSource(source)
    state.bounds = boundsFromBoundary(state.boundary) ?? state.bounds
    updateFogState(state)
    logAtlasFog('boundary ready', {
      cityKey: state.cityKey,
      polygons: getPolygons(state.boundary).length,
      revealedPoints: state.revealPoints.length,
    })
    return
  }

  if (sourceId === atlasPointSourceId) {
    wrapAtlasPointSource(map)
    const point = extractPoint((source as { data?: unknown })?.data)

    if (point) {
      revealMapPoint(map, point)
    }
  }
}

function patchMapPrototype(prototype: PatchableMapPrototype) {
  if (prototype.__atlasFogPatched) {
    return
  }

  prototype.__atlasFogPatched = true

  const originalAddSource = prototype.addSource
  prototype.addSource = function patchedAddSource(this: MapInstance, ...args: AddSourceArgs) {
    const result = originalAddSource.apply(this, args)
    handleSourceAdded(this, args[0], args[1])

    return result
  }

  const originalSetMaxBounds = prototype.setMaxBounds
  prototype.setMaxBounds = function patchedSetMaxBounds(this: MapInstance, ...args: SetMaxBoundsArgs) {
    const result = originalSetMaxBounds.apply(this, args)
    const state = getOrCreateMapState(this)
    state.bounds = normalizeBounds(args[0]) ?? state.bounds
    updateFogState(state)

    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
    const state = mapStates.get(this)

    if (state) {
      detachMapDrawListeners(state)

      if (state.redrawFrame !== null) {
        window.cancelAnimationFrame(state.redrawFrame)
      }

      state.canvas?.remove()
    }

    mapStates.delete(this)

    return originalRemove.call(this)
  }
}

export function installAtlasGeoFogBridge() {
  if (!installPromise) {
    installPromise = import('maplibre-gl').then((maplibregl) => {
      patchMapPrototype(maplibregl.Map.prototype as unknown as PatchableMapPrototype)
      logAtlasFog('bridge installed')
    })
  }

  return installPromise
}

export function subscribeAtlasFog(listener: (snapshot: AtlasFogSnapshot) => void) {
  listeners.add(listener)
  listener(lastSnapshot)

  return () => {
    listeners.delete(listener)
  }
}

export function getAtlasFogSnapshot() {
  return lastSnapshot
}
