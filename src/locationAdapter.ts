import { getCityGeoBounds } from './cityGeoBounds'
import { geoPointToCellId } from './geoGrid'
import { mapCells, cellDistance } from './revealModel'

export type SimulatedLocationSample = {
  kind: 'simulated'
  cellId: string
  capturedAt: number
}

export type GpsLocationSample = {
  kind: 'gps'
  latitude: number
  longitude: number
  accuracyM: number
  capturedAt: number
}

export type LocationSample = SimulatedLocationSample | GpsLocationSample

export type LocationSampleResult = {
  cellId: string | null
  accepted: boolean
  reason: 'simulated' | 'gps' | 'accuracy-too-low' | 'unmapped'
}

export const maximumAcceptedGpsAccuracyM = 50
export const fullRevealGpsAccuracyM = 25

export function getGpsRevealRadius(accuracyM: number) {
  if (!Number.isFinite(accuracyM) || accuracyM > maximumAcceptedGpsAccuracyM) {
    return 0
  }

  return accuracyM <= fullRevealGpsAccuracyM ? 1 : 0
}

export function getSampleRevealRadius(sample: LocationSample) {
  return sample.kind === 'simulated' ? 1 : getGpsRevealRadius(sample.accuracyM)
}

export function createSimulatedWalkSamples(route: string[], startTime = Date.now(), stepMs = 1000): SimulatedLocationSample[] {
  return route.map((cellId, index) => ({
    kind: 'simulated',
    cellId,
    capturedAt: startTime + index * stepMs,
  }))
}

export function sampleToCellId(sample: LocationSample, cityId?: string): LocationSampleResult {
  if (sample.kind === 'simulated') {
    return {
      cellId: sample.cellId,
      accepted: true,
      reason: 'simulated',
    }
  }

  if (sample.accuracyM > maximumAcceptedGpsAccuracyM) {
    return {
      cellId: null,
      accepted: false,
      reason: 'accuracy-too-low',
    }
  }

  if (!cityId) {
    return {
      cellId: null,
      accepted: false,
      reason: 'unmapped',
    }
  }

  const bounds = getCityGeoBounds(cityId)
  const cellId = bounds
    ? geoPointToCellId(bounds, {
        latitude: sample.latitude,
        longitude: sample.longitude,
      })
    : null

  return cellId
    ? {
        cellId,
        accepted: true,
        reason: 'gps',
      }
    : {
        cellId: null,
        accepted: false,
        reason: 'unmapped',
      }
}

export function nextSampleFromRoute(route: string[], index: number, capturedAt = Date.now()): LocationSample | null {
  const cellId = route[index]

  if (!cellId) {
    return null
  }

  return {
    kind: 'simulated',
    cellId,
    capturedAt,
  }
}

export function samplesRevealCells(samples: LocationSample[], cityId?: string) {
  return samples
    .map((sample) => sampleToCellId(sample, cityId))
    .filter((result): result is LocationSampleResult & { cellId: string } => Boolean(result.cellId && result.accepted))
    .map((result) => result.cellId)
}

export function routeMatchesCell(route: string[], sample: LocationSample, cityId?: string) {
  const result = sampleToCellId(sample, cityId)

  return Boolean(result.cellId && route.includes(result.cellId))
}

export function sampleNeighborhood(sample: LocationSample, cityId?: string) {
  const result = sampleToCellId(sample, cityId)

  if (!result.cellId) {
    return []
  }

  const revealRadius = getSampleRevealRadius(sample)

  return mapCells.filter((cell) => cellDistance(cell.id, result.cellId!) <= revealRadius).map((cell) => cell.id)
}
