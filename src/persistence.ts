import {
  createDefaultCityProgress,
  defaultPrivacy,
  type AppSnapshot,
  type CityProgressState,
  defaultLocationSettings,
  type Memory,
  type LatestRevealDigest,
  type PrivacySettings,
  type LocationSettings,
} from './appState'
import { createResetSnapshot } from './privacyToolkit'
import type { City } from './cityprintData'

export const cityprintStorageKey = 'cityprint:v1'
export const cityprintBackupStorageKey = 'cityprint:v1:backup'

export type CityprintStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type CityprintSnapshotWriteEventDetail = {
  storageKey: string
  backupStorageKey: string
  serializedSnapshot: string
  backupEnabled: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return null
  }

  return value
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function parsePrivacy(value: unknown): PrivacySettings {
  if (!isObject(value)) {
    return defaultPrivacy
  }

  return {
    privateByDefault: booleanValue(value.privateByDefault, defaultPrivacy.privateByDefault),
    hideSensitivePlaces: booleanValue(value.hideSensitivePlaces, defaultPrivacy.hideSensitivePlaces),
    blurHomeWork: booleanValue(value.blurHomeWork, defaultPrivacy.blurHomeWork),
    preciseLocation: booleanValue(value.preciseLocation, defaultPrivacy.preciseLocation),
    recapExactRoutes: booleanValue(value.recapExactRoutes, defaultPrivacy.recapExactRoutes),
    backupEnabled: booleanValue(value.backupEnabled, defaultPrivacy.backupEnabled),
  }
}

function parseLocation(value: unknown): LocationSettings {
  if (!isObject(value)) {
    return defaultLocationSettings
  }

  const mode = value.mode === 'gps' ? 'gps' : 'simulated'

  return sanitizeLocationForPersistence({
    mode,
    permission:
      value.permission === 'granted' || value.permission === 'denied' ? value.permission : defaultLocationSettings.permission,
    gpsLatitude: typeof value.gpsLatitude === 'string' ? value.gpsLatitude : defaultLocationSettings.gpsLatitude,
    gpsLongitude: typeof value.gpsLongitude === 'string' ? value.gpsLongitude : defaultLocationSettings.gpsLongitude,
    gpsAccuracy: typeof value.gpsAccuracy === 'string' ? value.gpsAccuracy : defaultLocationSettings.gpsAccuracy,
  })
}

function sanitizeLocationForPersistence(location: LocationSettings): LocationSettings {
  return {
    ...defaultLocationSettings,
    mode: location.mode,
    permission: location.permission,
  }
}

function sanitizeSnapshotForPersistence(snapshot: AppSnapshot): AppSnapshot {
  return {
    ...snapshot,
    location: sanitizeLocationForPersistence(snapshot.location),
  }
}

function parseMemories(value: unknown): Memory[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const memories: Memory[] = []

  for (const item of value) {
    if (!isObject(item)) {
      return null
    }

    const visibility = item.visibility === 'Recap allowed' ? 'Recap allowed' : 'Private'

    if (
      typeof item.id !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.text !== 'string' ||
      typeof item.tag !== 'string' ||
      typeof item.hasPhoto !== 'boolean' ||
      typeof item.createdAt !== 'string'
    ) {
      return null
    }

    memories.push({
      id: item.id,
      title: item.title,
      text: item.text,
      tag: item.tag,
      visibility,
      placeId: typeof item.placeId === 'string' ? item.placeId : undefined,
      routeCell: typeof item.routeCell === 'string' ? item.routeCell : undefined,
      hasPhoto: item.hasPhoto,
      createdAt: item.createdAt,
    })
  }

  return memories
}

function parseCityProgress(value: unknown): CityProgressState | null {
  if (!isObject(value)) {
    return null
  }

  const revealedCells = stringArray(value.revealedCells)
  const seenPlaceIds = stringArray(value.seenPlaceIds)
  const savedPlaceIds = stringArray(value.savedPlaceIds)
  const routeTrace = stringArray(value.routeTrace)
  const memories = parseMemories(value.memories)
  const routeIndex = typeof value.routeIndex === 'number' && Number.isFinite(value.routeIndex) ? Math.max(0, Math.floor(value.routeIndex)) : 0
  const acceptedSampleCount =
    typeof value.acceptedSampleCount === 'number' && Number.isFinite(value.acceptedSampleCount)
      ? Math.max(0, Math.floor(value.acceptedSampleCount))
      : 0
  const latestRevealDigest = parseLatestRevealDigest(value.latestRevealDigest)
  const discoveryIds = stringArray(value.discoveryIds) ?? []
  const reviewedDiscoveryIds = stringArray(value.reviewedDiscoveryIds) ?? []

  if (!revealedCells || !seenPlaceIds || !savedPlaceIds || !memories) {
    return null
  }

  return {
    revealedCells,
    seenPlaceIds,
    savedPlaceIds,
    routeIndex,
    routeTrace: routeTrace ?? [],
    acceptedSampleCount,
    latestRevealDigest,
    discoveryIds,
    reviewedDiscoveryIds,
    memories,
  }
}

