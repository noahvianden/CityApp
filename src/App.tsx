import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import L from 'leaflet'
import { Crosshair, Route } from 'lucide-react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { containsGeoPoint, type GeoBounds } from './geoGrid'
import { getNativeCurrentLocation, isNativeRuntime, requestNativeLocationPermission } from './nativeRuntime'
import type { GpsLocationSample } from './locationAdapter'

type LocationMode = 'gps' | 'simulated'

type AtlasPoint = {
  latitude: number
  longitude: number
  accuracyM?: number
}

type AtlasFrameSize = {
  width: number
  height: number
}

type ViewportSize = {
  width: number
  height: number
}

type CityLookupAddress = {
  city?: string
  town?: string
  village?: string
  municipality?: string
  county?: string
  state?: string
  country_code?: string
}

type NominatimPlace = {
  addresstype?: string
  address?: CityLookupAddress
  boundingbox?: unknown
  category?: string
  display_name?: string
  extratags?: {
    'de:place'?: string
    linked_place?: string
  }
  geojson?: unknown
  lat?: string
  lon?: string
  name?: string
  osm_type?: string
  type?: string
}

type BoundaryGeometry =
  | {
      type: 'Polygon'
      coordinates: number[][][]
    }
  | {
      type: 'MultiPolygon'
      coordinates: number[][][][]
    }

type BoundedAtlasPoint = {
  point: AtlasPoint
  bounds: GeoBounds
  boundary: BoundaryGeometry
}

type CitySearchCandidate = BoundedAtlasPoint & {
  address: CityLookupAddress | undefined
  addressType: string | undefined
  category: string | undefined
  countryCode: string | undefined
  dePlace: string | undefined
  displayName: string | undefined
  linkedPlace: string | undefined
  name: string | undefined
  osmType: string | undefined
  placeType: string | undefined
}

const citySearchSyllables = ['berg', 'burg', 'dorf', 'furt', 'hausen', 'heim', 'stadt', 'bach', 'feld', 'hagen', 'kirchen', 'weiler']
const fallbackGermanCityQueries = ['Hamburg', 'Muenchen', 'Koeln', 'Frankfurt am Main', 'Dresden', 'Leipzig', 'Hannover']
const nominatimBaseUrl = import.meta.env.DEV ? '/nominatim' : 'https://nominatim.openstreetmap.org'
const worldMaskRing: [number, number][] = [
  [90, -180],
  [90, 180],
  [-90, 180],
  [-90, -180],
  [90, -180],
]

function getViewportSize(): ViewportSize {
  if (typeof window === 'undefined') {
    return { width: 320, height: 640 }
  }

  return {
    width: Math.max(window.visualViewport?.width ?? window.innerWidth, 1),
    height: Math.max(window.visualViewport?.height ?? window.innerHeight, 1),
  }
}

function parseNominatimBounds(value: unknown): GeoBounds | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null
  }

  const [south, north, west, east] = value.map((entry) => Number(entry))

  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
    return null
  }

  return { south, north, west, east }
}

function parseBoundaryGeometry(value: unknown): BoundaryGeometry | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const geometry = value as {
    type?: unknown
    coordinates?: unknown
  }

  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return null
  }

  if (!Array.isArray(geometry.coordinates)) {
    return null
  }

  return geometry as BoundaryGeometry
}

