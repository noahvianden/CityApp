import type { GeoBounds, GeoPoint } from './geoGrid'

export type BoundaryGeometry =
  | {
      type: 'Polygon'
      coordinates: number[][][]
    }
  | {
      type: 'MultiPolygon'
      coordinates: number[][][][]
    }

type BoundaryPointOffset = [number, number]

const defaultDynamicCityRadiusMeters = 3500
const minimumDynamicCityRadiusMeters = 1200
const maximumDynamicCityRadiusMeters = 12000

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

function metersToLatitudeDegrees(meters: number) {
  return meters / 111_320
}

function metersToLongitudeDegrees(meters: number, latitude: number) {
  const scale = Math.cos(degreesToRadians(latitude))

  if (Math.abs(scale) < 0.000001) {
    return 0
  }

  return meters / (111_320 * scale)
}

function geoPointFromOffset(center: GeoPoint, eastMeters: number, northMeters: number): GeoPoint {
  return {
    latitude: center.latitude + metersToLatitudeDegrees(northMeters),
    longitude: center.longitude + metersToLongitudeDegrees(eastMeters, center.latitude),
  }
}

function boundaryFromOffsets(center: GeoPoint, offsets: BoundaryPointOffset[]): BoundaryGeometry {
  const coordinates = offsets.map(([eastMeters, northMeters]) => {
    const point = geoPointFromOffset(center, eastMeters, northMeters)

    return [point.longitude, point.latitude] as [number, number]
  })

  if (coordinates.length > 0) {
    coordinates.push(coordinates[0])
  }

  return {
    type: 'Polygon',
    coordinates: [coordinates],
  }
}

function boundaryBounds(boundary: BoundaryGeometry): GeoBounds {
  const rings = boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat()
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity

  for (const ring of rings) {
    for (const coordinate of ring) {
      const [longitude, latitude] = coordinate

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue
      }

      north = Math.max(north, latitude)
      south = Math.min(south, latitude)
      east = Math.max(east, longitude)
      west = Math.min(west, longitude)
    }
  }

  return { north, south, east, west }
}

export const cityBoundaryGeometryById: Record<string, BoundaryGeometry> = {
  berlin: boundaryFromOffsets({ latitude: 52.52, longitude: 13.405 }, [
    [-18500, 7000],
    [-7000, 17000],
    [6500, 18000],
    [18500, 10500],
    [22000, -3000],
    [15000, -15500],
    [-2500, -20000],
    [-16000, -14000],
  ]),
  cologne: boundaryFromOffsets({ latitude: 50.9375, longitude: 6.9603 }, [
    [-14500, 12500],
    [-6500, 19000],
    [7000, 17500],
    [16000, 8500],
    [15000, -6000],
    [6000, -16500],
    [-5500, -18000],
    [-15500, -8000],
  ]),
  dresden: boundaryFromOffsets({ latitude: 51.0504, longitude: 13.7373 }, [
    [-16000, 9500],
    [-5000, 16500],
    [8000, 14500],
    [17500, 7000],
    [15500, -4500],
    [8500, -16000],
    [-3500, -17500],
    [-15500, -8500],
  ]),
  frankfurt: boundaryFromOffsets({ latitude: 50.1109, longitude: 8.6821 }, [
    [-13000, 11500],
    [-4500, 17500],
    [8500, 15000],
    [16000, 6500],
    [15000, -6000],
    [7000, -15500],
    [-4500, -16500],
    [-15000, -7000],
  ]),
  hamburg: boundaryFromOffsets({ latitude: 53.5511, longitude: 9.9937 }, [
    [-23000, 8000],
    [-13000, 19500],
    [2000, 21000],
    [15500, 16500],
    [24500, 6500],
    [21000, -6000],
    [13000, -18000],
    [-5000, -20000],
    [-19000, -12000],
  ]),
  hannover: boundaryFromOffsets({ latitude: 52.3759, longitude: 9.732 }, [
    [-14500, 9000],
    [-5000, 16000],
    [7500, 14500],
    [15500, 7000],
    [15000, -4500],
    [8500, -15000],
    [-3500, -16000],
    [-14500, -7000],
  ]),
  leipzig: boundaryFromOffsets({ latitude: 51.3397, longitude: 12.3731 }, [
    [-14000, 10500],
    [-4500, 17000],
    [8500, 14500],
    [15500, 6000],
    [14500, -5500],
    [7000, -15500],
    [-3000, -17000],
    [-14500, -7500],
  ]),
  munich: boundaryFromOffsets({ latitude: 48.1351, longitude: 11.582 }, [
    [-13000, 9500],
    [-4500, 16500],
    [9000, 14500],
    [15500, 7000],
    [14500, -5000],
    [6500, -15000],
    [-2500, -16500],
    [-14500, -7000],
  ]),
}

export const cityGeoBoundsById: Record<string, GeoBounds> = Object.fromEntries(
  Object.entries(cityBoundaryGeometryById).map(([cityId, boundary]) => [cityId, boundaryBounds(boundary)]),
)

