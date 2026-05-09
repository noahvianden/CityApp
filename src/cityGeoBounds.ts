import type { GeoBounds, GeoPoint } from './geoGrid'

export const cityGeoBoundsById: Record<string, GeoBounds> = {
  berlin: {
    north: 52.6755,
    south: 52.3383,
    east: 13.7611,
    west: 13.0884,
  },
  hamburg: {
    north: 53.7394,
    south: 53.3951,
    east: 10.3252,
    west: 9.7308,
  },
}

export const dynamicLocalCityPrefix = 'local:'
export const dynamicLocalCityId = 'local-current-city'

const dynamicCityBoundsById = new Map<string, GeoBounds>()
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

export function isDynamicLocalCityId(cityId: string) {
  return cityId === dynamicLocalCityId || cityId.startsWith(dynamicLocalCityPrefix) || !cityGeoBoundsById[cityId]
}

export function createGeoBoundsAroundPoint(point: GeoPoint, radiusMeters = defaultDynamicCityRadiusMeters): GeoBounds {
  const radius = clamp(radiusMeters, minimumDynamicCityRadiusMeters, maximumDynamicCityRadiusMeters)
  const latitudeDelta = metersToLatitudeDegrees(radius)
  const longitudeDelta = metersToLongitudeDegrees(radius, point.latitude)

  return {
    north: point.latitude + latitudeDelta,
    south: point.latitude - latitudeDelta,
    east: point.longitude + longitudeDelta,
    west: point.longitude - longitudeDelta,
  }
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

  const dynamicBounds = createGeoBoundsAroundPoint(point, radiusMeters)

  registerDynamicCityGeoBounds(cityId, dynamicBounds)

  return dynamicBounds
}

export function resetDynamicCityGeoBounds(cityId?: string) {
  if (cityId) {
    dynamicCityBoundsById.delete(cityId)
    return
  }

  dynamicCityBoundsById.clear()
}
