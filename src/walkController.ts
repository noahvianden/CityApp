import type { City } from './cityprintData'
import { getCityGeoBounds } from './cityGeoBounds'
import { distanceMeters } from './geoGrid'
import type { GpsLocationSample, LocationSample, LocationSampleResult } from './locationAdapter'
import { nextSampleFromRoute, sampleNeighborhood, sampleToCellId } from './locationAdapter'

export type WalkStatus = 'idle' | 'running' | 'paused' | 'background'

export type WalkSession = {
  status: WalkStatus
  routeIndex: number
  routeTrace: string[]
  acceptedSampleCount?: number
  startedAt: number | null
  pausedAt: number | null
  lastSampleAt: number | null
  lastSampleCellId: string | null
  lastGpsSample?: GpsLocationSample | null
}

export type WalkStepInput = {
  city: Pick<City, 'id' | 'places' | 'walkRoute'>
  session: WalkSession
  revealedCells: ReadonlySet<string>
  seenPlaceIds: ReadonlySet<string>
  sample?: LocationSample | null
  now?: number
}

export type WalkStepResult = {
  session: WalkSession
  revealedCells: Set<string>
  seenPlaceIds: Set<string>
  recentCells: string[]
  discoveryPlaceIds: string[]
  sampleCellId: string | null
  sampleReason: WalkSampleReason
  completed: boolean
  advancedRoute: boolean
  movementSpeedMps?: number | null
}

export type WalkSampleReason = LocationSampleResult['reason'] | 'speed-too-fast' | 'stale-sample' | null

const maximumGpsSampleAgeMs = 30000
const maximumWalkingSpeedMps = 3.2
const gpsSpeedToleranceM = 35

export function createIdleWalkSession(): WalkSession {
  return {
    status: 'idle',
    routeIndex: 0,
    routeTrace: [],
    acceptedSampleCount: 0,
    startedAt: null,
    pausedAt: null,
    lastSampleAt: null,
    lastSampleCellId: null,
    lastGpsSample: null,
  }
}

export function startWalkSession(session: WalkSession, now = Date.now()): WalkSession {
  return {
    ...session,
    status: 'running',
    startedAt: session.startedAt ?? now,
    pausedAt: null,
  }
}

export function pauseWalkSession(session: WalkSession, status: Exclude<WalkStatus, 'running'> = 'paused', now = Date.now()): WalkSession {
  if (session.status === 'idle') {
    return session
  }

  return {
    ...session,
    status,
    pausedAt: now,
  }
}

export function resumeWalkSession(session: WalkSession, now = Date.now()): WalkSession {
  if (session.status === 'idle') {
    return session
  }

  return {
    ...session,
    status: 'running',
    pausedAt: null,
    startedAt: session.startedAt ?? now,
  }
}

export function canAdvanceWalk(session: WalkSession) {
  return session.status === 'running'
}

function calculateGpsMovementSpeedMps(previous: GpsLocationSample, next: GpsLocationSample) {
  const elapsedSeconds = (next.capturedAt - previous.capturedAt) / 1000

  if (elapsedSeconds <= 0) {
    return null
  }

  const movementMeters = Math.max(
    0,
    distanceMeters(
      { latitude: previous.latitude, longitude: previous.longitude },
      { latitude: next.latitude, longitude: next.longitude },
    ) - previous.accuracyM - next.accuracyM - gpsSpeedToleranceM,
  )

  return movementMeters / elapsedSeconds
}

