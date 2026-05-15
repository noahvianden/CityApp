import type { GpsLocationSample } from './locationAdapter'
import type { BoundedAtlasPoint } from './nominatimCityBoundaries'
import { getNativeCurrentLocation, isNativeRuntime, requestNativeLocationPermission } from './nativeRuntime'

export type LocationMode = 'gps' | 'simulated'
export type AppTab = 'atlas' | 'walks' | 'journal' | 'progress'
export type GpsNudgeDirection = 'north' | 'east' | 'south' | 'west'
export type MapViewActionType = 'default' | 'snap'

export type MapViewAction = {
  type: MapViewActionType
  nonce: number
}

export type AppTabItem = {
  key: AppTab
  icon: string
  label: string
  dummyTitle: string
  dummyBody: string
}

export type AtlasPoint = {
  latitude: number
  longitude: number
  accuracyM?: number
}

export type AtlasFrameSize = {
  width: number
  height: number
}

export type ViewportSize = {
  width: number
  height: number
}

export type MapCamera = {
  center: [number, number]
  zoom: number
}

export type CityHistoryItem = {
  cityId: string
  name: string
  description: string
  badge: string
  atlas: BoundedAtlasPoint
  mode: LocationMode
}

type MapLibreMap = import('maplibre-gl').Map

type MapLibrePointProperties = {
  accuracyRadius: number
  revealRadiusMeters: number
  label: string
  pointColor: string
}

type MapLibrePointFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: MapLibrePointProperties
}

type NominatimSearchPlace = {
  address?: {
    city?: string
    country?: string
    municipality?: string
    town?: string
    village?: string
  }
  boundingbox?: unknown
  geojson?: unknown
  lat?: string
  lon?: string
  name?: string
  osm_id?: number
  osm_type?: string
}

export const cityStyleUrl = `${import.meta.env.BASE_URL}city-style.json`
export const gpsNudgeMeters = 10
export const metersPerLatitudeDegree = 111_320
export const placeOverviewZoom = 15.25
export const fullRevealRadiusMeters = 82
export const lowQualityRevealRadiusMeters = 34
const fullRevealGpsAccuracyM = 25
const maximumAcceptedGpsAccuracyM = 50

export const appTabs: AppTabItem[] = [
  { key: 'atlas', icon: 'A', label: 'Atlas', dummyTitle: 'Atlas', dummyBody: 'Explore the current city boundary.' },
  {
    key: 'walks',
    icon: 'W',
    label: 'Walks',
    dummyTitle: 'Walks coming soon',
    dummyBody: 'This placeholder will show completed exploration walks and discovered places.',
  },
  {
    key: 'journal',
    icon: 'J',
    label: 'Journal',
    dummyTitle: 'Journal coming soon',
    dummyBody: 'This placeholder will show saved places, visited places, photos, and memories.',
  },
  {
    key: 'progress',
    icon: 'P',
    label: 'Progress',
    dummyTitle: 'Progress coming soon',
    dummyBody: 'This placeholder will show city completion, district reveal, and collections.',
  },
]

const worldMaskRing: [number, number][] = [
  [-180, 90],
  [180, 90],
  [180, -90],
  [-180, -90],
  [-180, 90],
]

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function getAppTab(tab: AppTab) {
  return appTabs.find((item) => item.key === tab) ?? appTabs[0]
}

export function getViewportSize(): ViewportSize {
  if (typeof window === 'undefined') {
    return { width: 320, height: 640 }
  }

  return {
    width: Math.max(window.visualViewport?.width ?? window.innerWidth, 1),
    height: Math.max(window.visualViewport?.height ?? window.innerHeight, 1),
  }
}

function toBrowserGpsSample(position: GeolocationPosition): GpsLocationSample {
  return {
    kind: 'gps',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    capturedAt: position.timestamp,
  }
}

