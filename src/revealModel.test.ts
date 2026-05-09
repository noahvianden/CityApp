import { describe, expect, it } from 'vitest'
import { cities } from './cityprintData'
import { advanceWalkReveal, classifyFogCell, getVisiblePlaces, revealAround } from './revealModel'

describe('reveal model', () => {
  it('reveals the current cell and adjacent cells in a one-cell radius', () => {
    expect(revealAround('3-3').sort()).toEqual(['2-2', '2-3', '2-4', '3-2', '3-3', '3-4', '4-2', '4-3', '4-4'])
  })

  it('marks neighboring cells partial without making them revealed', () => {
    const revealedCells = new Set(['3-3'])

    expect(classifyFogCell('3-3', revealedCells, new Set())).toBe('revealed')
    expect(classifyFogCell('3-4', revealedCells, new Set())).toBe('partial')
    expect(classifyFogCell('6-7', revealedCells, new Set())).toBe('hidden')
    expect(classifyFogCell('3-3', revealedCells, new Set(['3-3']))).toBe('recent')
  })

  it('only exposes places in revealed cells and respects hidden place ids', () => {
    const city = cities[0]
    const revealedCells = new Set(['3-5', '4-4'])

    expect(getVisiblePlaces(city.places, revealedCells).map((place) => place.id)).toEqual(['linden-cafe', 'arcade-house'])
    expect(getVisiblePlaces(city.places, revealedCells, new Set(['arcade-house'])).map((place) => place.id)).toEqual(['linden-cafe'])
  })

  it('advances a walk, returns new discoveries, and pauses when places appear', () => {
    const city = cities[0]
    const result = advanceWalkReveal({
      city,
      routeIndex: 0,
      revealedCells: new Set(city.initialRevealed),
      seenPlaceIds: new Set(['linden-cafe', 'canal-bench']),
    })

    expect(result.nextIndex).toBe(1)
    expect(result.newlyRevealedCells).toContain('2-4')
    expect(result.newPlaceIds).toEqual(['arcade-house', 'station-hall'])
    expect(result.nextSeenPlaceIds.has('arcade-house')).toBe(true)
    expect(result.shouldPauseForDiscovery).toBe(true)
  })
})
