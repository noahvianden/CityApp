import { describe, expect, it } from 'vitest'
import { cities } from './cityprintData'
import { getDiscoveryReviewState } from './discoveryFlow'

describe('discovery flow', () => {
  it('promotes the next pending place to the featured slot', () => {
    const city = cities[0]
    const state = getDiscoveryReviewState(city.places.slice(0, 4), ['linden-cafe'])

    expect(state.featuredDiscoveryPlace?.id).toBe('canal-bench')
    expect(state.reviewedDiscoveryPlaces.map((place) => place.id)).toEqual(['linden-cafe'])
    expect(state.pendingDiscoveryPlaces.map((place) => place.id)).toEqual(['canal-bench', 'arcade-house', 'north-market'])
    expect(state.secondaryDiscoveryPlaces.map((place) => place.id)).toEqual(['linden-cafe', 'arcade-house', 'north-market'])
  })

  it('falls back to the first place once every discovery has been reviewed', () => {
    const city = cities[0]
    const state = getDiscoveryReviewState(city.places.slice(0, 3), ['linden-cafe', 'canal-bench', 'arcade-house'])

    expect(state.featuredDiscoveryPlace?.id).toBe('linden-cafe')
    expect(state.pendingDiscoveryPlaces).toHaveLength(0)
    expect(state.secondaryDiscoveryPlaces.map((place) => place.id)).toEqual(['canal-bench', 'arcade-house'])
  })
})
