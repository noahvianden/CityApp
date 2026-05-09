import type { City, CityMap, District, Place } from './cityprintData'
import type { GeoBounds, GeoPoint } from './geoGrid'
import { createGeoBoundsAroundPoint } from './cityGeoBounds'

export const generatedCitiesStorageKey = 'cityprint:generated-cities:v1'
export const generatedCityIdPrefix = 'local:'

export type GeneratedCityRecord = {
  id: string
  name: string
  country: string
  createdAt: string
  updatedAt: string
  bounds: GeoBounds
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUsableBounds(value: unknown): value is GeoBounds {
  return (
    isObject(value) &&
    typeof value.north === 'number' &&
    typeof value.south === 'number' &&
    typeof value.east === 'number' &&
    typeof value.west === 'number' &&
    Number.isFinite(value.north) &&
    Number.isFinite(value.south) &&
    Number.isFinite(value.east) &&
    Number.isFinite(value.west) &&
    value.north > value.south &&
    value.east > value.west
  )
}

function normalizeCityName(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 52)
}

function slugify(value: string) {
  return normalizeCityName(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 42)
}

function parseGeneratedCityRecord(value: unknown): GeneratedCityRecord | null {
  if (!isObject(value)) {
    return null
  }

  if (
    typeof value.id !== 'string' ||
    !value.id.startsWith(generatedCityIdPrefix) ||
    typeof value.name !== 'string' ||
    typeof value.country !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !hasUsableBounds(value.bounds)
  ) {
    return null
  }

  return {
    id: value.id,
    name: normalizeCityName(value.name) || 'Custom city',
    country: normalizeCityName(value.country) || 'Custom',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    bounds: value.bounds,
  }
}

export function readGeneratedCityRecords(storage: StorageLike | undefined = globalThis.localStorage): GeneratedCityRecord[] {
  if (!storage) {
    return []
  }

  try {
    const raw = storage.getItem(generatedCitiesStorageKey)

    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map(parseGeneratedCityRecord)
      .filter((record): record is GeneratedCityRecord => Boolean(record))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export function writeGeneratedCityRecords(records: GeneratedCityRecord[], storage: StorageLike | undefined = globalThis.localStorage) {
  if (!storage) {
    return
  }

  storage.setItem(generatedCitiesStorageKey, JSON.stringify(records))
}

export function getGeneratedCityRecord(cityId: string, storage: StorageLike | undefined = globalThis.localStorage) {
  return readGeneratedCityRecords(storage).find((record) => record.id === cityId) ?? null
}

export function createGeneratedCityRecord({
  name,
  point,
  country = 'Custom',
  radiusMeters,
  now = new Date().toISOString(),
}: {
  name: string
  point: GeoPoint
  country?: string
  radiusMeters?: number
  now?: string
}): GeneratedCityRecord {
  const normalizedName = normalizeCityName(name) || 'Custom city'
  const slug = slugify(normalizedName) || 'custom-city'
  const nonce = Math.abs(Math.round((point.latitude + 90) * 10000 + (point.longitude + 180) * 10000)).toString(36)

  return {
    id: `${generatedCityIdPrefix}${slug}-${nonce}`,
    name: normalizedName,
    country: normalizeCityName(country) || 'Custom',
    createdAt: now,
    updatedAt: now,
    bounds: createGeoBoundsAroundPoint(point, radiusMeters),
  }
}

export function upsertGeneratedCityRecord(record: GeneratedCityRecord, storage: StorageLike | undefined = globalThis.localStorage) {
  const records = readGeneratedCityRecords(storage)
  const nextRecords = [record, ...records.filter((candidate) => candidate.id !== record.id)].sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  writeGeneratedCityRecords(nextRecords, storage)

  return nextRecords
}

const cells = (matcher: (x: number, y: number) => boolean) => {
  const output: string[] = []

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      if (matcher(x, y)) {
        output.push(`${x}-${y}`)
      }
    }
  }

  return output
}

const generatedDistricts: District[] = [
  { id: 'generated-center', name: 'City Center', cells: cells((x, y) => x >= 2 && x <= 4 && y >= 2 && y <= 5) },
  { id: 'generated-north', name: 'North Area', cells: cells((_x, y) => y <= 2) },
  { id: 'generated-east', name: 'East Area', cells: cells((x, _y) => x >= 5) },
  { id: 'generated-south', name: 'South Area', cells: cells((_x, y) => y >= 5) },
  { id: 'generated-west', name: 'West Area', cells: cells((x, _y) => x <= 1) },
]

