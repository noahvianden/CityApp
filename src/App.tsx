import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Crosshair, Route } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import { fetchBoundaryForGpsPoint, fetchSimulatedCityBoundary, type BoundedAtlasPoint } from './nominatimCityBoundaries'
import { getNativeCurrentLocation, isNativeRuntime, requestNativeLocationPermission } from './nativeRuntime'
import type { GpsLocationSample } from './locationAdapter'

type LocationMode = 'gps' | 'simulated'
type AppTab = 'atlas' | 'memories' | 'stats' | 'privacy'
type GpsNudgeDirection = 'north' | 'east' | 'south' | 'west'

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

const cityStyleUrl = `${import.meta.env.BASE_URL}city-style.json`
const worldMaskRing: [number, number][] = [
  [-180, 90],
  [180, 90],
  [180, -90],
  [-180, -90],
  [-180, 90],
]
const appTabs: AppTabItem[] = [
  {
    key: 'atlas',
    icon: 'A',
    label: 'Atlas',
    dummyTitle: 'Atlas',
    dummyBody: 'Explore the current city boundary.',
  },
  {
    key: 'memories',
    icon: 'M',
    label: 'Memories',
    dummyTitle: 'Memories coming soon',
    dummyBody: 'This placeholder will show visited places, saved moments, and city notes.',
  },
  {
    key: 'stats',
    icon: 'S',
    label: 'Stats',
    dummyTitle: 'Stats coming soon',
    dummyBody: 'This placeholder will show discovery progress, visited areas, and atlas activity.',
  },
  {
    key: 'privacy',
    icon: 'P',
    label: 'Privacy',
    dummyTitle: 'Privacy coming soon',
    dummyBody: 'This placeholder will show location controls, data choices, and privacy settings.',
  },
]

function getAppTab(tab: AppTab) {
  return appTabs.find((item) => item.key === tab) ?? appTabs[0]
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

function getAtlasFrameSize(viewportSize: ViewportSize): AtlasFrameSize {
  const side = Math.max(Math.min(viewportSize.width, viewportSize.height), 1)

  return {
    width: side,
    height: side,
  }
}

type MapLibrePointProperties = {
  accuracyRadius: number
  label: string
  pointColor: string
}

type MapLibrePointFeature = {
  type: 'Feature'
  geometry: {
    type: 'Point'
    coordinates: [number, number]
  }
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
    geometry: {
      type: 'Point',
      coordinates: [point.longitude, point.latitude],
    },
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
  return {
    type: 'Polygon' as const,
    coordinates: [worldMaskRing, ...boundaryRingsFromBoundary(boundary)],
  }
}

function MapLibreCityMap({ atlas, mode }: { atlas: BoundedAtlasPoint, mode: LocationMode }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!containerRef.current) {
      return
    }

    let map: import('maplibre-gl').Map | null = null
    let resizeObserver: ResizeObserver | null = null

    void (async () => {
      const maplibregl = await import('maplibre-gl')

      if (cancelled || !containerRef.current) {
        return
      }

      map = new maplibregl.Map({
        container: containerRef.current,
        style: cityStyleUrl,
        center: [atlas.point.longitude, atlas.point.latitude],
        zoom: 14,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        scrollZoom: true,
        touchPitch: false,
        touchZoomRotate: true,
      })

      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()

      resizeObserver = new ResizeObserver(() => {
        map?.resize()
      })

      resizeObserver.observe(containerRef.current)

      map.on('load', () => {
        if (!map || cancelled) {
          return
        }

        const pointFeature = pointToFeature(atlas.point, mode)

        map.addSource('atlas-boundary-source', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: atlas.boundary,
            properties: {},
          },
        })

        map.addSource('atlas-outside-mask-source', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: outsideCityMaskGeometry(atlas.boundary),
            properties: {},
          },
        })

        map.addSource('atlas-point-source', {
          type: 'geojson',
          data: pointFeature,
        })

        map.addLayer({
          id: 'atlas-outside-city-mask',
          type: 'fill',
          source: 'atlas-outside-mask-source',
          paint: {
            'fill-color': '#f7efe0',
            'fill-opacity': 0.88,
          },
        })

        map.addLayer({
          id: 'atlas-outline',
          type: 'line',
          source: 'atlas-boundary-source',
          paint: {
            'line-color': '#1d352b',
            'line-opacity': 0.72,
            'line-width': 2,
          },
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
          paint: {
            'circle-color': ['get', 'pointColor'],
            'circle-radius': 9,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          },
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
          paint: {
            'text-color': '#ffffff',
            'text-halo-blur': 0.5,
            'text-halo-color': '#1d352b',
            'text-halo-width': 1.25,
          },
        })

        const cityBounds: [[number, number], [number, number]] = [
          [atlas.bounds.west, atlas.bounds.south],
          [atlas.bounds.east, atlas.bounds.north],
        ]

        map.fitBounds(cityBounds, {
          animate: false,
          padding: 0,
        })
        map.setMaxBounds(cityBounds)
        map.setMinZoom(map.getZoom())
      })
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      map?.remove()
    }
  }, [atlas, mode])

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

