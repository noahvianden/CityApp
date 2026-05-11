import { describe, expect, it } from 'vitest'
import { cellDistance, mapCells, revealAround } from './revealModel'

describe('revealModel', () => {
  it('builds the expected grid', () => {
    expect(mapCells).toHaveLength(56)
    expect(mapCells[0]).toMatchObject({ id: '0-0', x: 0, y: 0 })
    expect(mapCells.at(-1)).toMatchObject({ id: '6-7', x: 6, y: 7 })
  })

  it('reveals neighbors with a chebyshev radius', () => {
    expect(revealAround('3-4', 1)).toHaveLength(9)
    expect(cellDistance('0-0', '2-3')).toBe(3)
  })
})
