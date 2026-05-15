export type Coordinate = [number, number]
export type Ring = Coordinate[]
export type Boundary = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
export type Bounds = { west: number; south: number; east: number; north: number }
export type LngLatPoint = { lng: number; lat: number }

const earthRadiusMeters = 6_371_000

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1])
}

function normalizeRing(value: unknown): Ring | null {
  if (!Array.isArray(value)) return null

  const ring = value.filter(isCoordinate).map(([lng, lat]) => [lng, lat] as Coordinate)
  if (ring.length < 4) return null

  const [firstLng, firstLat] = ring[0]
  const [lastLng, lastLat] = ring[ring.length - 1]
  if (firstLng !== lastLng || firstLat !== lastLat) ring.push([firstLng, firstLat])

  return ring
}

function normalizePolygon(value: unknown): Ring[] | null {
  if (!Array.isArray(value)) return null

  const rings = value.map(normalizeRing).filter((ring): ring is Ring => Boolean(ring))
  return rings.length ? rings : null
}

export function normalizeBoundary(value: unknown): Boundary | null {
  if (!value || typeof value !== 'object') return null

  const geometry = value as { type?: unknown; coordinates?: unknown }
  if (geometry.type === 'Polygon') {
    const polygon = normalizePolygon(geometry.coordinates)
    return polygon ? { type: 'Polygon', coordinates: polygon } : null
  }

  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const polygons = geometry.coordinates.map(normalizePolygon).filter((polygon): polygon is Ring[] => Boolean(polygon))
    return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null
  }

  return null
}

export function boundaryFromSource(source: unknown) {
  const data = (source as { data?: unknown })?.data ?? source
  return normalizeBoundary((data as { geometry?: unknown })?.geometry ?? data)
}

export function polygons(boundary: Boundary | null) {
  if (!boundary) return []

  return boundary.type === 'Polygon' ? [boundary.coordinates] : boundary.coordinates
}

export function boundsFromBoundary(boundary: Boundary | null): Bounds | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const polygon of polygons(boundary)) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        west = Math.min(west, lng)
        south = Math.min(south, lat)
        east = Math.max(east, lng)
        north = Math.max(north, lat)
      }
    }
  }

  return [west, south, east, north].every(Number.isFinite) && west < east && south < north ? { west, south, east, north } : null
}

export function normalizeMapBounds(value: unknown): Bounds | null {
  if (Array.isArray(value) && value.length >= 2 && isCoordinate(value[0]) && isCoordinate(value[1])) {
    const [west, south] = value[0]
    const [east, north] = value[1]
    return west < east && south < north ? { west, south, east, north } : null
  }

  const bounds = value as {
    getWest?: () => number
    getSouth?: () => number
    getEast?: () => number
    getNorth?: () => number
  }
  if (!bounds?.getWest || !bounds.getSouth || !bounds.getEast || !bounds.getNorth) return null

  const west = bounds.getWest()
  const south = bounds.getSouth()
  const east = bounds.getEast()
  const north = bounds.getNorth()

  return [west, south, east, north].every(Number.isFinite) && west < east && south < north ? { west, south, east, north } : null
}

export function cityKeyFromBounds(bounds: Bounds) {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(5)).join(':')
}

function insideRing(point: LngLatPoint, ring: Ring) {
  let inside = false

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [lng, lat] = ring[index]
    const [prevLng, prevLat] = ring[previous]
    const crosses = lat > point.lat !== prevLat > point.lat
    const crossingLng = ((prevLng - lng) * (point.lat - lat)) / (prevLat - lat + 0.0000000001) + lng
    if (crosses && point.lng < crossingLng) inside = !inside
  }

  return inside
}

function insidePolygon(point: LngLatPoint, polygon: Ring[]) {
  const [outer, ...holes] = polygon
  return Boolean(outer) && insideRing(point, outer) && !holes.some((hole) => insideRing(point, hole))
}

export function insideBoundary(point: LngLatPoint, boundary: Boundary | null) {
  return boundary ? polygons(boundary).some((polygon) => insidePolygon(point, polygon)) : true
}

export function metersBetweenLngLat(a: LngLatPoint, b: LngLatPoint) {
  const latitudeDelta = ((b.lat - a.lat) * Math.PI) / 180
  const longitudeDelta = ((b.lng - a.lng) * Math.PI) / 180
  const startLatitude = (a.lat * Math.PI) / 180
  const endLatitude = (b.lat * Math.PI) / 180
  const latitudeSine = Math.sin(latitudeDelta / 2)
  const longitudeSine = Math.sin(longitudeDelta / 2)
  const haversine = latitudeSine * latitudeSine + Math.cos(startLatitude) * Math.cos(endLatitude) * longitudeSine * longitudeSine

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(1 - haversine, 0)))
}
