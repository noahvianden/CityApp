import type { City, District, Place } from './cityprintData'

export type DistrictResolution = {
  cellId: string
  primaryDistrict: District | null
  candidateDistricts: District[]
  placesInCell: Place[]
}

function districtSpecificity(district: District) {
  return district.cells.length
}

function compareDistrictsBySpecificity(a: District, b: District) {
  const specificityDelta = districtSpecificity(a) - districtSpecificity(b)

  if (specificityDelta !== 0) {
    return specificityDelta
  }

  return a.name.localeCompare(b.name)
}

export function getDistrictsForCell(city: Pick<City, 'districts'>, cellId: string) {
  return city.districts
    .filter((district) => district.cells.includes(cellId))
    .sort(compareDistrictsBySpecificity)
}

export function getPrimaryDistrictForCell(city: Pick<City, 'districts'>, cellId: string) {
  return getDistrictsForCell(city, cellId)[0] ?? null
}

export function resolveDistrictForCell(city: Pick<City, 'districts' | 'places'>, cellId: string): DistrictResolution {
  const candidateDistricts = getDistrictsForCell(city, cellId)
  const placesInCell = city.places.filter((place) => place.cell === cellId)
  const placeDistrictNames = new Set(placesInCell.map((place) => place.district))
  const placeMatchedDistrict = candidateDistricts.find((district) => placeDistrictNames.has(district.name))

  return {
    cellId,
    primaryDistrict: placeMatchedDistrict ?? candidateDistricts[0] ?? null,
    candidateDistricts,
    placesInCell,
  }
}

export function describeDistrictResolution(resolution: DistrictResolution) {
  if (!resolution.primaryDistrict) {
    return `Cell ${resolution.cellId} is not assigned to a known district.`
  }

  const candidateSuffix =
    resolution.candidateDistricts.length > 1
      ? ` Overlaps ${resolution.candidateDistricts.map((district) => district.name).join(', ')}.`
      : ''
  const placeSuffix =
    resolution.placesInCell.length > 0
      ? ` Nearby authored place${resolution.placesInCell.length === 1 ? '' : 's'}: ${resolution.placesInCell
          .map((place) => place.name)
          .join(', ')}.`
      : ''

  return `Cell ${resolution.cellId} maps to ${resolution.primaryDistrict.name}.${candidateSuffix}${placeSuffix}`
}
