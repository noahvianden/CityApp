import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  appTabs,
  clamp,
  getAppTab,
  getAtlasFrameSize,
  getCurrentLocation,
  gpsSampleToAtlasPoint,
  gpsNudgeMeters,
  isAtlasPointInsideBoundary,
  metersPerLatitudeDegree,
  nativeGpsSampleEventName,
  searchCityBoundary,
  upsertCityHistory,
  type AppTab,
  type CityHistoryItem,
  type GpsNudgeDirection,
  type LocationMode,
  type MapViewAction,
  type MapViewActionType,
} from '../appDomain'
import type { GpsLocationSample } from '../locationAdapter'
import { fetchBoundaryForGpsPoint, fetchSimulatedCityBoundary, type BoundedAtlasPoint } from '../nominatimCityBoundaries'
import { useViewportSize } from './useViewportSize'

export function useAtlasController() {
  const [mode, setMode] = useState<LocationMode>('simulated')
  const [activeTab, setActiveTab] = useState<AppTab>('atlas')
  const [activeAtlas, setActiveAtlas] = useState<BoundedAtlasPoint | null>(null)
  const [cityHistory, setCityHistory] = useState<CityHistoryItem[]>([])
  const [isCitySelectionOpen, setIsCitySelectionOpen] = useState(false)
  const [isMapFullscreen, setIsMapFullscreen] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [isSearchingCity, setIsSearchingCity] = useState(false)
  const [locationMessage, setLocationMessage] = useState('Stadtgrenze wird geladen...')
  const [citySearchMessage, setCitySearchMessage] = useState('')
  const [mapViewAction, setMapViewAction] = useState<MapViewAction | null>(null)
  const bootedSimulatedLocation = useRef(false)
  const viewportSize = useViewportSize()

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
  const displayedTitle = activeTab === 'atlas' ? (activeAtlas?.cityName ?? 'City') : activeTabItem.label
  const shouldShowAtlasMap = activeTab === 'atlas' && !isCitySelectionOpen
  const mapFrameClassName = isMapFullscreen ? 'atlas-map-frame fullscreen' : 'atlas-map-frame'

  const updateCityHistory = useCallback((atlas: BoundedAtlasPoint, badge: string, nextMode: LocationMode) => {
    setCityHistory((currentHistory) => upsertCityHistory(currentHistory, atlas, badge, nextMode))
  }, [])

  const applyGpsSample = useCallback(
    async (sample: GpsLocationSample) => {
      const nextPoint = gpsSampleToAtlasPoint(sample)
      setMode('gps')

      if (activeAtlas && isAtlasPointInsideBoundary(nextPoint, activeAtlas)) {
        const nextAtlas = {
          ...activeAtlas,
          point: nextPoint,
        }

        setIsLocating(false)
        setActiveAtlas(nextAtlas)
        return
      }

      setIsLocating(true)
      setLocationMessage('GPS-Stadtgrenze wird geladen...')

      try {
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
    },
    [activeAtlas, updateCityHistory],
  )

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

      await applyGpsSample(sample)
    } finally {
      setIsLocating(false)
    }
  }, [applyGpsSample])

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
    if (bootedSimulatedLocation.current) {
      return
    }

    bootedSimulatedLocation.current = true
    void activateSimulatedLocation()
  }, [activateSimulatedLocation])

  useEffect(() => {
    function handleNativeGpsSample(event: Event) {
      const sample = (event as CustomEvent<GpsLocationSample>).detail

      if (sample?.kind === 'gps') {
        void applyGpsSample(sample)
      }
    }

    window.addEventListener(nativeGpsSampleEventName, handleNativeGpsSample)

    return () => {
      window.removeEventListener(nativeGpsSampleEventName, handleNativeGpsSample)
    }
  }, [applyGpsSample])

  return {
    activeAtlas,
    activeTab,
    activeTabItem,
    appTabs,
    activateSimulatedLocation,
    cityHistory,
    citySearchMessage,
    displayedTitle,
    isCitySelectionOpen,
    isLocating,
    isMapFullscreen,
    isSearchingCity,
    locationMessage,
    mapFrameClassName,
    mapFrameStyle,
    mapKey,
    mapViewAction,
    mode,
    nudgeGpsLocation,
    openCitySelection,
    openHistoryCity,
    openTab,
    requestMapViewAction,
    searchForCity,
    setIsMapFullscreen,
    shouldShowAtlasMap,
    useGpsLocation,
  }
}
