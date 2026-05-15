import { describe, expect, it } from 'vitest'
import { getRevealRadiusMeters, gpsSampleToAtlasPoint, isAtlasPointInsideBoundary, pointToFeature } from './appDomain'
import type { GpsLocationSample } from './locationAdapter'
import type { BoundedAtlasPoint } from './nominatimCityBoundaries'

describe('appDomain reveal radius', () => {
  it('keeps the full reveal radius for strong GPS samples', () => {
    expect(getRevealRadiusMeters(12)).toBe(82)
    expect(getRevealRadiusMeters(25)).toBe(82)
  })

  it('reduces reveal radius for weaker but accepted GPS samples', () => {
    expect(getRevealRadiusMeters(37.5)).toBe(58)
    expect(getRevealRadiusMeters(50)).toBe(34)
  })

  it('stores the reveal radius on map point features', () => {
    const feature = pointToFeature({ latitude: 52.52, longitude: 13.405, accuracyM: 40 }, 'gps')

    expect(feature.properties.revealRadiusMeters).toBe(getRevealRadiusMeters(40))
  })

  it('converts a native GPS watch sample into an atlas point', () => {
    const sample: GpsLocationSample = {
      kind: 'gps',
      latitude: 52.52,
      longitude: 13.405,
      accuracyM: 18,
      capturedAt: 1234,
    }

    expect(gpsSampleToAtlasPoint(sample)).toEqual({
      latitude: 52.52,
      longitude: 13.405,
      accuracyM: 18,
    })
  })

  it('detects whether a GPS point remains inside the current atlas boundary', () => {
    const atlas = {
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [13.3, 52.4],
            [13.5, 52.4],
            [13.5, 52.6],
            [13.3, 52.6],
            [13.3, 52.4],
          ],
        ],
      },
    } as BoundedAtlasPoint

    expect(isAtlasPointInsideBoundary({ latitude: 52.52, longitude: 13.405 }, atlas)).toBe(true)
    expect(isAtlasPointInsideBoundary({ latitude: 52.7, longitude: 13.405 }, atlas)).toBe(false)
  })
})