function getBoundsFromBoundary(boundary: BoundaryGeometry): GeoBounds | null {
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

function randomSearchToken() {
  return citySearchSyllables[Math.floor(Math.random() * citySearchSyllables.length)]
}

function randomFallbackCityQuery() {
  return fallbackGermanCityQueries[Math.floor(Math.random() * fallbackGermanCityQueries.length)]
}

function pointFromBounds(bounds: GeoBounds): AtlasPoint {
  return {
    latitude: bounds.south + Math.random() * (bounds.north - bounds.south),
    longitude: bounds.west + Math.random() * (bounds.east - bounds.west),
  }
}

function isBerlinName(value: string | undefined) {
  return /\bberlin\b/i.test(value ?? '')
}

function getAddressCityNames(address: CityLookupAddress | undefined) {
  const names = [address?.city, address?.town, address?.village, address?.municipality]

  return Array.from(new Set(names.filter((name): name is string => Boolean(name && !isBerlinName(name)))))
}

function isBerlinPlace(candidate: CitySearchCandidate) {
  return isBerlinName(candidate.name)
    || isBerlinName(candidate.displayName)
    || isBerlinName(candidate.address?.city)
    || isBerlinName(candidate.address?.town)
    || isBerlinName(candidate.address?.village)
    || isBerlinName(candidate.address?.municipality)
    || isBerlinName(candidate.address?.county)
    || isBerlinName(candidate.address?.state)
}

function toCitySearchCandidate(place: NominatimPlace): CitySearchCandidate | null {
  const boundary = parseBoundaryGeometry(place.geojson)
  const bounds = boundary ? getBoundsFromBoundary(boundary) ?? parseNominatimBounds(place.boundingbox) : null
  const latitude = Number(place.lat)
  const longitude = Number(place.lon)

  if (!bounds || !boundary || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  return {
    boundary,
    bounds,
    point: containsGeoPoint({ latitude, longitude }, bounds) ? { latitude, longitude } : pointFromBounds(bounds),
    address: place.address,
    addressType: place.addresstype,
    category: place.category,
    countryCode: place.address?.country_code,
    dePlace: place.extratags?.['de:place'],
    displayName: place.display_name,
    linkedPlace: place.extratags?.linked_place,
    name: place.name,
    osmType: place.osm_type,
    placeType: place.type,
  }
}

function isGermanCityBoundary(candidate: CitySearchCandidate) {
  const isGerman = candidate.countryCode === 'de'
  const isBoundaryRelation = candidate.osmType === 'relation' && candidate.category === 'boundary' && candidate.placeType === 'administrative'
  const isCity = candidate.addressType === 'city' || candidate.dePlace === 'city' || candidate.linkedPlace === 'city'

  return isGerman && isBoundaryRelation && isCity && !isBerlinPlace(candidate)
}

async function fetchCitySearchResult(query: string): Promise<BoundedAtlasPoint | null> {
  if (isBerlinName(query)) {
    return null
  }

  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    featureType: 'city',
    countrycodes: 'de',
    limit: '50',
    addressdetails: '1',
    extratags: '1',
    polygon_geojson: '1',
    'accept-language': 'en',
  })
  let response: Response

  try {
    response = await fetch(`${nominatimBaseUrl}/search?${params.toString()}`)
  } catch {
    return null
  }

  if (!response.ok) {
    return null
  }

  const places = await response.json() as NominatimPlace[]
  const boundedPlaces = places
    .map(toCitySearchCandidate)
    .filter((place): place is CitySearchCandidate => place !== null)
  const candidates = boundedPlaces.filter(isGermanCityBoundary)
  const candidate = candidates[Math.floor(Math.random() * candidates.length)]

  return candidate ? { point: candidate.point, bounds: candidate.bounds, boundary: candidate.boundary } : null
}

async function fetchRandomCitySearchResult(): Promise<BoundedAtlasPoint | null> {
  return fetchCitySearchResult(randomSearchToken())
}

async function fetchCityBoundary(point: AtlasPoint): Promise<BoundedAtlasPoint | null> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: point.latitude.toString(),
    lon: point.longitude.toString(),
    zoom: '10',
    addressdetails: '1',
    extratags: '1',
    polygon_geojson: '1',
    'accept-language': 'en',
  })
  let response: Response

  try {
    response = await fetch(`${nominatimBaseUrl}/reverse?${params.toString()}`)
  } catch {
    return null
  }

  if (!response.ok) {
    return null
  }

  const payload = await response.json() as NominatimPlace
  const reverseCandidate = toCitySearchCandidate(payload)

  if (reverseCandidate && isGermanCityBoundary(reverseCandidate)) {
    return {
      point: containsGeoPoint(point, reverseCandidate.bounds) ? point : reverseCandidate.point,
      bounds: reverseCandidate.bounds,
      boundary: reverseCandidate.boundary,
    }
  }

  for (const cityName of getAddressCityNames(payload.address)) {
    const cityBoundary = await fetchCitySearchResult(cityName)

    if (cityBoundary) {
      return {
        ...cityBoundary,
        point: containsGeoPoint(point, cityBoundary.bounds) ? point : cityBoundary.point,
      }
    }
  }

  return null
}

async function getSimulatedCityPoint(): Promise<BoundedAtlasPoint | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cityPoint = await fetchRandomCitySearchResult()

    if (cityPoint) {
      return cityPoint
    }
  }

  for (let attempt = 0; attempt < fallbackGermanCityQueries.length; attempt += 1) {
    const cityPoint = await fetchCitySearchResult(randomFallbackCityQuery())

    if (cityPoint) {
      return cityPoint
    }
  }

  return fetchCitySearchResult('Hamburg')
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

