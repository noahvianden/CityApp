import { defaultPrivacy, type AppSnapshot, type CityProgressState, type PrivacySettings } from './appState'
import type { City } from './cityprintData'
import { toRoutePoint } from './revealModel'

export function buildPrivacyRules(privacy: PrivacySettings) {
  return [
    {
      id: 'private-by-default',
      label: 'Memories start private',
      enabled: privacy.privateByDefault,
    },
    {
      id: 'hide-sensitive',
      label: 'Sensitive places stay hidden from recaps',
      enabled: privacy.hideSensitivePlaces,
    },
    {
      id: 'blur-home-work',
      label: 'Home and work areas are blurred',
      enabled: privacy.blurHomeWork,
    },
    {
      id: 'exact-route',
      label: 'Exact route traces stay hidden by default',
      enabled: !privacy.recapExactRoutes,
    },
    {
      id: 'precise-location',
      label: 'Precise location is used only during active walks',
      enabled: privacy.preciseLocation,
    },
    {
      id: 'backup-control',
      label: 'Backup remains user-controlled',
      enabled: !privacy.backupEnabled,
    },
  ]
}

export function buildExportPreview(snapshot: AppSnapshot) {
  return {
    app: 'Cityprint',
    exportedAt: new Date().toISOString(),
    selectedCityId: snapshot.selectedCityId,
    privacy: snapshot.privacy,
    location: {
      mode: snapshot.location.mode,
      permission: snapshot.location.permission,
    },
    cityProgress: Object.entries(snapshot.cityProgress).map(([cityId, progress]) => ({
      cityId,
      revealedCells: progress.revealedCells,
      seenPlaceIds: progress.seenPlaceIds,
      savedPlaceIds: progress.savedPlaceIds,
      routeIndex: progress.routeIndex,
      routeTrace: progress.routeTrace,
      memories: progress.memories,
    })),
  }
}

export function describeExactRouteVisibility(privacy: PrivacySettings) {
  return describeRouteTraceVisibility(privacy)
}

function routeDistrictIds(city: Pick<City, 'districts'>, routeTrace: readonly string[]) {
  const ids: string[] = []

  for (const cellId of routeTrace) {
    const districtId = city.districts.find((district) => district.cells.includes(cellId))?.id

    if (!districtId || ids[ids.length - 1] === districtId) {
      continue
    }

    ids.push(districtId)
  }

  return ids
}

export function describeRouteTraceVisibility(privacy: PrivacySettings) {
  if (privacy.recapExactRoutes) {
    return {
      visible: true,
      label: 'Exact route visible',
      detail: 'The atlas and recap can show the walked path.',
    }
  }

  return {
    visible: false,
    label: 'District fragments',
    detail: 'The atlas keeps the walked path generalized to district-level fragments.',
  }
}

export function buildRouteTracePath(city: Pick<City, 'districts' | 'map'>, routeTrace: readonly string[], privacy: PrivacySettings) {
  if (routeTrace.length < 2) {
    return ''
  }

  if (privacy.recapExactRoutes) {
    return routeTrace.map(toRoutePoint).join(' ')
  }

  const fragmentDistrictIds = routeDistrictIds(city, routeTrace)

  if (fragmentDistrictIds.length < 2) {
    return ''
  }

  return fragmentDistrictIds
    .map((districtId) => city.map.regions.find((region) => region.id === districtId))
    .filter((region): region is (typeof city.map.regions)[number] => Boolean(region))
    .map((region) => `${region.labelX},${region.labelY}`)
    .join(' ')
}

export function summarizeRouteTrace(city: Pick<City, 'districts'>, routeTrace: readonly string[]) {
  const districtIds = routeDistrictIds(city, routeTrace)

  return districtIds
    .map((districtId) => city.districts.find((district) => district.id === districtId)?.name)
    .filter((districtName): districtName is string => Boolean(districtName))
}

export function snapshotToPrettyJson(snapshot: AppSnapshot) {
  return JSON.stringify(buildExportPreview(snapshot), null, 2)
}

function normalizeExportStamp(exportedAt: string) {
  const [datePart = 'unknown-date', timePart = '00-00-00Z'] = exportedAt.split('T')

  return `${datePart}_${timePart.replace(/[:.]/g, '-')}`
}

export function buildExportFilename(snapshot: AppSnapshot, exportedAt = new Date().toISOString()) {
  const cityPart = snapshot.selectedCityId ? `-${snapshot.selectedCityId}` : ''

  return `cityprint${cityPart}-export-${normalizeExportStamp(exportedAt)}.json`
}

export function createResetSnapshot(): AppSnapshot {
  return {
    selectedCityId: null,
    privacy: defaultPrivacy,
    location: {
      mode: 'simulated',
      permission: 'not-requested',
      gpsLatitude: '52.52',
      gpsLongitude: '13.405',
      gpsAccuracy: '18',
    },
    cityProgress: {},
  }
}

export function hasLocalProgress(snapshot: AppSnapshot) {
  const privacyChanged =
    snapshot.privacy.privateByDefault !== defaultPrivacy.privateByDefault ||
    snapshot.privacy.hideSensitivePlaces !== defaultPrivacy.hideSensitivePlaces ||
    snapshot.privacy.blurHomeWork !== defaultPrivacy.blurHomeWork ||
    snapshot.privacy.preciseLocation !== defaultPrivacy.preciseLocation ||
    snapshot.privacy.recapExactRoutes !== defaultPrivacy.recapExactRoutes ||
    snapshot.privacy.backupEnabled !== defaultPrivacy.backupEnabled

  return Boolean(snapshot.selectedCityId || Object.keys(snapshot.cityProgress).length > 0 || privacyChanged)
}

export function currentProgressSummary(progress: CityProgressState) {
  return {
    revealedCells: progress.revealedCells.length,
    savedPlaces: progress.savedPlaceIds.length,
    acceptedSamples: progress.acceptedSampleCount,
    memories: progress.memories.length,
  }
}
