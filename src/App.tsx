import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { Crosshair, Route } from 'lucide-react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { cities } from './cityprintData'
import { createGeoBoundsAroundPoint, getCityGeoBounds } from './cityGeoBounds'
import { containsGeoPoint, type GeoBounds } from './geoGrid'
import { getNativeCurrentLocation, isNativeRuntime, requestNativeLocationPermission } from './nativeRuntime'
import type { GpsLocationSample } from './locationAdapter'

type LocationMode = 'gps' | 'simulated'

type AtlasPoint = {
  latitude: number
  longitude: number
  accuracyM?: number
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
  addressType: string | undefined
  category: string | undefined
  countryCode: string | undefined
  dePlace: string | undefined
  linkedPlace: string | undefined
  osmType: string | undefined
  placeType: string | undefined
}

const fallbackPoint: AtlasPoint = {
  latitude: 52.52,
  longitude: 13.405,
}

const citySearchSyllables = ['berg', 'burg', 'dorf', 'furt', 'hausen', 'heim', 'stadt', 'bach', 'feld', 'hagen', 'kirchen', 'weiler']
const fallbackGermanCityQueries = ['Berlin', 'Hamburg', 'Muenchen', 'Koeln', 'Frankfurt am Main', 'Dresden', 'Leipzig', 'Hannover']
const nominatimBaseUrl = import.meta.env.DEV ? '/nominatim' : 'https://nominatim.openstreetmap.org'
const worldMaskRing: [number, number][] = [
  [90, -180],
  [90, 180],
  [-90, 180],
  [-90, -180],
  [90, -180],
]

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

function boundaryFromBounds(bounds: GeoBounds): BoundaryGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.south],
        [bounds.east, bounds.north],
        [bounds.west, bounds.north],
        [bounds.west, bounds.south],
      ],
    ],
  }
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

function isGermanCityBoundary(candidate: CitySearchCandidate) {
  const isGerman = candidate.countryCode === 'de'
  const isBoundaryRelation = candidate.osmType === 'relation' && candidate.category === 'boundary' && candidate.placeType === 'administrative'
  const isCity = candidate.addressType === 'city' || candidate.dePlace === 'city' || candidate.linkedPlace === 'city'

  return isGerman && isBoundaryRelation && isCity
}

async function fetchCitySearchResult(query: string): Promise<BoundedAtlasPoint | null> {
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

  const places = await response.json() as Array<{
    addresstype?: string
    address?: {
      country_code?: string
    }
    boundingbox?: unknown
    category?: string
    extratags?: {
      'de:place'?: string
      linked_place?: string
    }
    geojson?: unknown
    lat?: string
    lon?: string
    osm_type?: string
    type?: string
  }>
  const boundedPlaces = places
    .map((place) => {
      const bounds = parseNominatimBounds(place.boundingbox)
      const boundary = parseBoundaryGeometry(place.geojson)
      const latitude = Number(place.lat)
      const longitude = Number(place.lon)

      if (!bounds || !boundary || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null
      }

      return {
        boundary,
        bounds,
        point: containsGeoPoint({ latitude, longitude }, bounds) ? { latitude, longitude } : pointFromBounds(bounds),
        addressType: place.addresstype,
        category: place.category,
        countryCode: place.address?.country_code,
        dePlace: place.extratags?.['de:place'],
        linkedPlace: place.extratags?.linked_place,
        osmType: place.osm_type,
        placeType: place.type,
      }
    })
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

  const payload = await response.json() as {
    boundingbox?: unknown
    geojson?: unknown
  }

  const bounds = parseNominatimBounds(payload.boundingbox)
  const boundary = parseBoundaryGeometry(payload.geojson)

  return bounds && boundary ? { point, bounds, boundary } : null
}

async function getSimulatedCityPoint(): Promise<BoundedAtlasPoint> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cityPoint = await fetchRandomCitySearchResult()

    if (cityPoint) {
      return cityPoint
    }
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cityPoint = await fetchCitySearchResult(randomFallbackCityQuery())

    if (cityPoint) {
      return cityPoint
    }
  }

  return {
    point: fallbackPoint,
    bounds: createGeoBoundsAroundPoint(fallbackPoint),
    boundary: boundaryFromBounds(createGeoBoundsAroundPoint(fallbackPoint)),
  }
}

