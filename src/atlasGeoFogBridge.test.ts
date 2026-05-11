import { describe, expect, it } from 'vitest'
import { createFogFeatureCollection } from './atlasGeoFogBridge'

describe('atlasGeoFogBridge', () => {
  it('renders fog as a boundary polygon with reveal holes instead of a cell grid', () => {
    const state: Parameters<typeof createFogFeatureCollection>[0] = {
      map: null as never,
      bounds: { west: 0, south: 0, east: 10, north: 10 },
      cityKey: '0:0:10:10',
      boundaryPolygons: [{
        outer: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        holes: [],
      }],
      revealPoints: [{ lng: 5, lat: 5, revealedAt: 1 }],
      progress: 0,
      fogCells: 0,
    }

    const collection = createFogFeatureCollection(state)

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].geometry.type).toBe('Polygon')
    expect(collection.features[0].geometry.coordinates).toHaveLength(2)
    expect(collection.features[0].geometry.coordinates[1].length).toBeGreaterThan(4)
    expect(state.fogCells).toBe(1)
  })
})
