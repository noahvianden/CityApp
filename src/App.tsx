import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Camera,
  ChartNoAxesColumnIncreasing,
  Coffee,
  Compass,
  Download,
  EyeOff,
  Footprints,
  Heart,
  Landmark,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pause,
  Play,
  Plus,
  Route,
  Save,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  Trash2,
  TreePine,
  Utensils,
  Share2,
  X,
  ArrowRight,
} from 'lucide-react'
import './App.css'
import {
  type CityProgressState,
  type LatestRevealDigest,
  type LocationSettings,
  type Memory,
  type MemoryVisibility,
  type PrivacySettings,
} from './appState'
import { cities, type Category, type City, type Place } from './cityprintData'
import { getCityProgress, readCityprintSnapshot, writeCityprintSnapshot, clearCityprintSnapshot } from './persistence'
import {
  classifyFogCell,
  getVisiblePlaces,
  mapCells,
} from './revealModel'
import {
  buildExportFilename,
  buildPrivacyRules,
  buildRouteTracePath,
  createResetSnapshot,
  currentProgressSummary,
  describeRouteTraceVisibility,
  hasLocalProgress,
  snapshotToPrettyJson,
  summarizeRouteTrace,
} from './privacyToolkit'
import { getDiscoveryReviewState } from './discoveryFlow'
import { buildCityRecap, buildRecapExportFilename, recapExportToPrettyJson, type CityRecap } from './recapModel'
import { buildExternalNavigationUrl } from './navigation'
import {
  checkNativeLocationPermission,
  copyTextToClipboard,
  getNativeCurrentLocation,
  isNativeRuntime,
  openExternalUrl,
  requestNativeLocationPermission,
  saveTextFile,
  shareText as shareTextViaRuntime,
  watchNativeLocation,
} from './nativeRuntime'
import {
  createIdleWalkSession,
  pauseWalkSession,
  resumeWalkSession,
  startWalkSession,
  stepWalk,
  type WalkSession,
} from './walkController'
import {
  createLocationFeedProvider,
  describeLocationPipeline,
  describeLocationSampleOutcome,
  type LocationFeedTone,
  type LocationPipelineSummary,
  type LocationFeedState,
} from './locationFeed'
import type { GpsLocationSample, LocationSample } from './locationAdapter'

type Tab = 'Atlas' | 'Discovery' | 'Memories' | 'Stats' | 'Privacy'
type LocationMode = LocationSettings['mode']
type MemoryOriginTab = Tab
type MemorySurface = 'Journal' | 'Saved Places'

type LocationFeedEntry = {
  id: string
  title: string
  detail: string
  tone: LocationFeedTone
}

function formatGpsCoordinate(value: number) {
  return value.toFixed(5)
}

function cellNoise(x: number, y: number, salt: number) {
  const raw = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123

  return raw - Math.floor(raw)
}

function describeMemoryContext(memory: Memory, places: Place[]) {
  if (memory.placeId) {
    const place = places.find((candidate) => candidate.id === memory.placeId)

    return place ? `${place.name} - ${place.district}` : 'Saved place'
  }

  if (memory.routeCell) {
    return `Route cell ${memory.routeCell}`
  }

  return 'Current walk'
}

function buildMemoryShareText(memory: Memory, city: City, places: Place[]) {
  const place = memory.placeId ? places.find((candidate) => candidate.id === memory.placeId) : null
  const context = describeMemoryContext(memory, places)

  return [
    `Cityprint memory in ${city.name}`,
    `Title: ${memory.title}`,
    place ? `Place: ${place.name} - ${place.district}` : `Context: ${context}`,
    `Tag: ${memory.tag}`,
    `Visibility: ${memory.visibility}`,
    `Created: ${memory.createdAt}`,
    `Note: ${memory.text}`,
  ].join('\n')
}

function getCellPolygon(cell: (typeof mapCells)[number]) {
  const x = cell.x * 100
  const y = cell.y * 100
  const topInset = 8 + Math.round(cellNoise(cell.x, cell.y, 1) * 7)
  const rightInset = 8 + Math.round(cellNoise(cell.x, cell.y, 2) * 7)
  const bottomInset = 8 + Math.round(cellNoise(cell.x, cell.y, 3) * 7)
  const leftInset = 8 + Math.round(cellNoise(cell.x, cell.y, 4) * 7)
  const topWobble = Math.round((cellNoise(cell.x, cell.y, 5) - 0.5) * 10)
  const rightWobble = Math.round((cellNoise(cell.x, cell.y, 6) - 0.5) * 10)
  const bottomWobble = Math.round((cellNoise(cell.x, cell.y, 7) - 0.5) * 10)
  const leftWobble = Math.round((cellNoise(cell.x, cell.y, 8) - 0.5) * 10)
  const cornerShift = Math.round((cellNoise(cell.x, cell.y, 9) - 0.5) * 6)
  const diagonalShift = ((cell.x + cell.y) % 2 === 0 ? 1 : -1) * 3

  const points = [
    `${x + leftInset + cornerShift},${y + topInset}`,
    `${x + 48 + topWobble},${y + 5 + diagonalShift}`,
    `${x + 100 - rightInset},${y + 10 + Math.round((cellNoise(cell.x, cell.y, 10) - 0.5) * 6)}`,
    `${x + 95 + Math.round((cellNoise(cell.x, cell.y, 11) - 0.5) * 6)},${y + 48 + rightWobble}`,
    `${x + 100 - bottomInset},${y + 100 - 8 - Math.round((cellNoise(cell.x, cell.y, 12) - 0.5) * 6)}`,
    `${x + 50 + bottomWobble},${y + 100 - 5 - diagonalShift}`,
    `${x + leftInset - 1 + Math.round((cellNoise(cell.x, cell.y, 13) - 0.5) * 4)},${y + 100 - bottomInset}`,
    `${x + 5 + Math.round((cellNoise(cell.x, cell.y, 14) - 0.5) * 6)},${y + 50 + leftWobble}`,
  ]

  return `M ${points.join(' L ')} Z`
}

