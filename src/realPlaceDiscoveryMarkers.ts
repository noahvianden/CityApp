export type RealPlaceMarkerCategory =
  | 'cafe'
  | 'restaurant'
  | 'park'
  | 'bar'
  | 'gallery'
  | 'shop'
  | 'culture'
  | 'viewpoint'
  | 'market'
  | 'quiet_spot'
  | 'landmark'

export type RealPlaceDiscoveryMarker = {
  id: string
  cityId: string
  name: string
  category: RealPlaceMarkerCategory
  district: string
  description: string
  discoveryContext: string
  latitude: number
  longitude: number
  source: 'seeded-real-place'
}

const realPlaceDiscoveryMarkers: RealPlaceDiscoveryMarker[] = [
  {
    id: 'berlin-brandenburg-gate',
    cityId: 'berlin',
    name: 'Brandenburg Gate',
    category: 'landmark',
    district: 'Mitte',
    description: "Historic neoclassical city gate and one of Berlin's most recognizable landmarks.",
    discoveryContext: 'Revealed when the walk reaches the historic center around Pariser Platz.',
    latitude: 52.516275,
    longitude: 13.377704,
    source: 'seeded-real-place',
  },
  {
    id: 'berlin-museum-island',
    cityId: 'berlin',
    name: 'Museum Island',
    category: 'culture',
    district: 'Mitte',
    description: 'Cluster of major museums on the Spree island in central Berlin.',
    discoveryContext: 'Appears as a culture marker after the central island area is uncovered.',
    latitude: 52.5169,
    longitude: 13.4019,
    source: 'seeded-real-place',
  },
  {
    id: 'berlin-markthalle-neun',
    cityId: 'berlin',
    name: 'Markthalle Neun',
    category: 'market',
    district: 'Kreuzberg',
    description: 'Historic market hall known for food stalls, local producers, and events.',
    discoveryContext: "Revealed when the route crosses into Kreuzberg's market streets.",
    latitude: 52.50208,
    longitude: 13.43161,
    source: 'seeded-real-place',
  },
  {
    id: 'berlin-tempelhofer-feld',
    cityId: 'berlin',
    name: 'Tempelhofer Feld',
    category: 'park',
    district: 'Tempelhof',
    description: 'Former airport field turned into a huge public park and open-air route.',
    discoveryContext: 'Shows up as a green discovery marker when southern open space is explored.',
    latitude: 52.473,
    longitude: 13.403,
    source: 'seeded-real-place',
  },
  {
    id: 'hamburg-elbphilharmonie',
    cityId: 'hamburg',
    name: 'Elbphilharmonie',
    category: 'culture',
    district: 'HafenCity',
    description: 'Concert hall above the harbor with a public plaza and waterfront views.',
    discoveryContext: 'Revealed when the harbor edge opens into HafenCity.',
    latitude: 53.54133,
    longitude: 9.98413,
    source: 'seeded-real-place',
  },
  {
    id: 'hamburg-speicherstadt',
    cityId: 'hamburg',
    name: 'Speicherstadt',
    category: 'landmark',
    district: 'HafenCity',
    description: 'Warehouse district of red-brick blocks, canals, and bridges.',
    discoveryContext: 'Appears as a landmark marker when the warehouse blocks are revealed.',
    latitude: 53.5436,
    longitude: 10.0014,
    source: 'seeded-real-place',
  },
  {
    id: 'hamburg-planten-un-blomen',
    cityId: 'hamburg',
    name: 'Planten un Blomen',
    category: 'park',
    district: 'Neustadt',
    description: 'Large central park with gardens, paths, and quiet green corners.',
    discoveryContext: 'Revealed as a quiet green marker north of the harbor walk.',
    latitude: 53.5617,
    longitude: 9.978,
    source: 'seeded-real-place',
  },
  {
    id: 'hamburg-fischmarkt',
    cityId: 'hamburg',
    name: 'Fischmarkt',
    category: 'market',
    district: 'Altona',
    description: 'Traditional riverside market area by the Elbe.',
    discoveryContext: 'Appears when the route follows the western waterfront.',
    latitude: 53.54667,
    longitude: 9.9521,
    source: 'seeded-real-place',
  },
]

export function getRealPlaceDiscoveryMarkers(cityId: string) {
  return realPlaceDiscoveryMarkers.filter((marker) => marker.cityId === cityId)
}

export function getAllRealPlaceDiscoveryMarkers() {
  return [...realPlaceDiscoveryMarkers]
}
