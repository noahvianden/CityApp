import { describe, expect, it } from 'vitest'
import { getRevealRadiusMeters, pointToFeature } from './appDomain'

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
})
