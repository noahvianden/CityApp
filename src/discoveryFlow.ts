import type { Place } from './cityprintData'

export type DiscoveryReviewState = {
  featuredDiscoveryPlace: Place | null
  secondaryDiscoveryPlaces: Place[]
  reviewedDiscoveryPlaces: Place[]
  pendingDiscoveryPlaces: Place[]
}

export function getDiscoveryReviewState(discoveryPlaces: Place[], reviewedDiscoveryIds: readonly string[]): DiscoveryReviewState {
  if (discoveryPlaces.length === 0) {
    return {
      featuredDiscoveryPlace: null,
      secondaryDiscoveryPlaces: [],
      reviewedDiscoveryPlaces: [],
      pendingDiscoveryPlaces: [],
    }
  }

  const reviewedIds = new Set(reviewedDiscoveryIds)
  const reviewedDiscoveryPlaces = discoveryPlaces.filter((place) => reviewedIds.has(place.id))
  const pendingDiscoveryPlaces = discoveryPlaces.filter((place) => !reviewedIds.has(place.id))
  const featuredDiscoveryPlace = pendingDiscoveryPlaces[0] ?? discoveryPlaces[0] ?? null
  const secondaryDiscoveryPlaces = discoveryPlaces.filter((place) => place.id !== featuredDiscoveryPlace?.id)

  return {
    featuredDiscoveryPlace,
    secondaryDiscoveryPlaces,
    reviewedDiscoveryPlaces,
    pendingDiscoveryPlaces,
  }
}
