import { mapCells, mapColumns, mapRows } from './revealModel'

export type GeoBounds = {
  north: number
  south: number
  east: number
  west: number
}

export type GeoPoint = {
  latitude: number
  longitude: number
}

export type GridPoint = {
  x: number
  y: number
}

const earthRadiusMeters = 6371008.8
const defaultBoundsPaddingMeters = 75

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
  const latitudeScale = Math.cos(degreesToRadians(latitude))

  if (Math.abs(latitudeScale) < 0.000001) {
    return 0
  }

  return meters / (111_320 * latitudeScale)
}

export function hasUsableGeoBounds(bounds: GeoBounds) {
  return (
    Number.isFinite(bounds.north) &&
    Number.isFinite(bounds.south) &&
    Number.isFinite(bounds.east) &&
    Number.isFinite(bounds.west) &&
    bounds.north > bounds.south &&
    bounds.east > bounds.west
  )
}

export function expandGeoBounds(bounds: GeoBounds, paddingMeters = 0): GeoBounds {
  if (!hasUsableGeoBounds(bounds) || paddingMeters <= 0) {
    return bounds
  }

  const middleLatitude = (bounds.north + bounds.south) / 2
  const latitudePadding = metersToLatitudeDegrees(paddingMeters)
  const longitudePadding = metersToLongitudeDegrees(paddingMeters, middleLatitude)

  return {
    north: bounds.north + latitudePadding,
    south: bounds.south - latitudePadding,
    east: bounds.east + longitudePadding,
    west: bounds.west - longitudePadding,
  }
}

export function containsGeoPoint(point: GeoPoint, bounds: GeoBounds, paddingMeters = 0) {
  if (!hasUsableGeoBounds(bounds)) {
    return false
  }

  const expandedBounds = expandGeoBounds(bounds, paddingMeters)

  return (
    point.latitude <= expandedBounds.north &&
    point.latitude >= expandedBounds.south &&
    point.longitude >= expandedBounds.west &&
    point.longitude <= expandedBounds.east
  )
}

export function projectGeoPointToGrid(point: GeoPoint, bounds: GeoBounds, paddingMeters = 0): GridPoint | null {
  if (!containsGeoPoint(point, bounds, paddingMeters)) {
    return null
  }

  const latitude = clamp(point.latitude, bounds.south, bounds.north)
  const longitude = clamp(point.longitude, bounds.west, bounds.east)
  const x = ((longitude - bounds.west) / (bounds.east - bounds.west)) * 100
  const y = ((bounds.north - latitude) / (bounds.north - bounds.south)) * 100

  return {
    x: clamp(x, 0, 100),
    y: clamp(y, 0, 100),
  }
}

export function cellIdFromGridPoint(point: GridPoint) {
  const column = clamp(Math.floor(point.x / (100 / mapColumns)), 0, mapColumns - 1)
  const row = clamp(Math.floor(point.y / (100 / mapRows)), 0, mapRows - 1)

  return `${column}-${row}`
}

export function geoPointToCellId(bounds: GeoBounds, point: GeoPoint, paddingMeters = defaultBoundsPaddingMeters) {
  const gridPoint = projectGeoPointToGrid(point, bounds, paddingMeters)

  return gridPoint ? cellIdFromGridPoint(gridPoint) : null
}

export function cellCenterToGeoPoint(bounds: GeoBounds, cellId: string): GeoPoint | null {
  if (!hasUsableGeoBounds(bounds)) {
    return null
  }

  const cell = mapCells.find((candidate) => candidate.id === cellId)

  if (!cell) {
    return null
  }

  return {
    latitude: bounds.north - (cell.top / 100) * (bounds.north - bounds.south),
    longitude: bounds.west + (cell.left / 100) * (bounds.east - bounds.west),
  }
}

export function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const latitudeDelta = degreesToRadians(b.latitude - a.latitude)
  const longitudeDelta = degreesToRadians(b.longitude - a.longitude)
  const startLatitude = degreesToRadians(a.latitude)
  const endLatitude = degreesToRadians(b.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export function approximateCellSizeMeters(bounds: GeoBounds) {
  const middleLatitude = (bounds.north + bounds.south) / 2
  const middleLongitude = (bounds.east + bounds.west) / 2
  const widthMeters = distanceMeters(
    { latitude: middleLatitude, longitude: bounds.west },
    { latitude: middleLatitude, longitude: bounds.east },
  )
  const heightMeters = distanceMeters(
    { latitude: bounds.north, longitude: middleLongitude },
    { latitude: bounds.south, longitude: middleLongitude },
  )

  return {
    widthMeters: widthMeters / mapColumns,
    heightMeters: heightMeters / mapRows,
  }
}
