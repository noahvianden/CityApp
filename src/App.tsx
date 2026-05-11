import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Crosshair, Route } from 'lucide-react'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'
import { fetchBoundaryForGpsPoint, fetchSimulatedCityBoundary, type BoundedAtlasPoint } from './nominatimCityBoundaries'
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

const cityStyleUrl = `${import.meta.env.BASE_URL}city-style.json`

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

function pointToFeature(point: AtlasPoint, cityName: string, mode: LocationMode): MapLibrePointFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [point.longitude, point.latitude],
    },
    properties: {
      accuracyRadius: getAccuracyRadius(point.accuracyM),
      label: cityName,
      pointColor: mode === 'gps' ? '#2f7d57' : '#d78b35',
    },
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

        const pointFeature = pointToFeature(atlas.point, atlas.cityName, mode)

        map.addSource('atlas-mask-source', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: atlas.boundary,
            properties: {},
          },
        })

        map.addSource('atlas-point-source', {
          type: 'geojson',
          data: pointFeature,
        })

        map.addLayer({
          id: 'atlas-boundary-fill',
          type: 'fill',
          source: 'atlas-mask-source',
          paint: {
            'fill-color': '#eef2ee',
            'fill-opacity': 0.58,
          },
        })

        map.addLayer({
          id: 'atlas-outline',
          type: 'line',
          source: 'atlas-mask-source',
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

function App() {
  const [mode, setMode] = useState<LocationMode>('simulated')
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

  return (
    <main className="atlas-core">
      {activeAtlas ? (
        <div className="atlas-map-frame" style={mapFrameStyle}>
          <MapLibreCityMap key={mapKey} atlas={activeAtlas} mode={mode} />
          <div className="atlas-city-badge" aria-live="polite">
            <span className="atlas-city-name">{activeAtlas.cityName}</span>
            <span className="atlas-city-meta">
              {activeAtlas.cityCountry} · {activeAtlas.cityStatus}
            </span>
          </div>
        </div>
      ) : (
        <div className="atlas-empty-state" style={mapFrameStyle}>
          <span>{isLocating ? 'Stadtgrenze wird geladen...' : locationMessage}</span>
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
