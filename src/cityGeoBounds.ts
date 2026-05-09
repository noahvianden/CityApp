import type { GeoBounds } from './geoGrid'

export const cityGeoBoundsById: Record<string, GeoBounds> = {
  berlin: {
    north: 52.6755,
    south: 52.3383,
    east: 13.7611,
    west: 13.0884,
  },
  hamburg: {
    north: 53.7394,
    south: 53.3951,
    east: 10.3252,
    west: 9.7308,
  },
}

export function getCityGeoBounds(cityId: string) {
  return cityGeoBoundsById[cityId] ?? null
}
