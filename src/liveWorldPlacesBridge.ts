import {
  boundaryFromSource,
  boundsFromBoundary,
  cityKeyFromBounds,
  insideBoundary,
  isCoordinate,
  isFiniteNumber,
  metersBetweenLngLat,
  normalizeMapBounds,
  type Boundary,
  type Bounds,
  type Coordinate,
  type LngLatPoint,
} from './geoSpatial'

type MapInstance = import('maplibre-gl').Map

type LivePlaceCategory = 'cafe' | 'restaurant' | 'bar' | 'gallery' | 'culture' | 'viewpoint' | 'market' | 'park' | 'shop' | 'landmark'
type PatchableMap = typeof import('maplibre-gl').Map.prototype & { __cityLiveWorldPlacesPatched?: boolean }
type UpdatableGeoJsonSource = { setData: (data: LivePlaceFeatureCollection) => void }
type LivePlaceFeature = {
  type: 'Feature'
  geometry: { type: 'Point', coordinates: Coordinate }
  properties: {
    id: string
    name: string
    category: LivePlaceCategory
    detail: string
  }
}
type LivePlaceFeatureCollection = { type: 'FeatureCollection', features: LivePlaceFeature[] }
type OverpassElement = {
  id?: number
  type?: string
  lat?: number
  lon?: number
  center?: { lat?: number, lon?: number }
  tags?: Record<string, string | undefined>
}
type LivePlacesState = {
  map: MapInstance
  boundary: Boundary | null
  bounds: Bounds | null
  cityKey: string | null
  activePoint: LngLatPoint | null
  lastFetchKey: string | null
  lastFetchAt: number
  isFetching: boolean
  listener: (() => void) | null
}

const boundarySourceId = 'atlas-boundary-source'
const pointSourceId = 'atlas-point-source'
const livePlacesSourceId = 'atlas-live-world-places-source'
const livePlacesCircleLayerId = 'atlas-live-world-places-circle'
const livePlacesLabelLayerId = 'atlas-live-world-places-label'
const storagePrefix = 'cityapp:live-world-places:v3:'
const overpassEndpoint = 'https://overpass-api.de/api/interpreter'
const snapPlaceZoom = 15.25
const livePlaceRadiusMeters = 1500
const livePlaceLimit = 48
const cacheTtlMs = 12 * 60 * 60 * 1000
const states = new WeakMap<MapInstance, LivePlacesState>()
let installPromise: Promise<void> | null = null

const emptyPlaces: LivePlaceFeatureCollection = { type: 'FeatureCollection', features: [] }

function getState(map: MapInstance) {
  const existing = states.get(map)
  if (existing) return existing
  const state: LivePlacesState = {
    map,
    boundary: null,
    bounds: null,
    cityKey: null,
    activePoint: null,
    lastFetchKey: null,
    lastFetchAt: 0,
    isFetching: false,
    listener: null,
  }
  states.set(map, state)
  return state
}

function getStateCenter(state: LivePlacesState) {
  const mapCenter = state.map.getCenter()
  const center = { lng: mapCenter.lng, lat: mapCenter.lat }
  if (insideBoundary(center, state.boundary)) return center
  if (state.activePoint && insideBoundary(state.activePoint, state.boundary)) return state.activePoint
  if (state.bounds) {
    return { lng: (state.bounds.west + state.bounds.east) / 2, lat: (state.bounds.south + state.bounds.north) / 2 }
  }
  return center
}

function getFetchKey(state: LivePlacesState, center: { lng: number, lat: number }) {
  return `${state.cityKey ?? 'city'}:${Math.round(center.lat * 1000) / 1000}:${Math.round(center.lng * 1000) / 1000}:z${Math.floor(state.map.getZoom() * 10) / 10}`
}

