import { containsGeoPointInBoundary, fetchBoundaryForGpsPoint, type BoundedAtlasPoint } from './nominatimCityBoundaries'
import type { GpsLocationSample } from './locationAdapter'

export type LiveWalkStatus = 'idle' | 'starting' | 'walking' | 'paused' | 'error'

export type LiveWalkUpdate = {
  atlas: BoundedAtlasPoint | null
  matchedExistingBoundary: boolean
  message: string
}

export type LiveWalkDigest = {
  accuracyLabel: string
  cityLabel: string
  detail: string
  lastUpdatedLabel: string
  sampleCountLabel: string
}

function pointFromGpsSample(sample: GpsLocationSample) {
  return {
    latitude: sample.latitude,
    longitude: sample.longitude,
  }
}

function pointWithAccuracyFromGpsSample(sample: GpsLocationSample) {
  return {
    latitude: sample.latitude,
    longitude: sample.longitude,
    accuracyM: sample.accuracyM,
  }
}

export function formatLiveWalkAccuracy(accuracyM: number | undefined) {
  if (!accuracyM || !Number.isFinite(accuracyM)) {
    return 'accuracy unknown'
  }

  if (accuracyM < 100) {
    return `±${Math.round(accuracyM)} m`
  }

  return `±${(accuracyM / 1000).toFixed(1)} km`
}

export function formatLiveWalkTimestamp(capturedAt: number | undefined) {
  if (!capturedAt || !Number.isFinite(capturedAt)) {
    return 'waiting for GPS'
  }

  return new Date(capturedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function describeLiveWalkStatus(status: LiveWalkStatus, sampleCount: number) {
  if (status === 'starting') {
    return 'Starting continuous GPS...'
  }

  if (status === 'walking') {
    return sampleCount > 0 ? 'Live walk is tracking your position.' : 'Live walk is waiting for the first GPS sample.'
  }

  if (status === 'paused') {
    return 'Live walk is paused.'
  }

  if (status === 'error') {
    return 'Live walk needs GPS access.'
  }

  return 'Live walk is off.'
}

export function createLiveWalkDigest(
  status: LiveWalkStatus,
  sampleCount: number,
  sample: GpsLocationSample | null,
  atlas: BoundedAtlasPoint | null,
): LiveWalkDigest {
  return {
    accuracyLabel: formatLiveWalkAccuracy(sample?.accuracyM),
    cityLabel: atlas?.cityName ?? 'No city matched yet',
    detail: describeLiveWalkStatus(status, sampleCount),
    lastUpdatedLabel: formatLiveWalkTimestamp(sample?.capturedAt),
    sampleCountLabel: `${sampleCount} GPS ${sampleCount === 1 ? 'sample' : 'samples'}`,
  }
}

export async function applyLiveWalkGpsSample(
  currentAtlas: BoundedAtlasPoint | null,
  sample: GpsLocationSample,
): Promise<LiveWalkUpdate> {
  const point = pointFromGpsSample(sample)
  const pointWithAccuracy = pointWithAccuracyFromGpsSample(sample)

  if (currentAtlas && containsGeoPointInBoundary(point, currentAtlas.boundary)) {
    return {
      atlas: {
        ...currentAtlas,
        cityStatus: 'GPS live',
        point: pointWithAccuracy,
      },
      matchedExistingBoundary: true,
      message: `Live GPS updated inside ${currentAtlas.cityName}.`,
    }
  }

  const nextBoundary = await fetchBoundaryForGpsPoint(point)

  if (nextBoundary) {
    return {
      atlas: {
        ...nextBoundary,
        cityStatus: 'GPS live',
        point: pointWithAccuracy,
      },
      matchedExistingBoundary: false,
      message: `Live GPS matched ${nextBoundary.cityName}.`,
    }
  }

  return {
    atlas: currentAtlas,
    matchedExistingBoundary: false,
    message: 'GPS sample received, but no city boundary matched this point.',
  }
}