export async function getBrowserCurrentLocation() {
  if (!navigator.geolocation) {
    return null
  }

  return new Promise<GpsLocationSample | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toBrowserGpsSample(position)),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    )
  })
}

export async function getCurrentLocation() {
  if (isNativeRuntime()) {
    const permission = await requestNativeLocationPermission()

    if (permission === 'denied') {
      return null
    }

    return getNativeCurrentLocation()
  }

  return getBrowserCurrentLocation()
}

export function getAtlasFrameSize(viewportSize: ViewportSize): AtlasFrameSize {
  const side = Math.max(Math.min(viewportSize.width, viewportSize.height), 1)

  return { width: side, height: side }
}

export function getAccuracyRadius(accuracyM: number | undefined) {
  if (!accuracyM || !Number.isFinite(accuracyM)) {
    return 0
  }

  return Math.min(Math.max(accuracyM / 3, 14), 42)
}

export function getRevealRadiusMeters(accuracyM: number | undefined) {
  const accuracy = typeof accuracyM === 'number' && Number.isFinite(accuracyM) ? accuracyM : null

  if (accuracy === null) {
    return fullRevealRadiusMeters
  }

  if (accuracy <= fullRevealGpsAccuracyM) {
    return fullRevealRadiusMeters
  }

  if (accuracy >= maximumAcceptedGpsAccuracyM) {
    return lowQualityRevealRadiusMeters
  }

  const accuracyRange = maximumAcceptedGpsAccuracyM - fullRevealGpsAccuracyM
  const quality = 1 - (accuracy - fullRevealGpsAccuracyM) / accuracyRange
  const revealRange = fullRevealRadiusMeters - lowQualityRevealRadiusMeters

  return Math.round(lowQualityRevealRadiusMeters + quality * revealRange)
}

export function pointToFeature(point: AtlasPoint, mode: LocationMode): MapLibrePointFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    properties: {
      accuracyRadius: getAccuracyRadius(point.accuracyM),
      revealRadiusMeters: getRevealRadiusMeters(point.accuracyM),
      label: mode === 'gps' ? 'GPS' : 'Simulated',
      pointColor: mode === 'gps' ? '#2f7d57' : '#d78b35',
    },
  }
}

export function boundaryRingsFromBoundary(boundary: BoundedAtlasPoint['boundary']) {
  return boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat()
}

export function outsideCityMaskGeometry(boundary: BoundedAtlasPoint['boundary']) {
  return { type: 'Polygon' as const, coordinates: [worldMaskRing, ...boundaryRingsFromBoundary(boundary)] }
}

export function parseSearchBounds(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) {
    return null
  }

  const [south, north, west, east] = value.map((entry) => Number(entry))

  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
    return null
  }

  return { south, north, west, east }
}

export function parseSearchBoundary(value: unknown): BoundedAtlasPoint['boundary'] | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const geometry = value as { type?: unknown; coordinates?: unknown }

  if ((geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') || !Array.isArray(geometry.coordinates)) {
    return null
  }

  return geometry as BoundedAtlasPoint['boundary']
}

export function getBoundsFromSearchBoundary(boundary: BoundedAtlasPoint['boundary']) {
  const rings = boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat()
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity

  for (const ring of rings) {
    for (const coordinate of ring) {
      const [longitude, latitude] = coordinate

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue
      }

      north = Math.max(north, latitude)
      south = Math.min(south, latitude)
      east = Math.max(east, longitude)
      west = Math.min(west, longitude)
    }
  }

  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
    return null
  }

  return { south, north, west, east }
}