function buildOverpassQuery(center: { lng: number, lat: number }) {
  const around = `${livePlaceRadiusMeters},${center.lat},${center.lng}`
  return `
[out:json][timeout:12];
(
  node(around:${around})["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pub|biergarten|marketplace|library|theatre|cinema|arts_centre)$"];
  way(around:${around})["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pub|biergarten|marketplace|library|theatre|cinema|arts_centre)$"];
  relation(around:${around})["name"]["amenity"~"^(cafe|restaurant|fast_food|bar|pub|biergarten|marketplace|library|theatre|cinema|arts_centre)$"];
  node(around:${around})["name"]["tourism"~"^(museum|gallery|viewpoint|attraction)$"];
  way(around:${around})["name"]["tourism"~"^(museum|gallery|viewpoint|attraction)$"];
  relation(around:${around})["name"]["tourism"~"^(museum|gallery|viewpoint|attraction)$"];
  node(around:${around})["name"]["leisure"~"^(park|garden)$"];
  way(around:${around})["name"]["leisure"~"^(park|garden)$"];
  relation(around:${around})["name"]["leisure"~"^(park|garden)$"];
  node(around:${around})["name"]["shop"];
  way(around:${around})["name"]["shop"];
  node(around:${around})["name"]["historic"];
  way(around:${around})["name"]["historic"];
);
out center tags;`
}

function getCategory(tags: Record<string, string | undefined>): LivePlaceCategory | null {
  const amenity = tags.amenity
  const tourism = tags.tourism
  const leisure = tags.leisure
  const shop = tags.shop
  const historic = tags.historic

  if (amenity === 'cafe') return 'cafe'
  if (amenity === 'restaurant' || amenity === 'fast_food') return 'restaurant'
  if (amenity === 'bar' || amenity === 'pub' || amenity === 'biergarten') return 'bar'
  if (amenity === 'marketplace') return 'market'
  if (amenity === 'library' || amenity === 'theatre' || amenity === 'cinema' || amenity === 'arts_centre') return 'culture'
  if (tourism === 'museum') return 'culture'
  if (tourism === 'gallery') return 'gallery'
  if (tourism === 'viewpoint') return 'viewpoint'
  if (tourism === 'attraction') return 'landmark'
  if (leisure === 'park' || leisure === 'garden') return 'park'
  if (shop) return 'shop'
  if (historic) return 'landmark'

  return null
}

function getDetail(tags: Record<string, string | undefined>, category: LivePlaceCategory) {
  const raw = tags.amenity ?? tags.tourism ?? tags.leisure ?? tags.shop ?? tags.historic ?? category
  return raw.replace(/_/g, ' ')
}

function placeFeatureFromElement(element: OverpassElement, boundary: Boundary | null): LivePlaceFeature | null {
  const lat = element.lat ?? element.center?.lat
  const lng = element.lon ?? element.center?.lon
  const name = element.tags?.name?.trim()
  const category = element.tags ? getCategory(element.tags) : null

  if (!isFiniteNumber(lat) || !isFiniteNumber(lng) || !name || !category || !insideBoundary({ lng, lat }, boundary)) return null

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {
      id: `${element.type ?? 'osm'}:${element.id ?? `${lat}:${lng}`}`,
      name,
      category,
      detail: getDetail(element.tags ?? {}, category),
    },
  }
}

function sortAndDedupe(features: LivePlaceFeature[], center: { lng: number, lat: number }) {
  const seen = new Set<string>()
  return features
    .sort(
      (a, b) =>
        metersBetweenLngLat(center, { lng: a.geometry.coordinates[0], lat: a.geometry.coordinates[1] }) -
        metersBetweenLngLat(center, { lng: b.geometry.coordinates[0], lat: b.geometry.coordinates[1] }),
    )
    .filter((feature) => {
      const key = `${feature.properties.name.toLocaleLowerCase()}:${feature.properties.category}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, livePlaceLimit)
}

function getCachedPlaces(fetchKey: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${storagePrefix}${fetchKey}`) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if (!isFiniteNumber(parsed.savedAt) || Date.now() - parsed.savedAt > cacheTtlMs) return null
    if (!parsed.collection || parsed.collection.type !== 'FeatureCollection' || !Array.isArray(parsed.collection.features)) return null
    return parsed.collection as LivePlaceFeatureCollection
  } catch {
    return null
  }
}

function setCachedPlaces(fetchKey: string, collection: LivePlaceFeatureCollection) {
  try {
    window.localStorage.setItem(`${storagePrefix}${fetchKey}`, JSON.stringify({ savedAt: Date.now(), collection }))
  } catch {
    // Caching is optional.
  }
}

