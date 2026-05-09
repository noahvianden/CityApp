import type { City } from './cityprintData'

export type MemoryVisibility = 'Private' | 'Recap allowed'

export type Memory = {
  id: string
  title: string
  text: string
  tag: string
  visibility: MemoryVisibility
  placeId?: string
  routeCell?: string
  hasPhoto: boolean
  createdAt: string
}

export type LatestRevealDigest = {
  routeLabel: string
  revealedCellCount: number
  placeCount: number
  reviewedCount: number
  pendingCount: number
  featuredPlaceName?: string
}

export type PrivacySettings = {
  privateByDefault: boolean
  hideSensitivePlaces: boolean
  blurHomeWork: boolean
  preciseLocation: boolean
  recapExactRoutes: boolean
  backupEnabled: boolean
}

export type LocationSettings = {
  mode: 'simulated' | 'gps'
  permission: 'not-requested' | 'granted' | 'denied'
  gpsLatitude: string
  gpsLongitude: string
  gpsAccuracy: string
}

export type CityProgressState = {
  revealedCells: string[]
  seenPlaceIds: string[]
  savedPlaceIds: string[]
  routeIndex: number
  routeTrace: string[]
  acceptedSampleCount: number
  latestRevealDigest: LatestRevealDigest | null
  discoveryIds: string[]
  reviewedDiscoveryIds: string[]
  memories: Memory[]
}

export type AppSnapshot = {
  selectedCityId: string | null
  privacy: PrivacySettings
  location: LocationSettings
  cityProgress: Record<string, CityProgressState>
}

export const defaultPrivacy: PrivacySettings = {
  privateByDefault: true,
  hideSensitivePlaces: true,
  blurHomeWork: true,
  preciseLocation: false,
  recapExactRoutes: false,
  backupEnabled: false,
}

export const defaultLocationSettings: LocationSettings = {
  mode: 'simulated',
  permission: 'not-requested',
  gpsLatitude: '52.52',
  gpsLongitude: '13.405',
  gpsAccuracy: '18',
}

export function createDefaultMemories(cityId: string): Memory[] {
  if (cityId !== 'berlin') {
    return []
  }

  return [
    {
      id: 'memory-1',
      title: 'Morning light',
      text: 'Warm window seat after the first revealed block.',
      tag: 'quiet',
      visibility: 'Private',
      placeId: 'linden-cafe',
      hasPhoto: false,
      createdAt: 'Today',
    },
  ]
}

export function createDefaultCityProgress(city: City): CityProgressState {
  return {
    revealedCells: city.initialRevealed,
    seenPlaceIds: city.places.filter((place) => city.initialRevealed.includes(place.cell)).map((place) => place.id),
    savedPlaceIds: city.id === 'berlin' ? ['linden-cafe'] : [],
    routeIndex: 0,
    routeTrace: city.walkRoute.length > 0 ? [city.walkRoute[0]] : [],
    acceptedSampleCount: 0,
    latestRevealDigest: null,
    discoveryIds: [],
    reviewedDiscoveryIds: [],
    memories: createDefaultMemories(city.id),
  }
}

export function createDefaultSnapshot(): AppSnapshot {
  return {
    selectedCityId: null,
    privacy: defaultPrivacy,
    location: defaultLocationSettings,
    cityProgress: {},
  }
}
