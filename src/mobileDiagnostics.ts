import { getCityGeoBounds } from './cityGeoBounds'
import { approximateCellSizeMeters, distanceMeters } from './geoGrid'
import type { GpsLocationSample } from './locationAdapter'
import { getGpsRevealRadius, maximumAcceptedGpsAccuracyM, sampleToCellId } from './locationAdapter'

export type MobileGpsDiagnosticInput = {
  cityId: string
  sample: GpsLocationSample
  previousSample?: GpsLocationSample | null
}

export type MobileGpsDiagnostic = {
  status: 'accepted' | 'rejected'
  reason: string
  cellId: string | null
  revealRadius: number
  accuracyLabel: string
  speedMps: number | null
  cityCellSize: {
    widthMeters: number
    heightMeters: number
  } | null
  messages: string[]
}

function roundMetric(value: number) {
  return Math.round(value * 10) / 10
}

function describeAccuracy(accuracyM: number) {
  if (!Number.isFinite(accuracyM)) {
    return 'Unknown accuracy'
  }

  if (accuracyM <= 15) {
    return 'High accuracy'
  }

  if (accuracyM <= 25) {
    return 'Good accuracy'
  }

  if (accuracyM <= maximumAcceptedGpsAccuracyM) {
    return 'Coarse accuracy'
  }

  return 'Too inaccurate'
}

function describeMovement(previousSample: GpsLocationSample | null | undefined, sample: GpsLocationSample) {
  if (!previousSample) {
    return {
      speedMps: null,
      message: 'No previous GPS sample yet; movement speed cannot be evaluated.',
    }
  }

  const elapsedSeconds = (sample.capturedAt - previousSample.capturedAt) / 1000

  if (elapsedSeconds <= 0) {
    return {
      speedMps: null,
      message: 'GPS sample timestamp did not move forward.',
    }
  }

  const meters = distanceMeters(
    { latitude: previousSample.latitude, longitude: previousSample.longitude },
    { latitude: sample.latitude, longitude: sample.longitude },
  )
  const speedMps = meters / elapsedSeconds

  return {
    speedMps,
    message: `Moved ${roundMetric(meters)} m in ${roundMetric(elapsedSeconds)} s (${roundMetric(speedMps)} m/s).`,
  }
}

export function buildMobileGpsDiagnostic({ cityId, sample, previousSample }: MobileGpsDiagnosticInput): MobileGpsDiagnostic {
  const result = sampleToCellId(sample, cityId)
  const revealRadius = getGpsRevealRadius(sample.accuracyM)
  const bounds = getCityGeoBounds(cityId)
  const cityCellSize = bounds ? approximateCellSizeMeters(bounds) : null
  const movement = describeMovement(previousSample, sample)
  const messages = [
    `${describeAccuracy(sample.accuracyM)} (${roundMetric(sample.accuracyM)} m).`,
    movement.message,
  ]

  if (!bounds) {
    messages.push('Selected city does not have GPS bounds configured yet.')
  }

  if (result.reason === 'unmapped') {
    messages.push('The GPS sample is outside the selected city bounds or cannot be projected into the atlas.')
  }

  if (result.reason === 'accuracy-too-low') {
    messages.push(`Accuracy must be ${maximumAcceptedGpsAccuracyM} m or better before a GPS sample can reveal cells.`)
  }

  if (result.accepted && revealRadius === 0) {
    messages.push('The sample is accepted, but only the current cell is revealed because accuracy is coarse.')
  }

  if (result.accepted && revealRadius > 0) {
    messages.push('The sample is accepted and reveals the current cell plus neighboring cells.')
  }

  return {
    status: result.accepted ? 'accepted' : 'rejected',
    reason: result.reason,
    cellId: result.cellId,
    revealRadius,
    accuracyLabel: describeAccuracy(sample.accuracyM),
    speedMps: movement.speedMps,
    cityCellSize: cityCellSize
      ? {
          widthMeters: roundMetric(cityCellSize.widthMeters),
          heightMeters: roundMetric(cityCellSize.heightMeters),
        }
      : null,
    messages,
  }
}