export function stepWalk(input: WalkStepInput): WalkStepResult {
  const { city, session, revealedCells, seenPlaceIds, sample, now = Date.now() } = input

  if (session.status === 'idle' || session.status === 'paused') {
    return {
      session,
      revealedCells: new Set(revealedCells),
      seenPlaceIds: new Set(seenPlaceIds),
      recentCells: [],
      discoveryPlaceIds: [],
      sampleCellId: null,
      sampleReason: null,
      completed: session.routeIndex >= city.walkRoute.length - 1,
      advancedRoute: false,
      movementSpeedMps: null,
    }
  }

  const resolvedSample =
    sample ?? (session.status === 'running' ? nextSampleFromRoute(city.walkRoute, session.routeIndex + 1, now) : null)

  if (!resolvedSample) {
    const nextStatus = session.routeIndex >= city.walkRoute.length - 1 ? 'idle' : session.status
    const completed = session.routeIndex >= city.walkRoute.length - 1

    return {
      session: {
        ...session,
        status: nextStatus,
        lastSampleAt: now,
      },
      revealedCells: new Set(revealedCells),
      seenPlaceIds: new Set(seenPlaceIds),
      recentCells: [],
      discoveryPlaceIds: [],
      sampleCellId: null,
      sampleReason: null,
      completed,
      advancedRoute: false,
      movementSpeedMps: null,
    }
  }

  const resolved = sampleToCellId(resolvedSample, city.id)

  const appendTrace = (trace: ReadonlyArray<string>, cellId: string) => {
    if (trace[trace.length - 1] === cellId) {
      return [...trace]
    }

    return [...trace, cellId]
  }

  if (!resolved.accepted || !resolved.cellId) {
    return {
      session,
      revealedCells: new Set(revealedCells),
      seenPlaceIds: new Set(seenPlaceIds),
      recentCells: [],
      discoveryPlaceIds: [],
      sampleCellId: null,
      sampleReason: resolved.reason,
      completed: false,
      advancedRoute: false,
      movementSpeedMps: null,
    }
  }

  if (resolvedSample.kind === 'gps') {
    const sampleAgeMs = now - resolvedSample.capturedAt
    const isOlderThanLatest = session.lastSampleAt !== null && resolvedSample.capturedAt <= session.lastSampleAt

    if (sampleAgeMs > maximumGpsSampleAgeMs || isOlderThanLatest) {
      return {
        session,
        revealedCells: new Set(revealedCells),
        seenPlaceIds: new Set(seenPlaceIds),
        recentCells: [],
        discoveryPlaceIds: [],
        sampleCellId: resolved.cellId,
        sampleReason: 'stale-sample',
        completed: false,
        advancedRoute: false,
        movementSpeedMps: null,
      }
    }
  }

  if (resolvedSample.kind === 'gps' && session.lastGpsSample) {
    const movementSpeedMps = calculateGpsMovementSpeedMps(session.lastGpsSample, resolvedSample)

    if (movementSpeedMps !== null && movementSpeedMps > maximumWalkingSpeedMps) {
      return {
        session,
        revealedCells: new Set(revealedCells),
        seenPlaceIds: new Set(seenPlaceIds),
        recentCells: [],
        discoveryPlaceIds: [],
        sampleCellId: resolved.cellId,
        sampleReason: 'speed-too-fast',
        completed: false,
        advancedRoute: false,
        movementSpeedMps,
      }
    }
  }

  const nextRevealedCells = new Set(revealedCells)
  const recentCells = sampleNeighborhood(resolvedSample, city.id).filter((cellId) => !nextRevealedCells.has(cellId))

  recentCells.forEach((cellId) => nextRevealedCells.add(cellId))

  const discoveryPlaceIds = city.places
    .filter((place) => nextRevealedCells.has(place.cell) && !seenPlaceIds.has(place.id))
    .map((place) => place.id)
  const nextSeenPlaceIds = new Set([...seenPlaceIds, ...discoveryPlaceIds])
  const atRouteEnd = session.routeIndex >= city.walkRoute.length - 1
  const repeatCellSample = resolvedSample.kind === 'gps' && session.lastSampleCellId === resolved.cellId
  const shouldAdvanceRoute = !atRouteEnd && !repeatCellSample
  const nextIndex = shouldAdvanceRoute ? session.routeIndex + 1 : session.routeIndex
  const completed = atRouteEnd
  const nextRouteTrace = appendTrace(session.routeTrace, resolved.cellId)
  const nextAcceptedSampleCount = (session.acceptedSampleCount ?? 0) + 1
  const nextStatus = completed
    ? 'idle'
    : shouldAdvanceRoute
      ? session.status === 'background'
        ? 'background'
        : discoveryPlaceIds.length > 0
          ? 'paused'
          : 'running'
      : session.status
  const cityBounds = getCityGeoBounds(city.id)

  return {
    session: {
      ...session,
      routeIndex: nextIndex,
      routeTrace: nextRouteTrace,
      acceptedSampleCount: nextAcceptedSampleCount,
      lastSampleAt: now,
      lastSampleCellId: resolved.cellId,
      lastGpsSample: resolvedSample.kind === 'gps' && cityBounds ? resolvedSample : session.lastGpsSample ?? null,
      status: nextStatus,
      pausedAt: shouldAdvanceRoute && discoveryPlaceIds.length > 0 ? now : session.pausedAt,
    },
    revealedCells: nextRevealedCells,
    seenPlaceIds: nextSeenPlaceIds,
    recentCells,
    discoveryPlaceIds,
    sampleCellId: resolved.cellId,
    sampleReason: resolved.reason,
    completed,
    advancedRoute: shouldAdvanceRoute,
    movementSpeedMps: null,
  }
}
