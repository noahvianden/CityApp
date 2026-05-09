import { describe, expect, it } from 'vitest'
import { cityGeoBoundsById } from './cityGeoBounds'
import {
  approximateCellSizeMeters,
  cellCenterToGeoPoint,
  cellIdFromGridPoint,
  containsGeoPoint,
  distanceMeters,
  expandGeoBounds,
  geoPointToCellId,
  hasUsableGeoBounds,
  projectGeoPointToGrid,
} from './geoGrid'

describe('geo grid', () => {
  it('validates and expands city bounds', () => {
    const berlin = cityGeoBoundsById.berlin
    const expanded = expandGeoBounds(berlin, 100)

    expect(hasUsableGeoBounds(berlin)).toBe(true)
    expect(expanded.north).toBeGreaterThan(berlin.north)
    expect(expanded.south).toBeLessThan(berlin.south)
    expect(expanded.east).toBeGreaterThan(berlin.east)
    expect(expanded.west).toBeLessThan(berlin.west)
  })

  it('projects real Berlin GPS coordinates into atlas grid cells', () => {
    const berlin = cityGeoBoundsById.berlin
    const brandenburgGate = {
      latitude: 52.5163,
      longitude: 13.3777,
    }

    const gridPoint = projectGeoPointToGrid(brandenburgGate, berlin)

    expect(gridPoint).not.toBeNull()
    expect(gridPoint!.x).toBeGreaterThanOrEqual(0)
    expect(gridPoint!.x).toBeLessThanOrEqual(100)
    expect(gridPoint!.y).toBeGreaterThanOrEqual(0)
    expect(gridPoint!.y).toBeLessThanOrEqual(100)
    expect(geoPointToCellId(berlin, brandenburgGate)).toMatch(/^\d-\d$/)
  })

  it('rejects points outside the selected city bounds', () => {
    const berlin = cityGeoBoundsById.berlin
    const hamburgCenter = {
      latitude: 53.5511,
      longitude: 9.9937,
    }

    expect(containsGeoPoint(hamburgCenter, berlin)).toBe(false)
    expect(geoPointToCellId(berlin, hamburgCenter)).toBeNull()
  })

  it('round-trips a cell center through geo coordinates', () => {
    const berlin = cityGeoBoundsById.berlin
    const center = cellCenterToGeoPoint(berlin, '3-4')

    expect(center).not.toBeNull()
    expect(geoPointToCellId(berlin, center!)).toBe('3-4')
  })

  it('converts grid positions to bounded cell ids', () => {
    expect(cellIdFromGridPoint({ x: 0, y: 0 })).toBe('0-0')
    expect(cellIdFromGridPoint({ x: 99.9, y: 99.9 })).toBe('6-7')
    expect(cellIdFromGridPoint({ x: 100, y: 100 })).toBe('6-7')
  })

  it('calculates useful distance and approximate cell size metrics', () => {
    const berlin = cityGeoBoundsById.berlin
    const size = approximateCellSizeMeters(berlin)
    const oneKilometerish = distanceMeters(
      { latitude: 52.52, longitude: 13.4 },
      { latitude: 52.52, longitude: 13.4148 },
    )

    expect(size.widthMeters).toBeGreaterThan(1000)
    expect(size.heightMeters).toBeGreaterThan(1000)
    expect(oneKilometerish).toBeGreaterThan(900)
    expect(oneKilometerish).toBeLessThan(1100)
  })
})
