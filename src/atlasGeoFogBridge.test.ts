import { describe, expect, it } from 'vitest'
import { getAtlasFogSnapshot } from './atlasGeoFogBridge'

describe('atlasGeoFogBridge', () => {
  it('exposes the initial fog snapshot through the public API', () => {
    expect(getAtlasFogSnapshot()).toEqual({
      cityKey: null,
      progress: 0,
      revealedPoints: 0,
    })
  })
})
