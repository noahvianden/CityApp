import * as maplibregl from 'maplibre-gl'

type MapInstance = import('maplibre-gl').Map
type AddLayerArgs = Parameters<MapInstance['addLayer']>
type AddSourceArgs = Parameters<MapInstance['addSource']>
type SetMaxBoundsArgs = Parameters<MapInstance['setMaxBounds']>

type Coordinate = [number, number]
type LinearRing = Coordinate[]

type PolygonGeometry = {
  type: 'Polygon'
  coordinates: LinearRing[]
}

type MultiPolygonGeometry = {
  type: 'MultiPolygon'
  coordinates: LinearRing[][]
}

type BoundaryGeometry = PolygonGeometry | MultiPolygonGeometry

type PointGeometry = {
  type: 'Point'
  coordinates: Coordinate
}

type Feature<TGeometry> = {
  type: 'Feature'
  geometry: TGeometry
  properties: Record<string, unknown>
}

type FeatureCollection<TGeometry> = {
  type: 'FeatureCollection'
  features: Array<Feature<TGeometry>>
}

type GeoBounds = {
  west: number
  south: number
  east: number
  north: number
}

type RevealPoint = {
  lng: number
  lat: number
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

type PatchableMapPrototype = typeof maplibregl.Map.prototype & {
  __atlasFogPatched?: boolean
}

type FogMapState = {
  map: MapInstance
  boundary: BoundaryGeometry | null
  bounds: GeoBounds | null
  cityKey: string | null
  revealPoints: RevealPoint[]
  progress: number
}

const fogSourceId = 'atlas-fog-source'
const revealSourceId = 'atlas-reveal-source'
const fogLayerId = 'atlas-fog-fill'
const revealLayerId = 'atlas-reveal-glow'
const atlasBoundarySourceId = 'atlas-boundary-source'
const atlasPointSourceId = 'atlas-point-source'
const atlasOutsideMaskLayerId = 'atlas-outside-city-mask'
const storagePrefix = 'cityapp:atlas-geo-fog:'
const revealRadiusMeters = 520
const revealSpacingMeters = 32
const circleSteps = 48
const worldRing: LinearRing = [
  [-180, 90],
  [180, 90],
  [180, -90],
  [-180, -90],
  [-180, 90],
]

const mapStates = new WeakMap<MapInstance, FogMapState>()
const listeners = new Set<(snapshot: AtlasFogSnapshot) => void>()
let lastSnapshot: AtlasFogSnapshot = { cityKey: null, progress: 0, revealedPoints: 0 }

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

  const coordinates = value.filter(isCoordinate).map((coordinate) => [coordinate[0], coordinate[1]] as Coordinate)

  if (coordinates.length < 4) {
    return null
  }

  return coordinates
}

function normalizePolygon(value: unknown): LinearRing[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const rings = value.map(normalizeRing).filter((ring): ring is LinearRing => ring !== null)

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

function extractBoundary(source: unknown) {
  const data = (source as { data?: unknown })?.data
  const candidate = (data as { geometry?: unknown })?.geometry ?? data

  return normalizeBoundary(candidate)
}

function extractPoint(data: unknown) {
  const geometry = (data as { geometry?: unknown })?.geometry as { type?: unknown, coordinates?: unknown } | undefined

  if (geometry?.type !== 'Point' || !isCoordinate(geometry.coordinates)) {
    return null
  }

  return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] }
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
    progress: 0,
  }

  mapStates.set(map, state)
  return state
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

  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
    return null
  }

  return { west, south, east, north }
}