export function readCityprintSnapshot(storage: CityprintStorageLike | undefined = globalThis.localStorage): AppSnapshot {
  if (!storage) {
    return createResetSnapshot()
  }

  try {
    const primarySnapshot = readCityprintSnapshotFromRaw(storage.getItem(cityprintStorageKey))

    if (primarySnapshot) {
      return primarySnapshot
    }

    const backupSnapshot = readCityprintSnapshotFromRaw(storage.getItem(cityprintBackupStorageKey))

    return backupSnapshot ?? createResetSnapshot()
  } catch {
    return createResetSnapshot()
  }
}

export function serializeCityprintSnapshot(snapshot: AppSnapshot) {
  return JSON.stringify(sanitizeSnapshotForPersistence(snapshot))
}

function emitSnapshotWrite(serializedSnapshot: string, backupEnabled: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<CityprintSnapshotWriteEventDetail>('cityprint:snapshot-written', {
      detail: {
        storageKey: cityprintStorageKey,
        backupStorageKey: cityprintBackupStorageKey,
        serializedSnapshot,
        backupEnabled,
      },
    }),
  )
}

export function writeCityprintSnapshot(snapshot: AppSnapshot, storage: CityprintStorageLike | undefined = globalThis.localStorage) {
  if (!storage) {
    return
  }

  const serialized = serializeCityprintSnapshot(snapshot)

  storage.setItem(cityprintStorageKey, serialized)

  if (snapshot.privacy.backupEnabled) {
    storage.setItem(cityprintBackupStorageKey, serialized)
  } else {
    storage.removeItem(cityprintBackupStorageKey)
  }

  emitSnapshotWrite(serialized, snapshot.privacy.backupEnabled)
}

export function clearCityprintSnapshot(storage: CityprintStorageLike | undefined = globalThis.localStorage) {
  storage?.removeItem(cityprintStorageKey)
  storage?.removeItem(cityprintBackupStorageKey)
}

export function getCityProgress(snapshot: AppSnapshot, city: City): CityProgressState {
  return snapshot.cityProgress[city.id] ?? createDefaultCityProgress(city)
}

export function withCityProgress(snapshot: AppSnapshot, cityId: string, progress: CityProgressState): AppSnapshot {
  return {
    ...snapshot,
    cityProgress: {
      ...snapshot.cityProgress,
      [cityId]: progress,
    },
  }
}

export function readCityprintSnapshotFromRaw(raw: string | null): AppSnapshot | null {
  if (!raw) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isObject(parsed)) {
    return null
  }

  const cityProgress: Record<string, CityProgressState> = {}

  if (isObject(parsed.cityProgress)) {
    Object.entries(parsed.cityProgress).forEach(([cityId, progress]) => {
      const parsedProgress = parseCityProgress(progress)

      if (parsedProgress) {
        cityProgress[cityId] = parsedProgress
      }
    })
  }

  return {
    selectedCityId: typeof parsed.selectedCityId === 'string' ? parsed.selectedCityId : null,
    privacy: parsePrivacy(parsed.privacy),
    location: parseLocation(parsed.location),
    cityProgress,
  }
}

function parseLatestRevealDigest(value: unknown): LatestRevealDigest | null {
  if (!isObject(value)) {
    return null
  }

  if (
    typeof value.routeLabel !== 'string' ||
    typeof value.revealedCellCount !== 'number' ||
    typeof value.placeCount !== 'number' ||
    typeof value.reviewedCount !== 'number' ||
    typeof value.pendingCount !== 'number'
  ) {
    return null
  }

  return {
    routeLabel: value.routeLabel,
    revealedCellCount: Math.max(0, Math.floor(value.revealedCellCount)),
    placeCount: Math.max(0, Math.floor(value.placeCount)),
    reviewedCount: Math.max(0, Math.floor(value.reviewedCount)),
    pendingCount: Math.max(0, Math.floor(value.pendingCount)),
    featuredPlaceName: typeof value.featuredPlaceName === 'string' ? value.featuredPlaceName : undefined,
  }
}
