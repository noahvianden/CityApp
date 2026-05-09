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

const cellCenters = new Map(
  mapCells.map((cell) => [
    cell.id,
    {
      x: cell.left,
      y: cell.top,
    },
  ]),
)

export function createSimulatedWalkSamples(route: string[], startTime = Date.now(), stepMs = 1000): SimulatedLocationSample[] {
  return route.map((cellId, index) => ({
    kind: 'simulated',
    cellId,
    capturedAt: startTime + index * stepMs,
  }))
}

export function sampleToCellId(sample: LocationSample): LocationSampleResult {
  if (sample.kind === 'simulated') {
    return {
      cellId: sample.cellId,
      accepted: true,
      reason: 'simulated',
    }
  }

  if (sample.accuracyM > 50) {
    return {
      cellId: null,
      accepted: false,
      reason: 'accuracy-too-low',
    }
  }

  const normalizedX = Math.max(0, Math.min(100, sample.longitude))
  const normalizedY = Math.max(0, Math.min(100, sample.latitude))

  let bestCellId: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const [cellId, center] of cellCenters.entries()) {
    const distance = Math.hypot(center.x - normalizedX, center.y - normalizedY)

    if (distance < bestDistance) {
      bestDistance = distance
      bestCellId = cellId
    }
  }

  return bestCellId
    ? {
        cellId: bestCellId,
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

export function samplesRevealCells(samples: LocationSample[]) {
  return samples
    .map((sample) => sampleToCellId(sample))
    .filter((result): result is LocationSampleResult & { cellId: string } => Boolean(result.cellId && result.accepted))
    .map((result) => result.cellId)
}

export function routeMatchesCell(route: string[], sample: LocationSample) {
  const result = sampleToCellId(sample)

  return Boolean(result.cellId && route.includes(result.cellId))
}

export function sampleNeighborhood(sample: LocationSample) {
  const result = sampleToCellId(sample)

  if (!result.cellId) {
    return []
  }

  return mapCells.filter((cell) => cellDistance(cell.id, result.cellId!) <= 1).map((cell) => cell.id)
}
