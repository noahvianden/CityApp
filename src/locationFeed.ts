import type { LocationSettings } from './appState'
import type { City } from './cityprintData'
import type { LocationSample } from './locationAdapter'
import { nextSampleFromRoute } from './locationAdapter'
import type { WalkSession } from './walkController'

export type LocationFeedTone = 'info' | 'live' | 'warning'

export type LocationFeedState = {
  mode: LocationSettings['mode']
  permission: LocationSettings['permission']
  status: 'idle' | 'running' | 'background' | 'blocked'
  lastReason: 'simulated' | 'gps' | 'permission-pending' | 'permission-denied' | 'privacy-blocked' | 'waiting' | 'background'
}

export type LocationFeedProvider = {
  intervalMs: number
  describe(session: WalkSession, preciseLocationEnabled?: boolean): LocationFeedState
  isActive(session: WalkSession, preciseLocationEnabled?: boolean): boolean
  createSample(city: Pick<City, 'walkRoute'>, session: WalkSession, now?: number, preciseLocationEnabled?: boolean): LocationSample | null
}

export type LocationPipelineSummary = {
  title: string
  detail: string
  nextAction: string
  modeLabel: string
  permissionLabel: string
  sampleLabel: string
  statusLabel: string
}

export type LocationSampleOutcome = {
  title: string
  detail: string
  tone: LocationFeedTone
}

type LocationSampleOutcomeInput = {
  sampleKind: LocationSample['kind']
  acceptedSampleCount: number
  sampleReason: 'simulated' | 'gps' | 'accuracy-too-low' | 'unmapped' | 'speed-too-fast' | 'stale-sample' | null
  discoveryPlaceCount: number
  sampleCellId: string | null
  advancedRoute: boolean
}

const permissionLabels: Record<LocationSettings['permission'], string> = {
  'not-requested': 'Permission pending',
  granted: 'Permission granted',
  denied: 'Permission denied',
}

const statusLabels: Record<LocationFeedState['status'], string> = {
  idle: 'Idle',
  running: 'Running',
  background: 'Background',
  blocked: 'Blocked',
}

const sampleReasonLabels: Record<LocationFeedState['lastReason'], string> = {
  simulated: 'Simulated route sample',
  gps: 'Device geolocation sample',
  'permission-pending': 'Permission pending',
  'permission-denied': 'Permission blocked',
  'privacy-blocked': 'Precise location off',
  waiting: 'Waiting for walk start',
  background: 'Background capture',
}

function formatSampleOrdinal(acceptedSampleCount: number) {
  return `Accepted sample #${acceptedSampleCount}`
}

function describeSampleRejection(sampleReason: NonNullable<LocationSampleOutcomeInput['sampleReason']>) {
  if (sampleReason === 'accuracy-too-low') {
    return 'Accuracy is above 50 m.'
  }

  if (sampleReason === 'stale-sample') {
    return 'The sample arrived too late.'
  }

  if (sampleReason === 'speed-too-fast') {
    return 'Movement was too fast for walking.'
  }

  if (sampleReason === 'unmapped') {
    return 'No nearby cell matched the sample.'
  }

  return 'The sample was not accepted.'
}

export function describeLocationSampleOutcome({
  sampleKind,
  acceptedSampleCount,
  sampleReason,
  discoveryPlaceCount,
  sampleCellId,
  advancedRoute,
}: LocationSampleOutcomeInput): LocationSampleOutcome {
  if (sampleKind === 'gps' && sampleReason && sampleReason !== 'gps') {
    return {
      title: 'GPS sample ignored',
      detail: `${describeSampleRejection(sampleReason)} The walk stayed on ${sampleCellId ?? 'the current cell'}.`,
      tone: 'warning',
    }
  }

  const prefix = sampleKind === 'gps' ? 'GPS sample accepted' : 'Simulated sample accepted'

  if (!advancedRoute) {
    return {
      title: prefix,
      detail: `${formatSampleOrdinal(acceptedSampleCount)} stayed in ${sampleCellId ?? 'the current cell'} without advancing the route.`,
      tone: 'info',
    }
  }

  if (discoveryPlaceCount > 0) {
    return {
      title: prefix,
      detail: `${formatSampleOrdinal(acceptedSampleCount)} revealed ${discoveryPlaceCount} new place${discoveryPlaceCount === 1 ? '' : 's'} and paused the walk.`,
      tone: 'live',
    }
  }

  return {
    title: prefix,
    detail: `${formatSampleOrdinal(acceptedSampleCount)} mapped to ${sampleCellId ?? 'the current cell'}.`,
    tone: 'info',
  }
}

