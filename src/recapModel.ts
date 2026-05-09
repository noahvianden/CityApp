import type { Memory, PrivacySettings } from './appState'
import type { Category, City, District, Place } from './cityprintData'
import { summarizeRouteTrace } from './privacyToolkit'

const sensitiveCategories = new Set<Category>(['bar'])

export type DistrictRecap = {
  id: string
  name: string
  progress: number
}

export type RecapPlace = {
  id: string
  name: string
  category: Category
  district: string
  saved: boolean
  sensitive: boolean
}

export type RecapMemory = {
  id: string
  title: string
  tag: string
  placeName?: string
}

export type LatestRevealSummary = {
  routeLabel: string
  revealedCellCount: number
  placeCount: number
  reviewedCount: number
  pendingCount: number
  featuredPlaceName?: string
}

export type CityRecap = {
  title: string
  summary: string
  shareText: string
  latestReveal: LatestRevealSummary | null
  routeFragments: string[]
  visiblePlaces: RecapPlace[]
  shareablePlaces: RecapPlace[]
  shareableMemories: RecapMemory[]
  topDistricts: DistrictRecap[]
  privacyNotes: string[]
}

export type CityRecapExport = {
  app: 'Cityprint'
  cityId?: string
  cityName: string
  exportedAt: string
  latestReveal: LatestRevealSummary | null
  recap: CityRecap
}

type BuildCityRecapInput = {
  city: Pick<City, 'name' | 'districts' | 'places'>
  progress: number
  distanceWalkedKm: string
  revealedCells: ReadonlySet<string>
  routeTrace: readonly string[]
  visiblePlaces: Place[]
  savedPlaceIds: ReadonlySet<string>
  memories: Memory[]
  privacy: PrivacySettings
  latestReveal?: LatestRevealSummary | null
}

function getDistrictProgress(district: District, revealedCells: ReadonlySet<string>) {
  const revealedCount = district.cells.filter((cellId) => revealedCells.has(cellId)).length

  return Math.round((revealedCount / district.cells.length) * 100)
}

function formatDistrictSummary(districts: DistrictRecap[]) {
  if (districts.length === 0) {
    return 'no districts fully surfaced yet'
  }

  if (districts.length === 1) {
    return `${districts[0].name} leading`
  }

  return `${districts[0].name} and ${districts[1].name} leading`
}