export const dynamicLocalCityPrefix = 'local:'
export const dynamicLocalCityId = 'local-current-city'

const dynamicCityBoundsById = new Map<string, GeoBounds>()
const dynamicCityBoundaryById = new Map<string, BoundaryGeometry>()

function createDynamicBoundaryAroundPoint(point: GeoPoint, radiusMeters = defaultDynamicCityRadiusMeters) {
  const radius = clamp(radiusMeters, minimumDynamicCityRadiusMeters, maximumDynamicCityRadiusMeters)

  return boundaryFromOffsets(point, [
    [-radius * 0.9, radius * 0.1],
    [-radius * 0.4, radius * 0.95],
    [radius * 0.5, radius * 1.1],
    [radius * 1.1, radius * 0.55],
    [radius * 1.0, -radius * 0.25],
    [radius * 0.55, -radius * 1.05],
    [-radius * 0.25, -radius * 1.15],
    [-radius * 1.05, -radius * 0.45],
  ])
}

export function isDynamicLocalCityId(cityId: string) {
  return cityId === dynamicLocalCityId || cityId.startsWith(dynamicLocalCityPrefix) || !cityGeoBoundsById[cityId]
}

export function createGeoBoundsAroundPoint(point: GeoPoint, radiusMeters = defaultDynamicCityRadiusMeters): GeoBounds {
  const boundary = createDynamicBoundaryAroundPoint(point, radiusMeters)

  return boundaryBounds(boundary)
}

export function createCityBoundaryAroundPoint(point: GeoPoint, radiusMeters = defaultDynamicCityRadiusMeters) {
  return createDynamicBoundaryAroundPoint(point, radiusMeters)
}

export function getCityBoundaryGeometry(cityId: string) {
  return cityBoundaryGeometryById[cityId] ?? dynamicCityBoundaryById.get(cityId) ?? null
}

export function registerDynamicCityGeoBounds(cityId: string, bounds: GeoBounds) {
  dynamicCityBoundsById.set(cityId, bounds)
}

export function getCityGeoBounds(cityId: string) {
  return cityGeoBoundsById[cityId] ?? dynamicCityBoundsById.get(cityId) ?? null
}

export function resolveCityGeoBounds(cityId: string, point?: GeoPoint | null, radiusMeters = defaultDynamicCityRadiusMeters) {
  const authoredBounds = cityGeoBoundsById[cityId]

  if (authoredBounds) {
    return authoredBounds
  }

  const existingDynamicBounds = dynamicCityBoundsById.get(cityId)

  if (existingDynamicBounds) {
    return existingDynamicBounds
  }

  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return null
  }

  const dynamicBoundary = createDynamicBoundaryAroundPoint(point, radiusMeters)
  const dynamicBounds = boundaryBounds(dynamicBoundary)

  dynamicCityBoundaryById.set(cityId, dynamicBoundary)
  registerDynamicCityGeoBounds(cityId, dynamicBounds)

  return dynamicBounds
}

export function resolveCityBoundaryGeometry(cityId: string, point?: GeoPoint | null, radiusMeters = defaultDynamicCityRadiusMeters) {
  const authoredBoundary = cityBoundaryGeometryById[cityId]

  if (authoredBoundary) {
    return authoredBoundary
  }

  const existingDynamicBoundary = dynamicCityBoundaryById.get(cityId)

  if (existingDynamicBoundary) {
    return existingDynamicBoundary
  }

  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return null
  }

  const dynamicBoundary = createDynamicBoundaryAroundPoint(point, radiusMeters)
  dynamicCityBoundaryById.set(cityId, dynamicBoundary)
  registerDynamicCityGeoBounds(cityId, boundaryBounds(dynamicBoundary))

  return dynamicBoundary
}

function pointInRing(point: GeoPoint, ring: number[][]) {
  let inside = false

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentLongitude, currentLatitude] = ring[index] as [number, number]
    const [previousLongitude, previousLatitude] = ring[previous] as [number, number]
    const intersects =
      currentLatitude > point.latitude !== previousLatitude > point.latitude &&
      point.longitude <
        ((previousLongitude - currentLongitude) * (point.latitude - currentLatitude)) /
          (previousLatitude - currentLatitude + 0.0000000001) +
          currentLongitude

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

export function containsGeoPointInBoundary(point: GeoPoint, boundary: BoundaryGeometry) {
  const rings = boundary.type === 'Polygon' ? boundary.coordinates : boundary.coordinates.flat()

  return rings.some((ring) => pointInRing(point, ring))
}

export function resetDynamicCityGeoBounds(cityId?: string) {
  if (cityId) {
    dynamicCityBoundsById.delete(cityId)
    dynamicCityBoundaryById.delete(cityId)
    return
  }

  dynamicCityBoundsById.clear()
  dynamicCityBoundaryById.clear()
}
