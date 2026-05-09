import { describe, expect, it } from 'vitest'
import { createDefaultCityProgress, defaultLocationSettings, defaultPrivacy, type AppSnapshot } from './appState'
import { cities } from './cityprintData'
import {
  cityprintBackupStorageKey,
  cityprintStorageKey,
  clearCityprintSnapshot,
  getCityProgress,
  readCityprintSnapshot,
  readCityprintSnapshotFromRaw,
  serializeCityprintSnapshot,
  withCityProgress,
  writeCityprintSnapshot,
} from './persistence'

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map<string, string>()

  if (initial) {
    Object.entries(initial).forEach(([key, value]) => {
      values.set(key, value)
    })
  }

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    raw: values,
  }
}

describe('persistence', () => {
  it('returns defaults when storage is empty or invalid', () => {
    expect(readCityprintSnapshot(memoryStorage()).privacy).toEqual(defaultPrivacy)
    expect(readCityprintSnapshot(memoryStorage({ [cityprintStorageKey]: '{bad json' })).selectedCityId).toBeNull()
  })

  it('round-trips selected city, privacy, progress and memories', () => {
    const storage = memoryStorage()
    const berlin = cities[0]
    const progress = {
      ...createDefaultCityProgress(berlin),
      revealedCells: ['1-1', '1-2'],
      routeIndex: 3,
      routeTrace: ['3-6', '3-5', '3-4', '4-4'],
      acceptedSampleCount: 5,
      latestRevealDigest: {
        routeLabel: 'Route 4/10',
        revealedCellCount: 3,
        placeCount: 2,
        reviewedCount: 1,
        pendingCount: 1,
        featuredPlaceName: 'Arcade House',
      },
      discoveryIds: ['arcade-house', 'east-garden'],
      reviewedDiscoveryIds: ['arcade-house'],
      memories: [
        {
          id: 'memory-test',
          title: 'Saved',
          text: 'Persists across reloads',
          tag: 'walk',
          visibility: 'Recap allowed' as const,
          hasPhoto: true,
          createdAt: 'Today',
        },
      ],
    }
    const snapshot: AppSnapshot = withCityProgress(
      {
        selectedCityId: berlin.id,
        privacy: { ...defaultPrivacy, preciseLocation: true },
        location: { mode: 'gps', permission: 'granted', gpsLatitude: '12.3', gpsLongitude: '45.6', gpsAccuracy: '9' },
        cityProgress: {},
      },
      berlin.id,
      progress,
    )

    writeCityprintSnapshot(snapshot, storage)

    expect(getCityProgress(readCityprintSnapshot(storage), berlin)).toEqual(progress)
    expect(readCityprintSnapshot(storage).privacy.preciseLocation).toBe(true)
    expect(readCityprintSnapshot(storage).location).toEqual({
      ...defaultLocationSettings,
      mode: 'gps',
      permission: 'granted',
    })
    expect(getCityProgress(readCityprintSnapshot(storage), berlin).routeTrace).toEqual(progress.routeTrace)
    expect(getCityProgress(readCityprintSnapshot(storage), berlin).acceptedSampleCount).toBe(5)
    expect(getCityProgress(readCityprintSnapshot(storage), berlin).latestRevealDigest).toEqual(progress.latestRevealDigest)
    expect(getCityProgress(readCityprintSnapshot(storage), berlin).discoveryIds).toEqual(progress.discoveryIds)
    expect(getCityProgress(readCityprintSnapshot(storage), berlin).reviewedDiscoveryIds).toEqual(progress.reviewedDiscoveryIds)
    expect(storage.raw.get(cityprintStorageKey)).not.toContain('12.3')
    expect(storage.raw.get(cityprintStorageKey)).not.toContain('45.6')
    expect(storage.raw.get(cityprintStorageKey)).not.toContain('9')
  })

  it('serializes and parses snapshots without precise GPS coordinates', () => {
    const berlin = cities[0]
    const snapshot: AppSnapshot = {
      selectedCityId: berlin.id,
      privacy: defaultPrivacy,
      location: { mode: 'gps', permission: 'granted', gpsLatitude: '52.51631', gpsLongitude: '13.37777', gpsAccuracy: '8' },
      cityProgress: {
        [berlin.id]: createDefaultCityProgress(berlin),
      },
    }

    const serialized = serializeCityprintSnapshot(snapshot)
    const parsed = readCityprintSnapshotFromRaw(serialized)

    expect(serialized).not.toContain('52.51631')
    expect(serialized).not.toContain('13.37777')
    expect(serialized).not.toContain('"8"')
    expect(parsed?.location).toEqual({
      ...defaultLocationSettings,
      mode: 'gps',
      permission: 'granted',
    })
    expect(parsed?.selectedCityId).toBe(berlin.id)
  })

  it('keeps a backup snapshot in sync when backup is enabled and restores from it if needed', () => {
    const storage = memoryStorage()
    const berlin = cities[0]
    const snapshot: AppSnapshot = withCityProgress(
      {
        selectedCityId: berlin.id,
        privacy: { ...defaultPrivacy, backupEnabled: true },
        location: { mode: 'simulated', permission: 'not-requested', gpsLatitude: '12.3', gpsLongitude: '45.6', gpsAccuracy: '9' },
        cityProgress: {},
      },
      berlin.id,
      {
        ...createDefaultCityProgress(berlin),
        latestRevealDigest: {
          routeLabel: 'Route 2/10',
          revealedCellCount: 2,
          placeCount: 1,
          reviewedCount: 1,
          pendingCount: 0,
          featuredPlaceName: 'Kaffee Linden',
        },
      },
    )

    writeCityprintSnapshot(snapshot, storage)

    expect(storage.raw.get(cityprintBackupStorageKey)).toBeDefined()
    expect(readCityprintSnapshot(storage)).toEqual({
      ...snapshot,
      location: {
        ...defaultLocationSettings,
        mode: 'simulated',
        permission: 'not-requested',
      },
    })

    storage.raw.delete(cityprintStorageKey)

    expect(readCityprintSnapshot(storage)).toEqual({
      ...snapshot,
      location: {
        ...defaultLocationSettings,
        mode: 'simulated',
        permission: 'not-requested',
      },
    })
  })

  it('removes the backup snapshot when backup is turned off', () => {
    const storage = memoryStorage()
    const berlin = cities[0]
    const enabledSnapshot: AppSnapshot = {
      selectedCityId: berlin.id,
      privacy: { ...defaultPrivacy, backupEnabled: true },
      location: { mode: 'simulated', permission: 'not-requested', gpsLatitude: '52.52', gpsLongitude: '13.405', gpsAccuracy: '18' },
      cityProgress: {},
    }

    writeCityprintSnapshot(enabledSnapshot, storage)

    expect(storage.raw.has(cityprintBackupStorageKey)).toBe(true)

    writeCityprintSnapshot(
      {
        ...enabledSnapshot,
        privacy: { ...defaultPrivacy, backupEnabled: false },
      },
      storage,
    )

    expect(storage.raw.has(cityprintBackupStorageKey)).toBe(false)
  })

  it('clears both primary and backup snapshots together', () => {
    const storage = memoryStorage({
      [cityprintStorageKey]: JSON.stringify(createDefaultCityProgress(cities[0])),
      [cityprintBackupStorageKey]: JSON.stringify(createDefaultCityProgress(cities[0])),
    })

    clearCityprintSnapshot(storage)

    expect(storage.raw.size).toBe(0)
  })

  it('falls back to seeded city progress when a city has no saved state', () => {
    const hamburg = cities[1]
    const snapshot = readCityprintSnapshot(memoryStorage())

    expect(getCityProgress(snapshot, hamburg)).toEqual(createDefaultCityProgress(hamburg))
  })
})
