import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GpsLocationSample } from './locationAdapter'

const nativeRuntimeMocks = vi.hoisted(() => ({
  getLatestNativeWatchSample: vi.fn(),
  getNativeCurrentLocation: vi.fn(),
  isNativeRuntime: vi.fn(),
  requestNativeLocationPermission: vi.fn(),
}))

vi.mock('./nativeRuntime', () => nativeRuntimeMocks)

import { getCurrentLocation, getRevealRadiusMeters, pointToFeature } from './appDomain'

describe('appDomain reveal radius', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

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

  it('uses the cached native watch sample before requesting a fresh location', async () => {
    const sample: GpsLocationSample = {
      kind: 'gps',
      latitude: 52.52,
      longitude: 13.405,
      accuracyM: 12,
      capturedAt: 1_000_000,
    }

    nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true)
    nativeRuntimeMocks.getLatestNativeWatchSample.mockReturnValue(sample)

    await expect(getCurrentLocation()).resolves.toEqual(sample)
    expect(nativeRuntimeMocks.requestNativeLocationPermission).not.toHaveBeenCalled()
    expect(nativeRuntimeMocks.getNativeCurrentLocation).not.toHaveBeenCalled()
  })
})
