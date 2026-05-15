import { useEffect, useRef } from 'react'
import {
  centerMapOnPoint,
  cityBoundsFromAtlas,
  cityStyleUrl,
  outsideCityMaskGeometry,
  placeOverviewZoom,
  pointToFeature,
  setMapToCityDefault,
  updatePointSource,
  type LocationMode,
  type MapViewAction,
} from '../appDomain'
import type { BoundedAtlasPoint } from '../nominatimCityBoundaries'

type MapLibreMap = import('maplibre-gl').Map

type MapLibreCityMapProps = {
  atlas: BoundedAtlasPoint
  mode: LocationMode
  viewAction: MapViewAction | null
}

export function MapLibreCityMap({ atlas, mode, viewAction }: MapLibreCityMapProps) {
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
        map.addSource('atlas-point-source', {
          type: 'geojson',
          data: pointToFeature(initialAtlas.point, initialMode),
        })

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