function getLivePlacesSource(map: MapInstance) {
  return map.getSource(livePlacesSourceId) as UpdatableGeoJsonSource | undefined
}

function ensureLivePlaceLayers(map: MapInstance) {
  if (!map.isStyleLoaded()) return false

  if (!map.getSource(livePlacesSourceId)) {
    map.addSource(livePlacesSourceId, { type: 'geojson', data: emptyPlaces })
  }

  if (!map.getLayer(livePlacesCircleLayerId)) {
    map.addLayer({
      id: livePlacesCircleLayerId,
      type: 'circle',
      source: livePlacesSourceId,
      minzoom: snapPlaceZoom,
      paint: {
        'circle-color': [
          'match', ['get', 'category'],
          'cafe', '#b66b3e',
          'restaurant', '#c65f46',
          'bar', '#7a5fb2',
          'gallery', '#6f72bd',
          'culture', '#4f7fa5',
          'viewpoint', '#2f8f7f',
          'market', '#c08a2f',
          'park', '#4f8f55',
          'shop', '#7d745d',
          'landmark', '#d9654f',
          '#2f8f7f',
        ],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], snapPlaceZoom, 0.72, 16, 0.94],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], snapPlaceZoom, 4, 16, 7, 18, 10],
        'circle-stroke-color': '#fffaf1',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], snapPlaceZoom, 1, 16, 2],
      },
    })
  }

  if (!map.getLayer(livePlacesLabelLayerId)) {
    map.addLayer({
      id: livePlacesLabelLayerId,
      type: 'symbol',
      source: livePlacesSourceId,
      minzoom: snapPlaceZoom,
      layout: {
        'text-anchor': 'top',
        'text-field': ['get', 'name'],
        'text-font': ['Amazon Ember Bold,Noto Sans Bold'],
        'text-offset': [0, 0.85],
        'text-size': ['interpolate', ['linear'], ['zoom'], snapPlaceZoom, 10, 17, 13],
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.55,
        'text-optional': true,
        'symbol-sort-key': ['match', ['get', 'category'], 'landmark', 1, 'culture', 2, 'viewpoint', 3, 'park', 4, 5],
      },
      paint: {
        'text-color': '#28241f',
        'text-halo-blur': 0.5,
        'text-halo-color': '#fffaf1',
        'text-halo-width': 1.5,
      },
    })
  }

  return true
}

function setLivePlaces(map: MapInstance, collection: LivePlaceFeatureCollection) {
  if (!ensureLivePlaceLayers(map)) return
  getLivePlacesSource(map)?.setData(collection)
}

async function fetchLivePlaces(state: LivePlacesState, fetchKey: string, center: { lng: number, lat: number }) {
  const response = await fetch(overpassEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: buildOverpassQuery(center) }),
    credentials: 'omit',
  })

  if (!response.ok) throw new Error(`Live place request failed: ${response.status}`)

  const payload = await response.json()
  const elements = Array.isArray(payload?.elements) ? payload.elements as OverpassElement[] : []
  const features = sortAndDedupe(
    elements.map((element) => placeFeatureFromElement(element, state.boundary)).filter((feature): feature is LivePlaceFeature => Boolean(feature)),
    center,
  )
  const collection: LivePlaceFeatureCollection = { type: 'FeatureCollection', features }
  setCachedPlaces(fetchKey, collection)
  return collection
}

