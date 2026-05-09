import { describe, expect, it } from 'vitest'
import {
  createGeneratedCityProfile,
  createGeneratedCityRecord,
  generatedCitiesStorageKey,
  getGeneratedCityRecord,
  readGeneratedCityRecords,
  upsertGeneratedCityRecord,
} from './generatedCityModel'

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map<string, string>()

  Object.entries(initial ?? {}).forEach(([key, value]) => values.set(key, value))

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    raw: values,
  }
}

describe('generated city model', () => {
  it('creates stable generated city records from a name and point', () => {
    const record = createGeneratedCityRecord({
      name: '  Munich   ',
      country: 'Germany',
      point: {
        latitude: 48.1372,
        longitude: 11.5756,
      },
      now: '2026-05-09T12:00:00.000Z',
    })

    expect(record.id).toMatch(/^local:munich-/)
    expect(record.name).toBe('Munich')
    expect(record.country).toBe('Germany')
    expect(record.bounds.north).toBeGreaterThan(48.1372)
    expect(record.bounds.south).toBeLessThan(48.1372)
    expect(record.bounds.east).toBeGreaterThan(11.5756)
    expect(record.bounds.west).toBeLessThan(11.5756)
  })

  it('persists and reads generated city records', () => {
    const storage = memoryStorage()
    const record = createGeneratedCityRecord({
      name: 'Lisbon',
      point: {
        latitude: 38.7223,
        longitude: -9.1393,
      },
      now: '2026-05-09T12:00:00.000Z',
    })

    upsertGeneratedCityRecord(record, storage)

    expect(storage.raw.has(generatedCitiesStorageKey)).toBe(true)
    expect(readGeneratedCityRecords(storage)).toEqual([record])
    expect(getGeneratedCityRecord(record.id, storage)).toEqual(record)
  })

  it('ignores invalid generated city records', () => {
    const storage = memoryStorage({
      [generatedCitiesStorageKey]: JSON.stringify([
        { id: 'bad', name: 'Bad', country: 'Bad', createdAt: 'x', updatedAt: 'x', bounds: {} },
        createGeneratedCityRecord({
          name: 'Tokyo',
          point: {
            latitude: 35.6762,
            longitude: 139.6503,
          },
          now: '2026-05-09T12:00:00.000Z',
        }),
      ]),
    })

    expect(readGeneratedCityRecords(storage)).toHaveLength(1)
    expect(readGeneratedCityRecords(storage)[0].name).toBe('Tokyo')
  })

  it('turns generated city records into normal city profiles', () => {
    const record = createGeneratedCityRecord({
      name: 'Porto',
      point: {
        latitude: 41.1579,
        longitude: -8.6291,
      },
      now: '2026-05-09T12:00:00.000Z',
    })
    const city = createGeneratedCityProfile(record)

    expect(city.id).toBe(record.id)
    expect(city.name).toBe('Porto')
    expect(city.status).toBe('Custom city')
    expect(city.initialRevealed).toEqual(['3-4'])
    expect(city.walkRoute.length).toBeGreaterThan(4)
    expect(city.districts.map((district) => district.name)).toContain('City Center')
    expect(city.places.every((place) => place.id.startsWith(`${record.id}:`))).toBe(true)
  })
})