export function buildCityRecap({
  city,
  progress,
  distanceWalkedKm,
  revealedCells,
  routeTrace,
  visiblePlaces,
  savedPlaceIds,
  memories,
  privacy,
  latestReveal,
}: BuildCityRecapInput): CityRecap {
  const topDistricts = city.districts
    .map((district) => ({
      id: district.id,
      name: district.name,
      progress: getDistrictProgress(district, revealedCells),
    }))
    .filter((district) => district.progress > 0)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 3)

  const visibleRecapPlaces = visiblePlaces
    .map((place) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      district: place.district,
      saved: savedPlaceIds.has(place.id),
      sensitive: sensitiveCategories.has(place.category),
    }))
    .sort((a, b) => Number(b.saved) - Number(a.saved) || a.name.localeCompare(b.name))

  const shareablePlaces = visibleRecapPlaces
    .filter((place) => !privacy.hideSensitivePlaces || !place.sensitive)
    .slice(0, 4)

  const placeNameById = new Map(city.places.map((place) => [place.id, place.name]))
  const shareableMemories = memories
    .filter((memory) => memory.visibility === 'Recap allowed')
    .map((memory) => ({
      id: memory.id,
      title: memory.title,
      tag: memory.tag,
      placeName: memory.placeId ? placeNameById.get(memory.placeId) : undefined,
    }))
    .slice(0, 3)

  const routeFragments = summarizeRouteTrace(city, routeTrace)
  const routeSummary =
    routeFragments.length > 1
      ? routeFragments.slice(0, 4).join(' -> ')
      : routeFragments[0] ?? 'no district fragments yet'
  const latestRevealSummary = latestReveal
    ? `Session review digest: ${latestReveal.placeCount} place${latestReveal.placeCount === 1 ? '' : 's'} around ${latestReveal.routeLabel}. ${latestReveal.reviewedCount} reviewed, ${latestReveal.pendingCount} open.`
    : null

  const privacyNotes = [
    privacy.recapExactRoutes ? 'Exact route included in recap mode.' : 'Exact route hidden; only district-level progress is shared.',
    privacy.hideSensitivePlaces ? 'Sensitive places stay out of the recap.' : 'All revealed place categories may appear in the recap.',
    privacy.blurHomeWork ? 'Home and work areas remain blurred.' : 'Home and work blur is currently off.',
    privacy.privateByDefault
      ? 'Only memories explicitly marked "Recap allowed" are included.'
      : 'Memories can be shared unless marked private.',
    latestReveal ? 'Latest reveal stays available as a session review digest until you move on.' : 'Session review digest appears after the next discovery batch.',
  ]

  const summary = latestRevealSummary
    ? `${progress}% revealed in ${city.name}, ${distanceWalkedKm} km walked, ${visiblePlaces.length} visible places, ${shareableMemories.length} recap memories, ${formatDistrictSummary(topDistricts)}. ${latestRevealSummary}`
    : `${progress}% revealed in ${city.name}, ${distanceWalkedKm} km walked, ${visiblePlaces.length} visible places, ${shareableMemories.length} recap memories, ${formatDistrictSummary(topDistricts)}.`

  const shareLines = [
    `${city.name} Cityprint recap`,
    `${progress}% revealed across ${topDistricts.length || 1} active district${topDistricts.length === 1 ? '' : 's'}.`,
    `${distanceWalkedKm} km walked. ${shareablePlaces.length} place highlight${shareablePlaces.length === 1 ? '' : 's'} unlocked.`,
    privacy.recapExactRoutes ? `Route: ${routeTrace.join(' -> ') || 'no exact route yet'}.` : `Route fragments: ${routeSummary}.`,
    ...(latestReveal
      ? [
          `Session review digest: ${latestReveal.placeCount} place${latestReveal.placeCount === 1 ? '' : 's'} around ${latestReveal.routeLabel}. ${latestReveal.reviewedCount} reviewed, ${latestReveal.pendingCount} open.`,
        ]
      : []),
    shareablePlaces.length > 0 ? `Places: ${shareablePlaces.map((place) => place.name).join(', ')}.` : 'Places: none ready to share yet.',
    shareableMemories.length > 0
      ? `Memories: ${shareableMemories.map((memory) => memory.title).join(', ')}.`
      : 'Memories: no recap-approved notes yet.',
    privacy.recapExactRoutes ? 'Route detail: exact route enabled.' : 'Route detail: exact route hidden.',
  ]

  return {
    title: `${city.name} private recap`,
    summary,
    shareText: shareLines.join('\n'),
    latestReveal: latestReveal ?? null,
    routeFragments,
    visiblePlaces: visibleRecapPlaces,
    shareablePlaces,
    shareableMemories,
    topDistricts,
    privacyNotes,
  }
}

function normalizeFilePart(value: string) {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'city'
  )
}

export function buildRecapExportFilename(cityName: string, exportedAt = new Date().toISOString()) {
  const stamp = exportedAt.replace(/[:.]/g, '-')

  return `cityprint-${normalizeFilePart(cityName)}-recap-${stamp}.json`
}

export function buildRecapExportData(
  city: Pick<City, 'id' | 'name'>,
  recap: CityRecap,
  exportedAt = new Date().toISOString(),
): CityRecapExport {
  return {
    app: 'Cityprint',
    cityId: city.id,
    cityName: city.name,
    exportedAt,
    latestReveal: recap.latestReveal,
    recap,
  }
}

export function recapExportToPrettyJson(
  city: Pick<City, 'id' | 'name'>,
  recap: CityRecap,
  exportedAt = new Date().toISOString(),
) {
  return JSON.stringify(buildRecapExportData(city, recap, exportedAt), null, 2)
}