function scheduleLivePlaceRefresh(state: LivePlacesState, force = false) {
  if (!state.bounds) return
  const nextCityKey = cityKeyFromBounds(state.bounds)
  if (state.cityKey !== nextCityKey) {
    state.cityKey = nextCityKey
    state.lastFetchKey = null
  }

  if (state.map.getZoom() < snapPlaceZoom) return

  const center = getStateCenter(state)
  if (!insideBoundary(center, state.boundary) || state.isFetching) return

  const fetchKey = getFetchKey(state, center)
  if (!force && fetchKey === state.lastFetchKey && Date.now() - state.lastFetchAt < cacheTtlMs) return

  const cached = getCachedPlaces(fetchKey)
  if (cached) {
    state.lastFetchKey = fetchKey
    state.lastFetchAt = Date.now()
    setLivePlaces(state.map, cached)
    console.info(`[atlas-live-places] cache ${JSON.stringify({ places: cached.features.length, cityKey: state.cityKey, radiusM: livePlaceRadiusMeters, snapZoom: snapPlaceZoom, center })}`)
    return
  }

  state.isFetching = true
  state.lastFetchKey = fetchKey
  state.lastFetchAt = Date.now()
  void fetchLivePlaces(state, fetchKey, center)
    .then((collection) => {
      if (state.lastFetchKey !== fetchKey) return
      setLivePlaces(state.map, collection)
      console.info(`[atlas-live-places] loaded ${JSON.stringify({ places: collection.features.length, cityKey: state.cityKey, radiusM: livePlaceRadiusMeters, snapZoom: snapPlaceZoom, center })}`)
    })
    .catch((error: unknown) => {
      console.warn('[atlas-live-places] request failed', error)
      if (state.lastFetchKey === fetchKey) setLivePlaces(state.map, emptyPlaces)
    })
    .finally(() => {
      if (state.lastFetchKey === fetchKey) state.isFetching = false
    })
}

function extractPoint(data: unknown) {
  const geometry = (data as { geometry?: unknown })?.geometry as { type?: unknown, coordinates?: unknown } | undefined
  return geometry?.type === 'Point' && isCoordinate(geometry.coordinates) ? { lng: geometry.coordinates[0], lat: geometry.coordinates[1] } : null
}

function wrapPointSource(map: MapInstance) {
  const source = map.getSource(pointSourceId) as (UpdatableGeoJsonSource & { __cityLiveWorldPlacesWrapped?: boolean }) | undefined
  if (!source || source.__cityLiveWorldPlacesWrapped) return
  const originalSetData = source.setData.bind(source)
  source.__cityLiveWorldPlacesWrapped = true
  source.setData = (data: LivePlaceFeatureCollection) => {
    originalSetData(data)
    const point = extractPoint(data)
    if (!point) return
    const state = getState(map)
    state.activePoint = point
    scheduleLivePlaceRefresh(state, true)
  }
}

function handleSource(map: MapInstance, id: string, source: unknown) {
  if (id === livePlacesSourceId) return
  const state = getState(map)

  if (id === boundarySourceId) {
    state.boundary = boundaryFromSource(source)
    state.bounds = boundsFromBoundary(state.boundary) ?? state.bounds
    ensureLivePlaceLayers(map)
    scheduleLivePlaceRefresh(state, true)
    return
  }

  if (id === pointSourceId) {
    wrapPointSource(map)
    const point = extractPoint((source as { data?: unknown })?.data)
    if (point) {
      state.activePoint = point
      scheduleLivePlaceRefresh(state, true)
    }
  }
}

function attachMoveListener(state: LivePlacesState) {
  if (state.listener) return
  const listener = () => scheduleLivePlaceRefresh(state)
  const map = state.map as MapInstance & { on: (event: string, listener: () => void) => MapInstance }
  map.on('moveend', listener)
  map.on('zoomend', listener)
  map.on('idle', listener)
  state.listener = listener
}

function detachMoveListener(state: LivePlacesState) {
  if (!state.listener) return
  const map = state.map as MapInstance & { off: (event: string, listener: () => void) => MapInstance }
  map.off('moveend', state.listener)
  map.off('zoomend', state.listener)
  map.off('idle', state.listener)
  state.listener = null
}

function patchMapPrototype(prototype: PatchableMap) {
  if (prototype.__cityLiveWorldPlacesPatched) return
  prototype.__cityLiveWorldPlacesPatched = true

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
    state.bounds = normalizeMapBounds(args[0]) ?? state.bounds
    attachMoveListener(state)
    ensureLivePlaceLayers(this)
    scheduleLivePlaceRefresh(state, true)
    return result
  }

  const originalRemove = prototype.remove
  prototype.remove = function patchedRemove(this: MapInstance) {
    const state = states.get(this)
    if (state) detachMoveListener(state)
    states.delete(this)
    return originalRemove.call(this)
  }
}

export function installLiveWorldPlacesBridge() {
  if (!installPromise) {
    installPromise = import('maplibre-gl').then((maplibregl) => {
      patchMapPrototype(maplibregl.Map.prototype as PatchableMap)
      console.info('[atlas-live-places] bridge installed')
    })
  }
  return installPromise
}
