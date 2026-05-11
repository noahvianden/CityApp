type MapInstance = import('maplibre-gl').Map
type AddLayerArgs = Parameters<MapInstance['addLayer']>
type AddSourceArgs = Parameters<MapInstance['addSource']>
type SetMaxBoundsArgs = Parameters<MapInstance['setMaxBounds']>

type Coordinate = [number, number]
type LinearRing = Coordinate[]
type PolygonGeometry = { type: 'Polygon', coordinates: LinearRing[] }
type PointGeometry = { type: 'Point', coordinates: Coordinate }
type Feature<TGeometry> = { type: 'Feature', geometry: TGeometry, properties: Record<string, unknown> }
type FeatureCollection<TGeometry> = { type: 'FeatureCollection', features: Array<Feature<TGeometry>> }
type GeoBounds = { west: number, south: number, east: number, north: number }
type RevealPoint = { lng: number, lat: number, revealedAt: number }

type AtlasFogSnapshot = {
  cityKey: string | null
  progress: number
  revealedPoints: number
}

type UpdatableGeoJsonSource = { setData: (data: unknown) => void }
type AtlasPointSource = UpdatableGeoJsonSource & { __atlasFogWrapped?: boolean }
type EventedMap = MapInstance & {
  once: (event: string, listener: () => void) => MapInstance
}

type FogMapState = {
  map: MapInstance
  bounds: GeoBounds | null
  cityKey: string | null
  revealPoints: RevealPoint[]
  progress: number
  fogCells: number
  isStyleRetryScheduled: boolean
}

type PatchableMapPrototype = {
  __atlasFogPatched?: boolean
  addLayer: MapInstance['addLayer']
  addSource: MapInstance['addSource']
  remove: MapInstance['remove']
  setMaxBounds: MapInstance['setMaxBounds']
}

const fogSourceId = 'atlas-fog-source'
const revealSourceId = 'atlas-reveal-source'
const fogLayerId = 'atlas-fog-fill'
const revealLayerId = 'atlas-reveal-glow'
const atlasBoundarySourceId = 'atlas-boundary-source'
const atlasPointSourceId = 'atlas-point-source'
const atlasOutsideMaskLayerId = 'atlas-outside-city-mask'
const storagePrefix = 'cityapp:atlas-geo-fog-grid-v3:'
const revealRadiusMeters = 520
const revealSpacingMeters = 32
const fogGridColumns = 46
const fogGridRows = 46

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

function getOrCreateMapState(map: MapInstance) {
  const existing = mapStates.get(map)

  if (existing) {
    return existing
  }

  const state: FogMapState = {
    map,
    bounds: null,
    cityKey: null,
    revealPoints: [],
    progress: 0,
    fogCells: 0,
    isStyleRetryScheduled: false,
  }
  mapStates.set(map, state)

  return state
}

function visitCoordinates(value: unknown, visit: (coordinate: Coordinate) => void) {
  if (isCoordinate(value)) {
    visit([value[0], value[1]])
    return
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => visitCoordinates(entry, visit))
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  const candidate = value as { coordinates?: unknown, geometry?: unknown, features?: unknown }

  if (candidate.coordinates) {
    visitCoordinates(candidate.coordinates, visit)
  }

  if (candidate.geometry) {
    visitCoordinates(candidate.geometry, visit)
  }

  if (candidate.features) {
    visitCoordinates(candidate.features, visit)
  }
}

function extractBoundsFromSource(source: unknown): GeoBounds | null {
  const data = (source as { data?: unknown })?.data ?? source
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  visitCoordinates(data, ([lng, lat]) => {
    west = Math.min(west, lng)
    south = Math.min(south, lat)
    east = Math.max(east, lng)
    north = Math.max(north, lat)
  })

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

  return [west, south, east, north].every(Number.isFinite) && west < east && south < north ? { west, south, east, north } : null
}

function cityKeyFromBounds(bounds: GeoBounds) {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(5)).join(':')
}