function getMemoryMarkerPosition(
  memory: Memory,
  city: City,
  visiblePlaceIds: ReadonlySet<string>,
  revealedCells: ReadonlySet<string>,
) {
  if (memory.placeId) {
    const place = city.places.find((candidate) => candidate.id === memory.placeId)

    if (!place || !visiblePlaceIds.has(place.id)) {
      return null
    }

    return {
      left: place.x + 3,
      top: place.y - 6,
      kind: 'place' as const,
    }
  }

  if (!memory.routeCell || !revealedCells.has(memory.routeCell)) {
    return null
  }

  const cell = mapCells.find((candidate) => candidate.id === memory.routeCell)

  if (!cell) {
    return null
  }

  return {
    left: cell.left + 3,
    top: cell.top - 6,
    kind: 'route' as const,
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

const categoryIcons: Record<Category, LucideIcon> = {
  cafe: Coffee,
  restaurant: Utensils,
  park: TreePine,
  bar: Store,
  gallery: Landmark,
  shop: Store,
  culture: Landmark,
  viewpoint: Compass,
  market: Store,
  quiet_spot: TreePine,
  landmark: Landmark,
}

const categoryLabels: Record<Category, string> = {
  cafe: 'Cafe',
  restaurant: 'Restaurant',
  park: 'Park',
  bar: 'Bar',
  gallery: 'Gallery',
  shop: 'Shop',
  culture: 'Culture',
  viewpoint: 'Viewpoint',
  market: 'Market',
  quiet_spot: 'Quiet spot',
  landmark: 'Landmark',
}

function describeWalkSession(session: WalkSession, routeLength: number, acceptedSampleCount = 0) {
  const routeLabel = `Route ${Math.min(session.routeIndex + 1, routeLength)}/${routeLength}`
  const sampleLabel = `${acceptedSampleCount} accepted sample${acceptedSampleCount === 1 ? '' : 's'}`

  if (session.status === 'running') {
    return {
      title: 'Live walk',
      detail: `${sampleLabel} are revealing nearby streets.`,
      routeLabel,
    }
  }

  if (session.status === 'background') {
    return {
      title: 'Walk in background',
      detail: `${sampleLabel} captured; the feed is waiting for the app to resume.`,
      routeLabel,
    }
  }

  if (session.routeIndex > 0) {
    return {
      title: 'Walk paused',
      detail: `${sampleLabel} captured so far. Resume to continue the route.`,
      routeLabel,
    }
  }

  return {
    title: 'Ready to walk',
    detail: `${sampleLabel} ready to reveal adjacent areas.`,
    routeLabel,
  }
}

function deriveRouteTrace(city: City | null, routeIndex: number, storedTrace: string[]) {
  if (storedTrace.length > 0) {
    return storedTrace
  }

  if (!city || city.walkRoute.length === 0) {
    return []
  }

  const endIndex = Math.min(routeIndex + 1, city.walkRoute.length)

  return city.walkRoute.slice(0, Math.max(1, endIndex))
}

function App() {
  const [storedSnapshot] = useState(() => readCityprintSnapshot())
  const storedSelectedCityId = cities.some((candidate) => candidate.id === storedSnapshot.selectedCityId) ? storedSnapshot.selectedCityId : null
  const bootCity = cities.find((candidate) => candidate.id === storedSelectedCityId) ?? cities[0]
  const bootProgress = getCityProgress(storedSnapshot, bootCity)
  const [cityProgress, setCityProgress] = useState(storedSnapshot.cityProgress)
  const [selectedCityId, setSelectedCityId] = useState<string | null>(storedSelectedCityId)
  const [activeTab, setActiveTab] = useState<Tab>('Atlas')
  const [search, setSearch] = useState('')
  const [revealedCells, setRevealedCells] = useState<Set<string>>(() => new Set(bootProgress.revealedCells))
  const [recentCells, setRecentCells] = useState<Set<string>>(() => new Set())
  const [seenPlaceIds, setSeenPlaceIds] = useState<Set<string>>(() => new Set(bootProgress.seenPlaceIds))
  const [savedPlaceIds, setSavedPlaceIds] = useState<Set<string>>(() => new Set(bootProgress.savedPlaceIds))
  const [walkSession, setWalkSession] = useState<WalkSession>(() => ({
    ...createIdleWalkSession(),
    routeIndex: bootProgress.routeIndex,
    routeTrace: deriveRouteTrace(bootCity, bootProgress.routeIndex, bootProgress.routeTrace),
    acceptedSampleCount: bootProgress.acceptedSampleCount,
    status: bootProgress.routeIndex > 0 ? 'paused' : 'idle',
  }))
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null)
  const [discoveryIds, setDiscoveryIds] = useState<string[]>(() => bootProgress.discoveryIds)
  const [reviewedDiscoveryIds, setReviewedDiscoveryIds] = useState<string[]>(() => bootProgress.reviewedDiscoveryIds)
  const [discoverySummary, setDiscoverySummary] = useState<{ revealedCellCount: number; routeLabel: string } | null>(null)
  const [latestRevealDigest, setLatestRevealDigest] = useState<LatestRevealDigest | null>(bootProgress.latestRevealDigest)
  const [discoveryPanelOpen, setDiscoveryPanelOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryOriginTab, setMemoryOriginTab] = useState<MemoryOriginTab>('Atlas')
  const [memoryContextPlaceId, setMemoryContextPlaceId] = useState<string | undefined>('linden-cafe')
  const [memoryRouteCell, setMemoryRouteCell] = useState<string | undefined>(undefined)
  const [memoryTitle, setMemoryTitle] = useState('Morning light')
  const [memoryText, setMemoryText] = useState('Warm window seat after the first revealed block.')
  const [memoryTag, setMemoryTag] = useState('quiet')
  const [memoryVisibility, setMemoryVisibility] = useState<MemoryVisibility>('Private')
  const [memoryHasPhoto, setMemoryHasPhoto] = useState(false)
  const [memorySearch, setMemorySearch] = useState('')
  const [memoryFilter, setMemoryFilter] = useState('All')
  const [memorySurface, setMemorySurface] = useState<MemorySurface>('Journal')
  const [activeMemoryId, setActiveMemoryId] = useState<string | null>(null)
  const [privacy, setPrivacy] = useState<PrivacySettings>(storedSnapshot.privacy)
  const [location, setLocation] = useState<LocationSettings>(storedSnapshot.location)
  const [memories, setMemories] = useState<Memory[]>(bootProgress.memories)
  const [recapRequested, setRecapRequested] = useState(false)
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [exportCopied, setExportCopied] = useState(false)
  const [exportDownloaded, setExportDownloaded] = useState(false)
  const [recapCopied, setRecapCopied] = useState(false)
  const [recapDownloaded, setRecapDownloaded] = useState(false)
  const [recapShareStatus, setRecapShareStatus] = useState<'idle' | 'shared' | 'copied'>('idle')
  const [memoryShareCopied, setMemoryShareCopied] = useState(false)
  const [savedPlaceSearch, setSavedPlaceSearch] = useState('')
  const [savedPlaceFilter, setSavedPlaceFilter] = useState<'All' | 'Visible' | 'Hidden' | Category>('All')
  const [gpsIngressMessage, setGpsIngressMessage] = useState('Waiting for a GPS sample.')
  const [walkDetailsOpen, setWalkDetailsOpen] = useState(
    () =>
      storedSnapshot.location.mode === 'gps' &&
      (storedSnapshot.location.permission !== 'granted' || !storedSnapshot.privacy.preciseLocation),
  )
  const [locationFeedLog, setLocationFeedLog] = useState<LocationFeedEntry[]>(() => [
    {
      id: 'feed-0',
      title: 'Location feed ready',
      detail:
        storedSnapshot.location.mode === 'gps'
          ? 'Request device geolocation to start the live feed.'
          : 'Start the walk to advance simulated samples.',
      tone: 'info',
    },
  ])
  const locationFeedLogId = useRef(0)

  const city = useMemo(() => cities.find((candidate) => candidate.id === selectedCityId) ?? null, [selectedCityId])

  const visiblePlaces = useMemo(() => {
    if (!city) {
      return []
    }

    return getVisiblePlaces(city.places, revealedCells)
  }, [city, revealedCells])

  const activePlace = useMemo(
    () => city?.places.find((place) => place.id === activePlaceId) ?? null,
    [activePlaceId, city],
  )
  const activePlaceDetailRef = useRef<HTMLElement | null>(null)

  const activePlaceMemories = useMemo(
    () => (activePlace ? memories.filter((memory) => memory.placeId === activePlace.id) : []),
    [activePlace, memories],
  )

  const activeMemory = useMemo(
    () => memories.find((memory) => memory.id === activeMemoryId) ?? null,
    [activeMemoryId, memories],
  )

  useEffect(() => {
    if (!activePlace) {
      return
    }

    activePlaceDetailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [activePlace])

  const savedPlaces = useMemo(
    () => city?.places.filter((place) => savedPlaceIds.has(place.id)) ?? [],
    [city, savedPlaceIds],
  )

  const discoveryPlaces = useMemo(
    () => city?.places.filter((place) => discoveryIds.includes(place.id)) ?? [],
    [city, discoveryIds],
  )

  const routeIndex = walkSession.routeIndex
  const progress = Math.round((revealedCells.size / mapCells.length) * 100)
  const distanceWalked = (Math.max(routeIndex, 0) * 0.18).toFixed(1)
  const routeTrace = useMemo(() => deriveRouteTrace(city, routeIndex, walkSession.routeTrace), [city, routeIndex, walkSession.routeTrace])
  const currentCell =
    location.mode === 'gps' && walkSession.lastSampleCellId
      ? walkSession.lastSampleCellId
      : routeTrace[routeTrace.length - 1] ?? city?.walkRoute[Math.min(routeIndex, city.walkRoute.length - 1)]
  const gpsPrivacyLocked = location.mode === 'gps' && !privacy.preciseLocation
  const visibleCurrentCell = gpsPrivacyLocked ? undefined : currentCell
  const routeTraceVisibility = useMemo(() => describeRouteTraceVisibility(privacy), [privacy])
  const routePath = useMemo(() => (city ? buildRouteTracePath(city, routeTrace, privacy) : ''), [city, privacy, routeTrace])
  const routeFragments = useMemo(() => (city ? summarizeRouteTrace(city, routeTrace) : []), [city, routeTrace])
  const routeTraceCopy = routeTraceVisibility.visible
    ? routeTraceVisibility.label
    : routeFragments.length > 0
      ? `${routeTraceVisibility.label}: ${routeFragments.slice(0, 3).join(' - ')}`
      : routeTraceVisibility.label
  const memoryContextLabel = activeMemory
    ? describeMemoryContext(activeMemory, city?.places ?? [])
    : memoryContextPlaceId
      ? describeMemoryContext(
          {
            id: 'draft-memory',
            title: '',
            text: '',
            tag: '',
            visibility: memoryVisibility,
            placeId: memoryContextPlaceId,
            routeCell: memoryRouteCell,
            hasPhoto: memoryHasPhoto,
            createdAt: 'Today',
          },
          city?.places ?? [],
        )
      : memoryRouteCell
        ? `Route cell ${memoryRouteCell}`
        : 'Current walk'

  const currentCityProgress = useMemo<CityProgressState>(
    () => ({
      revealedCells: [...revealedCells],
      seenPlaceIds: [...seenPlaceIds],
      savedPlaceIds: [...savedPlaceIds],
      routeIndex,
      routeTrace,
      acceptedSampleCount: walkSession.acceptedSampleCount ?? 0,
      latestRevealDigest,
      discoveryIds,
      reviewedDiscoveryIds,
      memories,
    }),
    [
      discoveryIds,
      latestRevealDigest,
      memories,
      revealedCells,
      reviewedDiscoveryIds,
      routeIndex,
      routeTrace,
      savedPlaceIds,
      seenPlaceIds,
      walkSession.acceptedSampleCount,
    ],
  )

  const snapshotForStorage = useMemo(
    () => ({
      selectedCityId,
      privacy,
      location,
      cityProgress: city
        ? {
            ...cityProgress,
            [city.id]: currentCityProgress,
          }
        : cityProgress,
    }),
    [city, cityProgress, currentCityProgress, location, privacy, selectedCityId],
  )

  const privacyRules = useMemo(() => buildPrivacyRules(privacy), [privacy])
  const locationFeedProvider = useMemo(() => createLocationFeedProvider(location), [location])
  const locationFeed = useMemo(
    () => locationFeedProvider.describe(walkSession, privacy.preciseLocation),
    [locationFeedProvider, privacy.preciseLocation, walkSession],
  )
  const locationPipeline = useMemo(
    () => describeLocationPipeline(location, locationFeed, walkSession),
    [location, locationFeed, walkSession],
  )
  const localProgressSummary = useMemo(() => {
    if (!city) {
      return null
    }

    return currentProgressSummary(currentCityProgress)
  }, [city, currentCityProgress])

  const appendLocationFeedEntry = useCallback((title: string, detail: string, tone: LocationFeedTone = 'info') => {
    const entry: LocationFeedEntry = {
      id: `feed-${locationFeedLogId.current += 1}`,
      title,
      detail,
      tone,
    }

    setLocationFeedLog((current) => [entry, ...current].slice(0, 4))
  }, [])

  async function shareTextWithFallback(title: string, text: string) {
    return shareTextViaRuntime(title, text)
  }

  const advanceWalk = useCallback(
    (activeCity: City, sample?: LocationSample | null) => {
      const result = stepWalk({
        city: activeCity,
        session: walkSession,
        revealedCells,
        seenPlaceIds,
        sample,
      })

      setWalkSession(result.session)
      setRevealedCells(result.revealedCells)
      setRecentCells(new Set(result.recentCells))

      if (sample) {
        const sampleOutcome = describeLocationSampleOutcome({
          sampleKind: sample.kind,
          acceptedSampleCount: result.session.acceptedSampleCount ?? 0,
          sampleReason: result.sampleReason,
          discoveryPlaceCount: result.discoveryPlaceIds.length,
          sampleCellId: result.sampleCellId,
          advancedRoute: result.advancedRoute,
        })

        setGpsIngressMessage(sample.kind === 'gps' && result.sampleReason && result.sampleReason !== 'gps' ? `GPS sample ignored: ${sampleOutcome.detail}` : sampleOutcome.detail)
        appendLocationFeedEntry(sampleOutcome.title, sampleOutcome.detail, sampleOutcome.tone)
      }

      if (result.discoveryPlaceIds.length > 0) {
        setDiscoveryIds(result.discoveryPlaceIds)
        const nextReviewedDiscoveryIds = activePlaceId && result.discoveryPlaceIds.includes(activePlaceId) ? [activePlaceId] : []
        const featuredDiscoveryPlaceId = activePlaceId && result.discoveryPlaceIds.includes(activePlaceId) ? activePlaceId : result.discoveryPlaceIds[0]
        const featuredDiscoveryPlace = featuredDiscoveryPlaceId
          ? activeCity.places.find((place) => place.id === featuredDiscoveryPlaceId)
          : null

        setDiscoverySummary({
          revealedCellCount: result.recentCells.length,
          routeLabel: describeWalkSession(result.session, activeCity.walkRoute.length).routeLabel,
        })
        setSeenPlaceIds(result.seenPlaceIds)
        if (!activePlaceId) {
          setActivePlaceId(result.discoveryPlaceIds[0] ?? null)
          nextReviewedDiscoveryIds.push(result.discoveryPlaceIds[0])
        }
        setLatestRevealDigest({
          revealedCellCount: result.recentCells.length,
          routeLabel: describeWalkSession(result.session, activeCity.walkRoute.length).routeLabel,
          placeCount: result.discoveryPlaceIds.length,
          reviewedCount: nextReviewedDiscoveryIds.length,
          pendingCount: Math.max(result.discoveryPlaceIds.length - nextReviewedDiscoveryIds.length, 0),
          featuredPlaceName: featuredDiscoveryPlace?.name,
        })
        setReviewedDiscoveryIds(nextReviewedDiscoveryIds)
        setDiscoveryPanelOpen(true)
        setActiveTab('Discovery')
      }
    },
    [activePlaceId, appendLocationFeedEntry, revealedCells, seenPlaceIds, walkSession],
  )

  const advanceWalkRef = useRef(advanceWalk)
  const walkSessionRef = useRef(walkSession)
  const walkStatusRef = useRef(walkSession.status)

  useEffect(() => {
    advanceWalkRef.current = advanceWalk
  }, [advanceWalk])

  useEffect(() => {
    walkSessionRef.current = walkSession
  }, [walkSession])

  useEffect(() => {
    walkStatusRef.current = walkSession.status
  }, [walkSession.status])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (walkStatusRef.current !== 'running') {
          return
        }

        setWalkSession((current) => pauseWalkSession(current, 'background'))
        setGpsIngressMessage('Cityprint moved to the background. Return and resume the walk when you are ready.')
        appendLocationFeedEntry('App moved to background', 'Discovery pauses until you return and resume the walk.', 'warning')
        return
      }

      if (walkStatusRef.current === 'background') {
        setGpsIngressMessage('Back in the app. Resume the walk to keep revealing the city.')
        appendLocationFeedEntry('Returned to the app', 'Resume the walk to keep accepting location samples.', 'info')
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [appendLocationFeedEntry])

  useEffect(() => {
    if (!city || location.mode !== 'simulated' || !locationFeedProvider.isActive(walkSessionRef.current, privacy.preciseLocation)) {
      return
    }

    const timer = window.setInterval(() => {
      const sample = locationFeedProvider.createSample(city, walkSessionRef.current, Date.now())

      if (sample) {
        advanceWalkRef.current(city, sample)
      }
    }, locationFeedProvider.intervalMs)

    return () => window.clearInterval(timer)
  }, [city, location.mode, locationFeedProvider, privacy.preciseLocation, walkSession.status])

  useEffect(() => {
    if (location.mode !== 'gps' || location.permission !== 'granted' || !privacy.preciseLocation) {
      return
    }

    const handleGpsSample = (sample: GpsLocationSample, sourceLabel: 'Browser' | 'Device') => {
      setLocation((current) => ({
        ...current,
        gpsLatitude: formatGpsCoordinate(sample.latitude),
        gpsLongitude: formatGpsCoordinate(sample.longitude),
        gpsAccuracy: sample.accuracyM.toFixed(0),
      }))

      if (!city) {
        setGpsIngressMessage(`${sourceLabel} location updated.`)
        return
      }

      if (walkStatusRef.current === 'running' || walkStatusRef.current === 'background') {
        advanceWalkRef.current(city, sample)
        return
      }

      setGpsIngressMessage(`${sourceLabel} location updated. Start the walk to ingest samples.`)
    }

    if (isNativeRuntime()) {
      let cancelled = false
      let cleanup: (() => void) | null = null

      void watchNativeLocation(
        (sample) => {
          if (!cancelled) {
            handleGpsSample(sample, 'Device')
          }
        },
        (message) => {
          if (!cancelled) {
            setGpsIngressMessage(message)
            appendLocationFeedEntry('Device location unavailable', message, 'warning')
          }
        },
      ).then((stopWatching) => {
        if (cancelled) {
          stopWatching()
          return
        }

        cleanup = stopWatching
      })

      return () => {
        cancelled = true
        cleanup?.()
      }
    }

    if (!('geolocation' in navigator)) {
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const sample = toBrowserGpsSample(position)

        handleGpsSample(sample, 'Browser')
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocation((current) => ({
            ...current,
            permission: 'denied',
          }))
          setGpsIngressMessage('Browser geolocation permission was denied.')
          return
        }

        setGpsIngressMessage('Browser geolocation could not provide a sample.')
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [appendLocationFeedEntry, city, location.mode, location.permission, privacy.preciseLocation])

  useEffect(() => {
    if (location.mode !== 'gps' || !privacy.preciseLocation) {
      return
    }

    let cancelled = false
    let cleanup: (() => void) | null = null

    const syncPermission = (state: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'not-requested') => {
      if (cancelled) {
        return
      }

      const nextPermission = state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'not-requested'

      setLocation((current) =>
        current.permission === nextPermission
          ? current
          : {
            ...current,
            permission: nextPermission,
          },
      )

      if (location.mode === 'gps' && nextPermission !== 'granted') {
        setWalkDetailsOpen(true)
      }

      if (state === 'granted') {
        setGpsIngressMessage('Location access is ready. Start or resume the walk to accept samples.')
        appendLocationFeedEntry('Location permission granted', 'The device can now provide precise location samples.', 'live')
      } else if (state === 'denied') {
        setGpsIngressMessage('Location access is denied in system settings.')
        appendLocationFeedEntry('Location permission denied', 'The device will not provide GPS samples until permission changes.', 'warning')
      }
    }

    if (isNativeRuntime()) {
      void checkNativeLocationPermission().then(syncPermission)

      return () => {
        cancelled = true
      }
    }

    if (!('permissions' in navigator) || !navigator.permissions?.query) {
      return
    }

    void navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) {
          return
        }

        const handleChange = () => syncPermission(status.state)

        syncPermission(status.state)
        status.addEventListener('change', handleChange)
        cleanup = () => status.removeEventListener('change', handleChange)
      })
      .catch(() => {
        if (!cancelled) {
          setGpsIngressMessage('Browser permissions cannot be inspected in this browser.')
          appendLocationFeedEntry('Browser permissions unavailable', 'The browser does not expose permission status for geolocation.', 'warning')
        }
      })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [appendLocationFeedEntry, location.mode, privacy.preciseLocation])

  useEffect(() => {
    if (recentCells.size === 0) {
      return
    }

    const timer = window.setTimeout(() => setRecentCells(new Set()), 1400)

    return () => window.clearTimeout(timer)
  }, [recentCells])

  useEffect(() => {
    writeCityprintSnapshot(snapshotForStorage)
  }, [snapshotForStorage])

  const filteredCities = cities.filter((candidate) => candidate.name.toLowerCase().includes(search.toLowerCase()))
  const visiblePlaceIds = useMemo(() => new Set(visiblePlaces.map((place) => place.id)), [visiblePlaces])
  const visibleMemoryMarkers = useMemo(
    () =>
      city
        ? memories
            .map((memory) => {
              const markerPosition = getMemoryMarkerPosition(memory, city, visiblePlaceIds, revealedCells)

              return markerPosition ? { memory, ...markerPosition } : null
            })
            .filter((marker): marker is { memory: Memory; left: number; top: number; kind: 'place' | 'route' } => Boolean(marker))
        : [],
    [city, memories, revealedCells, visiblePlaceIds],
  )
  const filteredMemories = memories.filter((memory) => {
    const matchesSearch = `${memory.title} ${memory.text} ${memory.tag}`.toLowerCase().includes(memorySearch.toLowerCase())
    const matchesFilter = memoryFilter === 'All' || memory.tag === memoryFilter || memory.visibility === memoryFilter

    return matchesSearch && matchesFilter
  })

  const recapPreview = useMemo<CityRecap | null>(() => {
    if (!city) {
      return null
    }

    return buildCityRecap({
      city,
      progress,
      distanceWalkedKm: distanceWalked,
      revealedCells,
      routeTrace,
      visiblePlaces,
      savedPlaceIds,
      memories,
      privacy,
      latestReveal: latestRevealDigest,
    })
  }, [city, distanceWalked, latestRevealDigest, memories, privacy, progress, revealedCells, routeTrace, savedPlaceIds, visiblePlaces])

  const generatedRecap = recapRequested ? recapPreview : null

  function openCity(nextCity: City) {
    const nextCityProgress = city
      ? {
          ...cityProgress,
          [city.id]: currentCityProgress,
        }
      : cityProgress
    const nextProgress = getCityProgress(
      {
        selectedCityId: nextCity.id,
        privacy,
        location,
        cityProgress: nextCityProgress,
      },
      nextCity,
    )

    setCityProgress(nextCityProgress)
    setSelectedCityId(nextCity.id)
    setActiveTab('Atlas')
    setRevealedCells(new Set(nextProgress.revealedCells))
    setRecentCells(new Set(nextProgress.revealedCells))
    setSeenPlaceIds(new Set(nextProgress.seenPlaceIds))
    setSavedPlaceIds(new Set(nextProgress.savedPlaceIds))
    setWalkSession({
      ...createIdleWalkSession(),
      routeIndex: nextProgress.routeIndex,
      routeTrace: deriveRouteTrace(nextCity, nextProgress.routeIndex, nextProgress.routeTrace),
      acceptedSampleCount: nextProgress.acceptedSampleCount,
      status: nextProgress.routeIndex > 0 ? 'paused' : 'idle',
    })
    setMemories(nextProgress.memories)
    setLatestRevealDigest(nextProgress.latestRevealDigest ?? null)
    setDiscoveryIds(nextProgress.discoveryIds)
    setReviewedDiscoveryIds(nextProgress.reviewedDiscoveryIds)
    setActivePlaceId(null)
    setActiveMemoryId(null)
    setDiscoveryPanelOpen(false)
    setLatestRevealDigest(null)
    setMemorySurface('Journal')
    setMemoryOpen(false)
    setMemoryOriginTab('Atlas')
    setMemoryContextPlaceId(undefined)
    setMemoryRouteCell(undefined)
    setSavedPlaceSearch('')
    setSavedPlaceFilter('All')
    setDiscoveryIds([])
    setReviewedDiscoveryIds([])
    setRecapRequested(false)
    setRecapCopied(false)
    setRecapDownloaded(false)
    setDiscoverySummary(null)
    locationFeedLogId.current = 0
    setLocationFeedLog([
      {
        id: `feed-${locationFeedLogId.current += 1}`,
        title: 'Location feed ready',
        detail:
          location.mode === 'gps'
            ? 'Request device geolocation to start the live feed.'
            : 'Start the walk to advance simulated samples.',
        tone: 'info',
      },
    ])
  }

  function closeDiscovery() {
    setDiscoveryPanelOpen(false)
    setActiveTab('Atlas')
  }

  function markDiscoveryReviewed(placeId: string) {
    if (!discoveryIds.includes(placeId)) {
      return
    }

    setReviewedDiscoveryIds((current) => (current.includes(placeId) ? current : [...current, placeId]))
  }

  function openPlaceDetail(placeId: string) {
    setActivePlaceId(placeId)
    markDiscoveryReviewed(placeId)
  }

  function resetLocalData() {
    const resetSnapshot = createResetSnapshot()

    clearCityprintSnapshot()
    setSelectedCityId(resetSnapshot.selectedCityId)
    setCityProgress(resetSnapshot.cityProgress)
    setPrivacy(resetSnapshot.privacy)
    setLocation(resetSnapshot.location)
    setActiveTab('Atlas')
    setMemorySurface('Journal')
    setSearch('')
    setRevealedCells(new Set())
    setRecentCells(new Set())
    setSeenPlaceIds(new Set())
    setSavedPlaceIds(new Set())
    setWalkSession(createIdleWalkSession())
    setActivePlaceId(null)
    setActiveMemoryId(null)
    setMemoryOriginTab('Atlas')
    setLatestRevealDigest(null)
    setDiscoveryIds([])
    setReviewedDiscoveryIds([])
    setDiscoverySummary(null)
    setDiscoveryPanelOpen(false)
    setMemoryOpen(false)
    setMemoryContextPlaceId(undefined)
    setMemoryRouteCell(undefined)
    setMemoryTitle('')
    setMemoryText('')
    setMemoryTag('walk')
    setMemoryVisibility('Private')
    setMemoryHasPhoto(false)
    setMemorySearch('')
    setMemoryFilter('All')
    setSavedPlaceSearch('')
    setSavedPlaceFilter('All')
    setRecapRequested(false)
    setMemories([])
    setExportPreviewOpen(false)
    setResetConfirmOpen(false)
    setExportCopied(false)
    setExportDownloaded(false)
    setRecapCopied(false)
    setRecapDownloaded(false)
    setWalkDetailsOpen(false)
    locationFeedLogId.current = 0
    setLocationFeedLog([
      {
        id: `feed-${locationFeedLogId.current += 1}`,
        title: 'Local data cleared',
        detail: 'Start a new walk to rebuild the feed history.',
        tone: 'info',
      },
    ])
  }

  async function copyExportPreview() {
    const text = snapshotToPrettyJson(snapshotForStorage)

    setExportCopied(await copyTextToClipboard(text, 'Cityprint export'))
  }

  async function downloadExportPreview() {
    const preview = snapshotToPrettyJson(snapshotForStorage)
    const filename = buildExportFilename(snapshotForStorage)

    try {
      setExportDownloaded((await saveTextFile(filename, preview)) === 'saved')
    } catch {
      setExportDownloaded(false)
    }
  }

  function openExportPreview() {
    setExportCopied(false)
    setExportDownloaded(false)
    setExportPreviewOpen(true)
  }

  function createRecap() {
    if (!city) return

    setWalkSession((current) => (current.status === 'running' ? pauseWalkSession(current, 'paused') : current))
    setRecapRequested(true)
    setRecapCopied(false)
    setRecapDownloaded(false)
    setRecapShareStatus('idle')
    setActiveTab('Stats')
  }

  async function copyRecap() {
    if (!generatedRecap) {
      return
    }

    setRecapCopied(await copyTextToClipboard(generatedRecap.shareText, generatedRecap.title))
  }

  async function shareRecap() {
    if (!generatedRecap || !city) {
      return
    }

    const shareStatus = await shareTextWithFallback(generatedRecap.title, generatedRecap.shareText)
    setRecapShareStatus(shareStatus)
  }

  async function downloadRecap() {
    if (!generatedRecap || !city) {
      return
    }

    const preview = recapExportToPrettyJson(city, generatedRecap)
    const filename = buildRecapExportFilename(city.name)

    try {
      setRecapDownloaded((await saveTextFile(filename, preview)) === 'saved')
    } catch {
      setRecapDownloaded(false)
    }
  }

  function startWalk() {
    if (!city) {
      return
    }

    setDiscoveryIds([])
    setReviewedDiscoveryIds([])
    setDiscoveryPanelOpen(false)
    setWalkSession((current) =>
      startWalkSession(
        {
          ...current,
          routeIndex: current.routeIndex >= city.walkRoute.length - 1 ? 0 : current.routeIndex,
          routeTrace: current.routeTrace.length > 0 ? current.routeTrace : deriveRouteTrace(city, current.routeIndex, []),
          acceptedSampleCount: current.routeIndex >= city.walkRoute.length - 1 ? 0 : current.acceptedSampleCount ?? 0,
        },
        Date.now(),
      ),
    )
    setGpsIngressMessage(location.mode === 'gps' ? 'Waiting for device geolocation.' : 'Waiting for the next sample.')
    locationFeedLogId.current = 0
    setLocationFeedLog([
      {
        id: `feed-${locationFeedLogId.current += 1}`,
        title: 'Walk started',
        detail: location.mode === 'gps' ? 'Waiting for device geolocation.' : 'Waiting for the next sample.',
        tone: 'info',
      },
    ])
  }

  function pauseWalk() {
    setWalkSession((current) => pauseWalkSession(current, 'paused'))
  }

  function backgroundWalk() {
    setWalkSession((current) => pauseWalkSession(current, 'background'))
  }

  function resumeWalk() {
    setWalkSession((current) => resumeWalkSession(current))
  }

  function continueExploring() {
    setDiscoveryPanelOpen(false)
    setActiveTab('Atlas')
    setWalkSession((current) => resumeWalkSession(current))
  }

  const requestBrowserLocation = useCallback(
    async (activateGpsMode = false) => {
      if (activateGpsMode && location.mode !== 'gps') {
        setLocation((current) => ({
          ...current,
          mode: 'gps',
        }))
        if (location.permission !== 'granted' || !privacy.preciseLocation) {
          setWalkDetailsOpen(true)
        }
        setGpsIngressMessage(
          privacy.preciseLocation
            ? 'GPS mode enabled. Request device location to start live samples.'
            : 'GPS mode enabled. Turn on precise location in Privacy before requesting device geolocation.',
        )
        appendLocationFeedEntry('GPS mode enabled', 'The device geolocation lane is staged and ready for permission.')
      }

      if (location.mode !== 'gps' && !activateGpsMode) {
        setGpsIngressMessage('Switch to GPS mode first.')
        appendLocationFeedEntry('GPS request skipped', 'Switch to GPS mode before requesting device geolocation.', 'info')
        return
      }

      if (!privacy.preciseLocation) {
        setWalkDetailsOpen(true)
        setGpsIngressMessage('Turn on precise location in Privacy before requesting device geolocation.')
        appendLocationFeedEntry('Precise location is off', 'Enable precise location before requesting device geolocation.', 'warning')
        return
      }

      if (isNativeRuntime()) {
        setGpsIngressMessage('Requesting device location access.')
        appendLocationFeedEntry('Location permission requested', 'The Android location prompt is waiting for a response.')

        const permission = await requestNativeLocationPermission()

        if (permission !== 'granted') {
          setLocation((current) => ({
            ...current,
            permission,
          }))
          setWalkDetailsOpen(true)
          setGpsIngressMessage('Device location permission was denied.')
          appendLocationFeedEntry(
            'Device location denied',
            'Android blocked location access, so the live feed cannot start.',
            'warning',
          )
          return
        }

        setLocation((current) => ({
          ...current,
          permission: 'granted',
        }))

        try {
          const sample = await getNativeCurrentLocation()

          if (!sample) {
            throw new Error('Device location is unavailable.')
          }

          setLocation((current) => ({
            ...current,
            permission: 'granted',
            gpsLatitude: formatGpsCoordinate(sample.latitude),
            gpsLongitude: formatGpsCoordinate(sample.longitude),
            gpsAccuracy: sample.accuracyM.toFixed(0),
          }))

          setGpsIngressMessage('Device location granted. Live samples will flow while GPS mode is active.')
          appendLocationFeedEntry(
            'Device location granted',
            'Live GPS samples can now update the walk while precise location stays enabled.',
            'live',
          )
        } catch {
          setWalkDetailsOpen(true)
          setGpsIngressMessage('Device location could not provide a sample.')
          appendLocationFeedEntry('Device location unavailable', 'Android did not return a usable GPS sample.', 'warning')
        }

        return
      }

      if (!('geolocation' in navigator)) {
        setWalkDetailsOpen(true)
        setGpsIngressMessage('Browser geolocation is unavailable in this browser.')
        appendLocationFeedEntry('Browser geolocation unavailable', 'This browser cannot provide location samples.', 'warning')
        return
      }

      setGpsIngressMessage('Requesting browser location access.')
      appendLocationFeedEntry('Location permission requested', 'The browser geolocation prompt is waiting for a response.')

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const sample = toBrowserGpsSample(position)

          setLocation((current) => ({
            ...current,
            permission: 'granted',
            gpsLatitude: formatGpsCoordinate(sample.latitude),
            gpsLongitude: formatGpsCoordinate(sample.longitude),
            gpsAccuracy: sample.accuracyM.toFixed(0),
          }))

          setGpsIngressMessage('Browser location granted. Live samples will flow while GPS mode is active.')
          appendLocationFeedEntry(
            'Browser location granted',
            'Live GPS samples can now update the walk while precise location stays enabled.',
            'live',
          )
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setLocation((current) => ({
              ...current,
              permission: 'denied',
            }))
            setWalkDetailsOpen(true)
            setGpsIngressMessage('Browser geolocation permission was denied.')
            appendLocationFeedEntry(
              'Browser location denied',
              'The browser blocked geolocation, so the live feed cannot start.',
              'warning',
            )
            return
          }

          setGpsIngressMessage('Browser geolocation could not provide a sample.')
          appendLocationFeedEntry('Browser location unavailable', 'The browser did not return a usable sample.', 'warning')
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000,
        },
      )
    },
    [appendLocationFeedEntry, location.mode, location.permission, privacy.preciseLocation],
  )

  function openMemoryForm(placeId?: string) {
    const place = placeId ? city?.places.find((candidate) => candidate.id === placeId) : null

    setActiveMemoryId(null)
    setMemoryOriginTab(activeTab)
    setMemoryContextPlaceId(placeId)
    setMemoryRouteCell(placeId ? undefined : visibleCurrentCell)
    setMemoryTitle(place ? place.name : '')
    setMemoryText(place ? place.discoveryContext : '')
    setMemoryTag(placeId ? 'place' : 'walk')
    setMemoryVisibility(privacy.privateByDefault ? 'Private' : 'Recap allowed')
    setMemoryHasPhoto(false)
    setMemoryShareCopied(false)
    setMemoryOpen(true)
    if (placeId) {
      markDiscoveryReviewed(placeId)
    }
  }

  function openMemoryDetail(memoryId: string) {
    const memory = memories.find((candidate) => candidate.id === memoryId)

    if (!memory) {
      return
    }

    setActiveMemoryId(memory.id)
    setMemoryOriginTab(activeTab)
    setMemoryContextPlaceId(memory.placeId)
    setMemoryRouteCell(memory.routeCell)
    setMemoryTitle(memory.title)
    setMemoryText(memory.text)
    setMemoryTag(memory.tag)
    setMemoryVisibility(memory.visibility)
    setMemoryHasPhoto(memory.hasPhoto)
    setMemoryShareCopied(false)
    setMemoryOpen(true)
  }

  function saveMemory() {
    const title = memoryTitle.trim()
    const text = memoryText.trim()

    if (!title || !text) {
      return
    }

    const nextMemory: Memory = {
      id: activeMemory?.id ?? `memory-${Date.now()}`,
      title,
      text,
      tag: memoryTag.trim() || 'walk',
      visibility: memoryVisibility,
      placeId: memoryContextPlaceId,
      routeCell: memoryContextPlaceId ? undefined : memoryRouteCell ?? visibleCurrentCell,
      hasPhoto: memoryHasPhoto,
      createdAt: activeMemory?.createdAt ?? 'Today',
    }

    setMemories((current) =>
      activeMemory ? current.map((memory) => (memory.id === activeMemory.id ? nextMemory : memory)) : [nextMemory, ...current],
    )
    setMemoryOpen(false)
    setActiveMemoryId(null)
    setActiveTab(memoryOriginTab)
    setMemoryContextPlaceId(undefined)
    setMemoryRouteCell(undefined)
    setMemoryShareCopied(false)
  }

  async function shareMemory() {
    if (!activeMemory || !city) {
      return
    }

    const shareText = buildMemoryShareText(activeMemory, city, city.places)
    const shareStatus = await shareTextWithFallback(`${city.name}: ${activeMemory.title}`, shareText)

    setMemoryShareCopied(shareStatus === 'copied')
  }

  function deleteMemory() {
    if (!activeMemory) {
      return
    }

    setMemories((current) => current.filter((memory) => memory.id !== activeMemory.id))
    setMemoryOpen(false)
    setActiveMemoryId(null)
    setActiveTab(memoryOriginTab)
    setMemoryContextPlaceId(undefined)
    setMemoryRouteCell(undefined)
    setMemoryShareCopied(false)
  }

  function toggleSavedPlace(placeId: string) {
    setSavedPlaceIds((current) => {
      const nextSaved = new Set(current)

      if (nextSaved.has(placeId)) {
        nextSaved.delete(placeId)
      } else {
        nextSaved.add(placeId)
      }

      return nextSaved
    })
  }

  function togglePrivacy(key: keyof PrivacySettings) {
    const nextPrivacy = {
      ...privacy,
      [key]: !privacy[key],
    }

    setPrivacy(nextPrivacy)

    if (location.mode === 'gps' && (location.permission !== 'granted' || !nextPrivacy.preciseLocation)) {
      setWalkDetailsOpen(true)
    }
  }

  function changeLocationMode(nextMode: LocationMode) {
    setLocation((current) => {
      if (current.mode === nextMode) {
        return current
      }

      return {
        ...current,
        mode: nextMode,
      }
    })

    if (nextMode === 'gps') {
      if (location.permission !== 'granted' || !privacy.preciseLocation) {
        setWalkDetailsOpen(true)
      }

      setGpsIngressMessage(
        privacy.preciseLocation
          ? 'GPS mode enabled. Request device location to start live samples.'
          : 'GPS mode enabled. Turn on precise location in Privacy before requesting device geolocation.',
      )
      appendLocationFeedEntry('GPS mode enabled', 'The device geolocation lane is staged and ready for permission.')
      return
    }

    setWalkDetailsOpen(false)
    setGpsIngressMessage('Waiting for the next sample.')
    appendLocationFeedEntry('Simulated mode enabled', 'The walk will continue with the prototype route samples.', 'info')
  }

  if (!city) {
    return (
      <main className="app city-picker">
        <section className="selection-panel" aria-labelledby="cityprint-title">
          <div className="brand-row">
            <div className="brand-mark">
              <MapIcon size={23} strokeWidth={2.4} />
            </div>
            <span>Cityprint</span>
          </div>

          <div className="selection-copy">
            <h1 id="cityprint-title">Choose a city</h1>
            <p>Reveal the map by walking. Places stay hidden until the area is discovered.</p>
          </div>

          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Search cities"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search cities"
            />
          </label>

          <div className="city-list">
            {filteredCities.map((candidate) => (
              <button className="city-card" key={candidate.id} type="button" onClick={() => openCity(candidate)}>
                <span>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.country}</small>
                </span>
                <span className="city-status">
                  {candidate.status}
                  <b>{candidate.savedProgress}%</b>
                </span>
              </button>
            ))}
          </div>

          <button className="primary-action" type="button" onClick={() => openCity(cities[0])}>
            <Navigation size={18} />
            Use current city
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="app">
      <section className="phone-shell" aria-label="Cityprint prototype">
        <header className="app-header">
          <button className="icon-button" type="button" onClick={() => setSelectedCityId(null)} aria-label="Change city">
            <MapIcon size={20} />
          </button>
          <div>
            <strong>{city.name}</strong>
            <span>{progress}% revealed</span>
          </div>
          <button className="icon-button" type="button" onClick={() => setActiveTab('Privacy')} aria-label="Privacy settings">
            <Shield size={20} />
          </button>
        </header>

        <div className="tab-content">
          {activeTab === 'Atlas' && (
          <AtlasView
            city={city}
            discoveryPlaces={discoveryPlaces}
            discoverySummary={discoverySummary}
            reviewedDiscoveryIds={reviewedDiscoveryIds}
            discoveryPanelOpen={discoveryPanelOpen}
            recapPreview={recapPreview}
            distanceWalked={distanceWalked}
            progress={progress}
            recentCells={recentCells}
            revealedCells={revealedCells}
            routePath={routePath}
            routeFragments={routeFragments}
            routeTraceCopy={routeTraceCopy}
            visibleMemoryMarkers={visibleMemoryMarkers}
            visiblePlaces={visiblePlaces}
            walkSession={walkSession}
            currentCell={visibleCurrentCell}
            locationMode={location.mode}
            gpsAccuracy={location.gpsAccuracy}
            gpsIngressMessage={gpsIngressMessage}
            gpsLatitude={location.gpsLatitude}
            gpsLongitude={location.gpsLongitude}
            gpsPermission={location.permission}
            locationFeed={locationFeed}
            locationPipeline={locationPipeline}
            locationFeedLog={locationFeedLog}
            privacy={privacy}
            sampleIntervalMs={locationFeedProvider.intervalMs}
            onCloseDiscovery={closeDiscovery}
            onOpenMemory={openMemoryForm}
            onOpenMemoryDetail={openMemoryDetail}
            onPause={pauseWalk}
            onBackground={backgroundWalk}
            onContinueExploring={continueExploring}
            onPlaceOpen={openPlaceDetail}
            onResume={resumeWalk}
            onStartWalk={startWalk}
            onOpenPrivacy={() => setActiveTab('Privacy')}
            onLocationModeChange={changeLocationMode}
            onRequestBrowserLocation={requestBrowserLocation}
            onCreateRecap={createRecap}
            walkDetailsOpen={walkDetailsOpen}
            onToggleWalkDetails={() => setWalkDetailsOpen((current) => !current)}
          />
          )}

          {activeTab === 'Discovery' && (
            <DiscoveryView
              city={city}
              discoveryPlaces={discoveryPlaces}
              discoverySummary={discoverySummary}
              latestRevealDigest={latestRevealDigest}
              recapPreview={recapPreview}
              recapReady={Boolean(generatedRecap)}
              recapShareStatus={recapShareStatus}
              routeFragments={routeFragments}
              reviewedDiscoveryIds={reviewedDiscoveryIds}
              walkSession={walkSession}
              onCloseDiscovery={closeDiscovery}
              onContinueExploring={continueExploring}
              onCreateRecap={createRecap}
              onShareRecap={shareRecap}
              onOpenMemory={openMemoryForm}
              onPlaceOpen={openPlaceDetail}
            />
          )}

          {activeTab === 'Memories' && (
            <MemoriesView
              memorySurface={memorySurface}
              memoryFilter={memoryFilter}
              memorySearch={memorySearch}
              memories={filteredMemories}
              places={city.places}
              savedPlaces={savedPlaces}
              savedPlaceFilter={savedPlaceFilter}
              savedPlaceSearch={savedPlaceSearch}
              visiblePlaceIds={visiblePlaceIds}
              onMemorySurfaceChange={setMemorySurface}
              onFilterChange={setMemoryFilter}
              onMemorySearchChange={setMemorySearch}
              onSavedPlaceFilterChange={setSavedPlaceFilter}
              onSavedPlaceSearchChange={setSavedPlaceSearch}
              onOpenMemory={openMemoryForm}
              onOpenMemoryDetail={openMemoryDetail}
              onOpenPlace={openPlaceDetail}
              onToggleSaved={toggleSavedPlace}
            />
          )}

          {activeTab === 'Stats' && (
            <StatsView
              city={city}
              distanceWalked={distanceWalked}
              discoveryPlaces={discoveryPlaces}
              discoverySummary={discoverySummary}
              latestRevealDigest={latestRevealDigest}
              reviewedDiscoveryIds={reviewedDiscoveryIds}
              recap={generatedRecap}
              recapPreview={recapPreview}
              recapCopied={recapCopied}
              recapDownloaded={recapDownloaded}
              recapShareStatus={recapShareStatus}
              memories={memories}
              progress={progress}
              revealedCells={revealedCells}
              visiblePlaces={visiblePlaces}
              onOpenDiscovery={() => setActiveTab('Discovery')}
              onCreateRecap={createRecap}
              onCopyRecap={copyRecap}
              onDownloadRecap={downloadRecap}
              onShareRecap={shareRecap}
              onReturnToAtlas={() => setActiveTab('Atlas')}
              privacyRules={privacyRules}
              locationPipeline={locationPipeline}
              locationFeedLog={locationFeedLog}
            />
          )}

          {activeTab === 'Privacy' && (
            <PrivacyView
              hasLocalProgress={hasLocalProgress(snapshotForStorage)}
              localProgressSummary={localProgressSummary}
              locationMode={location.mode}
              locationPipeline={locationPipeline}
              privacy={privacy}
              onRequestBrowserLocation={requestBrowserLocation}
              onExportPreview={openExportPreview}
              onResetRequest={() => setResetConfirmOpen(true)}
              onToggle={togglePrivacy}
            />
          )}
        </div>

        {activePlace && (
          <PlaceDetail
            city={city}
            memories={activePlaceMemories}
            place={activePlace}
            detailRef={activePlaceDetailRef}
            saved={savedPlaceIds.has(activePlace.id)}
            onClose={() => setActivePlaceId(null)}
            onMemory={() => openMemoryForm(activePlace.id)}
            onOpenMemoryDetail={openMemoryDetail}
            onReturnToDiscoveries={discoveryPlaces.length > 0 ? () => setActivePlaceId(null) : undefined}
            onToggleSaved={() => toggleSavedPlace(activePlace.id)}
          />
        )}

        <nav className="bottom-tabs" aria-label="Main navigation">
          <TabButton active={activeTab === 'Atlas'} icon={MapIcon} label="Atlas" onClick={() => setActiveTab('Atlas')} />
          <TabButton active={activeTab === 'Discovery'} icon={Sparkles} label="Discovery" onClick={() => setActiveTab('Discovery')} />
          <TabButton active={activeTab === 'Memories'} icon={BookOpen} label="Memories" onClick={() => setActiveTab('Memories')} />
          <TabButton
            active={activeTab === 'Stats'}
            icon={ChartNoAxesColumnIncreasing}
            label="Stats"
            onClick={() => setActiveTab('Stats')}
          />
          <TabButton active={activeTab === 'Privacy'} icon={Shield} label="Privacy" onClick={() => setActiveTab('Privacy')} />
        </nav>
      </section>

      {memoryOpen && (
        <MemoryModal
          hasPhoto={memoryHasPhoto}
          isEditing={Boolean(activeMemory)}
          memoryContext={memoryContextLabel}
          originTab={memoryOriginTab}
          shareCopied={memoryShareCopied}
          shareText={activeMemory && city ? buildMemoryShareText(activeMemory, city, city.places) : ''}
          places={city.places}
          selectedPlaceId={memoryContextPlaceId}
          tag={memoryTag}
          text={memoryText}
          title={memoryTitle}
          visibility={memoryVisibility}
          onClose={() => {
            setMemoryOpen(false)
            setActiveMemoryId(null)
            setActiveTab(memoryOriginTab)
            setMemoryShareCopied(false)
          }}
          onDelete={deleteMemory}
          onPhotoToggle={() => setMemoryHasPhoto((current) => !current)}
          onShare={shareMemory}
          onSave={saveMemory}
          onTagChange={setMemoryTag}
          onTextChange={setMemoryText}
          onTitleChange={setMemoryTitle}
          onVisibilityChange={setMemoryVisibility}
        />
      )}

      {exportPreviewOpen && (
        <ExportPreviewModal
          copied={exportCopied}
          downloaded={exportDownloaded}
          preview={snapshotToPrettyJson(snapshotForStorage)}
          onDownload={downloadExportPreview}
          onClose={() => {
            setExportPreviewOpen(false)
            setExportCopied(false)
            setExportDownloaded(false)
          }}
          onCopy={copyExportPreview}
        />
      )}

      {resetConfirmOpen && (
        <ConfirmResetModal
          onCancel={() => setResetConfirmOpen(false)}
          onConfirm={resetLocalData}
          summary={localProgressSummary}
        />
      )}
    </main>
  )
}