async function getBrowserCurrentLocation() {
  if (!navigator.geolocation) {
    return null
  }

  return new Promise<GpsLocationSample | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toBrowserGpsSample(position)),
      () => resolve(null),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      },
    )
  })
}

async function getCurrentLocation() {
  if (isNativeRuntime()) {
    const permission = await requestNativeLocationPermission()

    if (permission === 'denied') {
      return null
    }

    return getNativeCurrentLocation()
  }

  return getBrowserCurrentLocation()
}

function getGeoBoundsAspectRatio(bounds: GeoBounds) {
  const northWest = L.CRS.EPSG3857.project(L.latLng(bounds.north, bounds.west))
  const southEast = L.CRS.EPSG3857.project(L.latLng(bounds.south, bounds.east))
  const width = Math.abs(southEast.x - northWest.x)
  const height = Math.abs(southEast.y - northWest.y)

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1
  }

  return Math.min(Math.max(width / height, 0.25), 4)
}

function getAtlasFrameSize(bounds: GeoBounds, viewportSize: ViewportSize): AtlasFrameSize {
  const boundsAspectRatio = getGeoBoundsAspectRatio(bounds)
  const viewportAspectRatio = viewportSize.width / viewportSize.height

  if (viewportAspectRatio > boundsAspectRatio) {
    return {
      width: viewportSize.height * boundsAspectRatio,
      height: viewportSize.height,
    }
  }

  return {
    width: viewportSize.width,
    height: viewportSize.width / boundsAspectRatio,
  }
}

function LockAtlasBounds({ bounds }: { bounds: GeoBounds }) {
  const map = useMap()

  useEffect(() => {
    const cityBounds = L.latLngBounds([
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
    ])
    let animationFrame = 0

    const fitCityToContainer = () => {
      map.setMinZoom(0)
      map.invalidateSize(false)
      map.setMaxBounds(cityBounds)
      map.fitBounds(cityBounds, {
        animate: false,
        padding: L.point(0, 0),
      })
      map.setMinZoom(map.getZoom())
    }

    const scheduleFitCityToContainer = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0
        fitCityToContainer()
      })
    }

    scheduleFitCityToContainer()
    map.on('resize', scheduleFitCityToContainer)
    window.addEventListener('resize', scheduleFitCityToContainer)
    window.visualViewport?.addEventListener('resize', scheduleFitCityToContainer)

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame)
      }

      map.setMinZoom(0)
      map.off('resize', scheduleFitCityToContainer)
      window.removeEventListener('resize', scheduleFitCityToContainer)
      window.visualViewport?.removeEventListener('resize', scheduleFitCityToContainer)
    }
  }, [bounds, map])

  return null
}

function boundaryRingsFromBoundary(boundary: BoundaryGeometry) {
  return (boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat())
    .map((ring) => ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number]))
}

function maskRingsFromBoundary(boundary: BoundaryGeometry) {
  return [worldMaskRing, ...boundaryRingsFromBoundary(boundary)]
}

function BoundaryMaskLayer({ boundary }: { boundary: BoundaryGeometry }) {
  const map = useMap()

  useEffect(() => {
    const outsideCityLayer = L.polygon(maskRingsFromBoundary(boundary), {
      color: 'transparent',
      fillColor: '#eef2ee',
      fillOpacity: 0.7,
      fillRule: 'evenodd',
      interactive: false,
      opacity: 0,
      stroke: false,
    })
    const boundaryLayer = L.polyline(boundaryRingsFromBoundary(boundary), {
      color: '#1d352b',
      interactive: false,
      opacity: 0.72,
      smoothFactor: 0.4,
      weight: 2,
    })
    const maskLayer = L.layerGroup([outsideCityLayer, boundaryLayer]).addTo(map)

    return () => {
      maskLayer.remove()
    }
  }, [boundary, map])

  return null
}