export function createLocationFeedProvider(location: LocationSettings): LocationFeedProvider {
  return {
    intervalMs: 2000,
    describe(session, preciseLocationEnabled = true) {
      if (location.mode === 'gps' && !preciseLocationEnabled) {
        return {
          mode: location.mode,
          permission: location.permission,
          status: 'blocked',
          lastReason: 'privacy-blocked',
        }
      }

      if (location.mode === 'gps' && location.permission !== 'granted') {
        return {
          mode: location.mode,
          permission: location.permission,
          status: 'blocked',
          lastReason: location.permission === 'denied' ? 'permission-denied' : 'permission-pending',
        }
      }

      if (session.status === 'background') {
        return {
          mode: location.mode,
          permission: location.permission,
          status: 'background',
          lastReason: 'background',
        }
      }

      if (session.status !== 'running') {
        return {
          mode: location.mode,
          permission: location.permission,
          status: 'idle',
          lastReason: 'waiting',
        }
      }

      return {
        mode: location.mode,
        permission: location.permission,
        status: 'running',
        lastReason: location.mode === 'simulated' ? 'simulated' : 'gps',
      }
    },
    isActive(session, preciseLocationEnabled = true) {
      if (location.mode === 'simulated') {
        return session.status === 'running'
      }

      return preciseLocationEnabled && (session.status === 'running' || session.status === 'background') && location.permission === 'granted'
    },
    createSample(city, session, now = Date.now(), preciseLocationEnabled = true) {
      if (!this.isActive(session, preciseLocationEnabled)) {
        return null
      }

      if (location.mode === 'simulated') {
        return nextSampleFromRoute(city.walkRoute, session.routeIndex + 1, now)
      }

      const latitude = Number.parseFloat(location.gpsLatitude)
      const longitude = Number.parseFloat(location.gpsLongitude)
      const accuracyM = Number.parseFloat(location.gpsAccuracy)

      if (Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(accuracyM)) {
        return null
      }

      return {
        kind: 'gps',
        latitude,
        longitude,
        accuracyM,
        capturedAt: now,
      }
    },
  }
}

export function describeLocationPipeline(location: LocationSettings, locationFeed: LocationFeedState, session: WalkSession): LocationPipelineSummary {
  const modeLabel = location.mode === 'gps' ? 'GPS' : 'Simulated'
  const permissionLabel = permissionLabels[location.permission]
  const statusLabel = statusLabels[locationFeed.status]
  const sampleLabel = sampleReasonLabels[locationFeed.lastReason]

  if (location.mode === 'gps' && locationFeed.lastReason === 'privacy-blocked') {
    return {
      title: 'Precise location disabled',
      detail: 'GPS samples stay paused until precise location is enabled in Privacy.',
      nextAction: 'Open Privacy and turn on precise location before requesting device geolocation.',
      modeLabel,
      permissionLabel,
      sampleLabel,
      statusLabel,
    }
  }

  if (location.mode === 'simulated') {
    if (locationFeed.status === 'background') {
      return {
        title: 'Simulated feed backgrounded',
        detail: 'Simulated samples stay paused while the app is hidden. Return and resume the walk to keep revealing the city.',
        nextAction: 'Return to the app and resume the walk when you are ready.',
        modeLabel,
        permissionLabel,
        sampleLabel,
        statusLabel,
      }
    }

    return {
      title: 'Simulated feed active',
      detail: 'Auto route samples advance the walk every 2 seconds and reveal adjacent cells.',
      nextAction: session.status === 'running' ? 'Pause or background the walk when you want to inspect discoveries.' : 'Start the walk to begin simulated movement.',
      modeLabel,
      permissionLabel,
      sampleLabel,
      statusLabel,
    }
  }

  if (locationFeed.status === 'blocked') {
    const permissionTitle = location.permission === 'denied' ? 'GPS feed blocked' : 'GPS feed waiting for permission'
    const permissionDetail =
      location.permission === 'denied'
        ? 'Grant device location access before samples can be ingested in the GPS lane.'
        : 'Request device location access before samples can be ingested in the GPS lane.'

    return {
      title: permissionTitle,
      detail: permissionDetail,
      nextAction:
        location.permission === 'denied'
          ? 'Open Privacy and allow device location access to enable GPS samples.'
          : 'Request device location access, then resume the walk to accept GPS samples.',
      modeLabel,
      permissionLabel,
      sampleLabel,
      statusLabel,
    }
  }

  if (locationFeed.status === 'background') {
    return {
      title: 'GPS feed running in background',
      detail: 'Device geolocation can keep flowing while the app is hidden, so discovery can continue without losing progress.',
      nextAction: 'Return to the app to review the newly revealed cells and places.',
      modeLabel,
      permissionLabel,
      sampleLabel,
      statusLabel,
    }
  }

  if (session.status !== 'running') {
    return {
      title: 'GPS feed waiting',
      detail: 'The GPS lane is staged, but the walk needs to be running before samples are accepted.',
      nextAction: 'Start the walk, then ingest a sample or let the feed advance automatically.',
      modeLabel,
      permissionLabel,
      sampleLabel,
      statusLabel,
    }
  }

  return {
    title: 'GPS feed active',
    detail: 'Device geolocation samples are accepted as they arrive while the walk is running. Stale samples are ignored before they can advance the route.',
    nextAction:
      locationFeed.lastReason === 'gps'
        ? 'Keep walking or background the app to keep the location feed alive.'
        : 'Request device location if you want the active pipeline to receive live samples.',
    modeLabel,
    permissionLabel,
    sampleLabel,
    statusLabel,
  }
}