const generatedPlaces: Place[] = [
  {
    id: 'generated-start',
    name: 'Starting Point',
    category: 'viewpoint',
    district: 'City Center',
    description: 'The first anchor point for this custom city atlas.',
    discoveryContext: 'Created when Cityprint began mapping this custom city.',
    cell: '3-4',
    x: 50,
    y: 55,
  },
  {
    id: 'generated-north-find',
    name: 'North Find',
    category: 'landmark',
    district: 'North Area',
    description: 'A generic discovery slot for the northern part of your walk.',
    discoveryContext: 'Appears as the local atlas expands north.',
    cell: '3-2',
    x: 50,
    y: 29,
  },
  {
    id: 'generated-east-find',
    name: 'East Find',
    category: 'park',
    district: 'East Area',
    description: 'A generic discovery slot for the eastern part of your walk.',
    discoveryContext: 'Appears as the local atlas expands east.',
    cell: '5-3',
    x: 78,
    y: 43,
  },
  {
    id: 'generated-south-find',
    name: 'South Find',
    category: 'cafe',
    district: 'South Area',
    description: 'A generic discovery slot for the southern part of your walk.',
    discoveryContext: 'Appears as the local atlas expands south.',
    cell: '3-6',
    x: 50,
    y: 82,
  },
  {
    id: 'generated-west-find',
    name: 'West Find',
    category: 'quiet_spot',
    district: 'West Area',
    description: 'A generic discovery slot for the western part of your walk.',
    discoveryContext: 'Appears as the local atlas expands west.',
    cell: '1-4',
    x: 22,
    y: 55,
  },
]

const generatedMap: CityMap = {
  water: ['M0 654 C126 618 194 682 326 654 S534 622 700 686 L700 800 L0 800 Z'],
  parks: [
    'M486 206 C604 178 684 244 664 344 C640 422 548 424 506 362 C468 306 468 232 486 206 Z',
    'M40 406 C120 356 206 374 206 452 C204 532 84 540 42 478 C24 446 23 418 40 406 Z',
  ],
  streetsMajor: [
    'M92 0 L128 150 L104 314 L160 474 L150 800',
    'M300 0 L286 188 L328 340 L318 520 L372 800',
    'M598 0 L544 166 L574 332 L530 514 L610 800',
    'M0 180 L160 160 L310 190 L480 156 L700 176',
    'M0 388 L176 350 L342 384 L514 356 L700 392',
    'M0 584 L190 612 L344 578 L526 615 L700 580',
  ],
  streetsMinor: ['M212 0 L198 800', 'M458 0 L438 800', 'M0 284 L700 286', 'M0 494 L700 486'],
  regions: [
    { id: 'generated-center', name: 'City Center', d: 'M192 210 L372 178 L504 224 L490 482 L330 532 L214 444 Z', labelX: 334, labelY: 370 },
    { id: 'generated-north', name: 'North Area', d: 'M166 0 L700 0 L690 172 L520 184 L356 158 L206 176 Z', labelX: 420, labelY: 92 },
    { id: 'generated-east', name: 'East Area', d: 'M460 166 L700 164 L700 550 L548 528 L504 388 Z', labelX: 608, labelY: 362 },
    { id: 'generated-south', name: 'South Area', d: 'M268 528 L496 500 L700 540 L700 800 L238 800 L228 634 Z', labelX: 472, labelY: 680 },
    { id: 'generated-west', name: 'West Area', d: 'M0 164 L184 146 L226 428 L160 544 L0 534 Z', labelX: 108, labelY: 346 },
  ],
  labels: [
    { text: 'Custom city', x: 330, y: 374, tone: 'dark' },
    { text: 'Local route', x: 532, y: 742, tone: 'light' },
  ],
}

export function createGeneratedCityProfile(record: GeneratedCityRecord): City {
  return {
    id: record.id,
    name: record.name,
    country: record.country,
    status: 'Custom city',
    savedProgress: 0,
    description: `A custom Cityprint atlas generated around ${record.name}.`,
    initialRevealed: ['3-4'],
    walkRoute: ['3-4', '3-3', '4-3', '4-4', '4-5', '3-5', '2-5', '2-4', '2-3', '3-2', '4-2', '5-2'],
    districts: generatedDistricts,
    places: generatedPlaces.map((place) => ({
      ...place,
      id: `${record.id}:${place.id}`,
    })),
    map: generatedMap,
  }
}

export function loadGeneratedCityProfiles(storage: StorageLike | undefined = globalThis.localStorage) {
  return readGeneratedCityRecords(storage).map(createGeneratedCityProfile)
}