type AtlasProps = {
  city: City
  currentCell?: string
  discoveryPlaces: Place[]
  discoverySummary: { revealedCellCount: number; routeLabel: string } | null
  reviewedDiscoveryIds: string[]
  recapPreview: CityRecap | null
  distanceWalked: string
  gpsAccuracy: string
  gpsIngressMessage: string
  gpsLatitude: string
  gpsLongitude: string
  gpsPermission: LocationSettings['permission']
  locationFeed: LocationFeedState
  locationFeedLog: LocationFeedEntry[]
  locationPipeline: LocationPipelineSummary
  privacy: PrivacySettings
  progress: number
  sampleIntervalMs: number
  locationMode: LocationMode
  recentCells: Set<string>
  revealedCells: Set<string>
  routePath?: string
  routeFragments: string[]
  routeTraceCopy: string
  visibleMemoryMarkers: { memory: Memory; left: number; top: number; kind: 'place' | 'route' }[]
  visiblePlaces: Place[]
  walkSession: WalkSession
  onCloseDiscovery: () => void
  onBackground: () => void
  onContinueExploring: () => void
  onOpenMemory: (placeId?: string) => void
  onOpenMemoryDetail: (memoryId: string) => void
  onOpenPrivacy: () => void
  onPause: () => void
  onLocationModeChange: (value: LocationMode) => void
  onPlaceOpen: (placeId: string) => void
  onResume: () => void
  onStartWalk: () => void
  onRequestBrowserLocation: (activateGpsMode?: boolean) => void
  onCreateRecap: () => void
  walkDetailsOpen: boolean
  onToggleWalkDetails: () => void
  discoveryPanelOpen: boolean
}

