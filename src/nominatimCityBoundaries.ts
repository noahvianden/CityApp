import { CapacitorHttp } from '@capacitor/core'
import { type GeoBounds, type GeoPoint } from './geoGrid'
import { isNativeRuntime } from './nativeRuntime'

export type BoundaryGeometry =
  | {
      type: 'Polygon'
      coordinates: number[][][]
    }
  | {
      type: 'MultiPolygon'
      coordinates: number[][][][]
    }

export type BoundedAtlasPoint = {
  cityId: string
  cityName: string
  cityCountry: string
  cityStatus: string
  point: GeoPoint
  bounds: GeoBounds
  boundary: BoundaryGeometry
}

type CityLookupAddress = {
  city?: string
  town?: string
  village?: string
  municipality?: string
  county?: string
  state?: string
  country?: string
  country_code?: string
}

type NominatimPlace = {
  addresstype?: string
  address?: CityLookupAddress
  boundingbox?: unknown
  category?: string
  display_name?: string
  extratags?: {
    'de:place'?: string
    linked_place?: string
  }
  geojson?: unknown
  lat?: string
  lon?: string
  name?: string
  osm_id?: number
  osm_type?: string
  type?: string
}

type CitySearchCandidate = BoundedAtlasPoint & {
  address: CityLookupAddress | undefined
  addressType: string | undefined
  category: string | undefined
  countryCode: string | undefined
  dePlace: string | undefined
  displayName: string | undefined
  linkedPlace: string | undefined
  name: string | undefined
  osmType: string | undefined
  placeType: string | undefined
}

type CityDefinition = {
  id: string
  name: string
  country: string
  status: string
  searchQueries: string[]
}

const nominatimBaseUrl = 'https://nominatim.openstreetmap.org'
const searchCache = new Map<string, BoundedAtlasPoint | null>()
const reverseCache = new Map<string, BoundedAtlasPoint | null>()

const cityDefinitions: CityDefinition[] = [
  {
    id: 'berlin',
    name: 'Berlin',
    country: 'Germany',
    status: 'Real boundary',
    searchQueries: ['Berlin'],
  },
  {
    id: 'hamburg',
    name: 'Hamburg',
    country: 'Germany',
    status: 'Real boundary',
    searchQueries: ['Hamburg'],
  },
  {
    id: 'munich',
    name: 'Munich',
    country: 'Germany',
    status: 'Real boundary',
    searchQueries: ['Muenchen', 'Munich'],
  },
  {
    id: 'cologne',
    name: 'Cologne',
    country: 'Germany',
    status: 'Real boundary',
    searchQueries: ['Koeln', 'Cologne'],
  },
  {
    id: 'frankfurt',
    name: 'Frankfurt am Main',
    country: 'Germany',
    status: 'Real boundary',
    searchQueries: ['Frankfurt am Main'],
  },
  {
    id: 'dresden',
    name: 'Dresden',
    country: 'Germany',
    status: 'Real boundary',
    searchQueries: ['Dresden'],
  },
  {
    id: 'leipzig',
    name: 'Leipzig',
    country: 'Germany',
    status: 'Real boundary',
    searchQueries: ['Leipzig'],
  },
  {
    id: 'hannover',
    name: 'Hannover',
    country: 'Germany',
    status: 'Real boundary',
    searchQueries: ['Hannover'],
  },
]

function normalizeQuery(query: string) {
  return query.trim().toLowerCase()
}

function parseNominatimBounds(value: unknown): GeoBounds | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null
  }

  const [south, north, west, east] = value.map((entry) => Number(entry))

  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
    return null
  }

  return { south, north, west, east }
}

function parseBoundaryGeometry(value: unknown): BoundaryGeometry | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const geometry = value as {
    type?: unknown
    coordinates?: unknown
  }

  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return null
  }

  if (!Array.isArray(geometry.coordinates)) {
    return null
  }

  return geometry as BoundaryGeometry
}

function getBoundsFromBoundary(boundary: BoundaryGeometry): GeoBounds | null {
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

  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east) {
    return null
  }

  return { south, north, west, east }
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

function getAddressCityNames(address: CityLookupAddress | undefined) {
  const names = [address?.city, address?.town, address?.village, address?.municipality]

  return Array.from(new Set(names.filter((name): name is string => Boolean(name))))
}

