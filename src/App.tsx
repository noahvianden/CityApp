import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Crosshair, Route } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import {
  appTabs,
  centerMapOnPoint,
  cityBoundsFromAtlas,
  cityStyleUrl,
  clamp,
  getAppTab,
  getAtlasFrameSize,
  getCurrentLocation,
  getViewportSize,
  gpsNudgeMeters,
  metersPerLatitudeDegree,
  outsideCityMaskGeometry,
  placeOverviewZoom,
  pointToFeature,
  searchCityBoundary,
  setMapToCityDefault,
  type AppTab,
  type AppTabItem,
  type AtlasPoint,
  type CityHistoryItem,
  type GpsNudgeDirection,
  type LocationMode,
  type MapViewAction,
  type MapViewActionType,
  type ViewportSize,
  updatePointSource,
  upsertCityHistory,
} from './appDomain'
import { fetchBoundaryForGpsPoint, fetchSimulatedCityBoundary, type BoundedAtlasPoint } from './nominatimCityBoundaries'

type MapLibreMap = import('maplibre-gl').Map

function MapLibreCityMap({
  atlas,
  mode,
  viewAction,
}: {
  atlas: BoundedAtlasPoint
  mode: LocationMode
  viewAction: MapViewAction | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
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

    let map: MapLibreMap | null = null
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

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedQuery = searchQuery.trim()

    if (trimmedQuery) {
      onSearchSubmit(trimmedQuery)
      return
    }

    setIsSearchActive(true)
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
        <button type="submit" disabled={isSearching}>
          {isSearching ? 'Searching' : 'Search'}
        </button>
      </form>

      {searchMessage ? <p className="atlas-city-search-message">{searchMessage}</p> : null}

      <div className="atlas-city-list" aria-label="City history">
        {history.length ? (
          history.map((city) => (
            <button key={city.cityId} className="atlas-city-option" type="button" onClick={() => onSelectCity(city)}>
              <span className="atlas-city-dot" aria-hidden="true" />
              <span className="atlas-city-option-copy">
                <strong>{city.name}</strong>
                <small>{city.description}</small>
              </span>
              <em>{city.badge}</em>
            </button>
          ))
        ) : (
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

  const activeTabItem = getAppTab(activeTab)
  const mapFrameSize = useMemo(() => (activeAtlas ? getAtlasFrameSize(viewportSize) : null), [activeAtlas, viewportSize])
  const mapFrameStyle = useMemo<CSSProperties>(
    () => ({
      width: mapFrameSize ? `${mapFrameSize.width}px` : '100vw',
      height: mapFrameSize ? `${mapFrameSize.height}px` : '100svh',
    }),
    [mapFrameSize],
  )
  const mapKey = activeAtlas
    ? `${activeAtlas.cityId}:${activeAtlas.bounds.south}:${activeAtlas.bounds.west}:${activeAtlas.bounds.north}:${activeAtlas.bounds.east}`
    : 'empty-atlas'
  const displayedTitle = activeTab === 'atlas' ? activeAtlas?.cityName ?? 'City' : activeTabItem.label
  const shouldShowAtlasMap = activeTab === 'atlas' && !isCitySelectionOpen
  const mapFrameClassName = isMapFullscreen ? 'atlas-map-frame fullscreen' : 'atlas-map-frame'

  const updateCityHistory = useCallback((atlas: BoundedAtlasPoint, badge: string, nextMode: LocationMode) => {
    setCityHistory((currentHistory) => upsertCityHistory(currentHistory, atlas, badge, nextMode))
  }, [])

  const activateSimulatedLocation = useCallback(async () => {
    setMode('simulated')
    setIsLocating(true)
    setLocationMessage('Stadtgrenze wird geladen...')

    try {
      const simulated = await fetchSimulatedCityBoundary()

      if (simulated) {
        setActiveAtlas(simulated)
        updateCityHistory(simulated, 'simulated', 'simulated')
      } else {
        setLocationMessage('Keine Stadtgrenze gefunden. Bitte erneut versuchen.')
      }
    } finally {
      setIsLocating(false)
    }
  }, [updateCityHistory])

  const useGpsLocation = useCallback(async () => {
    setMode('gps')
    setIsLocating(true)
    setLocationMessage('GPS-Stadtgrenze wird geladen...')

    try {
      const sample = await getCurrentLocation()

      if (!sample) {
        setLocationMessage('GPS konnte nicht gelesen werden.')
        return
      }

      const nextPoint: AtlasPoint = {
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracyM: sample.accuracyM,
      }
      const nextBoundary = await fetchBoundaryForGpsPoint(nextPoint)

      if (nextBoundary) {
        setActiveAtlas(nextBoundary)
        updateCityHistory(nextBoundary, 'gps', 'gps')
        return
      }

      setLocationMessage('Fuer diesen GPS-Punkt wurde keine Stadtgrenze gefunden.')
    } finally {
      setIsLocating(false)
    }
  }, [updateCityHistory])

  const searchForCity = useCallback(
    async (query: string) => {
      setIsSearchingCity(true)
      setCitySearchMessage('Searching...')

      try {
        const searchedCity = await searchCityBoundary(query)

        if (!searchedCity) {
          setCitySearchMessage('No city boundary found. Try a larger city name.')
          return
        }

        setMode('simulated')
        setActiveAtlas(searchedCity)
        updateCityHistory(searchedCity, 'searched', 'simulated')
        setCitySearchMessage('')
        setIsCitySelectionOpen(false)
      } catch {
        setCitySearchMessage('Search failed. Please try again.')
      } finally {
        setIsSearchingCity(false)
      }
    },
    [updateCityHistory],
  )

  const requestMapViewAction = useCallback((type: MapViewActionType) => {
    setMapViewAction({ type, nonce: Date.now() })
  }, [])

  const openTab = useCallback((tab: AppTab) => {
    setActiveTab(tab)

    if (tab !== 'atlas') {
      setIsCitySelectionOpen(false)
      setIsMapFullscreen(false)
    }
  }, [])

  const openCitySelection = useCallback(() => {
    if (activeTab === 'atlas') {
      setIsMapFullscreen(false)
      setIsCitySelectionOpen(true)
    }
  }, [activeTab])

  const openHistoryCity = useCallback((city: CityHistoryItem) => {
    setActiveAtlas(city.atlas)
    setMode(city.mode)
    setIsMapFullscreen(false)
    setIsCitySelectionOpen(false)
  }, [])

  const nudgeGpsLocation = useCallback((direction: GpsNudgeDirection) => {
    setMode('gps')
    setActiveAtlas((currentAtlas) => {
      if (!currentAtlas) {
        return currentAtlas
      }

      const latitudeStep = gpsNudgeMeters / metersPerLatitudeDegree
      const longitudeMetersPerDegree = Math.max(metersPerLatitudeDegree * Math.cos((currentAtlas.point.latitude * Math.PI) / 180), 1)
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
  }, [])

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
  }, [activateSimulatedLocation])

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
            ) : (
              displayedTitle
            )}
          </h1>
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
              <div className="atlas-map-action-top" role="group" aria-label="Map reset and snap controls" style={{ flexDirection: 'column' }}>
                <button className="atlas-map-action-button" type="button" onClick={() => requestMapViewAction('default')}>
                  Reset
                </button>
                <button className="atlas-map-action-button" type="button" onClick={() => requestMapViewAction('snap')}>
                  Snap
                </button>
              </div>
              <div className="atlas-map-action-left" role="group" aria-label="Map fullscreen control">
                <button className="atlas-map-action-button" type="button" onClick={() => setIsMapFullscreen((current) => !current)}>
                  {isMapFullscreen ? 'Min' : 'Max'}
                </button>
              </div>
            </div>
            <div className="atlas-joycon" role="group" aria-label="Move GPS location">
              <button className="atlas-joycon-button north" type="button" onClick={() => nudgeGpsLocation('north')} aria-label="Move GPS north">
                ^
              </button>
              <button className="atlas-joycon-button west" type="button" onClick={() => nudgeGpsLocation('west')} aria-label="Move GPS west">
                &lt;
              </button>
              <span className="atlas-joycon-center" aria-hidden="true" />
              <button className="atlas-joycon-button east" type="button" onClick={() => nudgeGpsLocation('east')} aria-label="Move GPS east">
                &gt;
              </button>
              <button className="atlas-joycon-button south" type="button" onClick={() => nudgeGpsLocation('south')} aria-label="Move GPS south">
                v
              </button>
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
      ) : null}

      <nav className="atlas-tabbar" aria-label="App navigation">
        {appTabs.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? 'atlas-tab active' : 'atlas-tab'}
            type="button"
            onClick={() => openTab(tab.key)}
            aria-current={activeTab === tab.key ? 'page' : undefined}
          >
            <strong>{tab.icon}</strong>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </main>
  )
}

export default App