function App() {
  const [mode, setMode] = useState<LocationMode>('simulated')
  const [activeTab, setActiveTab] = useState<AppTab>('atlas')
  const [activeAtlas, setActiveAtlas] = useState<BoundedAtlasPoint | null>(null)
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() => getViewportSize())
  const [isLocating, setIsLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('Stadtgrenze wird geladen...')
  const bootedSimulatedLocation = useRef(false)
  const mapFrameSize = useMemo(() => (
    activeAtlas ? getAtlasFrameSize(viewportSize) : null
  ), [activeAtlas, viewportSize])
  const mapFrameStyle = useMemo<CSSProperties>(() => ({
    width: mapFrameSize ? `${mapFrameSize.width}px` : '100vw',
    height: mapFrameSize ? `${mapFrameSize.height}px` : '100svh',
  }), [mapFrameSize])
  const mapKey = activeAtlas
    ? `${activeAtlas.cityId}:${activeAtlas.bounds.south}:${activeAtlas.bounds.west}:${activeAtlas.bounds.north}:${activeAtlas.bounds.east}`
    : 'empty-atlas'
  const activeTabItem = getAppTab(activeTab)
  const displayedTitle = activeTab === 'atlas' ? activeAtlas?.cityName ?? 'City' : activeTabItem.label

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
    setLocationMessage('Stadtgrenze wird geladen...')

    try {
      const simulated = await fetchSimulatedCityBoundary()

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
    setLocationMessage('GPS-Stadtgrenze wird geladen...')

    try {
      const sample = await getCurrentLocation()

      if (sample) {
        const nextPoint = {
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracyM: sample.accuracyM,
        }
        const nextBoundary = await fetchBoundaryForGpsPoint(nextPoint)

        if (nextBoundary) {
          setActiveAtlas(nextBoundary)
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

  function nudgeGpsLocation(direction: GpsNudgeDirection) {
    setMode('gps')
    setActiveAtlas((currentAtlas) => {
      if (!currentAtlas) {
        return currentAtlas
      }

      const latitudeStep = Math.max((currentAtlas.bounds.north - currentAtlas.bounds.south) * 0.025, 0.00025)
      const longitudeStep = Math.max((currentAtlas.bounds.east - currentAtlas.bounds.west) * 0.025, 0.00025)
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
      <header className="atlas-header">
        <h1>{displayedTitle}</h1>
        <div className="atlas-header-actions" aria-hidden="true">
          <button className="atlas-icon-button" type="button">+</button>
          <button className="atlas-icon-button" type="button">L</button>
        </div>
      </header>

      {activeTab === 'atlas' ? (
        activeAtlas ? (
          <div className="atlas-map-frame" style={mapFrameStyle}>
            <MapLibreCityMap key={mapKey} atlas={activeAtlas} mode={mode} />
          </div>
        ) : (
          <div className="atlas-empty-state" style={mapFrameStyle}>
            <span>{isLocating ? 'Stadtgrenze wird geladen...' : locationMessage}</span>
          </div>
        )
      ) : (
        <DummyPanel tab={activeTabItem} />
      )}

      {activeTab === 'atlas' ? (
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

      {activeTab === 'atlas' && activeAtlas ? (
        <div className="atlas-joycon" role="group" aria-label="Move GPS location">
          <button className="atlas-joycon-button north" type="button" onClick={() => nudgeGpsLocation('north')} aria-label="Move GPS north">↑</button>
          <button className="atlas-joycon-button west" type="button" onClick={() => nudgeGpsLocation('west')} aria-label="Move GPS west">←</button>
          <span className="atlas-joycon-center" aria-hidden="true" />
          <button className="atlas-joycon-button east" type="button" onClick={() => nudgeGpsLocation('east')} aria-label="Move GPS east">→</button>
          <button className="atlas-joycon-button south" type="button" onClick={() => nudgeGpsLocation('south')} aria-label="Move GPS south">↓</button>
        </div>
      ) : null}

      <nav className="atlas-tabbar" aria-label="App navigation">
        {appTabs.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? 'atlas-tab active' : 'atlas-tab'}
            type="button"
            onClick={() => setActiveTab(tab.key)}
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
