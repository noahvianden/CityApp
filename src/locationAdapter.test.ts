import { describe, expect, it } from 'vitest'
import { cityGeoBoundsById } from './cityGeoBounds'
import { cellCenterToGeoPoint } from './geoGrid'
import {
  createSimulatedWalkSamples,
  getGpsRevealRadius,
  nextSampleFromRoute,
  sampleNeighborhood,
  sampleToCellId,
} from './locationAdapter'

function gpsSampleForCell(cityId: keyof typeof cityGeoBoundsById, cellId: string, capturedAt = 1, accuracyM = 15) {
  const point = cellCenterToGeoPoint(cityGeoBoundsById[cityId], cellId)

  if (!point) {
    throw new Error(`Could not create GPS sample for ${cityId}/${cellId}`)
  }

  return {
    kind: 'gps' as const,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyM,
    capturedAt,
  }
}

describe('location adapter', () => {
  it('passes through simulated samples as cells without city context', () => {
    const sample = nextSampleFromRoute(['3-6'], 0, 1000)

    expect(sampleToCellId(sample!)).toEqual({
      cellId: '3-6',
      accepted: true,
      reason: 'simulated',
    })
  })

  it('rejects low-accuracy gps samples before city mapping', () => {
    expect({
      ...sampleToCellId(gpsSampleForCell('berlin', '3-4', 1, 100), 'berlin'),
    }).toEqual({
      cellId: null,
      accepted: false,
      reason: 'accuracy-too-low',
    })
  })

  it('maps city-bounded gps samples to real atlas cells', () => {
    expect(sampleToCellId(gpsSampleForCell('berlin', '3-4'), 'berlin')).toEqual({
      cellId: '3-4',
      accepted: true,
      reason: 'gps',
    })

    expect(sampleNeighborhood(gpsSampleForCell('berlin', '2-5'), 'berlin')).toContain('2-5')
  })

  it('uses GPS accuracy to determine reveal radius', () => {
    expect(getGpsRevealRadius(10)).toBe(1)
    expect(getGpsRevealRadius(25)).toBe(1)
    expect(getGpsRevealRadius(26)).toBe(0)
    expect(getGpsRevealRadius(50)).toBe(0)
    expect(getGpsRevealRadius(51)).toBe(0)

    const preciseSampleCells = sampleNeighborhood(gpsSampleForCell('berlin', '3-4', 1, 15), 'berlin')
    const coarseSampleCells = sampleNeighborhood(gpsSampleForCell('berlin', '3-4', 1, 40), 'berlin')

    expect(preciseSampleCells).toContain('2-3')
    expect(preciseSampleCells).toContain('3-4')
    expect(coarseSampleCells).toEqual(['3-4'])
  })

  it('rejects gps samples without a known or matching city', () => {
    expect(sampleToCellId(gpsSampleForCell('berlin', '3-4'))).toEqual({
      cellId: null,
      accepted: false,
      reason: 'unmapped',
    })

    expect(
      sampleToCellId(
        {
          kind: 'gps',
          latitude: 48.1372,
          longitude: 11.5756,
          accuracyM: 12,
          capturedAt: 1,
        },
        'berlin',
      ),
    ).toEqual({
      cellId: null,
      accepted: false,
      reason: 'unmapped',
    })
  })

  it('creates simulated walk samples and their neighborhood', () => {
    const samples = createSimulatedWalkSamples(['2-5', '3-5'], 1000, 500)

    expect(samples).toHaveLength(2)
    expect(samples[1].capturedAt).toBe(1500)
    expect(sampleNeighborhood(samples[0])).toContain('2-5')
  })
})