function parseCityBoundaryCandidate(place: NominatimPlace): CitySearchCandidate | null {
  const boundary = parseBoundaryGeometry(place.geojson)
  const bounds = boundary ? (getBoundsFromBoundary(boundary) ?? parseNominatimBounds(place.boundingbox)) : null
  const latitude = Number(place.lat)
  const longitude = Number(place.lon)

  if (!bounds || !boundary || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  return {
    cityId: `${place.osm_type ?? 'unknown'}:${place.osm_id ?? place.name ?? 'city'}`,
    cityName: place.name ?? place.address?.city ?? place.address?.town ?? place.address?.village ?? 'City',
    cityCountry: place.address?.country ?? 'Germany',
    cityStatus: 'Real boundary',
    point: { latitude, longitude },
    bounds,
    boundary,
    address: place.address,
    addressType: place.addresstype,
    category: place.category,
    countryCode: place.address?.country_code,
    dePlace: place.extratags?.['de:place'],
    displayName: place.display_name,
    linkedPlace: place.extratags?.linked_place,
    name: place.name,
    osmType: place.osm_type,
    placeType: place.type,
  }
}

function isGermanCityBoundary(candidate: CitySearchCandidate) {
  const isGerman = candidate.countryCode === 'de'
  const isBoundaryRelation =
    candidate.osmType === 'relation' && candidate.category === 'boundary' && candidate.placeType === 'administrative'
  const isCity = candidate.addressType === 'city' || candidate.dePlace === 'city' || candidate.linkedPlace === 'city'

  return isGerman && isBoundaryRelation && isCity
}

function toAtlasPoint(
  candidate: CitySearchCandidate,
  cityId: string,
  cityName: string,
  cityCountry: string,
  cityStatus: string,
  pointOverride?: GeoPoint | null,
): BoundedAtlasPoint {
  const point = pointOverride && containsGeoPointInBoundary(pointOverride, candidate.boundary) ? pointOverride : candidate.point

  return {
    cityId,
    cityName,
    cityCountry,
    cityStatus,
    point,
    bounds: candidate.bounds,
    boundary: candidate.boundary,
  }
}

async function requestNominatimJson(path: 'search' | 'reverse', params: URLSearchParams) {
  const url = `${nominatimBaseUrl}/${path}?${params.toString()}`

  if (isNativeRuntime()) {
    const response = await CapacitorHttp.request({
      url,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CityApp/1.0 (Capacitor)',
      },
      responseType: 'json',
      connectTimeout: 10000,
      readTimeout: 10000,
    })

    if (response.status < 200 || response.status >= 300) {
      return null
    }

    return response.data
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
    credentials: 'omit',
  })

  if (!response.ok) {
    return null
  }

  return response.json()
}

async function fetchCityBoundaryByQuery(query: string, cityMeta?: CityDefinition): Promise<BoundedAtlasPoint | null> {
  const cacheKey = normalizeQuery(query)
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey) ?? null
  }

  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    featureType: 'city',
    countrycodes: 'de',
    limit: '50',
    addressdetails: '1',
    extratags: '1',
    polygon_geojson: '1',
    'accept-language': 'en',
  })

  const payload = await requestNominatimJson('search', params)
  if (!Array.isArray(payload)) {
    searchCache.set(cacheKey, null)
    return null
  }

  const candidates = payload
    .map((place) => parseCityBoundaryCandidate(place as NominatimPlace))
    .filter((candidate): candidate is CitySearchCandidate => candidate !== null)

  const candidate = candidates.find(isGermanCityBoundary)
  if (!candidate) {
    searchCache.set(cacheKey, null)
    return null
  }

  const result = toAtlasPoint(
    candidate,
    cityMeta?.id ?? candidate.cityId,
    cityMeta?.name ?? candidate.cityName,
    cityMeta?.country ?? candidate.cityCountry,
    cityMeta?.status ?? candidate.cityStatus,
  )

  searchCache.set(cacheKey, result)
  return result
}

export async function fetchSimulatedCityBoundary(): Promise<BoundedAtlasPoint | null> {
  const startIndex = Math.floor(Math.random() * cityDefinitions.length)

  for (let offset = 0; offset < cityDefinitions.length; offset += 1) {
    const definition = cityDefinitions[(startIndex + offset) % cityDefinitions.length]

    for (const query of definition.searchQueries) {
      const result = await fetchCityBoundaryByQuery(query, definition)

      if (result) {
        return result
      }
    }
  }

  return null
}

export async function fetchBoundaryForGpsPoint(point: GeoPoint): Promise<BoundedAtlasPoint | null> {
  const cacheKey = `${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`
  if (reverseCache.has(cacheKey)) {
    return reverseCache.get(cacheKey) ?? null
  }

  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: point.latitude.toString(),
    lon: point.longitude.toString(),
    zoom: '10',
    addressdetails: '1',
    extratags: '1',
    polygon_geojson: '1',
    'accept-language': 'en',
  })

  const payload = await requestNominatimJson('reverse', params)
  if (!payload || typeof payload !== 'object') {
    reverseCache.set(cacheKey, null)
    return null
  }

  const reverseCandidate = parseCityBoundaryCandidate(payload as NominatimPlace)

  if (reverseCandidate && isGermanCityBoundary(reverseCandidate)) {
    const result = toAtlasPoint(
      reverseCandidate,
      reverseCandidate.cityId,
      reverseCandidate.cityName,
      reverseCandidate.cityCountry,
      'GPS matched',
      point,
    )

    reverseCache.set(cacheKey, result)
    return result
  }

  const address = (payload as NominatimPlace).address
  for (const cityName of getAddressCityNames(address)) {
    const result = await fetchCityBoundaryByQuery(cityName)

    if (result) {
      const withGpsPoint = {
        ...result,
        cityStatus: 'GPS matched',
        point: containsGeoPointInBoundary(point, result.boundary) ? point : result.point,
      }

      reverseCache.set(cacheKey, withGpsPoint)
      return withGpsPoint
    }
  }

  reverseCache.set(cacheKey, null)
  return null
}
