type MapInstance = import('maplibre-gl').Map
type Coordinate = [number, number]
type Ring = Coordinate[]
type Boundary = { type: 'Polygon', coordinates: Ring[] } | { type: 'MultiPolygon', coordinates: Ring[][] }
type Bounds = { west: number, south: number, east: number, north: number }
type RevealPoint = { lng: number, lat: number, radiusM: number, revealedAt: number }
type AtlasFogSnapshot = { cityKey: string | null, progress: number, revealedPoints: number }
type UpdatableGeoJsonSource = { setData: (data: unknown) => void }
type PatchableMap = typeof import('maplibre-gl').Map.prototype & { __atlasFogPatched?: boolean }
type FogState = {
  map: MapInstance
  boundary: Boundary | null
  bounds: Bounds | null
  cityKey: string | null
  points: RevealPoint[]
  lastCenter: { lng: number, lat: number } | null
  progress: number
  canvas: HTMLCanvasElement | null
  buffer: HTMLCanvasElement | null
  frame: number | null
  listener: (() => void) | null
}

const boundarySourceId = 'atlas-boundary-source'
const pointSourceId = 'atlas-point-source'
const outsideMaskLayerId = 'atlas-outside-city-mask'
const accuracyLayerId = 'atlas-accuracy-circle'
const oldFogLayerId = 'atlas-fog-fill'
const oldRevealLayerId = 'atlas-reveal-glow'
const oldFogSourceId = 'atlas-fog-source'
const oldRevealSourceId = 'atlas-reveal-source'
const storagePrefix = 'cityapp:atlas-organic-fog:v1:'
const revealRadiusMeters = 82
const revealSpacingMeters = 10
const maxRevealPoints = 3200
const progressCells = 36
const states = new WeakMap<MapInstance, FogState>()
const activeStates = new Set<FogState>()
const listeners = new Set<(snapshot: AtlasFogSnapshot) => void>()
let snapshot: AtlasFogSnapshot = { cityKey: null, progress: 0, revealedPoints: 0 }
let installPromise: Promise<void> | null = null
let isFogVisible = true

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 && finite(value[0]) && finite(value[1])
}

function normalizeRing(value: unknown): Ring | null {
  if (!Array.isArray(value)) return null
  const ring = value.filter(isCoordinate).map(([lng, lat]) => [lng, lat] as Coordinate)
  if (ring.length < 4) return null
  const [firstLng, firstLat] = ring[0]
  const [lastLng, lastLat] = ring[ring.length - 1]
  if (firstLng !== lastLng || firstLat !== lastLat) ring.push([firstLng, firstLat])
  return ring
}

function normalizePolygon(value: unknown): Ring[] | null {
  if (!Array.isArray(value)) return null
  const rings = value.map(normalizeRing).filter((ring): ring is Ring => Boolean(ring))
  return rings.length ? rings : null
}

function normalizeBoundary(value: unknown): Boundary | null {
  if (!value || typeof value !== 'object') return null
  const geometry = value as { type?: unknown, coordinates?: unknown }
  if (geometry.type === 'Polygon') {
    const polygon = normalizePolygon(geometry.coordinates)
    return polygon ? { type: 'Polygon', coordinates: polygon } : null
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const polygons = geometry.coordinates.map(normalizePolygon).filter((polygon): polygon is Ring[] => Boolean(polygon))
    return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null
  }
  return null
}

function boundaryFromSource(source: unknown) {
  const data = (source as { data?: unknown })?.data ?? source
  return normalizeBoundary((data as { geometry?: unknown })?.geometry ?? data)
}

function polygons(boundary: Boundary | null) {
  if (!boundary) return []
  return boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates
}

function boundsFromBoundary(boundary: Boundary | null): Bounds | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const polygon of polygons(boundary)) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        west = Math.min(west, lng)
        south = Math.min(south, lat)
        east = Math.max(east, lng)
        north = Math.max(north, lat)
      }
    }
  }
  return [west, south, east, north].every(Number.isFinite) && west < east && south < north ? { west, south, east, north } : null
}

function normalizeBounds(value: unknown): Bounds | null {
  if (Array.isArray(value) && value.length >= 2 && isCoordinate(value[0]) && isCoordinate(value[1])) {
    const [west, south] = value[0]
    const [east, north] = value[1]
    return west < east && south < north ? { west, south, east, north } : null
  }
  const bounds = value as { getWest?: () => number, getSouth?: () => number, getEast?: () => number, getNorth?: () => number }
  if (!bounds?.getWest || !bounds.getSouth || !bounds.getEast || !bounds.getNorth) return null
  const west = bounds.getWest()
  const south = bounds.getSouth()
  const east = bounds.getEast()
  const north = bounds.getNorth()
  return [west, south, east, north].every(Number.isFinite) && west < east && south < north ? { west, south, east, north } : null
}

