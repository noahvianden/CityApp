import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Crosshair, Route } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import { fetchBoundaryForGpsPoint, fetchSimulatedCityBoundary, type BoundedAtlasPoint } from './nominatimCityBoundaries'
import { getNativeCurrentLocation, isNativeRuntime, requestNativeLocationPermission } from './nativeRuntime'
import type { GpsLocationSample } from './locationAdapter'

type LocationMode = 'gps' | 'simulated'
type AppTab = 'atlas' | 'memories' | 'stats' | 'privacy'
type GpsNudgeDirection = 'north' | 'east' | 'south' | 'west'
type MapViewActionType = 'default' | 'snap'

type MapViewAction = {
  type: MapViewActionType
  nonce: number
}

type AppTabItem = {
  key: AppTab
  icon: string
  label: string
  dummyTitle: string
  dummyBody: string
}

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

type MapCamera = {
  center: [number, number]
  zoom: number
}

type UpdatableGeoJsonSource = {
  setData: (data: MapLibrePointFeature) => void
}

type CityHistoryItem = {
  cityId: string
  name: string
  description: string
  badge: string
  atlas: BoundedAtlasPoint
  mode: LocationMode
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

const cityStyleUrl = `${import.meta.env.BASE_URL}city-style.json`
const worldMaskRing: [number, number][] = [
  [-180, 90],
  [180, 90],
  [180, -90],
  [-180, -90],
  [-180, 90],
]
const gpsNudgeMeters = 10
const metersPerLatitudeDegree = 111_320
const placeOverviewZoom = 15.25
const appTabs: AppTabItem[] = [
  { key: 'atlas', icon: 'A', label: 'Atlas', dummyTitle: 'Atlas', dummyBody: 'Explore the current city boundary.' },
  { key: 'memories', icon: 'M', label: 'Memories', dummyTitle: 'Memories coming soon', dummyBody: 'This placeholder will show visited places, saved moments, and city notes.' },
  { key: 'stats', icon: 'S', label: 'Stats', dummyTitle: 'Stats coming soon', dummyBody: 'This placeholder will show discovery progress, visited areas, and atlas activity.' },
  { key: 'privacy', icon: 'P', label: 'Privacy', dummyTitle: 'Privacy coming soon', dummyBody: 'This placeholder will show location controls, data choices, and privacy settings.' },
]

function getAppTab(tab: AppTab) {
  return appTabs.find((item) => item.key === tab) ?? appTabs[0]
}

function getLocationModeLabel(mode: LocationMode) {
  return mode === 'gps' ? 'GPS mode' : 'Simulated mode'
}

function getAtlasHeaderMeta(atlas: BoundedAtlasPoint | null, mode: LocationMode, isLocating: boolean, locationMessage: string) {
  if (isLocating) {
    return locationMessage
  }

  if (!atlas) {
    return locationMessage
  }

  return `${getLocationModeLabel(mode)} - ${atlas.cityStatus} - ${atlas.cityCountry}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getViewportSize(): ViewportSize {
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

async function getBrowserCurrentLocation() {
  if (!navigator.geolocation) {
    return null
  }

  return new Promise<GpsLocationSample | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(toBrowserGpsSample(position)),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
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

function getAtlasFrameSize(viewportSize: ViewportSize): AtlasFrameSize {
  const side = Math.max(Math.min(viewportSize.width, viewportSize.height), 1)

  return { width: side, height: side }
}

type MapLibrePointProperties = {
  accuracyRadius: number
  label: string
  pointColor: string
}

type MapLibrePointFeature = {
  type: 'Feature'
  geometry: { type: 'Point', coordinates: [number, number] }
  properties: MapLibrePointProperties
}

function getAccuracyRadius(accuracyM: number | undefined) {
  if (!accuracyM || !Number.isFinite(accuracyM)) {
    return 0
  }

  return Math.min(Math.max(accuracyM / 3, 14), 42)
}

function pointToFeature(point: AtlasPoint, mode: LocationMode): MapLibrePointFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    properties: {
      accuracyRadius: getAccuracyRadius(point.accuracyM),
      label: mode === 'gps' ? 'GPS' : 'Simulated',
      pointColor: mode === 'gps' ? '#2f7d57' : '#d78b35',
    },
  }
}

function boundaryRingsFromBoundary(boundary: BoundedAtlasPoint['boundary']) {
  return boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat()
}

function outsideCityMaskGeometry(boundary: BoundedAtlasPoint['boundary']) {
  return { type: 'Polygon' as const, coordinates: [worldMaskRing, ...boundaryRingsFromBoundary(boundary)] }
}

function parseSearchBounds(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) {
    return null
  }

  const [south, north, west, east] = value.map((entry) => Number(entry))

  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
    return null
  }

  return { south, north, west, east }
}

function parseSearchBoundary(value: unknown): BoundedAtlasPoint['boundary'] | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const geometry = value as { type?: unknown, coordinates?: unknown }
  if ((geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') || !Array.isArray(geometry.coordinates)) {
    return null
  }

  return geometry as BoundedAtlasPoint['boundary']
}

function getBoundsFromSearchBoundary(boundary: BoundedAtlasPoint['boundary']) {
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

async function searchCityBoundary(query: string): Promise<BoundedAtlasPoint | null> {
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
    const bounds = boundary ? getBoundsFromSearchBoundary(boundary) ?? parseSearchBounds(place.boundingbox) : null
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

function cityBoundsFromAtlas(atlas: BoundedAtlasPoint): [[number, number], [number, number]] {
  return [
    [atlas.bounds.west, atlas.bounds.south],
    [atlas.bounds.east, atlas.bounds.north],
  ]
}

function getPointSource(map: import('maplibre-gl').Map) {
  return map.getSource('atlas-point-source') as UpdatableGeoJsonSource | undefined
}

function updatePointSource(map: import('maplibre-gl').Map, atlas: BoundedAtlasPoint, mode: LocationMode) {
  getPointSource(map)?.setData(pointToFeature(atlas.point, mode))
}

function centerMapOnPoint(map: import('maplibre-gl').Map, point: AtlasPoint, duration = 180) {
  map.easeTo({
    center: [point.longitude, point.latitude],
    duration,
    essential: true,
    zoom: map.getZoom(),
  })
}

function getCityDefaultCamera(map: import('maplibre-gl').Map, atlas: BoundedAtlasPoint): MapCamera {
  map.setMinZoom(0)
  const camera = map.cameraForBounds(cityBoundsFromAtlas(atlas), { padding: 0 })
  const fallbackCenter = map.getCenter()

  if (!camera?.center || typeof camera.zoom !== 'number') {
    return {
      center: [fallbackCenter.lng, fallbackCenter.lat],
      zoom: map.getZoom(),
    }
  }

  const centerValue = camera.center as { lng?: number, lat?: number } | [number, number]
  const center = Array.isArray(centerValue)
    ? centerValue
    : [Number(centerValue.lng), Number(centerValue.lat)] as [number, number]

  return {
    center,
    zoom: camera.zoom,
  }
}

function setMapToCityDefault(map: import('maplibre-gl').Map, atlas: BoundedAtlasPoint, animate: boolean) {
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

function MapLibreCityMap({ atlas, mode, viewAction }: { atlas: BoundedAtlasPoint, mode: LocationMode, viewAction: MapViewAction | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<import('maplibre-gl').Map | null>(null)
  const latestAtlasRef = useRef(atlas)
  const latestModeRef = useRef(mode)
  const handledViewActionNonce = useRef<number | null>(null)
  const boundaryKey = `${atlas.cityId}:${atlas.bounds.south}:${atlas.bounds.west}:${atlas.bounds.north}:${atlas.bounds.east}`

  useEffect(() => {
    latestAtlasRef.current = atlas
    latestModeRef.current = mode
  }, [atlas, mode])

  useEffect(() => {
    let cancelled = false

    if (!containerRef.current) {
      return
    }

    let map: import('maplibre-gl').Map | null = null
    let resizeObserver: ResizeObserver | null = null

    void (async () => {
      const maplibregl = await import('maplibre-gl')
      const initialAtlas = latestAtlasRef.current
      const initialMode = latestModeRef.current

      if (cancelled || !containerRef.current) {
        return
      }

      map = new maplibregl.Map({
        container: containerRef.current,
        style: cityStyleUrl,
        center: [initialAtlas.point.longitude, initialAtlas.point.latitude],
        zoom: 14,
        attributionControl: false,
        dragRotate: true,
        pitchWithRotate: false,
        scrollZoom: true,
        touchPitch: false,
        touchZoomRotate: true,
      })
      mapRef.current = map

      resizeObserver = new ResizeObserver(() => {
        map?.resize()
      })
      resizeObserver.observe(containerRef.current)

      map.on('load', () => {
        if (!map || cancelled) {
          return
        }

        map.addSource('atlas-boundary-source', {
          type: 'geojson',
          data: { type: 'Feature', geometry: initialAtlas.boundary, properties: {} },
        })
        map.addSource('atlas-outside-mask-source', {
          type: 'geojson',
          data: { type: 'Feature', geometry: outsideCityMaskGeometry(initialAtlas.boundary), properties: {} },
        })
        map.addSource('atlas-point-source', { type: 'geojson', data: pointToFeature(initialAtlas.point, initialMode) })

        map.addLayer({
          id: 'atlas-outside-city-mask',
          type: 'fill',
          source: 'atlas-outside-mask-source',
          paint: { 'fill-color': '#536b66', 'fill-opacity': 0.52 },
        })
        map.addLayer({
          id: 'atlas-outline',
          type: 'line',
          source: 'atlas-boundary-source',
          paint: { 'line-color': '#1d352b', 'line-opacity': 0.72, 'line-width': 2 },
        })
        map.addLayer({
          id: 'atlas-accuracy-circle',
          type: 'circle',
          source: 'atlas-point-source',
          paint: {
            'circle-color': ['get', 'pointColor'],
            'circle-opacity': 0.12,
            'circle-radius': ['get', 'accuracyRadius'],
            'circle-stroke-color': ['get', 'pointColor'],
            'circle-stroke-width': 1,
          },
        })
        map.addLayer({
          id: 'atlas-point-circle',
          type: 'circle',
          source: 'atlas-point-source',
          paint: { 'circle-color': ['get', 'pointColor'], 'circle-radius': 9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
        })
        map.addLayer({
          id: 'atlas-point-label',
          type: 'symbol',
          source: 'atlas-point-source',
          layout: {
            'text-allow-overlap': true,
            'text-anchor': 'top',
            'text-field': ['get', 'label'],
            'text-font': ['Amazon Ember Bold,Noto Sans Bold'],
            'text-offset': [0, -1.35],
            'text-size': 12,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-blur': 0.5, 'text-halo-color': '#1d352b', 'text-halo-width': 1.25 },
        })

        setMapToCityDefault(map, initialAtlas, false)
        map.setMaxBounds(cityBoundsFromAtlas(initialAtlas))
      })
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      mapRef.current = null
      map?.remove()
    }
  }, [boundaryKey])

  useEffect(() => {
    const map = mapRef.current

    if (!map || !map.isStyleLoaded()) {
      return
    }

    updatePointSource(map, atlas, mode)
    centerMapOnPoint(map, atlas.point)
  }, [atlas, mode])

  useEffect(() => {
    const map = mapRef.current

    if (!viewAction || !map || handledViewActionNonce.current === viewAction.nonce) {
      return
    }

    handledViewActionNonce.current = viewAction.nonce

    if (viewAction.type === 'default') {
      setMapToCityDefault(map, atlas, true)
      return
    }

    map.setMinZoom(0)
    map.easeTo({
      bearing: 0,
      center: [atlas.point.longitude, atlas.point.latitude],
      duration: 450,
      essential: true,
      pitch: 0,
      zoom: Math.max(map.getMinZoom(), placeOverviewZoom),
    })
  }, [atlas, viewAction])

  return <div ref={containerRef} className="atlas-map" />
}

function DummyPanel({ tab }: { tab: AppTabItem }) {
  return (
    <section className="atlas-dummy-panel" aria-label={tab.label}>
      <span className="atlas-dummy-eyebrow">Placeholder</span>
      <h2>{tab.dummyTitle}</h2>
      <p>{tab.dummyBody}</p>
      <div className="atlas-dummy-card">
        <strong>{tab.icon}</strong>
        <span>Dummy content for the {tab.label} tab.</span>
      </div>
    </section>
  )
}

function CitySelectionPanel({
  history,
  isSearching,
  onSearchSubmit,
  onSelectCity,
  searchMessage,
}: {
  history: CityHistoryItem[]
  isSearching: boolean
  onSearchSubmit: (query: string) => void
  onSelectCity: (city: CityHistoryItem) => void
  searchMessage: string
}) {
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isSearchActive) {
      searchInputRef.current?.focus()
    }
  }, [isSearchActive])

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedQuery = searchQuery.trim()

    if (trimmedQuery) {
      onSearchSubmit(trimmedQuery)
    } else {
      setIsSearchActive(true)
    }
  }

  return (
    <section className="atlas-city-selection-panel" aria-label="City selection">
      <div className="atlas-city-selection-heading">
        <h2>Choose a city</h2>
        <p>Major cities first. Any place can become a generated atlas later.</p>
      </div>

      <form className="atlas-city-search" role="search" onSubmit={submitSearch} onClick={() => setIsSearchActive(true)}>
        {isSearchActive ? (
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search cities or districts"
            aria-label="Search cities or districts"
            disabled={isSearching}
          />
        ) : (
          <span>Search cities or districts</span>
        )}
        <button type="submit" disabled={isSearching}>{isSearching ? 'Searching' : 'Search'}</button>
      </form>

      {searchMessage ? <p className="atlas-city-search-message">{searchMessage}</p> : null}

      <div className="atlas-city-list" aria-label="City history">
        {history.length ? history.map((city) => (
          <button key={city.cityId} className="atlas-city-option" type="button" onClick={() => onSelectCity(city)}>
            <span className="atlas-city-dot" aria-hidden="true" />
            <span className="atlas-city-option-copy">
              <strong>{city.name}</strong>
              <small>{city.description}</small>
            </span>
            <em>{city.badge}</em>
          </button>
        )) : (
          <div className="atlas-city-empty-history">
            <strong>No city history yet</strong>
            <span>Use GPS, Simulated, or Search to add a city here.</span>
          </div>
        )}
      </div>
    </section>
  )
}

function App() {
  const [mode, setMode] = useState<LocationMode>('simulated')
  const [activeTab, setActiveTab] = useState<AppTab>('atlas')
  const [activeAtlas, setActiveAtlas] = useState<BoundedAtlasPoint | null>(null)
  const [cityHistory, setCityHistory] = useState<CityHistoryItem[]>([])
  const [isCitySelectionOpen, setIsCitySelectionOpen] = useState(false)
  const [isMapFullscreen, setIsMapFullscreen] = useState(false)
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => getViewportSize())
  const [isLocating, setIsLocating] = useState(false)
  const [isSearchingCity, setIsSearchingCity] = useState(false)
  const [locationMessage, setLocationMessage] = useState('Stadtgrenze wird geladen...')
  const [citySearchMessage, setCitySearchMessage] = useState('')
  const [mapViewAction, setMapViewAction] = useState<MapViewAction | null>(null)
  const bootedSimulatedLocation = useRef(false)
  const mapFrameSize = useMemo(() => (activeAtlas ? getAtlasFrameSize(viewportSize) : null), [activeAtlas, viewportSize])
  const mapFrameStyle = useMemo<CSSProperties>(() => ({
    width: mapFrameSize ? `${mapFrameSize.width}px` : '100vw',
    height: mapFrameSize ? `${mapFrameSize.height}px` : '100svh',
  }), [mapFrameSize])
  const mapKey = activeAtlas
    ? `${activeAtlas.cityId}:${activeAtlas.bounds.south}:${activeAtlas.bounds.west}:${activeAtlas.bounds.north}:${activeAtlas.bounds.east}`
    : 'empty-atlas'
  const activeTabItem = getAppTab(activeTab)
  const displayedTitle = activeTab === 'atlas' ? activeAtlas?.cityName ?? 'City' : activeTabItem.label
  const displayedMeta = activeTab === 'atlas'
    ? getAtlasHeaderMeta(activeAtlas, mode, isLocating, locationMessage)
    : ''
  const shouldShowAtlasMap = activeTab === 'atlas' && !isCitySelectionOpen
  const mapFrameClassName = isMapFullscreen ? 'atlas-map-frame fullscreen' : 'atlas-map-frame'

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

  const rememberAtlasCity = useCallback((atlas: BoundedAtlasPoint, badge: string, nextMode: LocationMode) => {
    setCityHistory((currentHistory) => {
      const nextCity = {
        cityId: atlas.cityId,
        name: atlas.cityName,
        description: `${atlas.cityStatus} · ${atlas.cityCountry}`,
        badge,
        atlas,
        mode: nextMode,
      }
      const withoutDuplicate = currentHistory.filter((city) => city.cityId !== atlas.cityId)

      return [nextCity, ...withoutDuplicate].slice(0, 8)
    })
  }, [])

  const activateSimulatedLocation = useCallback(async () => {
    setMode('simulated')
    setIsLocating(true)
    setLocationMessage('Stadtgrenze wird geladen...')

    try {
      const simulated = await fetchSimulatedCityBoundary()

      if (simulated) {
        setActiveAtlas(simulated)
        rememberAtlasCity(simulated, 'simulated', 'simulated')
      } else {
        setLocationMessage('Keine Stadtgrenze gefunden. Bitte erneut versuchen.')
      }
    } finally {
      setIsLocating(false)
    }
  }, [rememberAtlasCity])

  useEffect(() => {
    if (bootedSimulatedLocation.current) {
      return
    }

    bootedSimulatedLocation.current = true
    void activateSimulatedLocation()
  }, [activateSimulatedLocation])

  async function useGpsLocation() {
    setMode('gps')
    setIsLocating(true)
    setLocationMessage('GPS-Stadtgrenze wird geladen...')

    try {
      const sample = await getCurrentLocation()

      if (sample) {
        const nextPoint = { latitude: sample.latitude, longitude: sample.longitude, accuracyM: sample.accuracyM }
        const nextBoundary = await fetchBoundaryForGpsPoint(nextPoint)

        if (nextBoundary) {
          setActiveAtlas(nextBoundary)
          rememberAtlasCity(nextBoundary, 'gps', 'gps')
        } else {
          setLocationMessage('Fuer diesen GPS-Punkt wurde keine Stadtgrenze gefunden.')
        }
      } else {
        setLocationMessage('GPS konnte nicht gelesen werden.')
      }
    } finally {
      setIsLocating(false)
    }
  }

  async function searchForCity(query: string) {
    setIsSearchingCity(true)
    setCitySearchMessage('Searching...')

    try {
      const searchedCity = await searchCityBoundary(query)

      if (searchedCity) {
        setMode('simulated')
        setActiveAtlas(searchedCity)
        rememberAtlasCity(searchedCity, 'searched', 'simulated')
        setCitySearchMessage('')
        setIsCitySelectionOpen(false)
      } else {
        setCitySearchMessage('No city boundary found. Try a larger city name.')
      }
    } catch {
      setCitySearchMessage('Search failed. Please try again.')
    } finally {
      setIsSearchingCity(false)
    }
  }

  function requestMapViewAction(type: MapViewActionType) {
    setMapViewAction({ type, nonce: Date.now() })
  }

  function openTab(tab: AppTab) {
    setActiveTab(tab)

    if (tab !== 'atlas') {
      setIsCitySelectionOpen(false)
      setIsMapFullscreen(false)
    }
  }

  function openCitySelection() {
    if (activeTab === 'atlas') {
      setIsMapFullscreen(false)
      setIsCitySelectionOpen(true)
    }
  }

  function openHistoryCity(city: CityHistoryItem) {
    setActiveAtlas(city.atlas)
    setMode(city.mode)
    setIsMapFullscreen(false)
    setIsCitySelectionOpen(false)
  }

  function nudgeGpsLocation(direction: GpsNudgeDirection) {
    setMode('gps')
    setActiveAtlas((currentAtlas) => {
      if (!currentAtlas) {
        return currentAtlas
      }

      const latitudeStep = gpsNudgeMeters / metersPerLatitudeDegree
      const longitudeMetersPerDegree = Math.max(metersPerLatitudeDegree * Math.cos(currentAtlas.point.latitude * Math.PI / 180), 1)
      const longitudeStep = gpsNudgeMeters / longitudeMetersPerDegree
      const latitudeOffset = direction === 'north' ? latitudeStep : direction === 'south' ? -latitudeStep : 0
      const longitudeOffset = direction === 'east' ? longitudeStep : direction === 'west' ? -longitudeStep : 0

      return {
        ...currentAtlas,
        point: {
          ...currentAtlas.point,
          latitude: clamp(currentAtlas.point.latitude + latitudeOffset, currentAtlas.bounds.south, currentAtlas.bounds.north),
          longitude: clamp(currentAtlas.point.longitude + longitudeOffset, currentAtlas.bounds.west, currentAtlas.bounds.east),
        },
      }
    })
  }

  return (
    <main className="atlas-core">
      {!isCitySelectionOpen ? (
        <header className="atlas-header">
          <h1>
            {activeTab === 'atlas' ? (
                <button
                  className="atlas-city-title-button"
                  type="button"
                  onClick={openCitySelection}
                  aria-label={`Open city selection for ${displayedTitle}`}
                >
                  <span>{displayedTitle}</span>
                </button>
              ) : displayedTitle}
          </h1>
          {activeTab === 'atlas' ? <p className="atlas-header-meta">{displayedMeta}</p> : null}
        </header>
      ) : null}

      {activeTab === 'atlas' ? (
        isCitySelectionOpen ? (
          <CitySelectionPanel
            history={cityHistory}
            isSearching={isSearchingCity}
            onSearchSubmit={searchForCity}
            onSelectCity={openHistoryCity}
            searchMessage={citySearchMessage}
          />
        ) : activeAtlas ? (
          <>
            <div className={mapFrameClassName} style={isMapFullscreen ? undefined : mapFrameStyle}>
              <MapLibreCityMap key={mapKey} atlas={activeAtlas} mode={mode} viewAction={mapViewAction} />
              <div
                className="atlas-map-action-top"
                role="group"
                aria-label="Map reset and snap controls"
                style={{ flexDirection: 'column' }}
              >
                <button className="atlas-map-action-button" type="button" onClick={() => requestMapViewAction('default')}>Reset</button>
                <button className="atlas-map-action-button" type="button" onClick={() => requestMapViewAction('snap')}>Snap</button>
              </div>
              <div className="atlas-map-action-left" role="group" aria-label="Map fullscreen control">
                <button
                  className="atlas-map-action-button"
                  type="button"
                  onClick={() => setIsMapFullscreen((current) => !current)}
                >
                  {isMapFullscreen ? 'Min' : 'Max'}
                </button>
              </div>
            </div>
            <div className="atlas-joycon" role="group" aria-label="Move GPS location">
              <button className="atlas-joycon-button north" type="button" onClick={() => nudgeGpsLocation('north')} aria-label="Move GPS north">↑</button>
              <button className="atlas-joycon-button west" type="button" onClick={() => nudgeGpsLocation('west')} aria-label="Move GPS west">←</button>
              <span className="atlas-joycon-center" aria-hidden="true" />
              <button className="atlas-joycon-button east" type="button" onClick={() => nudgeGpsLocation('east')} aria-label="Move GPS east">→</button>
              <button className="atlas-joycon-button south" type="button" onClick={() => nudgeGpsLocation('south')} aria-label="Move GPS south">↓</button>
            </div>
          </>
        ) : (
          <div className="atlas-empty-state" style={mapFrameStyle}>
            <span>{isLocating ? 'Stadtgrenze wird geladen...' : locationMessage}</span>
          </div>
        )
      ) : (
        <DummyPanel tab={activeTabItem} />
      )}

      {shouldShowAtlasMap ? (
        <div className="atlas-controls" role="group" aria-label="Atlas location controls">
          <button className={mode === 'gps' ? 'atlas-control active' : 'atlas-control'} type="button" onClick={useGpsLocation} aria-label="GPS" aria-busy={isLocating}>
            <Crosshair size={20} aria-hidden="true" />
            <span>GPS</span>
          </button>
          <button className={mode === 'simulated' ? 'atlas-control active' : 'atlas-control'} type="button" onClick={activateSimulatedLocation} aria-label="Simulated" aria-busy={isLocating && mode === 'simulated'}>
            <Route size={20} aria-hidden="true" />
            <span>Simulated</span>
          </button>
        </div>
      ) : null}

      <nav className="atlas-tabbar" aria-label="App navigation">
        {appTabs.map((tab) => (
          <button key={tab.key} className={activeTab === tab.key ? 'atlas-tab active' : 'atlas-tab'} type="button" onClick={() => openTab(tab.key)} aria-current={activeTab === tab.key ? 'page' : undefined}>
            <strong>{tab.icon}</strong>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}

export default App