function normalizeBounds(value: unknown): GeoBounds | null {
  if (Array.isArray(value) && value.length >= 2 && isCoordinate(value[0]) && isCoordinate(value[1])) {
    const [west, south] = value[0]
    const [east, north] = value[1]

    if (west < east && south < north) {
      return { west, south, east, north }
    }
  }

  const candidate = value as {
    getWest?: () => number
    getSouth?: () => number
    getEast?: () => number
    getNorth?: () => number
  }

  if (candidate?.getWest && candidate.getSouth && candidate.getEast && candidate.getNorth) {
    const west = candidate.getWest()
    const south = candidate.getSouth()
    const east = candidate.getEast()
    const north = candidate.getNorth()

    if ([west, south, east, north].every(Number.isFinite) && west < east && south < north) {
      return { west, south, east, north }
    }
  }

  return null
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
      isFiniteNumber(point?.lng) &&
      isFiniteNumber(point?.lat) &&
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
    window.localStorage.setItem(`${storagePrefix}${state.cityKey}`, JSON.stringify(state.revealPoints.slice(-800)))
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

function createCircleRing(point: RevealPoint, radiusMeters: number): LinearRing {
  const latitudeRadius = radiusMeters / 111_320
  const longitudeRadius = radiusMeters / Math.max(111_320 * Math.cos(point.lat * Math.PI / 180), 1)
  const ring: LinearRing = []

  for (let index = 0; index <= circleSteps; index += 1) {
    const angle = (index / circleSteps) * Math.PI * 2
    ring.push([
      point.lng + Math.cos(angle) * longitudeRadius,
      point.lat + Math.sin(angle) * latitudeRadius,
    ])
  }

  return ring
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

function createFogGeometry(state: FogMapState): BoundaryGeometry {
  const revealHoles = state.revealPoints.map((point) => ({ point, ring: createCircleRing(point, revealRadiusMeters) }))

  if (!state.boundary) {
    return {
      type: 'Polygon',
      coordinates: [worldRing, ...revealHoles.map((hole) => hole.ring)],
    }
  }

  if (state.boundary.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: [
        ...state.boundary.coordinates,
        ...revealHoles
          .filter((hole) => pointInPolygon(hole.point, state.boundary?.type === 'Polygon' ? state.boundary.coordinates : []))
          .map((hole) => hole.ring),
      ],
    }
  }

  return {
    type: 'MultiPolygon',
    coordinates: state.boundary.coordinates.map((polygon) => [
      ...polygon,
      ...revealHoles
        .filter((hole) => pointInPolygon(hole.point, polygon))
        .map((hole) => hole.ring),
    ]),
  }
}

function createFogFeature(state: FogMapState): Feature<BoundaryGeometry> {
  return { type: 'Feature', geometry: createFogGeometry(state), properties: {} }
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

function isPointInsideBoundary(point: { lng: number, lat: number }, boundary: BoundaryGeometry | null) {
  if (!boundary) {
    return true
  }

  const polygons = boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates

  return polygons.some((polygon) => pointInPolygon(point, polygon))
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

      if (!isPointInsideBoundary(sample, state.boundary)) {
        continue
      }

      sampleCount += 1

      if (state.revealPoints.some((point) => metersBetween(point, sample) <= revealRadiusMeters)) {
        revealedCount += 1
      }
    }
  }

  if (!sampleCount) {
    return 0
  }

  return Math.min(100, Math.round((revealedCount / sampleCount) * 100))
}

function publish(state: FogMapState) {
  lastSnapshot = {
    cityKey: state.cityKey,
    progress: state.progress,
    revealedPoints: state.revealPoints.length,
  }
  listeners.forEach((listener) => listener(lastSnapshot))
}

function getSource(map: MapInstance, sourceId: string) {
  return map.getSource(sourceId) as UpdatableGeoJsonSource | undefined
}

function updateFogData(state: FogMapState) {
  refreshCityKey(state)

  const fogSource = getSource(state.map, fogSourceId)
  const revealSource = getSource(state.map, revealSourceId)

  if (fogSource) {
    fogSource.setData(createFogFeature(state))
  }

  if (revealSource) {
    revealSource.setData(createRevealFeatureCollection(state))
  }

  state.progress = estimateProgress(state)
  publish(state)
}

function ensureFogLayers(map: MapInstance) {
  const state = getOrCreateMapState(map)
  refreshCityKey(state)

  if (!map.isStyleLoaded()) {
    return
  }

  if (!map.getSource(fogSourceId)) {
    map.addSource(fogSourceId, { type: 'geojson', data: createFogFeature(state) } as AddSourceArgs[1])
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
        'fill-color': '#252b29',
        'fill-opacity': 0.62,
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
        'circle-opacity': 0.18,
        'circle-radius': 26,
        'circle-stroke-color': '#fff7d9',
        'circle-stroke-opacity': 0.28,
        'circle-stroke-width': 2,
      },
    } as AddLayerArgs[0])
  }

  updateFogData(state)
}

function revealMapPoint(map: MapInstance, point: { lng: number, lat: number }) {
  const state = getOrCreateMapState(map)
  refreshCityKey(state)

  if (!isPointInsideBoundary(point, state.boundary)) {
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
    state.boundary = extractBoundary(source)
    state.bounds = boundsFromBoundary(state.boundary) ?? state.bounds
    refreshCityKey(state)
    ensureFogLayers(map)
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

function installAtlasGeoFogBridge() {
  const prototype = maplibregl.Map.prototype as PatchableMapPrototype

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
    updateFogData(state)

    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
    mapStates.delete(this)

    return originalRemove.call(this)
  }
}

installAtlasGeoFogBridge()

export function subscribeAtlasFog(listener: (snapshot: AtlasFogSnapshot) => void) {
  listeners.add(listener)
  listener(lastSnapshot)

  return () => listeners.delete(listener)
}

export function getAtlasFogSnapshot() {
  return lastSnapshot
}