function App() {
  const [mode, setMode] = useState<LocationMode>('simulated')
  const [activeAtlas, setActiveAtlas] = useState<BoundedAtlasPoint | null>(null)
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => getViewportSize())
  const [isLocating, setIsLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('Stadtgrenze wird geladen…')
  const bootedSimulatedLocation = useRef(false)
  const mapFrameSize = useMemo(() => (
    activeAtlas ? getAtlasFrameSize(activeAtlas.bounds, viewportSize) : null
  ), [activeAtlas, viewportSize])
  const mapFrameStyle = useMemo<CSSProperties>(() => ({
    width: mapFrameSize ? `${mapFrameSize.width}px` : '100vw',
    height: mapFrameSize ? `${mapFrameSize.height}px` : '100svh',
  }), [mapFrameSize])
  const mapKey = activeAtlas
    ? `${activeAtlas.bounds.south}:${activeAtlas.bounds.west}:${activeAtlas.bounds.north}:${activeAtlas.bounds.east}`
    : 'empty-atlas'

  useEffect(() => {
    const updateViewportSize = () => {
      setViewportSize(getViewportSize())
    }

    updateViewportSize()
    window.addEventListener('resize', updateViewportSize)
    window.visualViewport?.addEventListener('resize', updateViewportSize)

    return () => {
      window.removeEventListener('resize', updateViewportSize)
      window.visualViewport?.removeEventListener('resize', updateViewportSize)
    }
  }, [])

  useEffect(() => {
    if (bootedSimulatedLocation.current) {
      return
    }

    bootedSimulatedLocation.current = true
    void activateSimulatedLocation()
  }, [])

  async function activateSimulatedLocation() {
    setMode('simulated')
    setIsLocating(true)
    setLocationMessage('Stadtgrenze wird geladen…')

    try {
      const simulated = await getSimulatedCityPoint()

      if (simulated) {
        setActiveAtlas(simulated)
      } else {
        setLocationMessage('Keine Stadtgrenze gefunden. Bitte erneut versuchen.')
      }
    } finally {
      setIsLocating(false)
    }
  }

  async function useGpsLocation() {
    setMode('gps')
    setIsLocating(true)
    setLocationMessage('GPS-Stadtgrenze wird geladen…')

    try {
      const sample = await getCurrentLocation()

      if (sample) {
        const nextPoint = {
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracyM: sample.accuracyM,
        }
        const nextBoundary = await fetchCityBoundary(nextPoint)

        if (nextBoundary) {
          setActiveAtlas(nextBoundary)
        } else {
          setLocationMessage('Für diesen GPS-Punkt wurde keine Stadtgrenze gefunden.')
        }
      } else {
        setLocationMessage('GPS konnte nicht gelesen werden.')
      }
    } finally {
      setIsLocating(false)
    }
  }

  return (
    <main className="atlas-core">
      {activeAtlas ? (
        <div className="atlas-map-frame" style={mapFrameStyle}>
          <MapContainer
            key={mapKey}
            center={[activeAtlas.point.latitude, activeAtlas.point.longitude]}
            zoom={14}
            zoomSnap={0.1}
            scrollWheelZoom
            maxBoundsViscosity={1}
            zoomControl={false}
            className="atlas-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
            <LockAtlasBounds bounds={activeAtlas.bounds} />
            <BoundaryMaskLayer boundary={activeAtlas.boundary} />
            {activeAtlas.point.accuracyM ? (
              <CircleMarker
                center={[activeAtlas.point.latitude, activeAtlas.point.longitude]}
                radius={Math.min(Math.max(activeAtlas.point.accuracyM / 3, 14), 42)}
                pathOptions={{ color: '#2f7d57', fillColor: '#2f7d57', fillOpacity: 0.12, weight: 1 }}
              />
            ) : null}
            <CircleMarker
              center={[activeAtlas.point.latitude, activeAtlas.point.longitude]}
              radius={9}
              pathOptions={{ color: '#ffffff', fillColor: mode === 'gps' ? '#2f7d57' : '#d78b35', fillOpacity: 1, weight: 3 }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                {mode === 'gps' ? 'GPS' : 'Simulated'}
              </Tooltip>
            </CircleMarker>
          </MapContainer>
        </div>
      ) : (
        <div className="atlas-empty-state" style={mapFrameStyle}>
          <span>{isLocating ? 'Stadtgrenze wird geladen…' : locationMessage}</span>
        </div>
      )}

      <div className="atlas-controls" role="group" aria-label="Atlas location controls">
        <button
          className={mode === 'gps' ? 'atlas-control active' : 'atlas-control'}
          type="button"
          onClick={useGpsLocation}
          aria-label="GPS"
          aria-busy={isLocating}
        >
          <Crosshair size={20} aria-hidden="true" />
          <span>GPS</span>
        </button>
        <button
          className={mode === 'simulated' ? 'atlas-control active' : 'atlas-control'}
          type="button"
          onClick={activateSimulatedLocation}
          aria-label="Simulated"
          aria-busy={isLocating && mode === 'simulated'}
        >
          <Route size={20} aria-hidden="true" />
          <span>Simulated</span>
        </button>
      </div>
    </main>
  )
}

export default App