function AtlasView({
  city,
  currentCell,
  discoveryPlaces,
  discoverySummary,
  reviewedDiscoveryIds,
  recapPreview,
  distanceWalked,
  gpsAccuracy,
  gpsIngressMessage,
  gpsLatitude,
  gpsLongitude,
  gpsPermission,
  locationFeed,
  locationFeedLog,
  locationPipeline,
  privacy,
  progress,
  sampleIntervalMs,
  locationMode,
  recentCells,
  revealedCells,
  routePath,
  routeFragments,
  routeTraceCopy,
  visibleMemoryMarkers,
  visiblePlaces,
  walkSession,
  onCloseDiscovery,
  onBackground,
  onContinueExploring,
  onOpenMemory,
  onOpenMemoryDetail,
  onOpenPrivacy,
  onPause,
  onLocationModeChange,
  onPlaceOpen,
  onResume,
  onStartWalk,
  onRequestBrowserLocation,
  onCreateRecap,
  walkDetailsOpen,
  onToggleWalkDetails,
  discoveryPanelOpen,
}: AtlasProps) {
  const walkCopy = describeWalkSession(walkSession, city.walkRoute.length, walkSession.acceptedSampleCount ?? 0)
  const {
    featuredDiscoveryPlace,
    secondaryDiscoveryPlaces,
    reviewedDiscoveryPlaces,
    pendingDiscoveryPlaces,
  } = getDiscoveryReviewState(discoveryPlaces, reviewedDiscoveryIds)
  const hasDiscoveryReview = discoveryPlaces.length > 0
  const feedTitle = locationMode === 'gps' ? 'Live device GPS' : 'Simulated walk feed'
  const gpsReadoutsHidden = locationMode === 'gps' && !privacy.preciseLocation
  const hiddenGpsValue = 'Hidden by privacy'
  const routeProgress = city.walkRoute.length <= 1 ? 100 : Math.round((walkSession.routeIndex / (city.walkRoute.length - 1)) * 100)
  const routeStep = Math.min(walkSession.routeIndex + 1, city.walkRoute.length)
  const nextRouteCell = city.walkRoute[Math.min(walkSession.routeIndex + 1, city.walkRoute.length - 1)] ?? null
  const routeRemaining = Math.max(city.walkRoute.length - Math.min(walkSession.routeIndex + 1, city.walkRoute.length), 0)
  const discoveryRouteFragments = routeFragments.slice(0, 3)
  const recapPreviewPlaces = recapPreview?.shareablePlaces.slice(0, 3) ?? []
  const recapPreviewMemories = recapPreview?.shareableMemories.slice(0, 2) ?? []
  const recapPreviewFragments = recapPreview?.routeFragments.slice(0, 4) ?? []
  const recapPreviewDigest = recapPreview?.latestReveal ?? null
  const sampleCadenceLabel =
    locationMode === 'simulated'
      ? `${Math.max(1, Math.round(sampleIntervalMs / 1000))} s cadence`
      : locationFeed.status === 'running'
        ? 'Live GPS cadence'
        : locationFeed.status === 'background'
          ? 'Background cadence'
          : 'Waiting for samples'
  const latestFeedEntry = locationFeedLog[0] ?? null
  const latestFeedTitle = latestFeedEntry
    ? latestFeedEntry.title
    : hasDiscoveryReview
      ? 'Discovery ready'
      : walkSession.status === 'running'
        ? 'Walk is moving'
        : 'Walk is idle'
  const latestFeedDetail =
    latestFeedEntry?.detail ??
    (locationMode === 'gps'
      ? locationPipeline.nextAction
      : walkSession.status === 'running'
        ? `Simulated samples are advancing the route on a ${Math.max(1, Math.round(sampleIntervalMs / 1000))} second cadence.`
        : 'Start the walk to begin revealing nearby cells.')
  const routeRhythmDetail =
    hasDiscoveryReview
      ? 'New places are ready to inspect. The batch stays visible in Atlas and Discovery until the next reveal.'
      : walkSession.status === 'running'
        ? locationMode === 'gps'
          ? 'Device geolocation samples will keep arriving while the walk stays active. Accepted points advance the current cell and can reveal nearby places.'
          : `Simulated samples keep the route moving every ${Math.max(1, Math.round(sampleIntervalMs / 1000))} seconds.`
        : walkSession.status === 'background'
          ? 'Background capture stays ready until you return and resume the walk.'
          : 'Start the walk to begin the next reveal rhythm.'
  const walkAttention =
    locationMode === 'gps'
      ? !privacy.preciseLocation
        ? {
            tone: 'warning' as const,
            title: 'Precise location is off',
            detail: 'Open Privacy to allow device geolocation for the live walk.',
            actionLabel: 'Open Privacy',
            onAction: onOpenPrivacy,
          }
        : gpsPermission === 'denied'
          ? {
              tone: 'warning' as const,
              title: 'GPS permission is blocked',
              detail: 'Retry device location after allowing access in system settings.',
              actionLabel: 'Retry location',
              onAction: () => onRequestBrowserLocation(),
            }
          : gpsPermission === 'not-requested'
            ? {
                tone: 'info' as const,
                title: 'GPS is ready to start',
                detail: 'Request device location to begin live samples.',
                actionLabel: 'Request location',
                onAction: () => onRequestBrowserLocation(),
              }
            : null
      : null
  const locationRecoveryLabel =
    locationMode !== 'gps'
      ? 'Switch to GPS'
      : !privacy.preciseLocation
        ? 'Open Privacy'
        : gpsPermission === 'granted'
          ? 'Refresh location'
          : gpsPermission === 'denied'
            ? 'Retry permission'
            : 'Request location'
  const gpsPrompt =
    locationMode === 'gps' && !privacy.preciseLocation
      ? locationPipeline.nextAction
      : walkSession.status === 'running' || walkSession.status === 'background'
        ? gpsIngressMessage
        : locationPipeline.nextAction
  const walkSummaryTitle = hasDiscoveryReview ? 'Discovery paused' : walkAttention?.title ?? walkCopy.title
  const walkSummaryDetail = hasDiscoveryReview
    ? 'Review the newly revealed places, save a memory, or continue exploring.'
    : walkAttention?.detail ?? walkCopy.detail
  const walkCellLabel = currentCell ?? (gpsReadoutsHidden ? hiddenGpsValue : 'Waiting for sample')
  const nextCellLabel = gpsReadoutsHidden ? hiddenGpsValue : nextRouteCell ?? (routeRemaining > 0 ? 'Waiting for next point' : 'Route complete')
  const recapPreviewSummary =
    recapPreview?.summary ??
    'Create a recap to preserve the current discovery as a private summary.'
  const recapActionLabel = recapPreviewDigest ? 'Refresh digest' : 'Review recap'

  return (
    <section className="screen atlas-screen">
      <div className="metric-strip">
        <Metric label="Revealed" value={`${progress}%`} />
        <Metric label="Places" value={`${visiblePlaces.length}/${city.places.length}`} />
        <Metric label="Walked" value={`${distanceWalked} km`} />
      </div>

      <div className="map-panel">
        <CityMap
          city={city}
          currentCell={currentCell}
          isWalking={walkSession.status === 'running'}
          recentCells={recentCells}
          revealedCells={revealedCells}
          routePath={routePath}
          memoryMarkers={visibleMemoryMarkers}
          visiblePlaces={visiblePlaces}
          onPlaceOpen={onPlaceOpen}
          onMemoryOpen={onOpenMemoryDetail}
        />
      </div>

      <div className="walk-panel">
        <div className="session-summary">
          <div className="session-copy">
            <span className="eyebrow">Walk session</span>
            <strong>{walkSummaryTitle}</strong>
            <span>{walkSummaryDetail}</span>
          </div>
          <div className="session-progress" aria-label="Walk rhythm">
            <div className="session-progress-head">
              <span className="eyebrow">Route rhythm</span>
              <strong>{routeProgress}% traced</strong>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${routeProgress}%` }} />
            </div>
            <small>{routeRemaining > 0 ? `${routeRemaining} step${routeRemaining === 1 ? '' : 's'} remaining before the route settles.` : 'The route has reached the end of the current walk.'}</small>
            <p>{routeRhythmDetail}</p>
          </div>
          <div className={`session-signal ${latestFeedEntry?.tone ?? 'info'}`}>
            <span className="eyebrow">Latest signal</span>
            <strong>{latestFeedTitle}</strong>
            <span>{latestFeedDetail}</span>
          </div>
          <div className={`session-signal ${hasDiscoveryReview ? 'live' : 'info'}`}>
            <span className="eyebrow">{hasDiscoveryReview ? 'Discovery handoff' : 'Current position'}</span>
            <strong>{hasDiscoveryReview ? 'Review the revealed places' : walkCellLabel}</strong>
            <span>
              {hasDiscoveryReview
                ? pendingDiscoveryPlaces.length > 0
                  ? 'Open the next place, save a memory, or create the recap before you continue exploring.'
                  : 'All newly revealed places are reviewed. Save a memory or continue exploring when you are ready.'
                : `${routeStep}/${city.walkRoute.length} on the route. Next stop: ${nextCellLabel}.`}
            </span>
          </div>
          {recapPreviewDigest && (
            <div className="session-signal recap-digest">
              <span className="eyebrow">Session review digest</span>
              <strong>
                {recapPreviewDigest.placeCount} place{recapPreviewDigest.placeCount === 1 ? '' : 's'} around {recapPreviewDigest.routeLabel}
              </strong>
              <span>
                {recapPreviewDigest.revealedCellCount} cells opened. {recapPreviewDigest.reviewedCount} reviewed, {recapPreviewDigest.pendingCount} open.
              </span>
            </div>
          )}
          <div className="session-metrics" aria-label="Walk summary metrics">
            <Metric label="Current cell" value={walkCellLabel} />
            <Metric label="Next stop" value={nextCellLabel} />
            <Metric label="Cadence" value={sampleCadenceLabel} />
            <Metric label="Samples" value={(walkSession.acceptedSampleCount ?? 0).toString()} />
          </div>
          <div className="session-pills" aria-label="Session status">
            <span className={`state-pill ${walkSession.status}`}>{walkCopy.routeLabel}</span>
            <span className={`state-pill ${locationFeed.status}`}>{locationPipeline.statusLabel}</span>
            <span className={`state-pill ${locationMode}`}>{locationMode === 'gps' ? 'GPS' : 'Simulated'}</span>
            <span className={`state-pill ${locationMode === 'gps' ? 'gps-route' : 'route'}`}>{routeTraceCopy}</span>
          </div>
        </div>
        <div className="walk-actions">
          <div className="mode-toggle" role="group" aria-label="Location source">
            <button className={locationMode === 'simulated' ? 'mode-pill active' : 'mode-pill'} type="button" onClick={() => onLocationModeChange('simulated')}>
              Simulated
            </button>
            <button className={locationMode === 'gps' ? 'mode-pill active' : 'mode-pill'} type="button" onClick={() => onLocationModeChange('gps')}>
              GPS sample
            </button>
          </div>
          <button className="secondary-action" type="button" onClick={() => onOpenMemory()}>
            <Plus size={17} />
            Drop memory
          </button>
          <button className="secondary-action compact" type="button" onClick={onToggleWalkDetails}>
            <SlidersHorizontal size={17} />
            {walkDetailsOpen ? 'Hide details' : 'Show details'}
          </button>
          {walkSession.status === 'running' ? (
            <>
              <button className="secondary-action compact" type="button" onClick={onBackground}>
                <EyeOff size={17} />
                Background
              </button>
              <button className="primary-action compact" type="button" onClick={onPause}>
                <Pause size={17} />
                Pause
              </button>
            </>
          ) : walkSession.status === 'background' ? (
            <>
              <button className="secondary-action compact" type="button" onClick={onResume}>
                <Play size={17} />
                Resume
              </button>
              <button className="primary-action compact" type="button" onClick={onPause}>
                <Pause size={17} />
                Pause
              </button>
            </>
          ) : (
            <button className="primary-action compact" type="button" onClick={onStartWalk}>
              <Play size={17} />
              Start
            </button>
          )}
        </div>
        <div className={`walk-details ${locationFeed.status} ${walkDetailsOpen ? 'open' : 'closed'}`}>
          <div className="walk-details-head">
            <div className="location-panel-copy">
              <span className="eyebrow">Location pipeline</span>
              <strong>{locationPipeline.title}</strong>
              <span>{locationPipeline.detail}</span>
            </div>
            {walkAttention && (
              <div className={`walk-alert ${walkAttention.tone}`}>
                <div className="walk-alert-copy">
                  <strong>{walkAttention.title}</strong>
                  <span>{walkAttention.detail}</span>
                </div>
                <button className="secondary-action compact" type="button" onClick={walkAttention.onAction}>
                  {walkAttention.actionLabel}
                </button>
              </div>
            )}
            <div className="pipeline-pills" aria-label="Pipeline status">
              <span className={`state-pill ${locationFeed.status}`}>{locationPipeline.statusLabel}</span>
              <span className={`state-pill ${locationMode}`}>{locationPipeline.modeLabel}</span>
              <span className={`state-pill ${gpsPermission}`}>{locationPipeline.permissionLabel}</span>
              <span className="state-pill">{locationPipeline.sampleLabel}</span>
            </div>
            <p className="pipeline-hint">{gpsPrompt}</p>
          </div>
          <div className="location-panel-actions">
            <button className="secondary-action compact" type="button" onClick={() => onRequestBrowserLocation(locationMode !== 'gps')}>
              {locationRecoveryLabel}
            </button>
            {locationMode === 'gps' && !privacy.preciseLocation ? (
              <button className="secondary-action compact" type="button" onClick={onOpenPrivacy}>
                Privacy
              </button>
            ) : null}
          </div>
          {walkDetailsOpen && (
            <div className="walk-details-body">
              <div className="location-panel-readouts">
                {locationMode === 'gps' ? (
                  <>
                    <div className="gps-readout">
                      <span>Latitude</span>
                      <strong>{gpsReadoutsHidden ? hiddenGpsValue : gpsLatitude}</strong>
                    </div>
                    <div className="gps-readout">
                      <span>Longitude</span>
                      <strong>{gpsReadoutsHidden ? hiddenGpsValue : gpsLongitude}</strong>
                    </div>
                    <div className="gps-readout">
                      <span>Accuracy m</span>
                      <strong>{gpsReadoutsHidden ? hiddenGpsValue : gpsAccuracy}</strong>
                    </div>
                    <div className="gps-readout">
                      <span>Current cell</span>
                      <strong>{gpsReadoutsHidden ? hiddenGpsValue : currentCell ?? 'No sample yet'}</strong>
                    </div>
                  </>
                ) : (
                  <div className="location-panel-placeholder">
                    <span>GPS readouts stay collapsed while simulated samples drive the walk.</span>
                    <strong>Switch to GPS when you want device location to feed the route.</strong>
                  </div>
                )}
              </div>
              <div className={`gps-panel ${locationMode === 'gps' ? '' : 'inactive'}`}>
                <div className="gps-panel-header">
                  <div>
                    <strong>{feedTitle}</strong>
                    <span>
                      {gpsPermission === 'granted'
                        ? 'Location access granted'
                        : gpsPermission === 'denied'
                          ? 'Location access denied'
                          : 'Location access not requested'}
                    </span>
                  </div>
                  <small>{locationMode === 'gps' ? 'Live feed updates stay here while the walk is running.' : 'Simulated mode keeps the live device lane staged in the background.'}</small>
                </div>
                <div className="location-feed-log">
                  <span className="eyebrow">Recent feed</span>
                  <div className="location-feed-list" aria-label="Location feed history">
                    {locationFeedLog.map((entry) => (
                      <article className={`location-feed-entry ${entry.tone}`} key={entry.id}>
                        <strong>{entry.title}</strong>
                        <span>{entry.detail}</span>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {discoveryPanelOpen && discoveryPlaces.length > 0 && (
        <section className="discovery-panel" aria-label="Newly discovered places">
          <button className="close-button" type="button" aria-label="Back to Atlas" onClick={onCloseDiscovery}>
            <X size={18} />
          </button>
          <div className="discovery-header">
            <span className="eyebrow">
              <Sparkles size={15} />
              Newly discovered
            </span>
            <strong>{discoveryPlaces.length} new place{discoveryPlaces.length === 1 ? '' : 's'}</strong>
            <p className="discovery-summary">
              {discoverySummary?.revealedCellCount ?? recentCells.size} cells revealed around {currentCell ?? 'the current route'}.
              The walk is paused so you can inspect the result before continuing.
            </p>
          </div>
          <div className="discovery-route-card">
            <div className="discovery-route-copy">
              <span className="eyebrow">Recap trail</span>
              <strong>{discoveryRouteFragments.length > 0 ? `${discoveryRouteFragments.length} route fragments ready` : 'Route trail still forming'}</strong>
              <span>
                {discoveryRouteFragments.length > 0
                  ? 'The recap keeps the walked path generalized and private by default.'
                  : 'Keep walking to build a privacy-safe trail for the recap.'}
              </span>
            </div>
            <div className="recap-chips discovery-route-chips" aria-label="Route fragments">
              {discoveryRouteFragments.length > 0 ? (
                discoveryRouteFragments.map((fragment) => <span key={fragment}>{fragment}</span>)
              ) : (
                <span>More movement needed</span>
              )}
            </div>
          </div>
          <div className="discovery-review-card" aria-label="Discovery review progress">
            <div className="discovery-review-copy">
              <span className="eyebrow">Review progress</span>
              <strong>
                {reviewedDiscoveryPlaces.length}/{discoveryPlaces.length} inspected
              </strong>
              <span>
                {pendingDiscoveryPlaces.length > 0
                  ? `${pendingDiscoveryPlaces.length} place${pendingDiscoveryPlaces.length === 1 ? '' : 's'} still need a closer look.`
                  : 'All newly surfaced places have been inspected.'}
              </span>
            </div>
            <div className="discovery-review-pills" aria-label="Discovery review state">
              <span className="state-pill live">{reviewedDiscoveryPlaces.length} viewed</span>
              <span className="state-pill">{pendingDiscoveryPlaces.length} open</span>
            </div>
          </div>
          <div className="discovery-callout">
            <strong>Review new places before resuming</strong>
            <span>
              {pendingDiscoveryPlaces.length > 0
                ? `${pendingDiscoveryPlaces.length} place${pendingDiscoveryPlaces.length === 1 ? '' : 's'} are still waiting for inspection. The batch stays available in Atlas and Stats while you keep walking.`
                : 'You have already inspected the new places. The batch stays available in Atlas and Stats until the next reveal.'}
            </span>
          </div>
          {recapPreview && (
            <section className="discovery-recap-card" aria-label="Recap preview">
              <div className="discovery-recap-header">
                <span className="eyebrow">
                  <Sparkles size={15} />
                  Private recap preview
                </span>
                <strong>{recapPreview.title}</strong>
                <p>{recapPreviewSummary}</p>
              </div>
              <div className="discovery-recap-grid" aria-label="Recap highlights">
                <div className="discovery-recap-stat">
                  <span>Route fragments</span>
                  <strong>{recapPreviewFragments.length}</strong>
                  <small>
                    {recapPreviewFragments.length > 0 ? recapPreviewFragments.join(' - ') : 'Keep walking to build a safer trail.'}
                  </small>
                </div>
                <div className="discovery-recap-stat">
                  <span>Shareable places</span>
                  <strong>{recapPreviewPlaces.length}</strong>
                  <small>
                    {recapPreviewPlaces.length > 0 ? recapPreviewPlaces.map((place) => place.name).join(', ') : 'No shareable places yet.'}
                  </small>
                </div>
                <div className="discovery-recap-stat">
                  <span>Recap memories</span>
                  <strong>{recapPreviewMemories.length}</strong>
                  <small>
                    {recapPreviewMemories.length > 0
                      ? recapPreviewMemories.map((memory) => memory.title).join(', ')
                      : 'Mark a memory as recap allowed to include it.'}
                  </small>
                </div>
              </div>
              <div className="discovery-recap-note">
                <span>{recapPreview.privacyNotes[0]}</span>
              </div>
            </section>
          )}
          <div className="discovery-hero">
            {featuredDiscoveryPlace ? (
              <article className="discovery-featured-card">
                <div className="discovery-featured-copy">
                  <span className="eyebrow">Featured place</span>
                  <strong>{featuredDiscoveryPlace.name}</strong>
                  <p>{featuredDiscoveryPlace.discoveryContext}</p>
                </div>
                <div className="place-chip-row" aria-label="Discovery details">
                  <span>{categoryLabels[featuredDiscoveryPlace.category]}</span>
                  <span>{featuredDiscoveryPlace.district}</span>
                  <span>{discoverySummary?.routeLabel ?? walkCopy.routeLabel}</span>
                </div>
                <div className="discovery-featured-actions">
                  <button className="secondary-action compact" type="button" onClick={() => onPlaceOpen(featuredDiscoveryPlace.id)}>
                    Inspect place
                    <ArrowRight size={16} />
                  </button>
                  <button className="secondary-action compact" type="button" onClick={() => onOpenMemory(featuredDiscoveryPlace.id)}>
                    <Plus size={16} />
                    Save memory
                  </button>
                  <button className="secondary-action compact" type="button" onClick={onCreateRecap}>
                    <Sparkles size={16} />
                    {recapActionLabel}
                  </button>
                </div>
              </article>
            ) : null}
            <div className="discovery-metrics" aria-label="Discovery summary">
              <div>
                <span>Revealed area</span>
                <strong>{discoverySummary?.revealedCellCount ?? recentCells.size} cells</strong>
              </div>
              <div>
                <span>Places found</span>
                <strong>{discoveryPlaces.length}</strong>
              </div>
              <div>
                <span>Route position</span>
                <strong>{discoverySummary?.routeLabel ?? walkCopy.routeLabel}</strong>
              </div>
            </div>
          </div>
          {secondaryDiscoveryPlaces.length > 0 && (
            <div className="discovery-list">
              {secondaryDiscoveryPlaces.map((place) => (
                <article className="discovery-place-card" key={place.id}>
                  <button className="discovery-place-open" type="button" onClick={() => onPlaceOpen(place.id)}>
                    <span className="discovery-place-name">{place.name}</span>
                    <small>
                      {categoryLabels[place.category]} - {place.district}
                    </small>
                  </button>
                  <div className="discovery-place-actions">
                    <button className="secondary-action compact" type="button" onClick={() => onPlaceOpen(place.id)}>
                      Open
                    </button>
                    <button className="secondary-action compact" type="button" onClick={() => onOpenMemory(place.id)}>
                      Memory
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="sheet-actions discovery-actions">
            <button className="secondary-action" type="button" onClick={() => onOpenMemory(discoveryPlaces[0]?.id)}>
              <Save size={17} />
              Save memory
            </button>
            <button className="primary-action compact" type="button" onClick={onContinueExploring}>
              <Play size={17} />
              Continue exploring
            </button>
          </div>
        </section>
      )}

    </section>
  )
}

type CityMapProps = {
  city: City
  currentCell?: string
  isWalking: boolean
  memoryMarkers: { memory: Memory; left: number; top: number; kind: 'place' | 'route' }[]
  recentCells: Set<string>
  revealedCells: Set<string>
  routePath?: string
  visiblePlaces: Place[]
  onPlaceOpen: (placeId: string) => void
  onMemoryOpen: (memoryId: string) => void
}

function CityMap({
  city,
  currentCell,
  isWalking,
  memoryMarkers,
  recentCells,
  revealedCells,
  routePath,
  visiblePlaces,
  onPlaceOpen,
  onMemoryOpen,
}: CityMapProps) {
  const currentMapCell = mapCells.find((cell) => cell.id === currentCell)

  return (
    <div className="city-map" role="img" aria-label="Partially hidden city map">
      <svg viewBox="0 0 700 800" aria-hidden="true">
        <rect className="map-base" x="0" y="0" width="700" height="800" rx="24" />
        {city.map.water.map((path, index) => (
          <path className="water" d={path} key={`water-${index}`} />
        ))}
        {city.map.parks.map((path, index) => (
          <path className={index === 0 ? 'park-shape' : 'park-shape secondary'} d={path} key={`park-${index}`} />
        ))}
        {city.map.regions.map((region) => (
          <path className={`district-shape district-${region.id}`} d={region.d} key={region.id} />
        ))}
        {mapCells.map((cell) => {
          const state = classifyFogCell(cell.id, revealedCells, recentCells)

          if (state === 'hidden') {
            return null
          }

          return (
            <path
              className={`city-block block-${(cell.x + cell.y) % 4} ${state}`}
              d={getCellPolygon(cell)}
              key={`block-${cell.id}`}
            />
          )
        })}
        {city.map.streetsMajor.map((path, index) => (
          <path className="street major" d={path} key={`street-major-${index}`} />
        ))}
        {city.map.streetsMinor.map((path, index) => (
          <path className="street minor" d={path} key={`street-minor-${index}`} />
        ))}
        {city.map.labels.map((label) => (
          <text className={`map-label ${label.tone ?? 'dark'}`} key={label.text} x={label.x} y={label.y}>
            {label.text}
          </text>
        ))}
        {routePath && routePath.length > 3 && <polyline className="route-line" points={routePath} />}
        {currentMapCell && (
          <circle
            className={isWalking ? 'current-location moving' : 'current-location'}
            cx={currentMapCell.left * 7}
            cy={currentMapCell.top * 8}
            r="12"
          />
        )}
        <rect className="fog-base" x="0" y="0" width="700" height="800" rx="24" />
        {mapCells.map((cell) => {
          const state = classifyFogCell(cell.id, revealedCells, recentCells)

          if (state === 'hidden') {
            return null
          }

          return <path className={`fog-cell ${state}`} key={`fog-${cell.id}`} d={getCellPolygon(cell)} />
        })}
      </svg>

      {visiblePlaces.map((place) => {
        const Icon = categoryIcons[place.category]

        return (
          <button
            className="map-marker"
            key={place.id}
            style={{ left: `${place.x}%`, top: `${place.y}%` }}
            type="button"
            onClick={() => onPlaceOpen(place.id)}
            aria-label={`Open ${place.name}`}
            title={place.name}
          >
            <Icon size={16} />
          </button>
        )
      })}
      {memoryMarkers.map((marker) => {
        const Icon = marker.memory.hasPhoto ? Camera : Heart

        return (
          <button
            className={`memory-marker ${marker.kind} ${marker.memory.visibility === 'Private' ? 'private' : 'recap'}`}
            key={marker.memory.id}
            style={{ left: `${marker.left}%`, top: `${marker.top}%` }}
            type="button"
            onClick={() => onMemoryOpen(marker.memory.id)}
            aria-label={`Open memory ${marker.memory.title}`}
            title={marker.memory.title}
          >
            <Icon size={12} />
          </button>
        )
      })}
    </div>
  )
}

type PlaceDetailProps = {
  city: City
  memories: Memory[]
  place: Place
  detailRef?: RefObject<HTMLElement | null>
  saved: boolean
  onClose: () => void
  onMemory: () => void
  onOpenMemoryDetail: (memoryId: string) => void
  onReturnToDiscoveries?: () => void
  onToggleSaved: () => void
}

function PlaceDetail({
  city,
  memories,
  place,
  detailRef,
  saved,
  onClose,
  onMemory,
  onOpenMemoryDetail,
  onReturnToDiscoveries,
  onToggleSaved,
}: PlaceDetailProps) {
  const Icon = categoryIcons[place.category]
  const navigationUrl = buildExternalNavigationUrl(city, place)

  async function openExternalNavigation() {
    await openExternalUrl(navigationUrl)
  }

  return (
    <section className="detail-sheet" aria-label={`${place.name} details`} ref={detailRef}>
      <button className="close-button" type="button" onClick={onClose} aria-label="Close place">
        <X size={18} />
      </button>
      <span className="eyebrow">
        <Sparkles size={15} />
        Discovered place
      </span>
      <div className="place-title">
        <div className="place-icon">
          <Icon size={18} />
        </div>
        <div>
          <h2>{place.name}</h2>
          <span>
            {categoryLabels[place.category]} - {place.district}
          </span>
        </div>
      </div>
      <div className="place-chip-row" aria-label="Place details">
        <span>{categoryLabels[place.category]}</span>
        <span>{place.district}</span>
        <span>{saved ? 'Saved' : 'Not saved'}</span>
      </div>
      <p>{place.description}</p>
      <div className="place-context">
        <span className="eyebrow">Discovery context</span>
        <small>{place.discoveryContext}</small>
      </div>
      <section className="place-memory-panel" aria-label="Place notes">
        <div className="section-heading">
          <strong>Place notes</strong>
          <small>{memories.length} linked</small>
        </div>
        {memories.length === 0 ? (
          <p className="empty-copy compact-empty">No memories linked yet. Save the first note for this place.</p>
        ) : (
          <div className="place-memory-list">
            {memories.map((memory) => (
              <button className="place-memory-card" key={memory.id} type="button" onClick={() => onOpenMemoryDetail(memory.id)}>
                <span className="eyebrow">
                  {memory.hasPhoto ? <Camera size={14} /> : <BookOpen size={14} />}
                  {memory.createdAt}
                </span>
                <strong>{memory.title}</strong>
                <p>{memory.text}</p>
                <footer>
                  <span>
                    <Tag size={14} />
                    {memory.tag}
                  </span>
                  <span>
                    <Shield size={14} />
                    {memory.visibility}
                  </span>
                </footer>
              </button>
            ))}
          </div>
        )}
      </section>
      <div className="sheet-actions">
        <button className="secondary-action" type="button" onClick={onToggleSaved}>
          <Heart size={17} fill={saved ? 'currentColor' : 'none'} />
          {saved ? 'Saved' : 'Save'}
        </button>
        <button className="primary-action compact" type="button" onClick={onMemory}>
          <Plus size={17} />
          Save place memory
        </button>
        {onReturnToDiscoveries ? (
          <button className="secondary-action compact" type="button" onClick={onReturnToDiscoveries}>
            <ArrowRight size={17} />
            Back to discoveries
          </button>
        ) : null}
        <button className="secondary-action" type="button" onClick={openExternalNavigation}>
          <Navigation size={17} />
          Open maps
        </button>
      </div>
    </section>
  )
}

type MemoriesProps = {
  memorySurface: MemorySurface
  memoryFilter: string
  memorySearch: string
  memories: Memory[]
  places: Place[]
  savedPlaces: Place[]
  savedPlaceFilter: 'All' | 'Visible' | 'Hidden' | Category
  savedPlaceSearch: string
  visiblePlaceIds: Set<string>
  onMemorySurfaceChange: (value: MemorySurface) => void
  onFilterChange: (value: string) => void
  onMemorySearchChange: (value: string) => void
  onSavedPlaceFilterChange: (value: 'All' | 'Visible' | 'Hidden' | Category) => void
  onSavedPlaceSearchChange: (value: string) => void
  onOpenMemory: (placeId?: string) => void
  onOpenMemoryDetail: (memoryId: string) => void
  onOpenPlace: (placeId: string) => void
  onToggleSaved: (placeId: string) => void
}

function MemoriesView({
  memorySurface,
  memoryFilter,
  memorySearch,
  memories,
  places,
  savedPlaces,
  savedPlaceFilter,
  savedPlaceSearch,
  visiblePlaceIds,
  onMemorySurfaceChange,
  onFilterChange,
  onMemorySearchChange,
  onSavedPlaceFilterChange,
  onSavedPlaceSearchChange,
  onOpenMemory,
  onOpenMemoryDetail,
  onOpenPlace,
  onToggleSaved,
}: MemoriesProps) {
  const savedPlaceFilters = useMemo(() => {
    const categoryFilters = [...new Set(savedPlaces.map((place) => place.category))]

    return ['All', 'Visible', 'Hidden', ...categoryFilters] as const
  }, [savedPlaces])
  const filteredSavedPlaces = savedPlaces.filter((place) => {
    const matchesSearch = `${place.name} ${place.district} ${place.discoveryContext}`.toLowerCase().includes(savedPlaceSearch.toLowerCase())
    const isVisible = visiblePlaceIds.has(place.id)
    const matchesFilter =
      savedPlaceFilter === 'All' ||
      (savedPlaceFilter === 'Visible' && isVisible) ||
      (savedPlaceFilter === 'Hidden' && !isVisible) ||
      savedPlaceFilter === place.category

    return matchesSearch && matchesFilter
  })
  const visibleSavedCount = savedPlaces.filter((place) => visiblePlaceIds.has(place.id)).length
  const hiddenSavedCount = savedPlaces.length - visibleSavedCount

  return (
    <section className="screen list-screen">
      <div className="screen-title">
        <div>
          <h1>{memorySurface === 'Journal' ? 'Memories' : 'Saved places'}</h1>
          <p>
            {memorySurface === 'Journal'
              ? `${memories.length} saved entries`
              : `${savedPlaces.length} saved places, ${visibleSavedCount} visible now`}
          </p>
        </div>
        <div className="segmented-control" aria-label="Memories view">
          <button className={memorySurface === 'Journal' ? 'active' : ''} type="button" onClick={() => onMemorySurfaceChange('Journal')}>
            Journal
          </button>
          <button className={memorySurface === 'Saved Places' ? 'active' : ''} type="button" onClick={() => onMemorySurfaceChange('Saved Places')}>
            Saved places
          </button>
        </div>
      </div>

      {memorySurface === 'Journal' ? (
        <>
          <div className="memory-toolbar">
            <button className="icon-button filled" type="button" onClick={() => onOpenMemory()} aria-label="Add memory">
              <Plus size={19} />
            </button>
            <div className="memory-toolbar-copy">
              <strong>Journal and place notes</strong>
              <span>Search memories, inspect what was saved, or drop a new note from the current walk.</span>
            </div>
          </div>

          <label className="search-field compact-field">
            <Search size={17} />
            <input value={memorySearch} onChange={(event) => onMemorySearchChange(event.target.value)} placeholder="Search memories" />
          </label>

          <div className="filter-row" aria-label="Memory filters">
            {['All', 'place', 'walk', 'quiet', 'Private', 'Recap allowed'].map((filter) => (
              <button className={memoryFilter === filter ? 'active' : ''} key={filter} type="button" onClick={() => onFilterChange(filter)}>
                {filter}
              </button>
            ))}
          </div>

          <div className="memory-list">
            {memories.map((memory) => {
              const place = memory.placeId ? places.find((candidate) => candidate.id === memory.placeId) : undefined
              const context = describeMemoryContext(memory, places)

              return (
                <button className="memory-card memory-card-button" key={memory.id} type="button" onClick={() => onOpenMemoryDetail(memory.id)}>
                  <div>
                    <span className="eyebrow">
                      {memory.hasPhoto ? <Camera size={14} /> : <BookOpen size={14} />}
                      {memory.createdAt}
                    </span>
                    <h2>{memory.title}</h2>
                    <p>{memory.text}</p>
                  </div>
                  <footer>
                    <span>
                      <Tag size={14} />
                      {memory.tag}
                    </span>
                    <span>
                      <Shield size={14} />
                      {memory.visibility}
                    </span>
                    <span>{context}</span>
                    {place && <span>{place.name}</span>}
                  </footer>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="memory-toolbar">
            <div className="memory-toolbar-copy">
              <strong>Saved places browser</strong>
              <span>Open any saved place, clear it from the list, or filter by visibility and category.</span>
            </div>
            <div className="memory-toolbar-stats" aria-label="Saved place summary">
              <span>{savedPlaces.length} saved</span>
              <span>{visibleSavedCount} visible</span>
              <span>{hiddenSavedCount} hidden</span>
            </div>
          </div>

          <label className="search-field compact-field">
            <Search size={17} />
            <input
              value={savedPlaceSearch}
              onChange={(event) => onSavedPlaceSearchChange(event.target.value)}
              placeholder="Search saved places"
            />
          </label>

          <div className="filter-row" aria-label="Saved place filters">
            {savedPlaceFilters.map((filter) => (
              <button
                className={savedPlaceFilter === filter ? 'active' : ''}
                key={filter}
                type="button"
                onClick={() => onSavedPlaceFilterChange(filter)}
              >
                {filter === 'Visible' ? 'Visible now' : filter === 'Hidden' ? 'Hidden under fog' : categoryLabels[filter as Category] ?? filter}
              </button>
            ))}
          </div>

          <div className="saved-place-list">
            {filteredSavedPlaces.length === 0 ? (
              <p className="empty-copy">
                {savedPlaces.length === 0
                  ? 'Saved places appear here after their area is revealed and you save them.'
                  : 'No saved places match this filter yet.'}
              </p>
            ) : (
              filteredSavedPlaces.map((place) => {
                const isVisible = visiblePlaceIds.has(place.id)

                return (
                  <article className="saved-place-card" key={place.id}>
                    <button className="saved-place-open" type="button" onClick={() => onOpenPlace(place.id)}>
                      <span className="eyebrow">
                        {isVisible ? 'Visible now' : 'Hidden under fog'}
                      </span>
                      <strong>{place.name}</strong>
                      <p>{place.discoveryContext}</p>
                      <footer>
                        <span>{categoryLabels[place.category]}</span>
                        <span>{place.district}</span>
                      </footer>
                    </button>
                    <div className="saved-place-actions">
                      <button className="secondary-action compact" type="button" onClick={() => onOpenPlace(place.id)}>
                        Open place
                      </button>
                      <button className="secondary-action compact danger" type="button" onClick={() => onToggleSaved(place.id)}>
                        Remove saved
                      </button>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </>
      )}
    </section>
  )
}

type DiscoveryProps = {
  city: City
  discoveryPlaces: Place[]
  discoverySummary: { revealedCellCount: number; routeLabel: string } | null
  latestRevealDigest: LatestRevealDigest | null
  recapPreview: CityRecap | null
  recapReady: boolean
  recapShareStatus: 'idle' | 'shared' | 'copied'
  routeFragments: string[]
  reviewedDiscoveryIds: string[]
  walkSession: WalkSession
  onCloseDiscovery: () => void
  onContinueExploring: () => void
  onCreateRecap: () => void
  onShareRecap: () => void
  onOpenMemory: (placeId?: string) => void
  onPlaceOpen: (placeId: string) => void
}

function DiscoveryView({
  city,
  discoveryPlaces,
  discoverySummary,
  latestRevealDigest,
  recapPreview,
  recapReady,
  recapShareStatus,
  routeFragments,
  reviewedDiscoveryIds,
  walkSession,
  onCloseDiscovery,
  onContinueExploring,
  onCreateRecap,
  onShareRecap,
  onOpenMemory,
  onPlaceOpen,
}: DiscoveryProps) {
  const {
    featuredDiscoveryPlace,
    secondaryDiscoveryPlaces,
    reviewedDiscoveryPlaces,
    pendingDiscoveryPlaces,
  } = getDiscoveryReviewState(discoveryPlaces, reviewedDiscoveryIds)
  const reviewedDiscoveryPlaceIds = new Set(reviewedDiscoveryPlaces.map((place) => place.id))
  const walkCopy = describeWalkSession(walkSession, city.walkRoute.length)
  const recapPreviewTitle = recapPreview?.title ?? `${city.name} private recap`
  const recapPreviewSummary =
    recapPreview?.summary ??
    `The recap will keep the walked path generalized while you inspect what surfaced around the latest reveal.`
  const recapPreviewPlaces = recapPreview?.shareablePlaces.slice(0, 3) ?? []
  const recapPreviewMemories = recapPreview?.shareableMemories.slice(0, 2) ?? []
  const recapPreviewNotes = recapPreview?.privacyNotes ?? [
    'Exact route stays hidden until you explicitly share more detail.',
    'Only privacy-approved memories and places appear in recap mode.',
  ]

  return (
    <section className="screen discovery-screen">
      <div className="screen-title">
        <div>
          <h1>Discovery</h1>
          <p>{discoveryPlaces.length} new place{discoveryPlaces.length === 1 ? '' : 's'} ready to inspect</p>
        </div>
        <button className="secondary-action compact" type="button" onClick={onCloseDiscovery}>
          <ArrowRight size={17} />
          Back to Atlas
        </button>
      </div>

      <section className="discovery-handoff-card">
        <div className="discovery-handoff-copy">
          <span className="eyebrow">
            <Sparkles size={14} />
            Newly discovered
          </span>
          <strong>
            {discoveryPlaces.length} place{discoveryPlaces.length === 1 ? '' : 's'} revealed around {discoverySummary?.routeLabel ?? walkCopy.routeLabel}.
          </strong>
          <span>
            {discoverySummary
              ? `${discoverySummary.revealedCellCount} cells opened in the latest reveal. The walk is paused while you inspect the result.`
              : 'The walk paused automatically so you can inspect the latest reveal before moving on.'}
          </span>
        </div>
          <div className="discovery-review-card" aria-label="Discovery review progress">
            <div className="discovery-review-copy">
              <span className="eyebrow">Review progress</span>
              <strong>
                {reviewedDiscoveryPlaces.length}/{discoveryPlaces.length} inspected
            </strong>
            <span>
              {pendingDiscoveryPlaces.length > 0
                ? `${pendingDiscoveryPlaces.length} place${pendingDiscoveryPlaces.length === 1 ? '' : 's'} still need a closer look.`
                : 'All newly surfaced places have been inspected.'}
            </span>
            </div>
            <div className="discovery-review-pills" aria-label="Discovery state">
              <span className="state-pill live">{reviewedDiscoveryPlaces.length} viewed</span>
              <span className="state-pill">{pendingDiscoveryPlaces.length} open</span>
              <span className={`state-pill ${pendingDiscoveryPlaces.length > 0 ? 'running' : 'idle'}`}>
                {pendingDiscoveryPlaces.length > 0 ? 'Next up' : 'All reviewed'}
              </span>
            </div>
          </div>
      </section>

      <div className="discovery-reward-card">
        <div className="discovery-reward-copy">
          <span className="eyebrow">Reward summary</span>
          <strong>
            {latestRevealDigest
              ? `${latestRevealDigest.placeCount} place${latestRevealDigest.placeCount === 1 ? '' : 's'} and ${latestRevealDigest.revealedCellCount} revealed cell${latestRevealDigest.revealedCellCount === 1 ? '' : 's'} are ready.`
              : `${discoveryPlaces.length} new place${discoveryPlaces.length === 1 ? '' : 's'} and ${discoverySummary?.revealedCellCount ?? 'recent'} revealed cells are ready.`}
          </strong>
          <span>
            {latestRevealDigest
              ? `${latestRevealDigest.featuredPlaceName ?? featuredDiscoveryPlace?.name ?? 'The latest reveal'} is ready to inspect. ${latestRevealDigest.reviewedCount} reviewed, ${latestRevealDigest.pendingCount} open.`
              : featuredDiscoveryPlace
                ? `${featuredDiscoveryPlace.name} is the fastest way to inspect the latest reveal, save a memory, or continue exploring.`
                : 'Keep walking to unlock the next discovery batch.'}
          </span>
        </div>
        <div className="place-chip-row" aria-label="Discovery detail chips">
          {latestRevealDigest?.featuredPlaceName && <span>{latestRevealDigest.featuredPlaceName}</span>}
          <span>{walkCopy.routeLabel}</span>
          <span>{city.name}</span>
          <span>{walkSession.status === 'paused' ? 'Walk paused' : walkCopy.title}</span>
          {latestRevealDigest ? <span>{latestRevealDigest.reviewedCount}/{latestRevealDigest.placeCount} reviewed</span> : null}
        </div>
      </div>

      <div className="sheet-actions discovery-actions">
        <button className="primary-action compact" type="button" onClick={onContinueExploring}>
          <Play size={17} />
          Continue exploring
        </button>
        <button className="secondary-action compact" type="button" onClick={onCreateRecap}>
          <Sparkles size={17} />
          {latestRevealDigest ? 'Refresh digest' : 'Review recap'}
        </button>
        <button className="secondary-action compact" type="button" onClick={onShareRecap} disabled={!recapReady}>
          <Share2 size={17} />
          {recapReady ? (recapShareStatus === 'shared' ? 'Shared' : recapShareStatus === 'copied' ? 'Copied' : 'Share recap') : 'Create recap first'}
        </button>
      </div>

      {featuredDiscoveryPlace ? (
        <section className="discovery-featured-card">
          <div className="discovery-featured-copy">
            <span className="eyebrow">{pendingDiscoveryPlaces.length > 0 ? 'Next place' : 'Reviewed place'}</span>
            <strong>{featuredDiscoveryPlace.name}</strong>
            <p>{featuredDiscoveryPlace.discoveryContext}</p>
          </div>
          <div className="place-chip-row" aria-label="Discovery details">
            <span>{categoryLabels[featuredDiscoveryPlace.category]}</span>
            <span>{featuredDiscoveryPlace.district}</span>
            <span>{discoverySummary?.routeLabel ?? walkCopy.routeLabel}</span>
            <span className={`discovery-review-chip ${pendingDiscoveryPlaces.length > 0 ? 'pending' : 'reviewed'}`}>
              {pendingDiscoveryPlaces.length > 0 ? 'Inspect now' : 'Already reviewed'}
            </span>
          </div>
          <div className="discovery-featured-actions">
            <button className="secondary-action compact" type="button" onClick={() => onPlaceOpen(featuredDiscoveryPlace.id)}>
              Inspect place
              <ArrowRight size={16} />
            </button>
            <button className="secondary-action compact" type="button" onClick={() => onOpenMemory(featuredDiscoveryPlace.id)}>
              <Plus size={16} />
              Save memory
            </button>
            <button className="secondary-action compact" type="button" onClick={onCreateRecap}>
              <Sparkles size={16} />
              {latestRevealDigest ? 'Refresh digest' : 'Review recap'}
            </button>
          </div>
        </section>
      ) : null}

      <div className="discovery-recap-card discovery-recap-hero" aria-label="Private recap preview">
        <div className="discovery-recap-header">
          <span className="eyebrow">
            <EyeOff size={14} />
            Private recap preview
          </span>
          <strong>{recapPreviewTitle}</strong>
          <p>{recapPreviewSummary}</p>
        </div>
        <div className="discovery-recap-grid" aria-label="Recap highlights">
          <div className="discovery-recap-stat">
            <span>Route fragments</span>
            <strong>{routeFragments.length}</strong>
            <small>{routeFragments.length > 0 ? routeFragments.join(' - ') : 'Keep walking to build a safer trail.'}</small>
          </div>
          <div className="discovery-recap-stat">
            <span>Shareable places</span>
            <strong>{recapPreviewPlaces.length}</strong>
            <small>{recapPreviewPlaces.length > 0 ? recapPreviewPlaces.map((place) => place.name).join(', ') : 'No shareable places yet.'}</small>
          </div>
          <div className="discovery-recap-stat">
            <span>Recap memories</span>
            <strong>{recapPreviewMemories.length}</strong>
            <small>
              {recapPreviewMemories.length > 0
                ? recapPreviewMemories.map((memory) => memory.title).join(', ')
                : 'Mark a memory as recap allowed to include it.'}
            </small>
          </div>
        </div>
        <div className="discovery-recap-note">
          <span>
            {latestRevealDigest
              ? 'Session review digest stays available until the next discovery batch.'
              : recapPreviewNotes[0]}
          </span>
        </div>
      </div>

      <div className="discovery-list">
        {secondaryDiscoveryPlaces.length > 0 ? (
          secondaryDiscoveryPlaces.map((place) => (
              <article className="discovery-place-card" key={place.id}>
                <button className="discovery-place-open" type="button" onClick={() => onPlaceOpen(place.id)}>
                  <span className="discovery-place-name">{place.name}</span>
                  <small>{place.discoveryContext}</small>
                </button>
                <div className="place-chip-row" aria-label="Discovery place context">
                  <span>{categoryLabels[place.category]}</span>
                  <span>{place.district}</span>
                  <span className={`discovery-review-chip ${reviewedDiscoveryPlaceIds.has(place.id) ? 'reviewed' : 'pending'}`}>
                    {reviewedDiscoveryPlaceIds.has(place.id) ? 'Reviewed' : 'Pending'}
                  </span>
                </div>
                <div className="discovery-place-actions">
                  <button className="secondary-action compact" type="button" onClick={() => onPlaceOpen(place.id)}>
                    Inspect
                </button>
                <button className="secondary-action compact" type="button" onClick={() => onOpenMemory(place.id)}>
                  Save memory
                </button>
              </div>
            </article>
          ))
        ) : featuredDiscoveryPlace ? (
          <article className="discovery-place-card">
            <div className="discovery-place-open">
              <span className="discovery-place-name">All discovered places reviewed</span>
              <small>Use the recap or continue exploring to surface the next batch.</small>
            </div>
          </article>
        ) : (
          <article className="discovery-place-card">
            <div className="discovery-place-open">
              <span className="discovery-place-name">Nothing new yet</span>
              <small>Keep walking to reveal the next batch of places.</small>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}

type StatsProps = {
  city: City
  distanceWalked: string
  discoveryPlaces: Place[]
  discoverySummary: { revealedCellCount: number; routeLabel: string } | null
  latestRevealDigest: LatestRevealDigest | null
  reviewedDiscoveryIds: string[]
  memories: Memory[]
  recap: CityRecap | null
  recapPreview: CityRecap | null
  recapCopied: boolean
  recapDownloaded: boolean
  recapShareStatus: 'idle' | 'shared' | 'copied'
  progress: number
  revealedCells: Set<string>
  privacyRules: ReturnType<typeof buildPrivacyRules>
  locationPipeline: LocationPipelineSummary
  locationFeedLog: LocationFeedEntry[]
  visiblePlaces: Place[]
  onOpenDiscovery: () => void
  onCreateRecap: () => void
  onCopyRecap: () => void
  onDownloadRecap: () => void
  onShareRecap: () => void
  onReturnToAtlas: () => void
}

function StatsView({
  city,
  distanceWalked,
  discoveryPlaces,
  discoverySummary,
  latestRevealDigest,
  reviewedDiscoveryIds,
  memories,
  recap,
  recapPreview,
  recapCopied,
  recapDownloaded,
  recapShareStatus,
  progress,
  revealedCells,
  privacyRules,
  locationPipeline,
  locationFeedLog,
  visiblePlaces,
  onOpenDiscovery,
  onCreateRecap,
  onCopyRecap,
  onDownloadRecap,
  onShareRecap,
  onReturnToAtlas,
}: StatsProps) {
  const previewRecap = recap ?? recapPreview
  const previewRouteFragments = previewRecap?.routeFragments.slice(0, 4) ?? []
  const previewPlaceChips = previewRecap?.shareablePlaces.slice(0, 3) ?? []
  const previewMemoryChips = previewRecap?.shareableMemories.slice(0, 2) ?? []
  const previewPrivacyNote = previewRecap?.privacyNotes[0] ?? 'Recaps stay privacy-aware by default.'
  const previewLatestReveal = previewRecap?.latestReveal ?? latestRevealDigest
  const hasDiscoveryHandoff = discoveryPlaces.length > 0
  const {
    featuredDiscoveryPlace,
    reviewedDiscoveryPlaces,
    pendingDiscoveryPlaces,
  } = getDiscoveryReviewState(discoveryPlaces, reviewedDiscoveryIds)

  return (
    <section className="screen stats-screen">
      <div className="screen-title">
        <div>
          <h1>Stats</h1>
          <p>{city.name} progress</p>
        </div>
      </div>

      <div className="stats-grid">
        <Metric label="Revealed" value={`${progress}%`} />
        <Metric label="Places found" value={visiblePlaces.length.toString()} />
        <Metric label="Memories" value={memories.length.toString()} />
        <Metric label="Walked" value={`${distanceWalked} km`} />
      </div>

      {hasDiscoveryHandoff && (
        <section className="recap-handoff-card" aria-label="Discovery handoff">
          <div className="recap-handoff-copy">
            <span className="eyebrow">
              <Sparkles size={14} />
              {latestRevealDigest ? 'Session review digest' : 'Discovery handoff'}
            </span>
            <strong>
              {latestRevealDigest
                ? `${latestRevealDigest.placeCount} place${latestRevealDigest.placeCount === 1 ? '' : 's'} surfaced around ${latestRevealDigest.routeLabel}.`
                : pendingDiscoveryPlaces.length > 0
                  ? `${featuredDiscoveryPlace?.name ?? `${discoveryPlaces.length} new places`} is next to inspect in Atlas.`
                  : 'All discovered places have been reviewed in Atlas.'}
            </strong>
            <span>
              {latestRevealDigest
                ? `${latestRevealDigest.revealedCellCount} cells opened in the latest batch. ${latestRevealDigest.reviewedCount} reviewed, ${latestRevealDigest.pendingCount} open.`
                : discoverySummary
                  ? `${discoverySummary.revealedCellCount} cells were revealed around ${discoverySummary.routeLabel}.`
                  : 'The latest walk still has places ready to inspect.'}
            </span>
          </div>
          <div className="discovery-review-card">
            <div className="discovery-review-copy">
              <span className="eyebrow">Review progress</span>
              <strong>
                {reviewedDiscoveryPlaces.length}/{discoveryPlaces.length} inspected
              </strong>
              <span>
                {pendingDiscoveryPlaces.length > 0
                  ? `${pendingDiscoveryPlaces.length} place${pendingDiscoveryPlaces.length === 1 ? '' : 's'} still need a closer look.`
                  : 'All newly surfaced places have been inspected.'}
              </span>
            </div>
            <div className="discovery-review-pills" aria-label="Discovery review state">
              <span className="state-pill live">{reviewedDiscoveryPlaces.length} viewed</span>
              <span className="state-pill">{pendingDiscoveryPlaces.length} open</span>
              <span className={`state-pill ${pendingDiscoveryPlaces.length > 0 ? 'running' : 'idle'}`}>
                {pendingDiscoveryPlaces.length > 0 ? 'Next up' : 'All reviewed'}
              </span>
            </div>
          </div>
          {latestRevealDigest?.featuredPlaceName ? (
            <div className="place-chip-row" aria-label="Latest reveal digest">
              <span>{latestRevealDigest.featuredPlaceName}</span>
              <span>{latestRevealDigest.reviewedCount}/{latestRevealDigest.placeCount} reviewed</span>
              <span>{latestRevealDigest.pendingCount} open</span>
            </div>
          ) : null}
          <div className="sheet-actions recap-handoff-actions">
            <button className="secondary-action compact" type="button" onClick={onOpenDiscovery}>
              <Sparkles size={17} />
              Open discovery
            </button>
            <button className="secondary-action compact" type="button" onClick={onReturnToAtlas}>
              <MapIcon size={17} />
              Return to Atlas
            </button>
            <button className="secondary-action compact" type="button" onClick={onCreateRecap}>
              <Sparkles size={17} />
              {latestRevealDigest ? 'Refresh digest' : 'Refresh recap'}
            </button>
          </div>
        </section>
      )}

      <section className="pipeline-panel stats-pipeline">
        <div className="pipeline-copy">
          <span className="eyebrow">Location pipeline</span>
          <strong>{locationPipeline.title}</strong>
          <span>{locationPipeline.detail}</span>
        </div>
        <div className="pipeline-pills" aria-label="Pipeline status">
          <span className={`state-pill ${locationPipeline.statusLabel.toLowerCase()}`}>{locationPipeline.statusLabel}</span>
          <span className="state-pill">{locationPipeline.modeLabel}</span>
          <span className="state-pill">{locationPipeline.permissionLabel}</span>
          <span className="state-pill">{locationPipeline.sampleLabel}</span>
        </div>
        <p className="pipeline-hint">{locationPipeline.nextAction}</p>
      </section>

      <section className="location-feed-log stats-feed-log">
        <div className="section-heading">
          <strong>Recent feed</strong>
          <small>{locationFeedLog.length} entries</small>
        </div>
        <div className="location-feed-list" aria-label="Location feed history">
          {locationFeedLog.slice(0, 3).map((entry) => (
            <article className={`location-feed-entry ${entry.tone}`} key={entry.id}>
              <strong>{entry.title}</strong>
              <span>{entry.detail}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="privacy-rules-panel">
        <div className="section-heading">
          <strong>Recap privacy</strong>
          <small>{privacyRules.filter((rule) => rule.enabled).length} active</small>
        </div>
        <div className="privacy-rule-list">
          {privacyRules.map((rule) => (
            <div className="privacy-rule" key={rule.id}>
              <span>{rule.label}</span>
              <strong>{rule.enabled ? 'On' : 'Off'}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="district-list">
        <div className="section-heading">
          <strong>Districts</strong>
          <small>{city.districts.length} areas</small>
        </div>
        {city.districts.map((district) => {
          const revealedCount = district.cells.filter((cellId) => revealedCells.has(cellId)).length
          const districtProgress = Math.round((revealedCount / district.cells.length) * 100)

          return (
            <article className="district-row" key={district.id}>
              <div>
                <strong>{district.name}</strong>
                <span>{districtProgress}% revealed</span>
              </div>
              <div className="progress-track" aria-hidden="true">
                <span style={{ width: `${districtProgress}%` }} />
              </div>
            </article>
          )
        })}
      </section>

      <section className="recap-panel">
        <span className="eyebrow">
          <EyeOff size={14} />
          Private recap
        </span>
        {previewRecap ? (
          <div className={recap ? 'recap-hero' : 'recap-hero recap-hero-preview'}>
            <div className="recap-hero-copy">
              <span className="eyebrow">
                <Sparkles size={14} />
                {recap ? 'Recap ready' : 'Preview from the latest walk'}
              </span>
              <h2>{previewRecap.title}</h2>
              <p>{previewRecap.summary}</p>
            </div>
        <div className="recap-hero-notes">
          <div className="recap-note-card">
            <strong>Privacy note</strong>
            <span>{previewPrivacyNote}</span>
          </div>
              <div className="recap-note-card">
                <strong>Highlights</strong>
                <span>
                  {previewPlaceChips.length > 0
                    ? `${previewPlaceChips.length} place${previewPlaceChips.length === 1 ? '' : 's'} ready`
                    : 'No shareable places yet'}
              </span>
            </div>
            {previewLatestReveal && (
              <div className="recap-note-card recap-note-card-digest">
                <strong>Session review digest</strong>
                <span>
                  {previewLatestReveal.placeCount} place{previewLatestReveal.placeCount === 1 ? '' : 's'} around {previewLatestReveal.routeLabel}.{' '}
                  {previewLatestReveal.reviewedCount} reviewed, {previewLatestReveal.pendingCount} open.
                </span>
              </div>
            )}
          </div>
          </div>
        ) : (
          <div className="recap-hero recap-hero-empty">
            <div className="recap-hero-copy">
              <span className="eyebrow">
                <Sparkles size={14} />
                No recap yet
              </span>
              <h2>Create a recap</h2>
              <p>Summarize progress without exposing the full route.</p>
            </div>
            <div className="recap-note-card">
              <strong>What it keeps</strong>
              <span>District progress, saved places, and recap-approved memories.</span>
            </div>
          </div>
        )}
        {previewRecap ? (
          <>
            <div className="recap-focus-grid" aria-label="Recap highlights">
              <article className="recap-focus-card">
                <span className="eyebrow">Route trail</span>
                <strong>{previewRouteFragments.length > 0 ? `${previewRouteFragments.length} fragments ready` : 'No fragments yet'}</strong>
                <div className="recap-chips recap-route-chips" aria-label="Route fragments">
                  {previewRouteFragments.length > 0 ? (
                    previewRouteFragments.map((fragment) => <span key={fragment}>{fragment}</span>)
                  ) : (
                    <span>Keep walking to surface route fragments</span>
                  )}
                </div>
                <small>{previewPrivacyNote}</small>
              </article>
              <article className="recap-focus-card">
                <span className="eyebrow">Places ready</span>
                <strong>{previewPlaceChips.length > 0 ? `${previewPlaceChips.length} shareable places` : 'No shareable places yet'}</strong>
                <div className="recap-highlight-list">
                  {previewPlaceChips.length > 0 ? (
                    previewPlaceChips.map((place) => (
                      <div className="recap-highlight-row" key={place.id}>
                        <strong>{place.name}</strong>
                        <span>
                          {categoryLabels[place.category]} - {place.district}
                          {place.saved ? ' - Saved' : ''}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="recap-highlight-row empty">
                      <strong>Nothing ready yet</strong>
                      <span>Discover more places to populate the recap.</span>
                    </div>
                  )}
                </div>
              </article>
              <article className="recap-focus-card">
                <span className="eyebrow">Memories ready</span>
                <strong>{previewMemoryChips.length > 0 ? `${previewMemoryChips.length} recap memories` : 'No recap-approved memories yet'}</strong>
                <div className="recap-highlight-list">
                  {previewMemoryChips.length > 0 ? (
                    previewMemoryChips.map((memory) => (
                      <div className="recap-highlight-row" key={memory.id}>
                        <strong>{memory.title}</strong>
                        <span>
                          {memory.tag}
                          {memory.placeName ? ` - ${memory.placeName}` : ''}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="recap-highlight-row empty">
                      <strong>Nothing shareable yet</strong>
                      <span>Mark a memory as recap allowed to include it.</span>
                    </div>
                  )}
                </div>
              </article>
            </div>
            <div className="recap-chips recap-highlight-chips" aria-label="Recap highlights">
              {previewPlaceChips.map((place) => (
                <span key={place.id}>{place.name}</span>
              ))}
              {previewMemoryChips.map((memory) => (
                <span key={memory.id}>{memory.title}</span>
              ))}
            </div>
            {recap ? (
              <>
                <textarea className="recap-preview" readOnly value={recap.shareText} aria-label="Recap preview" />
                <div className="recap-privacy-list" aria-label="Recap privacy notes">
                  {recap.privacyNotes.slice(0, 3).map((note) => (
                    <div className="recap-privacy-note" key={note}>
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
                <div className="sheet-actions recap-actions">
                  <button className="primary-action compact" type="button" onClick={onCreateRecap}>
                    <Sparkles size={17} />
                    {previewLatestReveal ? 'Refresh digest' : 'Refresh recap'}
                  </button>
                  <button className="secondary-action" type="button" onClick={onShareRecap}>
                    <Share2 size={17} />
                    {recapShareStatus === 'shared' ? 'Shared' : recapShareStatus === 'copied' ? 'Copied' : 'Share recap'}
                  </button>
                  <button className="secondary-action" type="button" onClick={onCopyRecap}>
                    <Save size={17} />
                    {recapCopied ? 'Copied' : 'Copy recap'}
                  </button>
                  <button className="secondary-action" type="button" onClick={onDownloadRecap}>
                    <Download size={17} />
                    {recapDownloaded ? 'Downloaded' : 'Download recap'}
                  </button>
                  <button className="secondary-action" type="button" onClick={onReturnToAtlas}>
                    <MapIcon size={17} />
                    Return to atlas
                  </button>
                </div>
              </>
            ) : (
              <div className="sheet-actions recap-empty-actions">
                <button className="primary-action" type="button" onClick={onCreateRecap}>
                  <Sparkles size={17} />
                  Create recap
                </button>
                <button className="secondary-action" type="button" onClick={onReturnToAtlas}>
                  <MapIcon size={17} />
                  Return to atlas
                </button>
              </div>
            )}
          </>
        ) : null}
      </section>
    </section>
  )
}

type PrivacyProps = {
  hasLocalProgress: boolean
  localProgressSummary: { revealedCells: number; savedPlaces: number; acceptedSamples: number; memories: number } | null
  locationMode: LocationMode
  locationPipeline: LocationPipelineSummary
  privacy: PrivacySettings
  onExportPreview: () => void
  onResetRequest: () => void
  onRequestBrowserLocation: (activateGpsMode?: boolean) => void
  onToggle: (key: keyof PrivacySettings) => void
}

function PrivacyView({
  hasLocalProgress,
  localProgressSummary,
  locationMode,
  locationPipeline,
  privacy,
  onExportPreview,
  onResetRequest,
  onRequestBrowserLocation,
  onToggle,
}: PrivacyProps) {
  return (
    <section className="screen privacy-screen">
      <div className="screen-title">
        <div>
          <h1>Privacy</h1>
          <p>Location and memory controls</p>
        </div>
      </div>

      <div className="export-panel">
        <strong>Live location</strong>
        <p>{locationPipeline.title}</p>
        <div className="pipeline-pills" aria-label="Location pipeline status">
          <span className={`state-pill ${locationMode}`}>{locationPipeline.modeLabel}</span>
          <span className={`state-pill ${locationPipeline.statusLabel.toLowerCase()}`}>{locationPipeline.statusLabel}</span>
          <span className={`state-pill ${locationPipeline.permissionLabel.toLowerCase().replace(/\s+/g, '-')}`}>{locationPipeline.permissionLabel}</span>
          <span className="state-pill">{locationPipeline.sampleLabel}</span>
        </div>
        <small>{locationPipeline.detail}</small>
        <div className="sheet-actions">
          <button className="secondary-action compact" type="button" onClick={() => onRequestBrowserLocation(locationMode !== 'gps')}>
            {locationMode === 'gps' ? 'Refresh location' : 'Switch to GPS'}
          </button>
          {locationMode === 'gps' && !privacy.preciseLocation ? (
            <button className="secondary-action compact" type="button" onClick={() => onToggle('preciseLocation')}>
              Turn on precise location
            </button>
          ) : null}
        </div>
        <small>{locationPipeline.nextAction}</small>
      </div>

      <div className="privacy-list">
        <ToggleRow
          active={privacy.privateByDefault}
          detail="New memories start private."
          icon={Shield}
          label="Private by default"
          onToggle={() => onToggle('privateByDefault')}
        />
        <ToggleRow
          active={privacy.hideSensitivePlaces}
          detail="Sensitive categories stay out of recaps."
          icon={EyeOff}
          label="Hide sensitive places"
          onToggle={() => onToggle('hideSensitivePlaces')}
        />
        <ToggleRow
          active={privacy.blurHomeWork}
          detail="Home and work areas use blurred map fragments."
          icon={MapPin}
          label="Blur home and work"
          onToggle={() => onToggle('blurHomeWork')}
        />
        <ToggleRow
          active={privacy.preciseLocation}
          detail="Use precise points during active walks."
          icon={Footprints}
          label="Precise location"
          onToggle={() => onToggle('preciseLocation')}
        />
        <ToggleRow
          active={privacy.recapExactRoutes}
          detail="Controls whether the atlas and recap show the exact walked path."
          icon={Route}
          label="Exact route traces"
          onToggle={() => onToggle('recapExactRoutes')}
        />
        <ToggleRow
          active={privacy.backupEnabled}
          detail="Keep a second device-local snapshot that can restore the app if the main one is lost."
          icon={SlidersHorizontal}
          label="Backup"
          onToggle={() => onToggle('backupEnabled')}
        />
      </div>

      <div className="export-panel">
        <strong>Data export</strong>
        <p>Preview, download, or copy the local snapshot. Transient GPS coordinates stay out of the export.</p>
        <button className="secondary-action" type="button" onClick={onExportPreview}>
          <Save size={17} />
          Preview export
        </button>
      </div>

      <div className="export-panel">
        <strong>Local backup</strong>
        <p>
          {privacy.backupEnabled
            ? 'A backup snapshot stays in sync with the main local snapshot and can restore progress if the primary copy disappears.'
            : 'No backup snapshot is stored. Turn on Backup to keep a second local copy on this device.'}
        </p>
        <small>
          {privacy.backupEnabled
            ? 'Backup is active and updates with every save.'
            : 'Backup is paused, so only the main snapshot is written.'}
        </small>
      </div>

      <section className="reset-panel">
        <strong>Local data</strong>
        <p>{hasLocalProgress ? 'This device has saved city progress, memories, and privacy settings.' : 'No local progress is stored yet.'}</p>
        {localProgressSummary && (
          <small>
            {localProgressSummary.revealedCells} revealed cells, {localProgressSummary.savedPlaces} saved places, {localProgressSummary.acceptedSamples} samples, {localProgressSummary.memories} memories
          </small>
        )}
        <button className="secondary-action danger" type="button" onClick={onResetRequest} disabled={!hasLocalProgress}>
          <Trash2 size={17} />
          Reset local data
        </button>
      </section>
    </section>
  )
}

type MemoryModalProps = {
  hasPhoto: boolean
  isEditing: boolean
  memoryContext: string
  places: Place[]
  originTab: MemoryOriginTab
  shareCopied: boolean
  shareText: string
  selectedPlaceId?: string
  tag: string
  text: string
  title: string
  visibility: MemoryVisibility
  onClose: () => void
  onDelete: () => void
  onPhotoToggle: () => void
  onShare: () => void
  onSave: () => void
  onTagChange: (value: string) => void
  onTextChange: (value: string) => void
  onTitleChange: (value: string) => void
  onVisibilityChange: (value: MemoryVisibility) => void
}

function MemoryModal({
  hasPhoto,
  isEditing,
  memoryContext,
  places,
  originTab,
  shareCopied,
  shareText,
  selectedPlaceId,
  tag,
  text,
  title,
  visibility,
  onClose,
  onDelete,
  onPhotoToggle,
  onShare,
  onSave,
  onTagChange,
  onTextChange,
  onTitleChange,
  onVisibilityChange,
}: MemoryModalProps) {
  const contextPlace = places.find((place) => place.id === selectedPlaceId)
  const titlePlaceholder = contextPlace ? `${contextPlace.name} note` : 'Short title'
  const textPlaceholder = contextPlace ? `What stood out at ${contextPlace.name}?` : 'What do you want to remember?'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="memory-modal" role="dialog" aria-modal="true" aria-labelledby="memory-title">
        <button className="close-button" type="button" onClick={onClose} aria-label="Close memory form">
          <X size={18} />
        </button>
        <h1 id="memory-title">{isEditing ? 'Memory details' : 'Save memory'}</h1>
        <p>{memoryContext}</p>
        <section className="memory-context-card memory-origin-card" aria-label="Memory source context">
          <span className="eyebrow">Return target</span>
          <strong>{originTab}</strong>
          <small>{isEditing ? `Editing keeps you on ${originTab}.` : `Saving returns you to ${originTab}.`}</small>
        </section>
        {contextPlace && (
          <section className="memory-context-card" aria-label="Place memory context">
            <span className="eyebrow">Place memory</span>
            <strong>{contextPlace.name}</strong>
            <small>{contextPlace.discoveryContext}</small>
            <div className="place-chip-row" aria-label="Memory context tags">
              <span>{categoryLabels[contextPlace.category]}</span>
              <span>{contextPlace.district}</span>
            </div>
          </section>
        )}

        <label>
          <span>Title</span>
          <input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder={titlePlaceholder} />
        </label>

        <label>
          <span>Text</span>
          <textarea value={text} onChange={(event) => onTextChange(event.target.value)} placeholder={textPlaceholder} />
        </label>

        <label>
          <span>Tag</span>
          <input value={tag} onChange={(event) => onTagChange(event.target.value)} placeholder="walk, quiet, place" />
        </label>

        <div className="segmented-control" aria-label="Memory visibility">
          <button className={visibility === 'Private' ? 'active' : ''} type="button" onClick={() => onVisibilityChange('Private')}>
            Private
          </button>
          <button
            className={visibility === 'Recap allowed' ? 'active' : ''}
            type="button"
            onClick={() => onVisibilityChange('Recap allowed')}
          >
            Recap allowed
          </button>
        </div>

        <button className={hasPhoto ? 'secondary-action selected' : 'secondary-action'} type="button" onClick={onPhotoToggle}>
          <Camera size={17} />
          {hasPhoto ? 'Photo attached' : 'Add photo'}
        </button>

        {isEditing && (
          <div className="sheet-actions memory-actions">
            <button className="secondary-action" type="button" onClick={onShare} disabled={!shareText}>
              <Save size={17} />
              {shareCopied ? 'Copied' : 'Share'}
            </button>
            <button className="secondary-action danger" type="button" onClick={onDelete}>
              <Trash2 size={17} />
              Delete
            </button>
          </div>
        )}

        <button className="primary-action" type="button" onClick={onSave} disabled={!title.trim() || !text.trim()}>
          <Save size={17} />
          {isEditing ? 'Update memory' : 'Save memory'}
        </button>
      </section>
    </div>
  )
}

type ExportPreviewModalProps = {
  copied: boolean
  downloaded: boolean
  preview: string
  onDownload: () => void
  onClose: () => void
  onCopy: () => void
}

function ExportPreviewModal({ copied, downloaded, preview, onClose, onCopy, onDownload }: ExportPreviewModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="memory-modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <button className="close-button" type="button" onClick={onClose} aria-label="Close export preview">
          <X size={18} />
        </button>
        <h1 id="export-title">Export preview</h1>
        <p>Preview, download, or copy the device-local snapshot. The preview mirrors the stored state, not live GPS coordinates.</p>
        <textarea readOnly value={preview} aria-label="Export preview JSON" />
        <div className="sheet-actions">
          <button className="secondary-action" type="button" onClick={onDownload}>
            <Download size={17} />
            {downloaded ? 'Downloaded' : 'Download JSON'}
          </button>
          <button className="secondary-action" type="button" onClick={onCopy}>
            <Save size={17} />
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
          <button className="primary-action compact" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  )
}

type ConfirmResetModalProps = {
  summary: { revealedCells: number; savedPlaces: number; memories: number } | null
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmResetModal({ summary, onCancel, onConfirm }: ConfirmResetModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="memory-modal reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <button className="close-button" type="button" onClick={onCancel} aria-label="Close reset dialog">
          <X size={18} />
        </button>
        <h1 id="reset-title">Reset local data</h1>
        <p>This clears the local snapshot for Cityprint on this device.</p>
        {summary && (
          <small>
            Current data: {summary.revealedCells} revealed cells, {summary.savedPlaces} saved places, {summary.memories} memories
          </small>
        )}
        <div className="sheet-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-action compact danger" type="button" onClick={onConfirm}>
            Reset
          </button>
        </div>
      </section>
    </div>
  )
}

type ToggleRowProps = {
  active: boolean
  detail: string
  icon: LucideIcon
  label: string
  onToggle: () => void
}

function ToggleRow({ active, detail, icon: Icon, label, onToggle }: ToggleRowProps) {
  return (
    <article className="toggle-row">
      <div className="toggle-icon">
        <Icon size={18} />
      </div>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <button className={active ? 'switch on' : 'switch'} type="button" onClick={onToggle} aria-pressed={active} aria-label={label}>
        <span />
      </button>
    </article>
  )
}

type TabButtonProps = {
  active: boolean
  icon: LucideIcon
  label: Tab
  onClick: () => void
}

function TabButton({ active, icon: Icon, label, onClick }: TabButtonProps) {
  return (
    <button className={active ? 'active' : ''} type="button" onClick={onClick}>
      <Icon size={20} />
      <span>{label}</span>
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default App

