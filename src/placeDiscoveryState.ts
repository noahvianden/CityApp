import { isCoordinate, isFiniteNumber, type Coordinate } from './geoSpatial'

export type LivePlaceCategory =
  | 'cafe'
  | 'restaurant'
  | 'bar'
  | 'gallery'
  | 'culture'
  | 'viewpoint'
  | 'market'
  | 'park'
  | 'shop'
  | 'landmark'

export type SavedPlace = {
  id: string
  name: string
  category: LivePlaceCategory
  detail: string
  coordinate: Coordinate
  addressLabel: string
  googleMapsUrl: string
  savedAt: number
}

export type PlaceDiscoveryState = {
  savedIds: string[]
  visitedIds: string[]
  memoryIds: string[]
  savedPlaces: SavedPlace[]
}

const placeDiscoveryStateStorageKey = 'cityapp:place-discovery-card-state:v1'

const categoryLabels: Record<LivePlaceCategory, string> = {
  cafe: 'Cafe',
  restaurant: 'Food',
  bar: 'Bar',
  gallery: 'Gallery',
  culture: 'Culture',
  viewpoint: 'View',
  market: 'Market',
  park: 'Park',
  shop: 'Shop',
  landmark: 'Landmark',
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

export function categoryProperty(value: unknown): LivePlaceCategory {
  if (
    value === 'cafe' ||
    value === 'restaurant' ||
    value === 'bar' ||
    value === 'gallery' ||
    value === 'culture' ||
    value === 'viewpoint' ||
    value === 'market' ||
    value === 'park' ||
    value === 'shop' ||
    value === 'landmark'
  ) {
    return value
  }

  return 'landmark'
}

export function getCategoryLabel(category: LivePlaceCategory) {
  return categoryLabels[category]
}

function isSavedPlace(value: unknown): value is SavedPlace {
  if (!value || typeof value !== 'object') return false

  const entry = value as Partial<SavedPlace>
  return (
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.detail === 'string' &&
    isCoordinate(entry.coordinate) &&
    typeof entry.addressLabel === 'string' &&
    typeof entry.googleMapsUrl === 'string' &&
    isFiniteNumber(entry.savedAt)
  )
}

function dedupeSavedPlaces(places: SavedPlace[]) {
  const seen = new Set<string>()

  return places
    .map((place) => ({ ...place, category: categoryProperty(place.category) }))
    .filter((place) => {
      if (seen.has(place.id)) return false

      seen.add(place.id)
      return true
    })
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function getPlaceDiscoveryState(): PlaceDiscoveryState {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(placeDiscoveryStateStorageKey) ?? '{}')

    return {
      savedIds: readStringArray(parsed.savedIds),
      visitedIds: readStringArray(parsed.visitedIds),
      memoryIds: readStringArray(parsed.memoryIds),
      savedPlaces: Array.isArray(parsed.savedPlaces) ? dedupeSavedPlaces(parsed.savedPlaces.filter(isSavedPlace)) : [],
    }
  } catch {
    return { savedIds: [], visitedIds: [], memoryIds: [], savedPlaces: [] }
  }
}

export function setPlaceDiscoveryState(state: PlaceDiscoveryState) {
  const savedIds = Array.from(new Set(state.savedIds))
  const savedIdSet = new Set(savedIds)
  const savedPlaces = dedupeSavedPlaces(state.savedPlaces.filter((place) => savedIdSet.has(place.id)))

  try {
    window.localStorage.setItem(
      placeDiscoveryStateStorageKey,
      JSON.stringify({
        savedIds,
        visitedIds: Array.from(new Set(state.visitedIds)),
        memoryIds: Array.from(new Set(state.memoryIds)),
        savedPlaces,
      }),
    )
  } catch {
    // Place discovery state is optional convenience UI.
  }
}
