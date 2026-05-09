import type { City } from './cityprintData'
import type { LocationSample, LocationSampleResult } from './locationAdapter'
import { nextSampleFromRoute, sampleNeighborhood, sampleToCellId } from './locationAdapter'
import { cellDistance } from './revealModel'

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
}

export type WalkSampleReason = LocationSampleResult['reason'] | 'speed-too-fast' | 'stale-sample' | null

const minimumGpsCellTravelMs = 45000
const maximumGpsSampleAgeMs = 30000

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
      }
    }
  }

  if (resolvedSample.kind === 'gps' && session.lastSampleAt !== null && session.lastSampleCellId) {
    const elapsedMs = resolvedSample.capturedAt - session.lastSampleAt
    const movedCells = cellDistance(session.lastSampleCellId, resolved.cellId)
    const minimumTravelMs = movedCells * minimumGpsCellTravelMs

    if (movedCells > 0 && elapsedMs >= 0 && elapsedMs < minimumTravelMs) {
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

  return {
    session: {
      ...session,
      routeIndex: nextIndex,
      routeTrace: nextRouteTrace,
      acceptedSampleCount: nextAcceptedSampleCount,
      lastSampleAt: now,
      lastSampleCellId: resolved.cellId,
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
  }
}