function loadRevealPoints(cityKey: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${storagePrefix}${cityKey}`) ?? '[]')

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((point): point is RevealPoint => (
      isFiniteNumber(point?.lng) && isFiniteNumber(point?.lat) && isFiniteNumber(point?.revealedAt)
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
    window.localStorage.setItem(`${storagePrefix}${state.cityKey}`, JSON.stringify(state.revealPoints.slice(-800)))
  } catch {
    // Discovery remains usable without storage.
  }
}

function refreshCityKey(state: FogMapState) {
  if (!state.bounds) {
    return
  }

  const nextCityKey = cityKeyFromBounds(state.bounds)

  if (state.cityKey === nextCityKey) {
    return
  }

  state.cityKey = nextCityKey
  state.revealPoints = loadRevealPoints(nextCityKey)
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

function isPointInsideBounds(point: { lng: number, lat: number }, bounds: GeoBounds | null) {
  if (!bounds) {
    return true
  }

  return point.lng >= bounds.west && point.lng <= bounds.east && point.lat >= bounds.south && point.lat <= bounds.north
}

function pointIsRevealed(state: FogMapState, point: { lng: number, lat: number }) {
  return state.revealPoints.some((revealPoint) => metersBetween(revealPoint, point) <= revealRadiusMeters)
}

function createFogCellGeometry(west: number, south: number, east: number, north: number): PolygonGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  }
}

function createFogFeatureCollection(state: FogMapState): FeatureCollection<PolygonGeometry> {
  if (!state.bounds) {
    state.fogCells = 0
    return { type: 'FeatureCollection', features: [] }
  }

  const features: Array<Feature<PolygonGeometry>> = []
  const cellWidth = (state.bounds.east - state.bounds.west) / fogGridColumns
  const cellHeight = (state.bounds.north - state.bounds.south) / fogGridRows

  for (let row = 0; row < fogGridRows; row += 1) {
    for (let column = 0; column < fogGridColumns; column += 1) {
      const west = state.bounds.west + column * cellWidth
      const east = west + cellWidth
      const south = state.bounds.south + row * cellHeight
      const north = south + cellHeight
      const center = { lng: west + cellWidth / 2, lat: south + cellHeight / 2 }

      if (pointIsRevealed(state, center)) {
        continue
      }

      features.push({
        type: 'Feature',
        geometry: createFogCellGeometry(west, south, east, north),
        properties: { cell: `${column}:${row}` },
      })
    }
  }

  state.fogCells = features.length

  return { type: 'FeatureCollection', features }
}

function createRevealFeatureCollection(state: FogMapState): FeatureCollection<PointGeometry> {
  return {
    type: 'FeatureCollection',
    features: state.revealPoints.slice(-80).map((point) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
      properties: { revealedAt: point.revealedAt },
    })),
  }
}

function estimateProgress(state: FogMapState) {
  if (!state.bounds) {
    return Math.min(100, state.revealPoints.length * 3)
  }

  const columns = 18
  const rows = 18
  let sampleCount = 0
  let revealedCount = 0

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const sample = {
        lng: state.bounds.west + ((column + 0.5) / columns) * (state.bounds.east - state.bounds.west),
        lat: state.bounds.south + ((row + 0.5) / rows) * (state.bounds.north - state.bounds.south),
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
  lastSnapshot = { cityKey: state.cityKey, progress: state.progress, revealedPoints: state.revealPoints.length }
  listeners.forEach((listener) => listener(lastSnapshot))
}

function getSource(map: MapInstance, sourceId: string) {
  return map.getSource(sourceId) as UpdatableGeoJsonSource | undefined
}

function logAtlasFog(event: string, payload: Record<string, unknown> = {}) {
  console.info(`[atlas-fog] ${event} ${JSON.stringify(payload)}`)
}

function updateFogData(state: FogMapState) {
  refreshCityKey(state)
  getSource(state.map, fogSourceId)?.setData(createFogFeatureCollection(state))
  getSource(state.map, revealSourceId)?.setData(createRevealFeatureCollection(state))
  state.progress = estimateProgress(state)
  publish(state)
}

function scheduleFogLayerInstall(map: MapInstance, state: FogMapState) {
  if (state.isStyleRetryScheduled) {
    return
  }

  state.isStyleRetryScheduled = true

  const retry = () => {
    state.isStyleRetryScheduled = false
    ensureFogLayers(map)
  }

  const eventedMap = map as EventedMap
  eventedMap.once('load', retry)
  eventedMap.once('styledata', retry)
  window.setTimeout(retry, 250)
  logAtlasFog('waiting for style', { cityKey: state.cityKey, fogCells: state.fogCells })
}

function ensureFogLayers(map: MapInstance) {
  const state = getOrCreateMapState(map)
  refreshCityKey(state)

  if (!map.isStyleLoaded()) {
    scheduleFogLayerInstall(map, state)
    return
  }

  if (!map.getSource(fogSourceId)) {
    map.addSource(fogSourceId, { type: 'geojson', data: createFogFeatureCollection(state) } as AddSourceArgs[1])
  }

  if (!map.getSource(revealSourceId)) {
    map.addSource(revealSourceId, { type: 'geojson', data: createRevealFeatureCollection(state) } as AddSourceArgs[1])
  }

  if (!map.getLayer(fogLayerId)) {
    map.addLayer({
      id: fogLayerId,
      type: 'fill',
      source: fogSourceId,
      paint: {
        'fill-color': '#141b19',
        'fill-opacity': 0.74,
        'fill-antialias': false,
      },
    } as AddLayerArgs[0])
  }

  if (!map.getLayer(revealLayerId)) {
    map.addLayer({
      id: revealLayerId,
      type: 'circle',
      source: revealSourceId,
      paint: {
        'circle-color': '#fff2c7',
        'circle-opacity': 0.24,
        'circle-radius': 30,
        'circle-stroke-color': '#fff7d9',
        'circle-stroke-opacity': 0.35,
        'circle-stroke-width': 2,
      },
    } as AddLayerArgs[0])
  }

  updateFogData(state)
  logAtlasFog('layers ready', { cityKey: state.cityKey, fogCells: state.fogCells, progress: state.progress })
}

function extractPoint(data: unknown) {
  const geometry = (data as { geometry?: unknown })?.geometry as { type?: unknown, coordinates?: unknown } | undefined

  if (geometry?.type !== 'Point' || !isCoordinate(geometry.coordinates)) {
    return null
  }

  return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] }
}

function revealMapPoint(map: MapInstance, point: { lng: number, lat: number }) {
  const state = getOrCreateMapState(map)
  refreshCityKey(state)

  if (!isPointInsideBounds(point, state.bounds)) {
    return
  }

  const nextPoint = { ...point, revealedAt: Date.now() }
  const alreadyRevealed = state.revealPoints.some((revealedPoint) => metersBetween(revealedPoint, nextPoint) < revealSpacingMeters)

  if (!alreadyRevealed) {
    state.revealPoints = [...state.revealPoints, nextPoint].slice(-800)
    saveRevealPoints(state)
  }

  ensureFogLayers(map)
  updateFogData(state)
  logAtlasFog('reveal', {
    progress: state.progress,
    revealedPoints: state.revealPoints.length,
    fogCells: state.fogCells,
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
    state.bounds = extractBoundsFromSource(source) ?? state.bounds
    refreshCityKey(state)
    ensureFogLayers(map)
    logAtlasFog('boundary ready', { cityKey: state.cityKey, hasBounds: Boolean(state.bounds), fogCells: state.fogCells })
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

  const originalAddLayer = prototype.addLayer
  prototype.addLayer = function patchedAddLayer(this: MapInstance, ...args: AddLayerArgs) {
    const result = originalAddLayer.apply(this, args)
    const layer = args[0] as { id?: unknown }

    if (layer.id === atlasOutsideMaskLayerId) {
      ensureFogLayers(this)
    }

    return result
  }

  const originalSetMaxBounds = prototype.setMaxBounds
  prototype.setMaxBounds = function patchedSetMaxBounds(this: MapInstance, ...args: SetMaxBoundsArgs) {
    const result = originalSetMaxBounds.apply(this, args)
    const state = getOrCreateMapState(this)
    state.bounds = normalizeBounds(args[0]) ?? state.bounds
    refreshCityKey(state)
    ensureFogLayers(this)
    updateFogData(state)

    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
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
