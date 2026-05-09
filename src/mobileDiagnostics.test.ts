import { describe, expect, it } from 'vitest'
import { cityGeoBoundsById } from './cityGeoBounds'
import { cellCenterToGeoPoint } from './geoGrid'
import { buildMobileGpsDiagnostic } from './mobileDiagnostics'

function gpsSampleForCell(cellId: string, capturedAt = 1000, accuracyM = 12) {
  const point = cellCenterToGeoPoint(cityGeoBoundsById.berlin, cellId)

  if (!point) {
    throw new Error(`Could not create GPS sample for ${cellId}`)
  }

  return {
    kind: 'gps' as const,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyM,
    capturedAt,
  }
}

describe('mobile diagnostics', () => {
  it('summarizes accepted precise GPS samples', () => {
    const diagnostic = buildMobileGpsDiagnostic({
      cityId: 'berlin',
      sample: gpsSampleForCell('3-4', 1000, 12),
    })

    expect(diagnostic.status).toBe('accepted')
    expect(diagnostic.reason).toBe('gps')
    expect(diagnostic.cellId).toBe('3-4')
    expect(diagnostic.revealRadius).toBe(1)
    expect(diagnostic.accuracyLabel).toBe('High accuracy')
    expect(diagnostic.cityCellSize?.widthMeters).toBeGreaterThan(1000)
    expect(diagnostic.messages.join(' ')).toContain('neighboring cells')
  })

  it('summarizes accepted coarse GPS samples', () => {
    const diagnostic = buildMobileGpsDiagnostic({
      cityId: 'berlin',
      sample: gpsSampleForCell('3-4', 1000, 40),
    })

    expect(diagnostic.status).toBe('accepted')
    expect(diagnostic.reason).toBe('gps')
    expect(diagnostic.revealRadius).toBe(0)
    expect(diagnostic.accuracyLabel).toBe('Coarse accuracy')
    expect(diagnostic.messages.join(' ')).toContain('only the current cell')
  })

  it('summarizes rejected inaccurate GPS samples', () => {
    const diagnostic = buildMobileGpsDiagnostic({
      cityId: 'berlin',
      sample: gpsSampleForCell('3-4', 1000, 90),
    })

    expect(diagnostic.status).toBe('rejected')
    expect(diagnostic.reason).toBe('accuracy-too-low')
    expect(diagnostic.cellId).toBeNull()
    expect(diagnostic.messages.join(' ')).toContain('Accuracy must be')
  })

  it('summarizes rejected out-of-city GPS samples', () => {
    const diagnostic = buildMobileGpsDiagnostic({
      cityId: 'berlin',
      sample: {
        kind: 'gps',
        latitude: 48.1372,
        longitude: 11.5756,
        accuracyM: 12,
        capturedAt: 1000,
      },
    })

    expect(diagnostic.status).toBe('rejected')
    expect(diagnostic.reason).toBe('unmapped')
    expect(diagnostic.cellId).toBeNull()
    expect(diagnostic.messages.join(' ')).toContain('outside the selected city bounds')
  })

  it('reports movement speed when a previous GPS sample is available', () => {
    const diagnostic = buildMobileGpsDiagnostic({
      cityId: 'berlin',
      previousSample: gpsSampleForCell('3-5', 1000, 12),
      sample: gpsSampleForCell('3-4', 61000, 12),
    })

    expect(diagnostic.speedMps).not.toBeNull()
    expect(diagnostic.messages.join(' ')).toContain('Moved')
  })
})