function cityKey(bounds: Bounds) {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(5)).join(':')
}

function getState(map: MapInstance) {
  const existing = states.get(map)
  if (existing) return existing
  const state: FogState = { map, boundary: null, bounds: null, cityKey: null, points: [], lastCenter: null, progress: 0, canvas: null, buffer: null, frame: null, listener: null }
  states.set(map, state)
  activeStates.add(state)
  return state
}

function loadPoints(key: string): RevealPoint[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${storagePrefix}${key}`) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((point): point is RevealPoint => finite(point?.lng) && finite(point?.lat) && finite(point?.radiusM) && finite(point?.revealedAt)) : []
  } catch {
    return []
  }
}

function savePoints(state: FogState) {
  if (!state.cityKey) return
  try {
    window.localStorage.setItem(`${storagePrefix}${state.cityKey}`, JSON.stringify(state.points.slice(-maxRevealPoints)))
  } catch {
    // Local storage is optional for discovery.
  }
}

function refreshCity(state: FogState) {
  const nextBounds = state.bounds ?? boundsFromBoundary(state.boundary)
  if (!nextBounds) return
  state.bounds = nextBounds
  const nextKey = cityKey(nextBounds)
  if (state.cityKey === nextKey) return
  state.cityKey = nextKey
  state.points = loadPoints(nextKey)
  state.lastCenter = null
}

function metersBetween(a: { lng: number, lat: number }, b: { lng: number, lat: number }) {
  const earth = 6_371_000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const latA = a.lat * Math.PI / 180
  const latB = b.lat * Math.PI / 180
  const sLat = Math.sin(dLat / 2)
  const sLng = Math.sin(dLng / 2)
  const h = sLat * sLat + Math.cos(latA) * Math.cos(latB) * sLng * sLng
  return 2 * earth * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(1 - h, 0)))
}

function noise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function insideRing(point: { lng: number, lat: number }, ring: Ring) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [lng, lat] = ring[index]
    const [prevLng, prevLat] = ring[previous]
    const crosses = lat > point.lat !== prevLat > point.lat
    const crossingLng = ((prevLng - lng) * (point.lat - lat)) / (prevLat - lat + 0.0000000001) + lng
    if (crosses && point.lng < crossingLng) inside = !inside
  }
  return inside
}

function insidePolygon(point: { lng: number, lat: number }, polygon: Ring[]) {
  const [outer, ...holes] = polygon
  return Boolean(outer) && insideRing(point, outer) && !holes.some((hole) => insideRing(point, hole))
}

function insideBoundary(point: { lng: number, lat: number }, boundary: Boundary | null) {
  return boundary ? polygons(boundary).some((polygon) => insidePolygon(point, polygon)) : true
}

function revealed(state: FogState, point: { lng: number, lat: number }) {
  return state.points.some((revealPoint) => metersBetween(revealPoint, point) <= revealPoint.radiusM)
}

function estimateProgress(state: FogState) {
  if (!state.bounds || !state.boundary) return 0
  let samples = 0
  let hit = 0
  for (let row = 0; row < progressCells; row += 1) {
    for (let col = 0; col < progressCells; col += 1) {
      const sample = {
        lng: state.bounds.west + ((col + 0.5) / progressCells) * (state.bounds.east - state.bounds.west),
        lat: state.bounds.south + ((row + 0.5) / progressCells) * (state.bounds.north - state.bounds.south),
      }
      if (!insideBoundary(sample, state.boundary)) continue
      samples += 1
      if (revealed(state, sample)) hit += 1
    }
  }
  return samples ? Math.min(100, Math.round((hit / samples) * 100)) : 0
}

function publish(state: FogState) {
  state.progress = estimateProgress(state)
  snapshot = { cityKey: state.cityKey, progress: state.progress, revealedPoints: state.points.length }
  listeners.forEach((listener) => listener(snapshot))
}

function applyVisibility(state: FogState) {
  if (state.canvas) state.canvas.style.display = isFogVisible ? 'block' : 'none'
}

function ensureCanvas(state: FogState) {
  if (state.canvas) {
    applyVisibility(state)
    return state.canvas
  }
  const container = state.map.getContainer()
  if (window.getComputedStyle(container).position === 'static') container.style.position = 'relative'
  const canvas = document.createElement('canvas')
  canvas.className = 'atlas-organic-fog-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '5', display: isFogVisible ? 'block' : 'none' })
  container.appendChild(canvas)
  state.canvas = canvas
  state.buffer = document.createElement('canvas')
  return canvas
}

function resize(state: FogState, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.round(rect.width * ratio))
  const height = Math.max(1, Math.round(rect.height * ratio))
  const buffer = state.buffer ?? document.createElement('canvas')
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  if (buffer.width !== width || buffer.height !== height) {
    buffer.width = width
    buffer.height = height
  }
  state.buffer = buffer
  return { buffer, ratio, cssWidth: rect.width, cssHeight: rect.height }
}

function drawBoundaryPath(context: CanvasRenderingContext2D, state: FogState) {
  context.beginPath()
  for (const polygon of polygons(state.boundary)) {
    for (const ring of polygon) {
      if (!ring.length) continue
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

function metersPerPixel(map: MapInstance, lat: number) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom())
}

function drawReveal(context: CanvasRenderingContext2D, state: FogState, point: RevealPoint, index: number) {
  const projected = state.map.project([point.lng, point.lat])
  const radius = Math.max(5, point.radiusM / Math.max(metersPerPixel(state.map, point.lat), 0.0001))
  const gradient = context.createRadialGradient(projected.x, projected.y, 0, projected.x, projected.y, radius)
  gradient.addColorStop(0, 'rgba(0,0,0,1)')
  gradient.addColorStop(0.68, 'rgba(0,0,0,0.92)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.beginPath()
  context.arc(projected.x, projected.y, radius, 0, Math.PI * 2)
  context.fill()
  for (let lobe = 0; lobe < 3; lobe += 1) {
    const angle = (noise(index * 17 + lobe * 29) + lobe / 3) * Math.PI * 2
    const lobeRadius = radius * (0.34 + noise(index * 41 + lobe) * 0.16)
    const offset = radius * (0.38 + noise(index * 61 + lobe) * 0.22)
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

function drawFog(state: FogState) {
  if (!state.boundary) return
  const canvas = ensureCanvas(state)
  const { buffer, ratio, cssWidth, cssHeight } = resize(state, canvas)
  const bufferContext = buffer.getContext('2d')
  const visibleContext = canvas.getContext('2d')
  if (!bufferContext || !visibleContext) return
  bufferContext.setTransform(1, 0, 0, 1, 0, 0)
  bufferContext.clearRect(0, 0, buffer.width, buffer.height)
  bufferContext.scale(ratio, ratio)
  bufferContext.save()
  drawBoundaryPath(bufferContext, state)
  bufferContext.clip('evenodd')
  bufferContext.fillStyle = '#111715'
  bufferContext.fillRect(0, 0, cssWidth, cssHeight)
  bufferContext.globalCompositeOperation = 'destination-out'
  state.points.forEach((point, index) => drawReveal(bufferContext, state, point, index))
  bufferContext.restore()
  visibleContext.setTransform(1, 0, 0, 1, 0, 0)
  visibleContext.clearRect(0, 0, canvas.width, canvas.height)
  visibleContext.drawImage(buffer, 0, 0)
}

function requestDraw(state: FogState) {
  if (!isFogVisible) {
    applyVisibility(state)
    return
  }
  if (state.frame !== null) return
  state.frame = window.requestAnimationFrame(() => {
    state.frame = null
    drawFog(state)
  })
}

function attachListeners(state: FogState) {
  if (state.listener) return
  const redraw = () => requestDraw(state)
  const map = state.map as MapInstance & { on: (event: string, listener: () => void) => MapInstance }
  for (const event of ['move', 'zoom', 'resize', 'rotate', 'pitch', 'idle']) map.on(event, redraw)
  state.listener = redraw
}

function detachListeners(state: FogState) {
  if (!state.listener) return
  const map = state.map as MapInstance & { off: (event: string, listener: () => void) => MapInstance }
  for (const event of ['move', 'zoom', 'resize', 'rotate', 'pitch', 'idle']) map.off(event, state.listener)
  state.listener = null
}

function removeOldFog(map: MapInstance) {
  if (!map.isStyleLoaded()) return
  for (const id of [oldRevealLayerId, oldFogLayerId]) if (map.getLayer(id)) map.removeLayer(id)
  for (const id of [oldRevealSourceId, oldFogSourceId]) if (map.getSource(id)) map.removeSource(id)
}

function updateState(state: FogState) {
  refreshCity(state)
  attachListeners(state)
  removeOldFog(state.map)
  publish(state)
  requestDraw(state)
}

function extractPoint(data: unknown) {
  const geometry = (data as { geometry?: unknown })?.geometry as { type?: unknown, coordinates?: unknown } | undefined
  return geometry?.type === 'Point' && isCoordinate(geometry.coordinates) ? { lng: geometry.coordinates[0], lat: geometry.coordinates[1] } : null
}

function createRevealPoints(from: { lng: number, lat: number } | null, to: { lng: number, lat: number }) {
  const distance = from ? metersBetween(from, to) : 0
  const steps = Math.max(1, Math.ceil(distance / revealSpacingMeters))
  const now = Date.now()
  const points: RevealPoint[] = []
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    points.push({
      lng: from ? from.lng + (to.lng - from.lng) * t : to.lng,
      lat: from ? from.lat + (to.lat - from.lat) * t : to.lat,
      radiusM: revealRadiusMeters * (0.86 + noise(now + index * 19) * 0.24),
      revealedAt: now,
    })
  }
  return points
}

function revealPoint(map: MapInstance, point: { lng: number, lat: number }) {
  const state = getState(map)
  refreshCity(state)
  if (!insideBoundary(point, state.boundary)) return
  const previous = state.lastCenter
  const alreadyNear = previous ? metersBetween(previous, point) < revealSpacingMeters : false
  if (!alreadyNear) {
    state.points = [...state.points, ...createRevealPoints(previous, point).filter((candidate) => insideBoundary(candidate, state.boundary))].slice(-maxRevealPoints)
    state.lastCenter = point
    savePoints(state)
  }
  updateState(state)
  console.info(`[atlas-fog] reveal ${JSON.stringify({ progress: state.progress, revealedPoints: state.points.length, cityKey: state.cityKey })}`)
}

function wrapPointSource(map: MapInstance) {
  const source = map.getSource(pointSourceId) as (UpdatableGeoJsonSource & { __atlasFogWrapped?: boolean }) | undefined
  if (!source || source.__atlasFogWrapped) return
  const originalSetData = source.setData.bind(source)
  source.__atlasFogWrapped = true
  source.setData = (data: unknown) => {
    originalSetData(data)
    const point = extractPoint(data)
    if (point) revealPoint(map, point)
  }
}

function handleSource(map: MapInstance, id: string, source: unknown) {
  const state = getState(map)
  if (id === boundarySourceId) {
    state.boundary = boundaryFromSource(source)
    state.bounds = boundsFromBoundary(state.boundary) ?? state.bounds
    updateState(state)
    console.info(`[atlas-fog] boundary ready ${JSON.stringify({ cityKey: state.cityKey, polygons: polygons(state.boundary).length, revealedPoints: state.points.length })}`)
    return
  }
  if (id === pointSourceId) {
    wrapPointSource(map)
    const point = extractPoint((source as { data?: unknown })?.data)
    if (point) revealPoint(map, point)
  }
}

function patchMapPrototype(prototype: PatchableMap) {
  if (prototype.__atlasFogPatched) return
  prototype.__atlasFogPatched = true

  const originalAddLayer = prototype.addLayer
  prototype.addLayer = function patchedAddLayer(this: MapInstance, ...args: Parameters<MapInstance['addLayer']>) {
    const layer = args[0] as { id?: unknown, paint?: Record<string, unknown> }
    if (layer.id === accuracyLayerId || layer.id === oldRevealLayerId || layer.id === oldFogLayerId) return this
    if (layer.id === outsideMaskLayerId) {
      layer.paint = { ...(layer.paint ?? {}), 'fill-color': '#8fa196', 'fill-opacity': 0.18 }
    }
    return originalAddLayer.apply(this, args)
  }

  const originalAddSource = prototype.addSource
  prototype.addSource = function patchedAddSource(this: MapInstance, ...args: Parameters<MapInstance['addSource']>) {
    const result = originalAddSource.apply(this, args)
    handleSource(this, args[0], args[1])
    return result
  }

  const originalSetMaxBounds = prototype.setMaxBounds
  prototype.setMaxBounds = function patchedSetMaxBounds(this: MapInstance, ...args: Parameters<MapInstance['setMaxBounds']>) {
    const result = originalSetMaxBounds.apply(this, args)
    const state = getState(this)
    state.bounds = normalizeBounds(args[0]) ?? state.bounds
    updateState(state)
    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
    const state = states.get(this)
    if (state) {
      detachListeners(state)
      if (state.frame !== null) window.cancelAnimationFrame(state.frame)
      state.canvas?.remove()
      activeStates.delete(state)
    }
    states.delete(this)
    return originalRemove.call(this)
  }
}

export function installAtlasGeoFogBridge() {
  if (!installPromise) {
    installPromise = import('maplibre-gl').then((maplibregl) => {
      patchMapPrototype(maplibregl.Map.prototype as PatchableMap)
      console.info('[atlas-fog] bridge installed {}')
    })
  }
  return installPromise
}

export function setAtlasFogVisible(visible: boolean) {
  isFogVisible = visible
  activeStates.forEach((state) => {
    applyVisibility(state)
    if (visible) requestDraw(state)
  })
}

export function getAtlasFogVisible() {
  return isFogVisible
}

export function subscribeAtlasFog(listener: (snapshot: AtlasFogSnapshot) => void) {
  listeners.add(listener)
  listener(snapshot)
  return () => {
    listeners.delete(listener)
  }
}

export function getAtlasFogSnapshot() {
  return snapshot
}