function getFallbackBoundaryForPoint(point: AtlasPoint): BoundedAtlasPoint {
  for (const city of cities) {
    const bounds = getCityGeoBounds(city.id)

    if (bounds && containsGeoPoint(point, bounds)) {
      return {
        point,
        bounds,
        boundary: boundaryFromBounds(bounds),
      }
    }
  }

  const bounds = createGeoBoundsAroundPoint(point)

  return {
    point,
    bounds,
    boundary: boundaryFromBounds(bounds),
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

function LockAtlasBounds({ bounds, point }: { bounds: GeoBounds; point: AtlasPoint }) {
  const map = useMap()

  useEffect(() => {
    const cityBounds = L.latLngBounds([
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
    ])

    const fillViewportWithCity = () => {
      const coverZoom = map.getBoundsZoom(cityBounds, true, [0, 0])
      const focusPoint = L.latLng(point.latitude, point.longitude)

      map.setMaxBounds(cityBounds)
      map.setView(focusPoint, coverZoom, { animate: false })
      map.panInsideBounds(cityBounds, { animate: false })
    }

    fillViewportWithCity()
    map.on('resize', fillViewportWithCity)

    return () => {
      map.off('resize', fillViewportWithCity)
    }
  }, [bounds, map, point.latitude, point.longitude])

  return null
}

function maskRingsFromBoundary(boundary: BoundaryGeometry) {
  const boundaryRings = boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat()

  return [
    worldMaskRing,
    ...boundaryRings.map((ring) => ring.map(([longitude, latitude]) => [latitude, longitude] as [number, number])),
  ]
}

function BoundaryMaskLayer({ boundary }: { boundary: BoundaryGeometry }) {
  const map = useMap()

  useEffect(() => {
    const maskLayer = L.polygon(maskRingsFromBoundary(boundary), {
      color: '#d8e3da',
      fillColor: '#d8e3da',
      fillOpacity: 1,
      fillRule: 'evenodd',
      interactive: false,
      opacity: 0,
      stroke: false,
    }).addTo(map)

    return () => {
      maskLayer.remove()
    }
  }, [boundary, map])

  return null
}

function App() {
  const initialPoint = useMemo(() => fallbackPoint, [])
  const initialBounds = useMemo(() => createGeoBoundsAroundPoint(initialPoint), [initialPoint])
  const initialBoundary = useMemo(() => boundaryFromBounds(initialBounds), [initialBounds])
  const [mode, setMode] = useState<LocationMode>('simulated')
  const [activePoint, setActivePoint] = useState<AtlasPoint>(initialPoint)
  const [activeBounds, setActiveBounds] = useState<GeoBounds>(initialBounds)
  const [activeBoundary, setActiveBoundary] = useState<BoundaryGeometry>(initialBoundary)
  const [isLocating, setIsLocating] = useState(false)
  const bootedSimulatedLocation = useRef(false)

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

    try {
      const simulated = await getSimulatedCityPoint()

      setActivePoint(simulated.point)
      setActiveBounds(simulated.bounds)
      setActiveBoundary(simulated.boundary)
    } finally {
      setIsLocating(false)
    }
  }

  async function useGpsLocation() {
    setMode('gps')
    setIsLocating(true)

    try {
      const sample = await getCurrentLocation()

      if (sample) {
        const nextPoint = {
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracyM: sample.accuracyM,
        }
        const nextBoundary = await fetchCityBoundary(nextPoint) ?? getFallbackBoundaryForPoint(nextPoint)

        setActivePoint(nextBoundary.point)
        setActiveBounds(nextBoundary.bounds)
        setActiveBoundary(nextBoundary.boundary)
      }
    } finally {
      setIsLocating(false)
    }
  }

  return (
    <main className="atlas-core">
      <MapContainer
        center={[initialPoint.latitude, initialPoint.longitude]}
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
        <LockAtlasBounds bounds={activeBounds} point={activePoint} />
        <BoundaryMaskLayer boundary={activeBoundary} />
        {activePoint.accuracyM ? (
          <CircleMarker
            center={[activePoint.latitude, activePoint.longitude]}
            radius={Math.min(Math.max(activePoint.accuracyM / 3, 14), 42)}
            pathOptions={{ color: '#2f7d57', fillColor: '#2f7d57', fillOpacity: 0.12, weight: 1 }}
          />
        ) : null}
        <CircleMarker
          center={[activePoint.latitude, activePoint.longitude]}
          radius={9}
          pathOptions={{ color: '#ffffff', fillColor: mode === 'gps' ? '#2f7d57' : '#d78b35', fillOpacity: 1, weight: 3 }}
        >
          <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
            {mode === 'gps' ? 'GPS' : 'Simulated'}
          </Tooltip>
        </CircleMarker>
      </MapContainer>

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