export async function searchCityBoundary(query: string): Promise<BoundedAtlasPoint | null> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return null
  }

  const params = new URLSearchParams({
    format: 'jsonv2',
    q: trimmedQuery,
    featureType: 'city',
    limit: '20',
    addressdetails: '1',
    extratags: '1',
    polygon_geojson: '1',
    'accept-language': 'en',
  })

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  })

  if (!response.ok) {
    return null
  }

  const payload = await response.json()
  if (!Array.isArray(payload)) {
    return null
  }

  for (const place of payload as NominatimSearchPlace[]) {
    const boundary = parseSearchBoundary(place.geojson)
    const bounds = boundary ? (getBoundsFromSearchBoundary(boundary) ?? parseSearchBounds(place.boundingbox)) : null
    const latitude = Number(place.lat)
    const longitude = Number(place.lon)

    if (!boundary || !bounds || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue
    }

    return {
      cityId: `${place.osm_type ?? 'unknown'}:${place.osm_id ?? place.name ?? trimmedQuery}`,
      cityName: place.name ?? place.address?.city ?? place.address?.town ?? place.address?.village ?? trimmedQuery,
      cityCountry: place.address?.country ?? 'Unknown country',
      cityStatus: 'Searched boundary',
      point: { latitude, longitude },
      bounds,
      boundary,
    }
  }

  return null
}

export function cityBoundsFromAtlas(atlas: BoundedAtlasPoint): [[number, number], [number, number]] {
  return [
    [atlas.bounds.west, atlas.bounds.south],
    [atlas.bounds.east, atlas.bounds.north],
  ]
}

type UpdatableGeoJsonSource = {
  setData: (data: MapLibrePointFeature) => void
}

export function getPointSource(map: MapLibreMap) {
  return map.getSource('atlas-point-source') as UpdatableGeoJsonSource | undefined
}

export function updatePointSource(map: MapLibreMap, atlas: BoundedAtlasPoint, mode: LocationMode) {
  getPointSource(map)?.setData(pointToFeature(atlas.point, mode))
}

export function centerMapOnPoint(map: MapLibreMap, point: AtlasPoint, duration = 180) {
  map.easeTo({
    center: [point.longitude, point.latitude],
    duration,
    essential: true,
    zoom: map.getZoom(),
  })
}

export function getCityDefaultCamera(map: MapLibreMap, atlas: BoundedAtlasPoint): MapCamera {
  map.setMinZoom(0)
  const camera = map.cameraForBounds(cityBoundsFromAtlas(atlas), { padding: 0 })
  const fallbackCenter = map.getCenter()

  if (!camera?.center || typeof camera.zoom !== 'number') {
    return {
      center: [fallbackCenter.lng, fallbackCenter.lat],
      zoom: map.getZoom(),
    }
  }

  const centerValue = camera.center as { lng?: number; lat?: number } | [number, number]
  const center = Array.isArray(centerValue) ? centerValue : ([Number(centerValue.lng), Number(centerValue.lat)] as [number, number])

  return {
    center,
    zoom: camera.zoom,
  }
}

export function setMapToCityDefault(map: MapLibreMap, atlas: BoundedAtlasPoint, animate: boolean) {
  const camera = getCityDefaultCamera(map, atlas)
  map.setMinZoom(camera.zoom)
  map.easeTo({
    bearing: 0,
    center: camera.center,
    duration: animate ? 450 : 0,
    essential: true,
    pitch: 0,
    zoom: camera.zoom,
  })

  return camera
}

export function buildCityHistoryEntry(atlas: BoundedAtlasPoint, badge: string, mode: LocationMode): CityHistoryItem {
  return {
    cityId: atlas.cityId,
    name: atlas.cityName,
    description: `${atlas.cityStatus} - ${atlas.cityCountry}`,
    badge,
    atlas,
    mode,
  }
}

export function upsertCityHistory(
  currentHistory: CityHistoryItem[],
  atlas: BoundedAtlasPoint,
  badge: string,
  mode: LocationMode,
  limit = 8,
) {
  const nextCity = buildCityHistoryEntry(atlas, badge, mode)
  const withoutDuplicate = currentHistory.filter((city) => city.cityId !== atlas.cityId)

  return [nextCity, ...withoutDuplicate].slice(0, limit)
}
